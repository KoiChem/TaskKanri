import {clone,sanitizeHtml,getResolvedSlot,APP_CONFIG,academicYearBounds,isValidIsoDate} from './taskkanri-core.mjs';
import {scopedStorage,jsonStore} from './taskkanri-device-storage.mjs';

export function prepareGlobalSave(state,originalHtml,html){
 if(sanitizeHtml(state.globalTaskData)!==sanitizeHtml(originalHtml))throw new Error('別の端末で共通タスクが更新されています。下書きは保持しています。');
 const next=clone(state);next.globalTaskData=sanitizeHtml(html);return next;
}
export function prepareSlotSave(state,dateId,slot,originalHtml,html){
 const bounds=academicYearBounds(state.currentYear);
 if(!isValidIsoDate(dateId)||dateId<bounds.start||dateId>bounds.end)throw new Error('表示中の年度の日付を選んでください。');
 if(!APP_CONFIG.slotsAll.includes(slot))throw new Error('予定枠を確認できません。');
 if(sanitizeHtml(getResolvedSlot(dateId,slot,state))!==sanitizeHtml(originalHtml))throw new Error('別の端末で予定が更新されています。下書きは保持しています。');
 const next=clone(state);next.dateSchedules[dateId]||={};next.dateSchedules[dateId][slot]=sanitizeHtml(html);return next;
}
export function globalDraftStore(storage,user){return draftStore(storage,user,'mobile-global-draft')}
export function slotDraftStore(storage,user,dateId,slot){return draftStore(storage,user,`mobile-slot-draft:${dateId}:${slot}`)}
function draftStore(storage,user,key){
 const store=jsonStore(scopedStorage(storage,user));
 const read=()=>{const draft=store.read(key);if(draft===null)return null;if(typeof draft.id!=='string'||typeof draft.html!=='string'||typeof draft.originalHtml!=='string')throw new Error('下書きの形式を確認できません。保存データを保全してください。');return {...draft,html:sanitizeHtml(draft.html),originalHtml:sanitizeHtml(draft.originalHtml)}};
 return {read,write:draft=>store.write(key,{...draft,html:sanitizeHtml(draft.html),originalHtml:sanitizeHtml(draft.originalHtml)}),clearIfUnchanged:expected=>{const actual=read();if(actual&&actual.id===expected.id&&actual.html===expected.html&&actual.originalHtml===expected.originalHtml)store.remove(key)}};
}
