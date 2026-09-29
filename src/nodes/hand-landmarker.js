import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _handPromise = null;
let _DrawingUtils = null;
async function getHandDetector() {
  if (_handPromise) return _handPromise;
  _handPromise = (async () => {
    const mod = await import(MP_URL);
    _DrawingUtils = mod.DrawingUtils;
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    return await mod.GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  })();
  return _handPromise;
}

export class HandLandmarkerNode extends Node {
  static title = 'Рука (Landmarks)';
  static icon = '🖐️';
  static category = 'interaction';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [
      { name: 'video', type: 'video', label: 'видео' },

      { name: 'leftHandPresence', type: 'number', label: 'левая рука в кадре', group: 'БАЗА' },
      { name: 'rightHandPresence', type: 'number', label: 'правая рука в кадре', group: 'БАЗА' },

      { name: 'palmPoint', type: 'number', label: 'центр ладони', group: 'ТОЧКИ' },
      { name: 'indexPoint', type: 'number', label: 'указательный', group: 'ТОЧКИ' },
      { name: 'thumbPoint', type: 'number', label: 'большой палец', group: 'ТОЧКИ' },
      { name: 'pinchPoint', type: 'number', label: 'щипок', group: 'ТОЧКИ' },
      { name: 'x', type: 'number', label: 'курсор X (палец)', group: 'РИСОВАНИЕ' },
      { name: 'y', type: 'number', label: 'курсор Y (палец)', group: 'РИСОВАНИЕ' },
      { name: 'draw', type: 'number', label: 'рисую (щипок)', group: 'РИСОВАНИЕ' },

      { name: 'fingerCountLeft', type: 'number', label: 'пальцы левой руки', group: 'СЧЁТ' },
      { name: 'fingerCountRight', type: 'number', label: 'пальцы правой руки', group: 'СЧЁТ' },
      { name: 'fingerCountTotal', type: 'number', label: 'всего пальцев', group: 'СЧЁТ' },

      { name: 'openClose', type: 'number', label: 'ладонь открыть / закрыть', group: 'ПАРЫ' },
      { name: 'handsTogetherApart', type: 'number', label: 'ладони свести / развести', group: 'ПАРЫ' },
      { name: 'fistDepth', type: 'number', label: 'кулак ближе / дальше', group: 'ПАРЫ' },
      { name: 'pointDirection', type: 'number', label: 'указательный: направление', group: 'ПАРЫ' },
      { name: 'pinchSpread', type: 'number', label: 'пальцы свести / развести', group: 'ПАРЫ' },

      { name: 'thumbsUp', type: 'trigger', label: 'лайк', group: 'ТРИГГЕРЫ' },
      { name: 'victory', type: 'trigger', label: 'победа', group: 'ТРИГГЕРЫ' },
      { name: 'color', type: 'color', label: 'цвет (от пальцев)', group: 'ЦВЕТ' },
      { name: 'iLoveYou', type: 'trigger', label: 'любовь', group: 'ТРИГГЕРЫ' },
      { name: 'prayerHands', type: 'trigger', label: 'молитва', group: 'ТРИГГЕРЫ' },
      { name: 'claspedHands', type: 'trigger', label: 'замок', group: 'ТРИГГЕРЫ' },
      { name: 'okSign', type: 'trigger', label: 'кольцо', group: 'ТРИГГЕРЫ' },
      { name: 'watchLook', type: 'trigger', label: 'часы', group: 'ТРИГГЕРЫ' },
    ];
    this.paramDefs = [
      { kind: 'toggle', name: 'showHUD', label: 'Показать HUD', default: true },
      { kind: 'slider', name: 'opacity', label: 'прозрачность', min: 0, max: 1, step: 0.1, default: 1 },
      { kind: 'slider', name: 'pinchThreshold', label: 'порог щипка (рисование)', min: 0.01, max: 0.2, step: 0.005, default: 0.07 },
    ];

    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    this._detector = null;
    this._statusEl = null;
    this.values = {
      leftHandPresence: 0, rightHandPresence: 0,
      palmPoint: null, indexPoint: null, thumbPoint: null, pinchPoint: null,
      fingerCountLeft: 0, fingerCountRight: 0, fingerCountTotal: 0,
      openClose: 0, handsTogetherApart: 0, fistDepth: 0, pointDirection: { x: 0, y: 0 }, pinchSpread: 0,
      color: '#ff0000',
      thumbsUp: 0, victory: 0, iLoveYou: 0, prayerHands: 0, claspedHands: 0, okSign: 0, watchLook: 0
    };
    this._prevTriggers = { thumbsUp: 0, victory: 0, iLoveYou: 0, prayerHands: 0, claspedHands: 0, okSign: 0, watchLook: 0 };
  }

  async init() {
    this._statusEl = document.createElement('div');
    this._statusEl.className = 'node-status';
    this._statusEl.style.cssText = 'color: #feef33; font-size: 0.7rem; padding: 0.3rem 0.5rem; border-top: 1px solid rgba(255,255,255,0.1);';
    this._statusEl.textContent = 'Инициализация...';
    this.bodyEl.appendChild(this._statusEl);

    try {
      this._detector = await getHandDetector();
      this._statusEl.textContent = 'ИИ: готов';
      this._statusEl.style.color = '#00ffcc';
    } catch (e) {
      this._statusEl.textContent = 'Ошибка ИИ';
      this._statusEl.style.color = '#ff4d2e';
    }
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) {
      this.values.leftHandPresence = 0;
      this.values.rightHandPresence = 0;
      this.values.palmPoint = null;
      this.values.indexPoint = null;
      this.values.thumbPoint = null;
      this.values.pinchPoint = null;
      return;
    }

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w; this.canvas.height = h;
    }

    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.globalAlpha = 1.0;
    this.ctx2d.drawImage(v, 0, 0);

    copyMetadata(v, this.canvas);

    if (this._detector) {
      try {
        const ts = performance.now();
        const res = this._detector.recognizeForVideo(v, ts);
        const hands = res.landmarks || [];

        // Reset values
        this.values.leftHandPresence = 0;
        this.values.rightHandPresence = 0;
        this.values.palmPoint = null;
        this.values.indexPoint = null;
        this.values.thumbPoint = null;
        this.values.pinchPoint = null;
        this.values.fingerCountLeft = 0;
        this.values.fingerCountRight = 0;
        this.values.fingerCountTotal = 0;
        this.values.openClose = 0;
        this.values.handsTogetherApart = 0;
        this.values.fistDepth = 0;
        this.values.pointDirection = { x: 0, y: 0 };
        this.values.pinchSpread = 0;
        this.values.thumbsUp = 0;
        this.values.victory = 0;
        this.values.iLoveYou = 0;
        this.values.prayerHands = 0;
        this.values.claspedHands = 0;
        this.values.okSign = 0;
        this.values.watchLook = 0;

        let primaryHand = null;
        let leftHand = null;
        let rightHand = null;

        let currentTriggers = { thumbsUp: 0, victory: 0, iLoveYou: 0, prayerHands: 0, claspedHands: 0, okSign: 0, watchLook: 0 };

        if (hands.length > 0) {
          hands.forEach((lm, i) => {
            const side = res.handedness[i][0].displayName; // "Left" or "Right"
            if (side === 'Left') { this.values.leftHandPresence = 1; leftHand = lm; }
            if (side === 'Right') { this.values.rightHandPresence = 1; rightHand = lm; }
            if (i === 0) primaryHand = lm;

            // Продвинутый подсчет пальцев (дистанция до запястья)
            let raised = 0;
            const wrist = lm[0];
            const isRaised = (tipIdx, pipIdx) => {
              return Math.hypot(lm[tipIdx].x - wrist.x, lm[tipIdx].y - wrist.y) >
                Math.hypot(lm[pipIdx].x - wrist.x, lm[pipIdx].y - wrist.y) * 1.1; // *1.1 для надежности
            };
            if (isRaised(4, 2)) raised++; // Большой
            if (isRaised(8, 6)) raised++; // Указательный
            if (isRaised(12, 10)) raised++; // Средний
            if (isRaised(16, 14)) raised++; // Безымянный
            if (isRaised(20, 18)) raised++; // Мизинец

            if (side === 'Left') this.values.fingerCountLeft = raised;
            if (side === 'Right') this.values.fingerCountRight = raised;

            // MediaPipe стандартные жесты (если включен Classifier)
            if (res.gestures && res.gestures[i] && res.gestures[i].length > 0) {
              const g = res.gestures[i][0].categoryName;
              if (g === 'Thumb_Up') currentTriggers.thumbsUp = 1;
              if (g === 'Victory') currentTriggers.victory = 1;
              if (g === 'ILoveYou') currentTriggers.iLoveYou = 1;
              if (g === 'Open_Palm') this.values.openClose = 1;
              if (g === 'Closed_Fist') this.values.openClose = 0;
            } else {
              // Фолбэк на подсчет пальцев для Open/Close, если Classifier выключен
              if (raised >= 4) this.values.openClose = 1;
              if (raised <= 1) this.values.openClose = 0;
            }
          });

          this.values.fingerCountTotal = this.values.fingerCountLeft + this.values.fingerCountRight;

          // Первичная рука (Точки и одиночные метрики)
          if (primaryHand) {
            this.values.palmPoint = {
              x: (primaryHand[0].x + primaryHand[5].x + primaryHand[9].x + primaryHand[13].x + primaryHand[17].x) / 5,
              y: (primaryHand[0].y + primaryHand[5].y + primaryHand[9].y + primaryHand[13].y + primaryHand[17].y) / 5,
              z: (primaryHand[0].z + primaryHand[5].z + primaryHand[9].z + primaryHand[13].z + primaryHand[17].z) / 5
            };
            this.values.indexPoint = { x: primaryHand[8].x, y: primaryHand[8].y, z: primaryHand[8].z };
            this.values.thumbPoint = { x: primaryHand[4].x, y: primaryHand[4].y, z: primaryHand[4].z };
            this.values.pinchPoint = {
              x: (primaryHand[8].x + primaryHand[4].x) / 2,
              y: (primaryHand[8].y + primaryHand[4].y) / 2,
              z: (primaryHand[8].z + primaryHand[4].z) / 2
            };

            // Дистанция щипка
            this.values.pinchSpread = Math.hypot(primaryHand[8].x - primaryHand[4].x, primaryHand[8].y - primaryHand[4].y);
            
            // Экспорт для рисования: ищем любую руку со щипком
            const th = this.params.pinchThreshold ?? 0.07;
            let anyDraw = this.values.pinchSpread < th ? 1 : 0;
            hands.forEach(lm => {
               const spread = Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y);
               if (spread < th) anyDraw = 1;
            });

            this.values.x = primaryHand[8].x;
            this.values.y = primaryHand[8].y;
            this.values.draw = anyDraw;

            // Глубина кулака (fist depth) - масштаб кисти (упрощенно)
            this.values.fistDepth = Math.hypot(primaryHand[0].x - primaryHand[9].x, primaryHand[0].y - primaryHand[9].y);

            // Направление указательного пальца (вектор)
            this.values.pointDirection = {
              x: primaryHand[8].x - primaryHand[5].x,
              y: primaryHand[8].y - primaryHand[5].y
            };

            // Кольцо (OK Sign): Щипок закрыт, остальные 3 пальца открыты
            const isPrimaryLeft = res.handedness[0][0].displayName === 'Left';
            const primaryRaised = isPrimaryLeft ? this.values.fingerCountLeft : this.values.fingerCountRight;
            if (this.values.pinchSpread < 0.04 && primaryRaised === 3) {
              currentTriggers.okSign = 1;
            }

            // Жест 'Часы': горизонтальное запястье, пальцы полузакрыты
            if (Math.abs(primaryHand[0].y - primaryHand[9].y) < 0.08 && primaryRaised <= 2) {
              currentTriggers.watchLook = 1;
            }
          }

          // Двуручные метрики
          if (leftHand && rightHand) {
            const leftPalm = {
              x: (leftHand[0].x + leftHand[5].x + leftHand[9].x + leftHand[13].x + leftHand[17].x) / 5,
              y: (leftHand[0].y + leftHand[5].y + leftHand[9].y + leftHand[13].y + leftHand[17].y) / 5
            };
            const rightPalm = {
              x: (rightHand[0].x + rightHand[5].x + rightHand[9].x + rightHand[13].x + rightHand[17].x) / 5,
              y: (rightHand[0].y + rightHand[5].y + rightHand[9].y + rightHand[13].y + rightHand[17].y) / 5
            };
            this.values.handsTogetherApart = Math.hypot(leftPalm.x - rightPalm.x, leftPalm.y - rightPalm.y);

            // Молитва (Prayer): ладони близко, пальцы открыты
            if (this.values.handsTogetherApart < 0.15 && this.values.fingerCountTotal >= 8) {
              currentTriggers.prayerHands = 1;
            }

            // Замок (Lock): ладони близко, пальцы закрыты (сцеплены)
            if (this.values.handsTogetherApart < 0.15 && this.values.fingerCountTotal <= 2) {
              currentTriggers.claspedHands = 1;
            }
          }

          // Цвет от пальцев (Rainbow HSL)
          this.values.color = `hsl(${(this.values.fingerCountTotal * 36) % 360}, 100%, 50%)`;

          // Отрисовка HUD
          if (_DrawingUtils && this.params.showHUD) {
            const drawingUtils = new _DrawingUtils(this.ctx2d);
            const mod = this._detector.constructor;
            this.ctx2d.globalAlpha = this.params.opacity ?? 1;
            const conn = mod.HAND_CONNECTIONS;
            hands.forEach((lm, i) => {
              const side = res.handedness[i][0].displayName;
              drawingUtils.drawConnectors(lm, conn, { color: side === 'Left' ? '#00e5d5' : '#feef33', lineWidth: 3 });
              drawingUtils.drawLandmarks(lm, { color: '#ffffff', radius: 2 });
            });
          }
        } else {
          // No hands detected, values are already 0
        }

        // Вычисляем Edge-based (импульсные) триггеры
        Object.keys(currentTriggers).forEach(k => {
          this.values[k] = (!this._prevTriggers[k] && currentTriggers[k]) ? 1 : 0;
          this._prevTriggers[k] = currentTriggers[k];
        });

        // Структурированный handData для downstream нод
        this.canvas.handData = {
          landmarks: hands,
          points: {
            palmPoint: this.values.palmPoint,
            indexPoint: this.values.indexPoint,
            thumbPoint: this.values.thumbPoint,
            pinchPoint: this.values.pinchPoint,
          },
          metrics: {
            leftHandPresence: this.values.leftHandPresence,
            rightHandPresence: this.values.rightHandPresence,
            fingerCountLeft: this.values.fingerCountLeft,
            fingerCountRight: this.values.fingerCountRight,
            fingerCountTotal: this.values.fingerCountTotal,
            openClose: this.values.openClose,
            handsTogetherApart: this.values.handsTogetherApart,
            fistDepth: this.values.fistDepth,
            pointDirection: this.values.pointDirection,
            pinchSpread: this.values.pinchSpread,
          },
          triggers: {
            thumbsUp: this.values.thumbsUp,
            victory: this.values.victory,
            iLoveYou: this.values.iLoveYou,
            prayerHands: this.values.prayerHands,
            claspedHands: this.values.claspedHands,
            okSign: this.values.okSign,
            watchLook: this.values.watchLook,
          },
          color: this.values.color
        };
        // RELAY: копируем цвет прямо в корень для InteractionMaster
        this.canvas.color = this.values.color;

        if (this._statusEl) {
          if (hands.length > 0) {
            this._statusEl.textContent = `РУКИ: LIVE ✅ (${hands.length})`;
            this._statusEl.style.color = '#00ffcc';
          } else {
            this._statusEl.textContent = 'Поиск рук...';
            this._statusEl.style.color = '#feef33';
          }
        }

      } catch (e) {
        if (this._statusEl) this._statusEl.textContent = 'Ошибка ИИ';
      }
    }
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return this.values[name];
  }
}
