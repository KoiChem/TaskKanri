import {samePayload,toPayload} from './taskkanri-sync-model.mjs';
import {sanitizeHtml} from './taskkanri-core.mjs';
import {prepareGlobalSave,globalDraftStore,prepareEventSave,eventDraftStore} from './mobile-editor-model.mjs';
import {installOutsideDismiss} from './mobile-ui.mjs';

export function installGlobalEditor({controller,getState,onSaved=()=>{},eventDate=null}){
 const isEvent=!!eventDate,label=isEvent?'行事予定':'共通タスク';
 const currentHtml=()=>sanitizeHtml(isEvent?getState().configEvents[active.dateId]||'':getState().globalTaskData);
 const dialog=document.createElement('dialog');dialog.id=isEvent?'event-editor-sheet':'global-editor-sheet';dialog.setAttribute('aria-labelledby','global-editor-title');
 dialog.innerHTML='<div class="sheet-heading"><h2 id="global-editor-title">共通タスクを編集</h2><button type="button" data-editor-close>閉じる</button></div><div class="global-editor-scroll"><div class="global-editor-tools"><button type="button" data-add-task>タスク追加</button><span>下書きは端末に保存</span></div><div id="global-editor-content" contenteditable="true" role="textbox" aria-label="共通タスクの内容" aria-multiline="true"></div><div data-editor-conflict hidden><h3>最新の共通タスク</h3><div data-editor-latest></div><p>下書きとは別に更新されています。下書きで置き換える場合は、両方を確認してから保存してください。</p><button type="button" data-confirm-save>下書きの内容で保存</button></div></div><p data-editor-sync role="status"></p><p data-editor-message role="status"></p><div class="global-editor-footer"><button type="button" data-editor-save>保存</button></div>';
 if(isEvent){dialog.innerHTML=dialog.innerHTML.replaceAll('共通タスク','行事予定');dialog.querySelector('#global-editor-title').id='event-editor-title';dialog.setAttribute('aria-labelledby','event-editor-title');dialog.querySelector('#global-editor-content').id='event-editor-content';dialog.querySelector('[data-add-task]').hidden=true;}
 document.body.append(dialog);
 const q=s=>dialog.querySelector(s),input=q(isEvent?'#event-editor-content':'#global-editor-content');let active=null,opener=null,range=null,composing=false;
 const tell=text=>q('[data-editor-message]').textContent=text;
 const html=()=>sanitizeHtml(input.innerHTML);
 function badges(){input.querySelectorAll('.todo-badge').forEach(badge=>badge.contentEditable='false')}
 function persist(ctx){
  ctx.html=html();
  if(ctx.html===ctx.originalHtml){if(ctx.lastDraft)ctx.store.clearIfUnchanged(ctx.lastDraft);return}
  const draft={id:ctx.id,originalHtml:ctx.originalHtml,html:ctx.html,updatedAt:new Date().toISOString()};ctx.store.write(draft);ctx.lastDraft=draft;
 }
 function persistActive(){if(!active)return true;try{persist(active);return true}catch(error){tell('下書きを端末に保存できません。閉じずに本文をコピーして保全してください。');return false}}
 function requestClose(){
  if(!persistActive())return;
  input.blur();if(history.state?.taskkanriTextEdit)history.back();else dialog.close();
 }
 installOutsideDismiss(dialog,requestClose);
 q('[data-editor-close]').onclick=requestClose;
 dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose()});
 window.addEventListener('popstate',()=>{if(dialog.open&&persistActive())dialog.close()});
 dialog.addEventListener('close',()=>{active=null;range=null;composing=false;input.replaceChildren();q('[data-editor-latest]').replaceChildren();document.documentElement.style.removeProperty('--editor-viewport-height');const focusTarget=opener?.isConnected?opener:document.querySelector('#task-sheet[open] #edit-common')||document.querySelector('#agenda');focusTarget?.focus({preventScroll:true});void controller.refresh()});
 function viewport(){if(dialog.open)document.documentElement.style.setProperty('--editor-viewport-height',`${window.visualViewport?.height||window.innerHeight}px`)}
 window.visualViewport?.addEventListener('resize',viewport);
 input.addEventListener('compositionstart',()=>{composing=true;update()});input.addEventListener('compositionend',()=>{composing=false;persistActive();update()});
 input.addEventListener('input',()=>{persistActive();update()});
 document.addEventListener('selectionchange',()=>{const selection=window.getSelection();if(selection?.rangeCount&&input.contains(selection.anchorNode)&&input.contains(selection.focusNode))range=selection.getRangeAt(0).cloneRange()});
 function insert(fragment){
  input.focus({preventScroll:true});const selection=window.getSelection();
  let target=range;if(!target||!input.contains(target.commonAncestorContainer)){target=document.createRange();target.selectNodeContents(input);target.collapse(false)}
  target.deleteContents();const last=fragment.lastChild;target.insertNode(fragment);if(last)target.setStartAfter(last);target.collapse(true);selection.removeAllRanges();selection.addRange(target);range=target.cloneRange();badges();persistActive();update();
 }
 input.addEventListener('paste',event=>{
  event.preventDefault();if(!active||active.saving)return;
  const pasted=event.clipboardData?.getData('text/html'),text=event.clipboardData?.getData('text/plain')||'';
  const template=document.createElement('template');
  if(pasted)template.innerHTML=sanitizeHtml(pasted);else {const lines=text.split(/\r?\n/);lines.forEach((line,i)=>{if(i)template.content.append(document.createElement('br'));template.content.append(document.createTextNode(line))})}
  insert(template.content);
 });
 q('[data-add-task]').onpointerdown=event=>event.preventDefault();
 q('[data-add-task]').onclick=()=>{if(!active||active.saving)return;const fragment=document.createDocumentFragment(),badge=document.createElement('span');badge.className='todo-badge state-0';badge.dataset.state='0';badge.textContent='未';badge.contentEditable='false';fragment.append(badge,document.createTextNode(' '));insert(fragment)};
 function update(){
  const saving=!!active?.saving,e=controller.engine;const canSave=!!active&&!saving&&!composing&&navigator.onLine&&!!e?.payload&&!e.busy&&!e.pending&&!['blocked','conflict','offline','empty','loading'].includes(e.status);
  q('[data-editor-save]').disabled=!canSave;q('[data-confirm-save]').disabled=!canSave;q('[data-add-task]').disabled=!active||saving;
  q('[data-editor-sync]').textContent=!active||saving||canSave||composing?'':navigator.onLine===false||e?.status==='offline'?'オフラインです。下書きを保持し、接続後に保存できます。':'同期を確認してから保存できます。';
  input.contentEditable=saving?'false':'true';
 }
 window.addEventListener('online',update);window.addEventListener('offline',update);
 function showConflict(ctx){
  ctx.conflictBase=currentHtml();q('[data-editor-latest]').innerHTML=ctx.conflictBase;q('[data-editor-conflict]').hidden=false;
  tell(label+'が更新されています。下書きを保持しました。');
 }
 async function save(confirmed=false){
  const ctx=active;if(!ctx||ctx.saving||composing||!persistActive())return;
  if(confirmed&&ctx.conflictBase===undefined)return;
  const original=confirmed?ctx.conflictBase:ctx.originalHtml,submitted=html();ctx.saving=true;update();tell('同期を確認しています…');
  try{
   const checked=await controller.refresh();if(active!==ctx||controller.user?.id!==ctx.userId)return;
   if(checked.error)throw checked.error;
   const engine=controller.engine;if(engine.deferred){const doc=engine.deferred;engine.deferred=null;engine.accept(doc)}
   let next;try{next=(isEvent?prepareEventSave(getState(),ctx.dateId,original,submitted):prepareGlobalSave(getState(),original,submitted))}catch(error){showConflict(ctx);return}
   tell('保存しています…');const result=await controller.save(next);
   if(result.status==='conflict'&&active===ctx&&controller.engine===engine){
    if(engine.pending?.nextPayload||!samePayload(engine.pending?.request.payload,toPayload(next)))throw new Error('別の未送信データがあります。同期設定で確認してください。');
    persist(ctx);await engine.discardPending();
    if(active===ctx&&controller.user?.id===ctx.userId)showConflict(ctx);return;
   }
   if(!['saved','duplicate'].includes(result.status))throw result.error||new Error('保存できませんでした。下書きを保持しています。同期設定で最新の状態を確認してください。');
   ctx.store.clearIfUnchanged(ctx.lastDraft||{id:ctx.id,html:submitted,originalHtml:ctx.originalHtml});
   if(active===ctx){ctx.originalHtml=submitted;ctx.html=submitted;ctx.lastDraft=null;onSaved();tell('保存しました。');requestClose()}
  }catch(error){if(active===ctx)tell(error.message+' 下書きは保持しています。')}
  finally{ctx.saving=false;if(active===ctx)update()}
 }
 q('[data-editor-save]').onclick=()=>void save();q('[data-confirm-save]').onclick=()=>void save(true);
 window.addEventListener('pagehide',()=>{if(active)persistActive()});
 return {
  get open(){return dialog.open},update,
  openEditor(button){
   if(!controller.user||!controller.engine?.payload)return;
   try{
    const dateId=isEvent?eventDate():null,store=isEvent?eventDraftStore(localStorage,controller.user.id,dateId):globalDraftStore(localStorage,controller.user.id),draft=store.read();
    const originalHtml=sanitizeHtml(isEvent?getState().configEvents[dateId]||'':getState().globalTaskData);
    active={dateId,id:crypto.randomUUID(),userId:controller.user.id,store,originalHtml:draft?.originalHtml??originalHtml,html:draft?.html??originalHtml,saving:false};
    if(isEvent)q('#event-editor-title').textContent=`${dateId} 行事予定を編集`;
    opener=button;range=null;input.innerHTML=active.html;badges();q('[data-editor-conflict]').hidden=true;q('[data-editor-latest]').replaceChildren();tell(draft?'未保存の下書きを復元しました。':'');
    if(draft)persist(active);
    history.pushState({taskkanriTextEdit:true},'');dialog.showModal();viewport();update();input.focus({preventScroll:true});
   }catch(error){active=null;controller.onStatus(error.message,controller.engine)}
  },
  reset(){
   if(active)persistActive();active=null;if(dialog.open)dialog.close();input.replaceChildren();q('[data-editor-latest]').replaceChildren();tell('');
   if(history.state?.taskkanriTextEdit)history.replaceState(null,'');
  }
 };
}
