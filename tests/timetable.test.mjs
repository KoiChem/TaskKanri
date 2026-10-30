import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState} from '../taskkanri-core.mjs';
import {planTimetableInput} from '../taskkanri-timetable.mjs';
const badge='<span class="todo-badge state-1" data-state="1">途</span>既存';
const options={start:'2026-10-13',end:'2026-10-15',table:{2:{'１限':'化学'},3:{'１限':'化学'}},mode:'append'};
test('append preserves rich content and independently writes matching days, including endpoints',()=>{
 const state=defaultState();state.dateSchedules={'2026-10-14':{'１限':badge},'2026-10-12':{'１限':'範囲外'}};const original=JSON.stringify(state);
 const result=planTimetableInput(state,options);assert.equal(result.ok,true);assert.equal(JSON.stringify(state),original);
 assert.equal(result.value.state.dateSchedules['2026-10-14']['１限'],badge+'<br>化学');assert.equal(result.value.state.dateSchedules['2026-10-13']['１限'],'化学');assert.equal(result.value.state.dateSchedules['2026-10-12']['１限'],'範囲外');assert.equal(result.value.changes.length,2);
});
test('replace requires explicit empty choice and both choices honor blank, hidden and excluded cells',()=>{
 const state=defaultState();state.dateSchedules={'2026-10-14':{'１限':'前','２限':'残す','５限':'午後'}};state.dayProfiles['2026-10-14']='morning';
 const opts={start:'2026-10-14',end:'2026-10-14',table:{3:{'１限':'後'}},mode:'replace'};
 assert.equal(planTimetableInput(state,opts).ok,false);
 const keep=planTimetableInput(state,{...opts,emptyMode:'keep'});assert.equal(keep.value.state.dateSchedules['2026-10-14']['２限'],'残す');
 const clear=planTimetableInput(state,{...opts,emptyMode:'clear'});assert.equal(clear.value.state.dateSchedules['2026-10-14']['１限'],'後');assert.equal(clear.value.state.dateSchedules['2026-10-14']['２限'],undefined);assert.equal(clear.value.state.dateSchedules['2026-10-14']['５限'],'午後');
 state.dayProfiles['2026-10-14']='exam';assert.equal(planTimetableInput(state,{...opts,emptyMode:'clear'}).value.changes.length,0);
});
test('holidays, fixed off, no-class and disabled slots do not get appended or deleted',()=>{
 const state=defaultState();state.dateSchedules={'2026-10-14':{'１限':'元'}};const opts={...options,start:'2026-10-14',end:'2026-10-14',mode:'replace',emptyMode:'clear'};
 for(const setup of [s=>s.customHolidays['2026-10-14']='休日',s=>s.instructionDayConfig[3]=false,s=>s.dayProfiles['2026-10-14']='noclass-show',s=>s.daySlotConfig[3]['１限']=false]){const s=structuredClone(state);setup(s);const result=planTimetableInput(s,opts);assert.equal(result.value.state.dateSchedules['2026-10-14']['１限'],'元');}
});
test('planner rejects malformed ranges and safely escapes plain timetable input',()=>{
 const state=defaultState();for(const range of [{start:'2026-02-30',end:'2026-10-14'},{start:'2026-10-15',end:'2026-10-14'},{start:'2026-10-14',end:'2027-04-01'}])assert.equal(planTimetableInput(state,{...options,...range}).ok,false);
 const result=planTimetableInput(state,{...options,table:{3:{'１限':'<script>alert(1)</script> & 化学'}}});assert.equal(result.value.state.dateSchedules['2026-10-14']['１限'],'&lt;script&gt;alert(1)&lt;/script&gt; &amp; 化学');
});

test('bulk input records only applied lesson words, deduplicated without scanning ordinary notes',()=>{
 const state=defaultState();state.timetableWords=['既存授業'];state.dateSchedules={'2026-10-14':{'２限':'メモ'} };
 const original=JSON.stringify(state);
 const result=planTimetableInput(state,{start:'2026-10-14',end:'2026-10-14',mode:'append',table:{3:{'朝':'朝会','１限':'化学 2A','２限':'化学 2B','３限':'２−３＠602','昼休み':'会議','放課後':'部活'},4:{'１限':'期間外'}}});
 assert.equal(result.ok,true);assert.deepEqual(result.value.state.timetableWords,['既存授業','化学','２−３＠602']);assert.equal(JSON.stringify(state),original);
 assert.ok(result.value.state.dateSchedules['2026-10-14']['２限'].startsWith('メモ<br>'));
});
test('excluded or blank timetable entries cannot seed candidates',()=>{
 const state=defaultState();state.customHolidays['2026-10-14']='休み';
 assert.deepEqual(planTimetableInput(state,{...options,start:'2026-10-14',end:'2026-10-14'}).value.state.timetableWords,[]);
 assert.equal(planTimetableInput(state,{...options,end:'invalid'}).ok,false);
});
test('candidate history survives backup, selective import and cloud receive without changing shared contract',async()=>{
 const {serializePayload,normalizeImportedPayload,normalizeState}=await import('../taskkanri-core.mjs');
 const {planImport,applyImport}=await import('../taskkanri-import.mjs');
 const {toPayload,mergePayload}=await import('../taskkanri-sync-model.mjs');
 const state=defaultState();state.timetableWords=['化学','２−３＠602'];
 const exported=serializePayload(state);assert.equal(exported.ok,true);
 assert.deepEqual(normalizeImportedPayload(exported.value).value.timetableWords,['化学','２−３＠602']);
 const target=defaultState(),plan=planImport(target,exported.value),row=plan.rows.find(r=>r.path[0]==='timetableWords');assert.ok(row);
 assert.deepEqual(applyImport(target,plan,[row.id]).timetableWords,['化学','２−３＠602']);
 assert.deepEqual(mergePayload(toPayload(defaultState()),state).timetableWords,['化学','２−３＠602']);
 assert.equal('timetableWords' in toPayload(state).state,false);
 assert.deepEqual(normalizeState({currentYear:2026}).value.timetableWords,[]);
 assert.equal(normalizeState({...state,timetableWords:[42]}).ok,false);
});
