import {test} from 'node:test';import assert from 'node:assert/strict';
import {defaultState} from '../taskkanri-core.mjs';
import * as mobile from '../mobile-model.mjs';
import {changeTask} from '../taskkanri-sync-model.mjs';
const badge=(n,text)=>`<span class="todo-badge state-${n}" data-state="${n}">${['未','途','済','急'][n]}</span>${text}`;
test('incomplete list includes hidden slots and all academic-year dates, excludes common and completed tasks',()=>{
 const state=defaultState(2026);state.globalTaskData=badge(0,'共通');state.dayProfiles['2026-10-15']='morning';
 state.dateSchedules={
  '2027-04-01':{'朝':badge(0,'年度外')},'2026-03-31':{'朝':badge(0,'年度外')},
  '2026-10-15':{'５限':badge(3,'非表示の午後'),'１限':badge(2,'完了')+'<br>'+badge(1,'進行中')},
  '2026-04-01':{'朝':badge(0,'年度初日')},'2027-03-31':{'放課後':badge(0,'年度末')}
 };
 const tasks=mobile.incompleteTasks(state);
 assert.deepEqual(tasks.map(t=>[t.dateId,t.slot,t.badgeIndex,t.state,t.text]),[
  ['2026-04-01','朝',0,0,'年度初日'],['2026-10-15','１限',1,1,'進行中'],['2026-10-15','５限',0,3,'非表示の午後'],['2027-03-31','放課後',0,0,'年度末']
 ]);
 const task=tasks[1],result=changeTask(state,{...task,revision:7},2,7);
 assert.match(result.state.dateSchedules['2026-10-15']['１限'],/data-state="2">済<\/span>進行中/);
 assert.deepEqual(mobile.incompleteTasks(result.state).map(t=>t.text),['年度初日','非表示の午後','年度末']);
 assert.equal(state.globalTaskData,badge(0,'共通'));
});
