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

test('old cloud data is backed up before CAS migration and an old pending mutation keeps its identity',async()=>{
 const f=fixture(),store=memory();const state=defaultState();delete state.dateSchedules;state.weeklyTemplate={};state.weeklyRules={};state.dateOverrides={'2026-10-14':{slots:{'１限':{action:'replace',source:'user',content:'旧本文'}}}};
 const oldKeys=['currentYear','weeklyTemplate','weeklyRules','dateOverrides','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','globalTaskData','countSettings','daySlotConfig','instructionDayConfig'];
 const old={contractVersion:1,appSchemaVersion:7,state:Object.fromEntries(oldKeys.map(k=>[k,state[k]]))};f.document={...f.document,payload:old};
 const e=new SyncEngine({transport:f.transport,store});await e.load();assert.equal(e.pending.request.payload.contractVersion,2);assert.equal(e.pending.request.expectedRevision,1);assert.deepEqual(store.read('legacy-backup').payload,old);await e.flush();assert.equal(f.document.payload.state.dateSchedules['2026-10-14']['１限'],'旧本文');
 const pending={request:{payload:old,expectedRevision:2,mutationId:'keep-this-id',attempted:true}};store.write('pending',pending);const reloaded=new SyncEngine({transport:f.transport,store});assert.equal(reloaded.pending.request.mutationId,'keep-this-id');
});

test('a legacy in-flight next draft including unapplied master is archived before its conversion',async()=>{
 const f=fixture(),store=memory();const state=defaultState();delete state.dateSchedules;Object.assign(state,{weeklyTemplate:{},weeklyRules:{},dateOverrides:{}});
 const keys=['currentYear','weeklyTemplate','weeklyRules','dateOverrides','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','globalTaskData','countSettings','daySlotConfig','instructionDayConfig'];const old={contractVersion:1,appSchemaVersion:7,state:Object.fromEntries(keys.map(k=>[k,state[k]]))};
 const later=structuredClone(old);later.state.weeklyTemplate={1:{'１限':'未適用の新しい下書き'}};later.state.globalTaskData='最新メモ';const pending={request:{payload:old,expectedRevision:1,mutationId:'original-flight',attempted:true},nextPayload:later};
 f.document={...f.document,payload:old};store.write('cache',f.document);store.write('pending',pending);const e=new SyncEngine({transport:f.transport,store});await e.load();await e.flush();await e.flush();
 assert.deepEqual(store.read('legacy-pending-backup:original-flight'),pending);assert.equal(f.document.payload.state.globalTaskData,'最新メモ');
 const failing={...memory(),read:k=>k==='pending'?structuredClone(pending):null,write:()=>{throw new Error('quota')}};assert.throws(()=>new SyncEngine({transport:f.transport,store:failing}),/quota/);assert.deepEqual(failing.read('pending'),pending);
});
