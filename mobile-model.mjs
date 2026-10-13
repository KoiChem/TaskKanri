import {APP_CONFIG,isSlotVisibleForDate,getDateSchedulePolicy,academicYearBounds} from './taskkanri-core.mjs';
import {addDays,calendarDays} from './taskkanri-sync-model.mjs';

export function scheduleCells(date,state){
 const profile=getDateSchedulePolicy(date,state).profile;
 const hideAfternoon=['short-am','morning','exam'].includes(profile);
 return APP_CONFIG.slotsAll.map((slot,index)=>({slot,column:index<5?1:2,row:index%5+1})).filter(({slot})=>
  isSlotVisibleForDate(date,slot,state)&&
  !(profile==='noclass-hide'&&!['朝','放課後'].includes(slot))&&
  !(hideAfternoon&&['昼休み','５限','６限','７限'].includes(slot)));
}
export function calendarPages(year,week){
 const bounds=academicYearBounds(year);const pages=[];
 if(week){
  for(let start=calendarDays(bounds.start,true)[0];start<=bounds.end;start=addDays(start,7))pages.push({id:start,days:calendarDays(start,true)});
 }else{
  for(let month=0;month<12;month++){
   const date=new Date(`${year}-04-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+month);
   const id=date.toISOString().slice(0,10),prefix=id.slice(0,7);
   const days=calendarDays(id).map(day=>day.startsWith(prefix)?day:null);
   while(days.slice(-7).every(day=>day===null))days.splice(-7);
   pages.push({id,days});
  }
 }
 return pages;
}
