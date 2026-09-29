// socket.js — типы сокетов. Цвет провода = тип источника.
// Соединять можно: одинаковые типы, ИЛИ trigger→number (триггер = 1 на момент).

export const TYPES = {
  video:   { color: '#feef33', label: 'видео'   },  // жёлтый
  audio:   { color: '#00e5d5', label: 'звук'    },  // бирюзовый
  number:  { color: '#c4a8ff', label: 'число'   },  // лавандовый — отличается от video!
  trigger: { color: '#ff4d2e', label: 'триггер' },  // оранж
  color:   { color: '#a855f7', label: 'цвет'    },  // сиреневый
};

// Совместимость соединений: from-out type → to-in type.
// Кроме точного совпадения, разрешаем «понятные» преобразования.
export function canConnect(outType, inType) {
  if (!TYPES[outType] || !TYPES[inType]) return false;
  if (outType === inType) return true;
  // Цвет: принимаем числа (радуга) и триггеры (рандом)
  if (inType === 'color') {
    return outType === 'number' || outType === 'trigger';
  }
  // Триггер можно подать на число-вход — будет 0/1 в момент срабатывания
  if (outType === 'trigger' && inType === 'number') return true;
  // Число можно подать на триггер-вход — фиксируется по порогу 0.5
  if (outType === 'number' && inType === 'trigger') return true;
  return false;
}

export function colorOf(type) {
  return TYPES[type]?.color || '#888';
}

export function labelOf(type) {
  return TYPES[type]?.label || type;
}
