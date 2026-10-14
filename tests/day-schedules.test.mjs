import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeImportedPayload,defaultState,serializePayload,getResolvedSlot} from '../taskkanri-core.mjs';

test('old weekly schedules expand once, preserving replacements, cancellations and hidden years',()=>{
 const data={currentYear:2026,weeklyTemplate:{1:{'１限':'未適用マスター'}},weeklyRules:{1:{'１限':[{from:'2026-03-30',to:'2026-04-20',content:'<b>化学</b>'}]}},dateOverrides:{'2026-04-06':{slots:{'１限':{action:'replace',source:'user',content:'<span class="todo-badge state-1" data-state="1">途</span>実験'}}},'2026-04-13':{slots:{'１限':{action:'cancel',source:'legacy'}}},'2027-04-01':{slots:{'２限':{action:'replace',source:'user',content:'次年度'}}}}};
 const original=JSON.stringify(data),result=normalizeImportedPayload({meta:{schemaVersion:7},data});
 assert.equal(result.ok,true);assert.equal(JSON.stringify(data),original);
 assert.deepEqual(result.value.dateSchedules,{'2026-03-30':{'１限':'<b>化学</b>'},'2026-04-06':{'１限':'<span class="todo-badge state-1" data-state="1">途</span>実験'},'2026-04-20':{'１限':'<b>化学</b>'},'2027-04-01':{'２限':'次年度'}});
 for(const key of ['weeklyTemplate','weeklyRules','dateOverrides'])assert.equal(key in result.value,false);
 assert.equal(getResolvedSlot('2026-04-13','１限',result.value),'');
});
test('current exports contain only daily schedules and roundtrip without recurrence',()=>{
 const state=defaultState();state.dateSchedules={'2026-10-14':{'１限':'<strong>本文</strong>'}};
 const exported=serializePayload(state);assert.equal(exported.ok,true);assert.equal(exported.value.meta.schemaVersion,8);
 assert.deepEqual(normalizeImportedPayload(exported.value).value,state);
 for(const key of ['weeklyTemplate','weeklyRules','dateOverrides'])assert.equal(key in exported.value.data,false);
});
test('current schedule validation rejects impossible dates and unknown slots before writing',()=>{
 for(const dateSchedules of [{'2026-02-29':{'１限':'x'}},{'2026-10-14':{'unknown':'x'}},{'2026-10-14':{'１限':{html:'x'}}}])assert.equal(normalizeImportedPayload({meta:{schemaVersion:8},data:{currentYear:2026,dateSchedules}}).ok,false);
});
