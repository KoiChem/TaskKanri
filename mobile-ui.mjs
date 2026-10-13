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
 let down=null,eligible=false;
 const outside=event=>{const box=dialog.getBoundingClientRect();return event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom};
 dialog.addEventListener('pointerdown',event=>{eligible=false;down=event.button===0&&outside(event)?{id:event.pointerId,x:event.clientX,y:event.clientY}:null});
 dialog.addEventListener('pointermove',event=>{if(down&&down.id===event.pointerId&&Math.hypot(event.clientX-down.x,event.clientY-down.y)>8)down=null});
 dialog.addEventListener('pointerup',event=>{eligible=!!down&&down.id===event.pointerId&&outside(event)&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<=8;down=null});
 dialog.addEventListener('pointercancel',()=>{down=null;eligible=false});
 dialog.addEventListener('close',()=>{down=null;eligible=false});
 dialog.addEventListener('click',event=>{if(eligible&&dialog.open&&outside(event)){eligible=false;event.preventDefault();event.stopImmediatePropagation();close()}});
}
