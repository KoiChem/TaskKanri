import {APP_CONFIG} from './taskkanri-core.mjs';

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
