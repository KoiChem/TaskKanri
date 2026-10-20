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
test('switching during a stalled save preserves the attempted request for safe retry',async()=>{
 data.clear();const {syncStore}=await import('../taskkanri-device-storage.mjs');const {toPayload}=await import('../taskkanri-sync-model.mjs');const {SyncEngine}=await import('../taskkanri-sync-engine.mjs');
 const original=globalThis.fetch;globalThis.fetch=async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
 const store=syncStore(localStorage,'saving-account','saving-tab');let state=defaultState();store.write('cache',{revision:8,payload:toPayload(state)});
 const c=new SyncController({mode:'mobile',getState:()=>state,onData:s=>state=s});c.id='saving-tab';c.user={id:'saving-account'};
 try{
  c.engine=new SyncEngine({store,transport:{get:async()=>store.read('cache'),save:()=>c.fetchOnline('https://example.test')}});await c.engine.load();state.globalTaskData='保存中の編集';c.engine.queue(state);
  const saving=c.flush();const mutation=store.read('pending').request.mutationId;assert.equal(c.engine.busy,true);
  await c.enterOffline();assert.equal((await saving).status,'stopped');assert.equal(c.offlineMode,true);assert.equal(store.read('pending').request.mutationId,mutation);assert.equal(store.read('pending').request.attempted,true);assert.equal(state.globalTaskData,'保存中の編集');
  state.globalTaskData='さらに編集';await c.save(state);assert.equal(store.read('pending').request.mutationId,mutation);assert.equal(store.read('pending').nextPayload.state.globalTaskData,'さらに編集');
 }finally{clearInterval(c.interval);globalThis.fetch=original}
});
test('resuming against a newer cloud revision preserves offline edits as a conflict',async()=>{
 data.clear();const {syncStore}=await import('../taskkanri-device-storage.mjs');const {toPayload}=await import('../taskkanri-sync-model.mjs');const {SyncEngine}=await import('../taskkanri-sync-engine.mjs');
 const store=syncStore(localStorage,'account-b','tab-b');store.write('cache',{revision:3,payload:toPayload(defaultState())});localStorage.setItem('TASKKANRI_LAST_ACCOUNT',JSON.stringify({id:'account-b'}));
 let state=defaultState();const c=new SyncController({mode:'mobile',getState:()=>state,onData:s=>state=s});clearInterval(c.interval);c.id='tab-b';await c.enterOffline();state.globalTaskData='オフラインの変更';await c.save(state);
 let writes=0;const resumed=new SyncEngine({store,transport:{get:async()=>({revision:4,payload:toPayload(defaultState())}),save:async()=>{writes++;}}});await resumed.load();assert.equal(resumed.status,'conflict');assert.equal(resumed.pending.request.payload.state.globalTaskData,'オフラインの変更');await resumed.flush();assert.equal(writes,0);
});
test('manual offline aborts in-flight network requests and prevents new requests and timers',async()=>{
 data.clear();const original=globalThis.fetch;let sent=0;
 globalThis.fetch=async(_url,{signal})=>{sent++;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})})};
 const c=new SyncController({getState:defaultState});
 try{const pending=c.fetchOnline('https://example.test').catch(e=>e.name);await c.enterOffline();assert.equal(await pending,'AbortError');await assert.rejects(c.fetchOnline('https://example.test'),/オフライン/);c.schedule();assert.equal(sent,1);assert.equal(c.interval,null);assert.equal(c.sendTimer,undefined)}finally{clearInterval(c.interval);globalThis.fetch=original}
});
test('cancelled initial mobile save restores its pending payload even without cache',async()=>{
 data.clear();const {syncStore}=await import('../taskkanri-device-storage.mjs');const {SyncEngine}=await import('../taskkanri-sync-engine.mjs');
 const original=globalThis.fetch;globalThis.fetch=async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
 const store=syncStore(localStorage,'initial-account','initial-tab');let state=defaultState();state.globalTaskData='初回の取り込み';state.configEvents={'2026-10-20':'保持する行事'};
 const c=new SyncController({mode:'mobile',getState:()=>state,onAccount:()=>state=defaultState(),onData:s=>state=s});c.id='initial-tab';c.user={id:'initial-account'};
 try{c.engine=new SyncEngine({store,transport:{save:()=>c.fetchOnline('https://example.test')}});c.engine.queue(state,{initial:true});const saving=c.flush();const mutation=store.read('pending').request.mutationId;await c.enterOffline();await saving;assert.equal(state.globalTaskData,'初回の取り込み');assert.equal(state.configEvents['2026-10-20'],'保持する行事');state.globalTaskData='続けて編集';await c.save(state);assert.equal(store.read('pending').request.mutationId,mutation);assert.equal(store.read('pending').request.expectedRevision,0);assert.equal(store.read('pending').nextPayload.state.configEvents['2026-10-20'],'保持する行事')}finally{clearInterval(c.interval);globalThis.fetch=original}
});

test('saved offline preference is announced before waiting for the tab lock',async()=>{
 data.clear();localStorage.setItem('TASKKANRI_OFFLINE_MODE','true');
 const oldSession=globalThis.sessionStorage;const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.sessionStorage={getItem:()=> 'startup-tab',setItem(){}};
 let grant;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name,_options,callback)=>{grant=callback;return new Promise(()=>{})}}}});
 const labels=[];const c=new SyncController({mode:'desktop',getState:defaultState,onStatus:label=>labels.push(label)});
 try{const started=c.start();assert.equal(labels[0],'オフラインモード');grant({});await started;assert.equal(c.offlineMode,true);assert.equal(c.client,null);}
 finally{clearInterval(c.interval);globalThis.sessionStorage=oldSession;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});
