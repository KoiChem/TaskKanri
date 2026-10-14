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
