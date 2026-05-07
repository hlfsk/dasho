// iPhoneCamera — нода-помощник для подключения iPhone как камеры.
// Под капотом — это та же Camera-нода, но с автоматическим выбором устройств
// чьё имя содержит "NDI" / "iPhone" / "Camo" + инструкция как настроить.

import { CameraNode } from './camera.js';

export class IPhoneCameraNode extends CameraNode {
  static title = 'iPhone-камера';
  static icon = '📱';
  static category = 'sources';
  static keywords = 'ndi tagtool ipad iphone phone обс obs webcam';

  init() {
    super.init();
    // Подменяем подсказку
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4;margin-top:0.3rem;padding:0.4rem;border:1px dashed rgba(255,255,255,0.12);border-radius:6px';
    hint.innerHTML =
      '<b>Чтобы iPhone стал webcam:</b><br>' +
      '1. На iPhone установить <b>NDI HX Camera</b> (App Store).<br>' +
      '2. На Mac установить <b>NDI Tools</b> (бесплатно с ndi.video).<br>' +
      '3. В NDI Tools запустить <b>NDI Webcam Input</b> → выбрать iPhone.<br>' +
      '4. Здесь в списке появится «NDI Video» — выбери и нажми «Включить».';
    this.bodyEl.appendChild(hint);
  }

  async refreshDevices() {
    await super.refreshDevices();
    if (!this.deviceSelect) return;
    // Подсветим NDI / iPhone / Camo устройства
    Array.from(this.deviceSelect.options).forEach((o) => {
      if (/NDI|iPhone|Camo|EpocCam/i.test(o.textContent)) {
        if (!o.textContent.startsWith('★ ')) o.textContent = '★ ' + o.textContent;
      }
    });
  }
}
