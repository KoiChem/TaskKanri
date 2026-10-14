import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
// Literal contracts keep SQL validation independent of frontend migration code.
const oldPayload=()=>({contractVersion:1,appSchemaVersion:7,state:{currentYear:2026,weeklyTemplate:{mon:{1:'unapplied master'}},weeklyRules:{rule:{html:'<b>raw old</b>'}},dateOverrides:{'260401':{1:{type:'cancel'}}},configEvents:{},calendarHolidays:{},customHolidays:{},dayProfiles:{},timeConfig:{},globalTaskData:'',countSettings:[],daySlotConfig:{},instructionDayConfig:{}}});
const newPayload=()=>({contractVersion:2,appSchemaVersion:8,state:{currentYear:2026,dateSchedules:{'260401':{1:'<b>converted</b>'}},configEvents:{},calendarHolidays:{},customHolidays:{},dayProfiles:{},timeConfig:{},globalTaskData:'',countSettings:[],daySlotConfig:{},instructionDayConfig:{}}});
test('real Postgres: additive schema migration, exact contracts, downgrade protection, backup, RLS, CAS and idempotence',async()=>{
 const db=new PGlite();
 try {
 await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;");
 await db.exec(await readFile(new URL('../supabase/migrations/202610120001_taskkanri_sync.sql',import.meta.url),'utf8'));
 const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 await db.query('insert into auth.users values ($1),($2)',[uid,other]);await db.query('insert into public.taskkanri_allowed_users values($1)',[uid]);
 const login=()=>db.exec(`set role authenticated; set request.jwt.claim.sub='${uid}'`);
 await login();
 const save=(r,n,p)=>db.query('select public.save_taskkanri_document($1,$2,$3::jsonb) as result',[r,id(n),JSON.stringify(p)]).then(r=>r.rows[0].result);
 const original=oldPayload();
 assert.equal((await save(0,10,original)).status,'saved');
 await db.exec('reset role');
 const aclBefore=(await db.query("select proacl::text from pg_proc where oid='public.save_taskkanri_document(bigint,uuid,jsonb)'::regprocedure")).rows[0].proacl;
 await db.exec(await readFile(new URL('../supabase/migrations/202610140001_day_schedules.sql',import.meta.url),'utf8'));
 assert.equal((await db.query("select proacl::text from pg_proc where oid='public.save_taskkanri_document(bigint,uuid,jsonb)'::regprocedure")).rows[0].proacl,aclBefore);
 await db.exec(await readFile(new URL('../supabase/migrations/202610140001_day_schedules.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query("select relrowsecurity from pg_class where oid in ('public.taskkanri_documents'::regclass,'public.taskkanri_allowed_users'::regclass,'public.taskkanri_mutations'::regclass)")).rows.map(r=>r.relrowsecurity),[true,true,true]);
 await login();
 assert.deepEqual((await db.query('select payload,revision,legacy_payload from public.taskkanri_documents')).rows[0],{payload:original,revision:1,legacy_payload:null});
 assert.equal((await save(0,10,original)).status,'duplicate');
 let old=oldPayload();old.state.globalTaskData='latest legacy';
 assert.equal((await save(1,11,old)).appliedRevision,2);
 const fresh=newPayload();
 assert.equal((await save(1,12,fresh)).status,'conflict');
 assert.equal((await save(2,12,fresh)).appliedRevision,3);
 assert.equal((await save(2,12,fresh)).status,'duplicate');
 await assert.rejects(save(3,13,old),/app_update_required/);
 // Even a previously applied legacy mutation cannot authorize an old write.
 await assert.rejects(save(0,10,original),/app_update_required/);
 let row=(await db.query('select payload,revision,legacy_payload from public.taskkanri_documents')).rows[0];
 assert.deepEqual(row,{payload:fresh,revision:3,legacy_payload:old});
 const updated=newPayload();updated.state.globalTaskData='later';
 assert.equal((await save(3,14,updated)).appliedRevision,4);
 assert.deepEqual((await db.query('select legacy_payload from public.taskkanri_documents')).rows[0].legacy_payload,old);
 await assert.rejects(save(4,14,fresh),/mutation_id_reused/);
 const bads=[];
 for(const base of [oldPayload(),newPayload()]) {
  const missing=structuredClone(base);delete missing.state.configEvents;bads.push(missing);
  const substituted=structuredClone(base);delete substituted.state.configEvents;substituted.state.unknown={};bads.push(substituted);
  const extra=structuredClone(base);extra.state.unknown={};bads.push(extra);
  const top=structuredClone(base);top.extra=true;bads.push(top);
  for(const [key,value] of [['currentYear','2026'],['globalTaskData',{}],['countSettings',{}],['timeConfig',[]]]) {const p=structuredClone(base);p.state[key]=value;bads.push(p);}
 }
 for (const base of [oldPayload(),newPayload()]) {
  for (const key of ['contractVersion','appSchemaVersion']) {
   for (const value of [null,0,'8',{},[]]) {const p=structuredClone(base);p[key]=value;bads.push(p);}
   const absent=structuredClone(base);delete absent[key];bads.push(absent);
  }
 }
 bads.push({...newPayload(),contractVersion:1},{...oldPayload(),appSchemaVersion:8},[],null);
 for(let i=0;i<bads.length;i++) await assert.rejects(save(4,100+i,bads[i]),/invalid_/);
 assert.deepEqual((await db.query('select payload,revision,legacy_payload from public.taskkanri_documents')).rows[0],{payload:updated,revision:4,legacy_payload:old});
 await assert.rejects(db.query('update public.taskkanri_documents set revision=999'));
 await assert.rejects(db.query("update public.taskkanri_documents set legacy_payload='{}'"));
 await db.exec("set request.jwt.claim.sub=''");await assert.rejects(save(0,30,fresh),/authentication_required/);
 await db.exec(`set request.jwt.claim.sub='${other}'`);
 assert.equal((await db.query('select * from public.taskkanri_documents')).rows.length,0);await assert.rejects(save(0,31,fresh),/user_not_allowed/);
 await db.exec('reset role');await db.query('insert into public.taskkanri_allowed_users values($1)',[other]);
 await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}'`);
 assert.equal((await save(0,32,fresh)).appliedRevision,1);
 assert.equal((await db.query('select legacy_payload from public.taskkanri_documents')).rows[0].legacy_payload,null);
 await db.exec('set role anon');await assert.rejects(db.query('select * from public.taskkanri_documents'));await assert.rejects(save(0,33,fresh));
 } finally {await db.close();}
});
