import {academicYearBounds,isValidIsoDate,escapeHtmlText,sanitizeHtml} from './taskkanri-core.mjs';
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
export function parseBulkDateRows(text,year){
 const rows=[];String(text).split(/\r?\n/).forEach((line,index)=>{
  if(!line.trim())return;const match=line.match(/^\s*(\d{2})(\d{2})(\d{2}):(.*)$/);
  if(!match)throw new Error(`${index+1}行目: YYMMDD:名前で入力してください。`);
  const row={date:`20${match[1]}-${match[2]}-${match[3]}`,name:match[4].trim()};
  try{validateDateRows([row],year);}catch(error){throw new Error(`${index+1}行目: ${error.message.replace(/^1行目: /,'')}`);}rows.push(row);
 });validateDateRows(rows,year);return rows;
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
