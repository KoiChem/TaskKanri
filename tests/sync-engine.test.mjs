import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../taskkanri-sync-engine.mjs';
import { toPayload } from '../taskkanri-sync-model.mjs';
import { defaultState } from '../taskkanri-core.mjs';
const memory=()=>{let data={};return {read:k=>structuredClone(data[k]??null),write:(k,v)=>{data[k]=structuredClone(v)},remove:k=>delete data[k]};};
const fixture=()=>{const state=defaultState();let document={revision:1,payload:toPayload(state),updated_at:new Date().toISOString()};const transport={get:async meta=>meta?{revision:document.revision,updated_at:document.updated_at}:structuredClone(document),save:async req=>{if(req.expectedRevision!==document.revision)return {status:'conflict',currentRevision:document.revision};document={...document,revision:document.revision+1,payload:req.payload};return {status:'saved',appliedRevision:document.revision,updatedAt:document.updated_at};}};return {state,transport,get document(){return document},set document(v){document=v}};};
test('stale client preserves draft and refuses silent overwrite',async()=>{
 const f=fixture();const a=new SyncEngine({transport:f.transport,store:memory()});const b=new SyncEngine({transport:f.transport,store:memory()});await a.load();await b.load();
 const s=defaultState();s.globalTaskData='A';a.queue(s);await a.flush();s.globalTaskData='B';b.queue(s);
 assert.equal((await b.flush()).status,'conflict');assert.equal(b.pending.request.payload.state.globalTaskData,'B');assert.equal(f.document.payload.state.globalTaskData,'A');
});
test('edits made while a save is in flight survive its response',async()=>{
 const f=fixture();let release;const original=f.transport.save;f.transport.save=req=>new Promise(resolve=>{release=()=>original(req).then(resolve)});
 const a=new SyncEngine({transport:f.transport,store:memory()});await a.load();const s=defaultState();s.globalTaskData='first';a.queue(s);const saving=a.flush();await Promise.resolve();s.globalTaskData='second';a.queue(s);release();await saving;
 assert.equal(a.pending.request.payload.state.globalTaskData,'second');assert.equal(a.pending.request.expectedRevision,2);
});
test('response loss retries the original mutation even after reload',async()=>{
 const f=fixture();const store=memory();f.transport.save=async()=>{throw new Error('offline')};const a=new SyncEngine({transport:f.transport,store});await a.load();a.queue(defaultState());const id=a.pending.request.mutationId;await a.flush();
 const b=new SyncEngine({transport:f.transport,store});await b.load();assert.equal(b.pending.request.mutationId,id);assert.equal(b.pending.request.expectedRevision,1);
});
test('late response after logout cannot resurrect another account data',async()=>{
 const f=fixture();let release;const original=f.transport.get;f.transport.get=()=>new Promise(resolve=>{release=()=>original().then(resolve)});
 const a=new SyncEngine({transport:f.transport,store:memory()});const loading=a.load();a.stop();release();await loading;assert.equal(a.payload,null);
});
test('local storage failure prevents cloud write',async()=>{
 const f=fixture();const a=new SyncEngine({transport:f.transport,store:{...memory(),write:()=>{throw new Error('quota')}}});
 await assert.rejects(a.load());assert.throws(()=>a.queue(defaultState()));assert.equal(f.document.revision,1);
});
test('UI/local commit failure after cloud save freezes writes without advancing revision or losing draft',async()=>{
 const f=fixture();let fail=false;const a=new SyncEngine({transport:f.transport,store:memory(),onData:()=>{if(fail)throw new Error('local commit failed')}});await a.load();
 const s=defaultState();s.globalTaskData='edited';a.queue(s);fail=true;await a.flush();
 assert.equal(a.status,'blocked');assert.equal(a.revision,1);assert.equal(a.pending.request.payload.state.globalTaskData,'edited');
 assert.throws(()=>a.queue(defaultState()));
});
test('reload with pending draft displays the draft instead of replacing it with older cache',async()=>{
 const f=fixture(),store=memory();const a=new SyncEngine({transport:f.transport,store});await a.load();const s=defaultState();s.globalTaskData='unsent';a.queue(s);let shown;
 const b=new SyncEngine({transport:f.transport,store,onData:doc=>shown=doc.payload.state.globalTaskData});await b.load();assert.equal(shown,'unsent');
});
test('unknown incoming contract is quarantined and blocks editing',async()=>{
 const f=fixture(),store=memory();const a=new SyncEngine({transport:f.transport,store});await a.load();f.document={...f.document,revision:2,payload:{contractVersion:999}};
 await assert.rejects(a.refresh());assert.equal(a.status,'blocked');assert.equal(a.revision,1);assert.deepEqual(store.read('quarantine').document.payload,{contractVersion:999});assert.throws(()=>a.queue(defaultState()));
});
