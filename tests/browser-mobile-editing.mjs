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
  s.dateSchedules={'2026-10-15':{'１限':'<b>化学</b><br>'+badge(0,'配布'),'２限':badge(2,'済の仕事')+'<br>'+badge(1,'実験準備')},'2026-10-16':{'５限':badge(3,'非表示枠の仕事')}};
  return m.toPayload(s);
 });
 let doc={revision:1,updated_at:new Date().toISOString(),payload},writes=0,offline=false,forceConflict=false,holdSaves=false,releaseHold=null,notifyHold=null;
 const user={id:'00000000-0000-4000-8000-000000001015',email:'mobile-fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}},session={access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
 await context.unroute(endpoint);await context.route(endpoint,async r=>{
  if(offline)return r.abort();const url=r.request().url();let result=user;
  if(url.includes('taskkanri_is_allowed'))result=true;
  else if(url.includes('save_taskkanri_document')){
   const body=r.request().postDataJSON();
   if(forceConflict){forceConflict=false;doc={...doc,revision:doc.revision+1,payload:structuredClone(doc.payload)};doc.payload.state.dateSchedules['2026-10-15']['１限']='通信中の別端末';}
   if(body.expected_revision!==doc.revision)result={status:'conflict',currentRevision:doc.revision};
   else{check(body.payload.contractVersion===2&&body.payload.appSchemaVersion===8,'changed storage contract');writes++;doc={revision:doc.revision+1,updated_at:new Date().toISOString(),payload:structuredClone(body.payload)};result={status:'saved',appliedRevision:doc.revision,updatedAt:doc.updated_at};}
  }else if(url.includes('taskkanri_documents'))result=url.includes('payload')?doc:{revision:doc.revision,updated_at:doc.updated_at};
  if(url.includes('save_taskkanri_document')&&holdSaves)await new Promise(resolve=>{releaseHold=resolve;notifyHold?.()});
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await context.addInitScript(s=>localStorage.setItem('TASKKANRI_SUPABASE_AUTH',JSON.stringify(s)),session);
 const select=async date=>{await p.locator(`[data-date="${date}"]`).click();};
 const input=()=>p.locator('.slot-content [contenteditable="true"]');
 const open=async(slot='１限')=>{await p.locator(`.slot-content[data-slot="${slot}"]`).click();await input().waitFor();};
 const save=async()=>{await p.locator('[data-slot-save]').click();await p.locator('#slot-editor-tools').waitFor({state:'hidden'});};
 try{
  await p.reload();await p.locator('.slot-content').first().waitFor();await select('2026-10-15');
  check(await p.locator('.tabs button').count()===3,'missing compact incomplete button');
  check(await p.locator('#global-tab').innerText()==='共通','common label');
  const geometry=await p.locator('[data-slot="１限"]').boundingBox();const before=writes;
  await p.locator('[data-slot="１限"] .todo-badge').click();await input().waitFor();
  check(await input().locator('.todo-badge').getAttribute('data-state')==='0','first tap changed task state');
  check(await p.locator('#task-sheet').isHidden(),'slot still opens detail dialog');
  const editing=await p.locator('[data-slot="１限"]').boundingBox();check(Math.abs(geometry.width-editing.width)<1&&Math.abs(geometry.height-editing.height)<1,'editing enlarged slot');
  await input().locator('.todo-badge').click();check(await input().locator('.todo-badge').getAttribute('data-state')==='1','inline state did not cycle');check(writes===before,'draft silently saved');
  await select('2026-10-16');await select('2026-10-15');await open();check(await input().locator('.todo-badge').getAttribute('data-state')==='1','navigation lost draft');
  await p.reload();await p.locator('.slot-content').first().waitFor();await select('2026-10-15');await open();check(await input().locator('.todo-badge').getAttribute('data-state')==='1','reload lost draft');
  await save();check(doc.payload.state.dateSchedules['2026-10-15']['１限'].includes('<b>化学</b>'),'save lost rich formatting');check(doc.payload.state.dateSchedules['2026-10-15']['１限'].includes('data-state="1"'),'save lost task state');
  await open('朝');await input().fill('朝の新規予定');
  await input().evaluate(e=>{const data=new DataTransfer();data.setData('text/html','<b>貼付</b><script>window.unsafePaste=true</script>');e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))});
  check(await input().locator('b').innerText()==='貼付'&&await p.evaluate(()=>!window.unsafePaste),'rich paste safety');
  await p.locator('[data-slot-add-task]').click();check(await input().locator('.todo-badge').count()===1,'task addition missing');await save();
  await open();await input().fill('取り消す編集');await p.locator('[data-slot-cancel]').click();await open();check((await input().innerText()).includes('化学'),'cancel lost original');await p.locator('[data-slot-cancel]').click();
  await open();await input().dispatchEvent('compositionstart',{data:'かがく'});await input().fill('変換中の化学');
  check(await p.locator('[data-slot-save]').isDisabled(),'IME composition can be saved');await select('2026-10-16');
  check(await input().count()===1&&(await p.locator('#selected-date').innerText()).includes('10月15日'),'navigation interrupted IME composition');
  await input().dispatchEvent('compositionend',{data:'化学'});const detachedInput=await input().elementHandle();await p.locator('[data-slot-cancel]').click();await detachedInput.dispatchEvent('compositionend',{data:'化学'});
  await open();await p.evaluate(()=>{window.originalDraftSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.includes('mobile-slot-draft:'))throw new Error('quota fixture');return window.originalDraftSetItem.call(this,key,value)}});
  await input().fill('保存領域が満杯でも残す本文');await select('2026-10-16');check(await input().innerText()==='保存領域が満杯でも残す本文','storage failure discarded current editor');
  await p.evaluate(()=>{Storage.prototype.setItem=window.originalDraftSetItem;delete window.originalDraftSetItem});await p.locator('[data-slot-cancel]').click();
  await p.locator('#incomplete-tab').click();const list=p.locator('#incomplete-sheet');await list.waitFor();
  check(!(await list.innerText()).includes('共通の仕事')&&!(await list.innerText()).includes('済の仕事'),'incomplete includes excluded tasks');
  check((await list.innerText()).includes('非表示枠の仕事'),'hidden task omitted');
  const task=list.locator('.incomplete-row').filter({hasText:'実験準備'});
  await p.evaluate(()=>{window.originalQueueSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.endsWith(':pending'))throw new Error('queue quota fixture');return window.originalQueueSetItem.call(this,key,value)}});
  await task.locator('[data-incomplete-cycle]').click();check((await list.locator('[data-incomplete-notice]').innerText()).includes('queue quota fixture'),'queue failure was hidden');check(await task.locator('.todo-badge').getAttribute('data-state')==='1','failed queue changed task state');
  await p.evaluate(()=>{Storage.prototype.setItem=window.originalQueueSetItem;delete window.originalQueueSetItem});holdSaves=true;await task.locator('[data-incomplete-cycle]').click();
  check(await task.locator('.todo-badge').getAttribute('data-state')==='2','list state not cycled');check(await task.isVisible(),'completed row disappeared immediately');
  await p.locator('#close-incomplete').click();await list.waitFor({state:'hidden'});await open();await input().locator('.todo-badge').click();
  if(!releaseHold)await new Promise(resolve=>{notifyHold=resolve});holdSaves=false;releaseHold();
  await p.waitForFunction(()=>!document.querySelector('[data-slot-save]').disabled,{},{timeout:3000});await save();
  await p.locator('#incomplete-tab').click();check(!(await list.innerText()).includes('実験準備'),'completed task returned on reopen');
  await list.locator('.incomplete-jump').filter({hasText:'非表示枠の仕事'}).click();await list.waitFor({state:'hidden'});
  await p.waitForFunction(()=>document.querySelector('#selected-date').textContent.includes('10月16日'));
  check(await p.locator('[data-slot="５限"]').isVisible(),'hidden target not revealed');
  await open('５限');await input().fill('非表示枠を編集');await save();check(doc.payload.state.dateSchedules['2026-10-16']['５限']==='非表示枠を編集','hidden slot save failed');check(doc.payload.state.dayProfiles['2026-10-16']==='morning','reveal changed day profile');
  await select('2026-10-15');await open();await input().fill('競合しても残す下書き');
  doc={...doc,revision:doc.revision+1,payload:structuredClone(doc.payload)};doc.payload.state.dateSchedules['2026-10-15']['１限']='別端末の本文';const conflictWrites=writes;
  await p.locator('[data-slot-save]').click();await p.locator('[data-slot-conflict]').waitFor();check(writes===conflictWrites,'remote content overwritten without confirmation');check((await input().innerText())==='競合しても残す下書き','conflict lost draft');check((await p.locator('[data-slot-latest]').innerText())==='別端末の本文','latest not shown');
  await p.locator('[data-slot-confirm]').click();await p.locator('#slot-editor-tools').waitFor({state:'hidden'});check(doc.payload.state.dateSchedules['2026-10-15']['１限'].replace(/<[^>]+>/g,'')==='競合しても残す下書き','confirmed conflict save failed: '+JSON.stringify({html:doc.payload.state.dateSchedules['2026-10-15']['１限'],writes}));
  await open();await input().fill('CAS競合の下書き');forceConflict=true;await p.locator('[data-slot-save]').click();await p.locator('[data-slot-conflict]').waitFor();check((await input().innerText())==='CAS競合の下書き','CAS conflict lost draft');check((await p.locator('[data-slot-latest]').innerText())==='通信中の別端末','CAS latest not shown');await p.locator('[data-slot-confirm]').click();await p.locator('#slot-editor-tools').waitFor({state:'hidden'});
  await open();await input().fill('オフライン下書き');offline=true;await context.setOffline(true);await p.locator('[data-slot-save]').waitFor({state:'visible'});await p.waitForFunction(()=>document.querySelector('[data-slot-save]').disabled);
  await select('2026-10-16');await context.setOffline(false);offline=false;await select('2026-10-15');await open();check(await input().innerText()==='オフライン下書き','offline draft lost');await p.locator('[data-slot-cancel]').click();
  const layout=await p.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect(),tabs=rect('.tabs'),sync=rect('#menu');return {overflow:document.documentElement.scrollWidth>innerWidth,tabWidths:[...document.querySelectorAll('.tabs button')].map(e=>e.getBoundingClientRect().width),syncGap:sync.left-tabs.right,agenda:getComputedStyle(document.querySelector('#agenda')).backgroundColor,calendar:getComputedStyle(document.querySelector('#calendar')).backgroundColor}});
  check(!layout.overflow&&layout.tabWidths.every(w=>w>=44&&w<=46)&&layout.syncGap<=10,'header layout');check(layout.agenda==='rgb(255, 255, 255)'&&layout.calendar==='rgb(246, 248, 252)','background hierarchy');
  await p.locator('#global-tab').click();await p.locator('.common-card').click();check(await p.locator('#task-sheet').isVisible(),'common detail regression');
  await p.locator('#edit-common').click();await p.locator('#global-editor-content').fill('共通を編集');await p.locator('[data-editor-save]').click();await p.locator('#global-editor-sheet').waitFor({state:'hidden'});check(doc.payload.state.globalTaskData.includes('共通を編集'),'common editor save regression');
  await p.locator('#close-sheet').click();await p.locator('#task-sheet').waitFor({state:'hidden'});
  doc={...doc,revision:doc.revision+1,payload:structuredClone(payload)};await p.reload();await p.locator('.slot-content').first().waitFor();await select('2026-10-15');
  await p.screenshot({path:'/Users/ikemon/Documents/codings/GitHub/chem/TaskKanri/.playwright-mcp/mobile-inline-agenda.png'});
  await open();await p.screenshot({path:'/Users/ikemon/Documents/codings/GitHub/chem/TaskKanri/.playwright-mcp/mobile-inline-edit.png'});
  await p.setViewportSize({width:428,height:600});await p.waitForFunction(()=>{const input=document.querySelector('.is-editing'),tools=document.querySelector('#slot-editor-tools');return input.getBoundingClientRect().bottom<=tools.getBoundingClientRect().top});
  await p.screenshot({path:'/Users/ikemon/Documents/codings/GitHub/chem/TaskKanri/.playwright-mcp/mobile-inline-short-viewport.png'});await p.setViewportSize({width:428,height:926});await p.locator('[data-slot-cancel]').click();
  await p.locator('#incomplete-tab').click();await p.screenshot({path:'/Users/ikemon/Documents/codings/GitHub/chem/TaskKanri/.playwright-mcp/mobile-incomplete.png'});await p.goBack();await p.locator('#incomplete-sheet').waitFor({state:'hidden'});
  check(errors.length===0,errors.join(';'));return {base,writes,layout,pageErrors:errors,checks:'inline/dimensions/first-tap/task-cycle/new-slot/task-add/cancel/draft-navigation/reload/offline/conflict/CAS/hidden-task/jump/completed-row/common-regression',note:'Disposable API fixture; no live account writes'};
 }finally{await context.close();}
}
