import {samePayload} from './taskkanri-sync-model.mjs';
import {APP_CONFIG,normalizeImportedPayload,normalizeState} from './taskkanri-core.mjs';

const DATABASE='TaskKanriRecovery',STORE='backups';
function openDatabase(indexedDB){
 return new Promise((resolve,reject)=>{
  if(!indexedDB){reject(new Error('端末のバックアップ保存領域を利用できません。'));return}
  let settled=false;
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});
  request.onerror=()=>{settled=true;reject(request.error)};
  request.onblocked=()=>{settled=true;reject(new Error('ほかのTaskKanri画面を閉じて、もう一度取り込んでください。'))};
  request.onsuccess=()=>{if(settled)request.result.close();else resolve(request.result)};
 });
}
function writeBundle(db,bundle){
 return new Promise((resolve,reject)=>{
  const transaction=db.transaction(STORE,'readwrite');
  transaction.oncomplete=()=>resolve();
  transaction.onabort=()=>reject(transaction.error||new Error('バックアップの保存を完了できません。'));
  transaction.objectStore(STORE).add(bundle);
 });
}
function readBundle(db,id){
 return new Promise((resolve,reject)=>{
  const transaction=db.transaction(STORE,'readonly'),request=transaction.objectStore(STORE).get(id);
  transaction.oncomplete=()=>resolve(request.result);
  transaction.onabort=()=>reject(transaction.error||new Error('バックアップを読み戻せません。'));
 });
}
function isRecoveryKey(key){
 return key?.startsWith(APP_CONFIG.recoveryPrefix)||key?.startsWith('TASKKANRI_USER:')&&key.includes(':'+APP_CONFIG.recoveryPrefix);
}
// Only TaskKanri recovery copies are relocated. Masters, unsent queues and other apps stay intact.
export async function archiveRecovery(record,{namespace,storage=globalThis.localStorage,indexedDB=globalThis.indexedDB}={}){
 const records=[];
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(isRecoveryKey(key))records.push({key,raw:storage.getItem(key)})}
 const bundle={id:crypto.randomUUID(),namespace:namespace||'legacy',createdAt:new Date().toISOString(),record,records};
 const db=await openDatabase(indexedDB);
 try{
  await writeBundle(db,bundle);
  const saved=await readBundle(db,bundle.id);
  if(JSON.stringify(saved)!==JSON.stringify(bundle))throw new Error('バックアップの保存内容を確認できません。');
  // Never delete a copy before commit/readback, or if another tab has changed it.
  for(const item of records)if(storage.getItem(item.key)===item.raw)storage.removeItem(item.key);
  return 'indexeddb:'+bundle.id;
 }finally{db.close()}
}

// These records are separate from legacy bundles, which may contain data from
// several accounts and must not be pruned without inspecting their contents.
async function boundedRows(db,namespace){
 return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();tx.oncomplete=()=>resolve(request.result.filter(row=>row.kind==='bounded'&&row.namespace===namespace));tx.onabort=()=>reject(tx.error||new Error('復旧データを読み取れません。'));});
}
export async function listBoundedRecovery({namespace,indexedDB=globalThis.indexedDB}={}){
 const db=await openDatabase(indexedDB);try{return await boundedRows(db,namespace||'legacy')}finally{db.close()}
}
export async function saveBoundedRecovery(record,{namespace,indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks}={}){
 const name=namespace||'legacy';if(typeof record.raw!=='string')throw new Error('復旧データを保存できません。');
 if(!locks)throw new Error('復旧データの同時保存を保護できません。');
 return locks.request('TASKKANRI_RECOVERY:'+name,async()=>{
  const db=await openDatabase(indexedDB);
  try{
   const rows=await boundedRows(db,name);const duplicate=rows.find(row=>row.raw===record.raw);
   const provided=record.createdAt===undefined?null:Date.parse(record.createdAt);
   if(provided!==null&&!Number.isFinite(provided))throw new Error('復旧データの日時が不正です。');
   const createdAt=provided===null?Math.max(Date.now(),...rows.map(row=>Number(row.createdAt)||0))+1:Math.max(provided,Number(duplicate?.createdAt)||0);
   const bundle={id:duplicate?.id||crypto.randomUUID(),kind:'bounded',namespace:name,createdAt,raw:record.raw};
   if(!duplicate)await writeBundle(db,bundle);
   const saved=await readBundle(db,bundle.id);
   if(!saved||saved.raw!==bundle.raw||saved.namespace!==name)throw new Error('バックアップの保存内容を確認できません。');
   const obsolete=[...rows.filter(row=>row.id!==bundle.id),bundle].sort((a,b)=>b.createdAt-a.createdAt).slice(3);
   await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(bundle);for(const row of obsolete)tx.objectStore(STORE).delete(row.id);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('復旧データを整理できません。'));});
   return 'indexeddb:'+bundle.id;
  }finally{db.close()}
 });
}

