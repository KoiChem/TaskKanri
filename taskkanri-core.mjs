/*
 * TaskKanri's data boundary.
 *
 * This module deliberately has no UI dependencies.  The browser application
 * uses the same parser, validator, sanitizer, snapshot and reset code that is
 * exercised by the Node tests.
 */

export const APP_CONFIG = Object.freeze({
  displayVersion: '72',
  compatibilityVersion: '72',
  buildVersion: '20260905-stage1-v2',
  schemaVersion: 2,
  supportedSchemaVersions: Object.freeze([1, 2]),
  storeKey: 'TASK_KUN_MASTER_STORAGE',
  readOnlyGuardKey: 'TASK_KUN_MASTER_STORAGE_READ_ONLY_GUARD',
  quarantinePrefix: 'TASK_KUN_MASTER_STORAGE_QUARANTINE_',
  recoveryPrefix: 'TASK_KUN_MASTER_STORAGE_RECOVERY_',
  theme: Object.freeze({ exam: '#f2e5ff', short: '#ffffea', noclass: '#e5ffe5' }),
  labels: Object.freeze({
    short: Object.freeze(['時程', '短縮時程', '短縮ＡＭ', '午前時程']),
    exam: Object.freeze(['考査', '定期考査', '模擬試験']),
    noClass: Object.freeze(['授業', '授業なし', '授業なし'])
  }),
  slotsAll: Object.freeze(['朝', '１限', '２限', '３限', '４限', '昼休み', '５限', '６限', '７限', '放課後']),
  timeKeys: Object.freeze(['朝', '１限', '２限', '３限', '４限', '昼休み', '５限', '６限', '７限', '放課後']),
  daysStr: Object.freeze(['日', '月', '火', '水', '木', '金', '土']),
  defaultTime: Object.freeze({
    normal: Object.freeze({ '朝': '08:35', '１限': '08:50', '２限': '09:50', '３限': '10:50', '４限': '11:50', '昼休み': '12:40', '５限': '13:25', '６限': '14:25', '７限': '15:25', '放課後': '16:25' }),
    short: Object.freeze({ '朝': '08:35', '１限': '08:50', '２限': '09:40', '３限': '10:30', '４限': '11:20', '昼休み': '12:00', '５限': '12:45', '６限': '13:35', '７限': '14:25', '放課後': '15:25' }),
    exam: Object.freeze({ '朝': '08:35', '１限': '08:50', '２限': '09:50', '３限': '10:50', '４限': '11:50', '昼休み': '', '５限': '', '６限': '', '７限': '', '放課後': '12:00' })
  }),
  defaultHolidays: Object.freeze({
    '2026-04-29': '昭和の日', '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日', '2026-05-05': 'こどもの日', '2026-05-06': '振替休日',
    '2026-07-20': '海の日', '2026-08-11': '山の日', '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日',
    '2026-10-12': 'スポーツの日', '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
    '2027-01-01': '元日', '2027-01-11': '成人の日', '2027-02-11': '建国記念の日', '2027-02-23': '天皇誕生日', '2027-03-21': '春分の日', '2027-03-22': '振替休日'
  })
});

const LEGACY_BASE_KEYS = Object.freeze([
  'academicYear', 'isLandscapeMode', 'isClockVisible', 'teacherSchedule', 'configEvents', 'configWeekly',
  'customHolidays', 'noClassData', 'shortData', 'examData', 'timeConfig', 'globalTaskData',
  'countSettings', 'countDateRange', 'daySlotConfig'
]);
const LEGACY_SUFFIXES = Object.freeze(['V46', 'V43', 'V42', 'V41']);
const LEGACY_KEYS = Object.freeze(LEGACY_BASE_KEYS.flatMap(base => LEGACY_SUFFIXES.map(suffix => `${base}${suffix}`)));
const STATE_KEYS = Object.freeze([
  'currentYear', 'isLandscapeMode', 'isClockVisible', 'isWakeLockRequested', 'scheduleData', 'configEvents',
  'configWeekly', 'customHolidays', 'noClassData', 'shortData', 'examData', 'timeConfig', 'globalTaskData',
  'bulkCalendarSelectionMode', 'countSettings', 'countDateRange', 'daySlotConfig'
]);
const SLOT_SET = new Set(APP_CONFIG.slotsAll);
const TIME_GROUPS = Object.freeze(['normal', 'short', 'exam']);
const SAFE_TAGS = new Set(['BR', 'B', 'STRONG', 'SPAN', 'DIV', 'P']);
const REMOVE_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH']);
const REMOVE_ELEMENT_TAGS = new Set(['IMG']);

function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function defaultDaySlotConfig() {
  const result = {};
  for (let day = 0; day < 7; day += 1) {
    result[day] = {};
    APP_CONFIG.slotsAll.forEach(slot => {
      if (day === 0) result[day][slot] = false;
      else if (day === 6) result[day][slot] = !['昼休み', '５限', '６限', '７限'].includes(slot);
      else result[day][slot] = true;
    });
  }
  return result;
}

