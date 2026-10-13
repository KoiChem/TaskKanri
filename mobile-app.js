import {APP_CONFIG,defaultState,clone,sanitizeHtml,stripHtml,getResolvedSlot,getDateSchedulePolicy,isSlotVisibleForDate,academicYearBounds,getHolidayName} from './taskkanri-core.mjs';
import {taskItems,changeTask,undoTask,slotTime,tokyoToday,calendarDays,addDays,hasAgenda,TASK_LABELS,samePayload,toPayload} from './taskkanri-sync-model.mjs';
import {SyncController} from './taskkanri-sync.js';
import {installSyncUI} from './taskkanri-sync-ui.js';
const q=s=>document.querySelector(s);const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e};
let state=defaultState(),loaded=false,selected=tokyoToday(),period=selected,tab='agenda',week=localStorage.getItem('TASKKANRI_MOBILE_WEEK')==='true',sheet=null,undo=null,undoTimer=null,opener=null;
const scroll={agenda:0,global:0};const dialog=q('#task-sheet');
const controller=new SyncController({mode:'mobile',getState:()=>state,canApply:()=>!dialog.open,
 onAccount:user=>{loaded=false;state=defaultState();sheet=null;undo=null;if(dialog.open)dialog.close();q('#toast').hidden=true;q('#agenda').replaceChildren(el('p',user?'読み込み中…':'同期設定からログインしてください。'));q('#calendar-days').replaceChildren();if(!user){const login=el('button','ログイン');login.type='button';login.onclick=e=>ui.open(e);q('#agenda').append(login)}},
 onData:(next,doc)=>{
  const first=!loaded;const same=loaded&&samePayload(toPayload(next),toPayload(state));
  state=next;loaded=true;
  const bounds=academicYearBounds(state.currentYear);if(selected<bounds.start||selected>bounds.end)selected=tokyoToday()>=bounds.start&&tokyoToday()<=bounds.end?tokyoToday():bounds.start;
  if(first)period=selected;
  if(sheet){sheet.revision=doc.revision;sheet.originalHtml=sanitizeHtml(sheet.source==='global'?state.globalTaskData:getResolvedSlot(sheet.dateId,sheet.slot,state));}
  if(same){if(undo)undo.revision=doc.revision;updateSheetControls();return;}
  undo=null;q('#toast').hidden=true;render();if(dialog.open&&sheet)renderSheet();
 },
 onStatus:(text,engine)=>{q('#sync-status').textContent=text;ui?.update();if(engine?.status==='empty')q('#agenda').replaceChildren(el('p','PC版で同期を開始してください。'));if(dialog.open&&sheet){if(['synced','pending','saving'].includes(engine?.status)){sheet.revision=engine.revision;if(undo)undo.revision=engine.revision;}updateSheetControls();}}

});
let ui=installSyncUI(controller,{mobile:true});q('#menu').onclick=e=>ui.open(e);q('#start-login').onclick=e=>ui.open(e);
function rich(html){const e=el('div');e.className='rich-text';e.innerHTML=sanitizeHtml(html);return e}
function render(){q('#selected-date').textContent=`${Number(selected.slice(5,7))}月${Number(selected.slice(8))}日（${APP_CONFIG.daysStr[new Date(selected+'T00:00:00Z').getUTCDay()]}）`;renderContent();renderCalendar();}
function renderContent(){if(!loaded)return;const area=q('#agenda');const previous=area.scrollTop;area.replaceChildren();q('#agenda-tab').setAttribute('aria-pressed',String(tab==='agenda'));q('#global-tab').setAttribute('aria-pressed',String(tab==='global'));const count=taskItems(state.globalTaskData).filter(t=>t.state!==2).length;q('#task-count').textContent=count?String(count):'';
 if(tab==='global'){
  if(!stripHtml(state.globalTaskData).trim())area.append(el('p','共通タスクはありません。'));
  else{const button=el('button');button.type='button';button.className='common-card';button.dataset.taskSource='global';button.setAttribute('aria-label','共通タスクの詳細を開く');button.append(rich(state.globalTaskData));button.onclick=e=>openSheet({source:'global'},e.currentTarget);area.append(button)}
 }else{
  const policy=getDateSchedulePolicy(selected,state);const meta=[stripHtml(state.configEvents[selected]||''),stripHtml(getHolidayName(selected,state)||''),policy.isFixedOffActive?'固定休業日':({short:'短縮時程','short-am':'短縮AM',morning:'午前時程',exam:'定期考査','mock-exam':'模擬試験','noclass-hide':'授業なし','noclass-show':'授業なし'})[policy.profile]].filter(Boolean);
  if(meta.length){const header=el('div',meta.join('\n'));header.className='day-meta';header.style.whiteSpace='pre-line';area.append(header)}
  for(const slot of APP_CONFIG.slotsAll.filter(slot=>isSlotVisibleForDate(selected,slot,state))){const row=el('div');row.className='slot-card';const label=el('div',slotTime(selected,slot,state));label.className='slot-time';label.append(el('span',slot));const html=getResolvedSlot(selected,slot,state);const button=el('button');button.type='button';button.className='slot-content';button.dataset.taskSource='slot';button.dataset.dateId=selected;button.dataset.slot=slot;button.setAttribute('aria-label',`${slot}の詳細を開く`);if(stripHtml(html).trim())button.append(rich(html));else{const empty=el('span','予定なし');empty.className='placeholder';button.append(empty)}button.onclick=e=>openSheet({source:'slot',dateId:selected,slot},e.currentTarget);row.append(label,button);area.append(row)}
  if(!area.childElementCount)area.append(el('p','表示する予定はありません。'));
 }area.scrollTop=previous;}
