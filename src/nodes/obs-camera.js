// OBSCamera — нода-помощник для подключения OBS Virtual Camera.
// Та же Camera, но с подсказкой как настроить OBS и фильтром устройств.

import { CameraNode } from './camera.js';

export class OBSCameraNode extends CameraNode {
  static title = 'OBS Virtual Cam';
  static icon = '🎥';
  static category = 'sources';

  init() {
    super.init();
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4;margin-top:0.3rem;padding:0.4rem;border:1px dashed rgba(255,255,255,0.12);border-radius:6px';
    hint.innerHTML =
      '<b>Что нужно сделать:</b><br>' +
      '1. Установи <b>OBS Studio</b> (obsproject.com).<br>' +
      '2. Собери в OBS свою сцену (можно микшировать любые источники).<br>' +
      '3. Нажми в OBS <b>«Start Virtual Camera»</b>.<br>' +
      '4. Здесь в списке появится «OBS Virtual Camera» — выбери.';
    this.bodyEl.appendChild(hint);
  }

  async refreshDevices() {
    await super.refreshDevices();
    if (!this.deviceSelect) return;
    Array.from(this.deviceSelect.options).forEach((o) => {
      if (/OBS/i.test(o.textContent)) {
        if (!o.textContent.startsWith('★ ')) o.textContent = '★ ' + o.textContent;
      }
    });
  }
}
