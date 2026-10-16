export function exportFilename(identifier='',date=new Date()) {
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'2-digit',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const value=type=>parts.find(part=>part.type===type).value;
 return `${value('year')}${value('month')}${value('day')}${identifier?'_'+identifier:''}_TaskKanri.json`;
}
export function downloadJson(data,name=exportFilename()) {const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
