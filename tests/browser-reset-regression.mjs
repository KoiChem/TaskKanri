async page => {
 const context=await page.context().browser().newContext();const p=await context.newPage();const errors=[],downloads=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('download',d=>downloads.push(d.suggestedFilename()));const dialogs=[];p.on('dialog',async d=>{dialogs.push(d.message());await d.accept()});
 await context.addInitScript(()=>localStorage.setItem('TASKKANRI_OFFLINE_MODE','true'));
 await context.route('https://**/*',r=>r.abort());
 try{
  await p.goto('http://127.0.0.1:4173/');await p.locator('#sync-landing').waitFor({state:'hidden'});
  await p.locator('[data-common-editor]').fill('初期化前のデータ');await p.locator('[data-common-editor]').blur();
  await p.evaluate(()=>openResetModal());
  const modal=p.locator('#reset-confirm-modal');
  if(!await modal.getByRole('button',{name:'バックアップを保存'}).count())throw new Error('初期化画面に独立したバックアップボタンがありません');
  await modal.getByRole('button',{name:'この端末のデータを削除',exact:true}).click();
  await p.waitForURL('http://127.0.0.1:4173/');await p.waitForTimeout(500);if(!dialogs.some(x=>x.includes('初期化が完了しました')))throw new Error('初期化完了が表示されません');
  if(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('TASKKANRI_USER:')&&localStorage.getItem(k)?.includes('初期化前のデータ'))))throw new Error('以前のデータが残りました');
  if(downloads.length)throw new Error('削除ボタンがダウンロードを開始しました');
  if(errors.length)throw new Error(errors.join(', '));
  return {reset:true,downloads,errors};
 }finally{await context.close()}
}
