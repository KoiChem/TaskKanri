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
  getSlotOrigin,
  getWeeklyRuleSlot,
  getDateSchedulePolicy,
  getHolidayName,
  isEffectiveHoliday,
  isSlotVisibleForDate,
  isValidIsoDate,
  isWeekend,
  migrateToCurrent,
  normalizeInstructionDayConfig,
  normalizeImportedPayload,
  applyAcademicYearRollover,
  planAcademicYearChange,
  planAcademicYearRollover,
  replaceWeeklyRuleRange,
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
  state.weeklyTemplate[3] = { '１限': '保存済み', '昼休み': '保存済み昼' };
  state.instructionDayConfig[3] = false;
  const fixedOff = getDateSchedulePolicy('2026-04-08', state);
  assert.equal(fixedOff.isFixedOffActive, true);
  assert.equal(fixedOff.hidePeriodSlots, true);
  assert.equal(fixedOff.hideChime, true);
  assert.equal(fixedOff.countExclusionReason, '固定休業日のため除外');
  assert.equal(isSlotVisibleForDate('2026-04-08', '１限', state), false);
  assert.equal(isSlotVisibleForDate('2026-04-08', '昼休み', state), true);
  assert.equal(state.weeklyTemplate[3]['１限'], '保存済み');

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

test('invalid and unknown imports are rejected without changing the master', () => {
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
    const result = service.importRaw(input, { confirm: () => { throw new Error('invalid input must not ask for confirmation'); } });
    assert.equal(result.ok, false, input);
    assert.equal(storage.getItem(APP_CONFIG.storeKey), beforeRaw, input);
  }
});

test('cancelled imports leave master and memory unchanged', () => {
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw() });
  const service = newService(storage);
  assert.equal(service.load().ok, true);
  const beforeRaw = storage.getItem(APP_CONFIG.storeKey);
  const beforeState = service.getState();
  const result = service.importRaw(JSON.stringify({ currentYear: 2027 }), { confirm: () => false });
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.deepEqual(service.getState(), beforeState);
  assert.equal(storage.getItem(APP_CONFIG.storeKey), beforeRaw);
  assert.equal(taskKanriOwnedKeys(storage).some(key => key.startsWith(APP_CONFIG.recoveryPrefix)), false);
});

test('wrapped legacy versions and flat imports complete defaults and survive reload', () => {
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw() });
  const service = newService(storage);
  service.load();
  const serialized = serializePayload(defaultState(2026), fixedNow());
  assert.equal(serialized.value.meta.buildVersion, APP_CONFIG.buildVersion);
  assert.equal(serialized.value.meta.schemaVersion, APP_CONFIG.schemaVersion);
  for (const version of [1, 46, 70, 71, 72]) {
    const wrappedLegacy = {
      meta: { version, lastUpdated: '2026-09-05T00:00:00.000Z' },
      data: {
        currentYear: 2026,
        isLandscapeMode: true,
        scheduleData: { '2026-04-06': { slots: { '１限': `<strong>化学 v${version}</strong>` } } },
        configEvents: { '2026-04-06': '始業式' },
        noClassData: { '2026-05-29': true, '2026-05-30': false },
        shortData: { '2026-06-01': true },
        examData: { '2026-06-02': false }
      }
    };
    const prepared = normalizeImportedPayload(JSON.stringify(wrappedLegacy));
    assert.equal(prepared.ok, true, `v${version}`);
    assert.equal(prepared.sourceSchemaVersion, 1, `v${version}`);
    const imported = service.importRaw(JSON.stringify(wrappedLegacy), { confirm: () => true });
    assert.equal(imported.ok, true, `v${version}`);
    assert.equal(imported.state.daySlotConfig[1]['１限'], true, `v${version}`);
    assert.equal(imported.state.timeConfig.normal['１限'], '08:50', `v${version}`);
    assert.equal(imported.state.dayProfiles['2026-05-29'], 'noclass-hide', `v${version}`);
    assert.equal(imported.state.dayProfiles['2026-05-30'], undefined, `v${version}`);
    assert.equal(imported.state.dayProfiles['2026-06-01'], 'short', `v${version}`);
    assert.equal(imported.state.dayProfiles['2026-06-02'], undefined, `v${version}`);
  }
  const reloaded = newService(storage);
  const loaded = reloaded.load();
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.state.dateOverrides['2026-04-06'].slots['１限'], { action: 'replace', content: '<strong>化学 v72</strong>', source: 'legacy' });
  assert.equal(loaded.state.daySlotConfig[1]['１限'], true);
  const flat = {
    academicYear: 2026,
    teacherSchedule: { '2026-04-07': { slots: { '２限': '数学' } } },
    customHolidays: { '2026-05-03': '休日' },
    noClassData: {}, shortData: {}, examData: {}
  };
  const result = reloaded.importRaw(JSON.stringify(flat), { confirm: summary => summary.currentYear === 2026 });
  assert.equal(result.ok, true);
  const afterFlat = newService(storage).load();
  assert.deepEqual(afterFlat.state.dateOverrides['2026-04-07'].slots['２限'], { action: 'replace', content: '数学', source: 'legacy' });
  assert.equal(afterFlat.state.daySlotConfig[1]['２限'], true);
});

