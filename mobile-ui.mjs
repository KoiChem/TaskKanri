export function mobileSyncLabel(text,engine){
 if(!engine)return text==='未接続'?'未接続':text==='読み込み中'?'読込中':'同期停止';
 if(engine.status==='synced'){
  const date=new Date(engine.updatedAt);
  return Number.isFinite(date.getTime())?`${date.toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})}同期`:'同期済み';
 }
 return ({loading:'読込中',empty:'未登録',pending:'未送信',saving:'保存中',offline:'オフライン',conflict:'競合',deferred:'更新待ち',blocked:'同期停止'})[engine.status]||'未接続';
}
export function centerCalendarPeriod(pages,position,size){
 const center=position+size/2;
 return (pages.find(page=>page.start<=center&&center<page.end)||pages.at(-1))?.id;
}
export function installOutsideDismiss(dialog,close){
 let target=dialog,panel=null;
 if(dialog.ownerDocument){
  const doc=dialog.ownerDocument;panel=doc.createElement('div');panel.className='mobile-dialog-panel';panel.append(...dialog.childNodes);
  target=doc.createElement('button');target.type='button';target.className='mobile-dialog-backdrop';target.tabIndex=-1;target.setAttribute('aria-label','画面を閉じる');
  dialog.classList.add('mobile-dialog');dialog.append(target,panel);
 }

 let down=null,eligible=false;
 const outside=event=>{const box=(panel||dialog).getBoundingClientRect();return event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom};
 dialog.addEventListener('pointerdown',event=>{eligible=false;down=event.button===0&&outside(event)?{id:event.pointerId,x:event.clientX,y:event.clientY}:null});
 dialog.addEventListener('pointermove',event=>{if(down&&down.id===event.pointerId&&Math.hypot(event.clientX-down.x,event.clientY-down.y)>8)down=null});
 dialog.addEventListener('pointerup',event=>{eligible=!!down&&down.id===event.pointerId&&outside(event)&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<=8;down=null});
 dialog.addEventListener('pointercancel',()=>{down=null;eligible=false});
 dialog.addEventListener('close',()=>{down=null;eligible=false});
 target.addEventListener('click',event=>{if(eligible&&dialog.open&&outside(event)){eligible=false;event.preventDefault();event.stopImmediatePropagation();close()}});
}

export function calendarRevealOffset(position,size,start,end){
 return start<position?start:end>position+size?end-size:position;
}
export function installAgendaSwipe(area,enabled,moveDay){
 let gesture=null,suppressUntil=0;
 area.ownerDocument?.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&event.isPrimary===false)gesture=null},true);
 area.addEventListener('pointerdown',event=>{
  gesture=null;suppressUntil=0;
  const width=area.ownerDocument?.defaultView?.innerWidth;
  if(!enabled()||event.pointerType!=='touch'||event.isPrimary===false||event.clientX<20||(width&&event.clientX>width-20))return;
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,horizontal:false};
 });
 area.addEventListener('pointermove',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;
  if(!enabled()){gesture=null;return}
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(!gesture.horizontal){
   if(Math.abs(dy)>=12&&Math.abs(dy)>=Math.abs(dx)){gesture=null;return}
   if(Math.abs(dx)<12||Math.abs(dx)<1.5*Math.abs(dy))return;
   gesture.horizontal=true;area.setPointerCapture?.(event.pointerId);
  }
  event.preventDefault();
 });
 area.addEventListener('pointerup',event=>{
  const current=gesture;if(!current||current.id!==event.pointerId)return;gesture=null;
  const dx=event.clientX-current.x,dy=event.clientY-current.y;
  if(current.horizontal)suppressUntil=Date.now()+500;
  if(current.horizontal&&enabled()&&Math.abs(dx)>=50&&Math.abs(dx)>=1.5*Math.abs(dy))moveDay(dx>0?-1:1);
 });
 area.addEventListener('pointercancel',()=>{gesture=null});
 area.addEventListener('click',event=>{if(Date.now()<suppressUntil){suppressUntil=0;event.preventDefault();event.stopImmediatePropagation()}},true);
}
