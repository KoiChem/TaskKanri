import {sanitizeHtml,getResolvedSlot} from './taskkanri-core.mjs';
import {taskItems,TASK_LABELS,BADGE_LABELS,samePayload,toPayload} from './taskkanri-sync-model.mjs';
import {prepareSlotSave,slotDraftStore} from './mobile-editor-model.mjs';

export function installSlotEditor({controller,getState,onClosed=()=>{},onError=()=>{}}){
 const tools=document.createElement('section');tools.id='slot-editor-tools';tools.hidden=true;tools.setAttribute('aria-label','予定の編集操作');
 tools.innerHTML='<div class="slot-editor-actions"><span data-slot-title></span><button type="button" data-slot-add-task>タスク追加</button><button type="button" data-slot-cancel>取消</button><button type="button" data-slot-save>保存</button></div><p data-slot-message role="status"></p><div data-slot-conflict hidden><p>最新の予定</p><div data-slot-latest></div><p>下書きと最新の予定を確認してから保存してください。</p><button type="button" data-slot-confirm>下書きで上書き</button></div>';
 document.body.append(tools);
 const q=s=>tools.querySelector(s);let active=null,range=null;
 const tell=text=>q('[data-slot-message]').textContent=text;
 const html=ctx=>{
  const copy=ctx.input.cloneNode(true);
  copy.querySelectorAll('[data-slot-caret-anchor]').forEach(anchor=>{
   const walker=document.createTreeWalker(anchor,NodeFilter.SHOW_TEXT);let node;
   while((node=walker.nextNode()))node.nodeValue=node.nodeValue.replace(/\u200B/g,'');
   anchor.replaceWith(...anchor.childNodes);
  });
  return sanitizeHtml(copy.innerHTML);
 };
 function badges(ctx){ctx.input.querySelectorAll('.todo-badge').forEach(b=>{b.contentEditable='false';b.setAttribute('role','button');b.tabIndex=0;const n=Number(b.dataset.state);b.setAttribute('aria-label',`${TASK_LABELS[n]||'タスク'}。タップで状態を変更`);})}
 function persist(ctx){
  const value=html(ctx);ctx.html=value;
  if(value===ctx.originalHtml){if(ctx.lastDraft){ctx.store.clearIfUnchanged(ctx.lastDraft);ctx.lastDraft=null;}return}
  const draft={id:ctx.id,html:value,originalHtml:ctx.originalHtml,updatedAt:new Date().toISOString()};ctx.store.write(draft);ctx.lastDraft=draft;
 }
 function persistActive(){if(!active)return true;try{persist(active);return true}catch(error){tell('下書きを端末に保存できません。本文をコピーして保全してください。');return false}}
 function viewport(){
  if(!active)return;
  const vv=window.visualViewport,bottom=(vv?.offsetTop||0)+(vv?.height||innerHeight);
  tools.style.top=`${Math.max(0,bottom-tools.getBoundingClientRect().height)}px`;
  document.documentElement.style.setProperty('--slot-keyboard-cover',`${Math.max(0,innerHeight-bottom)}px`);
  const area=document.querySelector('#agenda'),box=active.root.getBoundingClientRect(),limit=tools.getBoundingClientRect().top-8,top=document.querySelector('.mobile-header').getBoundingClientRect().bottom+4;
  if(box.bottom>limit)area.scrollTop+=box.bottom-limit;
  else if(box.top<top)area.scrollTop-=top-box.top;
 }
 function update(){
  if(!active)return;
  const e=controller.engine,saving=active.saving,ready=!!e?.payload&&(controller.offlineMode||navigator.onLine)&&!e.busy&&(controller.offlineMode||!e.pending)&&!['blocked','conflict','offline','empty','loading'].includes(e.status);
  q('[data-slot-save]').disabled=saving||active.composing||!ready;q('[data-slot-confirm]').disabled=saving||active.composing||!ready;
  q('[data-slot-cancel]').disabled=saving;q('[data-slot-add-task]').disabled=saving||active.composing;
  active.input.contentEditable=saving?'false':'true';
  tools.dataset.saving=String(saving);
  if(!saving&&!active.composing&&!ready)tell(navigator.onLine===false||e?.status==='offline'?'オフラインです。下書きを保持しています。':'同期を確認してから保存できます。下書きは保持しています。');
  requestAnimationFrame(viewport);
 }
 function detach(){
  const ctx=active;if(!ctx)return;
  active=null;range=null;tools.hidden=true;tools.style.removeProperty('top');document.body.classList.remove('slot-editing');document.documentElement.style.removeProperty('--slot-keyboard-cover');
  ctx.input.blur();ctx.input.contentEditable='false';ctx.root.classList.remove('is-editing');ctx.root.style.removeProperty('height');ctx.root.closest('.slot-card').style.removeProperty('height');
  onClosed();
 }
 function suspend(){if(!active)return true;if(active.saving){tell('保存が終わるまでお待ちください。');return false}if(active.composing){tell('文字の変換を確定してから移動してください。');return false}if(!persistActive())return false;detach();return true}
 function cancel(){
  if(!active||active.saving)return;
  try{if(active.lastDraft)active.store.clearIfUnchanged(active.lastDraft);detach();void controller.refresh()}
  catch(error){tell('下書きを取り消せませんでした。内容を保持しています。')}
 }
 function showConflict(ctx){
  ctx.conflictBase=sanitizeHtml(getResolvedSlot(ctx.dateId,ctx.slot,getState()));q('[data-slot-latest]').innerHTML=ctx.conflictBase;q('[data-slot-conflict]').hidden=false;tell('別の端末で予定が更新されています。下書きを保持しました。');
 }
 async function save(confirmed=false){
  const ctx=active;if(!ctx||ctx.saving||ctx.composing||!persistActive()||confirmed&&ctx.conflictBase===undefined)return;
  const original=confirmed?ctx.conflictBase:ctx.originalHtml,submitted=html(ctx);ctx.saving=true;update();tell('同期を確認しています…');
  try{
   const checked=await controller.refresh();if(active!==ctx||controller.user?.id!==ctx.userId)return;if(checked.error)throw checked.error;
   const engine=controller.engine;if(engine.deferred){const doc=engine.deferred;engine.deferred=null;engine.accept(doc)}
   if(sanitizeHtml(getResolvedSlot(ctx.dateId,ctx.slot,getState()))!==submitted){
    let next;try{next=prepareSlotSave(getState(),ctx.dateId,ctx.slot,original,submitted)}catch(error){showConflict(ctx);return}
    tell('保存しています…');const result=await controller.save(next);
    if(result.status==='conflict'&&active===ctx&&controller.engine===engine){
     if(engine.pending?.nextPayload||!samePayload(engine.pending?.request.payload,toPayload(next)))throw new Error('別の未送信データがあります。同期設定で確認してください。');
     persist(ctx);await engine.discardPending();if(active===ctx&&controller.user?.id===ctx.userId)showConflict(ctx);return;
    }
    if(!['saved','duplicate'].includes(result.status))throw result.error||new Error('保存結果を確認できません。同期設定を確認してください。');
   }
   ctx.store.clearIfUnchanged(ctx.lastDraft||{id:ctx.id,html:submitted,originalHtml:ctx.originalHtml});
   if(active===ctx){detach();void controller.refresh()}
  }catch(error){if(active===ctx)tell(error.message+' 下書きは保持しています。')}
  finally{ctx.saving=false;if(active===ctx)update()}
 }
 function insert(fragment){
  const ctx=active;if(!ctx||ctx.saving||ctx.composing)return;
  ctx.input.focus({preventScroll:true});let target=range;
  if(!target||!ctx.input.contains(target.commonAncestorContainer)){target=document.createRange();target.selectNodeContents(ctx.input);target.collapse(false)}
  target.deleteContents();const last=fragment.lastChild;target.insertNode(fragment);if(last)target.setStartAfter(last);target.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(target);range=target.cloneRange();badges(ctx);persistActive();update();
 }
 function caretAfterBadge(ctx,badge){
  if(active!==ctx||ctx.saving||ctx.composing||!ctx.input.contains(badge))return;
  function leadingText(node){
   if(node?.nodeType===Node.TEXT_NODE)return node.length?node:null;
   if(node?.nodeType!==Node.ELEMENT_NODE||node.matches('br,div,p,.todo-badge'))return null;
   for(const child of node.childNodes){if(child.nodeType===Node.ELEMENT_NODE&&child.matches('br,div,p,.todo-badge'))break;const text=leadingText(child);if(text)return text}
   return null;
  }
  let text=leadingText(badge.nextSibling);
  if(!text){const anchor=document.createElement('span');anchor.dataset.slotCaretAnchor='';text=document.createTextNode('\u200B');anchor.append(text);badge.after(anchor)}
  ctx.input.focus({preventScroll:true});const target=document.createRange();target.setStart(text,0);target.collapse(true);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(target);range=target.cloneRange();
  const caret=target.getBoundingClientRect(),box=ctx.input.getBoundingClientRect();
  if(caret.bottom>box.bottom)ctx.input.scrollTop+=caret.bottom-box.bottom;else if(caret.top<box.top)ctx.input.scrollTop-=box.top-caret.top;
 }
 function cycle(badge){
  const ctx=active;if(!ctx||ctx.saving||ctx.composing)return;
  const all=[...ctx.input.querySelectorAll('.todo-badge[data-state]')],tasks=taskItems(html(ctx));
  if(all.length!==tasks.length||ctx.input.querySelector('.todo-badge .todo-badge')){tell('タスクの書式を確認できません。本文でアイコンを整えてください。');return}
  const index=all.indexOf(badge),task=tasks[index];if(!task)return;
  const n=(task.state+1)%4;badge.dataset.state=String(n);badge.className=`todo-badge state-${n}`;badge.textContent=BADGE_LABELS[n];badges(ctx);persistActive();return true;
 }
 q('[data-slot-add-task]').onclick=()=>{const badge=document.createElement('span');badge.className='todo-badge state-0';badge.dataset.state='0';badge.textContent='未';const fragment=document.createDocumentFragment();fragment.append(badge,document.createTextNode(' '));insert(fragment);if(active&&badge.isConnected)caretAfterBadge(active,badge)};
 q('[data-slot-save]').onclick=()=>void save();q('[data-slot-confirm]').onclick=()=>void save(true);q('[data-slot-cancel]').onclick=cancel;
 tools.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault()});
 document.addEventListener('selectionchange',()=>{const s=window.getSelection();if(active&&s?.rangeCount&&active.input.contains(s.anchorNode)&&active.input.contains(s.focusNode))range=s.getRangeAt(0).cloneRange()});
 window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);
 window.addEventListener('online',update);window.addEventListener('offline',update);window.addEventListener('pagehide',persistActive);
 window.addEventListener('beforeunload',event=>{if(!persistActive()){event.preventDefault();event.returnValue=''}});
 return {
  get open(){return !!active},update,suspend,
  openEditor(ref,root,focus=true,badgeIndex=null){
   if(active?.root===root)return;
   if(!suspend()||!controller.user||!controller.engine?.payload)return;
   // Suspending another slot re-renders the schedule; locate its current element.
   root=[...document.querySelectorAll('.slot-content')].find(e=>e.dataset.dateId===ref.dateId&&e.dataset.slot===ref.slot);if(!root)return;
   try{
    const store=slotDraftStore(localStorage,controller.user.id,ref.dateId,ref.slot),draft=store.read(),originalHtml=sanitizeHtml(getResolvedSlot(ref.dateId,ref.slot,getState()));
    const height=root.getBoundingClientRect().height,row=root.closest('.slot-card'),rowHeight=row.getBoundingClientRect().height;
    const input=document.createElement('div');input.className='rich-text';input.innerHTML=draft?.html??originalHtml;input.contentEditable='true';input.setAttribute('role','textbox');input.setAttribute('aria-multiline','true');input.setAttribute('aria-label',`${ref.slot}の予定を編集`);
    active={...ref,root,input,store,id:crypto.randomUUID(),userId:controller.user.id,originalHtml:draft?.originalHtml??originalHtml,lastDraft:draft,saving:false,composing:false};
    const ctx=active;range=null;root.replaceChildren(input);root.classList.add('is-editing');root.removeAttribute('role');root.tabIndex=-1;root.style.height=`${height}px`;row.style.height=`${rowHeight}px`;badges(ctx);
    input.addEventListener('input',()=>{if(active!==ctx)return;badges(ctx);persistActive();update()});
    input.addEventListener('compositionstart',()=>{if(active!==ctx)return;ctx.composing=true;update()});input.addEventListener('compositionend',()=>{if(active!==ctx)return;ctx.composing=false;badges(ctx);persistActive();update()});
    input.addEventListener('pointerdown',event=>{if(active===ctx&&event.isPrimary&&event.button===0&&event.target.closest('.todo-badge'))event.preventDefault()});
    input.addEventListener('click',event=>{if(active!==ctx)return;const badge=event.target.closest('.todo-badge');if(badge){event.preventDefault();event.stopPropagation();if(cycle(badge))caretAfterBadge(ctx,badge)}});
    input.addEventListener('keydown',event=>{if(active!==ctx)return;const badge=event.target.closest('.todo-badge');if(badge&&['Enter',' '].includes(event.key)){event.preventDefault();cycle(badge)}else if(event.key==='Escape'&&!event.isComposing){event.preventDefault();cancel()}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void save()}});
    input.addEventListener('paste',event=>{event.preventDefault();if(active!==ctx)return;const template=document.createElement('template'),rich=event.clipboardData?.getData('text/html');if(rich)template.innerHTML=sanitizeHtml(rich);else (event.clipboardData?.getData('text/plain')||'').split(/\r?\n/).forEach((line,i)=>{if(i)template.content.append(document.createElement('br'));template.content.append(document.createTextNode(line))});insert(template.content)});
    q('[data-slot-title]').textContent=ref.slot;q('[data-slot-conflict]').hidden=true;q('[data-slot-latest]').replaceChildren();tell(draft?'未保存の下書きを復元しました。':'');
    tools.hidden=false;document.body.classList.add('slot-editing');update();const tappedBadge=Number.isInteger(badgeIndex)?input.querySelectorAll('.todo-badge')[badgeIndex]:null;if(tappedBadge)caretAfterBadge(ctx,tappedBadge);else if(focus)input.focus({preventScroll:true});viewport();
   }catch(error){if(active)detach();onError(error)}
  },
  reset(){if(active){persistActive();detach();}}
 };
}
