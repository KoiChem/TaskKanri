import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../mobile-ui.mjs';

test('compact sync reports timestamp only when synced and keeps problems visible',()=>{
 assert.equal(ui.mobileSyncLabel('同期済み 16:20',{status:'synced',updatedAt:'2026-10-13T07:20:00Z'}),'16:20同期');
 for(const [status,label] of [['saving','保存中'],['pending','未送信'],['offline','オフライン'],['conflict','競合'],['blocked','同期停止']])assert.equal(ui.mobileSyncLabel('詳しい情報',{status}),label);
 assert.equal(ui.mobileSyncLabel('未接続',null),'未接続');
});
test('month title follows the center, including the last partial month viewport',()=>{
 const pages=[{id:'04',start:0,end:220},{id:'05',start:220,end:484},{id:'06',start:484,end:704}];
 assert.equal(ui.centerCalendarPeriod(pages,80,292),'05');
 assert.equal(ui.centerCalendarPeriod(pages,412,292),'06');
});
test('outside tap closes, inside and dragged gestures do not close',()=>{
 const dialog=new EventTarget();dialog.getBoundingClientRect=()=>({left:20,right:120,top:100,bottom:200});dialog.open=true;
 let closed=0;ui.installOutsideDismiss(dialog,()=>closed++);
 const send=(type,x,y)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:x,clientY:y,pointerId:1,button:0});dialog.dispatchEvent(event);return event};
 send('pointerdown',10,50);send('pointerup',10,50);assert.equal(send('click',10,50).defaultPrevented,true);assert.equal(closed,1);
 send('pointerdown',50,150);send('pointerup',50,150);send('click',50,150);assert.equal(closed,1);
 send('pointerdown',10,50);send('pointerup',10,80);send('click',10,80);assert.equal(closed,1);
 send('pointerdown',50,150);send('pointerup',10,50);send('click',10,50);assert.equal(closed,1);
 send('pointerdown',10,50);send('pointermove',10,90);send('pointermove',10,50);send('pointerup',10,50);send('click',10,50);assert.equal(closed,1);
});

test('agenda swipes move one day, preserve taps and vertical scrolling, and suppress drag clicks',()=>{
 const area=new EventTarget();let enabled=true;const moves=[];
 ui.installAgendaSwipe(area,()=>enabled,step=>moves.push(step));
 const send=(type,x,y,extra={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:x,clientY:y,pointerId:1,pointerType:'touch',isPrimary:true,button:0,...extra});area.dispatchEvent(event);return event};
 send('pointerdown',120,100);send('pointermove',200,105);send('pointerup',200,105);assert.deepEqual(moves,[-1]);assert.equal(send('click',200,105).defaultPrevented,true);
 send('pointerdown',200,100);send('pointermove',120,105);send('pointerup',120,105);assert.deepEqual(moves,[-1,1]);
 send('pointerdown',120,100);send('pointermove',125,180);send('pointerup',125,180);assert.deepEqual(moves,[-1,1]);assert.equal(send('click',125,180).defaultPrevented,false);
 send('pointerdown',120,100);send('pointerup',121,100);assert.equal(send('click',121,100).defaultPrevented,false);
 send('pointerdown',120,100);send('pointermove',145,100);send('pointerup',145,100);assert.equal(send('click',145,100).defaultPrevented,true);assert.deepEqual(moves,[-1,1]);
 enabled=false;send('pointerdown',120,100);send('pointermove',200,100);send('pointerup',200,100);assert.deepEqual(moves,[-1,1]);
 enabled=true;send('pointerdown',120,100);send('pointercancel',120,100);send('pointerup',200,100);assert.deepEqual(moves,[-1,1]);
 send('pointerdown',120,100);send('pointerdown',140,100,{pointerId:2,isPrimary:false});send('pointerup',200,100);assert.deepEqual(moves,[-1,1]);
});
test('calendar reveal preserves visible dates and scrolls only the missing part',()=>{
 assert.equal(ui.calendarRevealOffset(100,224,140,184),100);
 assert.equal(ui.calendarRevealOffset(100,224,80,124),80);
 assert.equal(ui.calendarRevealOffset(100,224,320,364),140);
});

test('a second finger outside the agenda cancels the pending swipe',()=>{
 const document=new EventTarget(),area=new EventTarget();area.ownerDocument=document;const moves=[];
 ui.installAgendaSwipe(area,()=>true,step=>moves.push(step));
 const send=(target,type,x,extra={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:x,clientY:100,pointerId:1,pointerType:'touch',isPrimary:true,...extra});target.dispatchEvent(event)};
 send(area,'pointerdown',120);send(area,'pointermove',160);
 send(document,'pointerdown',200,{pointerId:2,isPrimary:false});send(area,'pointerup',240);
 assert.deepEqual(moves,[]);
});