test('snapshot failure and master write failure preserve current raw and memory state', () => {
  const original = defaultState(2026);
  original.configEvents['2026-04-01'] = '現行';
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw(original) });
  const service = newService(storage);
  service.load();
  const beforeState = service.getState();
  const beforeRaw = storage.getItem(APP_CONFIG.storeKey);
  storage.failSet = key => key.startsWith(APP_CONFIG.recoveryPrefix);
  let result = service.importRaw(JSON.stringify({ currentYear: 2027 }), { confirm: () => true });
  assert.equal(result.ok, false);
  assert.deepEqual(service.getState(), beforeState);
  assert.equal(storage.getItem(APP_CONFIG.storeKey), beforeRaw);

  storage.failSet = key => key === APP_CONFIG.storeKey;
  result = service.importRaw(JSON.stringify({ currentYear: 2027 }), { confirm: () => true });
  assert.equal(result.ok, false);
  assert.deepEqual(service.getState(), beforeState);
  assert.equal(storage.getItem(APP_CONFIG.storeKey), beforeRaw);
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

test('import sanitizes hostile rich text before commit and preserves data-state 0-3', () => {
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw() });
  const service = newService(storage);
  service.load();
  const payload = { currentYear: 2026, globalTaskData: '<span class="todo-badge state-1" data-state="1">途</span><svg onload="x"><script>x</script></svg>' };
  const result = service.importRaw(JSON.stringify(payload), { confirm: () => true });
  assert.equal(result.ok, true);
  assert.equal(result.state.globalTaskData, '<span class="todo-badge state-1" data-state="1">途</span>');
  assert.equal(normalizeImportedPayload(JSON.stringify(payload)).ok, true);
});

test('v1 through v6 states migrate through the explicit registry to schema 7 data', () => {
  const legacy = {
    currentYear: 2026,
    noClassData: { '2026-04-01': 1, '2026-04-02': 2, '2026-04-03': 0 },
    shortData: { '2026-04-04': 1, '2026-04-05': 2, '2026-04-06': 3 },
    examData: { '2026-04-07': 1, '2026-04-08': 2 }
  };
  const before = JSON.parse(JSON.stringify(legacy));
  const migrated = migrateToCurrent(legacy, 2);
  assert.equal(migrated.ok, true);
  assert.deepEqual(legacy, before, 'migration clones its input');
  assert.deepEqual(migrated.value.dayProfiles, {
    '2026-04-01': 'noclass-hide', '2026-04-02': 'noclass-show', '2026-04-04': 'short', '2026-04-05': 'short-am',
    '2026-04-06': 'morning', '2026-04-07': 'exam', '2026-04-08': 'mock-exam'
  });
  assert.equal('noClassData' in migrated.value, false);
  const v1 = normalizeImportedPayload({ currentYear: 2026, shortData: { '2026-04-01': true, '2026-04-02': false } });
  assert.equal(v1.ok, true);
  assert.deepEqual(v1.value.dayProfiles, { '2026-04-01': 'short' });
  const schema3Data = JSON.parse(JSON.stringify(migrated.value));
  delete schema3Data.instructionDayConfig;
  const current = normalizeImportedPayload(JSON.stringify({ meta: { schemaVersion: 3 }, data: schema3Data }));
  assert.equal(current.ok, true);
  assert.deepEqual(current.value, normalizeImportedPayload(JSON.stringify({ meta: { schemaVersion: 7 }, data: current.value })).value, 'schema 7 reload is idempotent');
  const serialized = serializePayload(current.value, fixedNow());
  assert.equal(serialized.value.meta.schemaVersion, 7);
  assert.equal('noClassData' in serialized.value.data, false);
  assert.deepEqual(serialized.value.data.dayProfiles, migrated.value.dayProfiles);
  assert.deepEqual(serialized.value.data.instructionDayConfig, defaultInstructionDayConfig());
  assert.equal(serialized.value.data.bulkCalendarMonthLayout, 'horizontal');
  const schema6 = normalizeImportedPayload({ meta: { schemaVersion: 6 }, data: { currentYear: 2026 } });
  assert.equal(schema6.ok, true);
  assert.equal(schema6.value.bulkCalendarMonthLayout, 'horizontal');
  const vertical = normalizeImportedPayload({ meta: { schemaVersion: 7 }, data: { currentYear: 2026, bulkCalendarMonthLayout: 'vertical' } });
  assert.equal(vertical.ok, true);
  assert.equal(vertical.value.bulkCalendarMonthLayout, 'vertical');
});

