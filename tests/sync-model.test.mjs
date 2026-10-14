import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../taskkanri-core.mjs';
import { toPayload, mergePayload, samePayload, taskItems, changeTask, undoTask, slotTime, calendarDays } from '../taskkanri-sync-model.mjs';

const badge = '<span class="todo-badge state-0" data-state="0">未</span>同じ名前';
test('JSONB key order cannot turn an unchanged cached state into an unsent edit',()=>{
 const a=toPayload(defaultState());const b=structuredClone(a);b.state=Object.fromEntries(Object.entries(b.state).reverse());
 assert.equal(samePayload(a,b),true);b.state.globalTaskData='edited';assert.equal(samePayload(a,b),false);
});
test('cloud contract rejects omitted keys and keeps local preferences', () => {
  const local = defaultState(); local.isLandscapeMode = true;
  const p = toPayload(defaultState());
  assert.equal('isLandscapeMode' in p.state, false);
  assert.equal(mergePayload(p, local).isLandscapeMode, true);
  delete p.state.dateSchedules;
  assert.throws(() => mergePayload(p, local));
});
test('two identical task titles: index includes completed tasks, daily task changes only one date and undo preserves other slots', () => {
  const state = defaultState();
  state.dateSchedules['2026-10-12']={'１限':badge+'<br>'+badge,'２限':'既存'};
  assert.equal(taskItems(badge+'<br>'+badge).length, 2);
  const ref = { revision: 3, source:'slot', dateId:'2026-10-12', slot:'１限', badgeIndex:1, originalHtml:badge+'<br>'+badge };
  const { state:next, undo } = changeTask(state, ref, 2, 3);
  assert.equal(taskItems(next.dateSchedules['2026-10-12']['１限'])[0].state, 0);
  assert.equal(taskItems(next.dateSchedules['2026-10-12']['１限'])[1].state, 2);
  assert.equal(next.dateSchedules['2026-10-12']['２限'], '既存');
  assert.deepEqual(undoTask(next, undo), state);
  assert.throws(() => changeTask(state, ref, 2, 4));
});
test('times respect fixed off and exam profiles; calendar always has 42 cells', () => {
  const s=defaultState(); assert.equal(slotTime('2026-10-11','１限',s),'');
  s.dayProfiles['2026-10-12']='exam'; assert.equal(slotTime('2026-10-12','１限',s), s.timeConfig.exam['１限']);
  assert.equal(calendarDays('2026-10-01').length,42);
});
