async page=>{
 const base='http://127.0.0.1:4173/',context=await page.context().browser().newContext({viewport:{width:1280,height:900}}),p=await context.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 const user={id:'00000000-0000-4000-8000-000000000135',email:'received@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 const session={access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};let doc,writes=0;
 const check=(v,m)=>{if(!v)throw Error(m)};
 await context.route('https://*.supabase.co/**',async route=>{const url=route.request().url();let result=user;if(url.includes('taskkanri_is_allowed'))result=true;else if(url.includes('taskkanri_documents'))result=url.includes('payload')?doc:{revision:doc.revision,updated_at:doc.updated_at};else if(url.includes('save_taskkanri_document')){const req=route.request().postDataJSON();if(req.expected_revision!==doc.revision)result={status:'conflict'};else{writes++;doc={revision:doc.revision+1,payload:req.payload,updated_at:new Date().toISOString()};result={status:'saved',appliedRevision:doc.revision,updatedAt:doc.updated_at}}}else if(url.includes('/auth/v1/token'))result=session;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)})});
 try{
  await p.goto(base);const payload=await p.evaluate(async()=>{const {defaultState}=await import('./taskkanri-core.mjs'),{toPayload}=await import('./taskkanri-sync-model.mjs');const s=defaultState();s.globalTaskData='before';s.dateSchedules['2026-11-12']={'１限':'before slot'};return toPayload(s)});doc={revision:1,payload,updated_at:new Date().toISOString()};await p.close();
  await context.addInitScript(s=>localStorage.setItem('TASKKANRI_SUPABASE_AUTH',JSON.stringify(s)),session);const q=await context.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(base);const edit=q.locator('[data-common-editor]');await edit.waitFor();await q.waitForFunction(()=>document.querySelector('[data-common-editor]')?.contentEditable==='true');await edit.getByText('before',{exact:true}).waitFor();
  await edit.evaluate(e=>{e.innerHTML='<span class="todo-badge state-1" data-state="1">途</span>同期しても残す';e.dispatchEvent(new Event('blur'))});
  await q.getByRole('tab',{name:'ToDo一覧',exact:true}).click();await q.locator('[data-task-cycle]').click();
  await q.keyboard.press('Control+Alt+s');await q.locator('.sync-dialog').waitFor({state:'hidden'});
  doc=structuredClone(doc);doc.revision++;doc.payload.state.configEvents['2026-11-14']='別端末の行事';
  await q.keyboard.press('Control+Alt+s');await q.getByText('同期が完了しました。取り込んだ変更が1件あります。',{exact:true}).waitFor();await q.locator('[data-close]').click();
  check(await q.locator('.todo-inline-item').count()===1,'remote receipt removed completed row before common switch');
  check(await q.locator('[data-task-cycle]').innerText()==='済','completion lost after remote receipt');
  await q.getByRole('tab',{name:'共通タスク',exact:true}).click();await q.getByRole('tab',{name:'ToDo一覧',exact:true}).click();check(await q.locator('.todo-inline-item').count()===0,'completed remains after common switch');
  check(!errors.length,errors.join(','));return {retainedAcrossRemoteReceipt:true,tabSwitchClears:true,writes,errors};
 }finally{await context.close()}
}
