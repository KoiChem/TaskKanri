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
  HistoryManager,
  formatStateSummary,
  getDateSchedulePolicy,
  getHolidayName,
  isEffectiveHoliday,
  isSlotVisibleForDate,
  isValidIsoDate,
  normalizeImportedPayload,
  planAcademicYearChange,
  sanitizeHtml,
  serializePayload,
  stripHtml,
  weekdayForDateId
} from './taskkanri-core.mjs?v=20261014-date-editor-v13';
import {SyncController} from './taskkanri-sync.js';
import {installSyncUI, downloadJson, exportFilename} from './taskkanri-sync-ui.js';
import {scopedStorage} from './taskkanri-device-storage.mjs';
import {toPayload,samePayload} from './taskkanri-sync-model.mjs';

import {planTimetableInput} from './taskkanri-timetable.mjs';
import {parseBulkDateRows,formatBulkDateText,summarizeTimetableChanges,planSettingsDateMaps} from './taskkanri-settings.mjs';
import {saveOfflineImport} from './taskkanri-offline-import.mjs';
import {archiveRecovery} from './taskkanri-recovery-archive.mjs';
import {mobileSyncLabel} from './mobile-ui.mjs';
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
let syncController;
let syncUI;
let taskTab='common';
let todoScroll=0;
let todoReveal=null;
let cloudUser = null;
let applyingCloud = false;
let initialized = false;
const historyManager = new HistoryManager();
const settingsDirtySections = new Set();
let isHydratingSettings = false;

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
  if(parent.classList.contains('slot-input'))prepareTaskBadges(parent);
  return parent;
}
// Badge appearance belongs to the atomic marker, never to an empty line.
function prepareTaskBadges(input) {
  input.querySelectorAll('.todo-badge').forEach(badge=>{
    if(!badge.textContent.replace(/[\u200b\u00a0]/g,'').trim()) {
      badge.replaceWith(...badge.childNodes);
    } else badge.contentEditable='false';
  });
}
function editorHtml(input) {prepareTaskBadges(input);return input.innerHTML;}
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
  if (!storageService || !canCloudEdit()) return false;
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
    || document.getElementById('timetable-view')?.style.display === 'block'
    || isDateListContextMenuOpen();
}
function isTextEditingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
}
function restoreHistory(direction) {
  if (!canCloudEdit()) return false;
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
  input.dataset.slot=slot;input.dataset.dateId=dateId;
  const resolved = resolvedSlot(dateId, slot);
  appendSafeRich(input, resolved);
  input.addEventListener('blur', () => updateSlot(dateId, slot, editorHtml(input)));
  input.addEventListener('paste', handlePaste);
  row.append(label, input);
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
  if(targetPosition==='top'){const list=target.querySelector('[data-todo-list]');if(list)todoScroll=list.scrollTop;}
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
  if(targetPosition==='top'&&todoReveal?.dateId===dateId&&![...content.querySelectorAll('[data-slot]')].some(input=>input.dataset.slot===todoReveal.slot))content.appendChild(createSlotEditor(dateId,todoReveal.slot,isShortChime,isExamChime,hideChime,true));
  if (targetPosition === 'top') {
    content.appendChild(buildTaskTabs());
  }
  target.appendChild(content);
  if(targetPosition==='top'&&taskTab==='todo')target.querySelector('[data-todo-list]').scrollTop=todoScroll;
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
function setUserOverride(state,dateId,slot,htmlValue){
 const clean=sanitizeHtml(htmlValue);
 if(stripHtml(clean).trim()){state.dateSchedules[dateId]??={};state.dateSchedules[dateId][slot]=clean;}
 else {delete state.dateSchedules[dateId]?.[slot];if(state.dateSchedules[dateId]&&!Object.keys(state.dateSchedules[dateId]).length)delete state.dateSchedules[dateId];}
}
function updateSlot(dateId, slot, htmlValue) {
  if(sanitizeHtml(htmlValue)===sanitizeHtml(resolvedSlot(dateId,slot)))return true;
  const ok = commitState(state => { setUserOverride(state, dateId, slot, htmlValue); }, { historyLabel: '日別予定の変更', historyScope: 'schedule' });
  if (ok) updatePreviewUI(dateId);
  return ok;
}
function updateGlobalTask(htmlValue) {
  if(sanitizeHtml(htmlValue)===sanitizeHtml(appState.globalTaskData))return true;
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
  const input=event.target.closest?.('.slot-input');if(input)prepareTaskBadges(input);
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
      const dateNumber = el('span', String(day)); dateNumber.className = 'calendar-date-number'; dateButton.appendChild(dateNumber);
      const stateMark = el('span', visual.shortLabel); stateMark.className = 'calendar-state-mark'; dateButton.appendChild(stateMark);
      if (dateId === todayId) { const todayMark = el('span'); todayMark.className = 'calendar-today-mark'; todayMark.setAttribute('aria-label', '今日'); dateButton.appendChild(todayMark); }
      dateButton.addEventListener('click', event => toggleBulkCalendarDate(dateId, event));
      days.appendChild(dateButton);
    }
    for (let blank = firstDay + lastDay; blank < 42; blank += 1) days.appendChild(el('span')).className = 'calendar-day-spacer';
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
  const undo = document.getElementById('bulk-calendar-undo-btn'); if (undo) undo.style.display = historyManager.peekUndo()?.scope === 'bulk-calendar' ? 'inline-flex' : 'none';
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
  right.addEventListener('beforeinput',event=>{
    if(event.isComposing)return;
    if(['insertParagraph','insertLineBreak'].includes(event.inputType)) {
      const input=event.target.closest?.('.slot-input');if(input)prepareTaskBadges(input);
    }
  });
  right.addEventListener('input',event=>{
    if(event.isComposing)return;
    const input=event.target.closest?.('.slot-input');if(input)prepareTaskBadges(input);
  });
  right.addEventListener('click', event => {
    const badge = event.target.closest?.('.todo-badge');
    if (!badge || !right.contains(badge) || !badge.closest('.slot-input')) return;
    if(!canCloudEdit())return;
    const next = (Number(badge.dataset.state) + 1) % 4;
    updateBadgeElement(badge, next);
    const input = badge.closest('.slot-input');
    if (input) input.dispatchEvent(new Event('blur'));
  });
}
function extractTasksForDisplay(html, dateId, slotName) {
  return extractTodoItems(html).map(item => ({ ...item, dateId, slotName }));
}
function buildTaskTabs() {
  const area=el('section');area.className='task-tabs';
  const tabs=el('div');tabs.className='task-tab-buttons';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','タスク表示');
  const common=el('div');common.className='slot-input task-tab-content';common.id='common-task-panel';common.dataset.commonEditor='';common.contentEditable='true';common.setAttribute('role','tabpanel');common.setAttribute('aria-labelledby','common-task-tab');
  appendSafeRich(common,appState.globalTaskData);common.addEventListener('blur',()=>updateGlobalTask(editorHtml(common)));common.addEventListener('paste',handlePaste);
  const list=el('div');list.className='task-tab-content todo-inline-list';list.id='todo-task-panel';list.dataset.todoList='';list.setAttribute('role','tabpanel');list.setAttribute('aria-labelledby','todo-task-tab');
  list.addEventListener('scroll',()=>todoScroll=list.scrollTop);
  const renderList=()=>{
    list.replaceChildren();
    const tasks=extractTasksForDisplay(appState.globalTaskData,'GLOBAL','共通タスク');
    academicDateIds().forEach(dateId=>APP_CONFIG.slotsAll.forEach(slot=>tasks.push(...extractTasksForDisplay(resolvedSlot(dateId,slot),dateId,slot))));
    if(!tasks.length)list.append(el('p','未完了のタスクはありません。'));
    tasks.forEach(task=>{
      const button=el('button');button.type='button';button.className='todo-inline-item';
      const date=task.dateId==='GLOBAL'?null:dateFromIso(task.dateId);
      const location=el('span',date?`${date.getMonth()+1}/${date.getDate()}(${APP_CONFIG.daysStr[date.getDay()]}) ${task.slotName}`:'共通');location.className='todo-inline-location';
      const text=el('span');const badge=el('span',({0:'未',1:'途',3:'急'})[task.state]);badge.className=`todo-badge state-${task.state}`;text.append(badge,document.createTextNode(task.text));button.append(location,text);
      button.onclick=()=>{
        todoScroll=list.scrollTop;
        if(!date){select('common');common.focus();return;}
        todoReveal={dateId:task.dateId,slot:task.slotName};renderEditor(task.dateId,'top');executeJump(task.dateId);
        const input=[...document.querySelectorAll('#top-panel .slot-input[data-slot]')].find(node=>node.dataset.slot===task.slotName);input?.focus();input?.scrollIntoView({block:'nearest'});
      };list.append(button);
    });list.scrollTop=todoScroll;
  };
  const buttons=[];
  const select=value=>{
    if(taskTab==='todo'&&list.childElementCount)todoScroll=list.scrollTop;
    taskTab=value;common.hidden=value!=='common';list.hidden=value!=='todo';
    buttons.forEach((button,i)=>{const selected=(i===0)===(value==='common');button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
    if(value==='todo')renderList();
  };
  ['共通タスク','ToDo一覧'].forEach((label,i)=>{const button=el('button',label);button.type='button';button.id=i?'todo-task-tab':'common-task-tab';button.setAttribute('role','tab');button.setAttribute('aria-controls',i?'todo-task-panel':'common-task-panel');button.onclick=()=>select(i?'todo':'common');button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-i;select(next?'todo':'common');buttons[next].focus();}};buttons.push(button);tabs.append(button);});
  area.append(tabs,common,list);select(taskTab);return area;
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
  Object.values(appState.dateSchedules).forEach(slots=>Object.values(slots).forEach(value=>{const word=getFirstWord(value);if(word)tags.add(word);}));
  if(!tags.size){container.appendChild(el('span','予定から授業名を抽出します'));return;}
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
      row.appendChild(label);
      const instructionCell = el('td'); const instructionLabel = el('label'); instructionLabel.className = 'instruction-day-control';
      const instruction = el('input'); instruction.type = 'checkbox'; instruction.dataset.instructionDay = String(day); instruction.checked = instructionDay;
      instruction.setAttribute('aria-label', `${APP_CONFIG.daysStr[day]}曜日を授業日にする`);
      const status = el('span', instructionDay ? '授業' : '休業'); status.className = 'instruction-day-status';
      instruction.addEventListener('change', () => syncInstructionDayState(day, instruction.checked)); instructionLabel.append(instruction, status); instructionCell.appendChild(instructionLabel); row.appendChild(instructionCell);
      APP_CONFIG.slotsAll.forEach(slot => {
        const cell = el('td'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.dataset.day = String(day); checkbox.dataset.slot = slot; checkbox.checked = Boolean(appState.daySlotConfig[day][slot]);
        checkbox.setAttribute('aria-label', `${APP_CONFIG.daysStr[day]}曜日 ${slot}を表示`); checkbox.disabled = !instructionDay && PERIOD_SLOTS.has(slot); checkbox.title = checkbox.disabled ? '固定休業日のため非表示（設定は保持）' : slot;
        checkbox.addEventListener('change', () => syncTmplState(day, slot, checkbox.checked)); cell.appendChild(checkbox); row.appendChild(cell);
      });
      const actions=el('td');actions.className='day-slot-actions';
      for(const [title,checked] of [['すべて表示',true],['すべて非表示',false]]){const toggle=el('button',title);toggle.type='button';toggle.className='btn-s day-slot-all-toggle';toggle.setAttribute('aria-label',`${APP_CONFIG.daysStr[day]}曜日の枠を${title}`);toggle.onclick=()=>{qa(`#day-slot-tbody input[data-day="${day}"][data-slot]`).forEach(input=>{input.checked=checked;});settingsDirtySections.add('schedule');updateSettingsStatus();};actions.append(toggle);} row.append(actions);
      dayBody.appendChild(row);
    });
  }
  const timeBody = document.getElementById('time-config-tbody'); if (timeBody) {
    timeBody.replaceChildren();
    APP_CONFIG.timeKeys.forEach(slot => { const row = el('tr'); row.appendChild(el('td', slot)); ['normal', 'short', 'exam'].forEach(group => { const cell = el('td'); const input = el('input'); input.type = 'time'; input.dataset.timeGroup = group; input.dataset.slot = slot; input.value = appState.timeConfig[group][slot] || ''; if (group === 'exam' && !['朝', '１限', '２限', '３限', '４限', '放課後'].includes(slot)) input.disabled = true; cell.appendChild(input); row.appendChild(cell); }); timeBody.appendChild(row); });
  }
  [1, 2, 3, 4, 5, 6, 0].forEach(day => syncInstructionDayState(day, isInstructionDayDraft(day)));
}
function openSettingsView() {
  isHydratingSettings = true;
  const year = document.getElementById('academic-year-input'); if (year) year.value = String(appState.currentYear);
  const range = getSmartDateRange(); const start = document.getElementById('tmpl-start'); const end = document.getElementById('tmpl-end'); if (start) start.value = range.start; if (end) end.value = range.end;
  const layout = document.querySelector(`input[name="layout-mode"][value="${appState.isLandscapeMode ? 'landscape' : 'portrait'}"]`); if (layout) layout.checked = true;
  renderSettingsTables();
  document.getElementById('annual-text-ui').value=formatBulkDateText(appState.configEvents,appState.currentYear);
  document.getElementById('holiday-text-ui').value=formatBulkDateText(appState.customHolidays,appState.currentYear);
  for(const kind of ['events','holidays']){document.getElementById(`${kind}-error`).textContent='';document.getElementById(kind==='events'?'annual-text-ui':'holiday-text-ui').removeAttribute('aria-invalid');}
  const usage = document.getElementById('storage-usage-disp'); if (usage) usage.textContent = ((storageService?.ownedKeys?.() || []).reduce((sum, key) => sum + ((storageLike.getItem(key)?.length || 0) + key.length) * 2, 0) / 1024).toFixed(2);
  renderQuarantineUI();document.getElementById('settings-recovery').open=storageService.isReadOnly()||storageService.getQuarantineRecords().length>0;document.getElementById('settings-reset-button').textContent=cloudUser?'この端末の保存データを削除':'この端末の予定と設定をすべて削除'; settingsDirtySections.clear(); document.getElementById('settings-view').style.display = 'block';document.getElementById('settings-view').scrollTop=0; isHydratingSettings = false;updateSettingsStatus();document.getElementById('next-year-button').textContent=`${appState.currentYear+1}年度を開く`;document.getElementById('settings-year-label').textContent=`${appState.currentYear}年度（${appState.currentYear}年4月〜${appState.currentYear+1}年3月）`;
}
function markSettingsDirty(target) {
  if (isHydratingSettings || !(target instanceof Element)) return;
  const section = target.closest('[data-settings-section]')?.dataset.settingsSection;
  if(section&&target.id!=='academic-year-input'){settingsDirtySections.add(section);updateSettingsStatus();}
}
function closeSettingsView(){leaveSettings(()=>{document.getElementById('settings-view').style.display='none';refreshMainUI();void syncController?.refresh();});}
let timetableFromSettings=false;
let pendingSettingsLeave=null,timetablePreview=null,timetableFingerprint='',timetableBusy=false,timetableDraft=false,timetableInvoker=null;
function updateSettingsStatus(message=''){const dirty=settingsDirtySections.size>0;document.getElementById('settings-save').disabled=!dirty;document.getElementById('settings-status').textContent=message||(dirty?'未保存の変更があります':'保存済み');}
let dateEditorSource=null,dateEditorInvoker=null;
function openDateEditor(kind,invoker){
 const source=document.getElementById(kind==='events'?'annual-text-ui':'holiday-text-ui');
 const editor=document.getElementById('date-editor-text'),dialog=document.getElementById('date-editor-dialog');
 dateEditorSource=source;dateEditorInvoker=invoker;
 document.getElementById('date-editor-title').textContent=kind==='events'?'年間行事を編集':'学校独自休日を編集';
 editor.value=source.value;dialog.showModal();editor.focus({preventScroll:true});
 editor.setSelectionRange(source.selectionStart,source.selectionEnd);editor.scrollTop=source.scrollTop;
}
function closeDateEditor(){
 const dialog=document.getElementById('date-editor-dialog');if(!dialog.open)return;
 const editor=document.getElementById('date-editor-text'),invoker=dateEditorInvoker;
 if(dateEditorSource){dateEditorSource.setSelectionRange(editor.selectionStart,editor.selectionEnd);dateEditorSource.scrollTop=editor.scrollTop;}
 dateEditorSource=null;dateEditorInvoker=null;dialog.close();invoker?.focus?.({preventScroll:true});
}
function collectBulkDateRows(kind){
 const input=document.getElementById(kind==='events'?'annual-text-ui':'holiday-text-ui');
 try{return parseBulkDateRows(input.value,appState.currentYear,kind==='events'?appState.configEvents:appState.customHolidays);}catch(error){error.section=kind;throw error;}
}
function saveSettings(){
 const next=clone(appState);try{
  next.isLandscapeMode=q('input[name=layout-mode]:checked').value==='landscape';
  qa('input[data-time-group]').forEach(input=>{if(!input.disabled){if(!input.validity.valid||(input.value&&!/^\d{2}:\d{2}$/.test(input.value))){input.focus();throw new Error('チャイム時刻を確認してください。');}next.timeConfig[input.dataset.timeGroup][input.dataset.slot]=input.value;}});
  qa('#day-slot-tbody input[data-slot]').forEach(input=>next.daySlotConfig[input.dataset.day][input.dataset.slot]=input.checked);
  qa('#day-slot-tbody input[data-instruction-day]').forEach(input=>next.instructionDayConfig[input.dataset.instructionDay]=input.checked);
  try{Object.assign(next,planSettingsDateMaps(appState,{events:settingsDirtySections.has('events')?collectBulkDateRows('events'):undefined,holidays:settingsDirtySections.has('holidays')?collectBulkDateRows('holidays'):undefined}));for(const kind of ['events','holidays']){document.getElementById(`${kind}-error`).textContent='';document.getElementById(kind==='events'?'annual-text-ui':'holiday-text-ui').removeAttribute('aria-invalid');}}catch(e){const node=document.getElementById(`${e.section}-error`);node.textContent=e.message;const input=document.getElementById(e.section==='events'?'annual-text-ui':'holiday-text-ui');input.setAttribute('aria-invalid','true');input.scrollIntoView({block:'center'});input.focus();return false;}
  if(!commitState(state=>Object.assign(state,next),{historyLabel:'設定の保存',historyScope:'settings'}))return false;
  settingsDirtySections.clear();document.body.classList.toggle('layout-landscape',next.isLandscapeMode);document.body.classList.toggle('layout-portrait',!next.isLandscapeMode);refreshMainUI();updateSettingsStatus(syncController?.engine?.pending?'端末に保存しました。未送信の変更があります。':'保存しました');return true;
 }catch(e){updateSettingsStatus(e.message);return false;}
}
function leaveSettings(action){if(!settingsDirtySections.size){action();return;}pendingSettingsLeave=action;document.getElementById('settings-leave-dialog').showModal();}
function resolveSettingsLeave(choice){if(choice==='save'&&!saveSettings())return;document.getElementById('settings-leave-dialog').close();const action=pendingSettingsLeave;pendingSettingsLeave=null;if(choice!=='cancel'){settingsDirtySections.clear();action?.();}}
function showSelectedYear(){const year=Number(document.getElementById('academic-year-input').value);leaveSettings(()=>{const plan=planAcademicYearChange(appState,year);if(!plan.ok){showAlert(plan.error);return;}if(commitState(state=>{state.currentYear=year;state.countDateRange=plan.value.nextCountDateRange;state.calendarHolidays=plan.value.nextCalendarHolidays;},{historyLabel:'表示年度の変更',historyScope:'settings',refresh:true}))openSettingsView();});}
function openNextYear(){document.getElementById('academic-year-input').value=appState.currentYear+1;showSelectedYear();}
function openTimetableView(){const start=()=>{timetableInvoker=document.activeElement;timetableFromSettings=document.getElementById('settings-view').style.display==='block';document.getElementById('settings-view').style.display='none';const root=document.getElementById('timetable-view'),bounds=academicYearBounds(appState.currentYear);root.style.display='block';document.getElementById('timetable-year').textContent=`${appState.currentYear}年度（${bounds.start}〜${bounds.end}）`;for(const id of ['tmpl-start','tmpl-end']){const input=document.getElementById(id);input.min=bounds.start;input.max=bounds.end;}const today=getIsoDateStr(new Date());document.getElementById('tmpl-start').value=today>=bounds.start&&today<=bounds.end?today:bounds.start;document.getElementById('tmpl-end').value=bounds.end;qa('[name=timetable-mode]')[0].checked=true;qa('[name=empty-mode]').forEach(input=>input.checked=false);document.getElementById('empty-options').hidden=true;document.getElementById('timetable-result').replaceChildren();document.getElementById('timetable-execute').hidden=true;const body=document.getElementById('weekly-tbody');body.replaceChildren();APP_CONFIG.slotsAll.forEach(slot=>{const row=el('tr');row.append(el('th',slot));[1,2,3,4,5,6,0].forEach(day=>{const cell=el('td'),input=el('input');input.type='text';input.dataset.day=day;input.dataset.slot=slot;input.setAttribute('aria-label',`${APP_CONFIG.daysStr[day]}曜日 ${slot}`);input.disabled=!appState.daySlotConfig[day][slot];input.title=input.disabled?'授業日・表示する枠の設定により対象外':'';cell.append(input);row.append(cell);});body.append(row);});timetableDraft=false;timetablePreview=null;document.getElementById('tmpl-start').focus();};if(document.getElementById('settings-view').style.display==='block')leaveSettings(start);else start();}
function closeTimetableView(){if(timetableDraft&&!showConfirm('未実行の入力を破棄して閉じますか？'))return;document.getElementById('timetable-view').style.display='none';timetableDraft=false;if(timetableFromSettings)openSettingsView();timetableInvoker?.focus?.();void syncController?.refresh();}
function timetableOptions(){const table={};qa('#weekly-tbody input').forEach(input=>{table[input.dataset.day]??={};table[input.dataset.day][input.dataset.slot]=input.value;});return {start:document.getElementById('tmpl-start').value,end:document.getElementById('tmpl-end').value,table,mode:q('[name=timetable-mode]:checked').value,emptyMode:q('[name=empty-mode]:checked')?.value};}
function currentTimetableFingerprint(){return JSON.stringify({state:appState,options:timetableOptions()});}
function previewTimetable(){const root=document.getElementById('timetable-result');root.replaceChildren();if(!canCloudEdit()||storageService.isReadOnly())return;if(syncController?.engine?.status==='deferred'){root.textContent='ほかの端末の変更を確認してから実行してください。入力は保持しています。';return;}const options=timetableOptions();if(options.mode==='replace'&&!options.emptyMode){root.textContent='上書きする空欄の扱いを選択してください。';return;}const result=planTimetableInput(appState,options);if(!result.ok){root.textContent=result.error;return;}timetablePreview=result.value;timetableFingerprint=currentTimetableFingerprint();const count=summarizeTimetableChanges(result.value.changes),excluded={};result.value.excluded.forEach(x=>excluded[x.reason]=(excluded[x.reason]||0)+1);root.append(el('p',`${count.days}日・${count.slots}コマを${options.mode==='append'?'追加':'置換'}。削除 ${count.deleted}コマ、タスクを含む変更 ${count.tasks}コマ。除外 ${result.value.excluded.length}コマ。${Object.entries(excluded).map(([reason,n])=>`${reason}: ${n}`).join(' / ')}`));if(options.mode==='replace')root.append(el('p','上書きすると対象コマのメモとタスクも置き換わります。'));if(!count.slots)root.append(el('p','変更対象がありません。期間・授業日・表示する枠・入力内容を確認してください。'));const list=el('div');list.className='timetable-changes';result.value.changes.forEach(change=>{const row=el('section');row.append(el('h4',`${change.dateId} ${change.slot}`));const before=el('div'),after=el('div');before.append(el('strong','変更前'));appendSafeRich(before,change.before);after.append(el('strong','変更後'));appendSafeRich(after,change.after);row.append(before,after);list.append(row);});root.append(list);const execute=document.getElementById('timetable-execute');execute.hidden=!count.slots;execute.textContent=options.mode==='append'?'予定に追加する':'予定を上書きする';}
function executeTimetable(){if(timetableBusy||!timetablePreview)return;if(timetableFingerprint!==currentTimetableFingerprint()){document.getElementById('timetable-result').textContent='入力や予定が変わりました。変更内容をもう一度確認してください。';timetablePreview=null;document.getElementById('timetable-execute').hidden=true;return;}if(!canCloudEdit()||storageService.isReadOnly()||syncController?.engine?.busy||syncController?.engine?.status==='deferred')return;timetableBusy=true;const button=document.getElementById('timetable-execute');button.disabled=true;try{const backup=storageService.createRecoverySnapshot();if(!backup.ok){notifySaveFailure(backup);return;}if(commitState(state=>Object.assign(state,timetablePreview.state),{historyLabel:'時間割の期間入力',historyScope:'schedule',refresh:true})){timetableDraft=false;timetablePreview=null;button.hidden=true;document.getElementById('timetable-result').textContent=syncController?.engine?.pending?'端末に保存しました。未送信の変更があります。':'保存しました。「元に戻す」で一括して取り消せます。';}}finally{timetableBusy=false;button.disabled=false;}}
function exportData() { syncUI.exportData(); }
async function importData(event) {
 const input=event?.target,file=input?.files?.[0];
 try{if(file)await syncUI.importFile(file)}finally{if(input)input.value=''}
}
function prepareFileImport(){
 if(settingsDirtySections.size||timetableDraft||isDateListContextMenuOpen())throw new Error('保存前の入力があります。保存してからインポートしてください。');
 if(document.body.classList.contains('cloud-signed-out'))return syncController.enterOffline();
}
async function saveImportedState(next){
 const controller=syncController,service=storageService,storage=storageLike,engine=controller?.engine,identity=controller?.user?.id;
 const offline=!!controller?.offlineMode;
 if(!offline&&!canCloudEdit())throw new Error('同期設定を確認してください。');
 const result=offline?await saveOfflineImport(controller,service,storage,APP_CONFIG.storeKey,next):await service.importRawWithRecovery(serializePayload(next).value,record=>archiveRecovery(record,{namespace:identity}));
 if(controller!==syncController||service!==storageService||engine!==controller.engine||identity!==controller.user?.id||offline!==!!controller.offlineMode)throw new Error('保存中にアカウントまたは利用モードが変わりました。ファイルを選び直してください。');
 if(!result.ok)throw new Error(result.error);
 appState=result.state;document.getElementById('settings-view').style.display='none';document.getElementById('timetable-view').style.display='none';if(!offline)queueCloudSave(appState);historyManager.clear();updateHistoryControls();showStorageWarning();renderQuarantineUI();refreshMainUI();
}
function openResetModal() { const modal = document.getElementById('reset-confirm-modal'); if (modal) modal.style.display = 'flex'; document.getElementById('btn-reset-cancel')?.focus(); }
function closeResetModal() { const modal = document.getElementById('reset-confirm-modal'); if (modal) modal.style.display = 'none'; }
async function executeReset() {
  if (cloudUser) {
    if (syncController.engine?.busy) { showAlert('保存結果を確認してから初期化してください。'); return; }
    if (!showConfirm("この端末の同期を解除し、端末内の保存データ・復旧用バックアップ・このタブの未送信データを初期化しますか？クラウドとほかの端末は初期化しません。")) return;
    if (syncController.engine?.pending) downloadJson({app:"TaskKanri",pending:syncController.engine.pending},exportFilename('unsent'));
    const service=storageService; const userId=cloudUser.id;
    syncController.engine?.store.remove('pending');
    await syncController.logout(); const result=service.reset();
    if (!result.ok) { showAlert(result.error); return; }
    scopedStorage(localStorage,userId).removeItem("cache"); location.reload(); return;
  }
  if (!showConfirm('TaskKanriの保存データ、復旧用バックアップ、隔離データを初期化しますか？')) return;
  const result = storageService.reset();
  if (!result.ok) { showAlert(`${result.error}\n削除失敗: ${result.failed.map(item => item.key).join(', ')}`); showStorageWarning(result.error); return; }
  appState = result.state || defaultState(); historyManager.clear(); updateHistoryControls(); closeResetModal(); showAlert(`TaskKanriのデータを初期化しました（${result.removed.length}キー削除）。他アプリのデータは削除していません。`); location.reload();
}
function getQuarantineDownloadPayload() { return { app: 'TaskKanri', buildVersion: APP_CONFIG.buildVersion, exportedAt: new Date().toISOString(), records: storageService.getQuarantineRecords() }; }
function downloadQuarantinedData() {
  const records = storageService.getQuarantineRecords(); if (!records.length) { showAlert('ダウンロードする隔離データはありません。'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(getQuarantineDownloadPayload(), null, 2)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = exportFilename('quarantine'); link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
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
  decorateStorageService();
  const loaded = storageService.load();
  if (loaded.ok) appState = loaded.state;
  if (loaded.readOnly) showStorageWarning();
}
function canCloudEdit() {
  if (document.body.classList.contains('cloud-signed-out')) { showAlert('同期設定からログインしてください。'); return false; }
  if ((cloudUser && !syncController?.engine) || ['conflict','blocked','unloaded'].includes(syncController?.engine?.status)) { syncUI.open(); return false; }
  return true;
}
function queueCloudSave(state) {
  if (applyingCloud) return;
  try { syncController?.dirty(state); } catch(error) { syncController?.engine?.emit('blocked',error.message); syncUI?.tell('端末には保存しましたが、同期を確認できません。'+error.message); }
}
function decorateStorageService() {
  const save=storageService.saveAll.bind(storageService);
  storageService.saveAll=(candidate)=>{const result=save(candidate);if(result.ok) queueCloudSave(result.state);return result;};
}
function installCloudSync() {
  document.body.classList.toggle('cloud-signed-out',localStorage.getItem('TASKKANRI_CLOUD_ENABLED')==='true');
  const landing=el('section');landing.id='sync-landing';landing.innerHTML='<h2>TaskKanri</h2><p>本人のアカウントでログインして予定を表示します。</p><button type="button">ログイン</button><button type="button" data-start-offline>オフラインで使う</button>';landing.hidden=!document.body.classList.contains('cloud-signed-out');document.body.append(landing);
  // Keep editing blocked until the saved account is restored, without flashing the login screen.
  if(localStorage.getItem('TASKKANRI_OFFLINE_MODE')==='true')landing.hidden=true;
  const controls=el('div');controls.className='sync-controls';const button=el('button','未接続');button.type='button';button.className='sync-text-button';button.setAttribute('aria-label','同期設定を開く。未接続');const status=button;controls.append(button);document.body.append(controls);
  syncController=new SyncController({mode:'desktop',getState:()=>appState,
    canApply:()=>!hasOpenUnsavedForm()&&!isTextEditingTarget(document.activeElement),
    onAccount:user=>{
      const previous=cloudUser;cloudUser=user;
      if(user) {
        const candidate=localStorage.getItem('TASKKANRI_CLOUD_ENABLED')==='true'?defaultState():clone(appState);
        const scoped=scopedStorage(localStorage,user.id);const hasMaster=scoped.getItem(APP_CONFIG.storeKey)!==null;
        storageLike=scoped;storageService=createStorageService(scoped);let loaded=storageService.load();
        if(!loaded.ok||loaded.readOnly) throw new Error('この端末の保存データを保全してください。');
        if(!hasMaster) { const result=storageService.saveAll(candidate);if(!result.ok)throw new Error(result.error);loaded=result; }
        appState=loaded.state;decorateStorageService();localStorage.setItem('TASKKANRI_CLOUD_ENABLED','true');document.body.classList.remove('cloud-signed-out');
      } else if(previous || localStorage.getItem('TASKKANRI_CLOUD_ENABLED')==='true') { qa('.modal-overlay').forEach(node=>node.style.display='none'); const settings=document.getElementById('settings-view');if(settings)settings.style.display='none'; appState=defaultState();storageLike=scopedStorage(localStorage,'logged-out');storageService=createStorageService(storageLike);storageService.load();decorateStorageService();document.body.classList.add('cloud-signed-out'); }
      landing.hidden=!document.body.classList.contains('cloud-signed-out');historyManager.clear();refreshMainUI();updateHistoryControls();
    },
    onData:next=>{
      if(samePayload(toPayload(next),toPayload(appState)))return;
      const backup=storageService.createRecoverySnapshot();if(!backup.ok)throw new Error(backup.error);
      applyingCloud=true;let result;try { result=storageService.saveAll(next); } finally { applyingCloud=false; } if(!result.ok)throw new Error(result.error);
      appState=result.state;landing.hidden=!document.body.classList.contains('cloud-signed-out');historyManager.clear();refreshMainUI();updateHistoryControls();
    },
    onStatus:(label,engine)=>{status.textContent=mobileSyncLabel(label,engine);button.setAttribute('aria-label',`同期設定を開く。${engine?.status==='synced'&&!syncController.offlineMode?'最終同期 ':''}${status.textContent}`);syncUI?.update();status.title=engine?.error||'';if(document.getElementById('settings-view').style.display==='block'&&!settingsDirtySections.size){const message=({synced:'保存済み',pending:'端末に保存済み・未送信',saving:'端末に保存済み・同期中…',offline:'端末に保存済み・未送信',conflict:'同期を確認してください',blocked:'同期を確認してください',deferred:'ほかの端末の更新があります'})[engine?.status];if(message)updateSettingsStatus(message);}}
  });
  syncUI=installSyncUI(syncController,{getInitialState:()=>appState,prepareImport:prepareFileImport,saveImportedState,beforeRefresh:()=>{if(syncController.composing)throw new Error('日本語の変換を確定してから同期してください。');if(hasOpenUnsavedForm())throw new Error('設定の変更を保存してから同期してください。');const active=document.activeElement,input=active?.closest('.slot-input');if(input){const html=editorHtml(input),saved=input.hasAttribute('data-common-editor')?updateGlobalTask(html):updateSlot(input.dataset.dateId,input.dataset.slot,html);if(!saved)throw new Error('端末への保存を確認できないため、同期を開始しませんでした。');active.blur();}}});button.onclick=e=>syncUI.open(e);landing.querySelector('button').onclick=e=>syncUI.open(e);landing.querySelector('[data-start-offline]').onclick=()=>syncController.enterOffline().catch(error=>{syncUI.tell(error.message);syncUI.open()});
  document.addEventListener('focusout',()=>setTimeout(()=>{if(syncController.engine?.deferred)void syncController.refresh()},0));
  syncController.start().catch(error=>{if(syncController.offlineMode)return;status.textContent=error.message;syncUI.tell(error.message)});
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
  initializeStorage(); installCloudSync(); bindEditorEvents();
  const settingsView = document.getElementById('settings-view');
  settingsView?.addEventListener('input', event => markSettingsDirty(event.target));
  settingsView?.addEventListener('change', event => markSettingsDirty(event.target));
  const timetableView=document.getElementById('timetable-view');
  for(const type of ['input','change'])timetableView?.addEventListener(type,event=>{timetableDraft=true;if(event.target.name==='timetable-mode')document.getElementById('empty-options').hidden=event.target.value!=='replace';document.getElementById('timetable-execute').hidden=true;});
  document.getElementById('date-editor-text').addEventListener('input',event=>{
    if(!dateEditorSource)return;
    dateEditorSource.value=event.target.value;markSettingsDirty(dateEditorSource);
  });
  document.getElementById('date-editor-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDateEditor();});
  document.getElementById('settings-leave-dialog')?.addEventListener('cancel',()=>{pendingSettingsLeave=null;});
  window.addEventListener('beforeunload',event=>{if(settingsDirtySections.size||timetableDraft){event.preventDefault();event.returnValue='';}});

  document.getElementById('search-input')?.addEventListener('input', event => { event.currentTarget.style.height = '28px'; event.currentTarget.style.height = `${Math.min(70, event.currentTarget.scrollHeight)}px`; executeSearch(); });
  document.addEventListener('copy', event => copySelection(event)); document.addEventListener('cut', event => copySelection(event, true));
  document.addEventListener('pointerdown', event => { const menu = document.getElementById('bulk-calendar-context-menu'); if (menu && !menu.hidden && !menu.contains(event.target)) closeBulkCalendarContextMenu(); const dateMenu = document.getElementById('date-list-context-menu'); if (dateMenu && !dateMenu.hidden && !dateMenu.contains(event.target)) closeDateListContextMenu(); });
  document.addEventListener('keydown', event => {
    if((event.ctrlKey&&event.altKey&&!event.metaKey||event.metaKey&&event.altKey&&!event.ctrlKey)&&!event.shiftKey&&event.code==='KeyS'){event.preventDefault();if(!event.repeat&&!event.isComposing&&event.keyCode!==229&&!syncController.composing)void syncUI.requestSync();return;}
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
  document.body.classList.toggle('layout-landscape',appState.isLandscapeMode); document.body.classList.toggle('layout-portrait',!appState.isLandscapeMode); document.body.classList.toggle('hide-clock', !appState.isClockVisible); updateWakeBtnUI(appState.isWakeLockRequested && Boolean(wakeLock));
  generateDateList(); const startupDateId = initStartupDates(); requestAnimationFrame(() => scrollDateListToRow(startupDateId)); renderQuarantineUI(); showStorageWarning(); updateHistoryControls();
  setInterval(() => { const time = new Date(); const value = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`; qa('.digital-clock-display').forEach(node => { node.textContent = value; }); }, 1000);
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
  toggleMainState,
  openCountModal, closeCountModal, switchCountMode, addCountConditionRow, removeCountConditionRow,
  updateCondWord, updateCondMode, updateCondStart, updateCountDateRange, toggleTrash, togglePreviewCheck, moveCountCondition, applyCountColumn,
  applyCountAll, applyGridCleaning, exportCountToCSV, startCountDrag, openBulkCalendarModal, closeBulkCalendarModal, handleBulkCalendarModalKeydown,
  openBulkCalendarContextMenu, closeBulkCalendarContextMenu, clearBulkCalendarSelection, setBulkCalendarSelectionMode, setBulkCalendarMonthLayout,
  toggleBulkCalendarDate, toggleBulkCalendarMonth, toggleBulkCalendarWeekday, applyBulkCalendarPreset, applyBulkCalendarHoliday, applyBulkCalendarContextPreset, saveBulkCalendarContextHoliday, clearBulkCalendarContextHoliday, undoBulkCalendarChange,
  openDateEditor, closeDateEditor, openSettingsView, closeSettingsView, toggleDayRow, syncTmplState, saveSettings,showSelectedYear,openNextYear,openTimetableView,closeTimetableView,previewTimetable,executeTimetable,resolveSettingsLeave, exportData, importData, openResetModal, closeResetModal, executeReset, downloadQuarantinedData, deleteAllQuarantinedData,
  openDateListContextMenu, closeDateListContextMenu, applyDateListContextPreset, saveDateListContextHoliday, clearDateListContextHoliday,
  updateAnnualEvent, updateSlot, updateGlobalTask, undoHistory, redoHistory, showTooltip, hideTooltip
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp, { once: true });
else initApp();
