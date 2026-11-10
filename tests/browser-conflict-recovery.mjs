async (page) => {
 const browser=page.context().browser();const base='http://127.0.0.1:4173/';
 const context=await browser.newContext({viewport:{width:1280,height:900}});const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const user={id:'00000000-0000-4000-8000-000000000129',email:'manual@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 const session={access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
 let doc,reads=0,writes=0;const requests=[];
 await context.route('https://fethojoncgermqwzrwtw.supabase.co/**',async route=>{const url=route.request().url();requests.push(url);let result;
 if(url.includes('taskkanri_is_allowed'))result=true;else if(url.includes('taskkanri_documents')){reads++;result=url.includes('payload')?doc:{revision:doc.revision,updated_at:doc.updated_at};}
 else if(url.includes('save_taskkanri_document')){writes++;const b=route.request().postDataJSON();if(b.expected_revision!==doc.revision)result={status:'conflict'};else{doc={revision:doc.revision+1,payload:b.payload,updated_at:new Date().toISOString()};result={status:'saved',appliedRevision:doc.revision,updatedAt:doc.updated_at};}}
 else if(url.includes('/auth/v1/token'))result=session;else result=user;
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });

 try{
 await p.goto(base+'reset-closed.html');doc=await p.evaluate(async()=>{const core=await import('./taskkanri-core.mjs'),sync=await import('./taskkanri-sync-model.mjs');return {revision:1,payload:sync.toPayload(core.defaultState()),updated_at:new Date().toISOString()}});
 await context.addInitScript(s=>localStorage.setItem('TASKKANRI_SUPABASE_AUTH',JSON.stringify(s)),session);
 await p.goto(base);await p.locator('[data-common-editor][contenteditable="true"]').waitFor();await p.locator('[data-common-editor]').fill('local unique');await p.locator('[data-common-editor]').blur();
 doc={...doc,revision:2,payload:structuredClone(doc.payload)};doc.payload.state.globalTaskData='phone change';await p.keyboard.press('Control+Alt+s');await p.locator('[data-message]').getByText(/競合/).waitFor();
 p.on('dialog',d=>d.accept());const download=p.waitForEvent('download');await p.locator('[data-reload]').click();await download;await p.locator('[data-message]').getByText('最新データを読み込みました。',{exact:true}).waitFor({timeout:3000});if(await p.locator('[data-common-editor]').textContent()!=='phone change')throw Error('explicit conflict recovery failed');if(errors.length)throw Error(errors.join(','));return {conflictRecovery:true,pendingExported:true,errors};
 }finally{await context.close()}
}
