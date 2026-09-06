import {
  APP_CONFIG as CORE_CONFIG,
  academicYearBounds,
  clone,
  createStorageService,
  defaultState,
  escapeHtmlAttribute,
  escapeHtmlText,
  extractTodoItems,
  getResolvedSlot,
  getSlotOrigin,
  getWeeklyRuleSlot,
  HistoryManager,
  formatStateSummary,
  getDateSchedulePolicy,
  getHolidayName,
  isEffectiveHoliday,
  isSlotVisibleForDate,
  isValidIsoDate,
  normalizeImportedPayload,
  applyAcademicYearRollover,
  planAcademicYearChange,
  planAcademicYearRollover,
  replaceWeeklyRuleRange,
  sanitizeHtml,
  serializePayload,
  stripHtml,
  weekdayForDateId
} from './taskkanri-core.mjs?v=20260907-bulk-calendar-layout-v2';

const APP_CONFIG = CORE_CONFIG;
const PERIOD_SLOTS = new Set(['１限', '２限', '３限', '４限', '５限', '６限', '７限']);
let appState = defaultState();
let storageService;
let storageLike;
let currentMainDateId = '';
let activePanels = { top: '', 'bottom-left': '', 'bottom-right': '' };
let currentSearchKeywords = [];
let currentSearchMode = 'day';
let savedScrollPosition = 0;
let bulkCalendarSelection = new Set();
let bulkCalendarRangeAnchor = '';
let bulkCalendarInvoker = null;
let bulkCalendarUndoSnapshot = null;
let bulkCalendarStatus = '';
let bulkCalendarContextMenuInvoker = null;
let bulkCalendarContextDateId = '';
let dateListContextDateId = '';
let dateListContextInvoker = null;
let previewCountData = [];
let currentCountMode = 'list';
let countDragState = null;
let wakeLock = null;
let titleBlinkerId = null;
let initialized = false;
const historyManager = new HistoryManager();
const settingsDirtySections = new Set();
let isHydratingSettings = false;
let academicYearRolloverInvoker = null;

function q(selector, root = document) { return root.querySelector(selector); }
function qa(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }
function el(tag, text = undefined) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function setStyle(node, style) { Object.assign(node.style, style); return node; }
function getDayProfile(dateId, state = appState) { return state.dayProfiles?.[dateId] || 'normal'; }
function getIsoDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateFromIso(dateId) {
  if (!isValidIsoDate(dateId)) return null;
  const date = new Date(Number(dateId.slice(0, 4)), Number(dateId.slice(5, 7)) - 1, Number(dateId.slice(8, 10)));
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDateInfo(date) {
  return {
    id: getIsoDateStr(date),
    label: `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${APP_CONFIG.daysStr[date.getDay()]}`
  };
}
function toYYMMDD(dateId) { return dateId.replace(/-/g, '').slice(2); }
function fromYYMMDD(value) {
  const digits = String(value ?? '').replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  if (!/^\d{6}$/.test(digits)) return null;
  const dateId = `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  return isValidIsoDate(dateId) ? dateId : null;
}
function getDisplaySlot(slot) {
  if (slot === '昼休み') return '昼';
  if (slot === '放課後') return '放課';
  return slot;
}
function getActiveSlotsForDate(dateId) {
  return APP_CONFIG.slotsAll.filter(slot => isSlotVisibleForDate(dateId, slot, appState));
}
function holidayName(dateId, state = appState) { return getHolidayName(dateId, state); }
function scheduleSlots(dateId, state = appState) { return Object.fromEntries(APP_CONFIG.slotsAll.map(slot => [slot, getResolvedSlot(dateId, slot, state)])); }
function resolvedSlot(dateId, slot, state = appState) { return getResolvedSlot(dateId, slot, state); }
function academicDateIds(state = appState) {
  const bounds = academicYearBounds(state.currentYear); const result = []; let date = dateFromIso(bounds.start);
  while (date && getIsoDateStr(date) <= bounds.end) { result.push(getIsoDateStr(date)); date.setDate(date.getDate() + 1); }
  return result;
}
function isAcademicDate(dateId) { const bounds = academicYearBounds(appState.currentYear); return isValidIsoDate(dateId) && dateId >= bounds.start && dateId <= bounds.end; }
function getDayStateVisual(dateId) {
  const display = {
    'noclass-hide': ['day-state-noclass', '無', '授業なし（授業枠を隠す）'], 'noclass-show': ['day-state-noclass', '無・表', '授業なし（授業枠を表示・時数には数えない）'],
    exam: ['day-state-exam', '考', '定期考査'], 'mock-exam': ['day-state-exam', '模試', '模擬試験'],
    short: ['day-state-short', '短', '短縮時程'], 'short-am': ['day-state-short', '短AM', '短縮AM'], morning: ['day-state-short', '午前', '午前時程'],
    normal: ['', '', '通常授業']
  };
  const policy = getDateSchedulePolicy(dateId, appState);
  if (policy.isFixedOffActive) return { className: 'day-state-fixed-off', shortLabel: '', label: '固定休業日' };
  const [className, shortLabel, label] = display[policy.profile];
  return { className, shortLabel, label };
}
function getDayBgClass(dateId) {
  const date = dateFromIso(dateId);
  if (!date) return '';
  const policy = getDateSchedulePolicy(dateId, appState);
  const profile = policy.profile;
  if (profile.startsWith('noclass')) return 'bg-no-class';
  if (profile === 'exam' || profile === 'mock-exam') return 'bg-exam';
  if (['short', 'short-am', 'morning'].includes(profile)) return 'bg-short';
  if (holidayName(dateId) || date.getDay() === 0) return 'bg-sun-hol';
  if (date.getDay() === 6) return 'bg-sat';
  if (policy.isFixedOffActive) return 'bg-fixed-off';
  return '';
}
function getSmartDateRange() {
  const today = new Date();
  let end = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate());
  const expectedMonth = (today.getMonth() + 3) % 12;
  if (end.getMonth() !== expectedMonth) end = new Date(today.getFullYear(), today.getMonth() + 4, 0);
  const academicEnd = new Date(appState.currentYear + 1, 2, 31);
  if (end > academicEnd) end = academicEnd;
  return { start: getIsoDateStr(today), end: getIsoDateStr(end) };
}
function getPreviewText(dateId) {
  const raw = appState.configEvents[dateId] || (isEffectiveHoliday(dateId, appState) ? holidayName(dateId) : '');
  const text = stripHtml(raw).replace(/\s+/g, '');
  const length = appState.isLandscapeMode ? 10 : 5;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)).slice(0, length).map(item => item.segment).join('');
  return Array.from(text).slice(0, length).join('');
}
function appendSafeRich(parent, html) {
  const holder = el('div');
  holder.innerHTML = sanitizeHtml(html);
  while (holder.firstChild) parent.appendChild(holder.firstChild);
  return parent;
}
function setSafeTitle(node, value) {
  node.setAttribute('title', stripHtml(value));
  return node;
}
function showAlert(message) {
  if (typeof window.alert === 'function') window.alert(message);
}
function showConfirm(message) {
  return typeof window.confirm !== 'function' || window.confirm(message);
}
function showStorageWarning(message = '') {
  const warning = document.getElementById('storage-warning');
  if (!warning) return;
  const reason = storageService?.isReadOnly() ? storageService.readOnlyReason() : '';
  const records = storageService?.getQuarantineRecords?.() || [];
  if (!message && !reason && records.length === 0) {
    warning.hidden = true;
    warning.replaceChildren();
    return;
  }
  warning.hidden = false;
  warning.replaceChildren();
  const text = message || (reason ? `保存を停止しています（読み取り専用相当）。${reason} 明示的な全データ初期化でのみ解除できます。` : `破損データを${records.length}件隔離しています。設定画面からrawデータをダウンロードできます。`);
  warning.textContent = text;
}
function notifySaveFailure(result) {
  showStorageWarning(result?.error || '保存に失敗しました。現在のデータは変更されていません。');
  showAlert(result?.error || '保存に失敗しました。現在のデータは変更されていません。');
}
function updateHistoryControls() {
  const undo = document.getElementById('history-undo-btn'); const redo = document.getElementById('history-redo-btn');
  const nextUndo = historyManager.peekUndo(); const nextRedo = historyManager.peekRedo();
  if (undo) { undo.disabled = !nextUndo; undo.title = nextUndo ? `${nextUndo.label}を元に戻す` : '元に戻せる変更はありません'; undo.setAttribute('aria-label', undo.title); }
  if (redo) { redo.disabled = !nextRedo; redo.title = nextRedo ? `${nextRedo.label}をやり直す` : 'やり直せる変更はありません'; redo.setAttribute('aria-label', redo.title); }
}
function commitState(mutator, { refresh = false, historyLabel = '変更', historyScope = 'general', skipHistory = false } = {}) {
  if (!storageService) return false;
  if (storageService.isReadOnly()) {
    notifySaveFailure({ error: `読み取り専用相当です: ${storageService.readOnlyReason()}` });
    return false;
  }
  const before = clone(appState);
  try {
    mutator(appState);
    const result = storageService.saveAll(appState);
    if (!result.ok) {
      appState = before;
      notifySaveFailure(result);
      if (refresh) refreshMainUI();
      return false;
    }
    appState = result.state;
    if (!skipHistory) historyManager.push({ label: historyLabel, scope: historyScope, before, after: appState });
    updateHistoryControls();
    showStorageWarning();
    if (refresh) refreshMainUI();
    return true;
  } catch (error) {
    appState = before;
    notifySaveFailure({ error: `変更を保存できませんでした: ${String(error?.message || error)}` });
    if (refresh) refreshMainUI();
    return false;
  }
}

function captureCountPreviewSelections() {
  const byWord = new Map();
  previewCountData.forEach((group, index) => {
    const word = appState.countSettings[index]?.word;
    if (!word) return;
    const snapshots = byWord.get(word) || [];
    snapshots.push(new Map(group.hits.map(hit => [`${hit.dateId}\u0000${hit.slot}`, { checked: hit.checked, trashed: hit.trashed }])));
    byWord.set(word, snapshots);
  });
  return byWord;
}
function restoreCountPreviewSelections(byWord) {
  if (!byWord) return;
  previewCountData.forEach((group, index) => {
    const word = appState.countSettings[index]?.word;
    const snapshots = byWord.get(word);
    const snapshot = snapshots?.shift();
    if (!snapshot) return;
    group.hits.forEach(hit => {
      const previous = snapshot.get(`${hit.dateId}\u0000${hit.slot}`);
      if (previous) { hit.checked = previous.checked; hit.trashed = previous.trashed; }
    });
  });
}
function refreshAfterHistoryRestore(countSelections = null) {
  refreshMainUI();
  if (document.getElementById('bulk-calendar-modal')?.style.display === 'flex') renderBulkCalendar();
  if (document.getElementById('count-modal')?.style.display === 'flex') { scanSchedulesForCount(); restoreCountPreviewSelections(countSelections); renderCountSettings(); refreshCountViews(); }
  updateHistoryControls();
}
function hasOpenUnsavedForm() {
  return document.getElementById('settings-view')?.style.display === 'block'
    || isDateListContextMenuOpen();
}
function isTextEditingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
}
function restoreHistory(direction) {
  if (hasOpenUnsavedForm()) { showAlert('保存前の入力を保護するため、この画面を閉じてから元に戻す／やり直すを実行してください。'); return false; }
  if (!storageService || storageService.isReadOnly()) { notifySaveFailure({ error: `読み取り専用相当です: ${storageService?.readOnlyReason?.() || ''}` }); return false; }
  const entry = direction === 'undo' ? historyManager.moveUndoToRedo() : historyManager.moveRedoToUndo();
  if (!entry) { updateHistoryControls(); return false; }
  const target = direction === 'undo' ? entry.before : entry.after;
  const before = clone(appState);
  const countSelections = captureCountPreviewSelections();
  const result = storageService.saveAll(target);
  if (!result.ok) {
    appState = before;
    if (direction === 'undo') { historyManager.redoStack.pop(); historyManager.restoreUndo(entry); } else { historyManager.undoStack.pop(); historyManager.restoreRedo(entry); }
    notifySaveFailure(result); updateHistoryControls(); return false;
  }
  appState = result.state;
  if (entry.scope === 'bulk-calendar') bulkCalendarUndoSnapshot = null;
  refreshAfterHistoryRestore(countSelections);
  showAlert(`${entry.label}を${direction === 'undo' ? '元に戻しました' : 'やり直しました'}。`);
  return true;
}
function undoHistory() { return restoreHistory('undo'); }
function redoHistory() { return restoreHistory('redo'); }

function applyPresetToState(state, dateId, preset) {
  if (!['normal', 'short', 'short-am', 'morning', 'exam', 'mock-exam', 'noclass-hide', 'noclass-show'].includes(preset) || !isValidIsoDate(dateId)) return false;
  if (!state.dayProfiles) state.dayProfiles = {};
  if (preset === 'normal') delete state.dayProfiles[dateId]; else state.dayProfiles[dateId] = preset;
  return true;
}
const DayStateEngine = {
  applyPreset(dateId, preset) {
    return commitState(state => applyPresetToState(state, dateId, preset), { refresh: true, historyLabel: '日別状態の変更', historyScope: 'day-profile' });
  },
  toggle(dateId, type) {
    const cycles = { noClass: ['normal', 'noclass-hide', 'noclass-show'], short: ['normal', 'short', 'short-am', 'morning'], exam: ['normal', 'exam', 'mock-exam'] };
    const cycle = cycles[type]; if (!cycle) return false;
    const current = getDayProfile(dateId); const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    return this.applyPreset(dateId, next);
  }
};

function renderHighlightedText(parent, text, keywords = currentSearchKeywords) {
  const value = String(text ?? '');
  if (!keywords.length) {
    parent.appendChild(document.createTextNode(value));
    return;
  }
  const normalized = value.toLocaleLowerCase();
  const matches = [];
  keywords.forEach(keyword => {
    const needle = keyword.toLocaleLowerCase();
    if (!needle) return;
    let start = normalized.indexOf(needle);
    while (start >= 0) {
      matches.push({ start, end: start + keyword.length });
      start = normalized.indexOf(needle, start + Math.max(1, needle.length));
    }
  });
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  matches.forEach(match => {
    if (match.start < cursor) return;
    if (match.start > cursor) parent.appendChild(document.createTextNode(value.slice(cursor, match.start)));
    const mark = el('span');
    mark.className = 'search-highlight';
    mark.textContent = value.slice(match.start, match.end);
    parent.appendChild(mark);
    cursor = match.end;
  });
  if (cursor < value.length) parent.appendChild(document.createTextNode(value.slice(cursor)));
}
function generateSnippet(text, keyword) {
  const value = String(text ?? '');
  const needle = String(keyword ?? '');
  if (!value || !needle) return '';
  const index = value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return value.slice(0, 18);
  const start = Math.max(0, index - 6);
  const end = Math.min(value.length, index + needle.length + 12);
  return `${start ? '...' : ''}${value.slice(start, end)}${end < value.length ? '...' : ''}`;
}
function getSearchJumpDate(raw) {
  const digits = String(raw ?? '').replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/[^0-9]/g, '');
  let dateId = null;
  if (digits.length === 4) {
    const month = Number(digits.slice(0, 2));
    const day = Number(digits.slice(2, 4));
    const year = month >= 4 ? appState.currentYear : appState.currentYear + 1;
    dateId = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } else if (digits.length === 6) dateId = `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  return dateId && isValidIsoDate(dateId) && isAcademicDate(dateId) ? dateId : null;
}
function createDateButton(dateId, position) {
  const button = el('button', position === 'left' ? (appState.isLandscapeMode ? '上' : '左') : (appState.isLandscapeMode ? '下' : '右'));
  button.type = 'button';
  button.className = 'btn-s';
  button.addEventListener('click', event => { event.stopPropagation(); renderEditor(dateId, position === 'left' ? 'bottom-left' : 'bottom-right'); });
  return button;
}
function createDateItem(dateId, searching = false) {
  const date = dateFromIso(dateId);
  if (!date) return null;
  const item = el('div');
  item.className = `date-item ${getDayBgClass(dateId)}`;
  item.addEventListener('contextmenu', event => openDateListContextMenu(event, dateId));
  const line = el('div');
  line.style.display = 'flex';
  line.style.justifyContent = 'space-between';
  line.style.alignItems = 'center';
  line.style.width = '100%';
  line.style.minWidth = '0';
  const wrapper = el('div');
  wrapper.className = 'date-wrapper';
  wrapper.addEventListener('click', () => renderEditor(dateId, 'top'));
  const label = el('span', formatDateInfo(date).label);
  label.className = dateId === getIsoDateStr(new Date()) ? 'date-label today-text' : 'date-label';
  wrapper.appendChild(label);
  const visual = getDayStateVisual(dateId);
  if (!searching) {
    const preview = el('span', getPreviewText(dateId));
    preview.className = 'date-preview';
    preview.id = `preview-${dateId}`;
    wrapper.appendChild(preview);
    wrapper.addEventListener('mousemove', event => showTooltip(event, dateId));
    wrapper.addEventListener('mouseleave', hideTooltip);
  }
  line.appendChild(wrapper);
  const actions = el('div');
  actions.className = 'btn-group';
  actions.style.marginLeft = 'auto';
  actions.appendChild(createDateButton(dateId, 'left'));
  actions.appendChild(createDateButton(dateId, 'right'));
  line.appendChild(actions);
  item.appendChild(line);
  if (searching) {
    const snippets = el('div');
    snippets.style.cursor = 'pointer';
    snippets.style.paddingTop = '2px';
    snippets.addEventListener('click', () => renderEditor(dateId, 'top'));
    const eventText = stripHtml(appState.configEvents[dateId] || '');
    const holidayText = stripHtml(holidayName(dateId) || '');
    const slots = scheduleSlots(dateId);
    const dayText = [eventText, holidayText, ...APP_CONFIG.slotsAll.map(slot => stripHtml(slots[slot] || ''))].filter(Boolean).join(' ');
    const found = [];
    if (currentSearchMode === 'day' && currentSearchKeywords.every(keyword => dayText.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))) found.push({ name: 'Hit', text: generateSnippet(dayText, currentSearchKeywords[0]) });
    if (currentSearchMode === 'slot') {
      const eventAndHoliday = `${eventText} ${holidayText}`;
      if (currentSearchKeywords.every(keyword => eventAndHoliday.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))) found.push({ name: '行事', text: generateSnippet(eventAndHoliday, currentSearchKeywords[0]) });
      APP_CONFIG.slotsAll.forEach(slot => {
        const text = stripHtml(slots[slot] || '');
        if (currentSearchKeywords.every(keyword => text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))) found.push({ name: getDisplaySlot(slot), text: generateSnippet(text, currentSearchKeywords[0]) });
      });
    }
    found.forEach(hit => {
      const snippet = el('div');
      snippet.style.fontSize = '11px';
      snippet.style.color = '#4a5568';
      snippet.style.marginTop = '3px';
      snippet.style.whiteSpace = 'nowrap';
      snippet.style.overflow = 'hidden';
      snippet.style.textOverflow = 'ellipsis';
      const name = el('span', hit.name);
      name.style.background = '#e2e8f0';
      name.style.padding = '1px 4px';
      name.style.borderRadius = '3px';
      name.style.marginRight = '4px';
      name.style.fontWeight = 'bold';
      snippet.appendChild(name);
      renderHighlightedText(snippet, hit.text);
      snippets.appendChild(snippet);
    });
    item.style.flexDirection = 'column';
    item.style.alignItems = 'stretch';
    item.style.padding = '6px 4px';
    item.appendChild(snippets);
  }
  return item;
}
function generateDateList() {
  const list = document.getElementById('date-list');
  if (!list) return;
  list.replaceChildren();
  let date = new Date(appState.currentYear, 3, 1);
  const end = new Date(appState.currentYear + 1, 2, 31);
  const searching = currentSearchKeywords.length > 0;
  const jumpDateId = searching && currentSearchKeywords.length === 1 ? getSearchJumpDate(currentSearchKeywords[0]) : null;
  if (jumpDateId) {
    const jumpItem = createDateItem(jumpDateId, false);
    if (jumpItem) {
      jumpItem.style.border = '2px solid #3182ce';
      jumpItem.style.backgroundColor = '#ebf8ff';
      list.appendChild(jumpItem);
    }
  }
  let count = 0;
  while (date <= end) {
    const dateId = getIsoDateStr(date);
    if (!searching || (() => {
      const text = [appState.configEvents[dateId], holidayName(dateId), ...APP_CONFIG.slotsAll.map(slot => scheduleSlots(dateId)[slot])].map(stripHtml).join(' ').toLocaleLowerCase();
      if (currentSearchMode === 'day') return currentSearchKeywords.every(keyword => text.includes(keyword.toLocaleLowerCase()));
      const eventText = `${stripHtml(appState.configEvents[dateId] || '')} ${stripHtml(holidayName(dateId) || '')}`;
      if (currentSearchKeywords.every(keyword => eventText.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))) return true;
      return APP_CONFIG.slotsAll.some(slot => {
        const slotText = stripHtml(scheduleSlots(dateId)[slot] || '').toLocaleLowerCase();
        return currentSearchKeywords.every(keyword => slotText.includes(keyword.toLocaleLowerCase()));
      });
    })()) {
      const item = createDateItem(dateId, searching);
      if (item) { list.appendChild(item); count += 1; }
    }
    date.setDate(date.getDate() + 1);
  }
  if (searching && count === 0 && !jumpDateId) list.appendChild(el('div', '一致する日がありません'));
}
function executeSearch() {
  const input = document.getElementById('search-input');
  const raw = input?.value || '';
  currentSearchKeywords = raw.split(/[\s　]+/).filter(Boolean);
  currentSearchMode = document.querySelector('input[name="search-mode"]:checked')?.value || 'day';
  if (currentSearchKeywords.length && !savedScrollPosition) savedScrollPosition = document.getElementById('date-list')?.scrollTop || 0;
  generateDateList();
  Object.entries(activePanels).forEach(([position, dateId]) => { if (dateId) renderEditor(dateId, position); });
}
function clearSearch(preventScrollRestore = false) {
  const input = document.getElementById('search-input');
  if (input) { input.value = ''; input.style.height = '28px'; }
  currentSearchKeywords = [];
  generateDateList();
  Object.entries(activePanels).forEach(([position, dateId]) => { if (dateId) renderEditor(dateId, position); });
  if (!preventScrollRestore) setTimeout(() => { const list = document.getElementById('date-list'); if (list) list.scrollTop = savedScrollPosition; }, 0);
  savedScrollPosition = 0;
}
function executeJump(dateId) {
  if (!dateFromIso(dateId)) return;
  renderEditor(dateId, 'top');
  clearSearch(true);
  setTimeout(() => {
    const item = document.getElementById('date-list')?.querySelector(`#preview-${dateId}`)?.closest('.date-item');
    if (item) document.getElementById('date-list').scrollTop = item.offsetTop;
  }, 0);
}

