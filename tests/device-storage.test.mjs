import {test} from 'node:test';import assert from 'node:assert/strict';
import {acquireClientId,scopedStorage} from '../taskkanri-device-storage.mjs';
const storage=()=>{const data=new Map();return {get length(){return data.size},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}};
test('cloned session tab claims a fresh queue identity and a normal reload keeps its original identity',async()=>{
 const locksHeld=new Set();const releases=[];const locks={request:async(id,options,fn)=>{if(locksHeld.has(id))return fn(null);locksHeld.add(id);try{return await fn({name:id})}finally{locksHeld.delete(id)}}};
 const a=storage();a.setItem('TASKKANRI_CLIENT_ID','existing');const first=await acquireClientId(a,locks,fn=>releases.push(fn));
 const b=storage();b.setItem('TASKKANRI_CLIENT_ID','existing');const second=await acquireClientId(b,locks,fn=>releases.push(fn));assert.notEqual(first,second);
 releases[0]();await Promise.resolve();await Promise.resolve();const reloaded=await acquireClientId(a,locks,fn=>releases.push(fn));assert.equal(reloaded,first);releases.forEach(fn=>fn());
});
test('scoped reset cannot affect other users or legacy storage',()=>{const s=storage();s.setItem('legacy','keep');scopedStorage(s,'a').setItem('master','A');scopedStorage(s,'b').setItem('master','B');scopedStorage(s,'a').removeItem('master');assert.equal(scopedStorage(s,'b').getItem('master'),'B');assert.equal(s.getItem('legacy'),'keep')});
