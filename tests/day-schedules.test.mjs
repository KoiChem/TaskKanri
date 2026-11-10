import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeImportedPayload,defaultState,serializePayload,getResolvedSlot} from '../taskkanri-core.mjs';

test('current exports contain only daily schedules and roundtrip without recurrence',()=>{
 const state=defaultState();state.dateSchedules={'2026-10-14':{'１限':'<strong>本文</strong>'}};
 const exported=serializePayload(state);assert.equal(exported.ok,true);assert.equal(exported.value.meta.schemaVersion,8);
 assert.deepEqual(normalizeImportedPayload(exported.value).value,state);
 for(const key of ['weeklyTemplate','weeklyRules','dateOverrides'])assert.equal(key in exported.value.data,false);
});
test('current schedule validation rejects impossible dates and unknown slots before writing',()=>{
 for(const dateSchedules of [{'2026-02-29':{'１限':'x'}},{'2026-10-14':{'unknown':'x'}},{'2026-10-14':{'１限':{html:'x'}}}])assert.equal(normalizeImportedPayload({meta:{schemaVersion:8},data:{currentYear:2026,dateSchedules}}).ok,false);
});