export function defaultTimeConfig() {
  return clone(APP_CONFIG.defaultTime);
}

export function defaultState(year = 2026) {
  return {
    currentYear: year,
    isLandscapeMode: false,
    isClockVisible: true,
    isWakeLockRequested: false,
    scheduleData: {},
    configEvents: {},
    configWeekly: {},
    customHolidays: clone(APP_CONFIG.defaultHolidays),
    noClassData: {},
    shortData: {},
    examData: {},
    timeConfig: defaultTimeConfig(),
    globalTaskData: '',
    bulkCalendarSelectionMode: 'standard',
    countSettings: [{ word: '', mode: 'down', start: 1 }],
    countDateRange: { start: '', end: '' },
    daySlotConfig: defaultDaySlotConfig()
  };
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function validTime(value) {
  return typeof value === 'string' && (value === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function escapeTextPreservingEntities(value) {
  return String(value)
    .replace(/&(?!#\d{1,7};|#x[0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeHtmlText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '&#10;');
}

function safeStyle(value) {
  if (typeof value !== 'string' || /url\s*\(|expression\s*\(|@import|[<>]/i.test(value)) return '';
  const allowed = [];
  value.split(';').forEach(part => {
    const colon = part.indexOf(':');
    if (colon < 1) return;
    const property = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    if (!['font-weight', 'color', 'background-color', 'background', 'text-decoration'].includes(property)) return;
    if (!/^[#(),.%\s\w-]+$/i.test(val)) return;
    if (property === 'font-weight' && !/^(normal|bold|[1-9]00)$/i.test(val)) return;
    if (property === 'text-decoration' && !/^(none|line-through(?:\s+double)?)$/i.test(val)) return;
    allowed.push(`${property}:${val}`);
  });
  return allowed.join(';');
}

function sanitizeDomTree(root) {
  let node = root.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (node.nodeType === 8) {
      root.removeChild(node);
      node = next;
      continue;
    }
    if (node.nodeType !== 1) {
      node = next;
      continue;
    }
    const tag = node.tagName.toUpperCase();
    if (REMOVE_CONTENT_TAGS.has(tag) || REMOVE_ELEMENT_TAGS.has(tag)) {
      root.removeChild(node);
      node = next;
      continue;
    }
    if (!SAFE_TAGS.has(tag)) {
      // Unwrap and then recurse over the newly exposed descendants.  The
      // recursion is intentional: a single children snapshot is not enough
      // for nested hostile markup.
      while (node.firstChild) root.insertBefore(node.firstChild, node);
      root.removeChild(node);
      sanitizeDomTree(root);
      node = next;
      continue;
    }
    Array.from(node.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'href' || name === 'src' || name === 'srcdoc' || name === 'action' || name === 'formaction') {
        node.removeAttribute(attribute.name);
        return;
      }
      if (tag === 'SPAN' && name === 'style') {
        const style = safeStyle(attribute.value);
        if (style) node.setAttribute('style', style); else node.removeAttribute(attribute.name);
        return;
      }
      if (tag === 'SPAN' && name === 'class') {
        const classes = attribute.value.split(/\s+/).filter(Boolean);
        const state = classes.find(item => /^state-[0-3]$/.test(item));
        if (classes.includes('todo-badge') && state) node.setAttribute('class', `todo-badge ${state}`);
        else node.removeAttribute(attribute.name);
        return;
      }
      if (tag === 'SPAN' && name === 'data-state') {
        if (/^[0-3]$/.test(attribute.value) && node.classList.contains('todo-badge')) node.setAttribute('data-state', attribute.value);
        else node.removeAttribute(attribute.name);
        return;
      }
      node.removeAttribute(attribute.name);
    });
    if (tag !== 'SPAN' || !node.classList.contains('todo-badge')) node.removeAttribute('data-state');
    sanitizeDomTree(node);
    node = next;
  }
}

function parseFallbackTag(raw) {
  const match = raw.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)([\s\S]*?)\s*(\/?)>$/);
  if (!match) return null;
  return { closing: Boolean(match[1]), name: match[2].toUpperCase(), attributes: match[3], selfClosing: Boolean(match[4]) };
}

function fallbackAttributes(raw, tag) {
  if (tag !== 'SPAN') return '';
  const attrs = [];
  const matcher = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  let className = '';
  let state = '';
  let style = '';
  while ((match = matcher.exec(raw))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name === 'class') className = value;
    else if (name === 'data-state') state = value;
    else if (name === 'style') style = safeStyle(value);
  }
  const stateClass = className.split(/\s+/).find(item => /^state-[0-3]$/.test(item));
  if (className.split(/\s+/).includes('todo-badge') && stateClass) {
    attrs.push(`class="todo-badge ${stateClass}"`);
    if (/^[0-3]$/.test(state)) attrs.push(`data-state="${state}"`);
  }
  if (style) attrs.push(`style="${escapeHtmlAttribute(style)}"`);
  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

function fallbackSanitizeHtml(value) {
  const input = String(value ?? '');
  const tokens = input.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) || [];
  const output = [];
  const stack = [];
  let suppressed = 0;
  tokens.forEach(token => {
    if (token.startsWith('<!--')) return;
    if (token.startsWith('<')) {
      const parsed = parseFallbackTag(token);
      if (!parsed) {
        if (!suppressed) output.push(escapeTextPreservingEntities(token));
        return;
      }
      if (parsed.closing) {
        let index = stack.length - 1;
        while (index >= 0 && stack[index].name !== parsed.name) index -= 1;
        if (index < 0) return;
        const found = stack.splice(index).reverse();
        found.forEach(item => {
          if (item.suppressed) suppressed -= 1;
          if (item.allowed && item.name === parsed.name && !item.selfClosing) output.push(`</${item.name.toLowerCase()}>`);
        });
        return;
      }
      const suppressedTag = REMOVE_CONTENT_TAGS.has(parsed.name);
      const removedTag = REMOVE_ELEMENT_TAGS.has(parsed.name);
      const allowed = SAFE_TAGS.has(parsed.name);
      const selfClosing = parsed.selfClosing || parsed.name === 'BR';
      stack.push({ name: parsed.name, suppressed: suppressedTag, allowed: allowed && !removedTag, selfClosing });
      if (suppressedTag) suppressed += 1;
      if (suppressed || removedTag) return;
      if (parsed.name === 'BR') output.push('<br>');
      else if (allowed) output.push(`<${parsed.name.toLowerCase()}${fallbackAttributes(parsed.attributes, parsed.name)}>`);
      return;
    }
    if (!suppressed) output.push(escapeTextPreservingEntities(token));
  });
  return output.join('');
}

export function sanitizeHtml(value) {
  if (value === null || value === undefined || value === '') return '';
  const input = String(value);
  if (typeof globalThis.DOMParser === 'function') {
    const doc = new globalThis.DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');
    const root = doc.body;
    sanitizeDomTree(root);
    return root.innerHTML;
  }
  return fallbackSanitizeHtml(input);
}

function decodeBasicEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

export function stripHtml(value) {
  const safe = sanitizeHtml(value);
  if (typeof globalThis.DOMParser === 'function') {
    const doc = new globalThis.DOMParser().parseFromString(`<body>${safe}</body>`, 'text/html');
    return doc.body.textContent || '';
  }
  return decodeBasicEntities(safe.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}

export function extractTodoItems(value) {
  const safe = sanitizeHtml(value);
  const result = [];
  if (typeof globalThis.DOMParser === 'function') {
    const doc = new globalThis.DOMParser().parseFromString(`<body>${safe}</body>`, 'text/html');
    doc.body.querySelectorAll('span.todo-badge').forEach(badge => {
      const state = badge.getAttribute('data-state');
      if (!/^[0-3]$/.test(state) || state === '2') return;
      let text = '';
      let current = badge.nextSibling;
      while (current) {
        if (current.nodeType === 1) {
          const tag = current.tagName.toUpperCase();
          if (tag === 'BR' || tag === 'DIV' || tag === 'P' || current.matches('span.todo-badge')) break;
          text += current.textContent || '';
        } else if (current.nodeType === 3) {
          text += current.nodeValue.replace(/\u200B/g, '');
        }
        current = current.nextSibling;
      }
      result.push({ state: Number(state), text: text.trim() || '(タスク名なし)' });
    });
    return result;
  }
  const badgeMatcher = /<span\b([^>]*\bclass="[^"]*\btodo-badge\b[^"]*"[^>]*)>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = badgeMatcher.exec(safe))) {
    const stateMatch = match[1].match(/\bdata-state="([0-3])"/i);
    if (!stateMatch || stateMatch[1] === '2') continue;
    const tail = safe.slice(match.index + match[0].length).split(/<br\b|<div\b|<p\b|<span\b[^>]*todo-badge/i)[0];
    result.push({ state: Number(stateMatch[1]), text: stripHtml(tail).replace(/\u200B/g, '').trim() || '(タスク名なし)' });
  }
  return result;
}

function fail(message, field = '') {
  return { ok: false, error: field ? `${field}: ${message}` : message };
}

function expectBoolean(value, field) {
  return typeof value === 'boolean' ? null : fail('boolean値が必要です', field);
}

function normalizeDateMap(value, field, stateValidator = null) {
  if (!isPlainObject(value)) return fail('オブジェクトが必要です', field);
  const result = {};
  for (const [dateId, raw] of Object.entries(value)) {
    if (!isValidIsoDate(dateId)) return fail('実在するISO日付が必要です', `${field}.${dateId}`);
    if (stateValidator) {
      if (!Number.isInteger(raw) || !stateValidator(raw)) return fail('不正な状態値です', `${field}.${dateId}`);
      result[dateId] = raw;
    } else {
      if (typeof raw !== 'string') return fail('文字列が必要です', `${field}.${dateId}`);
      result[dateId] = sanitizeHtml(raw);
    }
  }
  return { ok: true, value: result };
}

function normalizeSchedule(value) {
  if (!isPlainObject(value)) return fail('オブジェクトが必要です', 'scheduleData');
  const result = {};
  for (const [dateId, rawDay] of Object.entries(value)) {
    if (!isValidIsoDate(dateId)) return fail('実在するISO日付が必要です', `scheduleData.${dateId}`);
    if (!isPlainObject(rawDay)) return fail('日単位のオブジェクトが必要です', `scheduleData.${dateId}`);
    const rawSlots = own(rawDay, 'slots') ? rawDay.slots : rawDay;
    if (!isPlainObject(rawSlots)) return fail('slotsオブジェクトが必要です', `scheduleData.${dateId}.slots`);
    const slots = {};
    for (const [slot, value] of Object.entries(rawSlots)) {
      if (!SLOT_SET.has(slot)) return fail('未知の時限です', `scheduleData.${dateId}.${slot}`);
      if (typeof value !== 'string') return fail('文字列が必要です', `scheduleData.${dateId}.${slot}`);
      slots[slot] = sanitizeHtml(value);
    }
    result[dateId] = { slots };
  }
  return { ok: true, value: result };
}

function normalizeWeekly(value) {
  if (!isPlainObject(value)) return fail('オブジェクトが必要です', 'configWeekly');
  const result = {};
  for (const [day, rawSlots] of Object.entries(value)) {
    if (!/^[0-6]$/.test(day) || !isPlainObject(rawSlots)) return fail('曜日または曜日データが不正です', `configWeekly.${day}`);
    result[day] = {};
    for (const [slot, raw] of Object.entries(rawSlots)) {
      if (!SLOT_SET.has(slot)) return fail('未知の時限です', `configWeekly.${day}.${slot}`);
      if (typeof raw !== 'string') return fail('文字列が必要です', `configWeekly.${day}.${slot}`);
      result[day][slot] = sanitizeHtml(raw);
    }
  }
  return { ok: true, value: result };
}

function normalizeTimeConfig(value) {
  if (!isPlainObject(value)) return fail('オブジェクトが必要です', 'timeConfig');
  const result = defaultTimeConfig();
  for (const group of TIME_GROUPS) {
    if (!own(value, group)) continue;
    if (!isPlainObject(value[group])) return fail('時程グループが不正です', `timeConfig.${group}`);
    for (const [slot, raw] of Object.entries(value[group])) {
      if (!SLOT_SET.has(slot)) return fail('未知の時限です', `timeConfig.${group}.${slot}`);
      if (!validTime(raw)) return fail('HH:MM形式または空文字が必要です', `timeConfig.${group}.${slot}`);
      result[group][slot] = raw;
    }
  }
  for (const key of Object.keys(value)) if (!TIME_GROUPS.includes(key)) return fail('未知の時程グループです', `timeConfig.${key}`);
  return { ok: true, value: result };
}

function normalizeDaySlotConfig(value) {
  if (!isPlainObject(value)) return fail('オブジェクトが必要です', 'daySlotConfig');
  const result = defaultDaySlotConfig();
  for (const [day, rawSlots] of Object.entries(value)) {
    if (!/^[0-6]$/.test(day) || !isPlainObject(rawSlots)) return fail('曜日または曜日データが不正です', `daySlotConfig.${day}`);
    for (const [slot, raw] of Object.entries(rawSlots)) {
      if (!SLOT_SET.has(slot)) return fail('未知の時限です', `daySlotConfig.${day}.${slot}`);
      if (typeof raw !== 'boolean') return fail('boolean値が必要です', `daySlotConfig.${day}.${slot}`);
      result[day][slot] = raw;
    }
  }
  for (const day of Object.keys(value)) for (const slot of APP_CONFIG.slotsAll) if (!own(value[day], slot)) result[day][slot] = result[day][slot];
  return { ok: true, value: result };
}

function normalizeCountSettings(value) {
  if (!Array.isArray(value)) return fail('配列が必要です', 'countSettings');
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isPlainObject(item)) return fail('設定オブジェクトが必要です', `countSettings[${index}]`);
    if (typeof item.word !== 'string' || !['up', 'down'].includes(item.mode) || !Number.isInteger(item.start) || item.start < 0 || item.start > 99999) {
      return fail('word/mode/startが不正です', `countSettings[${index}]`);
    }
    result.push({ word: item.word, mode: item.mode, start: item.start });
  }
  return { ok: true, value: result.length ? result : [{ word: '', mode: 'down', start: 1 }] };
}

