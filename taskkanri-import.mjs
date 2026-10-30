import {clone,normalizeState,normalizeImportedPayload,migrateToCurrent,sanitizeHtml,stripHtml} from './taskkanri-core.mjs';
import {samePayload} from './taskkanri-sync-model.mjs';
const names={timetableWords:'時間割からの候補',currentYear:'表示する年度',dateSchedules:'予定',configEvents:'行事',globalTaskData:'共通タスク',calendarHolidays:'暦の祝日',customHolidays:'学校独自休日',dayProfiles:'日別の時程',timeConfig:'チャイム設定',daySlotConfig:'曜日ごとの表示枠',instructionDayConfig:'授業曜日',countSettings:'カウント設定',countDateRange:'カウント対象期間',isLandscapeMode:'画面の向き',isClockVisible:'時計表示',isWakeLockRequested:'画面の点灯維持',bulkCalendarSelectionMode:'カレンダーの選択方法',bulkCalendarMonthLayout:'カレンダーの並び方'};
const maps=new Set(['dateSchedules','configEvents','customHolidays','calendarHolidays','dayProfiles']);
const aliases={currentYear:['academicYear'],dateSchedules:['scheduleData','teacherSchedule','configWeekly','weeklyTemplate','weeklyRules','dateOverrides'],dayProfiles:['noClassData','shortData','examData']};
const own=(o,k)=>Object.hasOwn(o,k);
const emptyFor=key=>key==='dayProfiles'?'normal':'';
const get=(state,path)=>path.reduce((value,key)=>value?.[key],state);
function mergeExplicit(current,normalized,source){
 if(!source||typeof source!=='object'||Array.isArray(source)||!current||typeof current!=='object'||Array.isArray(current)||!normalized||typeof normalized!=='object')return clone(normalized);
 const merged=clone(current);for(const key of Object.keys(source))if(own(normalized,key))merged[key]=mergeExplicit(current[key],normalized[key],source[key]);return merged;
}
export function importValueText(value,field=''){
 const profileNames={normal:'通常時程',short:'短縮時程','short-am':'短縮AM',morning:'午前時程',exam:'定期考査','mock-exam':'模擬試験','noclass-hide':'授業なし（枠を非表示）','noclass-show':'授業なし（枠を表示）'};
 if(field==='dayProfiles')return profileNames[value]||String(value);
 if(field==='currentYear')return `${value}年度`;
 if(field==='isLandscapeMode')return value?'横向き':'縦向き';
 if(field==='bulkCalendarSelectionMode')return value==='additive'?'追加選択':'通常選択';
 if(field==='bulkCalendarMonthLayout')return value==='vertical'?'縦並び':'横並び';
 if(typeof value==='string')return stripHtml(sanitizeHtml(value).replace(/<br\s*\/?\s*>|<\/div>|<\/p>/gi,'\n')).replace(/\u200b/g,'').trim()||'（空欄）';
 if(typeof value==='boolean')return value?'オン':'オフ';
 if(value===null||value===undefined)return '（なし）';
 if(typeof value!=='object')return String(value);
 const labels={normal:'通常',short:'短縮',exam:'定期考査',name:'名称',status:'確定状態',confirmed:'確定',tentative:'暫定',word:'対象',mode:'方向',start:'開始',end:'終了',up:'増加',down:'減少',horizontal:'横並び',vertical:'縦並び',standard:'通常',additive:'追加'};
 return Object.entries(value).map(([k,v])=>`${(Array.isArray(value)?'条件'+(Number(k)+1):labels[k])||(/^[0-6]$/.test(k)?'日月火水木金土'[Number(k)]+'曜':k)}：${typeof v==='string'&&labels[v]?labels[v]:importValueText(v)}`).join('\n');
}
export function planImport(current,raw){
 let parsed;try{parsed=typeof raw==='string'?JSON.parse(raw):raw}catch{throw new Error('JSONを解析できません。TaskKanriのJSONファイルを選んでください。')}
 const result=normalizeImportedPayload(parsed);if(!result.ok)throw new Error(result.error);
 const source=parsed.data||parsed;
 const migrated=migrateToCurrent(source,result.sourceSchemaVersion);if(!migrated.ok)throw new Error(migrated.error);
 const rows=[];
 const add=(path,after)=>{
  const before=get(current,path)??emptyFor(path[0]);if(samePayload(before,after))return;
  const deletion=typeof after==='string'&&!stripHtml(after).trim()&&typeof before==='string'&&!!stripHtml(before).trim();
  rows.push({id:JSON.stringify(path),path,before:clone(before),after:clone(after),deletion,group:names[path[0]],label:[names[path[0]],...path.slice(1)].join('・')});
 };
 for(const key of Object.keys(names)){
  if(!own(source,key)&&!aliases[key]?.some(k=>own(source,k)))continue;
  if(maps.has(key)){
   // Walk the source shape, since normalization intentionally removes explicit blanks.
   const entries=clone(migrated.value[key]||{});
   if(key==='dateSchedules')for(const legacy of ['scheduleData','teacherSchedule'])for(const [dateId,day] of Object.entries(source[legacy]||{}))for(const [slot,content] of Object.entries(day.slots||day))if(!stripHtml(sanitizeHtml(content)).trim()){entries[dateId]||={};entries[dateId][slot]=''}
   if(key==='dayProfiles')for(const legacy of ['noClassData','shortData','examData'])for(const [dateId,value] of Object.entries(source[legacy]||{}))if(!value&&!own(entries,dateId))entries[dateId]='normal';
   if(key==='dateSchedules')for(const [dateId,day] of Object.entries(source.dateOverrides||{}))for(const [slot,override] of Object.entries(day.slots||{}))if(override.action==='cancel'){entries[dateId]||={};entries[dateId][slot]=''}
   for(const [dateId,value] of Object.entries(entries)){
    if(key==='dateSchedules')for(const slot of Object.keys(value))add([key,dateId,slot],result.value[key]?.[dateId]?.[slot]||'');
    else add([key,dateId],result.value[key]?.[dateId]??emptyFor(key));
   }
  }else add([key],mergeExplicit(current[key],result.value[key],source[key]));
 }
 return {before:clone(current),rows,yearChanged:rows.some(r=>r.path[0]==='currentYear'),year:result.value.currentYear};
}
export function applyImport(current,plan,selected){
 if(!samePayload(current,plan.before))throw new Error('確認中にデータが変更されました。変更一覧を確認し直してください。');
 const ids=new Set(selected),rows=plan.rows.filter(r=>ids.has(r.id));
 if(plan.yearChanged&&rows.some(r=>maps.has(r.path[0]))&&!rows.some(r=>r.path[0]==='currentYear'))throw new Error('日付のあるデータを取り込むには、表示する年度の変更も選択してください。');
 const next=clone(current);
 for(const row of rows){let target=next;for(const key of row.path.slice(0,-1))target=target[key]||=(Object.create(null));if(row.deletion&&maps.has(row.path[0]))delete target[row.path.at(-1)];else target[row.path.at(-1)]=clone(row.after)}
 const result=normalizeState(next);if(!result.ok)throw new Error(result.error);return result.value;
}
