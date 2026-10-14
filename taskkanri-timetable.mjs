import {APP_CONFIG,academicYearBounds,clone,escapeHtmlText,getDateSchedulePolicy,isPlainObject,isSlotVisibleForDate,isValidIsoDate,normalizeState,stripHtml,weekdayForDateId} from './taskkanri-core.mjs';

// A one-time expansion. The saved result contains no template or weekday rule.
export function planTimetableInput(state,{start,end,table,mode,emptyMode}={}) {
 const fail=error=>({ok:false,error});
 const checked=normalizeState(state);if(!checked.ok)return checked;
 const bounds=academicYearBounds(checked.value.currentYear);
 if(!isValidIsoDate(start)||!isValidIsoDate(end)||start>end||start<bounds.start||end>bounds.end)return fail('期間は表示年度内で指定してください。');
 if(!['append','replace'].includes(mode))return fail('追加か上書きを選択してください。');
 if(mode==='replace'&&!['keep','clear'].includes(emptyMode))return fail('空欄の扱いを選択してください。');
 if(!isPlainObject(table))return fail('時間割の入力を確認してください。');
 for(const [day,slots] of Object.entries(table)){
  if(!/^[0-6]$/.test(day)||!isPlainObject(slots))return fail('曜日の入力が不正です。');
  for(const [slot,text] of Object.entries(slots))if(!APP_CONFIG.slotsAll.includes(slot)||typeof text!=='string')return fail('コマの入力が不正です。');
 }
 const next=clone(checked.value),changes=[],excluded=[];
 for(let dateId=start;dateId<=end;){
  const day=weekdayForDateId(dateId),policy=getDateSchedulePolicy(dateId,next),slots=table[day]||{};
  const reason=policy.isEffectiveHoliday?'休日':policy.isFixedOffActive?'休業日':['exam','mock-exam'].includes(policy.profile)?'考査':policy.profile.startsWith('noclass')?'授業なし':'';
  for(const slot of APP_CONFIG.slotsAll){
   const raw=(slots[slot]||'').trim();
   if(!raw&&(mode==='append'||emptyMode==='keep'))continue;
   const hidden=!isSlotVisibleForDate(dateId,slot,next)||(['short-am','morning'].includes(policy.profile)&&['昼休み','５限','６限','７限'].includes(slot));
   if(reason||hidden){excluded.push({dateId,slot,reason:reason||'非表示コマ'});continue;}
   const before=next.dateSchedules[dateId]?.[slot]||'';
   const content=escapeHtmlText(raw).replace(/\r\n?|\n/g,'<br>');
   const after=mode==='append'&&stripHtml(before).trim()&&content?before+'<br>'+content:content;
   if(before===after)continue;
   if(after){next.dateSchedules[dateId]||={};next.dateSchedules[dateId][slot]=after;}
   else {delete next.dateSchedules[dateId]?.[slot];if(next.dateSchedules[dateId]&&!Object.keys(next.dateSchedules[dateId]).length)delete next.dateSchedules[dateId];}
   changes.push({dateId,slot,before,after});
  }
  const date=new Date(dateId+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);dateId=date.toISOString().slice(0,10);
 }
 return {ok:true,value:{state:next,changes,excluded}};
}
