import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_CONFIG,createStorageService,defaultState} from '../taskkanri-core.mjs';
import {SyncController} from '../taskkanri-sync.js';
import {SyncEngine} from '../taskkanri-sync-engine.mjs';
import {syncStore,scopedStorage} from '../taskkanri-device-storage.mjs';
import {toPayload} from '../taskkanri-sync-model.mjs';
import {saveOfflineImport} from '../taskkanri-offline-import.mjs';
globalThis.document={addEventListener(){},visibilityState:'hidden'};globalThis.window={addEventListener(){}};
function fixture(localOnly=false){
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size}};
 const user=localOnly?'offline-local':'user',id=localOnly?'shared':'tab',scoped=scopedStorage(storage,user),service=createStorageService(scoped);service.load();
 const state=service.getState(),store=syncStore(storage,user,id);store.write('cache',{revision:7,payload:toPayload(state)});
 const c=new SyncController({mode:'desktop',getState:()=>state});clearInterval(c.interval);c.offlineMode=true;c.localOnly=localOnly;c.user={id:user};c.id=id;c.engine=new SyncEngine({store,transport:{save:async req=>{if(!localOnly)throw new Error('must not send');const doc={revision:req.expectedRevision+1,payload:req.payload};store.write('cache',doc);return {status:'saved',appliedRevision:doc.revision}}}});c.engine.loadCached();c.engine.manualOffline=true;c.engine.emit('blocked','previous sync error');
 return {storage,scoped,service,c,store,state};
}
test('real offline import saves despite a blocked cloud state, preserving the attempted mutation',()=>{
 const f=fixture();const old={request:{mutationId:'original',expectedRevision:7,attempted:true,payload:toPayload(f.state)}};f.store.write('pending',old);f.c.engine.pending=old;
 const next=defaultState();next.globalTaskData='imported';saveOfflineImport(f.c,f.service,f.scoped,APP_CONFIG.storeKey,next);
 assert.equal(f.service.getState().globalTaskData,'imported');assert.equal(f.store.read('pending').request.mutationId,'original');assert.equal(f.store.read('pending').nextPayload.state.globalTaskData,'imported');
 const restored=new SyncEngine({store:f.store,transport:{},onData:d=>assert.equal(d.payload.state.globalTaskData,'imported')});assert.equal(restored.loadCached(),true);
});
test('pending storage failure rolls back the master and retains recovery backup and old queue',()=>{
 const f=fixture();const before=f.scoped.getItem(APP_CONFIG.storeKey),cache=f.store.read('cache');const set=f.storage.setItem;f.storage.setItem=(k,v)=>{if(k.endsWith(':pending'))throw new DOMException('quota','QuotaExceededError');set(k,v)};
 const next=defaultState();next.globalTaskData='must not persist';assert.throws(()=>saveOfflineImport(f.c,f.service,f.scoped,APP_CONFIG.storeKey,next),/端末/);
 assert.equal(f.scoped.getItem(APP_CONFIG.storeKey),before);assert.equal(f.service.getState().globalTaskData,'');assert.equal(f.store.read('pending'),null);assert.deepEqual(f.store.read('cache'),cache);assert.ok([...Array(f.scoped.length)].some((_,i)=>f.scoped.key(i).startsWith(APP_CONFIG.recoveryPrefix)));
});
test('later local-only edits survive after offline import and reload',async()=>{
 const f=fixture(true),next=defaultState();next.globalTaskData='imported';saveOfflineImport(f.c,f.service,f.scoped,APP_CONFIG.storeKey,next);next.globalTaskData='later edit';f.c.dirty(next);await Promise.resolve();
 const restored=new SyncEngine({store:f.store,transport:{},onData:d=>assert.equal(d.payload.state.globalTaskData,'later edit')});assert.equal(restored.loadCached(),true);
});
test('all previous cloud flags permit explicit offline imports',()=>{for(const status of ['blocked','conflict','loading','deferred']){const f=fixture();f.c.engine.status=status;const next=defaultState();next.globalTaskData=status;saveOfflineImport(f.c,f.service,f.scoped,APP_CONFIG.storeKey,next);assert.equal(f.service.getState().globalTaskData,status);assert.equal(f.store.read('pending').request.expectedRevision,7)}});
test('a read-only local store still stops import before changing the queue',()=>{const f=fixture();const set=f.storage.setItem;f.storage.setItem=(k,v)=>{if(k.startsWith('TASKKANRI_USER:user:'+APP_CONFIG.recoveryPrefix))throw new DOMException('quota','QuotaExceededError');set(k,v)};assert.throws(()=>saveOfflineImport(f.c,f.service,f.scoped,APP_CONFIG.storeKey,defaultState()),/snapshot|読み取り/);assert.equal(f.store.read('pending'),null)});
test('failed pending overwrite preserves an existing attempted request without retrying its failed write',()=>{const f=fixture();const old={request:{mutationId:'keep',expectedRevision:7,attempted:true,payload:toPayload(f.state)}};f.store.write('pending',old);f.c.engine.pending=old;const set=f.storage.setItem;f.storage.setItem=(k,v)=>{if(k.endsWith(':pending'))throw new DOMException('quota','QuotaExceededError');set(k,v)};const next=defaultState();next.globalTaskData='reject';assert.throws(()=>saveOfflineImport(f.c,f.service,f.scoped,APP_CONFIG.storeKey,next),/元のデータに戻/);assert.deepEqual(f.store.read('pending'),old);assert.equal(f.service.getState().globalTaskData,'')});
