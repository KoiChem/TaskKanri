import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_CONFIG,createStorageService,defaultState,serializePayload} from '../taskkanri-core.mjs';

test('a recovery snapshot retains one restorable copy of the current master',()=>{
 const entries=new Map();const storage={get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
 const service=createStorageService(storage);service.load();const state=defaultState();state.globalTaskData='long memo '.repeat(2000);assert.equal(service.saveAll(state).ok,true);
 const master=storage.getItem(APP_CONFIG.storeKey);const result=service.createRecoverySnapshot();assert.equal(result.ok,true);
 const snapshot=JSON.parse(storage.getItem(result.key));assert.equal(snapshot.raw,master);assert.equal(snapshot.state,undefined);
 assert.ok(storage.getItem(result.key).length < master.length*1.15,'snapshot contains duplicate data');
});

test('cloud replacement retains a rollback copy until the new master is saved and does not accumulate history',()=>{
 const entries=new Map();const storage={get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
 const service=createStorageService(storage);service.load();const before=defaultState();before.globalTaskData='before';service.saveAll(before);
 const next=defaultState();next.globalTaskData='after';assert.equal(typeof service.saveCloudWithRecovery,'function');
 const set=storage.setItem;storage.setItem=(key,value)=>{if(key===APP_CONFIG.storeKey)throw new Error('disk');set(key,value)};
 assert.equal(service.saveCloudWithRecovery(next).ok,false);assert.equal(JSON.parse(storage.getItem(APP_CONFIG.storeKey)).data.globalTaskData,'before');
 const recovery=[...entries.keys()].find(k=>k.startsWith(APP_CONFIG.recoveryPrefix));assert.equal(JSON.parse(JSON.parse(storage.getItem(recovery)).raw).data.globalTaskData,'before');
 storage.setItem=set;const fresh=createStorageService(storage);storage.removeItem(APP_CONFIG.readOnlyGuardKey);fresh.load();assert.equal(fresh.saveCloudWithRecovery(next).ok,true);assert.equal([...entries.keys()].filter(k=>k.startsWith(APP_CONFIG.recoveryPrefix)).length,0);
});

test('import requires a verified external backup before replacing the master',async()=>{
 const entries=new Map();const storage={get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
 const service=createStorageService(storage);service.load();const before=defaultState();before.globalTaskData='before';service.saveAll(before);const next=defaultState();next.globalTaskData='after';
 assert.equal(typeof service.importRawArchived,'function');
 const failed=await service.importRawArchived(serializePayload(next).value,async()=>{throw Error('archive failed')});assert.equal(failed.ok,false);assert.equal(service.getState().globalTaskData,'before');
 let preserved;const saved=await service.importRawArchived(serializePayload(next).value,async record=>{preserved=record.raw;return 'indexeddb:1'});assert.equal(saved.ok,true);assert.equal(JSON.parse(preserved).data.globalTaskData,'before');assert.equal(service.getState().globalTaskData,'after');
});

test('import refuses to replace data if the account changes while awaiting backup',async()=>{
 const entries=new Map();const storage={get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
 const service=createStorageService(storage);service.load();const before=storage.getItem(APP_CONFIG.storeKey);let valid=true;
 const next=defaultState();next.globalTaskData='after';const result=await service.importRawArchived(serializePayload(next).value,async()=>{valid=false;return 'indexeddb:1'},()=>valid);
 assert.equal(result.ok,false);assert.equal(storage.getItem(APP_CONFIG.storeKey),before);
});

test('snapshot preserves both in-memory data and master when another tab changed the master',()=>{
 const entries=new Map();const storage={get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
 const a=createStorageService(storage);a.load();const stateA=defaultState();stateA.globalTaskData='未送信A';a.saveAll(stateA);
 const b=createStorageService(storage);b.load();const stateB=defaultState();stateB.globalTaskData='別タブB';b.saveAll(stateB);
 const result=a.createRecoverySnapshot();assert.equal(result.ok,true);const record=JSON.parse(storage.getItem(result.key));assert.equal(JSON.parse(record.raw).data.globalTaskData,'別タブB');assert.equal(record.state.globalTaskData,'未送信A');
});

test('import refuses to commit if synchronization becomes busy or conflicted during backup',async()=>{
 const {importReadinessError}=await import('../taskkanri-transfer-errors.mjs');
 for(const status of ['busy','conflict','blocked','deferred','loading','offline']){
  const entries=new Map();const storage={get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
  const service=createStorageService(storage);service.load();const before=storage.getItem(APP_CONFIG.storeKey),engine={status:'synced',busy:false};const next=defaultState();next.globalTaskData='must not commit';
  const result=await service.importRawArchived(serializePayload(next).value,async()=>{if(status==='busy')engine.busy=true;else engine.status=status;return 'indexeddb:1'},()=>!importReadinessError(engine,false));
  assert.equal(result.ok,false,status);assert.equal(storage.getItem(APP_CONFIG.storeKey),before,status);
 }
});

test('import does not overwrite another tab when its master differs from the displayed state',async()=>{
 const entries=new Map();const storage={get length(){return entries.size},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
 const a=createStorageService(storage);a.load();const stateA=defaultState();stateA.globalTaskData='端末A';a.saveAll(stateA);const b=createStorageService(storage);b.load();const stateB=defaultState();stateB.globalTaskData='端末B';b.saveAll(stateB);
 const next=defaultState();next.globalTaskData='取り込み後';const result=await a.importRawArchived(serializePayload(next).value,async()=> 'indexeddb:1');assert.equal(result.ok,false);assert.equal(JSON.parse(storage.getItem(APP_CONFIG.storeKey)).data.globalTaskData,'端末B');assert.equal(a.getState().globalTaskData,'端末A');
});
