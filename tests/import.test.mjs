import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,serializePayload} from '../taskkanri-core.mjs';
import {planImport,applyImport} from '../taskkanri-import.mjs';
const wrap=data=>({meta:{schemaVersion:8},data});
test('only changed explicit entries appear; absent and unselected entries survive',()=>{
 const state=defaultState();state.dateSchedules={'2026-10-20':{'１限':'旧','２限':'残す'}};state.configEvents={'2026-10-20':'同じ','2026-10-21':'維持'};state.globalTaskData='既存';
 const plan=planImport(state,wrap({dateSchedules:{'2026-10-20':{'１限':'新'}},configEvents:{'2026-10-20':'同じ'},globalTaskData:'変更'}));
 assert.equal(plan.rows.length,2);
 const next=applyImport(state,plan,[plan.rows.find(r=>r.path[0]==='dateSchedules').id]);
 assert.equal(next.dateSchedules['2026-10-20']['１限'],'新');assert.equal(next.dateSchedules['2026-10-20']['２限'],'残す');assert.equal(next.configEvents['2026-10-21'],'維持');assert.equal(next.globalTaskData,'既存');assert.equal(next.isClockVisible,true);
});
test('explicit blank schedule and event values appear as deletion and are applied',()=>{
 const state=defaultState();state.dateSchedules={'2026-10-20':{'１限':'消す'}};state.configEvents={'2026-10-20':'消す'};
 const plan=planImport(state,wrap({dateSchedules:{'2026-10-20':{'１限':''}},configEvents:{'2026-10-20':''}}));assert.equal(plan.rows.length,2);assert.ok(plan.rows.every(r=>r.deletion));const next=applyImport(state,plan,plan.rows.map(r=>r.id));assert.deepEqual(next.dateSchedules,{});assert.deepEqual(next.configEvents,{});
});
test('full identical export has no differences',()=>{const s=defaultState();assert.equal(planImport(s,serializePayload(s).value).rows.length,0)});
test('preview refuses to apply over changed local state',()=>{const s=defaultState();const p=planImport(s,wrap({globalTaskData:'new'}));s.globalTaskData='changed';assert.throws(()=>applyImport(s,p,p.rows.map(r=>r.id)),/変更/)});
test('year-dependent imports require the selected year change',()=>{const s=defaultState();const p=planImport(s,wrap({currentYear:2027,dateSchedules:{'2027-04-12':{'１限':'新年度'}}}));assert.equal(p.yearChanged,true);assert.throws(()=>applyImport(s,p,p.rows.filter(r=>r.path[0]!=='currentYear').map(r=>r.id)),/年度/);assert.equal(applyImport(s,p,p.rows.map(r=>r.id)).currentYear,2027)});
test('partial grouped settings preserve unspecified settings while remaining one choice',()=>{const s=defaultState();s.timeConfig.short['１限']='08:17';const p=planImport(s,wrap({timeConfig:{normal:{'１限':'09:00'}}}));assert.equal(p.rows.length,1);const next=applyImport(s,p,p.rows.map(r=>r.id));assert.equal(next.timeConfig.normal['１限'],'09:00');assert.equal(next.timeConfig.short['１限'],'08:17')});
test('malformed and unrelated files cannot produce an import plan',()=>{assert.throws(()=>planImport(defaultState(),'broken'),/JSON/);assert.throws(()=>planImport(defaultState(),{foo:'bar'}),/現行形式/)});
