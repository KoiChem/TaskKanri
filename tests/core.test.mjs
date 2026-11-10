import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_CONFIG,
  buildCalendarHolidaysForAcademicYear,
  HistoryManager,
  academicYearBounds,
  createStorageService,
  defaultInstructionDayConfig,
  defaultState,
  escapeHtmlAttribute,
  extractTodoItems,
  getResolvedSlot,
  getDateSchedulePolicy,
  getHolidayName,
  isEffectiveHoliday,
  isSlotVisibleForDate,
  isValidIsoDate,
  isWeekend,
  normalizeInstructionDayConfig,
  normalizeImportedPayload,
  planAcademicYearChange,
  sanitizeHtml,
  serializePayload,
  taskKanriOwnedKeys
} from '../taskkanri-core.mjs';

class FakeStorage {
  constructor(entries = {}) {
    this.data = new Map(Object.entries(entries));
    this.failSet = key => false;
    this.failRemove = key => false;
  }
  get length() { return this.data.size; }
  key(index) { return Array.from(this.data.keys())[index] ?? null; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (this.failSet(key, value)) throw new Error(`set failed: ${key}`);
    this.data.set(key, String(value));
  }
  removeItem(key) {
    if (this.failRemove(key)) throw new Error(`remove failed: ${key}`);
    this.data.delete(key);
  }
}

const fixedNow = () => new Date('2026-09-05T00:00:00.000Z');
function masterRaw(state = defaultState(2026)) {
  const serialized = serializePayload(state, fixedNow());
  assert.equal(serialized.ok, true);
  return JSON.stringify(serialized.value);
}
function newService(storage) {
  return createStorageService(storage, { now: fixedNow });
}

test('HistoryManager keeps session-only undo and redo stacks with no-op suppression', () => {
  const history = new HistoryManager({ now: () => '2026-09-06T00:00:00.000Z' });
  const before = { value: 'before' };
  const after = { value: 'after' };
  assert.equal(history.push({ label: '変更A', scope: 'test', before, after }), true);
  assert.equal(history.peekUndo().scope, 'test');
  assert.equal(history.peekUndo().timestamp, '2026-09-06T00:00:00.000Z');
  assert.equal(history.push({ label: '変更なし', before: after, after: { value: 'after' } }), false);
  before.value = 'mutated outside';
  assert.deepEqual(history.peekUndo().before, { value: 'before' });
  const entry = history.moveUndoToRedo();
  assert.equal(entry.label, '変更A');
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
  assert.equal(history.moveRedoToUndo(), entry);
  assert.equal(history.canUndo(), true);
  history.moveUndoToRedo();
  history.push({ label: '変更B', before: { value: 'after' }, after: { value: 'next' } });
  assert.equal(history.canRedo(), false);
});

test('HistoryManager trims oldest entries by count and byte budget but retains newest oversized entry', () => {
  const byCount = new HistoryManager({ maxEntries: 2, maxBytes: 100000 });
  for (const label of ['A', 'B', 'C']) byCount.push({ label, before: { label: `${label}0` }, after: { label: `${label}1` } });
  assert.deepEqual(byCount.undoStack.map(entry => entry.label), ['B', 'C']);
  const byBytes = new HistoryManager({ maxEntries: 30, maxBytes: 90 });
  byBytes.push({ label: 'A', before: { value: 'a'.repeat(80) }, after: { value: `A${'a'.repeat(79)}` } });
  byBytes.push({ label: 'B', before: { value: 'b'.repeat(80) }, after: { value: `B${'b'.repeat(79)}` } });
  assert.deepEqual(byBytes.undoStack.map(entry => entry.label), ['B']);
  assert.ok(byBytes.undoBytes() > 90);
});

test('session history is never part of the canonical export payload', () => {
  const history = new HistoryManager();
  const state = defaultState(2026);
  history.push({ label: '変更', before: state, after: { ...state, globalTaskData: '履歴対象' } });
  const payload = serializePayload(state, fixedNow());
  assert.equal(payload.ok, true);
  assert.equal('history' in payload.value.data, false);
  assert.equal(JSON.stringify(payload.value).includes('履歴対象'), false);
});

