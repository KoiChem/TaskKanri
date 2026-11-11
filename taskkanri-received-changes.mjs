import {clone} from './taskkanri-core.mjs';
import {SHARED_KEYS,samePayload} from './taskkanri-sync-model.mjs';
const labels={currentYear:'表示する年度',dateSchedules:'予定',configEvents:'行事',calendarHolidays:'暦の祝日',customHolidays:'学校独自休日',dayProfiles:'日別の時程',timeConfig:'チャイム設定',globalTaskData:'共通タスク',countSettings:'カウント設定',daySlotConfig:'曜日ごとの表示枠',instructionDayConfig:'授業曜日'};
const maps=new Set(['configEvents','calendarHolidays','customHolidays','dayProfiles']);
const dateLabel=id=>{const [y,m,d]=id.split('-');return `${y}年${Number(m)}月${Number(d)}日`};
export function receivedChanges(before,after){
 const rows=[];
 const add=(path,a,b)=>{if(samePayload(a,b))return;const empty=v=>v===undefined||v===null||v==='';const kind=empty(a)?'追加':empty(b)?'削除':'変更';const label=path.length>1?`${dateLabel(path[1])}・${path[2]||labels[path[0]]}`:labels[path[0]];rows.push({path,label,kind,before:a===undefined?null:clone(a),after:b===undefined?null:clone(b),rich:['dateSchedules','configEvents','globalTaskData'].includes(path[0])});};
 for(const key of SHARED_KEYS){
  const a=before?.[key],b=after?.[key];
  if(key==='dateSchedules')for(const date of [...new Set([...Object.keys(a||{}),...Object.keys(b||{})])].sort())for(const slot of [...new Set([...Object.keys(a?.[date]||{}),...Object.keys(b?.[date]||{})])])add([key,date,slot],a?.[date]?.[slot],b?.[date]?.[slot]);
  else if(maps.has(key))for(const date of [...new Set([...Object.keys(a||{}),...Object.keys(b||{})])].sort())add([key,date],a?.[date],b?.[date]);
  else add([key],a,b);
 }
 return rows;
}
// Collapse multiple applications during one sync to the first before/last after.
export function combineReceivedChanges(groups){const rows=new Map();for(const group of groups)for(const row of group){const key=JSON.stringify(row.path),old=rows.get(key);rows.set(key,old?{...row,before:old.before,kind:old.before===null?'追加':row.after===null?'削除':'変更'}:row)}return [...rows.values()].filter(row=>!samePayload(row.before,row.after));}