function showTooltip(event, dateId) {
  const tooltip = document.getElementById('custom-tooltip');
  const date = dateFromIso(dateId);
  if (!tooltip || !date) return;
  tooltip.replaceChildren();
  const heading = el('div', `${date.getMonth() + 1}月${date.getDate()}日(${APP_CONFIG.daysStr[date.getDay()]})`);
  setStyle(heading, { fontWeight: 'bold', borderBottom: '1px solid #555', marginBottom: '5px', paddingBottom: '3px' });
  tooltip.appendChild(heading);
  let hasContent = false;
  const addLine = (label, value, color = '#fff') => {
    const text = stripHtml(value).replace(/\n/g, ' ').trim();
    if (!text) return;
    const line = el('div');
    const prefix = el('span', label);
    prefix.style.color = color;
    line.appendChild(prefix);
    if (label) line.appendChild(document.createTextNode(' '));
    line.appendChild(document.createTextNode(text));
    tooltip.appendChild(line);
    hasContent = true;
  };
  const holiday = isEffectiveHoliday(dateId, appState);
  addLine('祝:', holiday ? holidayName(dateId) : '', '#fc8181');
  addLine('', appState.configEvents[dateId] || '', '#f6ad55');
  const profile = getDayProfile(dateId);
  const noClass = profile === 'noclass-hide';
  const hideAfternoon = profile === 'exam' || profile === 'short-am' || profile === 'morning';
  getActiveSlotsForDate(dateId).forEach(slot => {
    if (noClass && slot !== '朝' && slot !== '放課後') return;
    if (holiday && PERIOD_SLOTS.has(slot)) return;
    if (hideAfternoon && ['昼休み', '５限', '６限', '７限'].includes(slot)) return;
    addLine(`[${getDisplaySlot(slot)}]`, scheduleSlots(dateId)[slot] || '', '#90cdf4');
  });
  if (!hasContent) tooltip.appendChild(document.createTextNode('予定なし'));
  tooltip.style.display = 'block';
  tooltip.style.left = `${event.pageX + 15}px`;
  tooltip.style.top = `${event.pageY + 15}px`;
}
function hideTooltip() {
  const tooltip = document.getElementById('custom-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function buildStateButton(type, dateId) {
  const button = el('button');
  button.className = 'state-btn';
  button.addEventListener('click', () => toggleMainState(type));
  return button;
}
function updateToolbarState() {
  if (!currentMainDateId) return;
  const shortButton = document.getElementById('toolbar-short-btn');
  const examButton = document.getElementById('toolbar-exam-btn');
  const noClassButton = document.getElementById('toolbar-noclass-btn');
  const profile = getDayProfile(currentMainDateId);
  const short = ['short', 'short-am', 'morning'].indexOf(profile) + 1;
  const exam = ['exam', 'mock-exam'].indexOf(profile) + 1;
  const noClass = ['noclass-hide', 'noclass-show'].indexOf(profile) + 1;
  if (shortButton) { shortButton.className = short > 0 ? 'state-btn short-active' : 'state-btn'; shortButton.textContent = APP_CONFIG.labels.short[short] || APP_CONFIG.labels.short[0]; }
  if (examButton) { examButton.className = exam > 0 ? 'state-btn exam-active' : 'state-btn'; examButton.textContent = APP_CONFIG.labels.exam[exam] || APP_CONFIG.labels.exam[0]; }
  if (noClassButton) { noClassButton.className = noClass === 1 ? 'state-btn noclass-active' : noClass === 2 ? 'state-btn noclass-active inset' : 'state-btn'; noClassButton.textContent = APP_CONFIG.labels.noClass[noClass] || APP_CONFIG.labels.noClass[0]; }
}
function buildPanelHeader(dateId, position) {
  const top = position === 'top';
  const date = dateFromIso(dateId);
  const header = el('div');
  header.className = 'panel-header';
  header.style.flexDirection = top ? 'row' : 'column';
  header.style.alignItems = top ? 'center' : 'flex-start';
  header.style.flexWrap = 'wrap';
  const firstLine = el('div');
  firstLine.style.display = 'flex';
  firstLine.style.alignItems = 'center';
  firstLine.style.width = '100%';
  if (top) firstLine.style.width = 'auto';
  const previous = el('button', '◀');
  previous.className = 'nav-btn';
  previous.type = 'button';
  previous.addEventListener('click', () => shiftDate(dateId, -1, position));
  const next = el('button', '▶');
  next.className = 'nav-btn';
  next.type = 'button';
  next.style.marginRight = '6px';
  next.addEventListener('click', () => shiftDate(dateId, 1, position));
  firstLine.append(previous, next);
  const visual = getDayStateVisual(dateId);
  const dateLabel = el('span', `${date.getFullYear()}年(令和${date.getFullYear() - 2018}年)${date.getMonth() + 1}月${date.getDate()}日(${APP_CONFIG.daysStr[date.getDay()]})`);
  dateLabel.className = `display-date ${visual.className}`;
  dateLabel.title = visual.label;
  firstLine.appendChild(dateLabel);
  if (top) firstLine.appendChild(el('span'));
  if (top) {
    firstLine.lastChild.className = 'digital-clock-display';
    firstLine.lastChild.style.marginLeft = '8px';
  }
  header.appendChild(firstLine);
  const secondLine = top ? header : el('div');
  if (!top) {
    secondLine.style.display = 'flex';
    secondLine.style.alignItems = 'center';
    secondLine.style.width = '100%';
    secondLine.style.gap = '5px';
    header.appendChild(secondLine);
  }
  const eventInput = el('input');
  eventInput.type = 'text';
  eventInput.className = 'event-inline-input';
  eventInput.value = stripHtml(appState.configEvents[dateId] || '');
  const holiday = isEffectiveHoliday(dateId, appState);
  eventInput.placeholder = holiday ? '行事予定' : '';
  if (top) eventInput.style.marginLeft = '15px';
  eventInput.addEventListener('input', () => updateAnnualEvent(dateId, eventInput.value));
  secondLine.appendChild(eventInput);
  if (holiday) secondLine.appendChild(el('span', `祝：${stripHtml(holidayName(dateId))}`));
  if (!top) header.appendChild(secondLine);
  return header;
}
function createSlotEditor(dateId, slot, isShortChime, isExamChime, hideChime = false, showRuleActions = false) {
  const row = el('div');
  row.className = 'slot-row';
  const label = el('div', getDisplaySlot(slot));
  label.className = 'slot-label';
  const time = isExamChime ? appState.timeConfig.exam[slot] : isShortChime ? appState.timeConfig.short[slot] : appState.timeConfig.normal[slot];
  if (time && !hideChime) label.appendChild(el('span', time)).className = 'time-disp';
  const input = el('div');
  input.className = 'slot-input';
  input.contentEditable = 'true';
  const resolved = resolvedSlot(dateId, slot);
  appendSafeRich(input, resolved);
  input.addEventListener('blur', () => updateSlot(dateId, slot, input.innerHTML));
  input.addEventListener('paste', handlePaste);
  const origin = getSlotOrigin(dateId, slot, appState);
  const hasOverride = Boolean(appState.dateOverrides?.[dateId]?.slots?.[slot]);
  if (hasOverride) {
    if (origin === 'override') { const mark = el('span', '変'); mark.className = 'slot-change-mark'; mark.title = 'この日だけの変更'; mark.setAttribute('aria-label', 'この日だけの変更'); label.appendChild(mark); }
    else { label.title = '旧データから引継ぎ'; label.setAttribute('aria-label', `${getDisplaySlot(slot)}: 旧データから引継ぎ`); }
    row.append(label, input);
    if (showRuleActions) {
      const restore = el('button', '戻す'); restore.type = 'button'; restore.className = 'btn-s'; restore.title = `${dateId} ${slot}を基本時間割に戻す`;
      restore.addEventListener('click', () => restoreBaseSlot(dateId, slot));
      const following = el('button', '以降'); following.type = 'button'; following.className = 'btn-s'; following.title = `${dateId}以降の毎週${APP_CONFIG.daysStr[weekdayForDateId(dateId)]}曜日を変更`;
      following.addEventListener('click', () => changeFollowingWeekly(dateId, slot, input.innerHTML)); row.append(restore, following);
    }
  } else {
    if (origin === 'rule') { label.title = '基本時間割から表示'; label.setAttribute('aria-label', `${getDisplaySlot(slot)}: 基本時間割から表示`); }
    if (origin === 'legacy') { label.title = '旧データから引継ぎ'; label.setAttribute('aria-label', `${getDisplaySlot(slot)}: 旧データから引継ぎ`); }
    row.append(label, input);
  }
  return row;
}
function renderEditor(dateId, position) {
  const targetPosition = position === 'bottom' ? (activePanels['bottom-left'] ? 'bottom-right' : 'bottom-left') : position;
  const targetId = targetPosition === 'top' ? 'top-panel' : targetPosition === 'bottom-left' ? 'bottom-left-panel' : 'bottom-right-panel';
  const target = document.getElementById(targetId);
  const date = dateFromIso(dateId);
  if (!target || !date) return;
  activePanels[targetPosition] = dateId;
  if (targetPosition === 'top') currentMainDateId = dateId;
  target.replaceChildren();
  target.appendChild(buildPanelHeader(dateId, targetPosition));
  const content = el('div');
  setStyle(content, { flex: '1', overflowY: 'auto', paddingRight: '5px', display: 'flex', flexDirection: 'column' });
  const profile = getDayProfile(dateId);
  const short = ['short', 'short-am', 'morning'].indexOf(profile) + 1;
  const exam = ['exam', 'mock-exam'].indexOf(profile) + 1;
  const noClass = ['noclass-hide', 'noclass-show'].indexOf(profile) + 1;
  const policy = getDateSchedulePolicy(dateId, appState);
  const holiday = policy.isEffectiveHoliday;
  const hideChime = policy.hideChime;
  const hideClasses = noClass === 1;
  const hideAfternoon = exam === 1 || short === 2 || short === 3;
  const isShortChime = short === 1 || short === 2;
  const isExamChime = exam === 1;
  const canRender = slot => isSlotVisibleForDate(dateId, slot, appState);
  const addSlots = slots => slots.forEach(slot => { if (canRender(slot)) content.appendChild(createSlotEditor(dateId, slot, isShortChime, isExamChime, hideChime, targetPosition === 'top')); });
  addSlots(['朝']);
  if (!hideClasses) {
    const first = ['１限', '２限', '３限', '４限'].filter(canRender);
    const second = hideAfternoon ? [] : ['昼休み', '５限', '６限', '７限'].filter(canRender);
    const useColumns = targetPosition === 'top' ? !appState.isLandscapeMode : appState.isLandscapeMode;
    if (useColumns) {
      const columns = el('div');
      columns.className = 'cols-wrapper';
      [first, second].filter(slots => slots.length > 0).forEach(slots => {
        const column = el('div');
        column.className = 'col-half';
        slots.forEach(slot => column.appendChild(createSlotEditor(dateId, slot, isShortChime, isExamChime, hideChime, targetPosition === 'top')));
        columns.appendChild(column);
      });
      if (columns.childElementCount > 0) content.appendChild(columns);
    } else {
      addSlots(first);
      addSlots(second);
    }
  }
  addSlots(['放課後']);
  if (targetPosition === 'top') {
    const globalArea = el('div');
    setStyle(globalArea, { marginTop: '10px', paddingTop: '8px', flexShrink: '0' });
    const title = el('div', '共通タスク');
    setStyle(title, { fontWeight: 'bold', fontSize: '14px', color: 'var(--text)', marginBottom: '4px' });
    const globalInput = el('div');
    globalInput.className = 'slot-input';
    globalInput.contentEditable = 'true';
    globalInput.style.minHeight = '60px';
    globalInput.style.fontSize = '14px';
    appendSafeRich(globalInput, appState.globalTaskData);
    globalInput.addEventListener('blur', () => updateGlobalTask(globalInput.innerHTML));
    globalInput.addEventListener('paste', handlePaste);
    globalArea.append(title, globalInput);
    content.appendChild(globalArea);
  }
  target.appendChild(content);
  if (targetPosition === 'top') updateToolbarState();
}
function refreshMainUI() {
  const list = document.getElementById('date-list');
  const scroll = list?.scrollTop || 0;
  generateDateList();
  if (!currentSearchKeywords.length && list) list.scrollTop = scroll;
  Object.entries(activePanels).forEach(([position, dateId]) => { if (dateId) renderEditor(dateId, position); });
  updateToolbarState();
}
function updatePreviewUI(dateId) {
  const preview = document.getElementById(`preview-${dateId}`);
  if (preview) preview.textContent = getPreviewText(dateId);
}
function updateAnnualEvent(dateId, value) {
  const ok = commitState(state => {
    const clean = sanitizeHtml(String(value ?? ''));
    if (stripHtml(clean).trim()) state.configEvents[dateId] = clean;
    else delete state.configEvents[dateId];
  }, { historyLabel: '行事予定の変更', historyScope: 'event' });
  if (ok) updatePreviewUI(dateId);
  return ok;
}
function setUserOverride(state, dateId, slot, htmlValue) {
  const clean = sanitizeHtml(htmlValue);
  const text = stripHtml(clean).trim();
  const base = getWeeklyRuleSlot(dateId, slot, state);
  const existing = state.dateOverrides?.[dateId]?.slots?.[slot];
  if (existing && clean === getResolvedSlot(dateId, slot, state)) return;
  if (!state.dateOverrides[dateId]) state.dateOverrides[dateId] = { slots: {} };
  if (!text) {
    if (base) state.dateOverrides[dateId].slots[slot] = { action: 'cancel', source: 'user' };
    else delete state.dateOverrides[dateId].slots[slot];
  } else if (!existing && clean === base) delete state.dateOverrides[dateId].slots[slot];
  else state.dateOverrides[dateId].slots[slot] = { action: 'replace', content: clean, source: 'user' };
  if (!Object.keys(state.dateOverrides[dateId].slots).length) delete state.dateOverrides[dateId];
}
function updateSlot(dateId, slot, htmlValue) {
  const ok = commitState(state => { setUserOverride(state, dateId, slot, htmlValue); }, { historyLabel: '日別予定の変更', historyScope: 'schedule' });
  if (ok) updatePreviewUI(dateId);
  return ok;
}
function restoreBaseSlot(dateId, slot) {
  if (!showConfirm(`${dateId} の${getDisplaySlot(slot)}を基本時間割に戻しますか？`)) return;
  if (commitState(state => { delete state.dateOverrides?.[dateId]?.slots?.[slot]; if (state.dateOverrides?.[dateId] && !Object.keys(state.dateOverrides[dateId].slots).length) delete state.dateOverrides[dateId]; }, { refresh: true, historyLabel: '基本時間割に戻す', historyScope: 'schedule' })) updatePreviewUI(dateId);
}
function changeFollowingWeekly(dateId, slot, htmlValue) {
  const content = sanitizeHtml(htmlValue);
  if (!stripHtml(content).trim()) { showAlert('「この日以降」の基本時間割には空でない内容が必要です。'); return; }
  const weekday = weekdayForDateId(dateId); const end = academicYearBounds(appState.currentYear).end;
  const affected = (appState.weeklyRules[weekday]?.[slot] || []).filter(segment => segment.to >= dateId && segment.from <= end).length;
  const overrides = Object.entries(appState.dateOverrides).filter(([id]) => id >= dateId && id <= end).reduce((total, [, day]) => total + (day.slots[slot] ? 1 : 0), 0);
  if (!showConfirm(`${dateId} ～ ${end} の毎週${APP_CONFIG.daysStr[weekday]}曜日・${getDisplaySlot(slot)}を変更します。\n既存規則 ${affected}件を安全に分割・置換します。\n日別変更 ${overrides}件は変更せず優先されます。\n続行しますか？`)) return;
  const snapshot = storageService.createRecoverySnapshot();
  if (!snapshot.ok) { notifySaveFailure(snapshot); return; }
  const result = replaceWeeklyRuleRange(appState, String(weekday), slot, dateId, end, content);
  if (!result.ok) { showAlert(result.error); return; }
  if (commitState(state => Object.assign(state, result.value), { refresh: true, historyLabel: 'この日以降の基本時間割変更', historyScope: 'weekly-rule' })) showAlert(`この日以降の毎週${APP_CONFIG.daysStr[weekday]}曜日を基本時間割として変更しました。`);
}
function updateGlobalTask(htmlValue) {
  return commitState(state => { state.globalTaskData = sanitizeHtml(htmlValue); }, { historyLabel: '共通タスクの変更', historyScope: 'task' });
}

const EditorCmd = {
  exec(command, value = null) { document.execCommand(command, false, value); },
  insertHTML(html) { document.execCommand('insertHTML', false, sanitizeHtml(html)); },
  insertBadge(initialState) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    let container = range.commonAncestorContainer;
    if (container.nodeType === 3) container = container.parentNode;
    if (!container?.closest?.('.slot-input')) {
      showAlert('予定の入力枠をクリックして、カーソルを合わせてからボタンを押してください。');
      return;
    }
    range.deleteContents();
    const badge = el('span', initialState === '3' ? '急' : '未');
    badge.className = `todo-badge state-${initialState === '3' ? '3' : '0'}`;
    badge.dataset.state = initialState === '3' ? '3' : '0';
    badge.contentEditable = 'false';
    const space = document.createTextNode('\u200b');
    const fragment = document.createDocumentFragment();
    fragment.append(badge, space);
    range.insertNode(fragment);
    range.setStartAfter(space);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
};
function handlePaste(event) {
  event.preventDefault();
  const transfer = event.clipboardData || event.originalEvent?.clipboardData;
  const html = transfer?.getData('text/html') || '';
  const text = transfer?.getData('text/plain') || '';
  const clean = html ? sanitizeHtml(html) : escapeHtmlText(text).replace(/\r?\n/g, '<br>');
  document.execCommand('insertHTML', false, clean);
}
function copySelection(event, isCut = false) {
  const active = document.activeElement;
  if (!active?.classList?.contains('slot-input')) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const holder = el('div');
  holder.appendChild(selection.getRangeAt(0).cloneContents());
  const safeHtml = sanitizeHtml(holder.innerHTML);
  event.clipboardData?.setData('text/html', safeHtml);
  event.clipboardData?.setData('text/plain', stripHtml(safeHtml));
  event.preventDefault();
  if (isCut) {
    selection.getRangeAt(0).deleteContents();
    active.dispatchEvent(new Event('blur'));
  }
}

function toggleMainState(type) {
  DayStateEngine.toggle(currentMainDateId, type);
}
function shiftDate(dateId, offset, position) {
  const date = dateFromIso(dateId);
  if (!date) return;
  date.setDate(date.getDate() + offset);
  const nextId = getIsoDateStr(date);
  renderEditor(nextId, position);
  if (position === 'top') { clearSearch(true); requestAnimationFrame(() => scrollDateListToRow(nextId, 7)); }
}

function getBulkCalendarStateLabel(value) {
  return {
    normal: '通常に戻す', short: '短縮時程', 'short-am': '短縮AM', morning: '午前時程', exam: '定期考査', 'mock-exam': '模擬試験',
    'noclass-hide': '授業なし（授業枠を隠す）', 'noclass-show': '授業なし（授業枠を表示・時数には数えない）'
  }[value] || '';
}
function getBulkCalendarWeekdayIds(year, month, dayIndex) {
  const result = [];
  const last = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= last; day += 1) {
    const date = new Date(year, month, day);
    if (date.getDay() === dayIndex) result.push(getIsoDateStr(date));
  }
  return result;
}
function getBulkCalendarDateTooltip(dateId, visual) {
  const date = dateFromIso(dateId);
  if (!date) return '';
  const values = [`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${APP_CONFIG.daysStr[date.getDay()]}）`, visual.label];
  const eventText = stripHtml(appState.configEvents[dateId] || '').replace(/\s+/g, ' ').trim();
  const holidayText = isEffectiveHoliday(dateId, appState) ? stripHtml(holidayName(dateId) || '').replace(/\s+/g, ' ').trim() : '';
  if (eventText) values.push(eventText);
  if (holidayText) values.push(holidayText);
  return values.join('\n');
}
function renderBulkCalendar() {
  const container = document.getElementById('bulk-calendar-grid');
  if (!container) return;
  const isVertical = appState.bulkCalendarMonthLayout === 'vertical';
  container.classList.toggle('month-layout-horizontal', !isVertical);
  container.classList.toggle('month-layout-vertical', isVertical);
  container.replaceChildren();
  const todayId = getIsoDateStr(new Date());
  for (let offset = 0; offset < 12; offset += 1) {
    const first = new Date(appState.currentYear, 3 + offset, 1);
    const year = first.getFullYear();
    const month = first.getMonth();
    const monthBox = el('section');
    monthBox.className = 'calendar-month';
    monthBox.setAttribute('aria-label', `${year}年${month + 1}月`);
    const header = el('div'); header.className = 'calendar-month-head';
    header.appendChild(el('span', `${year}年${month + 1}月`));
    const monthButton = el('button');
    monthButton.type = 'button'; monthButton.className = 'btn-s';
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthIds = Array.from({ length: lastDay }, (_, index) => getIsoDateStr(new Date(year, month, index + 1)));
    const allSelected = monthIds.every(id => bulkCalendarSelection.has(id));
    monthButton.textContent = allSelected ? '月を解除' : '月を選択';
    monthButton.addEventListener('click', () => toggleBulkCalendarMonth(year, month));
    header.appendChild(monthButton);
    monthBox.appendChild(header);
    const weekHeader = el('div'); weekHeader.className = 'calendar-week-head';
    [1, 2, 3, 4, 5, 6, 0].forEach(dayIndex => {
      const dayButton = el('button', APP_CONFIG.daysStr[dayIndex]);
      dayButton.type = 'button'; dayButton.className = 'calendar-weekday-btn';
      const ids = getBulkCalendarWeekdayIds(year, month, dayIndex);
      const weekdaySelected = ids.length > 0 && ids.every(id => bulkCalendarSelection.has(id));
      dayButton.classList.toggle('is-all-selected', weekdaySelected);
      dayButton.setAttribute('aria-pressed', String(weekdaySelected));
      dayButton.title = `${year}年${month + 1}月の${APP_CONFIG.daysStr[dayIndex]}曜日をすべて${weekdaySelected ? '解除' : '選択'}`;
      dayButton.addEventListener('click', () => toggleBulkCalendarWeekday(year, month, dayIndex));
      weekHeader.appendChild(dayButton);
    });
    monthBox.appendChild(weekHeader);
    const days = el('div'); days.className = 'calendar-days';
    const firstDay = (first.getDay() + 6) % 7;
    for (let blank = 0; blank < firstDay; blank += 1) days.appendChild(el('span')).className = 'calendar-day-spacer';
    for (let day = 1; day <= lastDay; day += 1) {
      const dateId = getIsoDateStr(new Date(year, month, day));
      const dateButton = el('button');
      dateButton.type = 'button';
      dateButton.className = `calendar-date-cell ${getDayBgClass(dateId)}`;
      dateButton.dataset.dateId = dateId;
      const visual = getDayStateVisual(dateId);
      dateButton.setAttribute('aria-pressed', String(bulkCalendarSelection.has(dateId)));
      const tooltip = getBulkCalendarDateTooltip(dateId, visual);
      dateButton.setAttribute('aria-label', tooltip);
      dateButton.title = tooltip;
      dateButton.classList.toggle('is-selected', bulkCalendarSelection.has(dateId));
      dateButton.appendChild(el('span', String(day)));
      if (visual.shortLabel) { const stateMark = el('span', visual.shortLabel); stateMark.className = 'calendar-state-mark'; dateButton.appendChild(stateMark); }
      if (dateId === todayId) { const todayMark = el('span'); todayMark.className = 'calendar-today-mark'; todayMark.setAttribute('aria-label', '今日'); dateButton.appendChild(todayMark); }
      dateButton.addEventListener('click', event => toggleBulkCalendarDate(dateId, event));
      days.appendChild(dateButton);
    }
    monthBox.appendChild(days);
    container.appendChild(monthBox);
  }
  updateBulkCalendarControls();
}
function toggleBulkCalendarDate(dateId, event = {}) {
  const range = event.shiftKey && bulkCalendarRangeAnchor && isAcademicDate(bulkCalendarRangeAnchor);
  const modifier = event.ctrlKey || event.metaKey;
  if (appState.bulkCalendarSelectionMode === 'standard') {
    if (range) {
      if (!modifier) bulkCalendarSelection.clear();
      let date = dateFromIso(bulkCalendarRangeAnchor < dateId ? bulkCalendarRangeAnchor : dateId);
      const end = bulkCalendarRangeAnchor < dateId ? dateId : bulkCalendarRangeAnchor;
      while (date && getIsoDateStr(date) <= end) { bulkCalendarSelection.add(getIsoDateStr(date)); date.setDate(date.getDate() + 1); }
    } else if (modifier) {
      if (bulkCalendarSelection.has(dateId)) bulkCalendarSelection.delete(dateId); else bulkCalendarSelection.add(dateId);
      bulkCalendarRangeAnchor = dateId;
    } else {
      bulkCalendarSelection.clear(); bulkCalendarSelection.add(dateId); bulkCalendarRangeAnchor = dateId;
    }
  } else if (range) {
    let date = dateFromIso(bulkCalendarRangeAnchor < dateId ? bulkCalendarRangeAnchor : dateId);
    const end = bulkCalendarRangeAnchor < dateId ? dateId : bulkCalendarRangeAnchor;
    while (date && getIsoDateStr(date) <= end) { bulkCalendarSelection.add(getIsoDateStr(date)); date.setDate(date.getDate() + 1); }
    bulkCalendarRangeAnchor = dateId;
  } else {
    if (bulkCalendarSelection.has(dateId)) bulkCalendarSelection.delete(dateId); else bulkCalendarSelection.add(dateId);
    bulkCalendarRangeAnchor = dateId;
  }
  renderBulkCalendar();
}
function toggleBulkCalendarMonth(year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  const ids = Array.from({ length: last }, (_, index) => getIsoDateStr(new Date(year, month, index + 1)));
  const allSelected = ids.every(id => bulkCalendarSelection.has(id));
  ids.forEach(id => allSelected ? bulkCalendarSelection.delete(id) : bulkCalendarSelection.add(id));
  bulkCalendarRangeAnchor = '';
  renderBulkCalendar();
}
function toggleBulkCalendarWeekday(year, month, dayIndex) {
  const ids = getBulkCalendarWeekdayIds(year, month, dayIndex);
  const allSelected = ids.length > 0 && ids.every(id => bulkCalendarSelection.has(id));
  ids.forEach(id => allSelected ? bulkCalendarSelection.delete(id) : bulkCalendarSelection.add(id));
  bulkCalendarRangeAnchor = '';
  renderBulkCalendar();
}
function clearBulkCalendarSelection() {
  bulkCalendarSelection.clear(); bulkCalendarRangeAnchor = ''; closeBulkCalendarContextMenu(); renderBulkCalendar();
}
function setBulkCalendarSelectionMode(mode) {
  if (!['standard', 'additive'].includes(mode) || appState.bulkCalendarSelectionMode === mode) return;
  commitState(state => { state.bulkCalendarSelectionMode = mode; }, { historyLabel: '年間カレンダー選択方式の変更', historyScope: 'calendar-setting' });
  bulkCalendarRangeAnchor = '';
  renderBulkCalendar();
}
function setBulkCalendarMonthLayout(layout) {
  if (!['horizontal', 'vertical'].includes(layout) || appState.bulkCalendarMonthLayout === layout) return;
  commitState(state => { state.bulkCalendarMonthLayout = layout; }, { historyLabel: '年間カレンダー月並びの変更', historyScope: 'calendar-setting' });
  closeBulkCalendarContextMenu();
  renderBulkCalendar();
}
function updateBulkCalendarControls() {
  const count = bulkCalendarSelection.size;
  const summary = document.getElementById('bulk-calendar-selection-summary'); if (summary) summary.textContent = `${count}日`;
  const status = document.getElementById('bulk-calendar-action-status'); if (status) status.textContent = bulkCalendarStatus;
  qa('[data-bulk-day-state]').forEach(button => { button.disabled = count === 0; });
  const undo = document.getElementById('bulk-calendar-undo-btn'); if (undo) undo.style.display = historyManager.peekUndo()?.scope === 'bulk-calendar' ? '' : 'none';
  const clear = document.getElementById('bulk-calendar-context-clear'); if (clear) { clear.disabled = count === 0; clear.textContent = count ? `選択をすべて解除（${count}日）` : '選択中の日付はありません'; }
  qa('[data-bulk-context-preset]').forEach(button => { button.disabled = count === 0; });
  ['standard', 'additive'].forEach(mode => { const button = document.getElementById(`bulk-selection-mode-${mode}`); if (button) { button.classList.toggle('is-active', appState.bulkCalendarSelectionMode === mode); button.setAttribute('aria-pressed', String(appState.bulkCalendarSelectionMode === mode)); } });
  ['horizontal', 'vertical'].forEach(layout => { const button = document.getElementById(`bulk-month-layout-${layout}`); if (button) { button.classList.toggle('is-active', appState.bulkCalendarMonthLayout === layout); button.setAttribute('aria-pressed', String(appState.bulkCalendarMonthLayout === layout)); } });
}
function openBulkCalendarModal() {
  bulkCalendarInvoker = document.activeElement; bulkCalendarSelection.clear(); bulkCalendarRangeAnchor = ''; bulkCalendarUndoSnapshot = null; bulkCalendarStatus = '';
  const modal = document.getElementById('bulk-calendar-modal'); if (!modal) return;
  modal.style.display = 'flex'; modal.setAttribute('aria-hidden', 'false'); renderBulkCalendar();
  setTimeout(() => document.getElementById('bulk-calendar-title')?.focus(), 0);
}
function closeBulkCalendarModal() {
  closeBulkCalendarContextMenu();
  const modal = document.getElementById('bulk-calendar-modal'); if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden', 'true'); }
  bulkCalendarInvoker?.focus?.();
}
function handleBulkCalendarModalKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); if (isBulkCalendarContextMenuOpen()) closeBulkCalendarContextMenu(true); else closeBulkCalendarModal(); return; }
  if (event.key !== 'Tab') return;
  const dialog = document.querySelector('#bulk-calendar-modal [role="dialog"]');
  const focusables = qa('button:not([disabled]), input:not([disabled])', dialog).filter(node => node.offsetParent !== null);
  if (!focusables.length) return;
  if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1).focus(); }
  else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0].focus(); }
}
function isBulkCalendarContextMenuOpen() { const menu = document.getElementById('bulk-calendar-context-menu'); return Boolean(menu && !menu.hidden); }
function openBulkCalendarContextMenu(event) {
  event.preventDefault();
  const dateCell = event.target.closest?.('.calendar-date-cell');
  const dateId = dateCell?.dataset.dateId;
  if (!dateId || !isAcademicDate(dateId)) return;
  if (!bulkCalendarSelection.has(dateId)) {
    bulkCalendarSelection.clear();
    bulkCalendarSelection.add(dateId);
    bulkCalendarRangeAnchor = dateId;
    renderBulkCalendar();
  }
  const menu = document.getElementById('bulk-calendar-context-menu'); if (!menu) return;
  bulkCalendarContextDateId = dateId;
  bulkCalendarContextMenuInvoker = q(`#bulk-calendar-grid [data-date-id="${dateId}"]`);
  const ids = Array.from(bulkCalendarSelection).filter(isAcademicDate).sort();
  const title = document.getElementById('bulk-calendar-context-title');
  const date = dateFromIso(dateId);
  if (title && date) title.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${APP_CONFIG.daysStr[date.getDay()]}）を含む ${ids.length}日`;
  const profiles = ids.map(getDayProfile);
  const activePreset = profiles.length && profiles.every(profile => profile === profiles[0]) ? profiles[0] : '';
  qa('[data-bulk-context-preset]').forEach(button => button.classList.toggle('is-active', button.dataset.bulkContextPreset === activePreset));
  const holidayInput = document.getElementById('bulk-calendar-context-holiday-name');
  const holidayNames = ids.map(id => stripHtml(appState.customHolidays[id] || ''));
  if (holidayInput) holidayInput.value = holidayNames.length && holidayNames.every(name => name === holidayNames[0]) ? holidayNames[0] : '';
  menu.hidden = false; updateBulkCalendarControls();
  const width = menu.offsetWidth || 294; const height = menu.offsetHeight || 360;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
  menu.querySelector('[data-bulk-context-preset]')?.focus();
}
function closeBulkCalendarContextMenu(restoreFocus = false) {
  const menu = document.getElementById('bulk-calendar-context-menu'); if (!menu || menu.hidden) return;
  menu.hidden = true;
  if (restoreFocus) bulkCalendarContextMenuInvoker?.focus?.();
  bulkCalendarContextMenuInvoker = null;
  bulkCalendarContextDateId = '';
}
function applyBulkCalendarContextPreset(preset) {
  if (!bulkCalendarContextDateId || !bulkCalendarSelection.size) return;
  closeBulkCalendarContextMenu();
  applyBulkCalendarPreset(preset);
}
function saveBulkCalendarContextHoliday() {
  const ids = Array.from(bulkCalendarSelection).filter(isAcademicDate).sort();
  if (!bulkCalendarContextDateId || !ids.length) return;
  const input = document.getElementById('bulk-calendar-context-holiday-name');
  const clean = sanitizeHtml(input?.value || '');
  const holidayName = stripHtml(clean).trim() ? clean : '休日';
  const before = clone(appState);
  bulkCalendarUndoSnapshot = ids.map(id => ({ id, profile: getDayProfile(id) }));
  if (!commitState(state => ids.forEach(id => { state.customHolidays[id] = holidayName; }), { historyLabel: '年間カレンダー一括休日設定', historyScope: 'bulk-calendar' })) { appState = before; bulkCalendarUndoSnapshot = null; return; }
  closeBulkCalendarContextMenu();
  bulkCalendarStatus = `${ids.length}日を学校独自休日「${stripHtml(holidayName)}」に設定しました。`;
  renderBulkCalendar(); refreshMainUI();
}
function clearBulkCalendarContextHoliday() {
  const ids = Array.from(bulkCalendarSelection).filter(isAcademicDate).sort();
  if (!bulkCalendarContextDateId || !ids.length) return;
  const before = clone(appState);
  bulkCalendarUndoSnapshot = ids.map(id => ({ id, profile: getDayProfile(id) }));
  if (!commitState(state => ids.forEach(id => { delete state.customHolidays[id]; }), { historyLabel: '年間カレンダー一括休日解除', historyScope: 'bulk-calendar' })) { appState = before; bulkCalendarUndoSnapshot = null; return; }
  closeBulkCalendarContextMenu();
  bulkCalendarStatus = `${ids.length}日の学校独自休日を解除しました。暦上の祝日はそのままです。`;
  renderBulkCalendar(); refreshMainUI();
}
function applyBulkCalendarPreset(preset) {
  const ids = Array.from(bulkCalendarSelection).filter(isAcademicDate).sort();
  const label = getBulkCalendarStateLabel(preset);
  if (!ids.length || !label) return;
  const before = clone(appState);
  bulkCalendarUndoSnapshot = ids.map(id => ({ id, profile: getDayProfile(id) }));
  if (!commitState(state => ids.forEach(id => applyPresetToState(state, id, preset)), { historyLabel: '年間カレンダー一括設定', historyScope: 'bulk-calendar' })) { appState = before; bulkCalendarUndoSnapshot = null; return; }
  bulkCalendarStatus = `${ids.length}日を「${label}」に設定しました。`;
  renderBulkCalendar(); refreshMainUI();
}
function applyBulkCalendarHoliday() {
  const ids = Array.from(bulkCalendarSelection).filter(isAcademicDate).sort();
  if (!ids.length) return;
  const before = clone(appState);
  bulkCalendarUndoSnapshot = ids.map(id => ({ id, profile: getDayProfile(id) }));
  if (!commitState(state => ids.forEach(id => { if (!state.customHolidays[id]) state.customHolidays[id] = '休日'; }), { historyLabel: '年間カレンダー一括休日設定', historyScope: 'bulk-calendar' })) { appState = before; bulkCalendarUndoSnapshot = null; return; }
  bulkCalendarStatus = `${ids.length}日を休日に設定しました。ほかの日種別がある日は、その種別を優先して表示します。`;
  renderBulkCalendar(); refreshMainUI();
}
function undoBulkCalendarChange() {
  if (historyManager.peekUndo()?.scope !== 'bulk-calendar') { bulkCalendarUndoSnapshot = null; bulkCalendarStatus = '別の変更があるため、上部の「元に戻す」を使ってください。'; updateBulkCalendarControls(); return; }
  const count = bulkCalendarUndoSnapshot?.length || 0;
  if (undoHistory()) { bulkCalendarUndoSnapshot = null; bulkCalendarStatus = `${count}日の直前の変更を元に戻しました。`; renderBulkCalendar(); }
}

function updateBadgeElement(badge, state) {
  badge.dataset.state = String(state);
  badge.className = `todo-badge state-${state}`;
  badge.textContent = ({ 0: '未', 1: '途', 2: '済', 3: '急' })[state] || '未';
}
function bindEditorEvents() {
  const right = document.getElementById('right-panel');
  if (!right || right.dataset.taskkanriBound) return;
  right.dataset.taskkanriBound = 'true';
  right.addEventListener('click', event => {
    const badge = event.target.closest?.('.todo-badge');
    if (!badge || !right.contains(badge)) return;
    const next = (Number(badge.dataset.state) + 1) % 4;
    updateBadgeElement(badge, next);
    const input = badge.closest('.slot-input');
    if (input) input.dispatchEvent(new Event('blur'));
  });
}
function extractTasksForDisplay(html, dateId, slotName) {
  return extractTodoItems(html).map(item => ({ ...item, dateId, slotName }));
}
function openTodoModal() {
  const tbody = document.getElementById('todo-list-tbody'); if (!tbody) return;
  tbody.replaceChildren();
  const tasks = extractTasksForDisplay(appState.globalTaskData, 'GLOBAL', '共通タスク');
  academicDateIds().forEach(dateId => APP_CONFIG.slotsAll.forEach(slot => tasks.push(...extractTasksForDisplay(resolvedSlot(dateId, slot), dateId, slot))));
  if (!tasks.length) {
    const row = el('tr'); const cell = el('td', '未完了のタスクはありません。\nお疲れ様です🍡🍡🍡'); cell.colSpan = 3; cell.style.whiteSpace = 'pre-line'; cell.style.textAlign = 'center'; cell.style.padding = '40px'; row.appendChild(cell); tbody.appendChild(row);
  } else tasks.forEach(task => {
    const row = el('tr'); row.className = 'todo-row';
    row.addEventListener('click', () => task.dateId === 'GLOBAL' ? closeTodoModal() : jumpToDateFromTodo(task.dateId));
    const dateCell = el('td', task.dateId === 'GLOBAL' ? '共通' : (() => { const date = dateFromIso(task.dateId); return `${date.getMonth() + 1}/${date.getDate()}(${APP_CONFIG.daysStr[date.getDay()]})`; })());
    const slotCell = el('td', task.slotName);
    const taskCell = el('td');
    const badge = el('span', ({ 0: '未', 1: '途', 3: '急' })[task.state] || '未'); badge.className = `todo-badge state-${task.state}`; badge.style.cursor = 'default'; badge.style.marginRight = '8px';
    taskCell.append(badge, document.createTextNode(task.text));
    [dateCell, slotCell, taskCell].forEach(cell => { cell.style.border = '1px solid #cbd5e0'; cell.style.padding = '8px'; });
    tbody.appendChild(row).append(dateCell, slotCell, taskCell);
  });
  document.getElementById('todo-modal').style.display = 'flex';
}
function closeTodoModal() { const modal = document.getElementById('todo-modal'); if (modal) modal.style.display = 'none'; }
function jumpToDateFromTodo(dateId) { closeTodoModal(); renderEditor(dateId, 'top'); executeJump(dateId); }

function startTitleBlink(text) {
  stopTitleBlink();
  let on = false; const base = String(text).slice(0, 12);
  titleBlinkerId = setInterval(() => { on = !on; document.title = on ? `【🔔】${base}...` : `【　】${base}...`; }, 1000);
}
function stopTitleBlink() { if (titleBlinkerId) clearInterval(titleBlinkerId); titleBlinkerId = null; document.title = 'タスク管理くん'; }
function processAlarmHtml(html, sourceName, hour, minute, notifications) {
  const safe = sanitizeHtml(html);
  const pattern = /🔔\s*([0-9０-９]{1,2}[:：]?[0-9０-９]{2})([^<]*)/g;
  return safe.replace(pattern, (match, time, trailing) => {
    const digits = time.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/[^0-9]/g, '');
    const h = digits.length === 3 ? Number(digits.slice(0, 1)) : Number(digits.slice(0, 2));
    const m = Number(digits.slice(-2));
    if (h !== hour || m !== minute) return match;
    notifications.push(`【${sourceName}】 ${time}${trailing}`.trim());
    return `🔕<span style="color:#a0aec0;text-decoration:line-through double #a0aec0">${escapeHtmlText(`${time}${trailing}`)}</span>`;
  });
}
function showAlarmModal(messages) {
  const container = document.getElementById('alarm-msg-container'); if (!container) return;
  const open = document.getElementById('alarm-modal')?.style.display === 'flex';
  if (open) container.appendChild(el('hr'));
  messages.forEach((message, index) => { if (index) container.appendChild(el('br')); container.appendChild(el('div', message)); });
  const modal = document.getElementById('alarm-modal'); if (modal) modal.style.display = 'flex';
  startTitleBlink(messages[0] || 'アラーム');
}
function closeAlarmModal() { const modal = document.getElementById('alarm-modal'); if (modal) modal.style.display = 'none'; document.getElementById('alarm-msg-container')?.replaceChildren(); stopTitleBlink(); }
function checkAlarms(now) {
  const dateId = getIsoDateStr(now); const notifications = []; const before = clone(appState); let changed = false;
  if (appState.globalTaskData.includes('🔔')) {
    const next = processAlarmHtml(appState.globalTaskData, '共通タスク', now.getHours(), now.getMinutes(), notifications);
    if (next !== appState.globalTaskData) { appState.globalTaskData = next; changed = true; }
  }
  APP_CONFIG.slotsAll.forEach(slot => { const current = resolvedSlot(dateId, slot); if (!current?.includes('🔔')) return; const next = processAlarmHtml(current, getDisplaySlot(slot), now.getHours(), now.getMinutes(), notifications); if (next !== current) { setUserOverride(appState, dateId, slot, next); changed = true; } });
  if (changed) {
    const result = storageService.saveAll(appState);
    if (result.ok) { appState = result.state; updateHistoryControls(); } else { appState = before; notifySaveFailure(result); }
    refreshMainUI();
  }
  if (notifications.length) showAlarmModal(notifications);
}

function getFirstWord(html) {
  return stripHtml(html).replace(/^\s*(?:[①-⑳㉑-㉟㊱-㊿]|\(\d+\))\s*/, '').trim().split(/[\s\u00a0　]+/)[0] || '';
}
function getCircleNumber(value) {
  if (value >= 1 && value <= 20) return String.fromCharCode(0x245f + value);
  if (value >= 21 && value <= 35) return String.fromCharCode(0x3251 + value - 21);
  if (value >= 36 && value <= 50) return String.fromCharCode(0x32b1 + value - 36);
  return `(${value})`;
}
function removeLeadingCount(html) {
  const holder = el('div'); appendSafeRich(holder, html);
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue.trim()) {
      node.nodeValue = node.nodeValue.replace(/^\s*(?:[①-⑳㉑-㉟㊱-㊿]|\(\d+\))\s*/, '');
      break;
    }
    node = walker.nextNode();
  }
  qa('span', holder).forEach(span => { if (!span.textContent.trim() && !span.classList.contains('todo-badge')) span.remove(); });
  return sanitizeHtml(holder.innerHTML);
}
function addCountPrefix(html, number) {
  const holder = el('div'); appendSafeRich(holder, removeLeadingCount(html));
  const prefix = el('span', getCircleNumber(number)); prefix.style.fontWeight = 'bold'; prefix.style.color = '#1e3a8a';
  holder.insertBefore(prefix, holder.firstChild); holder.insertBefore(document.createTextNode(' '), prefix.nextSibling);
  return sanitizeHtml(holder.innerHTML);
}
function deleteCountWord(html, word) {
  const holder = el('div'); appendSafeRich(holder, html);
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let node = walker.nextNode();
  while (node) {
    const match = node.nodeValue.match(new RegExp(escaped, 'i'));
    if (match) { node.nodeValue = `${node.nodeValue.slice(0, match.index)}${node.nodeValue.slice(match.index + match[0].length)}`; break; }
    node = walker.nextNode();
  }
  return sanitizeHtml(holder.innerHTML);
}
function scanSchedulesForCount() {
  const start = document.getElementById('count-start-date')?.value || appState.countDateRange.start;
  const end = document.getElementById('count-end-date')?.value || appState.countDateRange.end;
  const targetSlots = APP_CONFIG.slotsAll.filter(slot => PERIOD_SLOTS.has(slot));
  previewCountData = appState.countSettings.map(condition => {
    const hits = [];
    if (condition.word.trim()) academicDateIds().forEach(dateId => {
      if (start && dateId < start || end && dateId > end) return;
      const date = dateFromIso(dateId); if (!date) return;
      targetSlots.forEach(slot => {
        const html = scheduleSlots(dateId)[slot]; if (!html || getFirstWord(html) !== condition.word.trim()) return;
        const policy = getDateSchedulePolicy(dateId, appState);
        const isExcludedByConfig = !appState.daySlotConfig?.[date.getDay()]?.[slot];
        const profile = getDayProfile(dateId);
        const isMorningOnly = ['short-am', 'morning'].includes(profile) && ['５限', '６限', '７限'].includes(slot);
        const isHolidayPeriod = policy.isEffectiveHoliday;
        const isFixedOffPeriod = policy.isFixedOffActive;
        const excluded = isExcludedByConfig || isMorningOnly || isHolidayPeriod || isFixedOffPeriod;
        const skippedDay = profile.startsWith('noclass') || ['exam', 'mock-exam'].includes(profile);
        hits.push({ dateId, slot, plainText: stripHtml(html), originalHtml: html, checked: !excluded && !skippedDay, trashed: false, excluded, excludedReason: policy.countExclusionReason || (isMorningOnly ? '午前時程により除外' : isExcludedByConfig ? '設定により除外' : '') });
      });
    });
    return { hits };
  });
}
function renderCountTags() {
  const container = document.getElementById('count-tags-container'); if (!container) return;
  container.replaceChildren();
  const tags = new Set();
  Object.values(appState.weeklyTemplate).forEach(slots => Object.values(slots).forEach(value => { const word = getFirstWord(value); if (word) tags.add(word); }));
  Object.values(appState.weeklyRules).forEach(slots => Object.values(slots).forEach(segments => segments.forEach(segment => { const word = getFirstWord(segment.content); if (word) tags.add(word); })));
  if (!tags.size) { container.appendChild(el('span', '※設定画面の「基本時間割」に入力すると、ここに自動抽出されます')); return; }
  Array.from(tags).sort().forEach(tag => {
    const button = el('button', `${appState.countSettings.some(condition => condition.word.trim() === tag) ? '✓ ' : '＋ '}${tag}`);
    button.type = 'button'; button.className = 'btn-s'; button.disabled = appState.countSettings.some(condition => condition.word.trim() === tag);
    button.addEventListener('click', () => insertCountTag(tag));
    container.appendChild(button);
  });
}
function insertCountTag(tag) {
  const active = document.activeElement;
  if (active?.classList.contains('cond-word-input')) { active.value = tag; updateCondWord(Number(active.dataset.idx), tag); return; }
  const empty = appState.countSettings.findIndex(condition => !condition.word.trim());
  if (empty >= 0) updateCondWord(empty, tag); else addCountConditionRow(tag);
}
function makeCountSettingRow(condition, index) {
  const row = el('div'); row.className = 'count-setting-row'; row.dataset.index = String(index);
  const handle = el('span', '⠿'); handle.className = 'count-drag-handle'; handle.title = 'ドラッグして並べ替え'; handle.setAttribute('aria-label', `${condition.word || '授業'}をドラッグして並べ替え`); handle.addEventListener('pointerdown', event => startCountDrag(event, index));
  const up = el('button', '↑'); up.type = 'button'; up.className = 'btn-s'; up.disabled = index === 0; up.title = '上へ移動'; up.addEventListener('click', () => moveCountCondition(index, index - 1));
  const down = el('button', '↓'); down.type = 'button'; down.className = 'btn-s'; down.disabled = index === appState.countSettings.length - 1; down.title = '下へ移動'; down.addEventListener('click', () => moveCountCondition(index, index + 1));
  const remove = el('button', '🗑️'); remove.type = 'button'; remove.className = 'btn-s'; remove.title = 'この設定を削除'; remove.addEventListener('click', () => removeCountConditionRow(index));
  const word = el('input'); word.type = 'text'; word.className = 'cond-word-input'; word.dataset.idx = String(index); word.value = condition.word; word.placeholder = '検索ワード';
  word.addEventListener('input', () => updateCondWord(index, word.value));
  word.addEventListener('change', () => updateCondWord(index, word.value));
  const mode = el('select'); mode.appendChild(el('option', 'DOWN⑩⑨〜')).value = 'down'; mode.appendChild(el('option', 'UP①②〜')).value = 'up'; mode.value = condition.mode; mode.addEventListener('change', () => updateCondMode(index, mode.value));
  const startLabel = el('label', '開始:'); const start = el('input'); start.type = 'number'; start.min = '0'; start.value = String(condition.start); start.addEventListener('change', () => updateCondStart(index, start.value));
  const count = el('span', `(${previewCountData[index]?.hits.filter(hit => hit.checked && !hit.trashed && !hit.excluded).length || 0}ｺﾏ)`); count.id = `hit-count-${index}`;
  row.append(handle, up, down, remove, word, mode, startLabel, start, count);
  return row;
}
function renderCountSettings() {
  const container = document.getElementById('count-settings-container'); if (!container) return;
  container.replaceChildren();
  appState.countSettings.forEach((condition, index) => container.appendChild(makeCountSettingRow(condition, index)));
  renderCountTags();
}
function startCountDrag(event, fromIndex) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const row = event.currentTarget.closest('.count-setting-row'); const container = document.getElementById('count-settings-container'); if (!row || !container) return;
  countDragState = { pointerId: event.pointerId, fromIndex, row, container, startY: event.clientY, started: false };
  row.setPointerCapture?.(event.pointerId); event.preventDefault();
  document.addEventListener('pointermove', moveCountDrag); document.addEventListener('pointerup', endCountDrag); document.addEventListener('pointercancel', endCountDrag);
}
function moveCountDrag(event) {
  const drag = countDragState; if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.started && Math.abs(event.clientY - drag.startY) >= 5) { drag.started = true; drag.row.classList.add('count-sortable-chosen'); }
  if (!drag.started) return;
  const target = qa('.count-setting-row', drag.container).find(row => row !== drag.row && event.clientY >= row.getBoundingClientRect().top && event.clientY <= row.getBoundingClientRect().bottom);
  if (target) drag.container.insertBefore(drag.row, event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2 ? target : target.nextSibling);
}
function endCountDrag(event) {
  const drag = countDragState; if (!drag || event.pointerId !== drag.pointerId) return;
  document.removeEventListener('pointermove', moveCountDrag); document.removeEventListener('pointerup', endCountDrag); document.removeEventListener('pointercancel', endCountDrag);
  const toIndex = qa('.count-setting-row', drag.container).indexOf(drag.row); const moved = drag.started && toIndex !== drag.fromIndex;
  drag.row.classList.remove('count-sortable-chosen'); countDragState = null;
  if (moved) moveCountCondition(drag.fromIndex, toIndex);
}
function moveCountCondition(fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= appState.countSettings.length || toIndex >= appState.countSettings.length || fromIndex === toIndex) return;
  const ok = commitState(state => { const [item] = state.countSettings.splice(fromIndex, 1); state.countSettings.splice(toIndex, 0, item); }, { historyLabel: '時数条件の並べ替え', historyScope: 'count' });
  if (ok) { const [preview] = previewCountData.splice(fromIndex, 1); previewCountData.splice(toIndex, 0, preview); renderCountSettings(); refreshCountViews(); }
}
function renderCountPreview() {
  const container = document.getElementById('count-preview-container'); if (!container) return;
  container.replaceChildren();
  let displayed = false;
  appState.countSettings.forEach((condition, groupIndex) => {
    const group = previewCountData[groupIndex]; if (!condition.word.trim() || !group?.hits.length) return;
    displayed = true;
    const countLabel = document.getElementById(`hit-count-${groupIndex}`);
    if (countLabel) countLabel.textContent = `(${group.hits.filter(hit => hit.checked && !hit.trashed && !hit.excluded).length}ｺﾏ)`;
    const column = el('div'); setStyle(column, { minWidth: '380px', maxWidth: '400px', flex: '1', flexShrink: '0', background: '#fff', border: '1px solid #cbd5e0', borderRadius: '6px', display: 'flex', flexDirection: 'column' });
    const heading = el('div', condition.word); setStyle(heading, { background: '#edf2f7', padding: '6px', fontSize: '13px', fontWeight: 'bold', textAlign: 'center', color: '#2d3748' });
    const rows = el('div'); rows.id = `count-col-scroll-${groupIndex}`; setStyle(rows, { flex: '1', overflowY: 'auto', paddingBottom: '5px' });
    let number = condition.start;
    group.hits.forEach((hit, hitIndex) => {
      const row = el('div'); row.className = `preview-row${hit.excluded ? ' excluded' : hit.trashed ? ' trashed' : !hit.checked ? ' skipped' : ''}`;
      const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = hit.checked; checkbox.disabled = hit.excluded || hit.trashed; checkbox.addEventListener('change', () => togglePreviewCheck(groupIndex, hitIndex, checkbox.checked));
      const date = dateFromIso(hit.dateId); const dateLabel = el('span', `${date.getMonth() + 1}/${date.getDate()}(${APP_CONFIG.daysStr[date.getDay()]}${hit.slot})`); dateLabel.style.width = '85px';
      const original = el('span', hit.plainText); original.style.width = '105px'; original.style.overflow = 'hidden'; original.style.textOverflow = 'ellipsis'; original.style.whiteSpace = 'nowrap'; setSafeTitle(original, hit.plainText);
      const after = el('span'); after.style.flex = '1';
      if (hit.excluded) after.textContent = `(${hit.excludedReason})`;
      else if (hit.trashed) after.textContent = '(消去)';
      else if (!hit.checked) after.textContent = '(スキップ)';
      else { after.textContent = `${getCircleNumber(number)} ${stripHtml(removeLeadingCount(hit.originalHtml))}`; if (condition.mode === 'up') number += 1; else number -= 1; }
      const trash = el('button', '🗑️'); trash.type = 'button'; trash.className = 'btn-s'; trash.disabled = hit.excluded; trash.title = '対象文字列を消去'; trash.addEventListener('click', () => toggleTrash(groupIndex, hitIndex));
      row.append(checkbox, dateLabel, original, el('span', '→'), after, trash); rows.appendChild(row);
    });
    const footer = el('div'); setStyle(footer, { padding: '6px', borderTop: '1px solid #cbd5e0' });
    const apply = el('button', 'この列を反映'); apply.type = 'button'; apply.className = 'menu-btn'; apply.style.width = '100%'; apply.addEventListener('click', () => applyCountColumn(groupIndex)); footer.appendChild(apply);
    column.append(heading, rows, footer); container.appendChild(column);
  });
  if (!displayed) container.appendChild(el('div', '検索ワードを入力すると、指定期間内のプレビューが表示されます。'));
}
function renderCountGrid() {
  const container = document.getElementById('count-grid-container'); if (!container) return;
  container.replaceChildren();
  const start = document.getElementById('count-start-date')?.value || appState.countDateRange.start;
  const end = document.getElementById('count-end-date')?.value || appState.countDateRange.end;
  if (!start || !end) return;
  const table = el('table'); table.className = 'count-grid-table';
  const periodSlots = APP_CONFIG.slotsAll.filter(slot => PERIOD_SLOTS.has(slot));
  const colgroup = el('colgroup');
  const dateCol = el('col'); dateCol.className = 'count-grid-date-col';
  const eventCol = el('col'); eventCol.className = 'count-grid-event-col';
  colgroup.append(dateCol, eventCol, ...periodSlots.map(() => el('col'))); table.appendChild(colgroup);
  const head = el('thead'); const headRow = el('tr'); ['日付(曜)', '行事予定', ...periodSlots].forEach((label, index) => { const cell = el('th', label); if (index === 1) cell.className = 'count-grid-event'; headRow.appendChild(cell); }); head.appendChild(headRow); table.appendChild(head);
  const body = el('tbody'); let date = dateFromIso(start); const last = dateFromIso(end);
  while (date && last && date <= last) {
    const dateId = getIsoDateStr(date); const row = el('tr'); row.className = getDayBgClass(dateId);
    const dateCell = el('td'); dateCell.appendChild(el('span', `${date.getMonth() + 1}/${date.getDate()}(${APP_CONFIG.daysStr[date.getDay()]})`)); const trashDay = el('button', '🗑️'); trashDay.type = 'button'; trashDay.className = 'btn-s'; trashDay.title = 'この日の授業を全消去/全復活'; trashDay.addEventListener('click', () => trashDayAll(dateId)); dateCell.appendChild(trashDay); row.appendChild(dateCell);
    const eventText = stripHtml(appState.configEvents[dateId] || (isEffectiveHoliday(dateId, appState) ? holidayName(dateId) : '')); const eventCell = el('td', eventText); eventCell.className = 'count-grid-event'; if (eventText) { setSafeTitle(eventCell, eventText); eventCell.setAttribute('aria-label', eventText); } row.appendChild(eventCell);
    periodSlots.forEach(slot => {
      const cell = el('td');
      previewCountData.forEach((group, groupIndex) => group.hits.forEach((hit, hitIndex) => {
        if (hit.dateId !== dateId || hit.slot !== slot) return;
        const wrapper = el('div'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = hit.checked; checkbox.disabled = hit.excluded || hit.trashed; checkbox.addEventListener('change', () => togglePreviewCheck(groupIndex, hitIndex, checkbox.checked));
        const word = el('span', appState.countSettings[groupIndex].word); word.title = hit.plainText; word.setAttribute('aria-label', `${hit.plainText} ${appState.countSettings[groupIndex].word}`); const trash = el('button', '🗑️'); trash.type = 'button'; trash.className = 'btn-s'; trash.disabled = hit.excluded; trash.title = '消去/復元'; trash.addEventListener('click', () => toggleTrash(groupIndex, hitIndex)); wrapper.append(checkbox, word, trash); cell.appendChild(wrapper);
      }));
      row.appendChild(cell);
    });
    body.appendChild(row); date.setDate(date.getDate() + 1);
  }
  table.appendChild(body); container.appendChild(table);
  if (!body.childElementCount) container.appendChild(el('div', '検索ワードにヒットする授業がありません。'));
}
function refreshCountViews() { renderCountPreview(); renderCountGrid(); }
function persistCountUiState() {
  const start = document.getElementById('count-start-date')?.value || '';
  const end = document.getElementById('count-end-date')?.value || '';
  return commitState(state => { state.countDateRange = { start, end }; }, { historyLabel: '時数集計期間の変更', historyScope: 'count' });
}
function updateCountDateRange() { if (persistCountUiState()) { scanSchedulesForCount(); renderCountSettings(); refreshCountViews(); } }
function toggleTrash(groupIndex, hitIndex) {
  const hit = previewCountData[groupIndex]?.hits[hitIndex]; if (!hit || hit.excluded) return;
  const nextTrashed = !hit.trashed;
  const delta = appState.countSettings[groupIndex].mode === 'down' && hit.checked ? (nextTrashed ? -1 : 1) : 0;
  if (commitState(state => { state.countSettings[groupIndex].start += delta; }, { historyLabel: '時数対象の変更', historyScope: 'count' })) {
    hit.trashed = nextTrashed;
    renderCountSettings(); refreshCountViews();
  }
}
function togglePreviewCheck(groupIndex, hitIndex, checked) {
  const hit = previewCountData[groupIndex]?.hits[hitIndex]; if (!hit || hit.excluded || hit.trashed) return;
  const delta = appState.countSettings[groupIndex].mode === 'down' ? (checked ? 1 : -1) : 0;
  if (commitState(state => { state.countSettings[groupIndex].start += delta; }, { historyLabel: '時数対象の変更', historyScope: 'count' })) {
    hit.checked = checked;
    renderCountSettings(); refreshCountViews();
  }
}
function applyCountColumn(groupIndex) {
  const group = previewCountData[groupIndex]; const condition = appState.countSettings[groupIndex]; if (!group || !condition?.word.trim()) return false;
  let number = condition.start; let changed = false;
  const ok = commitState(state => {
    group.hits.forEach(hit => {
      if (hit.excluded) return;
      if (hit.trashed) setUserOverride(state, hit.dateId, hit.slot, deleteCountWord(hit.originalHtml, condition.word));
      else if (hit.checked) { setUserOverride(state, hit.dateId, hit.slot, addCountPrefix(hit.originalHtml, number)); number += condition.mode === 'up' ? 1 : -1; }
      else setUserOverride(state, hit.dateId, hit.slot, removeLeadingCount(hit.originalHtml));
      changed = true;
    });
  }, { historyLabel: '時数連番の反映', historyScope: 'count' });
  if (ok && changed) { scanSchedulesForCount(); refreshCountViews(); refreshMainUI(); }
  return ok && changed;
}
function applyCountAll() {
  let applied = false;
  if (!commitState(state => appState.countSettings.forEach((condition, index) => {
    const group = previewCountData[index]; if (!condition.word.trim() || !group) return;
    let number = condition.start;
    group.hits.forEach(hit => {
      if (hit.excluded) return;
      if (hit.trashed) setUserOverride(state, hit.dateId, hit.slot, deleteCountWord(hit.originalHtml, condition.word));
      else if (hit.checked) { setUserOverride(state, hit.dateId, hit.slot, addCountPrefix(hit.originalHtml, number)); number += condition.mode === 'up' ? 1 : -1; }
      else setUserOverride(state, hit.dateId, hit.slot, removeLeadingCount(hit.originalHtml));
      applied = true;
    });
  }), { historyLabel: '時数連番の一括反映', historyScope: 'count' })) return;
  if (applied) { scanSchedulesForCount(); refreshCountViews(); refreshMainUI(); showAlert('連番を振ってカレンダーに反映しました。'); }
}
function applyGridCleaning() {
  let applied = false;
  if (!commitState(state => appState.countSettings.forEach((condition, index) => {
    const group = previewCountData[index]; if (!condition.word.trim() || !group) return;
    group.hits.forEach(hit => { if (hit.excluded) return; if (hit.trashed) setUserOverride(state, hit.dateId, hit.slot, deleteCountWord(hit.originalHtml, condition.word)); else if (!hit.checked) setUserOverride(state, hit.dateId, hit.slot, removeLeadingCount(hit.originalHtml)); applied = true; });
  }), { historyLabel: '時数連番の整理', historyScope: 'count' })) applied = false;
  if (applied) { showAlert('お掃除内容（消去・番号除去）をカレンダーに反映しました。'); refreshMainUI(); }
  else showAlert('反映する変更（ゴミ箱行き、またはスキップ）がありません。');
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function exportCountToCSV() {
  let csv = '\ufeff日付,曜日,時限,授業名,回数(番号)\n'; let hasData = false;
  appState.countSettings.forEach((condition, groupIndex) => {
    if (!condition.word.trim() || !previewCountData[groupIndex]) return;
    let number = condition.start;
    previewCountData[groupIndex].hits.forEach(hit => {
      if (hit.trashed || !hit.checked || hit.excluded) return;
      const date = dateFromIso(hit.dateId); hasData = true;
      csv += [hit.dateId, APP_CONFIG.daysStr[date.getDay()], hit.slot, condition.word, getCircleNumber(number)].map(csvCell).join(',') + '\n';
      number += condition.mode === 'up' ? 1 : -1;
    });
  });
  if (!hasData) { showAlert('指定期間内に出力する予定データがありません。'); return; }
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = el('a'); link.href = url; link.download = `授業予定一覧_${toYYMMDD(getIsoDateStr(new Date()))}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
function switchCountMode(mode) {
  currentCountMode = mode;
  const list = document.getElementById('count-preview-container'); const grid = document.getElementById('count-grid-container'); const listTab = document.getElementById('tab-list'); const gridTab = document.getElementById('tab-grid'); const listButton = document.getElementById('btn-apply-list'); const gridButton = document.getElementById('btn-apply-grid');
  const isList = mode === 'list';
  if (list) list.style.display = isList ? 'flex' : 'none'; if (grid) grid.style.display = isList ? 'none' : 'block'; if (listTab) listTab.classList.toggle('active', isList); if (gridTab) gridTab.classList.toggle('active', !isList); if (listButton) listButton.style.display = isList ? 'block' : 'none'; if (gridButton) gridButton.style.display = isList ? 'none' : 'block';
}
function openCountModal() {
  const range = appState.countDateRange.start && appState.countDateRange.end ? appState.countDateRange : getSmartDateRange();
  const start = document.getElementById('count-start-date'); const end = document.getElementById('count-end-date'); if (start) start.value = range.start; if (end) end.value = range.end;
  scanSchedulesForCount(); renderCountSettings(); refreshCountViews(); switchCountMode(currentCountMode); document.getElementById('count-modal').style.display = 'flex';
}
function closeCountModal() { document.getElementById('count-modal').style.display = 'none'; refreshMainUI(); }
function addCountConditionRow(initialWord = '') { if (commitState(state => state.countSettings.push({ word: initialWord, mode: 'down', start: 1 }), { historyLabel: '時数条件の追加', historyScope: 'count' })) { scanSchedulesForCount(); renderCountSettings(); refreshCountViews(); } }
function removeCountConditionRow(index) { if (appState.countSettings.length <= 1) return; if (commitState(state => state.countSettings.splice(index, 1), { historyLabel: '時数条件の削除', historyScope: 'count' })) { scanSchedulesForCount(); renderCountSettings(); refreshCountViews(); } }
function updateCondWord(index, value) {
  const nextWord = String(value ?? '');
  if (!appState.countSettings[index]) return;
  if (appState.countSettings[index]?.word === nextWord) return;
  if (!commitState(state => { state.countSettings[index].word = nextWord; }, { historyLabel: '時数条件名の変更', historyScope: 'count' })) return;
  scanSchedulesForCount();
  if (appState.countSettings[index].mode === 'down') {
    const nextStart = previewCountData[index].hits.filter(hit => hit.checked && !hit.trashed && !hit.excluded).length;
    if (!commitState(state => { state.countSettings[index].start = nextStart; }, { skipHistory: true })) return;
    historyManager.replaceLatestAfter(appState);
    updateHistoryControls();
  }
  const startInput = document.querySelector(`.count-setting-row[data-index="${index}"] input[type="number"]`);
  if (startInput) startInput.value = String(appState.countSettings[index].start);
  renderCountTags(); refreshCountViews();
}
function updateCondMode(index, value) { if (!['up', 'down'].includes(value)) return; if (commitState(state => { state.countSettings[index].mode = value; state.countSettings[index].start = value === 'up' ? 1 : (previewCountData[index]?.hits.filter(hit => hit.checked && !hit.trashed && !hit.excluded).length || 1); }, { historyLabel: '時数条件の方式変更', historyScope: 'count' })) { renderCountSettings(); refreshCountViews(); } }
function updateCondStart(index, value) { const number = Number(value); if (!Number.isInteger(number) || number < 0) return; if (commitState(state => { state.countSettings[index].start = number; }, { historyLabel: '時数開始番号の変更', historyScope: 'count' })) refreshCountViews(); }
function trashDayAll(dateId) {
  const hits = []; previewCountData.forEach((group, groupIndex) => group.hits.forEach((hit, hitIndex) => { if (hit.dateId === dateId && !hit.excluded) hits.push({ groupIndex, hitIndex, hit }); }));
  const activate = hits.some(item => !item.hit.trashed);
  if (!hits.length) return;
  if (commitState(state => {
    hits.forEach(item => {
      const condition = state.countSettings[item.groupIndex];
      if (condition?.mode === 'down' && item.hit.checked && item.hit.trashed !== activate) condition.start += activate ? -1 : 1;
    });
  }, { historyLabel: '時数対象日の変更', historyScope: 'count' })) {
    hits.forEach(item => { item.hit.trashed = activate; });
    renderCountSettings(); refreshCountViews();
  }
}

function toggleDayRow(dayIndex) {
  const checkboxes = qa(`#day-slot-tbody input[data-day="${dayIndex}"][data-slot]`); const all = checkboxes.length && checkboxes.every(input => input.checked);
  checkboxes.forEach(input => { input.checked = !all; input.dispatchEvent(new Event('change')); });
  if (checkboxes.length) settingsDirtySections.add('schedule');
}
function syncTmplState(day, slot, checked) {
  qa('#weekly-tbody input[data-day][data-slot]').filter(input => input.dataset.day === String(day) && input.dataset.slot === slot && input.type === 'text').forEach(input => {
    input.disabled = !checked;
    input.classList.toggle('tmpl-disabled', !checked);
    input.title = checked ? '' : '表示コマ設定で無効（保存済み内容は保持）';
  });
}
function isInstructionDayDraft(day) {
  const input = document.querySelector(`#day-slot-tbody input[data-instruction-day="${day}"]`);
  return input ? input.checked : Boolean(appState.instructionDayConfig?.[day]);
}
function syncInstructionDayState(day, checked) {
  const row = document.querySelector(`#day-slot-tbody tr[data-day-row="${day}"]`);
  if (row) {
    row.classList.toggle('instruction-day-off', !checked);
    const status = row.querySelector('.instruction-day-status');
    if (status) status.textContent = checked ? '授業' : '休業';
    qa('input[data-slot]', row).forEach(input => {
      const disabled = !checked && PERIOD_SLOTS.has(input.dataset.slot);
      input.disabled = disabled;
      input.title = disabled ? '固定休業日のため非表示（設定は保持）' : input.dataset.slot;
    });
  }
  const header = document.querySelector(`#weekly-thead [data-weekly-day-header="${day}"]`);
  if (header) {
    header.textContent = `${APP_CONFIG.daysStr[day]}${checked ? '' : '（休）'}`;
    header.setAttribute('aria-label', `${APP_CONFIG.daysStr[day]}曜日${checked ? '' : '・固定休業日'}`);
  }
}
function renderSettingsTables() {
  const dayBody = document.getElementById('day-slot-tbody'); if (dayBody) {
    dayBody.replaceChildren();
    [1, 2, 3, 4, 5, 6, 0].forEach(day => {
      const instructionDay = Boolean(appState.instructionDayConfig?.[day]);
      const row = el('tr'); row.dataset.dayRow = String(day);
      const label = el('th', APP_CONFIG.daysStr[day]); label.scope = 'row';
      const allToggle = el('button', '全反転'); allToggle.type = 'button'; allToggle.className = 'btn-s day-slot-all-toggle'; allToggle.title = `${APP_CONFIG.daysStr[day]}曜日の表示枠を全反転`;
      allToggle.setAttribute('aria-label', `${APP_CONFIG.daysStr[day]}曜日の表示枠を全反転`); allToggle.addEventListener('click', () => toggleDayRow(day));
      label.appendChild(allToggle); row.appendChild(label);
      const instructionCell = el('td'); const instructionLabel = el('label'); instructionLabel.className = 'instruction-day-control';
      const instruction = el('input'); instruction.type = 'checkbox'; instruction.dataset.instructionDay = String(day); instruction.checked = instructionDay;
      instruction.setAttribute('aria-label', `${APP_CONFIG.daysStr[day]}曜日を授業日にする`);
      const status = el('span', instructionDay ? '授業' : '休業'); status.className = 'instruction-day-status';
      instruction.addEventListener('change', () => syncInstructionDayState(day, instruction.checked)); instructionLabel.append(instruction, status); instructionCell.appendChild(instructionLabel); row.appendChild(instructionCell);
      APP_CONFIG.slotsAll.forEach(slot => {
        const cell = el('td'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.dataset.day = String(day); checkbox.dataset.slot = slot; checkbox.checked = Boolean(appState.daySlotConfig[day][slot]);
        checkbox.disabled = !instructionDay && PERIOD_SLOTS.has(slot); checkbox.title = checkbox.disabled ? '固定休業日のため非表示（設定は保持）' : slot;
        checkbox.addEventListener('change', () => syncTmplState(day, slot, checkbox.checked)); cell.appendChild(checkbox); row.appendChild(cell);
      });
      dayBody.appendChild(row);
    });
  }
  const timeBody = document.getElementById('time-config-tbody'); if (timeBody) {
    timeBody.replaceChildren();
    APP_CONFIG.timeKeys.forEach(slot => { const row = el('tr'); row.appendChild(el('td', slot)); ['normal', 'short', 'exam'].forEach(group => { const cell = el('td'); const input = el('input'); input.type = 'time'; input.dataset.timeGroup = group; input.dataset.slot = slot; input.value = appState.timeConfig[group][slot] || ''; if (group === 'exam' && !['朝', '１限', '２限', '３限', '４限', '放課後'].includes(slot)) input.disabled = true; cell.appendChild(input); row.appendChild(cell); }); timeBody.appendChild(row); });
  }
  const weeklyBody = document.getElementById('weekly-tbody'); if (weeklyBody) {
    weeklyBody.replaceChildren();
    APP_CONFIG.slotsAll.forEach(slot => { const row = el('tr'); row.appendChild(el('td', slot)); for (let day = 1; day <= 7; day += 1) { const dayIndex = day === 7 ? 0 : day; const cell = el('td'); const input = el('input'); input.type = 'text'; input.dataset.day = String(dayIndex); input.dataset.slot = slot; input.value = stripHtml(appState.weeklyTemplate[dayIndex]?.[slot] || ''); input.disabled = !appState.daySlotConfig[dayIndex][slot]; input.classList.toggle('tmpl-disabled', input.disabled); input.title = input.disabled ? '表示コマ設定で無効（保存済み内容は保持）' : ''; cell.appendChild(input); row.appendChild(cell); } weeklyBody.appendChild(row); });
    qa('#weekly-tbody input[type="text"]').forEach(input => input.addEventListener('keydown', handleTableNav));
  }
  [1, 2, 3, 4, 5, 6, 0].forEach(day => syncInstructionDayState(day, isInstructionDayDraft(day)));
}
function openSettingsView() {
  isHydratingSettings = true;
  const year = document.getElementById('academic-year-input'); if (year) year.value = String(appState.currentYear);
  const range = getSmartDateRange(); const start = document.getElementById('tmpl-start'); const end = document.getElementById('tmpl-end'); if (start) start.value = range.start; if (end) end.value = range.end;
  const layout = document.querySelector(`input[name="layout-mode"][value="${appState.isLandscapeMode ? 'landscape' : 'portrait'}"]`); if (layout) layout.checked = true;
  renderSettingsTables();
  const legacySummary = document.getElementById('legacy-override-summary');
  if (legacySummary) {
    let legacy = 0; let same = 0; let different = 0; let cancelled = 0;
    Object.entries(appState.dateOverrides).forEach(([dateId, day]) => Object.entries(day.slots).forEach(([slot, override]) => {
      if (override.action === 'cancel') { cancelled += 1; return; }
      if (override.source === 'legacy') { legacy += 1; if (override.content === getWeeklyRuleSlot(dateId, slot, appState)) same += 1; else different += 1; }
    }));
    legacySummary.textContent = `旧データ由来 ${legacy}件（基本時間割と同内容 ${same}件 / 異なる内容 ${different}件）、取消 ${cancelled}件。自動整理は行いません。`;
  }
  const bounds = academicYearBounds(appState.currentYear);
  const annual = document.getElementById('annual-text-ui'); if (annual) annual.value = Object.keys(appState.configEvents).filter(key => key >= bounds.start && key <= bounds.end).sort().map(key => `${toYYMMDD(key)}:${stripHtml(appState.configEvents[key])}`).join('\n');
  const holidays = document.getElementById('holiday-text-ui'); if (holidays) holidays.value = Object.keys(appState.customHolidays).filter(key => key >= bounds.start && key <= bounds.end).sort().map(key => `${toYYMMDD(key)}:${stripHtml(appState.customHolidays[key])}`).join('\n');
  const usage = document.getElementById('storage-usage-disp'); if (usage) usage.textContent = ((storageService?.ownedKeys?.() || []).reduce((sum, key) => sum + ((storageLike.getItem(key)?.length || 0) + key.length) * 2, 0) / 1024).toFixed(2);
  renderQuarantineUI(); settingsDirtySections.clear(); document.getElementById('settings-view').style.display = 'block'; isHydratingSettings = false;
}
function markSettingsDirty(target) {
  if (isHydratingSettings || !(target instanceof Element)) return;
  const section = target.closest('[data-settings-section]')?.dataset.settingsSection;
  if (section) settingsDirtySections.add(section);
}
function clearSettingsDirty(section) { settingsDirtySections.delete(section); }
function closeSettingsView() {
  if (settingsDirtySections.size && !showConfirm('保存していない変更があります。破棄してメイン画面に戻りますか？')) return;
  settingsDirtySections.clear(); document.getElementById('settings-view').style.display = 'none'; refreshMainUI();
}
function handleTableNav(event) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  const inputs = qa('#weekly-tbody input[type="text"]:not(:disabled)'); const index = inputs.indexOf(event.currentTarget); let next = index;
  if (event.key === 'ArrowDown' || event.key === 'Enter' && !event.shiftKey) next += 1;
  else if (event.key === 'ArrowUp' || event.key === 'Enter') next -= 1;
  else if (event.key === 'ArrowRight' || event.key === 'Tab') next += 1;
  else next -= 1;
  inputs[Math.max(0, Math.min(inputs.length - 1, next))]?.focus();
}
function parseTextareaMap(value, fieldLabel) {
  const result = {};
  for (const line of String(value ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':'); if (colon < 0) throw new Error(`${fieldLabel}: YYMMDD:内容の形式が必要です`);
    const dateId = fromYYMMDD(line.slice(0, colon).trim()); if (!dateId) throw new Error(`${fieldLabel}: 実在する日付が必要です (${line.slice(0, colon).trim()})`);
    const text = sanitizeHtml(line.slice(colon + 1).trim()); if (stripHtml(text)) result[dateId] = text;
  }
  return result;
}
function replaceAcademicYearDateMap(existing, replacement) {
  const bounds = academicYearBounds(appState.currentYear);
  const next = {};
  Object.entries(existing || {}).forEach(([dateId, value]) => { if (dateId < bounds.start || dateId > bounds.end) next[dateId] = value; });
  return { ...next, ...replacement };
}
function academicYearRolloverStorageUsageKb() {
  const bytes = (storageService?.ownedKeys?.() || []).reduce((sum, key) => sum + ((storageLike?.getItem(key)?.length || 0) + key.length) * 2, 0);
  return (bytes / 1024).toFixed(2);
}
function buildAcademicYearRolloverPlan() {
  const copyBaseTimetable = Boolean(document.getElementById('academic-year-rollover-weekly')?.checked);
  return planAcademicYearRollover(appState, {
    sourceYear: appState.currentYear,
    targetYear: appState.currentYear + 1,
    copyBaseTimetable
  });
}
function renderAcademicYearRolloverHolidayReview(value) {
  const wrap = document.getElementById('academic-year-rollover-holiday-review');
  const list = document.getElementById('academic-year-rollover-holiday-list');
  const confirmationWrap = document.getElementById('academic-year-rollover-holiday-confirm-wrap');
  const confirmation = document.getElementById('academic-year-rollover-holiday-confirm');
  const bounds = academicYearBounds(value.targetYear);
  const tentative = Object.entries(value.nextCalendarHolidays || {})
    .filter(([dateId, entry]) => dateId >= bounds.start && dateId <= bounds.end && entry?.status === 'tentative')
    .sort(([left], [right]) => left.localeCompare(right));
  const needed = tentative.length > 0;
  if (wrap) { wrap.hidden = !needed; wrap.style.display = needed ? 'block' : 'none'; }
  if (confirmationWrap) { confirmationWrap.hidden = !needed; confirmationWrap.style.display = needed ? 'flex' : 'none'; }
  if (!needed && confirmation) confirmation.checked = false;
  if (list) {
    list.replaceChildren();
    tentative.forEach(([dateId, entry]) => {
      const item = document.createElement('li');
      item.textContent = `${dateId}　${stripHtml(entry.name)}`;
      list.appendChild(item);
    });
  }
  return needed;
}
function renderAcademicYearRolloverPreview() {
  const preview = document.getElementById('academic-year-rollover-preview');
  const heading = document.getElementById('academic-year-rollover-heading');
  const execute = document.getElementById('academic-year-rollover-execute');
  const plan = buildAcademicYearRolloverPlan();
  if (!plan.ok) {
    if (preview) preview.textContent = `繰越を開始できません。${plan.error}`;
    if (execute) execute.disabled = true;
    return null;
  }
  const value = plan.value;
  if (heading) heading.textContent = `${value.sourceYear}年度から${value.targetYear}年度へ繰り越します`;
  const excluded = value.excludedCounts;
  const counts = value.counts;
  const needsHolidayConfirmation = renderAcademicYearRolloverHolidayReview(value);
  const holidayConfirmation = document.getElementById('academic-year-rollover-holiday-confirm');
  const needsResetConfirmation = counts.removedTargetRules > 0 || counts.removedTargetEvents > 0;
  const confirmationWrap = document.getElementById('academic-year-rollover-reset-confirm-wrap');
  const confirmation = document.getElementById('academic-year-rollover-reset-confirm');
  if (confirmationWrap) { confirmationWrap.hidden = !needsResetConfirmation; confirmationWrap.style.display = needsResetConfirmation ? 'flex' : 'none'; }
  if (!needsResetConfirmation && confirmation) confirmation.checked = false;
  const lines = [
    value.copyBaseTimetable
      ? `基本時間割: コピーします。週間授業規則は ${value.candidateCount}件を確認し、${value.copiedCount}件を作成予定です。`
      : '基本時間割: 空にします。週間授業規則は作成しません。',
    `次年度に入力済みの週間授業規則: ${counts.removedTargetRules}件を削除予定${counts.splitRules ? `（年度境界で ${counts.splitRules}件を分割して年度外は保持）` : ''}。`,
    `年間行事: 次年度分 ${counts.removedTargetEvents}件をリセットします（元年度の行事は保持）。`,
    `暦上の祝日: 次年度分を設定します（確定 ${counts.confirmedHolidays}件 / 暫定 ${counts.tentativeHolidays}件）。学校独自休日は元年度からコピーしません。`,
    needsHolidayConfirmation ? '暫定日: 下の一覧を公式発表と照合してから、確認欄にチェックしてください。' : '',
    `繰越先に既にあるデータは保持: 学校独自休日 ${counts.preservedTargetCustomHolidays}日 / 日別変更 ${counts.preservedTargetOverrides}日 / 日別状態 ${counts.preservedTargetDayProfiles}日。`,
    `元年度からコピーしないデータ: 日別変更 ${excluded.dateOverrides}日 / 行事 ${excluded.configEvents}日 / 日別状態 ${excluded.dayProfiles}日 / 学校独自休日 ${excluded.customHolidays}日。`,
    `時数集計期間: ${value.nextCountDateRange.start} ～ ${value.nextCountDateRange.end} に設定します。開始番号は変更しません。`,
    `現在のTaskKanri保存領域: 約 ${academicYearRolloverStorageUsageKb()} KB。実行前に復旧snapshotを作成します。`
  ].filter(Boolean);
  if (preview) preview.textContent = lines.join('\n');
  if (execute) { execute.disabled = (needsResetConfirmation && !confirmation?.checked) || (needsHolidayConfirmation && !holidayConfirmation?.checked); execute.textContent = `${value.targetYear}年度へ繰り越す`; }
  return plan;
}
function openAcademicYearRolloverModal() {
  if (settingsDirtySections.size) { showAlert('保存していない設定があります。先に保存するか、設定画面を開き直してから年度繰越を開始してください。'); return; }
  if (!storageService || storageService.isReadOnly()) { notifySaveFailure({ error: `読み取り専用相当です: ${storageService?.readOnlyReason?.() || ''}` }); return; }
  academicYearRolloverInvoker = document.activeElement;
  const weekly = document.getElementById('academic-year-rollover-weekly');
  if (weekly) weekly.checked = false;
  const confirmation = document.getElementById('academic-year-rollover-reset-confirm');
  if (confirmation) confirmation.checked = false;
  const holidayConfirmation = document.getElementById('academic-year-rollover-holiday-confirm');
  if (holidayConfirmation) holidayConfirmation.checked = false;
  const modal = document.getElementById('academic-year-rollover-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  renderAcademicYearRolloverPreview();
  setTimeout(() => document.getElementById('academic-year-rollover-title')?.focus(), 0);
}
function closeAcademicYearRolloverModal() {
  const modal = document.getElementById('academic-year-rollover-modal');
  if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden', 'true'); }
  academicYearRolloverInvoker?.focus?.();
  academicYearRolloverInvoker = null;
}
function handleAcademicYearRolloverKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); closeAcademicYearRolloverModal(); return; }
  if (event.key !== 'Tab') return;
  const dialog = document.querySelector('#academic-year-rollover-modal [role="dialog"]');
  const focusables = qa('button:not([disabled]), input:not([disabled])', dialog).filter(node => node.offsetParent !== null);
  if (!focusables.length) return;
  if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1).focus(); }
  else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0].focus(); }
}
function executeAcademicYearRollover() {
  const plan = buildAcademicYearRolloverPlan();
  if (!plan.ok) { showAlert(plan.error); return; }
  const value = plan.value;
  const needsResetConfirmation = value.counts.removedTargetRules > 0 || value.counts.removedTargetEvents > 0;
  if (needsResetConfirmation && !document.getElementById('academic-year-rollover-reset-confirm')?.checked) { showAlert('次年度に入力済みの基本時間割規則・年間行事を削除する確認にチェックしてください。'); return; }
  if (value.counts.tentativeHolidays > 0 && !document.getElementById('academic-year-rollover-holiday-confirm')?.checked) { showAlert('暫定日の一覧を内閣府の公式発表と照合し、確認にチェックしてください。'); return; }
  const snapshot = storageService.createRecoverySnapshot();
  if (!snapshot.ok) { notifySaveFailure(snapshot); return; }
  const applied = applyAcademicYearRollover(appState, plan);
  if (!applied.ok) { showAlert(applied.error); return; }
  const copied = value.copyBaseTimetable ? `基本時間割と${value.copiedCount}件の週間授業規則` : '基本時間割を空にし、週間授業規則を作成せず';
  if (!commitState(state => Object.assign(state, applied.value), { refresh: true, historyLabel: `年度繰越 ${value.sourceYear}→${value.targetYear}`, historyScope: 'academic-year-rollover' })) return;
  closeAcademicYearRolloverModal();
  settingsDirtySections.clear();
  const settings = document.getElementById('settings-view');
  if (settings) settings.style.display = 'none';
  refreshMainUI();
  showAlert(`${value.targetYear}年度へ繰り越しました（${copied}）。「元に戻す」で繰越全体を取り消せます。復旧snapshot: ${snapshot.key}`);
}
function saveBasicSettings() {
  const year = Number(document.getElementById('academic-year-input')?.value); const layout = document.querySelector('input[name="layout-mode"]:checked')?.value;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !['portrait', 'landscape'].includes(layout)) { showAlert('年度または画面レイアウトが不正です。'); return; }
  const plan = planAcademicYearChange(appState, year);
  if (!plan.ok) { showAlert(plan.error); return; }
  if (year !== appState.currentYear) {
    const counts = plan.value.counts;
    const message = [
      `${appState.currentYear}年度から${year}年度へ変更します。既存データは削除しません。`,
      `年度外に残る件数: 日別変更 ${counts.dateOverrides}日 / 行事 ${counts.configEvents}日 / 日別状態 ${counts.dayProfiles}日 / 祝日 ${counts.customHolidays}日 / 時数期間 ${counts.countDateRange}件`,
      plan.value.automaticRange ? `時数期間は ${plan.value.nextBounds.start} ～ ${plan.value.nextBounds.end} に更新します。` : (plan.value.rangeOutside ? '指定済みの時数期間は年度外を含みますが、そのまま保持します。' : '指定済みの時数期間はそのまま保持します。'),
      '続行しますか？'
    ].join('\n');
    if (!showConfirm(message)) return;
  }
  if (commitState(state => { state.currentYear = year; state.isLandscapeMode = layout === 'landscape'; state.countDateRange = plan.value.nextCountDateRange; state.calendarHolidays = plan.value.nextCalendarHolidays; }, { historyLabel: '基本設定・年度の変更', historyScope: 'settings' })) { document.body.className = layout === 'landscape' ? 'layout-landscape' : 'layout-portrait'; clearSettingsDirty('basic'); refreshMainUI(); showAlert('基本設定を保存しました。'); }
}
function saveTimeConfig() {
  const next = clone(appState.timeConfig); const slots = clone(appState.daySlotConfig); const instructionDays = clone(appState.instructionDayConfig);
  qa('input[data-time-group]').forEach(input => { next[input.dataset.timeGroup][input.dataset.slot] = input.value; });
  qa('#day-slot-tbody input[data-slot]').forEach(input => { slots[input.dataset.day][input.dataset.slot] = input.checked; });
  qa('#day-slot-tbody input[data-instruction-day]').forEach(input => { instructionDays[input.dataset.instructionDay] = input.checked; });
  if (commitState(state => { state.timeConfig = next; state.daySlotConfig = slots; state.instructionDayConfig = instructionDays; }, { historyLabel: '授業日・時程・使用時限の変更', historyScope: 'settings' })) { clearSettingsDirty('schedule'); refreshMainUI(); showAlert('授業日・表示コマ・チャイムを保存しました。'); }
}
function collectWeeklyTemplateFromInputs() {
  const weekly = clone(appState.weeklyTemplate);
  qa('#weekly-tbody input[type="text"]').forEach(input => {
    if (input.disabled) return;
    const day = input.dataset.day; const slot = input.dataset.slot; const clean = sanitizeHtml(input.value);
    if (stripHtml(clean)) {
      if (!weekly[day]) weekly[day] = {};
      weekly[day][slot] = clean;
    } else if (weekly[day]) {
      delete weekly[day][slot];
      if (!Object.keys(weekly[day]).length) delete weekly[day];
    }
  });
  return weekly;
}
function saveWeekly() {
  const weekly = collectWeeklyTemplateFromInputs();
  if (commitState(state => { state.weeklyTemplate = weekly; }, { historyLabel: '基本時間割の下書き保存', historyScope: 'weekly-template' })) { clearSettingsDirty('weekly'); showAlert('基本時間割の下書きを保存しました。日別予定は変更していません。'); }
}
function applyWeeklyRange() {
  const start = document.getElementById('tmpl-start')?.value; const end = document.getElementById('tmpl-end')?.value;
  if (!isValidIsoDate(start) || !isValidIsoDate(end) || start > end) { showAlert('適用期間の日付が不正です。'); return; }
  const weekly = collectWeeklyTemplateFromInputs();
  const rules = qa('#weekly-tbody input[type="text"]:not(:disabled)').map(input => ({ day: input.dataset.day, slot: input.dataset.slot, content: sanitizeHtml(input.value) })).filter(rule => stripHtml(rule.content).trim());
  const overlap = rules.reduce((total, rule) => total + (appState.weeklyRules[rule.day]?.[rule.slot] || []).filter(segment => segment.from <= end && segment.to >= start).length, 0);
  const overrides = Object.entries(appState.dateOverrides).filter(([dateId]) => dateId >= start && dateId <= end).reduce((total, [, day]) => total + Object.keys(day.slots).length, 0);
  const message = [`対象期間: ${start} ～ ${end}`, `登録する規則: ${rules.length}コマ`, `重なる既存規則: ${overlap}件（安全に分割・置換します）`, `日別変更: ${overrides}件（基本時間割より優先され、そのまま残ります）`, '基本時間割として適用しますか？'].join('\n');
  if (!showConfirm(message)) return;
  const snapshot = storageService.createRecoverySnapshot();
  if (!snapshot.ok) { notifySaveFailure(snapshot); return; }
  let next = clone(appState); next.weeklyTemplate = weekly;
  for (const rule of rules) { const result = replaceWeeklyRuleRange(next, rule.day, rule.slot, start, end, rule.content); if (!result.ok) { showAlert(result.error); return; } next = result.value; }
  if (commitState(state => Object.assign(state, next), { historyLabel: '基本時間割の適用', historyScope: 'weekly-rule' })) { clearSettingsDirty('weekly'); showAlert(`基本時間割を適用しました。復旧snapshot: ${snapshot.key}`); refreshMainUI(); }
}
function saveAnnual() {
  try { const parsed = parseTextareaMap(document.getElementById('annual-text-ui')?.value, '年間行事'); if (commitState(state => { state.configEvents = replaceAcademicYearDateMap(state.configEvents, parsed); }, { historyLabel: '年間行事の保存', historyScope: 'event' })) { clearSettingsDirty('events'); showAlert('現在年度の年間行事を保存しました。'); refreshMainUI(); } } catch (error) { showAlert(error.message); }
}
function saveHolidays() {
  try { const parsed = parseTextareaMap(document.getElementById('holiday-text-ui')?.value, '学校独自休日'); if (commitState(state => { state.customHolidays = replaceAcademicYearDateMap(state.customHolidays, parsed); }, { historyLabel: '学校独自休日の保存', historyScope: 'holiday' })) { clearSettingsDirty('holidays'); showAlert('現在年度の学校独自休日を保存しました。'); refreshMainUI(); } } catch (error) { showAlert(error.message); }
}

