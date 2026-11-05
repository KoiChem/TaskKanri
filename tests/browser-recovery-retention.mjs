async page => {
 const context=await page.context().browser().newContext();const p=await context.newPage();
 try{
  await p.goto('http://127.0.0.1:4173/');
  return await p.evaluate(async()=>{
   const m=await import('/taskkanri-recovery-archive.mjs');
   if(typeof m.saveBoundedRecovery!=='function')throw new Error('復旧コピーの保存と件数制限が未実装です');
   for(let i=0;i<5;i++)await m.saveBoundedRecovery({raw:JSON.stringify({version:i})},{namespace:'test'});
   const rows=await m.listBoundedRecovery({namespace:'test'});
   if(rows.length!==3||rows.map(r=>JSON.parse(r.raw).version).sort().join(',')!=='2,3,4')throw new Error('直近3件の保持に失敗');
   await m.saveBoundedRecovery({raw:JSON.stringify({version:4})},{namespace:'test'});
   if((await m.listBoundedRecovery({namespace:'test'})).length!==3)throw new Error('重複コピーが蓄積');
   await m.saveBoundedRecovery({raw:JSON.stringify({version:2})},{namespace:'test'});await m.saveBoundedRecovery({raw:JSON.stringify({version:5})},{namespace:'test'});
   const values=(await m.listBoundedRecovery({namespace:'test'})).map(r=>JSON.parse(r.raw).version).sort().join(',');if(values!=='2,4,5')throw Error('再利用した復旧データが古い履歴として削除された: '+values);
   return {retained:3,deduplicated:true,recency:true};
  });
 }finally{await context.close()}
}
