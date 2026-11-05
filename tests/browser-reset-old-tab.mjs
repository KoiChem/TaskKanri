async page=>{const c=await page.context().browser().newContext(),a=await c.newPage(),b=await c.newPage(),dialogs=[];
 a.on('dialog',async d=>{dialogs.push(d.message());await d.accept()});await c.addInitScript(()=>localStorage.setItem('TASKKANRI_OFFLINE_MODE','true'));
 try{await a.goto('http://127.0.0.1:4173/');await a.locator('[data-common-editor]').fill('消してはいけない');await a.locator('[data-common-editor]').blur();await b.goto('http://127.0.0.1:4173/reset-closed.html');await b.evaluate(()=>{window.lockReady=new Promise(resolve=>navigator.locks.request('TASKKANRI_TAB:old',()=>{resolve();return new Promise(()=>{})}))});await b.evaluate(()=>window.lockReady);
 await a.evaluate(()=>openResetModal());await a.locator('#reset-execute').click();await a.waitForTimeout(500);const current=await a.locator('[data-common-editor]').textContent();if(!current.includes('消してはいけない'))throw Error('他タブ使用中に削除された');
 if(!dialogs.some(error=>error.includes('ほかのTaskKanriのタブを閉じて')))throw Error('他タブがあることを表示していません');return {preserved:true,advised:true};
 }finally{await c.close()}}
