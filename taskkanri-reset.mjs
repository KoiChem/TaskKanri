import {APP_CONFIG,LEGACY_STORAGE_KEYS} from './taskkanri-core.mjs';
const localKeys=new Set(['TASKKANRI_OFFLINE_MODE','TASKKANRI_CLOUD_ENABLED','TASKKANRI_LAST_ACCOUNT','TASKKANRI_SUPABASE_AUTH','TASKKANRI_TASK_PANEL_HEIGHT','TASKKANRI_MOBILE_WEEK',APP_CONFIG.storeKey,APP_CONFIG.readOnlyGuardKey,...LEGACY_STORAGE_KEYS]);
const sessionKeys=new Set(['TASKKANRI_CLIENT_ID','TASKKANRI_DESKTOP_OPENED']);
function keys(storage){return Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(Boolean)}
function isLocal(key){return localKeys.has(key)||key.startsWith('TASKKANRI_USER:')||key.startsWith('TASKKANRI_PRE_SYNC_BACKUP:')||key.startsWith(APP_CONFIG.recoveryPrefix)||key.startsWith(APP_CONFIG.quarantinePrefix)}
export function deleteRecoveryDatabase(indexedDB=globalThis.indexedDB,onBlocked=()=>{}){return new Promise((resolve,reject)=>{if(!indexedDB){reject(new Error('復旧データ保存領域を確認できません。'));return;}const req=indexedDB.deleteDatabase('TaskKanriRecovery');let settled=false;req.onsuccess=()=>{if(!settled){settled=true;resolve()}};req.onerror=()=>{if(!settled){settled=true;reject(req.error)}};req.onblocked=()=>onBlocked()})}
export async function resetTaskKanriStorage({local=globalThis.localStorage,session=globalThis.sessionStorage,onBlocked=()=>{},deleteRecovery=()=>deleteRecoveryDatabase(globalThis.indexedDB,onBlocked)}={}){
 await deleteRecovery();
 const targets=keys(local).filter(isLocal),sessions=keys(session).filter(key=>sessionKeys.has(key));
 for(const key of targets)local.removeItem(key);
 for(const key of sessions)session.removeItem(key);
 if(keys(local).some(isLocal)||keys(session).some(key=>sessionKeys.has(key)))throw new Error('一部のデータが残りました。再度削除してください。');
}
// Local estimates use the same UTF-16 accounting as the previous display;
// they are not a measurement of the browser's physical storage allocation.
export function storageBreakdown(local=globalThis.localStorage){
 const totals={master:0,pending:0,cache:0,recovery:0,quarantine:0,other:0};
 for(const key of keys(local)){
  if(!isLocal(key))continue;
  let category='other';
  if(key.includes(APP_CONFIG.recoveryPrefix)||key.startsWith('TASKKANRI_PRE_SYNC_BACKUP:'))category='recovery';
  else if(key.includes(APP_CONFIG.quarantinePrefix)||key.includes(':quarantine'))category='quarantine';
  else if(key.endsWith(':pending'))category='pending';
  else if(key.endsWith(':cache'))category='cache';
  else if(key===APP_CONFIG.storeKey||key.endsWith(':'+APP_CONFIG.storeKey))category='master';
  totals[category]+=(key.length+(local.getItem(key)?.length||0))*2;
 }
 return totals;
}
