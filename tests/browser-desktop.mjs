async (page) => {
 const context=await page.context().browser().newContext({viewport:{width:1280,height:900}});const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/index.html');
 const snapshot=await p.evaluate(async()=>{const core=await import('/taskkanri-core.mjs');const s=core.defaultState(2026);s.globalTaskData='旧メモ';return core.serializePayload(s).value});
 const user={id:'00000000-0000-4000-8000-000000000102',email:'desktop@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 const session={access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
 let doc=null;
 await context.route('https://fethojoncgermqwzrwtw.supabase.co/**',async route=>{const url=route.request().url();let result;
  if(url.includes('/taskkanri_is_allowed'))result=true;
  else if(url.includes('/auth/v1/token'))result=session;
  else if(url.includes('/save_taskkanri_document')){const b=route.request().postDataJSON();if(b.expected_revision!==(doc?.revision||0))result={status:'conflict',currentRevision:doc?.revision||0};else{doc={payload:b.payload,revision:(doc?.revision||0)+1,updated_at:new Date().toISOString()};result={status:'saved',appliedRevision:doc.revision,updatedAt:doc.updated_at}}}
  else if(url.includes('/taskkanri_documents'))result=doc&&(!url.includes('payload')?{revision:doc.revision,updated_at:doc.updated_at}:doc);
  else result=user;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 const check=(ok,message)=>{if(!ok)throw new Error(message)};
 try{
  await p.evaluate(snapshot=>localStorage.setItem('TASK_KUN_MASTER_STORAGE',JSON.stringify(snapshot)),snapshot);await p.reload();
  const common=p.locator('#top-panel .slot-input').last();await common.fill('ログイン直前のメモ');await p.getByRole('button',{name:/同期設定を開く/,exact:true}).click();
  await p.getByLabel('メールアドレス',{exact:true}).fill(user.email);await p.getByLabel('パスワード',{exact:true}).fill('fixture-only-password');await p.getByRole('button',{name:'ログイン',exact:true}).click();
  await p.getByRole('button',{name:'このデータで同期を開始',exact:true}).waitFor();
  p.once('dialog',dialog=>dialog.accept());await p.getByRole('button',{name:'このデータで同期を開始',exact:true}).click();await p.locator('.sync-controls button').getByText(/\d\d:\d\d同期/).waitFor();
  check(doc.payload.state.globalTaskData==='ログイン直前のメモ','initial migration lost recent edit');
  await p.getByRole('button',{name:'閉じる',exact:true}).click();
  // External data applies without requeueing itself or altering device preferences.
  doc={...doc,revision:doc.revision+1,payload:structuredClone(doc.payload)};doc.payload.state.globalTaskData='スマホから変更';
  await p.getByRole('button',{name:/同期設定を開く/,exact:true}).click();await p.getByRole('button',{name:'今すぐ同期',exact:true}).click();await p.getByRole('button',{name:'閉じる',exact:true}).click();
  await p.locator('#top-panel .slot-input').last().getByText('スマホから変更',{exact:true}).waitFor();check(doc.revision===2,'remote update was requeued');
  // Persisted markers remain atomic; native line breaks and undo preserve body formatting.
  const taskEditor=p.locator('#top-panel .slot-input').last();
  await taskEditor.evaluate(el=>{el.innerHTML='<span style="color: rgb(220, 38, 38); background-color: rgb(255, 255, 0);">本文</span><br><span class="todo-badge state-3" data-state="3">急</span>タスク';});
  await taskEditor.click();await p.getByRole('button',{name:/同期設定を開く/,exact:true}).click();await p.locator('.sync-controls button').getByText(/\d\d:\d\d同期/).waitFor();await p.getByRole('button',{name:'閉じる',exact:true}).click();
  const stableEditor=await taskEditor.elementHandle();await taskEditor.locator('.todo-badge').click();await p.locator('.sync-controls button').getByText(/\d\d:\d\d同期/).waitFor();check(await stableEditor.evaluate(el=>el.isConnected),'own task acknowledgment rebuilt editor');
  await p.reload();const reloaded=p.locator('#top-panel .slot-input').last();
  for(const key of ['Enter','Shift+Enter']){
   await reloaded.click();await reloaded.evaluate(el=>{const range=document.createRange();range.setStartBefore(el.querySelector('.todo-badge'));range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);});
   const before=await reloaded.innerHTML();await reloaded.press(key);
   check(await reloaded.locator('.todo-badge').count()===1,'line break cloned marker');
   check(await reloaded.locator('.todo-badge').getAttribute('contenteditable')==='false','marker became editable');
   check(await reloaded.locator('span').first().evaluate(el=>!!el.style.color&&!!el.style.backgroundColor),'body formatting removed');
   await reloaded.press('ControlOrMeta+z');check(await reloaded.innerHTML()===before,'line-break undo');
  }
  await p.getByRole('button',{name:/同期設定を開く/,exact:true}).click();await p.getByRole('button',{name:'今すぐ同期',exact:true}).click();await p.locator('[data-message]').getByText('最新の状態です。',{exact:true}).waitFor();await p.getByRole('button',{name:'閉じる',exact:true}).click();
  await p.getByRole('button',{name:/同期設定を開く/,exact:true}).click();await p.getByRole('button',{name:'ログアウト',exact:true}).click();await p.locator('[data-message]').getByText('ログアウトしました。',{exact:true}).waitFor();await p.getByRole('button',{name:'閉じる',exact:true}).click();
  check(!await p.locator('#left-panel').isVisible()&&!await p.locator('#right-panel').isVisible(),'logout privacy');
  await p.reload();check(!await p.locator('#left-panel').isVisible()&&!await p.locator('#right-panel').isVisible(),'unauthenticated reload privacy');
  check(errors.length===0,'page errors '+errors.join(','));return {initialMigration:'latest saved local data',remoteApply:'no echoed save',logoutAndReload:'private UI hidden',revision:doc.revision,atomicMarker:true,nativeBreakUndo:true,stableEditor:true,successFeedback:true,pageErrors:errors};
 }finally{await context.close()}
}
