async page=>{
 const c=await page.context().browser().newContext(),p=await c.newPage();
 try{await p.goto('http://127.0.0.1:4173/reset-closed.html');return await p.evaluate(async()=>{
  const {sanitizeHtml}=await import('./taskkanri-core.mjs');
  const plain='前<span style="font-weight:normal;color:#2d3748">&nbsp; </span>後<span style="color:rgb(45, 55, 72);font-weight:normal">&#160;</span>';
  const protectedHtml='<span style="background-color:yellow">&nbsp;</span><span style="font-weight:bold;color:#1e3a8a">①</span><span class="todo-badge state-2" data-state="2">済</span><span style="font-weight:normal;color:#2d3748"><br></span>';
  const holder=html=>{const el=document.createElement('div');el.innerHTML=html;return el};
  for(const mode of ['DOM','fallback']){
   const saved=globalThis.DOMParser;if(mode==='fallback')globalThis.DOMParser=undefined;
   let compact,protectedResult;try{compact=sanitizeHtml(plain);protectedResult=sanitizeHtml(protectedHtml)}finally{globalThis.DOMParser=saved}
   if(compact.includes('<span')||holder(compact).textContent!==holder(plain).textContent)throw Error(mode+': spacing changed');
   const nested='<span style="font-weight:normal;color:#2d3748"><span style="font-weight:normal;color:#2d3748">&nbsp;</span></span>';if(sanitizeHtml(nested).includes('<span'))throw Error(mode+': nested default wrappers remain');
   const protectedNode=holder(protectedResult);if(protectedNode.querySelectorAll('span').length!==4||protectedNode.querySelectorAll('br').length!==1||protectedNode.querySelector('.todo-badge')?.dataset.state!=='2'||protectedNode.firstElementChild.style.backgroundColor!=='yellow')throw Error(mode+': formatting changed');
   if(sanitizeHtml(compact)!==sanitizeHtml(sanitizeHtml(compact)))throw Error(mode+': not idempotent');
  }
  return {dom:true,fallback:true,whitespacePreserved:true,stylesAndTasksPreserved:true};
 });}finally{await c.close()}
}
