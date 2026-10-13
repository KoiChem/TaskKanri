import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultState} from '../taskkanri-core.mjs';
import * as mobile from '../mobile-model.mjs';

test('morning and exams keep after-school in its original right-column position',()=>{
 const state=defaultState();const date='2026-10-14';
 for(const profile of ['morning','short-am','exam']){
  state.dayProfiles[date]=profile;
  const cells=mobile.scheduleCells(date,state);
  assert.deepEqual(cells.map(x=>x.slot),['朝','１限','２限','３限','４限','放課後']);
  assert.deepEqual(cells.at(-1),{slot:'放課後',column:2,row:5});
 }
 state.dayProfiles[date]='noclass-hide';
 assert.deepEqual(mobile.scheduleCells(date,state).map(x=>x.slot),['朝','放課後']);
});
test('normal schedule preserves two columns and weekday disabled slots',()=>{
 const state=defaultState();const date='2026-10-14';
 const cells=mobile.scheduleCells(date,state);
 assert.equal(cells.length,10);
 assert.deepEqual(cells[5],{slot:'昼休み',column:2,row:1});
 state.daySlotConfig[3]['２限']=false;
 assert.equal(mobile.scheduleCells(date,state).some(x=>x.slot==='２限'),false);
 assert.equal(mobile.scheduleCells(date,state).find(x=>x.slot==='３限').row,4);
});
test('continuous periods cover academic-year boundaries with no missing dates',()=>{
 for(const week of [false,true]){
  const pages=mobile.calendarPages(2026,week);
  const days=pages.flatMap(x=>x.days).filter(Boolean);
  assert.ok(days.includes('2026-04-01'));
  assert.ok(days.includes('2027-03-31'));
  if(!week){assert.equal(pages.length,12);assert.equal(new Set(days).size,365);assert.equal(days.length,365)}
  else{assert.equal(days.length,new Set(days).size);assert.equal(pages[0].days.length,7)}
 }
});

test('calendar uses visible schedule contents, not hidden periods or common tasks',()=>{
 const state=defaultState();state.globalTaskData='共通';const id='2026-10-14';
 assert.equal(mobile.hasMobileAgenda(id,state),false);
 state.dateOverrides[id]={slots:{'５限':{action:'replace',source:'user',content:'午後の授業'}}};
 assert.equal(mobile.hasMobileAgenda(id,state),true);
 state.dayProfiles[id]='morning';assert.equal(mobile.hasMobileAgenda(id,state),false);
 state.configEvents[id]='行事';assert.equal(mobile.hasMobileAgenda(id,state),true);
});
test('calendar backgrounds match desktop profile precedence',()=>{
 const state=defaultState();const id='2026-10-17';
 assert.equal(mobile.mobileDayBackground(id,state),'bg-sat');
 for(const [profile,expected] of [['short','bg-short'],['exam','bg-exam'],['noclass-show','bg-no-class']]){state.dayProfiles[id]=profile;assert.equal(mobile.mobileDayBackground(id,state),expected)}
 assert.equal(mobile.mobileDayBackground('2026-10-18',state),'bg-sun-hol');
 state.instructionDayConfig[3]=false;assert.equal(mobile.mobileDayBackground('2026-10-14',state),'bg-fixed-off');
});
