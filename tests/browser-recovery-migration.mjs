async page => {
 const c=await page.context().browser().newContext();const p=await c.newPage();try{await p.goto('http://127.0.0.1:4173/');return await p.evaluate(async()=>{
 const core=await import('/taskkanri-core.mjs'),m=await import('/taskkanri-recovery-archive.mjs');
 if(typeof m.migrateRecoveryCopies!=='function')throw new Error('旧復旧コピーの移行が未実装');
 const prefix='TASKKANRI_USER:migrate:'+core.APP_CONFIG.recoveryPrefix;
 for(let i=0;i<3;i++)await m.saveBoundedRecovery({raw:JSON.stringify({version:i})},{namespace:'migrate'});
 const state=core.defaultState(),payload=core.serializePayload(state).value,raw=JSON.stringify(payload);
 localStorage.setItem(prefix+'001',JSON.stringify({raw,state,createdAt:'2020-01-01T00:00:00.000Z'}));localStorage.setItem(prefix+'002','broken');const other=core.defaultState();other.globalTaskData='distinct unsent';localStorage.setItem(prefix+'003',JSON.stringify({raw,state:other,createdAt:'2020-01-01T00:00:00.000Z'}));localStorage.setItem('TASKKANRI_USER:migrate:tab:123:pending','unsent');
 await m.migrateRecoveryCopies({namespace:'migrate'});
 if(localStorage.getItem(prefix+'001')!==null)throw new Error('移行済みコピーが残存');
 if(localStorage.getItem(prefix+'002')!=='broken'||!localStorage.getItem(prefix+'003')||localStorage.getItem('TASKKANRI_USER:migrate:tab:123:pending')!=='unsent')throw new Error('保護対象を削除');
 const rows=await m.listBoundedRecovery({namespace:'migrate'});if(rows.length!==3||rows.some(row=>row.raw===raw))throw new Error('古いローカル復旧データが新しい復旧データを消しました');return {migrated:true,invalidPreserved:true,pendingPreserved:true};
 });}finally{await c.close()}
}
