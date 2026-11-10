import {APP_CONFIG,LEGACY_STORAGE_KEYS,normalizeImportedPayload} from './taskkanri-core.mjs';
import {samePayload,toPayload,mergePayload,SHARED_KEYS} from './taskkanri-sync-model.mjs';
import {discardObsoleteRecovery} from './taskkanri-recovery-archive.mjs';
const legacy=new Set(LEGACY_STORAGE_KEYS);
const keys=s=>Array.from({length:s.length},(_,i)=>s.key(i)).filter(Boolean);
const parse=raw=>{try{return JSON.parse(raw)}catch{return null}};
function oldFormat(raw){const value=parse(raw);return Number.isInteger(value?.meta?.schemaVersion)&&value.meta.schemaVersion>=1&&value.meta.schemaVersion<8;}
export async function cleanupCurrentStorage(storage,{userId,tabId,activeTabs,discardHistory=discardObsoleteRecovery}={}){
 if(!userId||!activeTabs||[...activeTabs].some(id=>id!==tabId))return false;
 await storage.flush?.();
 const masterKey='TASKKANRI_USER:'+userId+':'+APP_CONFIG.storeKey,cacheKey='TASKKANRI_USER:'+userId+':cache',masterRaw=storage.getItem(masterKey),cacheRaw=storage.getItem(cacheKey),master=normalizeImportedPayload(masterRaw),cache=parse(cacheRaw);
 if(!cache||!Number.isSafeInteger(cache.revision)||cache.revision<1)return false;
 try{mergePayload(cache.payload)}catch{return false}
 if(masterRaw!==null&&(!master.ok||!SHARED_KEYS.every(key=>Object.hasOwn(parse(masterRaw)?.data||{},key))||!samePayload(toPayload(master.value),cache.payload)))return false;
 const obsolete=[];
 for(const key of keys(storage)){
  const raw=storage.getItem(key),leaf=key.startsWith('TASKKANRI_USER:')?key.slice(key.indexOf(':',15)+1):key;
  if(legacy.has(leaf)||key.startsWith('TASKKANRI_PRE_SYNC_BACKUP:')||/:legacy-backup$|:legacy-pending-backup:|:import-backup:/.test(key)||key.startsWith(APP_CONFIG.recoveryPrefix)||key.includes(':'+APP_CONFIG.recoveryPrefix)||key.endsWith(APP_CONFIG.storeKey)&&oldFormat(raw)){obsolete.push({key,raw});continue;}
  if(key.includes(APP_CONFIG.quarantinePrefix)){
   const record=parse(raw);if(record&&oldFormat(record.raw))obsolete.push({key,raw});
  }
  const match=key.match(/^TASKKANRI_USER:([^:]+):tab:([^:]+):pending$/);
  if(!match||match[1]!==userId||!activeTabs||activeTabs.has(match[2]))continue;
  const pending=parse(raw),request=pending?.request;
  if(request?.payload?.contractVersion===1&&request.payload.appSchemaVersion===7&&(!pending.nextPayload||pending.nextPayload.contractVersion===1&&pending.nextPayload.appSchemaVersion===7)){obsolete.push({key,raw});continue;}
  if(request?.attempted===false&&request.expectedRevision===cache.revision&&samePayload(request.payload,cache.payload)&&(!pending.nextPayload||samePayload(pending.nextPayload,cache.payload)))obsolete.push({key,raw});
 }
 await discardHistory();
 if(!obsolete.length)return true;
 const remove=()=>{
  // Include the verified master/cache in the same CAS transaction, so another
  // tab cannot change the baseline while redundant pending records are removed.
  if(storage.getItem(masterKey)!==masterRaw||storage.getItem(cacheKey)!==cacheRaw)throw Error('整理中に保存内容が変わりました。');
  if(masterRaw!==null)storage.setItem(masterKey,masterRaw);storage.setItem(cacheKey,cacheRaw);
  for(const item of obsolete)if(storage.getItem(item.key)===item.raw)storage.removeItem(item.key);
 };
 if(storage.atomic)storage.atomic(remove);else remove();
 await storage.flush?.();return true;
}
export async function cleanupCurrentDevice(storage,locks=globalThis.navigator?.locks){
 if(!locks?.query)return;
 const held=await locks.query(),activeTabs=new Set(held.held.filter(lock=>lock.name.startsWith('TASKKANRI_TAB:')).map(lock=>lock.name.slice('TASKKANRI_TAB:'.length)));
 if(activeTabs.size)return;
 const users=new Set(keys(storage).map(key=>key.match(/^TASKKANRI_USER:([^:]+):cache$/)?.[1]).filter(Boolean));
 for(const userId of users)await cleanupCurrentStorage(storage,{userId,activeTabs});
}
