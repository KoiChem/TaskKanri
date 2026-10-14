import {academicYearBounds,isValidIsoDate,escapeHtmlText,sanitizeHtml,stripHtml} from './taskkanri-core.mjs';
function bulkDateName(html){return stripHtml(String(html).replace(/<br\s*\/?>/gi,' ')).replace(/[\r\n]+/g,' ').trim();}
export function formatBulkDateText(map,year){
 const bounds=academicYearBounds(year);
 return Object.entries(map).filter(([date])=>date>=bounds.start&&date<=bounds.end).sort(([a],[b])=>a.localeCompare(b)).map(([date,html])=>`${date.slice(2).replaceAll('-','')}:${bulkDateName(html)}`).join('\n');
}
export function validateDateRows(rows,year){
 const bounds=academicYearBounds(year),result={};
 rows.forEach((row,index)=>{
  if(!isValidIsoDate(row.date))throw new Error(`${index+1}行目: 実在する日付を入力してください。`);
  if(row.date<bounds.start||row.date>bounds.end)throw new Error(`${index+1}行目: 年度内の日付を入力してください。`);
  if(Object.hasOwn(result,row.date))throw new Error(`${index+1}行目: 日付が重複しています。`);
  if(!row.name.trim())throw new Error(`${index+1}行目: 名前を入力してください。`);
  result[row.date]=row.originalDate===row.date&&row.originalName===row.name&&typeof row.originalHtml==='string'?sanitizeHtml(row.originalHtml):escapeHtmlText(row.name.trim());
 });return result;
}
export function parseBulkDateRows(text,year,originalMap={}){
 const rows=[],seen=new Set();String(text).split(/\r?\n/).forEach((line,index)=>{
  if(!line.trim())return;const match=line.match(/^\s*(\d{2})(\d{2})(\d{2}):(.*)$/);
  if(!match)throw new Error(`${index+1}行目: YYMMDD:名前で入力してください。`);
  const calendarYear=[year,year+1].find(value=>value%100===Number(match[1]))??2000+Number(match[1]);
  const row={date:`${calendarYear}-${match[2]}-${match[3]}`,name:match[4].trim()};
  try{validateDateRows([row],year);if(seen.has(row.date))throw new Error('日付が重複しています。');}catch(error){throw new Error(`${index+1}行目: ${error.message.replace(/^1行目: /,'')}`);}
  seen.add(row.date);
  if(Object.hasOwn(originalMap,row.date)&&bulkDateName(originalMap[row.date])===row.name)Object.assign(row,{originalDate:row.date,originalName:row.name,originalHtml:originalMap[row.date]});
  rows.push(row);
 });return rows;
}
export function summarizeTimetableChanges(changes){return {days:new Set(changes.map(x=>x.dateId)).size,slots:changes.length,deleted:changes.filter(x=>!x.after).length,tasks:changes.filter(x=>/todo-badge/.test(x.before)).length};}
export function planSettingsDateMaps(state,drafts){
 const bounds=academicYearBounds(state.currentYear),result={};
 for(const [kind,key]of [['events','configEvents'],['holidays','customHolidays']]){
  if(drafts[kind]===undefined){result[key]={...state[key]};continue;}
  let replacement;try{replacement=validateDateRows(drafts[kind],state.currentYear);}catch(error){error.section=kind;throw error;}
  result[key]={...Object.fromEntries(Object.entries(state[key]).filter(([date])=>date<bounds.start||date>bounds.end)),...replacement};
 }return result;
}
