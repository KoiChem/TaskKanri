async page => {
 const context=await page.context().browser().newContext({viewport:{width:1366,height:900},acceptDownloads:true});
 const p=await context.newPage(),errors=[],requests=[];
 p.on('pageerror',e=>errors.push(e.message));
 const check=(ok,msg)=>{if(!ok)throw new Error(msg)};
 await context.route('https://*.supabase.co/**',async route=>{requests.push(route.request().url());await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_description:'確認用のログイン失敗'})});});
 try{
  await p.goto('http://127.0.0.1:4173/');await p.evaluate(()=>{localStorage.clear();localStorage.setItem('TASKKANRI_CLOUD_ENABLED','true')});await p.reload();
  await p.getByRole('button',{name:'ログインして使う',exact:true}).waitFor();
  check(!await p.locator('.emoji-icon').first().isVisible(),'editing toolbar leaks through startup');
  for(const width of [1366,428]){await p.setViewportSize({width,height:926});const b=await p.locator('#sync-landing').boundingBox();check(b.x>=0&&b.x+b.width<=width,'startup overflows');const a=await p.locator('[data-start-login]').boundingBox(),o=await p.locator('[data-start-offline]').boundingBox();check(a.height>=44&&o.y>=a.y+a.height+12,'startup buttons touch');}
  await p.locator('[data-start-login]').click();check(await p.locator('[data-start-form]').isVisible(),'missing inline login');check(!await p.locator('.sync-dialog').isVisible(),'login opened settings');check(await p.locator('[data-start-form] input[name=email]').evaluate(e=>e===document.activeElement),'login focus');
  await p.locator('[data-start-form] input[name=email]').fill('test@example.invalid');await p.locator('[data-start-form] input[name=password]').fill('fake-test-value');await p.locator('[data-start-form] button[type=submit]').click();await p.locator('[data-start-message]').getByText(/ログインできませんでした/).waitFor();check(await p.locator('[data-start-form] input[name=password]').inputValue()==='','password retained after submit');
  await p.locator('[data-start-back]').click();check(await p.locator('[data-start-login]').evaluate(e=>e===document.activeElement),'back focus');
  await p.locator('[data-start-offline]').click();await p.getByRole('tab',{name:'共通タスク',exact:true}).waitFor();const before=requests.length;
  await p.reload();await p.getByRole('tab',{name:'共通タスク',exact:true}).waitFor();check(!await p.locator('#sync-landing').isVisible(),'offline restart shows start');check(requests.length===before,'offline restart contacted cloud');
  await p.setViewportSize({width:1366,height:900});
  await p.locator('[data-common-editor]').fill('普通のメモは候補に含めない');await p.locator('[data-common-editor]').blur();
  check(await p.locator('.sidebar-ctrl-area').count()===0,'old buttons remain');
  await p.locator('.task-management-actions').getByRole('button',{name:'授業時数',exact:true}).click();check(await p.locator('#count-tags-container button').count()===0,'notes seeded candidates');await p.locator('#count-modal').getByRole('button',{name:'閉じる',exact:true}).click();
  await p.locator('.task-management-actions').getByRole('button',{name:'日付の一括設定',exact:true}).click();check(await p.locator('#bulk-calendar-modal').isVisible(),'date button');await p.locator('#bulk-calendar-modal button[onclick="closeBulkCalendarModal()"]').click();
  await p.locator('.task-management-actions').getByRole('button',{name:'設定',exact:true}).click();await p.getByRole('button',{name:'時間割をまとめて入力',exact:true}).click();
  const color=async(day,slot)=>p.locator(`#weekly-tbody input[data-day="${day}"][data-slot="${slot}"]`).evaluate(e=>({cell:getComputedStyle(e.parentElement).backgroundColor,input:getComputedStyle(e).backgroundColor}));
  check((await color(6,'朝')).cell==='rgb(237, 247, 255)','Saturday color');check((await color(0,'１限')).cell==='rgb(255, 240, 240)','Sunday color');check((await color(1,'昼休み')).cell==='rgb(243, 244, 246)','break color');check((await color(1,'昼休み')).input==='rgba(0, 0, 0, 0)','input masks cell color');
  await p.locator('#tmpl-start').fill('2026-11-02');await p.locator('#tmpl-end').fill('2026-11-06');await p.locator('#weekly-tbody input[data-day="1"][data-slot="１限"]').fill('化学 2A');await p.locator('#weekly-tbody input[data-day="1"][data-slot="２限"]').fill('２−３＠602');await p.locator('#weekly-tbody input[data-day="1"][data-slot="朝"]').fill('朝会');
  await p.getByRole('button',{name:'変更内容を確認',exact:true}).click();await p.locator('#timetable-execute').waitFor();
  const storedWords=()=>p.evaluate(()=>Object.keys(localStorage).filter(k=>k.endsWith('TASK_KUN_MASTER_STORAGE')).map(k=>JSON.parse(localStorage.getItem(k))).map(x=>x.data?.timetableWords||[]).flat());
  check((await storedWords()).length===0,'preview persisted candidates');
  await p.locator('#timetable-execute').click();check((await storedWords()).includes('化学'),'execute failed to persist candidates');
  await p.locator('#timetable-view .settings-header button').click();await p.locator('#settings-view .settings-header button').first().click();await p.reload();
  await p.locator('.task-management-actions').getByRole('button',{name:'授業時数',exact:true}).click();const words=await p.locator('#count-tags-container button').allTextContents();check(JSON.stringify(words.sort())===JSON.stringify(['＋ 化学','＋ ２−３＠602'].sort()),'candidate source incorrect '+words);await p.screenshot({path:'/tmp/taskkanri-ui-count.png'});
  await p.locator('#count-tags-container button').filter({hasText:'化学'}).click();check(await p.locator('.cond-word-input').first().inputValue()==='化学','candidate selection failed');await p.locator('#count-modal').getByRole('button',{name:'閉じる',exact:true}).click();
  for(const width of [1366,900,428]){await p.setViewportSize({width,height:926});const boxes=await p.locator('.task-management-actions button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];check(a.right+7<=b.x||b.right+7<=a.x||a.bottom+7<=b.y||b.bottom+7<=a.y,'management buttons touch');}}
  await p.setViewportSize({width:1366,height:900});await p.screenshot({path:'/tmp/taskkanri-ui-main.png'});
  await p.locator('.sync-controls button').click();check(await p.getByRole('button',{name:'データを書き出す',exact:true}).isVisible(),'export moved');check(await p.getByRole('button',{name:'データを読み込む',exact:true}).isVisible(),'import moved');
  await p.getByRole('button',{name:'データを書き出す',exact:true}).click();const downloadPromise=p.waitForEvent('download');await p.getByRole('button',{name:'ファイルに保存',exact:true}).click();const download=await downloadPromise;check(download.suggestedFilename().endsWith('_TaskKanri.json'),'download failed');
  await p.locator('.transfer-dialog').getByRole('button',{name:'閉じる',exact:true}).click();
  const imported=await p.evaluate(async()=>{const {defaultState,serializePayload}=await import('/taskkanri-core.mjs');const state=defaultState();state.timetableWords=['インポート授業'];return serializePayload(state).value});
  const chooserPromise=p.waitForEvent('filechooser');await p.getByRole('button',{name:'データを読み込む',exact:true}).click();await (await chooserPromise).setFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
  await p.getByRole('heading',{name:'取り込む変更を確認'}).waitFor();await p.locator('.transfer-select-all input').uncheck();await p.locator('label').filter({hasText:'時間割からの候補'}).locator('input').check();await p.getByRole('button',{name:'選択した1件を取り込む',exact:true}).click();await p.getByRole('heading',{name:'取り込みが完了しました'}).waitFor();
  check((await storedWords()).includes('インポート授業'),'import did not persist candidate history');
  check(!errors.length,'page errors '+errors.join(','));return {startup:true,inlineLoginFailure:true,offlineRestart:true,managementButtons:true,colors:true,previewNotSaved:true,candidatesPersist:true,candidateSelection:true,buttonSpacing:true,exportDownload:true,selectiveImport:true,errors};
 }finally{await context.close();}
}