function exportData() {
  const serialized = serializePayload(appState); if (!serialized.ok) { showAlert(serialized.error); return; }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const filename = `TaskKanri_build-${APP_CONFIG.buildVersion}_schema-${APP_CONFIG.schemaVersion}_${stamp}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(serialized.value, null, 2)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
function importData(event) {
  const input = event?.target; const file = input?.files?.[0];
  if (!file) { if (input) input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = loadEvent => {
    try {
      const prepared = normalizeImportedPayload(loadEvent.target.result);
      if (!prepared.ok) { showAlert(`インポートを中止しました。${prepared.error}`); return; }
      const result = storageService.importRaw(loadEvent.target.result, { confirm: summary => showConfirm(`このデータを読み込みますか？\n${formatStateSummary(summary)}\n\n読み込み前に復旧snapshotを作成します。`) });
      if (!result.ok) { if (!result.cancelled) showAlert(result.error); return; }
      appState = result.state; historyManager.clear(); updateHistoryControls(); showStorageWarning(); renderQuarantineUI(); refreshMainUI(); showAlert(`インポートが完了しました。${formatStateSummary(result.summary)}`);
    } catch (error) { showAlert(`ファイルの読み込みに失敗しました。${String(error?.message || error)}`); }
    finally { input.value = ''; }
  };
  reader.onerror = () => { input.value = ''; showAlert('ファイルの読み込みに失敗しました。'); };
  reader.readAsText(file);
}
function openResetModal() { const modal = document.getElementById('reset-confirm-modal'); if (modal) modal.style.display = 'flex'; document.getElementById('btn-reset-cancel')?.focus(); }
function closeResetModal() { const modal = document.getElementById('reset-confirm-modal'); if (modal) modal.style.display = 'none'; }
function executeReset() {
  if (!showConfirm('TaskKanriの保存データ、復旧snapshot、隔離データを初期化しますか？')) return;
  const result = storageService.reset();
  if (!result.ok) { showAlert(`${result.error}\n削除失敗: ${result.failed.map(item => item.key).join(', ')}`); showStorageWarning(result.error); return; }
  appState = result.state || defaultState(); historyManager.clear(); updateHistoryControls(); closeResetModal(); showAlert(`TaskKanriのデータを初期化しました（${result.removed.length}キー削除）。他アプリのデータは削除していません。`); location.reload();
}
function getQuarantineDownloadPayload() { return { app: 'TaskKanri', buildVersion: APP_CONFIG.buildVersion, exportedAt: new Date().toISOString(), records: storageService.getQuarantineRecords() }; }
function downloadQuarantinedData() {
  const records = storageService.getQuarantineRecords(); if (!records.length) { showAlert('ダウンロードする隔離データはありません。'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(getQuarantineDownloadPayload(), null, 2)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = `TaskKanri_quarantine_${APP_CONFIG.buildVersion}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
function deleteAllQuarantinedData() {
  const records = storageService.getQuarantineRecords(); if (!records.length) return;
  if (!showConfirm(`隔離データ${records.length}件を削除しますか？ダウンロード済みか確認してください。`)) return;
  const failures = records.map(item => storageService.deleteQuarantine(item.key)).filter(result => !result.ok);
  if (failures.length) showAlert('隔離データの一部を削除できませんでした。');
  renderQuarantineUI(); showStorageWarning();
}
function renderQuarantineUI() {
  const list = document.getElementById('quarantine-list'); const status = document.getElementById('storage-guard-status'); if (!list || !status || !storageService) return;
  const records = storageService.getQuarantineRecords(); list.replaceChildren();
  const reason = storageService.isReadOnly() ? `読み取り専用相当: ${storageService.readOnlyReason()}` : '';
  status.textContent = reason || (records.length ? `隔離データ ${records.length}件` : '隔離データはありません。');
  records.forEach(item => { const row = el('div'); row.className = 'quarantine-item'; const text = item.record || {}; const summary = el('span', `${text.quarantinedAt || '時刻不明'} / ${text.reason || '理由不明'} / ${text.sourceKey || item.key}`); const button = el('button', '削除'); button.type = 'button'; button.className = 'btn-s'; button.addEventListener('click', () => { if (showConfirm('この隔離データを削除しますか？')) { const result = storageService.deleteQuarantine(item.key); if (!result.ok) showAlert(result.error); renderQuarantineUI(); showStorageWarning(); } }); row.append(summary, button); list.appendChild(row); });
}

function updateWakeBtnUI(active) { const button = document.getElementById('wake-lock-btn'); if (button) { button.classList.toggle('sys-active', active); button.textContent = active ? '👀' : '😪'; } }
async function requestWakeLock() {
  try { if (!('wakeLock' in navigator)) throw new Error('Wake Lock APIは未対応です'); wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; updateWakeBtnUI(false); }); updateWakeBtnUI(true); } catch { updateWakeBtnUI(false); }
}
async function releaseWakeLock() { if (wakeLock) { try { await wakeLock.release(); } catch { /* already released */ } wakeLock = null; } updateWakeBtnUI(false); }
function toggleWakeLock() { const requested = !appState.isWakeLockRequested; if (commitState(state => { state.isWakeLockRequested = requested; }, { skipHistory: true })) { if (requested) requestWakeLock(); else releaseWakeLock(); } }
function toggleClock() { if (commitState(state => { state.isClockVisible = !state.isClockVisible; }, { skipHistory: true })) { document.body.classList.toggle('hide-clock', !appState.isClockVisible); updateToolbarState(); } }

