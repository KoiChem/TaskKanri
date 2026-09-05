import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_CONFIG,
  createStorageService,
  defaultState,
  escapeHtmlAttribute,
  extractTodoItems,
  normalizeImportedPayload,
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
    JSON.stringify({ meta: { version: 0 }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { version: 73 }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { version: '71' }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { lastUpdated: '2026-09-05T00:00:00.000Z' }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { schemaVersion: 999 }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { schemaVersion: 2, lastUpdated: 'not-a-date' }, data: { currentYear: 2026 } }),
    JSON.stringify({ meta: { schemaVersion: 2, appVersion: 72 }, data: { currentYear: 2026 } }),
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
        configEvents: { '2026-04-06': '始業式' }
      }
    };
    const prepared = normalizeImportedPayload(JSON.stringify(wrappedLegacy));
    assert.equal(prepared.ok, true, `v${version}`);
    assert.equal(prepared.schemaVersion, 1, `v${version}`);
    const imported = service.importRaw(JSON.stringify(wrappedLegacy), { confirm: () => true });
    assert.equal(imported.ok, true, `v${version}`);
    assert.equal(imported.state.daySlotConfig[1]['１限'], true, `v${version}`);
    assert.equal(imported.state.timeConfig.normal['１限'], '08:50', `v${version}`);
  }
  const reloaded = newService(storage);
  const loaded = reloaded.load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.scheduleData['2026-04-06'].slots['１限'], '<strong>化学 v72</strong>');
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
  assert.equal(afterFlat.state.scheduleData['2026-04-07'].slots['２限'], '数学');
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
