import {incompleteTasks} from './mobile-model.mjs';
import {sanitizeHtml,getResolvedSlot,APP_CONFIG} from './taskkanri-core.mjs';
import {taskItems,TASK_LABELS,BADGE_LABELS} from './taskkanri-sync-model.mjs';
import {installOutsideDismiss} from './mobile-ui.mjs';

export function installIncompleteList({controller,getState,change,onJump}){
 const dialog=document.createElement('dialog');dialog.id='incomplete-sheet';dialog.setAttribute('aria-labelledby','incomplete-title');
 dialog.innerHTML='<div class="sheet-heading"><h2 id="incomplete-title">未完タスク</h2><button type="button" id="close-incomplete">閉じる</button></div><p data-incomplete-notice role="status"></p><div id="incomplete-list"></div><div data-incomplete-footer></div>';
 document.body.append(dialog);const q=s=>dialog.querySelector(s);let rows=[],opener=null,picked=null,changing=false,errorNotice='';
 function close(){if(changing)return;if(history.state?.taskkanriIncomplete)history.back();else dialog.close()}
 installOutsideDismiss(dialog,close);q('#close-incomplete').onclick=close;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
 window.addEventListener('popstate',()=>{if(dialog.open&&!history.state?.taskkanriIncomplete)dialog.close()});
 function update(){
  if(!dialog.open)return;
  const e=controller.engine,enabled=!!e?.payload&&(controller.offlineMode||navigator.onLine)&&['synced','pending','saving'].includes(e.status)&&!changing;
  let stale=false;
  for(const row of rows){
   const html=sanitizeHtml(getResolvedSlot(row.ref.dateId,row.ref.slot,getState())),tasks=taskItems(html),template=document.createElement('template');template.innerHTML=html;
   const previous=taskItems(row.ref.originalHtml),sameTasks=previous.length===tasks.length&&previous.every((task,i)=>task.text===tasks[i].text);
   const valid=sameTasks&&template.content.querySelectorAll('.todo-badge[data-state]').length===tasks.length&&!template.content.querySelector('.todo-badge .todo-badge'),task=tasks[row.ref.badgeIndex];
   if(!valid||!task)stale=true;
   row.cycle.disabled=!enabled||!valid||!task;
   if(task&&valid){row.ref.originalHtml=html;row.ref.state=task.state;row.badge.dataset.state=String(task.state);row.badge.className=`todo-badge state-${task.state}`;row.badge.textContent=BADGE_LABELS[task.state];row.cycle.setAttribute('aria-label',`${task.text}：${TASK_LABELS[task.state]}。タップで${TASK_LABELS[(task.state+1)%4]}`);row.root.classList.toggle('is-complete',task.state===2);}
  }
  q('[data-incomplete-notice]').textContent=errorNotice||((e?.status==='deferred'||stale)?'内容が更新されたか、タスクの書式を確認できません。一覧を閉じて予定を確認してください。':!enabled&&!changing?'同期を確認してからタスクを変更できます。':'');
  q('#close-incomplete').disabled=changing;
 }
 dialog.addEventListener('close',()=>{
  const toast=dialog.querySelector('#toast');if(toast)document.body.append(toast);
  rows=[];q('#incomplete-list').replaceChildren();
  const target=picked;picked=null;if(target)onJump(target);else opener?.isConnected&&opener.focus({preventScroll:true});opener=null;void controller.refresh();
 });
 window.addEventListener('online',update);window.addEventListener('offline',update);
 return {
  get open(){return dialog.open},update,
  openList(button){
   if(!controller.engine?.payload||dialog.open)return;
   opener=button;picked=null;rows=[];errorNotice='';const list=q('#incomplete-list');list.replaceChildren();
   for(const task of incompleteTasks(getState())){
    const root=document.createElement('section');root.className='incomplete-row';
    const cycle=document.createElement('button');cycle.type='button';cycle.dataset.incompleteCycle='';cycle.className='task-cycle';const badge=document.createElement('span');cycle.append(badge);
    const jump=document.createElement('button');jump.type='button';jump.className='incomplete-jump';
    const date=new Date(task.dateId+'T00:00:00Z'),meta=document.createElement('span');meta.className='incomplete-meta';meta.textContent=`${Number(task.dateId.slice(5,7))}/${Number(task.dateId.slice(8))}（${APP_CONFIG.daysStr[date.getUTCDay()]}） ${task.slot}`;
    const text=document.createElement('span');text.className='incomplete-text';text.textContent=task.text;jump.append(meta,text);
    const row={root,cycle,badge,ref:task};rows.push(row);root.append(cycle,jump);list.append(root);
    jump.onclick=()=>{if(changing)return;picked={dateId:task.dateId,slot:task.slot};close()};
    cycle.onclick=async()=>{
     if(changing)return;changing=true;errorNotice='';update();
     try{await change(row.ref,(row.ref.state+1)%4)}catch(error){errorNotice=error.message;return}
     finally{changing=false;update()}
    };
   }
   if(!rows.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='未完のタスクはありません。';list.append(empty)}
   const toast=document.querySelector('#toast');if(toast)q('[data-incomplete-footer]').append(toast);
   history.pushState({taskkanriIncomplete:true},'');dialog.showModal();update();
  },
  reset(){rows=[];picked=null;if(dialog.open)dialog.close();if(history.state?.taskkanriIncomplete)history.replaceState(null,'');}
 };
}
