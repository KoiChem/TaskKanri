import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncController} from '../taskkanri-sync.js';
import {defaultState} from '../taskkanri-core.mjs';
import {SyncEngine} from '../taskkanri-sync-engine.mjs';
import {toPayload} from '../taskkanri-sync-model.mjs';
const listeners={};
globalThis.document={visibilityState:'visible',addEventListener:(name,fn)=>listeners[name]=fn};
globalThis.window={addEventListener:(name,fn)=>listeners[name]=fn};
test('desktop edits and visibility/online return never start background sync',async()=>{
 let state=defaultState(),reads=0,writes=0;const values=new Map();const store={read:k=>values.get(k),write:(k,v)=>values.set(k,structuredClone(v)),remove:k=>values.delete(k)};
 const c=new SyncController({mode:'desktop',getState:()=>state});
 try{c.engine=new SyncEngine({store,transport:{get:async()=>{reads++;return {revision:1,payload:toPayload(defaultState())}},save:async()=>{writes++;throw new Error('offline')}}});await c.engine.load();reads=0;
 state.globalTaskData='未送信';c.dirty(state);listeners.visibilitychange();listeners.online();await Promise.resolve();
 assert.equal(c.sendTimer,undefined);assert.equal(c.interval,null);assert.equal(reads,0);assert.equal(writes,0);assert.equal(store.read('pending').request.payload.state.globalTaskData,'未送信');
 c.user={id:'test'};c.client={auth:{getSession:async()=>({data:{session:{expires_at:Date.now()/1000+3600,user:c.user}}})},rpc:async()=>({data:true})};
 await c.refresh({manual:true});assert.equal(writes,1);assert.equal(c.retryTimer,undefined);assert.ok(c.engine.pending);
 }finally{clearInterval(c.interval);clearTimeout(c.sendTimer);clearTimeout(c.retryTimer);clearTimeout(c.maxTimer)}
});
test('desktop startup read is allowed only once per tab on a normal navigation',async()=>{
 const {consumeDesktopStartup}=await import('../taskkanri-sync.js');const m=new Map();const storage={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};
 assert.equal(consumeDesktopStartup(storage,'reload'),false);m.clear();assert.equal(consumeDesktopStartup(storage,'back_forward'),false);m.clear();assert.equal(consumeDesktopStartup(storage,undefined),false);m.clear();assert.equal(consumeDesktopStartup(storage,'navigate'),true);assert.equal(consumeDesktopStartup(storage,'navigate'),false);
});
test('desktop reload restores cached pending without any remote read or write',async()=>{
 const {syncStore}=await import('../taskkanri-device-storage.mjs');const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const store=syncStore(localStorage,'account','tab');const initial=defaultState();store.write('cache',{revision:7,payload:toPayload(initial)});
 const state=defaultState();state.globalTaskData='保持する未送信';const pending=new SyncEngine({store,transport:{}});pending.loadCached();pending.queue(state);
 let reads=0,shown;const c=new SyncController({mode:'desktop',getState:()=>state,onData:s=>shown=s});c.id='tab';c.client={rpc:async()=>({data:true}),from:()=>{reads++;throw new Error('unexpected read')}};
 await c.activate({user:{id:'account'},expires_at:Date.now()/1000+3600});assert.equal(reads,0);assert.equal(c.engine.status,'pending');assert.equal(shown.globalTaskData,'保持する未送信');assert.equal(c.engine.revision,7);assert.equal(c.sendTimer,undefined);
});
test('mobile still schedules edits for automatic sending',async()=>{
 const state=defaultState();const values=new Map();const store={read:k=>values.get(k),write:(k,v)=>values.set(k,structuredClone(v)),remove:k=>values.delete(k)};const c=new SyncController({mode:'mobile',getState:()=>state});
 try{c.engine=new SyncEngine({store,transport:{get:async()=>({revision:1,payload:toPayload(defaultState())})}});await c.engine.load();state.globalTaskData='mobile';c.dirty(state);assert.ok(c.sendTimer);assert.ok(c.interval);}finally{clearInterval(c.interval);clearTimeout(c.sendTimer);clearTimeout(c.maxTimer)}
});
test('an initial unsent document without cache still queues further desktop edits',()=>{
 const state=defaultState();const values=new Map();const store={read:k=>values.get(k),write:(k,v)=>values.set(k,structuredClone(v)),remove:k=>values.delete(k)};
 const c=new SyncController({mode:'desktop',getState:()=>state});c.engine=new SyncEngine({store,transport:{}});c.engine.queue(state,{initial:true});state.globalTaskData='初回未送信の追加入力';c.dirty(state);assert.equal(store.read('pending').request.payload.state.globalTaskData,'初回未送信の追加入力');assert.equal(store.read('pending').request.expectedRevision,0);
});
