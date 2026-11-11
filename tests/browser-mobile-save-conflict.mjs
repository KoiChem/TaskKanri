async (page) => {
 const base=await page.evaluate(()=>new URL('.',location.href).href.replace(/\/$/,''));
 const check=(value,message)=>{if(!value)throw new Error(message)};
 const context=await page.context().browser().newContext({viewport:{width:428,height:926},isMobile:true,hasTouch:true}),p=await context.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 const endpoint='https://fethojoncgermqwzrwtw.supabase.co/**';
 await context.route(endpoint,r=>r.abort());await p.goto(base+'/mobile.html');
 const payload=await p.evaluate(async()=>{
  const c=await import('./taskkanri-core.mjs'),m=await import('./taskkanri-sync-model.mjs'),s=c.defaultState(2026),badge=(n,t)=>`<span class="todo-badge state-${n}" data-state="${n}">${['未','途','済','急'][n]}</span>${t}`;
  s.configEvents['2026-10-15']='職員会議';s.globalTaskData=badge(0,'共通の仕事');s.dayProfiles['2026-10-16']='morning';
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
   if(forceConflict){forceConflict=false;doc={...doc,revision:doc.revision+1,payload:structuredClone(doc.payload)};if(forceField==='slot')doc.payload.state.dateSchedules['2026-10-15']['１限']='通信中の別端末';else if(forceField==='event')doc.payload.state.configEvents['2026-10-15']='別端末の行事';else if(forceField==='global')doc.payload.state.globalTaskData='別端末の共通';else doc.payload.state.configEvents['2026-10-14']='別項目の更新';}
   if(body.expected_revision!==doc.revision)result={status:'conflict',currentRevision:doc.revision};
   else{check(body.payload.contractVersion===2&&body.payload.appSchemaVersion===8,'changed storage contract');writes++;doc={revision:doc.revision+1,updated_at:new Date().toISOString(),payload:structuredClone(body.payload)};result={status:'saved',appliedRevision:doc.revision,updatedAt:doc.updated_at};}
  }else if(url.includes('taskkanri_documents'))result=url.includes('payload')?doc:{revision:doc.revision,updated_at:doc.updated_at};
  if(url.includes('save_taskkanri_document')&&holdSaves)await new Promise(resolve=>{releaseHold=resolve;notifyHold?.()});
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await context.addInitScript(s=>localStorage.setItem('TASKKANRI_SUPABASE_AUTH',JSON.stringify(s)),session);

 try{
  await p.reload();await p.locator('.slot-content').first().waitFor();await p.locator('[data-date="2026-10-15"]').click();
  const openSlot=async()=>{await p.locator('.slot-content[data-slot="１限"]').click();await p.locator('.slot-content [contenteditable="true"]').waitFor()};
  await openSlot();await p.locator('.slot-content [contenteditable="true"]').fill('保存する下書き');forceField='disjoint';forceConflict=true;
  await p.locator('[data-slot-save]').click();await p.locator('#slot-editor-tools').waitFor({state:'hidden'});
  check(doc.payload.state.dateSchedules['2026-10-15']['１限'].replace(/<[^>]+>/g,'')==='保存する下書き'&&doc.payload.state.configEvents['2026-10-14']==='別項目の更新','disjoint save failed '+JSON.stringify({slot:doc.payload.state.dateSchedules['2026-10-15']['１限'],events:doc.payload.state.configEvents,writes}));
  await openSlot();await p.locator('.slot-content [contenteditable="true"]').fill('上書き確認の下書き');forceField='slot';forceConflict=true;await p.locator('[data-slot-save]').click();await p.locator('[data-slot-conflict]').waitFor();
  const before=writes;doc={...doc,revision:doc.revision+1,payload:structuredClone(doc.payload)};doc.payload.state.dateSchedules['2026-10-15']['１限']='さらに更新された予定';
  await p.locator('[data-slot-confirm]').click();await p.locator('[data-slot-latest]').getByText('さらに更新された予定',{exact:true}).waitFor();check(writes===before,'confirm overwrote newer remote');check(await p.locator('.slot-content [contenteditable="true"]').innerText()==='上書き確認の下書き','confirm lost draft');
  await p.locator('[data-slot-confirm]').click();await p.locator('#slot-editor-tools').waitFor({state:'hidden'});
  await p.locator('#selected-event').click();await p.locator('#event-editor-content').fill('行事の下書き');forceField='event';forceConflict=true;await p.locator('#event-editor-sheet [data-editor-save]').click();await p.locator('#event-editor-sheet [data-editor-conflict]').waitFor();check(await p.locator('#event-editor-content').innerText()==='行事の下書き','event draft lost');await p.locator('#event-editor-sheet [data-confirm-save]').click();await p.locator('#event-editor-sheet').waitFor({state:'hidden'});
  await p.locator('#global-tab').click();await p.locator('.common-card').click();await p.locator('#edit-common').click();await p.locator('#global-editor-content').fill('共通の下書き');forceField='global';forceConflict=true;await p.locator('#global-editor-sheet [data-editor-save]').click();await p.locator('#global-editor-sheet [data-editor-conflict]').waitFor();check(await p.locator('#global-editor-content').innerText()==='共通の下書き','common draft lost');await p.locator('#global-editor-sheet [data-confirm-save]').click();await p.locator('#global-editor-sheet').waitFor({state:'hidden'});
  check(errors.length===0,errors.join(';'));return {disjointSave:true,sameFieldPanels:['slot','event','common'],newerConfirmProtected:true,pageErrors:errors,writes};
 }finally{await context.close()}
}