function normalizeCountDateRange(value) {
  if (value === null) return { ok: true, value: { start: '', end: '' } };
  if (!isPlainObject(value)) return fail('オブジェクトが必要です', 'countDateRange');
  const start = own(value, 'start') ? value.start : '';
  const end = own(value, 'end') ? value.end : '';
  if (typeof start !== 'string' || typeof end !== 'string') return fail('文字列が必要です', 'countDateRange');
  if ((start !== '' && !isValidIsoDate(start)) || (end !== '' && !isValidIsoDate(end))) return fail('実在するISO日付が必要です', 'countDateRange');
  if (start && end && start > end) return fail('開始日と終了日の順序が不正です', 'countDateRange');
  return { ok: true, value: { start, end } };
}

function validateStateConflicts(state) {
  const dates = new Set([...Object.keys(state.noClassData), ...Object.keys(state.shortData), ...Object.keys(state.examData)]);
  for (const dateId of dates) {
    const active = [state.noClassData[dateId] > 0, state.shortData[dateId] > 0, state.examData[dateId] > 0].filter(Boolean).length;
    if (active > 1) return fail('同一日の状態が競合しています', dateId);
  }
  return { ok: true };
}

export function normalizeState(input) {
  if (!isPlainObject(input)) return fail('state/dataオブジェクトが必要です');
  const state = defaultState();
  if (own(input, 'currentYear') && own(input, 'academicYear') && input.currentYear !== input.academicYear) return fail('currentYearとacademicYearが競合しています');
  const year = own(input, 'currentYear') ? input.currentYear : input.academicYear;
  if (year !== undefined) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail('2000〜2100の整数年度が必要です', 'currentYear');
    state.currentYear = year;
  }
  const booleanFields = ['isLandscapeMode', 'isClockVisible', 'isWakeLockRequested'];
  for (const field of booleanFields) {
    if (!own(input, field)) continue;
    const error = expectBoolean(input[field], field);
    if (error) return error;
    state[field] = input[field];
  }
  if (own(input, 'bulkCalendarSelectionMode')) {
    if (!['standard', 'additive'].includes(input.bulkCalendarSelectionMode)) return fail('standard/additiveのいずれかが必要です', 'bulkCalendarSelectionMode');
    state.bulkCalendarSelectionMode = input.bulkCalendarSelectionMode;
  }
  if (own(input, 'scheduleData') && own(input, 'teacherSchedule') && JSON.stringify(input.scheduleData) !== JSON.stringify(input.teacherSchedule)) return fail('scheduleDataとteacherScheduleが競合しています');
  const scheduleInput = own(input, 'scheduleData') ? input.scheduleData : input.teacherSchedule;
  if (scheduleInput !== undefined) {
    const normalized = normalizeSchedule(scheduleInput);
    if (!normalized.ok) return normalized;
    state.scheduleData = normalized.value;
  }
  for (const [field, validator] of [['configEvents', value => normalizeDateMap(value, 'configEvents')], ['customHolidays', value => normalizeDateMap(value, 'customHolidays')]]) {
    if (!own(input, field)) continue;
    const normalized = validator(input[field]);
    if (!normalized.ok) return normalized;
    state[field] = normalized.value;
  }
  for (const [field, maximum] of [['noClassData', 2], ['shortData', 3], ['examData', 2]]) {
    if (!own(input, field)) continue;
    const normalized = normalizeDateMap(input[field], field, value => value >= 0 && value <= maximum);
    if (!normalized.ok) return normalized;
    state[field] = normalized.value;
  }
  if (own(input, 'configWeekly')) {
    const normalized = normalizeWeekly(input.configWeekly);
    if (!normalized.ok) return normalized;
    state.configWeekly = normalized.value;
  }
  if (own(input, 'timeConfig')) {
    const normalized = normalizeTimeConfig(input.timeConfig);
    if (!normalized.ok) return normalized;
    state.timeConfig = normalized.value;
  }
  if (own(input, 'globalTaskData')) {
    if (typeof input.globalTaskData !== 'string') return fail('文字列が必要です', 'globalTaskData');
    state.globalTaskData = sanitizeHtml(input.globalTaskData);
  }
  if (own(input, 'countSettings')) {
    const normalized = normalizeCountSettings(input.countSettings);
    if (!normalized.ok) return normalized;
    state.countSettings = normalized.value;
  }
  if (own(input, 'countDateRange')) {
    const normalized = normalizeCountDateRange(input.countDateRange);
    if (!normalized.ok) return normalized;
    state.countDateRange = normalized.value;
  }
  if (own(input, 'daySlotConfig')) {
    const normalized = normalizeDaySlotConfig(input.daySlotConfig);
    if (!normalized.ok) return normalized;
    state.daySlotConfig = normalized.value;
  }
  const conflict = validateStateConflicts(state);
  if (!conflict.ok) return conflict;
  return { ok: true, value: state };
}

