import {installOutsideDismiss,mobileSyncLabel,centerCalendarPeriod} from './mobile-ui.mjs';
import {scheduleCells,calendarPages} from './mobile-model.mjs';
import {APP_CONFIG,defaultState,sanitizeHtml,stripHtml,getResolvedSlot,getDateSchedulePolicy,academicYearBounds,getHolidayName} from './taskkanri-core.mjs';
import {taskItems,changeTask,undoTask,slotTime,tokyoToday,calendarDays,addDays,hasAgenda,TASK_LABELS,samePayload,toPayload} from './taskkanri-sync-model.mjs';
import {SyncController} from './taskkanri-sync.js';
import {installSyncUI} from './taskkanri-sync-ui.js';
const standalone=window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;document.documentElement.classList.toggle('standalone',standalone);
const headerObserver=new ResizeObserver(entries=>document.documentElement.style.setProperty('--mobile-header-height',`${entries[0].target.getBoundingClientRect().height}px`));headerObserver.observe(document.querySelector('.mobile-header'));
const q=s=>document.querySelector(s);const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e};
let state=defaultState(),loaded=false,selected=tokyoToday(),period=selected,tab='agenda',week=localStorage.getItem('TASKKANRI_MOBILE_WEEK')==='true',sheet=null,undo=null,undoTimer=null,opener=null;
let calendarKey='',calendarScrollFrame=0;
const scroll={agenda:0,global:0};const dialog=q('#task-sheet');
const controller=new SyncController({mode:'mobile',getState:()=>state,canApply:()=>!dialog.open,
 onAccount:user=>{q('#event-sheet').close();q('#event-text').textContent='';q('#event-date').textContent='';q('#selected-event').disabled=true;loaded=false;state=defaultState();sheet=null;undo=null;if(dialog.open)dialog.close();q('#toast').hidden=true;q('#agenda').replaceChildren(el('p',user?'読み込み中…':'同期設定からログインしてください。'));q('#calendar-days').replaceChildren();calendarKey='';q('#selected-event').replaceChildren();updateCalendarButtons();if(!user){const login=el('button','ログイン');login.type='button';login.onclick=e=>ui.open(e);q('#agenda').append(login)}},
 onData:(next,doc)=>{
  const first=!loaded;const same=loaded&&samePayload(toPayload(next),toPayload(state));
  state=next;loaded=true;
  const bounds=academicYearBounds(state.currentYear);if(selected<bounds.start||selected>bounds.end)selected=tokyoToday()>=bounds.start&&tokyoToday()<=bounds.end?tokyoToday():bounds.start;
  if(first)period=selected;
  if(sheet){sheet.revision=doc.revision;sheet.originalHtml=sanitizeHtml(sheet.source==='global'?state.globalTaskData:getResolvedSlot(sheet.dateId,sheet.slot,state));}
  if(same){if(undo)undo.revision=doc.revision;updateSheetControls();return;}
  undo=null;q('#toast').hidden=true;render();if(dialog.open&&sheet)renderSheet();
 },
 onStatus:(text,engine)=>{setSyncStatus(text,engine);ui?.update();if(engine?.status==='empty')q('#agenda').replaceChildren(el('p','PC版で同期を開始してください。'));if(dialog.open&&sheet){if(['synced','pending','saving'].includes(engine?.status)){sheet.revision=engine.revision;if(undo)undo.revision=engine.revision;}updateSheetControls();}}

});
let ui=installSyncUI(controller,{mobile:true});q('#menu').onclick=e=>ui.open(e);q('#start-login').onclick=e=>ui.open(e);
q('#selected-event').onclick=()=>{q('#event-date').textContent=q('#selected-date').textContent;q('#event-text').textContent=stripHtml(state.configEvents[selected]||'');q('#event-sheet').showModal()};
q('#close-event').onclick=()=>q('#event-sheet').close();
installOutsideDismiss(q('#event-sheet'),()=>q('#event-sheet').close());
installOutsideDismiss(dialog,closeSheet);
function setSyncStatus(text,engine){const status=q('#sync-status');status.textContent=mobileSyncLabel(text,engine);status.title=text;status.setAttribute('aria-label',text);}
function rich(html){const e=el('div');e.className='rich-text';e.innerHTML=sanitizeHtml(html);return e}
function render(){q('#selected-date').textContent=`${Number(selected.slice(5,7))}月${Number(selected.slice(8))}日（${APP_CONFIG.daysStr[new Date(selected+'T00:00:00Z').getUTCDay()]}）`;const event=q('#selected-event');const eventText=stripHtml(state.configEvents[selected]||'');event.replaceChildren();if(eventText)event.append(el('span',eventText));event.disabled=!eventText;renderContent();renderCalendar();}
function renderContent(){if(!loaded)return;const area=q('#agenda');const previous=area.scrollTop;area.replaceChildren();q('#agenda-tab').setAttribute('aria-pressed',String(tab==='agenda'));q('#global-tab').setAttribute('aria-pressed',String(tab==='global'));
 if(tab==='global'){
  if(!stripHtml(state.globalTaskData).trim())area.append(el('p','共通タスクはありません。'));
  else{const button=el('button');button.type='button';button.className='common-card';button.dataset.taskSource='global';button.setAttribute('aria-label','共通タスクの詳細を開く');button.append(rich(state.globalTaskData));button.onclick=e=>openSheet({source:'global'},e.currentTarget);area.append(button)}
 }else{
  const policy=getDateSchedulePolicy(selected,state);const meta=[stripHtml(getHolidayName(selected,state)||''),policy.isFixedOffActive?'固定休業日':({short:'短縮時程','short-am':'短縮AM',morning:'午前時程',exam:'定期考査','mock-exam':'模擬試験','noclass-hide':'授業なし','noclass-show':'授業なし'})[policy.profile]].filter(Boolean);
  if(meta.length){const header=el('div',meta.join('\n'));header.className='day-meta';header.style.whiteSpace='pre-line';area.append(header)}
  const grid=el('div');grid.className='schedule-grid';area.append(grid);
  for(const {slot,column,row:position} of scheduleCells(selected,state)){const row=el('div');row.className='slot-card';row.style.gridColumn=column;row.style.gridRow=position;const label=el('div',slotTime(selected,slot,state));label.className='slot-time';label.append(el('span',slot));const html=getResolvedSlot(selected,slot,state);const button=el('button');button.type='button';button.className='slot-content';button.dataset.taskSource='slot';button.dataset.dateId=selected;button.dataset.slot=slot;button.setAttribute('aria-label',`${slot}の詳細を開く`);if(stripHtml(html).trim())button.append(rich(html));else{const empty=el('span','予定なし');empty.className='placeholder';button.append(empty)}button.onclick=e=>openSheet({source:'slot',dateId:selected,slot},e.currentTarget);row.append(label,button);grid.append(row)}
  if(!grid.childElementCount)area.append(el('p','表示する予定はありません。'));
 }area.scrollTop=previous;}
