import {normalizeImportedPayload} from './taskkanri-core.mjs';

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
async function boundedRows(db,namespace){
 return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();tx.oncomplete=()=>resolve(request.result.filter(row=>row.kind==='bounded'&&row.namespace===namespace));tx.onabort=()=>reject(tx.error||new Error('復旧データを読み取れません。'));});
}
export async function listBoundedRecovery({namespace,indexedDB=globalThis.indexedDB}={}){
 const db=await openDatabase(indexedDB);try{return await boundedRows(db,namespace||'legacy')}finally{db.close()}
}
export async function saveBoundedRecovery(record,{namespace,indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks}={}){
 const name=namespace||'legacy';if(typeof record.raw!=='string'||!normalizeImportedPayload(record.raw).ok)throw new Error('復旧データを保存できません。');
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
   const obsolete=[...rows.filter(row=>row.id!==bundle.id),bundle].sort((a,b)=>b.createdAt-a.createdAt).slice(1);
   await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(bundle);for(const row of obsolete)tx.objectStore(STORE).delete(row.id);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('復旧データを整理できません。'));});
   return 'indexeddb:'+bundle.id;
  }finally{db.close()}
 });
}

export async function recoveryArchiveUsage({indexedDB=globalThis.indexedDB}={}){
 const db=await openDatabase(indexedDB);
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();tx.oncomplete=()=>resolve({count:request.result.length,bytes:request.result.reduce((sum,row)=>sum+JSON.stringify(row).length*2,0)});tx.onabort=()=>reject(tx.error||new Error('復旧データの容量を確認できません。'));});}finally{db.close()}
}

export async function discardObsoleteRecovery({indexedDB=globalThis.indexedDB}={}){
 const db=await openDatabase(indexedDB);
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.getAll();
  request.onsuccess=()=>{
   const latest=new Map();
   for(const row of request.result){
    if(row.kind!=='bounded'||!Number.isFinite(row.createdAt)||!normalizeImportedPayload(row.raw).ok){store.delete(row.id);continue;}
    const previous=latest.get(row.namespace);
    if(!previous||row.createdAt>previous.createdAt){if(previous)store.delete(previous.id);latest.set(row.namespace,row);}else store.delete(row.id);
   }
  };
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('復旧データを整理できません。'));
 });}finally{db.close()}
}