function validateMeta(meta) {
  if (!isPlainObject(meta)) return fail('metaオブジェクトが必要です', 'meta');
  const maximumLegacyVersion = Number(APP_CONFIG.compatibilityVersion);
  const hasLegacyVersion = own(meta, 'version');
  const legacyVersionIsSupported = hasLegacyVersion
    && Number.isInteger(meta.version)
    && meta.version >= 1
    && meta.version <= maximumLegacyVersion;
  if (hasLegacyVersion && !legacyVersionIsSupported) return fail(`互換用versionは1〜${maximumLegacyVersion}の整数が必要です`, 'meta.version');
  let schemaVersion = meta.schemaVersion;
  if (schemaVersion === undefined) {
    if (hasLegacyVersion) schemaVersion = 1;
    else return fail('schemaVersionが必要です', 'meta.schemaVersion');
  }
  if (!Number.isInteger(schemaVersion) || !APP_CONFIG.supportedSchemaVersions.includes(schemaVersion)) return fail('未対応のschemaVersionです', 'meta.schemaVersion');
  for (const field of ['appVersion', 'compatibilityVersion', 'buildVersion', 'format']) {
    if (own(meta, field) && typeof meta[field] !== 'string') return fail('文字列が必要です', `meta.${field}`);
  }
  if (own(meta, 'lastUpdated') && (typeof meta.lastUpdated !== 'string' || Number.isNaN(Date.parse(meta.lastUpdated)))) return fail('ISO日時が必要です', 'meta.lastUpdated');
  return { ok: true, schemaVersion };
}