function calendarTitle(id){
 if(!week)return `${id.slice(0,4)}年${Number(id.slice(5,7))}月`;
 const end=addDays(id,6);return `${Number(id.slice(5,7))}/${Number(id.slice(8))}〜${Number(end.slice(5,7))}/${Number(end.slice(8))}`;
}
function updateCalendarTitle(){q('#calendar-title').textContent=calendarTitle(period);}
function renderCalendar(){
 q('#calendar-mode').textContent=week?'月表示':'週表示';
 q('#previous').setAttribute('aria-label',week?'前週':'前月');q('#next').setAttribute('aria-label',week?'翌週':'翌月');
 document.body.classList.toggle('week-view',week);
 const container=q('#calendar-days');if(!loaded)return;
 const key=`${state.currentYear}:${week}`,bounds=academicYearBounds(state.currentYear),today=tokyoToday();
 const rebuild=calendarKey!==key;
 if(rebuild){
  calendarKey=key;container.replaceChildren();
  for(const page of calendarPages(state.currentYear,week)){
   const section=el('section');section.className='calendar-page';section.dataset.period=page.id;section.setAttribute('aria-label',calendarTitle(page.id));
   const grid=el('div');grid.className='calendar-grid';
   for(const id of page.days){
    if(!id){const blank=el('span');blank.setAttribute('aria-hidden','true');grid.append(blank);continue}
    const b=el('button',String(Number(id.slice(8))));b.type='button';b.className='date-button';b.dataset.date=id;b.disabled=id<bounds.start||id>bounds.end;
    b.onclick=()=>{const changed=selected!==id;selected=id;tab='agenda';if(changed)scroll.agenda=0;render();q('#agenda').scrollTop=scroll.agenda};grid.append(b);
   }
   section.append(grid);container.append(section);
  }
 }
 for(const b of container.querySelectorAll('[data-date]')){
  const id=b.dataset.date;b.classList.toggle('today',id===today);b.classList.toggle('holiday',!!getHolidayName(id,state));
  b.setAttribute('aria-pressed',String(id===selected));b.setAttribute('aria-label',`${id}${id===today?' 今日':''}${id===selected?' 選択中':''}`);
  let dot=b.querySelector('.event-dot');if(hasAgenda(id,state)){if(!dot){dot=el('span');dot.className='event-dot';dot.setAttribute('aria-hidden','true');b.append(dot)}}else dot?.remove();
 }
 if(rebuild)scrollCalendarTo(selected);
 updateCalendarTitle();updateCalendarButtons();
}
function pageForDate(id){const target=week?calendarDays(id,true)[0]:id.slice(0,7)+'-01';return q('#calendar-days').querySelector(`[data-period="${target}"]`)}
function scrollCalendarTo(id){
 const page=pageForDate(id);if(!page)return;
 const container=q('#calendar-days');period=page.dataset.period;
 container.scrollTo({left:week?page.offsetLeft:0,top:week?0:page.offsetTop,behavior:'instant'});
 updateCalendarTitle();updateCalendarButtons();
}
function updateCalendarButtons(){
 const pages=[...q('#calendar-days').children],index=pages.findIndex(page=>page.dataset.period===period);
 q('#previous').disabled=!loaded||index<=0;q('#next').disabled=!loaded||index<0||index===pages.length-1;q('#today').disabled=!loaded;
}
q('#calendar-days').addEventListener('scroll',()=>{
 cancelAnimationFrame(calendarScrollFrame);calendarScrollFrame=requestAnimationFrame(()=>{
  const container=q('#calendar-days'),position=week?container.scrollLeft:container.scrollTop;
  const pages=[...container.children];
  const visible=week?pages.reduce((best,item)=>Math.abs(item.offsetLeft-position)<Math.abs(best.offsetLeft-position)?item:best,pages[0])?.dataset.period:centerCalendarPeriod(pages.map(item=>({id:item.dataset.period,start:item.offsetTop,end:item.offsetTop+item.offsetHeight})),position,container.clientHeight);
  if(visible&&period!==visible){period=visible;updateCalendarTitle();updateCalendarButtons()}
 });
});
function shift(n){const pages=[...q('#calendar-days').children],index=pages.findIndex(page=>page.dataset.period===period);const target=pages[index+n];if(target)scrollCalendarTo(target.dataset.period)}
q('#previous').onclick=()=>shift(-1);q('#next').onclick=()=>shift(1);
q('#calendar-mode').onclick=()=>{week=!week;localStorage.setItem('TASKKANRI_MOBILE_WEEK',String(week));renderCalendar()};
q('#today').onclick=()=>{if(!loaded)return;const today=tokyoToday(),bounds=academicYearBounds(state.currentYear);if(today<bounds.start||today>bounds.end){ui.tell('今日は表示中の年度外です。PC版で年度を切り替えてください。');ui.open();return}selected=today;tab='agenda';scroll.agenda=0;render();scrollCalendarTo(today);q('#agenda').scrollTop=0};
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
renderCalendar();controller.start().catch(e=>{setSyncStatus(e.message,controller.engine);ui.tell(e.message)});
