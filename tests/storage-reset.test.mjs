import test from 'node:test';import assert from 'node:assert/strict';
import {resetTaskKanriStorage} from '../taskkanri-reset.mjs';
function storage(entries){const m=new Map(Object.entries(entries));return {m,get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}}
test('reset removes TaskKanri data for all users while preserving unrelated site storage',async()=>{
 const local=storage({'TASKKANRI_USER:a:TASK_KUN_MASTER_STORAGE':'a','TASKKANRI_USER:b:tab:x:pending':'pending','TASK_KUN_MASTER_STORAGE':'master','TASKKANRI_OFFLINE_MODE':'true','another-app':'keep'});const session=storage({'TASKKANRI_CLIENT_ID':'id','another-session':'keep'});let deleted=0;
 await resetTaskKanriStorage({local,session,deleteRecovery:async()=>{deleted++}});
 assert.deepEqual([...local.m.keys()],['another-app']);assert.deepEqual([...session.m.keys()],['another-session']);assert.equal(deleted,1);
});
test('a failed recovery deletion stops reset before local data is removed',async()=>{
 const local=storage({'TASKKANRI_USER:a:tab:x:pending':'unsent'});await assert.rejects(()=>resetTaskKanriStorage({local,session:storage({}),deleteRecovery:async()=>{throw Error('blocked')}}),/blocked/);assert.equal(local.getItem('TASKKANRI_USER:a:tab:x:pending'),'unsent');
});
test('storage breakdown counts current data, pending, cache, recovery, and quarantine independently',async()=>{
 const {storageBreakdown}=await import('../taskkanri-reset.mjs');const local=storage({'TASKKANRI_USER:a:TASK_KUN_MASTER_STORAGE':'master','TASKKANRI_USER:a:tab:one:pending':'unsent','TASKKANRI_USER:a:cache':'cache','TASKKANRI_USER:a:TASK_KUN_MASTER_STORAGE_RECOVERY_1':'backup','TASK_KUN_MASTER_STORAGE_QUARANTINE_bad':'broken','another-app':'not counted'});
 const result=storageBreakdown(local);for(const name of ['master','pending','cache','recovery','quarantine'])assert.ok(result[name]>0,name);assert.equal(result.other,0);
});
