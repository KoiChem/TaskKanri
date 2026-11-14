async(page)=>{
 const browser=page.context().browser(),base='http://127.0.0.1:4173/';
 const check=(value,message)=>{if(!value)throw Error(message)};
 const user={id:'00000000-0000-4000-8000-000000000515',email:'startup@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 const session={access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
 const results=[];
 for(const scenario of ['saved-edit','typing','unchanged-focus','denied','network-error','unsigned-login','explicit-offline','expired-session','manual-sync','invalid-session']){
  const context=await browser.newContext({viewport:{width:1280,height:900}});let q;const errors=[],requests=[];let release;const gate=new Promise(r=>release=r);let remote;let hold=true;
  try{
   const seed=await context.newPage();await seed.goto(base);await seed.waitForFunction(()=>document.querySelector('[data-common-editor]')?.contentEditable==='true');
   remote=await seed.evaluate(async({user,session,scenario})=>{
    const {defaultState,createStorageService}=await import('./taskkanri-core.mjs');const {openPrimaryStorage}=await import('./taskkanri-primary-storage.mjs');const {scopedStorage,syncStore}=await import('./taskkanri-device-storage.mjs');const {toPayload}=await import('./taskkanri-sync-model.mjs');
    const storage=await openPrimaryStorage();const s=defaultState();s.globalTaskData='端末の内容';createStorageService(scopedStorage(storage,user.id)).saveAll(s);syncStore(storage,user.id,'seed').write('cache',{revision:1,payload:toPayload(s)});await storage.flush();storage.close();
    if(scenario!=='unsigned-login'){localStorage.setItem('TASKKANRI_SUPABASE_AUTH',JSON.stringify(['expired-session','invalid-session'].includes(scenario)?{...session,expires_at:Math.floor(Date.now()/1000)-100}:session));localStorage.setItem('TASKKANRI_CLOUD_ENABLED','true');}
    localStorage.setItem('TASKKANRI_LAST_ACCOUNT',JSON.stringify(user));if(scenario==='explicit-offline')localStorage.setItem('TASKKANRI_OFFLINE_MODE','true');
    s.globalTaskData='クラウドの更新';return {revision:2,payload:toPayload(s),updated_at:new Date().toISOString()};
   },{user,session,scenario});await seed.close();
   await context.route('https://fethojoncgermqwzrwtw.supabase.co/**',async route=>{
    const url=route.request().url();requests.push(url);
    if(hold)await gate;
    if(scenario==='invalid-session'&&url.includes('/auth/v1/token')){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'refresh_token_not_found',message:'Invalid Refresh Token: Refresh Token Not Found'})});return;}
    if(scenario==='network-error'){await route.abort('failed');return;}
    if(url.includes('save_taskkanri_document')){const b=route.request().postDataJSON();remote={revision:remote.revision+1,payload:b.payload,updated_at:new Date().toISOString()};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'saved',appliedRevision:remote.revision,updatedAt:remote.updated_at})});return;}
    const body=url.includes('/auth/v1/token')?session:url.includes('/auth/')?user:url.includes('taskkanri_is_allowed')?scenario!=='denied':url.includes('taskkanri_documents')?remote:{status:'unexpected-write'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   q=await context.newPage();q.on('pageerror',e=>errors.push(e.message));const started=Date.now();await q.goto(base);await q.waitForFunction(()=>document.querySelector('[data-common-editor]')?.contentEditable==='true');const readyMs=Date.now()-started;
   check(!await q.locator('#sync-landing').isVisible(),'landing visible '+scenario);
   if(['unsigned-login','explicit-offline'].includes(scenario)){
    await q.waitForTimeout(150);check(requests.length===0,'offline sent requests');
    if(scenario==='unsigned-login'){
     check(!await q.locator('[data-common-editor]').innerText().then(t=>t.includes('端末の内容')),'unsigned account data leaked');
     await q.locator('[data-common-editor]').fill('ログイン前の端末データ');await q.locator('[data-common-editor]').blur();await q.locator('.sync-controls button').click();await q.locator('.sync-dialog input[name=email]').fill(user.email);await q.locator('.sync-dialog input[name=password]').fill('fixture-password');hold=false;release();await q.locator('.sync-dialog form button').click();await q.locator('.sync-dialog [data-message]').getByText('ログインしました。',{exact:true}).waitFor();await q.locator('.sync-dialog [data-close]').click();await q.locator('[data-common-editor]').getByText('クラウドの更新',{exact:true}).waitFor();
    }else check((await q.locator('[data-common-editor]').innerText()).includes('端末の内容'),'explicit offline lost cache');
   }else{
    check((await q.locator('[data-common-editor]').innerText()).includes('端末の内容'),'cache unavailable before network '+scenario);
    if(['expired-session','invalid-session'].includes(scenario)){
     check(requests.some(u=>u.includes('/auth/v1/token')),'refresh not started');
    }else{
     await q.waitForFunction(()=>true);for(let i=0;i<40&&requests.length<2;i++)await q.waitForTimeout(25);
     check(requests.some(u=>u.includes('taskkanri_is_allowed'))&&requests.some(u=>u.includes('taskkanri_documents')),'startup requests were sequential');
    }
    if(['saved-edit','typing','invalid-session'].includes(scenario)){await q.locator('[data-common-editor]').fill('通信中の編集');if(scenario==='saved-edit')await q.locator('[data-common-editor]').blur();}
    if(scenario==='unchanged-focus')await q.locator('[data-common-editor]').focus();
    hold=false;release();
    if(scenario==='invalid-session'){
     await q.waitForFunction(()=>document.querySelector('.sync-controls')?.textContent.includes('オフラインモード'));
     check(!await q.locator('[data-common-editor]').innerText().then(t=>t.includes('通信中の編集')),'signed-out account still visible');
     const kept=await q.evaluate(async userId=>{const {openPrimaryStorage}=await import('./taskkanri-primary-storage.mjs');const s=await openPrimaryStorage();const found=Array.from({length:s.length},(_,i)=>s.key(i)).some(k=>k.startsWith('TASKKANRI_USER:'+userId+':')&&k.endsWith(':pending')&&s.getItem(k).includes('通信中の編集'));s.close();return found;},user.id);check(kept,'expired auth discarded focused edit');
    }else if(scenario==='saved-edit'){await q.waitForTimeout(250);check((await q.locator('[data-common-editor]').innerText()).includes('通信中の編集'),'saved edit lost');check(!(await q.locator('.sync-controls').innerText()).includes('同期完了'),'false sync success');}
    else if(['typing','unchanged-focus'].includes(scenario)){
     await q.waitForFunction(()=>document.querySelector('.sync-controls')?.textContent.includes('要確認'));await q.locator('[data-common-editor]').blur();
     if(scenario==='typing'){await q.waitForTimeout(150);check((await q.locator('[data-common-editor]').innerText()).includes('通信中の編集'),'typing lost');}
     else await q.locator('[data-common-editor]').getByText('クラウドの更新',{exact:true}).waitFor();
     check(requests.length===2,'deferred apply repeated requests');
    }else if(scenario==='denied')await q.waitForFunction(()=>document.querySelector('.sync-controls')?.textContent.includes('要確認'));
    else if(scenario==='network-error')await q.waitForFunction(()=>document.querySelector('.sync-controls')?.textContent.includes('Failed to fetch'));
    else await q.locator('[data-common-editor]').getByText('クラウドの更新',{exact:true}).waitFor();
    if(scenario==='denied')check((await q.locator('[data-common-editor]').innerText()).includes('端末の内容'),'unauthorized response applied');
   }
   check(!requests.some(u=>u.includes('save_taskkanri_document')),'automatic desktop write');
   if(scenario==='manual-sync'){
    await q.waitForFunction(()=>/\d\d:\d\d同期/.test(document.querySelector('.sync-controls')?.textContent));await q.locator('[data-common-editor]').fill('手動同期で送る');await q.locator('[data-common-editor]').blur();await q.waitForTimeout(250);check(!requests.some(u=>u.includes('save_taskkanri_document')),'edit auto-sent');await q.keyboard.press('Control+Alt+s');await q.locator('.sync-dialog').waitFor({state:'hidden'});check(remote.payload.state.globalTaskData==='手動同期で送る','manual sync did not save');
    await q.reload();await q.locator('[data-common-editor]').getByText('手動同期で送る',{exact:true}).waitFor();check(requests.filter(u=>u.includes('taskkanri_documents')).length===1,'reload fetched remote');
   }check(errors.length===0,errors.join('\n'));
   await q.setViewportSize({width:800,height:700});check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'narrow overflow');
   results.push({scenario,readyBeforeNetwork:true,readyMs,requests:requests.length,errors});
  }finally{release();await context.close();}
 }
 return results;
}