test('holiday settings remain stored while another day profile takes display priority', () => {
  const state = defaultState(2026);
  state.customHolidays['2026-04-29'] = '昭和の日';
  assert.equal(isEffectiveHoliday('2026-04-29', state), true);
  state.dayProfiles['2026-04-29'] = 'short';
  assert.equal(isEffectiveHoliday('2026-04-29', state), false);
  assert.equal(state.customHolidays['2026-04-29'], '昭和の日');
  delete state.dayProfiles['2026-04-29'];
  assert.equal(isEffectiveHoliday('2026-04-29', state), true);
  assert.equal(isWeekend('2026-04-25'), true);
  assert.equal(isWeekend('2026-04-26'), true);
  assert.equal(isWeekend('2026-04-27'), false);
});

test('instruction-day defaults, policy priority, and slot visibility preserve stored schedule data', () => {
  assert.deepEqual(defaultInstructionDayConfig(), { 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false });
  assert.deepEqual(normalizeInstructionDayConfig({ 6: true }).value, { 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true });
  for (const invalid of [null, [], { 7: true }, { 1: 'true' }]) assert.equal(normalizeInstructionDayConfig(invalid).ok, false);

  const state = defaultState(2026);
  state.daySlotConfig[3]['朝'] = true;
  state.daySlotConfig[3]['昼休み'] = true;
  state.daySlotConfig[3]['放課後'] = true;
  state.dateSchedules['2026-04-08'] = { '１限': '保存済み', '昼休み': '保存済み昼' };
  state.instructionDayConfig[3] = false;
  const fixedOff = getDateSchedulePolicy('2026-04-08', state);
  assert.equal(fixedOff.isFixedOffActive, true);
  assert.equal(fixedOff.hidePeriodSlots, true);
  assert.equal(fixedOff.hideChime, true);
  assert.equal(fixedOff.countExclusionReason, '固定休業日のため除外');
  assert.equal(isSlotVisibleForDate('2026-04-08', '１限', state), false);
  assert.equal(isSlotVisibleForDate('2026-04-08', '昼休み', state), true);
  assert.equal(state.dateSchedules['2026-04-08']['１限'], '保存済み');

  state.dayProfiles['2026-04-08'] = 'short';
  const special = getDateSchedulePolicy('2026-04-08', state);
  assert.equal(special.isFixedOffActive, false);
  assert.equal(special.hidePeriodSlots, false);
  assert.equal(isSlotVisibleForDate('2026-04-08', '１限', state), true);
  delete state.dayProfiles['2026-04-08'];
  assert.equal(getDateSchedulePolicy('2026-04-08', state).isFixedOffActive, true);

  state.customHolidays['2026-04-08'] = '休日';
  assert.equal(getDateSchedulePolicy('2026-04-08', state).countExclusionReason, '休日・祝日のため除外');
  state.dayProfiles['2026-04-08'] = 'exam';
  assert.equal(getDateSchedulePolicy('2026-04-08', state).isEffectiveHoliday, false);
  assert.equal(getDateSchedulePolicy('2026-04-08', state).isFixedOffActive, false);
  delete state.dayProfiles['2026-04-08'];
  assert.equal(getDateSchedulePolicy('2026-04-08', state).isEffectiveHoliday, true);
});

test('reset removes only explicit TaskKanri keys and keeps another app key', () => {
  const entries = {
    [APP_CONFIG.storeKey]: masterRaw(),
    [APP_CONFIG.readOnlyGuardKey]: JSON.stringify({ reason: 'test' }),
    [`${APP_CONFIG.quarantinePrefix}one`]: JSON.stringify({ raw: 'broken' }),
    [`${APP_CONFIG.recoveryPrefix}one`]: JSON.stringify({ raw: 'old' }),
    academicYearV46: '2026',
    teacherScheduleV43: '{}',
    countSettingsV41: '[]',
    isLandscapeModeV42: 'false',
    customHolidaysV46: '{}',
    OTHER_APP_KEY: 'must survive'
  };
  const storage = new FakeStorage(entries);
  const service = newService(storage);
  const result = service.reset();
  assert.equal(result.ok, true);
  assert.equal(storage.getItem('OTHER_APP_KEY'), 'must survive');
  assert.deepEqual(taskKanriOwnedKeys(storage), []);
  assert.equal(storage.getItem(APP_CONFIG.storeKey), null);
  assert.equal(storage.getItem(APP_CONFIG.readOnlyGuardKey), null);
});