function initializeStorage() {
  try { storageLike = window.localStorage; storageService = createStorageService(storageLike); }
  catch { storageLike = { data: new Map(), get length() { return this.data.size; }, key(index) { return Array.from(this.data.keys())[index] || null; }, getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }, setItem(key, value) { this.data.set(key, String(value)); }, removeItem(key) { this.data.delete(key); } }; storageService = createStorageService(storageLike); }
  const loaded = storageService.load();
  if (loaded.ok) appState = loaded.state;
  if (loaded.readOnly) showStorageWarning();
}
function initStartupDates() {
  const today = new Date(); let base = getIsoDateStr(today);
  if (today < new Date(appState.currentYear, 3, 1) || today > new Date(appState.currentYear + 1, 2, 31)) base = `${appState.currentYear}-04-01`;
  renderEditor(base, 'top');
  const next = dateFromIso(base); next.setDate(next.getDate() + 1);
  while (true) {
    const nextId = getIsoDateStr(next);
    const policy = getDateSchedulePolicy(nextId, appState);
    if (!policy.isFixedOffActive && !policy.isEffectiveHoliday) break;
    next.setDate(next.getDate() + 1);
  }
  renderEditor(getIsoDateStr(next), 'bottom-left');
  const week = dateFromIso(base); week.setDate(week.getDate() + 7); renderEditor(getIsoDateStr(week), 'bottom-right');
  return base;
}
function scrollDateListToRow(dateId, rowNumber = 7) {
  const list = document.getElementById('date-list');
  const target = document.getElementById(`preview-${dateId}`)?.closest('.date-item');
  if (!list || !target) return;
  const items = qa('.date-item', list);
  const targetIndex = items.indexOf(target);
  if (targetIndex < 0) return;
  const anchor = items[Math.max(0, targetIndex - (rowNumber - 1))];
  const originalScrollBehavior = list.style.scrollBehavior;
  list.style.scrollBehavior = 'auto';
  list.scrollTop += anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
  list.style.scrollBehavior = originalScrollBehavior;
}
function initApp() {
  if (initialized) return; initialized = true;
  document.documentElement.style.setProperty('--bg-exam', APP_CONFIG.theme.exam); document.documentElement.style.setProperty('--bg-short', APP_CONFIG.theme.short); document.documentElement.style.setProperty('--bg-noclass', APP_CONFIG.theme.noclass);
  document.documentElement.dataset.taskkanriBuild = APP_CONFIG.buildVersion; document.documentElement.dataset.taskkanriSchema = String(APP_CONFIG.schemaVersion);
  initializeStorage(); bindEditorEvents();
  const settingsView = document.getElementById('settings-view');
  settingsView?.addEventListener('input', event => markSettingsDirty(event.target));
  settingsView?.addEventListener('change', event => markSettingsDirty(event.target));
  document.getElementById('search-input')?.addEventListener('input', event => { event.currentTarget.style.height = '28px'; event.currentTarget.style.height = `${Math.min(70, event.currentTarget.scrollHeight)}px`; executeSearch(); });
  document.addEventListener('copy', event => copySelection(event)); document.addEventListener('cut', event => copySelection(event, true));
  document.addEventListener('pointerdown', event => { const menu = document.getElementById('bulk-calendar-context-menu'); if (menu && !menu.hidden && !menu.contains(event.target)) closeBulkCalendarContextMenu(); const dateMenu = document.getElementById('date-list-context-menu'); if (dateMenu && !dateMenu.hidden && !dateMenu.contains(event.target)) closeDateListContextMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isDateListContextMenuOpen()) { event.preventDefault(); closeDateListContextMenu(true); return; }
    if (event.isComposing || event.keyCode === 229 || isTextEditingTarget(event.target) || hasOpenUnsavedForm()) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z') { event.preventDefault(); if (event.shiftKey) redoHistory(); else undoHistory(); }
    else if (key === 'y' && event.ctrlKey) { event.preventDefault(); redoHistory(); }
  });
  document.addEventListener('scroll', () => closeBulkCalendarContextMenu(), true); window.addEventListener('resize', () => closeBulkCalendarContextMenu());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && appState.isWakeLockRequested) requestWakeLock(); });
  window.addEventListener('beforeunload', () => { if (wakeLock) releaseWakeLock(); });
  document.body.className = appState.isLandscapeMode ? 'layout-landscape' : 'layout-portrait'; document.body.classList.toggle('hide-clock', !appState.isClockVisible); updateWakeBtnUI(appState.isWakeLockRequested && Boolean(wakeLock));
  generateDateList(); const startupDateId = initStartupDates(); requestAnimationFrame(() => scrollDateListToRow(startupDateId)); renderQuarantineUI(); showStorageWarning(); updateHistoryControls();
  setInterval(() => { const time = new Date(); const value = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`; qa('.digital-clock-display').forEach(node => { node.textContent = value; }); checkAlarms(time); }, 1000);
}

function getDateListContextPreset(dateId) { return getDayProfile(dateId); }
function isDateListContextMenuOpen() { const menu = document.getElementById('date-list-context-menu'); return Boolean(menu && !menu.hidden); }
function openDateListContextMenu(event, dateId) {
  event.preventDefault(); event.stopPropagation(); hideTooltip(); dateListContextDateId = dateId; dateListContextInvoker = document.activeElement;
  const menu = document.getElementById('date-list-context-menu'); if (!menu) return; const date = dateFromIso(dateId); const title = document.getElementById('date-list-context-title'); if (title) title.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${APP_CONFIG.daysStr[date.getDay()]}）　${getDayStateVisual(dateId).label}`;
  const input = document.getElementById('date-list-context-holiday-name'); if (input) input.value = stripHtml(appState.customHolidays[dateId] || ''); qa('[data-date-list-preset]').forEach(button => button.classList.toggle('is-active', button.dataset.dateListPreset === getDateListContextPreset(dateId))); menu.hidden = false; menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 308))}px`; menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - 278))}px`; input?.focus();
}
function closeDateListContextMenu(restoreFocus = false) { const menu = document.getElementById('date-list-context-menu'); if (!menu || menu.hidden) return; menu.hidden = true; if (restoreFocus) dateListContextInvoker?.focus?.(); dateListContextDateId = ''; dateListContextInvoker = null; }
function applyDateListContextPreset(preset) { if (dateListContextDateId && DayStateEngine.applyPreset(dateListContextDateId, preset)) closeDateListContextMenu(); }
function saveDateListContextHoliday() { if (!dateListContextDateId) return; const value = document.getElementById('date-list-context-holiday-name')?.value || ''; if (commitState(state => { const clean = sanitizeHtml(value); state.customHolidays[dateListContextDateId] = stripHtml(clean).trim() ? clean : '休日'; }, { historyLabel: '日別祝日の変更', historyScope: 'holiday' })) { closeDateListContextMenu(); refreshMainUI(); } }
function clearDateListContextHoliday() { if (!dateListContextDateId) return; if (commitState(state => { delete state.customHolidays[dateListContextDateId]; }, { historyLabel: '日別祝日の削除', historyScope: 'holiday' })) { closeDateListContextMenu(); refreshMainUI(); } }

