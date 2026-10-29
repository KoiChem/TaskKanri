async page => {
 const context=await page.context().browser().newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(()=>localStorage.setItem('TASKKANRI_OFFLINE_MODE','true'));
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const check=(ok,message)=>{if(!ok)throw new Error(message)};
 const height=()=>p.locator('[role=tabpanel]:visible').evaluate(e=>e.getBoundingClientRect().height);
 try {
  await p.goto('http://127.0.0.1:4173/');await p.locator('[data-common-editor]').waitFor();
  check(await height()>=280,'task area must start enlarged: '+await height());
  const editor=p.locator('[data-common-editor]');await editor.fill('サイズ変更後にも残す本文');await editor.blur();
  const handle=p.getByRole('separator',{name:'タスク枠の高さ'});
  await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();const before=await height();
  await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2,box.y+box.height/2+100,{steps:8});await p.mouse.up();
  const expanded=await height();check(expanded>=before+95,'pointer drag did not expand');await p.screenshot({path:'/tmp/taskkanri-height-expanded.png'});
  await p.getByRole('tab',{name:'ToDo一覧',exact:true}).click();check(await height()===expanded,'height changed across tabs');
  await p.locator('#top-panel .nav-btn').nth(1).click();check(await height()===expanded,'height lost on date navigation');
  await p.reload();await p.locator('[data-common-editor]').waitFor();check(await height()===expanded,'height lost on reload');
  check(await p.locator('[data-common-editor]').innerText()==='サイズ変更後にも残す本文','resize lost task data');
  await p.getByRole('separator',{name:'タスク枠の高さ'}).focus();await p.keyboard.press('ArrowUp');check(await height()===expanded-20,'keyboard resize failed');
  await p.setViewportSize({width:900,height:700});check(await height()===expanded-20,'height changed on viewport resize');
  await p.getByRole('separator',{name:'タスク枠の高さ'}).scrollIntoViewIfNeeded();const b=await p.getByRole('separator',{name:'タスク枠の高さ'}).boundingBox();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2,0,{steps:8});await p.mouse.up();check(await height()>=120,'drag shrank below minimum');
  check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  await p.locator('[data-common-editor]').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/taskkanri-height.png'});
  check(!errors.length,'page errors '+errors.join(','));return {initialEnlarged:true,drag:true,sharedTabs:true,dateNavigation:true,reload:true,keyboard:true,dataPreserved:true,narrow:true,minimum:true,expanded,errors};
 }finally{await context.close()}
}
