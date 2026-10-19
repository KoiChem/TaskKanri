import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_CONFIG,createStorageService,defaultState,serializePayload} from '../taskkanri-core.mjs';
function fixture(){
 const state=defaultState();state.globalTaskData='before';const values=new Map([[APP_CONFIG.storeKey,JSON.stringify(serializePayload(state).value)]]);
 const storage={get length(){return values.size},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem(k,v){if(k.startsWith(APP_CONFIG.recoveryPrefix))throw new DOMException('full','QuotaExceededError');values.set(k,String(v))},removeItem:k=>values.delete(k)};
 const service=createStorageService(storage);service.load();const next=defaultState();next.globalTaskData='after';return {storage,service,next,values};
}
test('quota snapshot failure uses a committed external recovery backup before import',async()=>{
 const {storage,service,next}=fixture();let archived;
 const result=await service.importRawWithRecovery(serializePayload(next).value,async record=>{archived=record;assert.equal(service.getState().globalTaskData,'before');return 'indexeddb:backup-1'});
 assert.equal(result.ok,true);assert.equal(result.snapshotKey,'indexeddb:backup-1');assert.equal(archived.state.globalTaskData,'before');assert.equal(JSON.parse(archived.raw).data.globalTaskData,'before');assert.equal(service.getState().globalTaskData,'after');assert.equal(JSON.parse(storage.getItem(APP_CONFIG.storeKey)).data.globalTaskData,'after');
});
test('failed external recovery backup preserves the master and reports the underlying failure',async()=>{
 const {storage,service,next}=fixture(),before=storage.getItem(APP_CONFIG.storeKey);
 const result=await service.importRawWithRecovery(serializePayload(next).value,async()=>{throw new DOMException('denied','SecurityError')});
 assert.equal(result.ok,false);assert.match(result.error,/SecurityError/);assert.equal(storage.getItem(APP_CONFIG.storeKey),before);assert.equal(service.getState().globalTaskData,'before');
});
test('changes during asynchronous backup are not overwritten',async()=>{
 const {storage,service,next}=fixture();const result=await service.importRawWithRecovery(serializePayload(next).value,async()=>{const edit=defaultState();edit.globalTaskData='new edit';service.saveAll(edit);return 'indexeddb:backup-2'});
 assert.equal(result.ok,false);assert.match(result.error,/変更/);assert.equal(service.getState().globalTaskData,'new edit');assert.equal(JSON.parse(storage.getItem(APP_CONFIG.storeKey)).data.globalTaskData,'new edit');
});
test('non-quota snapshot failures are diagnostic and never remove data',async()=>{
 const {storage,service,next}=fixture();storage.setItem=()=>{throw new DOMException('denied','SecurityError')};let called=false;
 const result=await service.importRawWithRecovery(serializePayload(next).value,async()=>{called=true;return 'bad'});
 assert.equal(result.ok,false);assert.match(result.error,/SecurityError/);assert.equal(called,false);assert.equal(service.getState().globalTaskData,'before');
});
