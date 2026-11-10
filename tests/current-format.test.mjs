import test from 'node:test';import assert from 'node:assert/strict';
import {APP_CONFIG,defaultState,serializePayload,normalizeImportedPayload,createStorageService} from '../taskkanri-core.mjs';
import {mergePayload,toPayload} from '../taskkanri-sync-model.mjs';
import {SyncEngine} from '../taskkanri-sync-engine.mjs';
const memory=()=>{const data=new Map();return {get length(){return data.size},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}};
test('current wrapped schema8 full and partial imports work while retired formats are rejected',()=>{
 assert.equal(normalizeImportedPayload(serializePayload(defaultState()).value).ok,true);
 assert.equal(normalizeImportedPayload({meta:{schemaVersion:8},data:{globalTaskData:'current'}}).ok,true);
 for(const raw of [{globalTaskData:'old'},...Array.from({length:7},(_,i)=>({meta:{schemaVersion:i+1},data:{currentYear:2026}})),{meta:{version:73},data:{currentYear:2026}}])assert.equal(normalizeImportedPayload(raw).ok,false);
});
test('unsupported on-device master stays intact and read-only rather than being upgraded or replaced',()=>{
 const storage=memory(),raw=JSON.stringify({meta:{schemaVersion:7},data:{currentYear:2026}});storage.setItem(APP_CONFIG.storeKey,raw);const service=createStorageService(storage),result=service.load();assert.equal(result.readOnly,true);assert.equal(storage.getItem(APP_CONFIG.storeKey),raw);assert.equal(service.saveAll(defaultState()).ok,false);
});
test('cloud contract1 is rejected while current contract2 remains accepted',()=>{
 const payload=toPayload(defaultState());assert.doesNotThrow(()=>mergePayload(payload));const oldState={...payload.state,weeklyTemplate:{},weeklyRules:{},dateOverrides:{}};delete oldState.dateSchedules;assert.throws(()=>mergePayload({contractVersion:1,appSchemaVersion:7,state:oldState}));
});
test('unsupported pending request is retained and blocked before any network submission',async()=>{
 const payload={...toPayload(defaultState()),contractVersion:1,appSchemaVersion:7};const pending={request:{mutationId:'keep',expectedRevision:4,attempted:true,payload}};let sent=0;const values=new Map([['pending',pending]]),store={read:k=>values.get(k)??null,write:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};const engine=new SyncEngine({store,transport:{save:async()=>{sent++}}});assert.equal(engine.status,'blocked');await engine.flush();assert.equal(sent,0);assert.deepEqual(store.read('pending'),pending);assert.equal([...values.keys()].length,1);
});

test('unwrapped retired on-device data cannot replace itself with defaults',()=>{
 const storage=memory(),raw=JSON.stringify({currentYear:2026,globalTaskData:'preserve'});storage.setItem(APP_CONFIG.storeKey,raw);const result=createStorageService(storage).load();assert.equal(result.readOnly,true);assert.equal(storage.getItem(APP_CONFIG.storeKey),raw);
});