test('invalid and unknown imports are rejected without changing the master', async () => {
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw() });
  const service = newService(storage);
  assert.equal(service.load().ok, true);
  const beforeRaw = storage.getItem(APP_CONFIG.storeKey);
  const invalidInputs = [
    '',
    '{broken',
    '{}',
    JSON.stringify({ currentYear: '2026' }),
    JSON.stringify({ scheduleData: { '2026-02-31': { slots: {} } } }),
    JSON.stringify({ scheduleData: { '2026-05-01': { slots: { 未知の時限: 'x' } } } }),
    JSON.stringify({ noClassData: { '2026-05-01': 1 }, examData: { '2026-05-01': 1 } }),
    JSON.stringify({ noClassData: { '2026-05-01': 3 } }),
    JSON.stringify({ timeConfig: { normal: { '１限': '8:50' } } }),
    JSON.stringify({ timeConfig: { holiday: {} } }),
    JSON.stringify({ configWeekly: { 7: { '１限': '化学' } } }),
    JSON.stringify({ countSettings: [{ word: '化学', mode: 'sideways', start: 1 }] }),
    JSON.stringify({ countDateRange: { start: '2026-09-08', end: '2026-09-07' } }),
    JSON.stringify({ countDateRange: { start: null, end: '' } }),
    JSON.stringify({ noClassData: { '2026-05-01': 'true' } }),
    JSON.stringify({ meta: { version: 0 }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { version: 74 }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { version: '71' }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { lastUpdated: '2026-09-05T00:00:00.000Z' }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { schemaVersion: 999 }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { schemaVersion: 2, lastUpdated: 'not-a-date' }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { schemaVersion: 2, appVersion: 72 }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { schemaVersion: 2 }, data: { currentYear: 2026, noClassData: { '2026-05-01': true } } }),
    JSON.stringify({ daySlotConfig: { 1: { '１限': 'true' } } }),
    JSON.stringify({ daySlotConfig: { 1: { 未知の時限: true } } })
  ];
  for (const input of invalidInputs) {
    const result = await service.importRawArchived(input, () => { throw new Error('invalid input must not back up'); });
    assert.equal(result.ok, false, input);
    assert.equal(storage.getItem(APP_CONFIG.storeKey), beforeRaw, input);
  }
});

test('corrupt master is quarantined raw before fallback, and quarantine failure hard-stops writes', () => {
  const broken = '{"data":{"currentYear":2026},"unexpected":';
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: broken, OTHER_APP_KEY: 'keep' });
  const service = newService(storage);
  const loaded = service.load();
  assert.equal(loaded.ok, true);
  assert.equal(storage.getItem(APP_CONFIG.storeKey) !== broken, true);
  const records = service.getQuarantineRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].record.raw, broken);
  assert.equal(records[0].record.sourceKey, APP_CONFIG.storeKey);
  assert.equal(storage.getItem('OTHER_APP_KEY'), 'keep');

  const failing = new FakeStorage({ [APP_CONFIG.storeKey]: broken });
  failing.failSet = key => key.startsWith(APP_CONFIG.quarantinePrefix);
  const guarded = newService(failing);
  const guardedLoad = guarded.load();
  assert.equal(guardedLoad.readOnly, true);
  assert.equal(failing.getItem(APP_CONFIG.storeKey), broken);
  const save = guarded.saveAll(defaultState(2027));
  assert.equal(save.ok, false);
  assert.equal(failing.getItem(APP_CONFIG.storeKey), broken);
});

test('sanitizer removes direct and nested XSS while preserving the supported rich text', () => {
  const direct = sanitizeHtml('<script>alert(1)</script><img src=x onerror=alert(2)><svg onload=alert(3)><span>bad</span></svg><a href="javascript:alert(4)">link</a>');
  assert.equal(/<script|<img|<svg|onerror|onload|javascript:/i.test(direct), false);
  const nested = sanitizeHtml('<section><img src=x onerror=alert(1)><span onclick="alert(2)">予定</span></section>');
  assert.equal(nested, '<span>予定</span>');
  const allowed = sanitizeHtml('<strong>太字</strong><span style="font-weight:bold;color:red;background:yellow">色</span><br><span class="todo-badge state-3" data-state="3" onclick="alert(1)">急</span>');
  assert.match(allowed, /<strong>太字<\/strong>/);
  assert.match(allowed, /<br>/);
  assert.match(allowed, /todo-badge state-3/);
  assert.equal(/onclick/i.test(allowed), false);
});

