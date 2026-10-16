import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncController} from '../taskkanri-sync.js';
import {defaultState} from '../taskkanri-core.mjs';
const data=new Map();
globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
globalThis.document={addEventListener(){},visibilityState:'hidden'};
globalThis.window={addEventListener(){}};
test('offline selection saves locally, survives reload and never calls cloud',async()=>{
 let state=defaultState();const c=new SyncController({mode:'mobile',getState:()=>state,onData:s=>state=s});clearInterval(c.interval);
 await c.enterOffline();state.globalTaskData='端末で編集';assert.equal((await c.save(state)).status,'saved');
 assert.equal((await c.refresh()).status,'synced');
 const next=new SyncController({mode:'mobile',getState:defaultState,onData:s=>state=s});clearInterval(next.interval);await next.enterOffline();assert.equal(state.globalTaskData,'端末で編集');assert.equal(next.offlineMode,true);
});
test('cached account edits retain the cloud revision and durable pending mutation',async()=>{
 data.clear();const {syncStore}=await import('../taskkanri-device-storage.mjs');const {toPayload}=await import('../taskkanri-sync-model.mjs');
 const store=syncStore(localStorage,'account-a','tab-a');const initial=defaultState();initial.globalTaskData='取得済み';store.write('cache',{revision:7,payload:toPayload(initial)});
 localStorage.setItem('TASKKANRI_LAST_ACCOUNT',JSON.stringify({id:'account-a',email:'a@example.test'}));
 let state=defaultState();const c=new SyncController({mode:'mobile',getState:()=>state,onData:s=>state=s});clearInterval(c.interval);c.id='tab-a';
 await c.enterOffline();assert.equal(state.globalTaskData,'取得済み');state.globalTaskData='未送信の編集';await c.save(state);
 state.globalTaskData='続けて編集';await c.save(state);
 assert.equal(store.read('cache').payload.state.globalTaskData,'取得済み');assert.equal(store.read('pending').request.expectedRevision,7);assert.equal(store.read('pending').request.payload.state.globalTaskData,'続けて編集');
 const next=new SyncController({mode:'mobile',getState:defaultState,onData:s=>state=s});clearInterval(next.interval);next.id='tab-a';await next.enterOffline();assert.equal(state.globalTaskData,'続けて編集');assert.equal(next.user.id,'account-a');
});
test('switching while saving refuses without enabling offline preference',async()=>{
 data.clear();const c=new SyncController({getState:defaultState});clearInterval(c.interval);c.engine={busy:true};await assert.rejects(c.enterOffline(),/保存中/);assert.equal(localStorage.getItem('TASKKANRI_OFFLINE_MODE'),null);
});
test('resuming against a newer cloud revision preserves offline edits as a conflict',async()=>{
 data.clear();const {syncStore}=await import('../taskkanri-device-storage.mjs');const {toPayload}=await import('../taskkanri-sync-model.mjs');const {SyncEngine}=await import('../taskkanri-sync-engine.mjs');
 const store=syncStore(localStorage,'account-b','tab-b');store.write('cache',{revision:3,payload:toPayload(defaultState())});localStorage.setItem('TASKKANRI_LAST_ACCOUNT',JSON.stringify({id:'account-b'}));
 let state=defaultState();const c=new SyncController({mode:'mobile',getState:()=>state,onData:s=>state=s});clearInterval(c.interval);c.id='tab-b';await c.enterOffline();state.globalTaskData='オフラインの変更';await c.save(state);
 let writes=0;const resumed=new SyncEngine({store,transport:{get:async()=>({revision:4,payload:toPayload(defaultState())}),save:async()=>{writes++;}}});await resumed.load();assert.equal(resumed.status,'conflict');assert.equal(resumed.pending.request.payload.state.globalTaskData,'オフラインの変更');await resumed.flush();assert.equal(writes,0);
});
