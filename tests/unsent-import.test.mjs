import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,serializePayload} from '../taskkanri-core.mjs';
import {toPayload} from '../taskkanri-sync-model.mjs';
import {prepareImportPayload,planImport,applyImport} from '../taskkanri-import.mjs';
const unsent=state=>({app:'TaskKanri',pending:{request:{payload:toPayload(state),expectedRevision:153,mutationId:'00000000-0000-4000-8000-000000000001',attempted:true}}});
test('current unsent export is importable without inventing local-only preferences',()=>{
 const pc=defaultState();pc.dateSchedules={'2026-11-11':{'１限':'PCの変更','２限':'変更前'}};
 const phone=defaultState();phone.dateSchedules={'2026-11-11':{'１限':'変更前','２限':'スマホの変更'},'2026-11-12':{'１限':'スマホの追加'}};phone.isLandscapeMode=false;phone.timetableWords=['端末設定'];
 const prepared=prepareImportPayload(JSON.stringify(unsent(pc)));assert.equal(prepared.recovery,true);assert.equal(Object.hasOwn(prepared.parsed.data,'isLandscapeMode'),false);
 const plan=planImport(phone,unsent(pc));assert.equal(plan.recovery,true);assert.equal(plan.rows.some(r=>r.path[0]==='isLandscapeMode'),false);const row=plan.rows.find(r=>r.path.at(-1)==='１限');
 const next=applyImport(phone,plan,[row.id]);assert.equal(next.dateSchedules['2026-11-11']['１限'],'PCの変更');assert.equal(next.dateSchedules['2026-11-11']['２限'],'スマホの変更');assert.equal(next.dateSchedules['2026-11-12']['１限'],'スマホの追加');assert.equal(next.isLandscapeMode,false);assert.deepEqual(next.timetableWords,['端末設定']);
});
test('unsent recovery uses latest nextPayload but validates immutable request too',()=>{
 const initial=defaultState();initial.globalTaskData='送信中';const latest=defaultState();latest.globalTaskData='最後の編集';const file=unsent(initial);file.pending.nextPayload=toPayload(latest);
 assert.equal(planImport(defaultState(),file).rows.find(r=>r.path[0]==='globalTaskData').after,'最後の編集');
 file.pending.request.payload.contractVersion=1;assert.throws(()=>prepareImportPayload(file),/形式|現行/);
});
test('malformed or unrelated unsent shapes are rejected; standard current import stays normal',()=>{
 const file=unsent(defaultState());for(const changed of [{...file,app:'Other'}, {...file,pending:null},{...file,pending:{request:{...file.pending.request,expectedRevision:-1}}},{...file,pending:{request:{...file.pending.request,attempted:'yes'}}},{...file,pending:{...file.pending,nextPayload:null}}])assert.throws(()=>prepareImportPayload(changed));
 assert.throws(()=>prepareImportPayload('{'),/JSON/);assert.equal(prepareImportPayload(serializePayload(defaultState()).value).recovery,false);
});