test('todo text is extracted as text, not reparsed markup, and attributes are safely escaped', () => {
  const items = extractTodoItems('<span class="todo-badge state-0" data-state="0">未</span>&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(items.length, 1);
  assert.match(items[0].text, /<img/);
  assert.equal(escapeHtmlAttribute('" onclick="alert(1) <tag>'), '&quot; onclick=&quot;alert(1) &lt;tag&gt;');
});

test('import sanitizes hostile rich text before commit and preserves data-state 0-3', async () => {
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw() });
  const service = newService(storage);
  service.load();
  const payload = { currentYear: 2026, globalTaskData: '<span class="todo-badge state-1" data-state="1">途</span><svg onload="x"><script>x</script></svg>' };
  const result = await service.importRawArchived(JSON.stringify({meta:{schemaVersion:8},data:payload}), async () => 'indexeddb:test');
  assert.equal(result.ok, true);
  assert.equal(result.state.globalTaskData, '<span class="todo-badge state-1" data-state="1">途</span>');
  assert.equal(normalizeImportedPayload({meta:{schemaVersion:8},data:payload}).ok, true);
});

test('schema 8 rejects unknown profiles, future schemas, malformed calendar holidays, legacy maps, and invalid month layout without mutation', async () => {
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw() });
  const service = newService(storage); service.load();
  const before = storage.getItem(APP_CONFIG.storeKey);
  const rejected = [
    { meta: { schemaVersion: 8 }, data: { currentYear: 2026, dayProfiles: { '2026-04-01': 'unknown' } } },
    { meta: { schemaVersion: 9 }, data: { currentYear: 2026 } },
    { meta: { schemaVersion: 8 }, data: { currentYear: 2026, calendarHolidays: { '2027-04-29': { name: '昭和の日', status: 'unknown' } } } },
    { meta: { schemaVersion: 8 }, data: { currentYear: 2026, bulkCalendarMonthLayout: 'diagonal' } },
    { meta: { schemaVersion: 8 }, data: { currentYear: 2026, scheduleData: {} } },
    { meta: { schemaVersion: 2 }, data: { currentYear: 2026, noClassData: { '2026-04-01': 1 }, examData: { '2026-04-01': 1 } } }
  ];
  for (const payload of rejected) {
    assert.equal((await service.importRawArchived(JSON.stringify(payload), () => { throw new Error('must not back up rejection'); })).ok, false);
    assert.equal(storage.getItem(APP_CONFIG.storeKey), before);
  }
});

test('canonical dates and academic-year plans reject impossible ranges and retain all data', () => {
  for (const value of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-01']) assert.equal(isValidIsoDate(value), false, value);
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.equal(normalizeImportedPayload({meta:{schemaVersion:8},data:{ currentYear: 2026, countDateRange: { start: '2026-09-08', end: '2026-09-07' } }}).ok, false);
  const state = defaultState(2026);
  state.dateSchedules['2026-04-01'] = {'１限':'過年度'}; state.dateSchedules['2027-04-01'] = {'１限':'次年度'};
  state.configEvents['2026-04-02'] = '年度外'; state.dayProfiles['2027-04-03'] = 'exam'; state.customHolidays['2026-04-04'] = '休日';
  const automatic = planAcademicYearChange(state, 2027);
  assert.equal(automatic.ok, true);
  assert.deepEqual(automatic.value.nextCountDateRange, academicYearBounds(2027));
  assert.equal(automatic.value.counts.dateOverrides, 1);
  assert.equal(automatic.value.counts.configEvents, 1);
  assert.equal(automatic.value.counts.dayProfiles, 0);
  assert.equal(automatic.value.counts.customHolidays > 0, true);
  state.countDateRange = { start: '2026-09-01', end: '2026-12-31' };
  const explicit = planAcademicYearChange(state, 2027);
  assert.equal(explicit.value.automaticRange, false);
  assert.deepEqual(explicit.value.nextCountDateRange, state.countDateRange);
  assert.equal(explicit.value.rangeOutside, true);
  assert.equal(state.dayProfiles['2027-04-03'], 'exam', 'planning is non-mutating, so cancel is safe');
});

test('current export never dual-writes legacy schedule fields', () => {
  const state = defaultState(2026);
  state.dateSchedules={'2026-04-06':{'１限':'実験'}};
  const payload = serializePayload(state, fixedNow());
  assert.equal(payload.ok, true);
  for (const field of ['scheduleData', 'teacherSchedule', 'configWeekly']) assert.equal(field in payload.value.data, false);
  assert.equal(payload.value.data.dateSchedules['2026-04-06']['１限'], '実験');
});