export function normalizeImportedPayload(rawOrObject) {
  let parsed = rawOrObject;
  if (typeof rawOrObject === 'string') {
    if (!rawOrObject.trim()) return fail('空のJSONです');
    try {
      parsed = JSON.parse(rawOrObject);
    } catch {
      return fail('JSONを解析できません');
    }
  }
  if (!isPlainObject(parsed)) return fail('JSONオブジェクトが必要です');
  let data = parsed;
  let schemaVersion = 1;
  if (own(parsed, 'meta')) {
    if (!own(parsed, 'data') || !isPlainObject(parsed.data)) return fail('wrapped形式のdataが不正です');
    const metaResult = validateMeta(parsed.meta);
    if (!metaResult.ok) return metaResult;
    data = parsed.data;
    schemaVersion = metaResult.schemaVersion;
  } else if (own(parsed, 'data')) {
    return fail('metaを含むwrapped形式が不正です');
  }
  const recognized = STATE_KEYS.some(key => own(data, key)) || own(data, 'teacherSchedule') || own(data, 'academicYear');
  if (!recognized) return fail('TaskKanriの既知形式ではありません');
  const normalized = normalizeState(data);
  if (!normalized.ok) return normalized;
  return { ok: true, value: normalized.value, schemaVersion, source: own(parsed, 'meta') ? 'wrapped' : 'flat' };
}