function renderCalendar(){const month=period.slice(0,7);q('#calendar-title').textContent=week?`${Number(period.slice(5,7))}月 ${Number(calendarDays(period,true)[0].slice(8))}日〜`:`${month.slice(0,4)}年${Number(month.slice(5))}月`;q('#calendar-mode').textContent=week?'月表示':'週表示';q('#previous').setAttribute('aria-label',week?'前週':'前月');q('#next').setAttribute('aria-label',week?'翌週':'翌月');document.body.classList.toggle('week-view',week);const container=q('#calendar-days');container.replaceChildren();if(!loaded)return;const bounds=academicYearBounds(state.currentYear);const today=tokyoToday();
 for(const id of calendarDays(period,week)){const b=el('button',String(Number(id.slice(8))));b.type='button';b.className='date-button';b.disabled=id<bounds.start||id>bounds.end;b.classList.toggle('outside',id.slice(0,7)!==month);b.classList.toggle('today',id===today);b.classList.toggle('holiday',!!getHolidayName(id,state));b.setAttribute('aria-pressed',String(id===selected));b.setAttribute('aria-label',`${id}${id===today?' 今日':''}${id===selected?' 選択中':''}`);if(hasAgenda(id,state)){const dot=el('span');dot.className='event-dot';dot.setAttribute('aria-hidden','true');b.append(dot)}b.onclick=()=>{const changed=selected!==id;selected=id;period=id;tab='agenda';if(changed)scroll.agenda=0;render();q('#agenda').scrollTop=scroll.agenda};container.append(b)}
}
function shift(n){if(week)period=addDays(period,n*7);else{const d=new Date(period.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);period=d.toISOString().slice(0,10)}tab='agenda';render();}
q('#previous').onclick=()=>shift(-1);q('#next').onclick=()=>shift(1);q('#calendar-mode').onclick=()=>{week=!week;localStorage.setItem('TASKKANRI_MOBILE_WEEK',String(week));period=selected;renderCalendar()};
q('#today').onclick=()=>{if(!loaded)return;const today=tokyoToday(),bounds=academicYearBounds(state.currentYear);if(today<bounds.start||today>bounds.end){ui.tell('今日は表示中の年度外です。PC版で年度を切り替えてください。');ui.open();return}selected=period=today;tab='agenda';scroll.agenda=0;render();q('#agenda').scrollTop=0};
for(const [id,next] of [['#agenda-tab','agenda'],['#global-tab','global']])q(id).onclick=()=>{scroll[tab]=q('#agenda').scrollTop;tab=next;renderContent();q('#agenda').scrollTop=scroll[tab]};
function openSheet(ref,button){opener=button;const html=ref.source==='global'?state.globalTaskData:getResolvedSlot(ref.dateId,ref.slot,state);sheet={...ref,revision:controller.engine.revision,originalHtml:sanitizeHtml(html)};renderSheet();dialog.append(q('#toast'));history.pushState({taskkanriSheet:true},'');dialog.showModal();}
function taskEditingEnabled(){const e=controller.engine;return !!e?.payload&&navigator.onLine&&['synced','pending','saving'].includes(e.status);}
function updateSheetControls(){
 if(!sheet)return;
 const tasks=taskItems(sheet.originalHtml);const enabled=taskEditingEnabled();
 q('#sheet-body').querySelectorAll('[data-badge-index]').forEach(group=>{
  const task=tasks[Number(group.dataset.badgeIndex)];
  group.querySelectorAll('button').forEach((button,i)=>{button.disabled=!enabled;button.setAttribute('aria-pressed',String(task?.state===i));});
 });
 const notice=q('#sheet-body [data-task-notice]');if(notice){notice.hidden=enabled;notice.textContent=controller.engine?.error||'同期を確認してから状態を変更できます。';}
}
function renderSheet(){
 const body=q('#sheet-body');body.replaceChildren();q('#sheet-title').textContent=sheet.source==='global'?'共通タスク':`${sheet.dateId} ${sheet.slot}`;
 const content=rich(sheet.originalHtml);content.dataset.sheetRich='';body.append(content);
 for(const task of taskItems(sheet.originalHtml)){
  const group=el('section');group.className='task-editor';group.dataset.badgeIndex=String(task.badgeIndex);group.append(el('p',task.text));
  const choices=el('div');choices.className='status-options';for(let i=0;i<4;i++){const button=el('button',TASK_LABELS[i]);button.type='button';button.onclick=()=>void setTask(task.badgeIndex,i);choices.append(button)}group.append(choices);body.append(group);
 }
 const notice=el('p');notice.dataset.taskNotice='';notice.setAttribute('role','status');body.append(notice);updateSheetControls();
}
function patchTaskViews(ref){
 const html=sanitizeHtml(ref.source==='global'?state.globalTaskData:getResolvedSlot(ref.dateId,ref.slot,state));
 const tasks=taskItems(html);
 const patch=root=>{if(!root)return;root.querySelectorAll('.todo-badge[data-state]').forEach((badge,i)=>{const task=tasks[i];if(!task)return;badge.dataset.state=String(task.state);badge.className=`todo-badge state-${task.state}`;badge.textContent=['未','途','済','急'][task.state];});};
 if(sheet&&sheet.source===ref.source&&(ref.source==='global'||sheet.dateId===ref.dateId&&sheet.slot===ref.slot)){sheet.originalHtml=html;sheet.revision=controller.engine.revision;patch(q('[data-sheet-rich]'));updateSheetControls();}
 q('#agenda').querySelectorAll('[data-task-source]').forEach(button=>{if(button.dataset.taskSource===ref.source&&(ref.source==='global'||button.dataset.dateId===ref.dateId&&button.dataset.slot===ref.slot))patch(button);});
 const count=taskItems(state.globalTaskData).filter(t=>t.state!==2).length;q('#task-count').textContent=count?String(count):'';
}
async function setTask(index,target){
 try{
  if(taskItems(sheet.originalHtml)[index]?.state===target)return;
  const ref={...sheet,badgeIndex:index};const result=changeTask(state,ref,target,controller.engine.revision);
  await controller.save(result.state,{defer:true});state=result.state;patchTaskViews(ref);
  undo={change:result.undo,revision:controller.engine.revision};q('#toast').hidden=false;clearTimeout(undoTimer);undoTimer=setTimeout(()=>{undo=null;q('#toast').hidden=true},8000);
 }catch(e){ui.tell(e.message);closeSheet();ui.open()}
}
q('#undo-task').onclick=async()=>{
 try{
  if(!undo||undo.revision!==controller.engine.revision)throw new Error('別の変更があるため取り消せません。');
  const change=undo.change;const next=undoTask(state,change);await controller.save(next,{defer:true});state=next;undo=null;q('#toast').hidden=true;patchTaskViews(change);
 }catch(e){ui.tell(e.message);ui.open()}
};
function closeSheet(){if(history.state?.taskkanriSheet)history.back();else if(dialog.open)dialog.close();}
q('#close-sheet').onclick=closeSheet;dialog.addEventListener('cancel',e=>{e.preventDefault();closeSheet()});window.addEventListener('popstate',()=>{if(dialog.open)dialog.close()});dialog.addEventListener('close',()=>{document.body.append(q('#toast'));sheet=null;opener?.isConnected?opener.focus():q('#agenda').focus();void controller.refresh()});
renderCalendar();controller.start().catch(e=>{q('#sync-status').textContent=e.message;ui.tell(e.message)});
