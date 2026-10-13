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