export function summarizeState(state) {
  return {
    currentYear: state.currentYear,
    scheduleDays: Object.keys(state.scheduleData).length,
    eventDays: Object.keys(state.configEvents).length,
    holidayDays: Object.keys(state.customHolidays).length,
    weeklyEntries: Object.values(state.configWeekly).reduce((total, slots) => total + Object.keys(slots).length, 0),
    countSettings: state.countSettings.length
  };
}

export function formatStateSummary(summary) {
  return `年度 ${summary.currentYear} / 予定 ${summary.scheduleDays}日 / 行事 ${summary.eventDays}日 / 祝日 ${summary.holidayDays}日 / 週間設定 ${summary.weeklyEntries}件 / 時数条件 ${summary.countSettings}件`;
}

export function serializePayload(state, now = new Date()) {
  const normalized = normalizeState(state);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    value: {
      meta: {
        format: 'taskkanri-backup',
        appVersion: APP_CONFIG.displayVersion,
        compatibilityVersion: APP_CONFIG.compatibilityVersion,
        buildVersion: APP_CONFIG.buildVersion,
        schemaVersion: APP_CONFIG.schemaVersion,
        lastUpdated: now.toISOString()
      },
      data: normalized.value
    }
  };
}

function storageKeys(storage) {
  const result = [];
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return result;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key === 'string') result.push(key);
  }
  return result;
}

function timestamp(options) {
  const now = typeof options.now === 'function' ? options.now() : new Date();
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function safeJsonParse(raw) {
  try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false }; }
}

