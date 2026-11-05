async page=>{
 const context=await page.context().browser().newContext({acceptDownloads:true}),a=await context.newPage(),b=await context.newPage();const errors=[],dialogs=[],downloads=[];
 for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 a.on('dialog',async d=>{dialogs.push(d.message());await d.accept()});a.on('download',d=>downloads.push(d.suggestedFilename()));
 await context.addInitScript(()=>{if(!localStorage.getItem('TEST_INIT')){localStorage.setItem('TEST_INIT','yes');localStorage.setItem('TASKKANRI_OFFLINE_MODE','true')}});
 await context.route('https://**/*',r=>r.abort());
 try{
  await a.goto('http://127.0.0.1:4173/');await a.locator('[data-common-editor]').fill('端末の最新データ');await a.locator('[data-common-editor]').blur();
  await b.goto('http://127.0.0.1:4173/');await b.locator('[data-common-editor]').waitFor();await b.waitForTimeout(500);
  await a.evaluate(async()=>{localStorage.setItem('another-app','keep');localStorage.setItem('TASKKANRI_USER:other:tab:old:pending','unsent');const core=await import('/taskkanri-core.mjs'),arc=await import('/taskkanri-recovery-archive.mjs');await arc.saveBoundedRecovery({raw:JSON.stringify(core.serializePayload(core.defaultState()).value)},{namespace:'other'});openResetModal()});
  const modal=a.locator('#reset-confirm-modal');const download=a.waitForEvent('download');await modal.getByRole('button',{name:'バックアップを保存'}).click();await download;if(!await modal.isVisible())throw Error('バックアップで確認画面が閉じた');
  const reload=a.waitForEvent('load');await modal.getByRole('button',{name:'この端末のデータを削除',exact:true}).click();await b.waitForURL('**/reset-closed.html');await reload;if(await b.evaluate(()=>sessionStorage.getItem('TASKKANRI_CLIENT_ID')))throw Error('別タブのセッション情報が残りました');await a.locator('#sync-landing').waitFor({state:'visible'});
  const after=await a.evaluate(async()=>({keys:Object.keys(localStorage),other:localStorage.getItem('another-app'),rows:(await (await import('/taskkanri-recovery-archive.mjs')).listBoundedRecovery({namespace:'other'})).length,landing:!document.getElementById('sync-landing').hidden}));
  if(downloads.length!==1||!dialogs.some(x=>x.includes('初期化が完了')))throw Error('削除またはバックアップの動作が不正 '+JSON.stringify({downloads,dialogs}));
  if(after.other!=='keep'||after.rows!==0||after.keys.some(k=>k.includes(':other:'))||!after.landing)throw Error('削除後の状態が不正 '+JSON.stringify(after));
  if(errors.length)throw Error(errors.join(','));return {otherTabStopped:true,backupOnce:true,unrelatedPreserved:true,recoveryRemoved:true,landing:true,errors};
 }finally{await context.close()}
}
