async (page) => {
  // All application storage and API fixtures live in this newly created context.
  const context=await page.context().browser().newContext({viewport:{width:428,height:926}});
  const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4173/mobile.html');
  const state=await p.evaluate(async()=>(await import('/taskkanri-core.mjs')).defaultState(2026));
  state.globalTaskData='<b>職員室メモ</b><br><span class="todo-badge state-0" data-state="0">未</span>プリント配布<br><span class="todo-badge state-0" data-state="0">未</span>プリント配布';
  const keys=['currentYear','dateSchedules','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','globalTaskData','countSettings','daySlotConfig','instructionDayConfig'];
  let doc={revision:1,updated_at:new Date().toISOString(),payload:{contractVersion:2,appSchemaVersion:8,state:Object.fromEntries(keys.map(k=>[k,state[k]]))}};
  const user={id:'00000000-0000-4000-8000-000000000101',email:'fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
  const session={access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
  let disconnected=false;let writes=0;
  await context.route('https://fethojoncgermqwzrwtw.supabase.co/**',async route=>{
    if(disconnected){await route.abort('failed');return;}
    let result;const url=route.request().url();
    if(url.includes('/taskkanri_is_allowed'))result=true;
    else if(url.includes('/save_taskkanri_document')){
      writes++;const body=route.request().postDataJSON();if(body.expected_revision!==doc.revision)result={status:'conflict',currentRevision:doc.revision};
      else{doc={...doc,revision:doc.revision+1,payload:body.payload};result={status:'saved',appliedRevision:doc.revision,updatedAt:doc.updated_at}}
    }else if(url.includes('/taskkanri_documents'))result=url.includes('payload')?doc:{revision:doc.revision,updated_at:doc.updated_at};
    else result=user;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await context.addInitScript(({session})=>localStorage.setItem('TASKKANRI_SUPABASE_AUTH',JSON.stringify(session)),{session});
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  try {
    await p.reload();await p.locator('#sync-status').getByText(/\d\d:\d\d同期/).waitFor();
    const layout=await p.evaluate(()=>({days:document.querySelectorAll('.date-button').length,cal:document.querySelector('#calendar').getBoundingClientRect().height,minDay:Math.min(...Array.from(document.querySelectorAll('.date-button'),x=>x.getBoundingClientRect().height)),overflow:document.documentElement.scrollWidth>innerWidth}));
    check(layout.days>=365&&layout.minDay>=44&&!layout.overflow,'month layout');
    await p.getByRole('button',{name:'共通タスク 2',exact:true}).click();await p.getByRole('button',{name:'共通タスクの詳細を開く'}).click();
    const originalBody=await p.locator('#sheet-body').elementHandle();
    const originalButton=await p.getByRole('button',{name:'完了',exact:true}).nth(1).elementHandle();
    await p.locator('#task-sheet').evaluate(el=>el.scrollTop=100);
    const sheetScroll=await p.locator('#task-sheet').evaluate(el=>el.scrollTop);
    await p.getByRole('button',{name:'急ぎ',exact:true}).nth(1).click();
    await p.getByRole('button',{name:'進行中',exact:true}).nth(1).click();
    await p.getByRole('button',{name:'完了',exact:true}).nth(1).click();
    check(await originalButton.evaluate(el=>el.isConnected),'button replaced during local edit');await p.locator('#sync-status').getByText(/\d\d:\d\d同期/).waitFor();
    check(writes===1,'rapid operations were not batched');check(await originalBody.evaluate(el=>el.isConnected)&&await originalButton.evaluate(el=>el.isConnected),'sheet/button replaced after acknowledgment');check(await p.locator('#task-sheet').evaluate(el=>el.scrollTop)===sheetScroll,'sheet scroll changed');
    check(doc.revision===2&&doc.payload.state.globalTaskData.includes('data-state="2"'),'duplicate task status update');
    // Undo remains accessible while the native dialog is open.
    await p.getByRole('button',{name:'元に戻す',exact:true}).click();await p.locator('#sync-status').getByText(/\d\d:\d\d同期/).waitFor();
    check(doc.revision===3&&doc.payload.state.globalTaskData.endsWith('<span class="todo-badge state-1" data-state="1">途</span>プリント配布'),'undo');
    await p.getByRole('button',{name:'閉じる',exact:true}).click();await p.locator('#task-sheet').waitFor({state:'hidden'});
    // Undo also patches the visible card after the task sheet has closed.
    await p.getByRole('button',{name:'共通タスクの詳細を開く'}).click();await p.getByRole('button',{name:'完了',exact:true}).nth(1).click();await p.locator('#sync-status').getByText(/\d\d:\d\d同期/).waitFor();
    await p.getByRole('button',{name:'閉じる',exact:true}).click();await p.locator('#task-sheet').waitFor({state:'hidden'});
    await p.getByRole('button',{name:'元に戻す',exact:true}).click();await p.locator('#sync-status').getByText(/\d\d:\d\d同期/).waitFor();
    check(await p.locator('.common-card .todo-badge').nth(1).getAttribute('data-state')==='1','closed-sheet undo left visible card stale');check(await p.locator('#task-count').innerText()==='2','closed-sheet undo left count stale');
    await p.screenshot({path:'/private/tmp/taskkanri-mobile-mvp.png'});
    await p.getByRole('button',{name:'週表示',exact:true}).click();check(await p.locator('.date-button').count()===7,'week view');
    await p.setViewportSize({width:428,height:740});await p.getByRole('button',{name:'月表示',exact:true}).click();
    const compact=await p.evaluate(()=>({height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,agenda:document.querySelector('#agenda').getBoundingClientRect().height}));
    check(!compact.overflow&&compact.agenda>200,'compact height');
    disconnected=true;await p.reload();await p.locator('#sync-status').getByText(/オフライン/).waitFor();
    await p.getByRole('button',{name:'共通タスク 2',exact:true}).click();check(await p.getByText('職員室メモ',{exact:true}).isVisible(),'offline verified cache');
    await p.getByRole('button',{name:'共通タスクの詳細を開く'}).click();check(!await p.getByRole('button',{name:'完了',exact:true}).first().isEnabled(),'offline writes disabled');
    await p.getByRole('button',{name:'閉じる',exact:true}).click();await p.locator('#task-sheet').waitFor({state:'hidden'});
    await p.getByRole('button',{name:'同期設定を開く',exact:true}).click();await p.getByRole('button',{name:'今すぐ同期',exact:true}).click();
    await p.locator('[data-message]').getByText(/通信できませんでした/).waitFor();
    check(!await p.getByRole('button',{name:'今すぐ同期',exact:true}).isDisabled(),'refresh stayed disabled');
    check(errors.length===0,'page errors: '+errors.join(','));
    return {layout,compact,revision:doc.revision,offline:'verified-cache/read-only',pageErrors:errors,writes,stableSheet:true,offlineFeedback:true,note:'Synthetic fixtures in disposable context; no live Supabase credentials'};
  } finally {await context.close();}
}
