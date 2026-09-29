// util.js — мелкие хелперы для работы с медиа-входами.

// Принимаем любой "рисуемый" видео-источник: HTMLVideoElement (готовый),
// HTMLCanvasElement, HTMLImageElement, ImageBitmap, OffscreenCanvas.
// Отсекаем null/undefined и видео, которые ещё не загрузились.
export function isDrawable(v) {
  if (!v) return false;
  if (v instanceof HTMLVideoElement) return v.readyState >= 2;
  if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return true;
  if (typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement) return v.complete;
  if (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas) return true;
  if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return true;
  return false;
}

export function intrinsicSize(v) {
  if (v instanceof HTMLVideoElement) return { w: v.videoWidth || 1, h: v.videoHeight || 1 };
  return { w: v.width || 1, h: v.height || 1 };
}

// Пробрасывает метаданные ИИ (лицо, руки, тело) с одного канваса на другой
export function copyMetadata(from, to) {
  if (!from || !to) return;
  to.faceData = from.faceData || null;
  to.handData = from.handData || null;
  to.poseData = from.poseData || null;
}
