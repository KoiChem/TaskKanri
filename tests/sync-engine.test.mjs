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
test('save completion notifies editors after clearing the busy flag',async()=>{
 const f=fixture();let observed;
 const engine=new SyncEngine({transport:f.transport,store:memory(),onChange:e=>{observed={status:e.status,busy:e.busy,pending:!!e.pending}}});
 await engine.load();const next=defaultState();next.globalTaskData='変更';engine.queue(next);await engine.flush();
 assert.deepEqual(observed,{status:'synced',busy:false,pending:false});
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

test('sync success time is actual completion time, never cloud modification time or cache display',async()=>{
 const f=fixture(),store=memory();f.document={...f.document,updated_at:'2000-01-01T00:00:00Z'};
 store.write('cache',f.document);const e=new SyncEngine({transport:f.transport,store});e.loadCached();assert.equal(e.lastSuccessfulSyncAt,undefined);
 const before=Date.now();await e.load();assert.ok(Date.parse(e.lastSuccessfulSyncAt)>=before);assert.equal(e.updatedAt,'2000-01-01T00:00:00Z');
 const completed=e.lastSuccessfulSyncAt;f.transport.get=async()=>{throw new Error('offline')};await assert.rejects(e.refresh());assert.equal(e.lastSuccessfulSyncAt,completed);
});

test('network waits for durable pending and attempted marker commits',async()=>{
 const f=fixture(),store=memory();let release,wait=false,sends=0;store.flush=()=>wait?new Promise(resolve=>release=resolve):Promise.resolve();const save=f.transport.save;f.transport.save=req=>{sends++;return save(req)};const engine=new SyncEngine({store,transport:f.transport});await engine.load();const next=defaultState();next.globalTaskData='durable';engine.queue(next);wait=true;const saving=engine.flush();await Promise.resolve();assert.equal(sends,0);release();await Promise.resolve();await Promise.resolve();assert.equal(sends,0);wait=false;release();await saving;assert.equal(sends,1);assert.equal(engine.status,'synced');
});
test('failed durable queue prevents network submission and preserves pending body',async()=>{
 const f=fixture(),store=memory();let sends=0;const engine=new SyncEngine({store,transport:{...f.transport,save:async()=>{sends++;throw Error('must not send')}}});await engine.load();const next=defaultState();next.globalTaskData='keep';engine.queue(next);store.flush=async()=>{const error=Error('IDB failed');error.blocked=true;throw error};const result=await engine.flush();assert.equal(sends,0);assert.equal(result.status,'error');assert.equal(engine.pending.request.payload.state.globalTaskData,'keep');assert.equal(engine.status,'blocked');
});
test('edit during durable save acknowledgement remains queued at the new revision',async()=>{
 const f=fixture(),store=memory(),engine=new SyncEngine({store,transport:f.transport});await engine.load();let count=0,release;store.flush=()=>++count===3?new Promise(resolve=>release=resolve):Promise.resolve();const first=defaultState();first.globalTaskData='first';engine.queue(first);const saving=engine.flush();while(!release)await Promise.resolve();const second=defaultState();second.globalTaskData='second';engine.queue(second);release();await saving;assert.ok(engine.pending);assert.equal(engine.pending.request.expectedRevision,2);assert.equal((engine.pending.nextPayload||engine.pending.request.payload).state.globalTaskData,'second');assert.equal(engine.status,'pending');
});

test('refresh waits for incoming data to be durably committed before completing',async()=>{
 const f=fixture(),store=memory(),engine=new SyncEngine({transport:f.transport,store});await engine.load();
 f.document={...f.document,revision:2};let release,finished=false;store.flush=()=>new Promise(resolve=>release=resolve);
 const loading=engine.refresh().then(()=>finished=true);await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(finished,false);assert.equal(engine.status,'storing');}finally{release?.()}
 await loading;assert.equal(engine.status,'synced');
});
