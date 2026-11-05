async page=>{const c=await page.context().browser().newContext(),a=await c.newPage(),b=await c.newPage();try{
 await a.goto('http://127.0.0.1:4173/reset-closed.html');await b.goto('http://127.0.0.1:4173/reset-closed.html');
 await b.evaluate(async()=>{const m=await import('/taskkanri-storage-gate.mjs');window.testGate=await m.acquireStorageGate()});
 const blocked=await a.evaluate(()=>navigator.locks.request('TASKKANRI_STORAGE_GATE',{ifAvailable:true},lock=>!lock));
 await b.evaluate(()=>window.testGate.release());
 const released=await a.evaluate(()=>navigator.locks.request('TASKKANRI_STORAGE_GATE',{ifAvailable:true},lock=>!!lock));
 if(!blocked||!released)throw Error('他タブの使用中は初期化を止め、終了後に許可する必要があります');return {blocked,released};
}finally{await c.close()}}
