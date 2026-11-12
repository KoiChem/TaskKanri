async page=>{
 const context=await page.context().browser().newContext({viewport:{width:1280,height:1000}});await context.addInitScript(()=>localStorage.setItem('TASKKANRI_OFFLINE_MODE','true'));
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const check=(ok,message)=>{if(!ok)throw Error(message)};
 try{
  await p.goto('http://127.0.0.1:4173/');await p.locator('[data-common-editor][contenteditable=true]').waitFor();
  check(await p.locator('[data-lesson-editor]').count()===1,'independent lesson editor missing');
  const common=p.locator('[data-common-editor]'),lesson=p.locator('[data-lesson-editor]');
  const badge=(state,text)=>`<div><span class="todo-badge state-${state}" data-state="${state}">${['未','途','済','急'][state]}</span>${text}</div>`;
  await common.fill('');await common.evaluate((e,html)=>{e.innerHTML=html;e.dispatchEvent(new Event('blur'))},'<div><span class="todo-badge state-0">形式不備</span></div>'+Array.from({length:18},(_,i)=>badge(i===0?1:0,'共通'+i)).join(''));
  await lesson.fill('');await lesson.evaluate((e,html)=>{e.innerHTML=html;e.dispatchEvent(new Event('blur'))},badge(0,'授業の準備'));
  let a=await common.boundingBox(),b=await lesson.boundingBox();check(Math.abs(a.width-b.width)<2&&b.x>a.x+a.width,'independent equal separated columns');
  await p.getByRole('tab',{name:'ToDo一覧',exact:true}).click();await p.locator('.todo-inline-item').first().waitFor();
  check(await p.locator('.todo-inline-item').count()===19,'todo excludes lesson');
  const first=p.locator('.todo-inline-item').first();const before=await first.boundingBox();await first.locator('[data-task-cycle]').click();
  check(await first.locator('[data-task-cycle]').innerText()==='済','completion cycle');check(await p.locator('.todo-inline-item').count()===19,'completed removed before switching tabs');
  const after=await first.boundingBox();check(Math.abs(after.x-before.x)<1&&Math.abs(after.y-before.y)<1,'completed moved');
  await first.locator('[data-task-cycle]').click();check(await first.locator('[data-task-cycle]').innerText()==='急','completed can be changed');
  await first.locator('[data-task-cycle]').click();await first.locator('[data-task-cycle]').click();await first.locator('[data-task-cycle]').click();
  check(await first.locator('[data-task-cycle]').innerText()==='済','second completion');
  await p.locator('.todo-inline-item').nth(1).locator('[data-task-cycle]').click();check(await first.locator('[data-task-cycle]').innerText()==='済','updating a later task changed completed row');check(await p.locator('.todo-inline-item').nth(1).locator('[data-task-cycle]').innerText()==='途','later task reference shifted past completed row');
  const rows=await p.locator('.todo-inline-item').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,height:r.height}}));
  const right=rows.findIndex(r=>r.x>rows[0].x+30);check(right>1,'right column not used');check(rows.slice(0,right).every(r=>Math.abs(r.x-rows[0].x)<1),'left column order');check(rows[right].y<rows[right-1].y,'right column must start at top');
  await p.getByRole('tab',{name:'共通タスク',exact:true}).click();check((await common.innerText()).includes('済共通0'),'source not saved');
  await p.getByRole('tab',{name:'ToDo一覧',exact:true}).click();check(await p.locator('.todo-inline-item').count()===18,'completed did not disappear after tab switch');
  await p.reload();await p.locator('[data-lesson-editor][contenteditable=true]').waitFor();check((await p.locator('[data-lesson-editor]').innerText()).includes('授業の準備'),'lesson did not persist');
  await p.setViewportSize({width:900,height:800});const boxes=await p.locator('.task-editor-columns .slot-input').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));check(boxes[1].x>=boxes[0].right+6,'narrow editors touch');
  check(!errors.length,errors.join(','));return {independentEditors:true,lessonSaved:true,twoColumnOrder:true,statusCycle:true,completedRetained:true,tabSwitchClears:true,reload:true,narrow:true,errors};
 }finally{await context.close()}
}