// Migrate only records that can be restored, retaining malformed material intact.
export async function migrateRecoveryCopies({namespace,storage=globalThis.localStorage,indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks}={}){
 const prefix=(namespace?'TASKKANRI_USER:'+namespace+':':'')+APP_CONFIG.recoveryPrefix;
 const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(prefix)).sort();
 for(const key of keys){
  const previous=storage.getItem(key);let record;
  try{record=JSON.parse(previous)}catch{continue}
  if(typeof record?.raw!=='string'||!normalizeImportedPayload(record.raw).ok||!Number.isFinite(Date.parse(record.createdAt)))continue;
  if(record.state){const state=normalizeState(record.state);if(!state.ok||!samePayload(normalizeImportedPayload(record.raw).value,state.value))continue;}
  await saveBoundedRecovery({raw:record.raw,createdAt:record.createdAt},{namespace,indexedDB,locks});
  if(storage.getItem(key)===previous)storage.removeItem(key);
 }
}
export async function recoveryArchiveUsage({indexedDB=globalThis.indexedDB}={}){
 const db=await openDatabase(indexedDB);
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();tx.oncomplete=()=>resolve({count:request.result.length,bytes:request.result.reduce((sum,row)=>sum+JSON.stringify(row).length*2,0)});tx.onabort=()=>reject(tx.error||new Error('復旧データの容量を確認できません。'));});}finally{db.close()}
}

export function legacyRecoveryCandidates(bundle){
 if(!bundle||bundle.kind==='bounded'||!bundle.record||!Array.isArray(bundle.records))return null;
 const rows=[];
 const add=(record,namespace)=>{
  if(typeof record?.raw!=='string'||!Number.isFinite(Date.parse(record.createdAt)))return false;
  const parsed=normalizeImportedPayload(record.raw);if(!parsed.ok)return false;
  if(record.state){const state=normalizeState(record.state);if(!state.ok||!samePayload(parsed.value,state.value))return false;}
  rows.push({raw:record.raw,createdAt:record.createdAt,namespace:namespace||'legacy'});return true;
 };
 if(!add(bundle.record,bundle.namespace))return null;
 for(const item of bundle.records){
  if(typeof item?.key!=='string'||!isRecoveryKey(item.key))return null;
  let record;try{record=JSON.parse(item.raw)}catch{return null}
  if(!add(record,item.key.match(/^TASKKANRI_USER:([^:]+):/)?.[1]))return null;
 }
 return rows;
}
export async function compactLegacyRecoveryBundles({indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks}={}){
 let db=await openDatabase(indexedDB),bundles;
 try{bundles=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(tx.error)})}finally{db.close()}
 let removed=0;
 for(const bundle of bundles){
  const rows=legacyRecoveryCandidates(bundle);if(!rows)continue;
  for(const row of rows.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)))await saveBoundedRecovery(row,{namespace:row.namespace,indexedDB,locks});
  db=await openDatabase(indexedDB);
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(bundle.id);request.onsuccess=()=>{if(JSON.stringify(request.result)===JSON.stringify(bundle)){store.delete(bundle.id);removed++}};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('旧復旧データを整理できません。'))})}finally{db.close()}
 }
 return removed;
}