function isOwnedKey(key) {
  return key === APP_CONFIG.storeKey || key === APP_CONFIG.readOnlyGuardKey || key.startsWith(APP_CONFIG.quarantinePrefix) || key.startsWith(APP_CONFIG.recoveryPrefix) || LEGACY_KEYS.includes(key);
}

export function taskKanriOwnedKeys(storage) {
  return storageKeys(storage).filter(isOwnedKey);
}

function createUniqueKey(storage, prefix, iso) {
  const stem = `${prefix}${iso.replace(/[^0-9]/g, '')}`;
  let key = stem;
  let suffix = 1;
  while (storage.getItem(key) !== null) {
    key = `${stem}_${suffix}`;
    suffix += 1;
  }
  return key;
}

function legacyValue(storage, base) {
  for (const suffix of LEGACY_SUFFIXES) {
    const key = `${base}${suffix}`;
    const raw = storage.getItem(key);
    if (raw !== null) return { key, raw };
  }
  return null;
}

function readLegacyState(storage, options, quarantine) {
  const flat = {};
  let found = false;
  const jsonFields = new Set(LEGACY_BASE_KEYS.filter(key => key !== 'globalTaskData'));
  for (const base of LEGACY_BASE_KEYS) {
    const item = legacyValue(storage, base);
    if (!item) continue;
    found = true;
    if (base === 'globalTaskData') {
      const parsed = safeJsonParse(item.raw);
      flat[base] = parsed.ok && typeof parsed.value === 'string' ? parsed.value : item.raw;
      continue;
    }
    if (!jsonFields.has(base)) continue;
    const parsed = safeJsonParse(item.raw);
    if (!parsed.ok) {
      const result = quarantine(item.key, item.raw, '旧形式JSONを解析できません');
      if (!result.ok) return { ok: false, readOnly: true, error: result.error };
      continue;
    }
    flat[base] = parsed.value;
  }
  if (!found) return { ok: true, found: false, value: defaultState() };
  const normalized = normalizeState(flat);
  if (!normalized.ok) return { ok: false, readOnly: false, error: normalized.error };
  return { ok: true, found: true, value: normalized.value };
}

