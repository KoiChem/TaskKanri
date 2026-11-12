async (page) => {
 const base=await page.evaluate(()=>new URL('.',location.href).href.replace(/\/$/,''));
 const check=(value,message)=>{if(!value)throw new Error(message)};
 const context=await page.context().browser().newContext({viewport:{width:428,height:926},isMobile:true,hasTouch:true}),p=await context.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 const endpoint='https://fethojoncgermqwzrwtw.supabase.co/**';
 await context.route(endpoint,r=>r.abort());await p.goto(base+'/mobile.html');
 const payload=await p.evaluate(async()=>{
  const c=await import('./taskkanri-core.mjs'),m=await import('./taskkanri-sync-model.mjs'),s=c.defaultState(2026),badge=(n,t)=>`<span class="todo-badge state-${n}" data-state="${n}">${['未','途','済','急'][n]}</span>${t}`;
  s.configEvents['2026-10-15']='職員会議';s.globalTaskData=badge(0,'共通の仕事');s.lessonTaskData=badge(0,'授業の仕事');s.dayProfiles['2026-10-16']='morning';
  s.dateSchedules={'2026-10-15':{'１限':'<b>化学</b><br>'+badge(0,'配布'),'２限':badge(2,'済の仕事')+'<br>'+badge(1,'実験準備'),'３限':badge(0,'確認1')+'<br>'+badge(1,'確認2')},'2026-10-16':{'５限':badge(3,'非表示枠の仕事')}};
  return m.toPayload(s);
 });
 let forceField='slot';let doc={revision:1,updated_at:new Date().toISOString(),payload},writes=0,offline=false,forceConflict=false,holdSaves=false,releaseHold=null,notifyHold=null;
 const user={id:'00000000-0000-4000-8000-000000001015',email:'mobile-fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}},session={access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
 await context.unroute(endpoint);await context.route(endpoint,async r=>{
  if(offline)return r.abort();const url=r.request().url();let result=user;
  if(url.includes('taskkanri_is_allowed'))result=true;
  else if(url.includes('save_taskkanri_document')){
   const body=r.request().postDataJSON();
   if(forceConflict){forceConflict=false;doc={...doc,revision:doc.revision+1,payload:structuredClone(doc.payload)};if(forceField==='slot')doc.payload.state.dateSchedules['2026-10-15']['１限']='通信中の別端末';else if(forceField==='event')doc.payload.state.configEvents['2026-10-15']='別端末の行事';else if(forceField==='global')doc.payload.state.globalTaskData='別端末の共通';else if(forceField==='lesson')doc.payload.state.lessonTaskData='別端末の授業';else doc.payload.state.configEvents['2026-10-14']='別項目の更新';}
   if(body.expected_revision!==doc.revision)result={status:'conflict',currentRevision:doc.revision};
   else{check(body.payload.contractVersion===3&&body.payload.appSchemaVersion===9,'changed storage contract');writes++;doc={revision:doc.revision+1,updated_at:new Date().toISOString(),payload:structuredClone(body.payload)};result={status:'saved',appliedRevision:doc.revision,updatedAt:doc.updated_at};}
  }else if(url.includes('taskkanri_documents'))result=url.includes('payload')?doc:{revision:doc.revision,updated_at:doc.updated_at};
  if(url.includes('save_taskkanri_document')&&holdSaves)await new Promise(resolve=>{releaseHold=resolve;notifyHold?.()});
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await context.addInitScript(s=>localStorage.setItem('TASKKANRI_SUPABASE_AUTH',JSON.stringify(s)),session);

 try{
  await p.reload();await p.locator('.slot-content').first().waitFor();
  const layout=await p.evaluate(()=>{
   const rect=s=>document.querySelector(s).getBoundingClientRect(),tabs=[...document.querySelectorAll('.tabs button')].map(e=>({label:e.textContent,...e.getBoundingClientRect().toJSON()}));
   return {tabs,sync:rect('#menu').toJSON(),date:rect('#selected-date').toJSON(),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  check(layout.tabs.map(t=>t.label).join(',')==='予定,共通,授業,未完','tab order');
  check(!layout.overflow&&layout.tabs.every(t=>t.width>=44&&t.height>=44),'touch geometry');
  check(layout.tabs.slice(1).every((t,i)=>t.left-layout.tabs[i].right>=4),'tabs touch');
  check(layout.sync.bottom<layout.tabs[0].top,'sync not above tabs');
  check(layout.date.right<layout.tabs[0].left,'date overlaps tabs');
  const detail=async(source)=>{await p.locator('#'+source+'-tab').click();await p.locator('.common-card').click();await p.locator('#task-sheet').waitFor();};
  const edit=async(source)=>{await detail(source);await p.locator('#edit-common').click();await p.locator('#'+source+'-editor-sheet').waitFor();};
  const closeDetail=async()=>{await p.locator('#close-sheet').click();await p.locator('#task-sheet').waitFor({state:'hidden'});};
  await detail('lesson');check((await p.locator('#sheet-title').innerText())==='授業タスク','lesson label');
  await Promise.all([p.waitForResponse(r=>r.url().includes('save_taskkanri_document')),p.locator('[data-task-cycle]').click()]);await p.locator('#sheet-body .todo-badge[data-state="1"]').waitFor();
  check(doc.payload.state.lessonTaskData.includes('data-state="1"')&&doc.payload.state.globalTaskData.includes('data-state="0"'),'lesson cycle changed common');
  await Promise.all([p.waitForResponse(r=>r.url().includes('save_taskkanri_document')),p.locator('#undo-task').click()]);await p.locator('#sheet-body .todo-badge[data-state="0"]').waitFor();
  await p.locator('#edit-common').click();await p.locator('#lesson-editor-content').fill('授業だけの下書き');
  await p.locator('#lesson-editor-sheet [data-editor-close]').click();await p.locator('#lesson-editor-sheet').waitFor({state:'hidden'});await closeDetail();
  await edit('global');check((await p.locator('#global-editor-content').innerText()).includes('共通の仕事'),'lesson draft leaked into common');await p.locator('#global-editor-content').fill('共通だけの下書き');
  await p.locator('#global-editor-sheet [data-editor-close]').click();await p.locator('#global-editor-sheet').waitFor({state:'hidden'});await closeDetail();
  await edit('lesson');check((await p.locator('#lesson-editor-content').innerText())==='授業だけの下書き','lesson draft not restored');
  forceField='lesson';forceConflict=true;await p.locator('#lesson-editor-sheet [data-editor-save]').click();await p.locator('#lesson-editor-sheet [data-editor-conflict]').waitFor();
  check((await p.locator('#lesson-editor-content').innerText())==='授業だけの下書き','lesson conflict lost draft');
  check((await p.locator('#lesson-editor-sheet [data-editor-latest]').innerText())==='別端末の授業','lesson conflict latest');
  const before=writes;doc={...doc,revision:doc.revision+1,payload:structuredClone(doc.payload)};doc.payload.state.lessonTaskData='さらに更新された授業';
  await p.locator('#lesson-editor-sheet [data-confirm-save]').click();await p.locator('#lesson-editor-sheet [data-editor-latest]').getByText('さらに更新された授業',{exact:true}).waitFor();check(writes===before,'lesson confirm overwrote newer update');
  await p.locator('#lesson-editor-sheet [data-confirm-save]').click();await p.locator('#lesson-editor-sheet').waitFor({state:'hidden'});
  check(doc.payload.state.lessonTaskData==='授業だけの下書き'&&doc.payload.state.globalTaskData.includes('共通の仕事'),'lesson save affected common');await closeDetail();
  await edit('global');check((await p.locator('#global-editor-content').innerText())==='共通だけの下書き','common draft lost');
  await p.locator('#global-editor-sheet [data-editor-save]').click();await p.locator('#global-editor-sheet').waitFor({state:'hidden'});
  check(doc.payload.state.globalTaskData==='共通だけの下書き'&&doc.payload.state.lessonTaskData==='授業だけの下書き','common save affected lesson');
  check(errors.length===0,errors.join(';'));return {writes,layout,checks:'lesson-cycle/undo/independent-drafts/save/conflict/newer-update-protection/common-regression',pageErrors:errors};
 }finally{await context.close()}
}
