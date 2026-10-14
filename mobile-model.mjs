import {APP_CONFIG,isSlotVisibleForDate,getDateSchedulePolicy,academicYearBounds,stripHtml,sanitizeHtml,getResolvedSlot,getHolidayName} from './taskkanri-core.mjs';
import {addDays,taskItems} from './taskkanri-sync-model.mjs';

export function scheduleCells(date,state){
 const profile=getDateSchedulePolicy(date,state).profile;
 const hideAfternoon=['short-am','morning','exam'].includes(profile);
 return APP_CONFIG.slotsAll.map((slot,index)=>({slot,column:index<5?1:2,row:index%5+1})).filter(({slot})=>
  isSlotVisibleForDate(date,slot,state)&&
  !(profile==='noclass-hide'&&!['朝','放課後'].includes(slot))&&
  !(hideAfternoon&&['昼休み','５限','６限','７限'].includes(slot)));
}
export function mobileWeekStart(date){
 return addDays(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
}
function mobileCalendarDays(date,week=false){
 const start=mobileWeekStart(week?date:date.slice(0,7)+'-01');
 return Array.from({length:week?7:42},(_,i)=>addDays(start,i));
}
export function calendarPages(year,week){
 const bounds=academicYearBounds(year);const pages=[];
 if(week){
  for(let start=mobileWeekStart(bounds.start);start<=bounds.end;start=addDays(start,7))pages.push({id:start,days:mobileCalendarDays(start,true)});
 }else{
  for(let month=0;month<12;month++){
   const date=new Date(`${year}-04-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+month);
   const id=date.toISOString().slice(0,10),prefix=id.slice(0,7);
   const days=mobileCalendarDays(id).map(day=>day.startsWith(prefix)?day:null);
   while(days.slice(-7).every(day=>day===null))days.splice(-7);
   pages.push({id,days});
  }
 }
 return pages;
}

export function hasMobileAgenda(date,state){
 return !!stripHtml(state.configEvents[date]||'').trim()||scheduleCells(date,state).some(({slot})=>!!stripHtml(getResolvedSlot(date,slot,state)).trim());
}
export function mobileDayBackground(date,state){
 const policy=getDateSchedulePolicy(date,state),profile=policy.profile,weekday=new Date(date+'T00:00:00Z').getUTCDay();
 if(profile.startsWith('noclass'))return 'bg-no-class';
 if(['exam','mock-exam'].includes(profile))return 'bg-exam';
 if(['short','short-am','morning'].includes(profile))return 'bg-short';
 if(getHolidayName(date,state)||weekday===0)return 'bg-sun-hol';
 if(weekday===6)return 'bg-sat';
 return policy.isFixedOffActive?'bg-fixed-off':'';
}

export function mobileDateRows(state,today){
 const bounds=academicYearBounds(state.currentYear),rows=[];
 for(let id=bounds.start;id<=bounds.end;id=addDays(id,1))rows.push({
  id,label:id.replaceAll('-','').slice(2)+APP_CONFIG.daysStr[new Date(id+'T00:00:00Z').getUTCDay()],
  event:stripHtml(state.configEvents[id]||getHolidayName(id,state)||'').replace(/\s+/g,' ').trim(),
  background:mobileDayBackground(id,state),today:id===today
 });
 return rows;
}

export function incompleteTasks(state){
 const bounds=academicYearBounds(state.currentYear),tasks=[];
 for(const dateId of Object.keys(state.dateSchedules).sort()){
  if(dateId<bounds.start||dateId>bounds.end)continue;
  for(const slot of APP_CONFIG.slotsAll){
   const originalHtml=getResolvedSlot(dateId,slot,state);
   for(const task of taskItems(originalHtml))if(task.state!==2)tasks.push({...task,source:'slot',dateId,slot,originalHtml:sanitizeHtml(originalHtml)});
  }
 }
 return tasks;
}