export function createStorageService(storage, options = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new TypeError('StorageLikeが必要です');
  let state = null;
  let readOnly = false;
  let readOnlyReason = '';

  function setReadOnly(reason) {
    readOnly = true;
    readOnlyReason = reason;
    try { storage.setItem(APP_CONFIG.readOnlyGuardKey, JSON.stringify({ reason, at: timestamp(options) })); } catch { /* the in-memory hard guard remains active */ }
  }

  function existingGuard() {
    const raw = storage.getItem(APP_CONFIG.readOnlyGuardKey);
    if (raw === null) return null;
    const parsed = safeJsonParse(raw);
    return parsed.ok && isPlainObject(parsed.value) ? parsed.value : { reason: '読み取り専用ガードが破損しています' };
  }

  function quarantine(sourceKey, raw, reason) {
    const key = createUniqueKey(storage, APP_CONFIG.quarantinePrefix, timestamp(options));
    const record = { sourceKey, quarantinedAt: timestamp(options), reason, raw };
    try {
      storage.setItem(key, JSON.stringify(record));
      return { ok: true, key };
    } catch {
      setReadOnly(`隔離データを書き込めないため読み取り専用です: ${reason}`);
      return { ok: false, error: '破損データの隔離に失敗しました。元データは保持され、読み取り専用になりました。' };
    }
  }

  function saveAll(candidate = state) {
    if (readOnly) return { ok: false, error: `読み取り専用相当です: ${readOnlyReason}` };
    const normalized = normalizeState(candidate);
    if (!normalized.ok) return normalized;
    const serialized = serializePayload(normalized.value, typeof options.now === 'function' ? options.now() : new Date());
    if (!serialized.ok) return serialized;
    try {
      storage.setItem(APP_CONFIG.storeKey, JSON.stringify(serialized.value));
    } catch {
      setReadOnly('データの保存に失敗したため読み取り専用です');
      return { ok: false, error: 'データの保存に失敗しました。現在のデータは変更されていません。' };
    }
    state = clone(normalized.value);
    return { ok: true, state: clone(state) };
  }

  function load() {
    const guard = existingGuard();
    if (guard) {
      readOnly = true;
      readOnlyReason = String(guard.reason || '保存ガードが有効です');
    }
    const raw = storage.getItem(APP_CONFIG.storeKey);
    if (raw !== null) {
      const parsed = normalizeImportedPayload(raw);
      if (parsed.ok) {
        state = clone(parsed.value);
        return { ok: true, state: clone(state), source: 'master', readOnly, readOnlyReason };
      }
      const isolated = quarantine(APP_CONFIG.storeKey, raw, parsed.error);
      if (!isolated.ok) {
        state = defaultState();
        return { ok: true, state: clone(state), source: 'defaults-read-only', quarantined: false, readOnly: true, readOnlyReason };
      }
      try { storage.removeItem(APP_CONFIG.storeKey); } catch {
        setReadOnly('隔離後に破損masterを除去できないため読み取り専用です');
        state = defaultState();
        return { ok: true, state: clone(state), source: 'defaults-read-only', quarantined: true, readOnly: true, readOnlyReason };
      }
    }
    const legacy = readLegacyState(storage, options, quarantine);
    if (!legacy.ok) {
      if (legacy.readOnly) {
        state = defaultState();
        return { ok: true, state: clone(state), source: 'defaults-read-only', readOnly: true, readOnlyReason };
      }
      state = defaultState();
    } else {
      state = clone(legacy.value);
    }
    if (!readOnly) {
      const saved = saveAll(state);
      if (!saved.ok) return { ok: true, state: clone(state), source: legacy.found ? 'legacy-unsaved' : 'defaults-unsaved', readOnly: true, readOnlyReason };
    }
    return { ok: true, state: clone(state), source: legacy.found ? 'legacy' : 'defaults', readOnly, readOnlyReason };
  }

  function createRecoverySnapshot() {
    if (readOnly) return { ok: false, error: `読み取り専用相当です: ${readOnlyReason}` };
    const key = createUniqueKey(storage, APP_CONFIG.recoveryPrefix, timestamp(options));
    const record = { createdAt: timestamp(options), sourceKey: APP_CONFIG.storeKey, raw: storage.getItem(APP_CONFIG.storeKey), state: clone(state) };
    try {
      storage.setItem(key, JSON.stringify(record));
      return { ok: true, key };
    } catch {
      return { ok: false, error: '復旧snapshotを作成できないため、インポートを中止しました。' };
    }
  }

  function importRaw(raw, { confirm = null } = {}) {
    if (readOnly) return { ok: false, error: `読み取り専用相当です: ${readOnlyReason}` };
    const prepared = normalizeImportedPayload(raw);
    if (!prepared.ok) return prepared;
    const summary = summarizeState(prepared.value);
    if (typeof confirm === 'function' && !confirm(summary, prepared.value)) return { ok: false, cancelled: true, summary };
    const snapshot = createRecoverySnapshot();
    if (!snapshot.ok) return snapshot;
    const serialized = serializePayload(prepared.value, typeof options.now === 'function' ? options.now() : new Date());
    if (!serialized.ok) return serialized;
    try {
      storage.setItem(APP_CONFIG.storeKey, JSON.stringify(serialized.value));
    } catch {
      return { ok: false, error: 'インポートデータの保存に失敗しました。現行データは変更されていません。', snapshotKey: snapshot.key };
    }
    state = clone(prepared.value);
    return { ok: true, state: clone(state), summary, snapshotKey: snapshot.key };
  }

  function reset() {
    const targets = new Set([...LEGACY_KEYS, APP_CONFIG.storeKey, APP_CONFIG.readOnlyGuardKey, ...storageKeys(storage).filter(key => key.startsWith(APP_CONFIG.quarantinePrefix) || key.startsWith(APP_CONFIG.recoveryPrefix))]);
    const removed = [];
    const failed = [];
    for (const key of targets) {
      try {
        storage.removeItem(key);
        removed.push(key);
      } catch (error) {
        failed.push({ key, error: String(error?.message || error) });
      }
    }
    if (failed.length) {
      return { ok: false, removed, failed, error: 'TaskKanriデータの一部を削除できませんでした。' };
    }
    readOnly = false;
    readOnlyReason = '';
    state = defaultState();
    return { ok: true, removed, failed: [] };
  }

  function getQuarantineRecords() {
    return storageKeys(storage).filter(key => key.startsWith(APP_CONFIG.quarantinePrefix)).map(key => {
      const raw = storage.getItem(key);
      const parsed = safeJsonParse(raw);
      return { key, record: parsed.ok ? parsed.value : { raw, reason: '隔離記録自体を解析できません' } };
    });
  }

  function deleteQuarantine(key) {
    if (typeof key !== 'string' || !key.startsWith(APP_CONFIG.quarantinePrefix)) return { ok: false, error: '隔離キーが不正です' };
    try { storage.removeItem(key); return { ok: true, key }; } catch { return { ok: false, error: '隔離データを削除できませんでした' }; }
  }

  return {
    load,
    saveAll,
    importRaw,
    createRecoverySnapshot,
    reset,
    getState: () => clone(state),
    isReadOnly: () => readOnly,
    readOnlyReason: () => readOnlyReason,
    getQuarantineRecords,
    deleteQuarantine,
    ownedKeys: () => taskKanriOwnedKeys(storage)
  };
}

export const LEGACY_STORAGE_KEYS = LEGACY_KEYS;