test('schema 7 rejects unknown profiles, future schemas, malformed calendar holidays, legacy maps, and invalid month layout without mutation', () => {
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: masterRaw() });
  const service = newService(storage); service.load();
  const before = storage.getItem(APP_CONFIG.storeKey);
  const rejected = [
    { meta: { schemaVersion: 3 }, data: { currentYear: 2026, dayProfiles: { '2026-04-01': 'unknown' } } },
    { meta: { schemaVersion: 8 }, data: { currentYear: 2026 } },
    { meta: { schemaVersion: 7 }, data: { currentYear: 2026, calendarHolidays: { '2027-04-29': { name: '昭和の日', status: 'unknown' } } } },
    { meta: { schemaVersion: 7 }, data: { currentYear: 2026, bulkCalendarMonthLayout: 'diagonal' } },
    { meta: { schemaVersion: 4 }, data: { currentYear: 2026, scheduleData: {} } },
    { meta: { schemaVersion: 2 }, data: { currentYear: 2026, noClassData: { '2026-04-01': 1 }, examData: { '2026-04-01': 1 } } }
  ];
  for (const payload of rejected) {
    assert.equal(service.importRaw(JSON.stringify(payload), { confirm: () => { throw new Error('must not confirm rejection'); } }).ok, false);
    assert.equal(storage.getItem(APP_CONFIG.storeKey), before);
  }
});

test('schema 5 holiday migration separates known calendar holidays from school holidays', () => {
  const imported = normalizeImportedPayload({
    meta: { schemaVersion: 5 },
    data: {
      currentYear: 2026,
      customHolidays: {
        '2026-04-29': '昭和の日',
        '2026-09-22': '国民の休日',
        '2026-08-13': '学校閉庁日'
      }
    }
  });
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.value.calendarHolidays['2026-04-29'], { name: '昭和の日', status: 'confirmed' });
  assert.equal(imported.value.customHolidays['2026-04-29'], undefined);
  assert.deepEqual(imported.value.calendarHolidays['2026-09-22'], { name: '休日', status: 'confirmed' });
  assert.equal(imported.value.customHolidays['2026-09-22'], undefined);
  assert.equal(imported.value.customHolidays['2026-08-13'], '学校閉庁日');
  const holidays = buildCalendarHolidaysForAcademicYear(2026);
  assert.deepEqual(holidays['2027-03-22'], { name: '振替休日', status: 'confirmed' });
  assert.equal(buildCalendarHolidaysForAcademicYear(2027)['2028-01-01'].status, 'tentative');
});

test('a conflicting v2 master is quarantined and enters read-only without overwriting raw master', () => {
  const raw = JSON.stringify({ meta: { schemaVersion: 2 }, data: { currentYear: 2026, noClassData: { '2026-04-01': 1 }, shortData: { '2026-04-01': 1 } } });
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: raw });
  const loaded = newService(storage).load();
  assert.equal(loaded.readOnly, true);
  assert.equal(storage.getItem(APP_CONFIG.storeKey), raw);
  assert.equal(Array.from(storage.data.keys()).some(key => key.startsWith(APP_CONFIG.quarantinePrefix)), true);
});