Object.assign(window, {
  APP_CONFIG, AppStorage: { init: initializeStorage, saveAll: () => storageService.saveAll(appState) }, DayStateEngine, EditorCmd,
  clearSearch, executeJump, executeSearch, renderEditor, shiftDate, toggleClock, toggleWakeLock, handlePaste,
  toggleMainState, closeAlarmModal,
  openTodoModal, closeTodoModal, jumpToDateFromTodo, openCountModal, closeCountModal, switchCountMode, addCountConditionRow, removeCountConditionRow,
  updateCondWord, updateCondMode, updateCondStart, updateCountDateRange, toggleTrash, togglePreviewCheck, moveCountCondition, applyCountColumn,
  applyCountAll, applyGridCleaning, exportCountToCSV, startCountDrag, openBulkCalendarModal, closeBulkCalendarModal, handleBulkCalendarModalKeydown,
  openBulkCalendarContextMenu, closeBulkCalendarContextMenu, clearBulkCalendarSelection, setBulkCalendarSelectionMode, setBulkCalendarMonthLayout,
  toggleBulkCalendarDate, toggleBulkCalendarMonth, toggleBulkCalendarWeekday, applyBulkCalendarPreset, applyBulkCalendarHoliday, applyBulkCalendarContextPreset, saveBulkCalendarContextHoliday, clearBulkCalendarContextHoliday, undoBulkCalendarChange,
  openSettingsView, closeSettingsView, toggleDayRow, syncTmplState, saveBasicSettings, saveTimeConfig, saveWeekly, applyWeeklyRange,
  openAcademicYearRolloverModal, closeAcademicYearRolloverModal, handleAcademicYearRolloverKeydown, renderAcademicYearRolloverPreview, executeAcademicYearRollover,
  saveAnnual, saveHolidays, exportData, importData, openResetModal, closeResetModal, executeReset, downloadQuarantinedData, deleteAllQuarantinedData,
  openDateListContextMenu, closeDateListContextMenu, applyDateListContextPreset, saveDateListContextHoliday, clearDateListContextHoliday,
  updateAnnualEvent, updateSlot, updateGlobalTask, undoHistory, redoHistory, showTooltip, hideTooltip, checkAlarms
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp, { once: true });
else initApp();
