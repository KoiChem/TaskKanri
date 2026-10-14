import { APP_CONFIG, clone, defaultState, normalizeState, normalizeImportedPayload, sanitizeHtml, stripHtml, getResolvedSlot, getDateSchedulePolicy, isSlotVisibleForDate, isValidIsoDate } from './taskkanri-core.mjs';

export const SHARED_KEYS = Object.freeze(['currentYear','dateSchedules','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','globalTaskData','countSettings','daySlotConfig','instructionDayConfig']);
export const BADGE_LABELS = ['未','途','済','急'];
export const TASK_LABELS = ['未着手','進行中','完了','急ぎ'];
const badgePattern = () => /<span\b([^>]*\bclass="[^"]*\btodo-badge\b[^"]*"[^>]*)>([\s\S]*?)<\/span>/gi;
function stableValue(value) {if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));return value;}
export function samePayload(a,b) {return JSON.stringify(stableValue(a))===JSON.stringify(stableValue(b));}
export function toPayload(state) {
  const checked=normalizeState(state); if(!checked.ok) throw new Error(checked.error);
  return {contractVersion:2, appSchemaVersion:8, state:Object.fromEntries(SHARED_KEYS.map(k=>[k,clone(checked.value[k])]))};
}
export function mergePayload(payload, local=defaultState()) {
  const legacy=payload?.contractVersion===1 && payload?.appSchemaVersion===7;
  const current=payload?.contractVersion===2 && payload?.appSchemaVersion===8;
  if((!legacy&&!current)||!payload.state||typeof payload.state!=='object'||Array.isArray(payload.state))throw new Error('データ形式を確認できません。アプリを更新してください。');
  const keys=legacy?['currentYear','weeklyTemplate','weeklyRules','dateOverrides','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','globalTaskData','countSettings','daySlotConfig','instructionDayConfig']:SHARED_KEYS;
  if(Object.keys(payload.state).length!==keys.length||keys.some(k=>!Object.hasOwn(payload.state,k)))throw new Error('共有データの必須項目が不足しています。');
  const converted=legacy?normalizeImportedPayload({meta:{schemaVersion:7},data:payload.state}):normalizeState(payload.state);
  if(!converted.ok)throw new Error(converted.error);
  const shared=Object.fromEntries(SHARED_KEYS.map(k=>[k,converted.value[k]]));
  const checked=normalizeState({...clone(local),...shared});if(!checked.ok)throw new Error(checked.error);
  return checked.value;
}
export function taskItems(value) {
  const html=sanitizeHtml(value); const out=[]; let match;
  const re=badgePattern();
  while((match=re.exec(html))) {
    const state=Number(match[1].match(/data-state="([0-3])"/)?.[1]);
    if(!Number.isInteger(state)) continue;
    const tail=html.slice(re.lastIndex).split(/<br\b|<div\b|<p\b|<span\b[^>]*todo-badge/i)[0];
    out.push({badgeIndex:out.length,state,text:stripHtml(tail).replace(/\u200B/g,'').trim()||'(タスク名なし)'});
  }
  return out;
}
export function changeTask(state, ref, targetState, revision) {
  if(ref.revision!==revision || !Number.isInteger(targetState) || targetState<0 || targetState>3) throw new Error('別の端末で変更されました。内容を確認してもう一度操作してください。');
  if(ref.source!=='global' && (ref.source!=='slot' || !isValidIsoDate(ref.dateId) || !APP_CONFIG.slotsAll.includes(ref.slot))) throw new Error('タスクの参照が不正です。');
  const before=ref.source==='global'?state.globalTaskData:getResolvedSlot(ref.dateId,ref.slot,state);
  if(sanitizeHtml(before)!==ref.originalHtml) throw new Error('タスクの内容が更新されています。');
  let index=0, found=false;
  const after=sanitizeHtml(before).replace(badgePattern(), (match,attrs) => {
    if(!/data-state="[0-3]"/.test(attrs)) return match;
    if(index++!==ref.badgeIndex) return match;
    found=true;
    const next=attrs.replace(/data-state="[0-3]"/,`data-state="${targetState}"`).replace(/class="[^"]*"/,`class="todo-badge state-${targetState}"`);
    return `<span${next}>${BADGE_LABELS[targetState]}</span>`;
  });
  if(!found) throw new Error('タスクが見つかりません。');
  const next=clone(state); const undo={source:ref.source,dateId:ref.dateId,slot:ref.slot,before,after};
  if(ref.source==='global') next.globalTaskData=after;
  else {
    undo.previousDay=clone(next.dateSchedules[ref.dateId]);
    next.dateSchedules[ref.dateId] ||= {};
    next.dateSchedules[ref.dateId][ref.slot]=after;
  }
  return {state:next,undo};
}
export function undoTask(state, undo) {
  const current=undo.source==='global'?state.globalTaskData:getResolvedSlot(undo.dateId,undo.slot,state);
  if(current!==undo.after) throw new Error('このタスクは更新されています。取り消しできません。');
  const next=clone(state);
  if(undo.source==='global') next.globalTaskData=undo.before;
  else if(undo.previousDay) next.dateSchedules[undo.dateId]=clone(undo.previousDay);
  else delete next.dateSchedules[undo.dateId];
  return next;
}
export function slotTime(dateId,slot,state) {
  const policy=getDateSchedulePolicy(dateId,state); if(policy.hideChime) return '';
  const group=policy.profile==='exam'?'exam':['short','short-am'].includes(policy.profile)?'short':'normal';
  return state.timeConfig[group][slot]||'';
}
export function tokyoToday(now=new Date()) { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function addDays(id,n) { const date=new Date(id+'T00:00:00Z'); date.setUTCDate(date.getUTCDate()+n); return date.toISOString().slice(0,10); }
export function calendarDays(month,week=false) {
  const first=week?month:month.slice(0,7)+'-01'; const start=addDays(first,-new Date(first+'T00:00:00Z').getUTCDay());
  return Array.from({length:week?7:42},(_,i)=>addDays(start,i));
}
export function hasAgenda(id,state) { return Boolean(stripHtml(state.configEvents[id]||'').trim()) || APP_CONFIG.slotsAll.some(s=>isSlotVisibleForDate(id,s,state)&&stripHtml(getResolvedSlot(id,s,state)).trim()); }