test('canonical dates and academic-year plans reject impossible ranges and retain all data', () => {
  for (const value of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-01']) assert.equal(isValidIsoDate(value), false, value);
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.equal(normalizeImportedPayload({ currentYear: 2026, countDateRange: { start: '2026-09-08', end: '2026-09-07' } }).ok, false);
  const state = defaultState(2026);
  state.dateOverrides['2026-04-01'] = { slots: { '１限': { action: 'cancel', source: 'user' } } }; state.dateOverrides['2027-04-01'] = { slots: { '１限': { action: 'cancel', source: 'user' } } };
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

test('academic year rollover defaults to a blank next-year timetable, resets target events, and prepares calendar holidays', () => {
  const state = defaultState(2026);
  state.weeklyTemplate = { 1: { '１限': '化学' } };
  state.weeklyRules = { 1: { '１限': [{ from: '2026-04-01', to: '2027-03-31', content: '化学' }] } };
  state.dateOverrides = { '2026-04-06': { slots: { '１限': { action: 'replace', content: '実験', source: 'user' } } } };
  state.configEvents['2026-04-07'] = '元年度の行事'; state.configEvents['2027-04-07'] = '次年度の行事';
  state.dayProfiles['2026-04-08'] = 'exam';
  state.customHolidays['2026-05-03'] = '元年度の学校休日'; state.customHolidays['2027-08-13'] = '次年度の学校閉庁日';
  const before = JSON.parse(JSON.stringify(state));
  const plan = planAcademicYearRollover(state);
  assert.equal(plan.ok, true);
  assert.equal(plan.value.copyBaseTimetable, false);
  assert.equal(plan.value.copyWeeklyRules, false);
  assert.equal(plan.value.candidateCount, 0);
  assert.equal(plan.value.copiedCount, 0);
  assert.deepEqual(plan.value.nextWeeklyTemplate, {});
  assert.equal(plan.value.counts.removedTargetEvents, 1);
  assert.equal(plan.value.counts.preservedTargetCustomHolidays, 1);
  assert.deepEqual({ confirmed: plan.value.counts.confirmedHolidays, tentative: plan.value.counts.tentativeHolidays }, { confirmed: 11, tentative: 5 });
  assert.equal(plan.value.nextCalendarHolidays['2027-04-29'].status, 'confirmed');
  assert.equal(plan.value.nextCalendarHolidays['2028-01-01'].status, 'tentative');
  assert.deepEqual(state, before, 'planning never mutates the source state');
  const applied = applyAcademicYearRollover(state, plan);
  assert.equal(applied.ok, true);
  assert.equal(applied.value.currentYear, 2027);
  assert.deepEqual(applied.value.countDateRange, academicYearBounds(2027));
  assert.deepEqual(applied.value.weeklyTemplate, {});
  assert.deepEqual(applied.value.weeklyRules, state.weeklyRules, 'source-year rules remain as history');
  assert.deepEqual(applied.value.dateOverrides, state.dateOverrides);
  assert.deepEqual(applied.value.configEvents, { '2026-04-07': '元年度の行事' });
  assert.deepEqual(applied.value.dayProfiles, state.dayProfiles);
  assert.deepEqual(applied.value.customHolidays, state.customHolidays);
  assert.equal(getHolidayName('2027-08-13', applied.value), '次年度の学校閉庁日');
  assert.equal(getHolidayName('2027-04-29', applied.value), '昭和の日');
});

test('academic year rollover copies the master and replaces target rules only when opted in', () => {
  const state = defaultState(2026);
  state.weeklyTemplate = { 1: { '１限': '化学' } };
  state.weeklyRules = { 1: { '１限': [
    { from: '2026-04-01', to: '2027-03-31', content: '化学' },
    { from: '2027-09-01', to: '2027-09-30', content: '次年度の既存規則' }
  ] } };
  const plan = planAcademicYearRollover(state, { sourceYear: 2026, targetYear: 2027, copyBaseTimetable: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.value.candidateCount, 1);
  assert.equal(plan.value.copiedCount, 1);
  assert.equal(plan.value.counts.removedTargetRules, 1);
  assert.equal(plan.value.conflictCount, 0);
  assert.equal(plan.value.skippedCount, 0);
  const applied = applyAcademicYearRollover(state, plan);
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.value.weeklyTemplate, state.weeklyTemplate);
  assert.deepEqual(applied.value.weeklyRules[1]['１限'].map(item => [item.from, item.to, item.content]), [
    ['2026-04-01', '2027-03-31', '化学'],
    ['2027-04-01', '2028-03-31', '化学']
  ]);
  assert.deepEqual(state.weeklyRules[1]['１限'].map(item => [item.from, item.to, item.content]), [
    ['2026-04-01', '2027-03-31', '化学'],
    ['2027-09-01', '2027-09-30', '次年度の既存規則']
  ], 'the source state remains unchanged');
});

test('academic year rollover rejects impossible leap-day shifts and non-next-year targets', () => {
  const state = defaultState(2027);
  state.weeklyRules = { 1: { '１限': [{ from: '2028-02-29', to: '2028-02-29', content: 'うるう日授業' }] } };
  const leap = planAcademicYearRollover(state, { sourceYear: 2027, targetYear: 2028, copyWeeklyRules: true });
  assert.equal(leap.ok, false);
  assert.match(leap.error, /うるう日/);
  const notNext = planAcademicYearRollover(state, { sourceYear: 2027, targetYear: 2029, copyWeeklyRules: false });
  assert.equal(notNext.ok, false);
});

test('schema 3 schedules become sparse legacy overrides without inferred weekly rules', () => {
  const legacy = {
    currentYear: 2026,
    scheduleData: {
      '2026-04-06': { slots: { '１限': '<strong>化学</strong>', '２限': '' } },
      '2026-04-07': { slots: {} }
    },
    configWeekly: { 1: { '１限': '化学' } }
  };
  const migrated = normalizeImportedPayload({ meta: { schemaVersion: 3 }, data: legacy });
  assert.equal(migrated.ok, true);
  assert.deepEqual(migrated.value.weeklyTemplate, { 1: { '１限': '化学' } });
  assert.deepEqual(migrated.value.weeklyRules, {});
  assert.deepEqual(migrated.value.dateOverrides, {
    '2026-04-06': { slots: {
      '１限': { action: 'replace', content: '<strong>化学</strong>', source: 'legacy' },
      '２限': { action: 'cancel', source: 'legacy' }
    } }
  });
  assert.equal('scheduleData' in migrated.value, false);
  assert.equal('configWeekly' in migrated.value, false);
});

test('schema 5 export never dual-writes legacy schedule fields', () => {
  const state = defaultState(2026);
  state.weeklyTemplate = { 1: { '１限': '化学' } };
  state.weeklyRules = { 1: { '１限': [{ from: '2026-04-01', to: '2027-03-31', content: '化学' }] } };
  state.dateOverrides = { '2026-04-06': { slots: { '１限': { action: 'replace', content: '実験', source: 'user' } } } };
  const payload = serializePayload(state, fixedNow());
  assert.equal(payload.ok, true);
  for (const field of ['scheduleData', 'teacherSchedule', 'configWeekly']) assert.equal(field in payload.value.data, false);
  assert.equal(payload.value.data.dateOverrides['2026-04-06'].slots['１限'].content, '実験');
});

test('loading a schema 4 master snapshots before atomic schema 7 migration', () => {
  const raw = JSON.stringify({ meta: { schemaVersion: 4 }, data: { currentYear: 2026, weeklyTemplate: { 1: { '１限': '化学' } }, weeklyRules: {}, dateOverrides: { '2026-04-06': { slots: { '１限': { action: 'replace', content: '化学', source: 'legacy' } } } } } });
  const storage = new FakeStorage({ [APP_CONFIG.storeKey]: raw });
  const loaded = newService(storage).load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.source, 'master-migrated');
  assert.equal(loaded.state.dateOverrides['2026-04-06'].slots['１限'].source, 'legacy');
  assert.equal(JSON.parse(storage.getItem(APP_CONFIG.storeKey)).meta.schemaVersion, 7);
  const snapshotKey = Array.from(storage.data.keys()).find(key => key.startsWith(APP_CONFIG.recoveryPrefix));
  assert.equal(JSON.parse(storage.getItem(snapshotKey)).raw, raw);
  const blockedStorage = new FakeStorage({ [APP_CONFIG.storeKey]: raw });
  blockedStorage.failSet = key => key.startsWith(APP_CONFIG.recoveryPrefix);
  const blocked = newService(blockedStorage).load();
  assert.equal(blocked.readOnly, true);
  assert.equal(blockedStorage.getItem(APP_CONFIG.storeKey), raw);
});

test('schema 5 validates rules and overrides, canonicalizes empty maps, and rejects bad payloads', () => {
  const good = defaultState(2026);
  good.weeklyRules = { 1: { '１限': [{ from: '2026-04-01', to: '2027-03-31', content: '<b>化学</b>' }] } };
  good.dateOverrides = { '2026-04-06': { slots: { '１限': { action: 'replace', content: '実験', source: 'user' } } }, '2026-04-07': { slots: {} } };
  const normalized = normalizeImportedPayload({ meta: { schemaVersion: 5 }, data: good });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.dateOverrides['2026-04-07'], undefined);
  assert.equal(normalized.value.weeklyRules[1]['１限'][0].content, '<b>化学</b>');
  const bad = [
    { weeklyRules: { 1: { '１限': [{ from: '2026-04-02', to: '2026-04-01', content: 'x' }] } } },
    { weeklyRules: { 1: { '１限': [{ from: '2026-04-01', to: '2026-04-10', content: 'x' }, { from: '2026-04-10', to: '2026-04-12', content: 'y' }] } } },
    { weeklyRules: { 1: { '１限': [{ from: '2026-02-31', to: '2026-04-10', content: 'x' }] } } },
    { dateOverrides: { '2026-04-01': { slots: { '１限': { action: 'replace', content: '', source: 'user' } } } } },
    { dateOverrides: { '2026-04-01': { slots: { '１限': { action: 'cancel', content: '', source: 'user' } } } } },
    { dateOverrides: { '2026-04-01': { slots: { '１限': { action: 'replace', content: 'x', source: 'other' } } } } }
  ];
  for (const partial of bad) assert.equal(normalizeImportedPayload({ meta: { schemaVersion: 5 }, data: { currentYear: 2026, ...partial } }).ok, false);
});

test('resolver has override priority and dayProfiles never rewrite rules or overrides', () => {
  const state = defaultState(2026);
  state.weeklyRules = { 1: { '１限': [{ from: '2026-04-01', to: '2027-03-31', content: '基本' }] } };
  assert.equal(getWeeklyRuleSlot('2026-04-06', '１限', state), '基本');
  assert.equal(getResolvedSlot('2026-04-06', '１限', state), '基本');
  state.dateOverrides = { '2026-04-06': { slots: { '１限': { action: 'replace', content: '変更', source: 'user' } } }, '2026-04-13': { slots: { '１限': { action: 'cancel', source: 'legacy' } } } };
  assert.equal(getResolvedSlot('2026-04-06', '１限', state), '変更');
  assert.equal(getSlotOrigin('2026-04-06', '１限', state), 'override');
  assert.equal(getResolvedSlot('2026-04-13', '１限', state), '');
  assert.equal(getSlotOrigin('2026-04-13', '１限', state), 'legacy');
  const before = JSON.stringify({ rules: state.weeklyRules, overrides: state.dateOverrides });
  state.dayProfiles['2026-04-06'] = 'exam';
  assert.equal(JSON.stringify({ rules: state.weeklyRules, overrides: state.dateOverrides }), before);
  delete state.dateOverrides['2026-04-06'].slots['１限']; delete state.dateOverrides['2026-04-06'];
  assert.equal(getResolvedSlot('2026-04-06', '１限', state), '基本');
});

test('replacing a weekly range splits existing segments without touching date overrides', () => {
  const state = defaultState(2026);
  state.weeklyRules = { 1: { '１限': [{ from: '2026-04-01', to: '2027-03-31', content: '旧' }] } };
  state.dateOverrides = { '2026-06-01': { slots: { '１限': { action: 'replace', content: '例外', source: 'user' } } } };
  const changed = replaceWeeklyRuleRange(state, '1', '１限', '2026-06-01', '2026-08-31', '新');
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.value.weeklyRules[1]['１限'].map(item => [item.from, item.to, item.content]), [['2026-04-01', '2026-05-31', '旧'], ['2026-06-01', '2026-08-31', '新'], ['2026-09-01', '2027-03-31', '旧']]);
  assert.deepEqual(changed.value.dateOverrides, state.dateOverrides);
});
