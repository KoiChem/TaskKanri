import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncController} from '../taskkanri-sync.js';
import {SyncEngine} from '../taskkanri-sync-engine.mjs';
import {defaultState} from '../taskkanri-core.mjs';
import {toPayload} from '../taskkanri-sync-model.mjs';
import {syncStore} from '../taskkanri-device-storage.mjs';
const values=new Map();
globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
globalThis.document={addEventListener(){},visibilityState:'hidden'};
globalThis.window={addEventListener(){}};
const session={user:{id:'startup-user',email:'startup@example.test'},expires_at:Date.now()/1000+3600};
function fixture(){values.clear();let state=defaultState();state.globalTaskData='端末の内容';const store=syncStore(localStorage,session.user.id,'tab');store.write('cache',{revision:1,payload:toPayload(state)});const c=new SyncController({mode:'desktop',getState:()=>state,onData:s=>state=s});c.id='tab';return {c,store,get state(){return state}};}
test('local account restoration requires no client and retains edits made before authentication',async()=>{
 const f=fixture();f.c.restoreAccount(session.user);assert.equal(f.c.user.id,session.user.id);assert.equal(f.c.engine.status,'cached');assert.equal(f.state.globalTaskData,'端末の内容');f.state.globalTaskData='認証前の編集';f.c.dirty(f.state);assert.equal(f.store.read('pending').request.payload.state.globalTaskData,'認証前の編集');assert.equal(f.c.client,null);
});
test('startup authorization and retrieval start concurrently while local data is usable',async()=>{
 const f=fixture();let allow,read;const calls=[];f.c.client={rpc:()=>{calls.push('permission');return new Promise(r=>allow=r)},from:()=>({select:()=>({eq:()=>({maybeSingle:()=>{calls.push('read');return new Promise(r=>read=r)}})})})};f.c.allowStartupRead=true;
 const starting=f.c.activate(session);await Promise.resolve();assert.deepEqual(calls.sort(),['permission','read']);assert.equal(f.c.engine.payload.state.globalTaskData,'端末の内容');allow({data:true});read({data:{revision:2,payload:toPayload(defaultState())}});await starting;assert.equal(f.c.engine.status,'synced');
});
test('automatic unsigned offline ignores last account and does not persist offline preference',async()=>{
 const f=fixture();localStorage.setItem('TASKKANRI_LAST_ACCOUNT',JSON.stringify(session.user));await f.c.enterOffline({automatic:true,account:null});assert.equal(f.c.user.id,'offline-local');assert.equal(f.c.automaticOffline,true);assert.equal(localStorage.getItem('TASKKANRI_OFFLINE_MODE'),null);
});
test('startup load defers remote changes during typing and applies without a second request',async()=>{
 const f=fixture();let editing=true,reads=0;const remote=defaultState();remote.globalTaskData='受信内容';const e=new SyncEngine({store:f.store,canApply:()=>!editing,transport:{get:async()=>{reads++;return {revision:2,payload:toPayload(remote)}}},onData:()=>{}});await e.load({deferApply:true});assert.equal(e.status,'deferred');assert.equal(e.revision,1);editing=false;await e.applyDeferred();assert.equal(e.status,'synced');assert.equal(e.payload.state.globalTaskData,'受信内容');assert.equal(reads,1);
});
test('saved edit after deferred startup receive prevents stale replacement',async()=>{
 const f=fixture();const e=new SyncEngine({store:f.store,canApply:()=>false,transport:{get:async()=>({revision:2,payload:toPayload(defaultState())})}});await e.load({deferApply:true});f.state.globalTaskData='保存された入力';e.queue(f.state);await e.applyDeferred();assert.equal(e.pending.request.payload.state.globalTaskData,'保存された入力');assert.equal(e.revision,1);
});
test('failed automatic-offline login restores no-network mode and keeps local edits',async()=>{
 const f=fixture();await f.c.enterOffline({automatic:true,account:null});f.state.globalTaskData='ログイン前の変更';f.c.dirty(f.state);let stopped=false;f.c.client={auth:{signInWithPassword:async()=>({error:{message:'invalid credentials'}}),stopAutoRefresh:()=>stopped=true}};await assert.rejects(f.c.login('a','bad'),/invalid credentials/);assert.equal(f.c.offlineMode,true);assert.equal(f.c.automaticOffline,true);assert.equal(f.state.globalTaskData,'ログイン前の変更');assert.equal(stopped,true);
});
test('late startup completion cannot replace explicit offline choice',async()=>{
 const f=fixture();let allow,read;f.c.client={rpc:()=>new Promise(r=>allow=r),from:()=>({select:()=>({eq:()=>({maybeSingle:()=>new Promise(r=>read=r)})})}),auth:{stopAutoRefresh(){}}};f.c.allowStartupRead=true;const starting=f.c.activate(session);await Promise.resolve();await f.c.enterOffline();allow({data:true});read({data:{revision:2,payload:toPayload(defaultState())}});await starting;assert.equal(f.c.offlineMode,true);assert.equal(f.state.globalTaskData,'端末の内容');
});
test('sign-out saves focused edits before stopping the old account engine',async()=>{
 const f=fixture();f.c.restoreAccount(session.user);let active=f.c.engine;f.c.beforeAccountChange=()=>{assert.equal(active.active,true);f.state.globalTaskData='認証切れ直前の入力';f.c.dirty(f.state)};await f.c.activate(null);assert.equal(f.store.read('pending').request.payload.state.globalTaskData,'認証切れ直前の入力');assert.equal(f.c.user.id,'offline-local');
});
test('account change clears old forms after preservation and before selecting the new account',async()=>{
 const f=fixture();f.c.restoreAccount(session.user);const events=[];f.c.beforeAccountChange=()=>events.push('preserve');f.c.onAccount=user=>events.push(user?.id||'clear');f.c.client={rpc:async()=>({data:true})};await f.c.activate({...session,user:{id:'other-user'}});assert.deepEqual(events,['preserve','clear','other-user']);
});
test('unsaved settings can block account transition without discarding the old account',async()=>{
 const f=fixture();f.c.restoreAccount(session.user);const engine=f.c.engine;f.c.beforeAccountChange=()=>{throw Error('設定を保存してください')};await assert.rejects(f.c.activate(null),/設定を保存/);assert.equal(f.c.engine,engine);assert.equal(engine.active,true);assert.equal(f.c.user.id,session.user.id);
});
test('startup publishes its final status after connection checking finishes',async()=>{
 const f=fixture();const checks=[];f.c.onStatus=()=>checks.push(!!f.c.connecting);f.c.client={rpc:async()=>({data:true})};await f.c.activate(session);assert.equal(checks.at(-1),false);assert.equal(f.c.engine.status,'cached');
});
