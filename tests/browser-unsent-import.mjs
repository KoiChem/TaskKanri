async page=>{
 const base=await page.evaluate(()=>new URL('.',location.href).href),context=await page.context().browser().newContext(),p=await context.newPage();
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+'reset-closed.html');
  await p.evaluate(async()=>{
   const {defaultState}=await import('./taskkanri-core.mjs'),{toPayload}=await import('./taskkanri-sync-model.mjs'),{installDataTransfer}=await import('./taskkanri-transfer-ui.js');
   const pc=defaultState();pc.dateSchedules={'2026-11-11':{'１限':'PCで追加','２限':'変更前'}};
   const exportFile={app:'TaskKanri',pending:{request:{payload:toPayload(pc),expectedRevision:153,mutationId:crypto.randomUUID(),attempted:true}}};
   const phone=defaultState();phone.isLandscapeMode=false;phone.dateSchedules={'2026-11-11':{'１限':'変更前','２限':'スマホで変更'},'2026-11-12':{'１限':'スマホの追加'}};
   window.recoveredState=phone;
   const controller={user:{id:'recovery-test'},offlineMode:false,engine:{status:'synced',busy:false}};
   const transfer=installDataTransfer({controller,getState:()=>window.recoveredState,saveImportedState:async state=>window.recoveredState=state});
   await transfer.importFile(new File([JSON.stringify(exportFile)],'unsent.json.crdownload',{type:'application/octet-stream'}));
  });
  await p.getByRole('heading',{name:'取り込む変更を確認',exact:true}).waitFor();
  const boxes=p.locator('[data-import-id]');if(await boxes.count()!==2)throw Error('差分が不正');if(await boxes.evaluateAll(es=>es.some(e=>e.checked)))throw Error('未送信復旧は自動選択しない');
  await p.getByText(/書き出し時点の全体/).waitFor();await p.locator('[data-import-id]').first().check();await p.getByRole('button',{name:'選択した1件を取り込む',exact:true}).click();await p.getByRole('heading',{name:'取り込みが完了しました',exact:true}).waitFor();
  const result=await p.evaluate(()=>({pc:window.recoveredState.dateSchedules['2026-11-11']['１限'],phone:window.recoveredState.dateSchedules['2026-11-11']['２限'],extra:window.recoveredState.dateSchedules['2026-11-12']['１限'],landscape:window.recoveredState.isLandscapeMode}));
  if(result.pc!=='PCで追加'||result.phone!=='スマホで変更'||result.extra!=='スマホの追加'||result.landscape!==false||errors.length)throw Error(JSON.stringify({result,errors}));
  return {completeUnsentFileAccepted:true,uncheckedRecovery:true,phoneChangesPreserved:true,localPreferencesPreserved:true,errors};
 }finally{await context.close()}
}
