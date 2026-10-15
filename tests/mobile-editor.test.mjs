import {test} from 'node:test';import assert from 'node:assert/strict';
import {defaultState} from '../taskkanri-core.mjs';
import * as editor from '../mobile-editor-model.mjs';
const storage=()=>{const entries=new Map();return {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)}};
test('common-task save changes only its field and preserves current schedules and task formatting',()=>{
 const state=defaultState();state.globalTaskData='<b>共通</b>';state.configEvents['2026-10-14']='最新行事';
 const next=editor.prepareGlobalSave(state,'<b>共通</b>','<b>編集</b><span class="todo-badge state-2" data-state="2">済</span> 確認<script>evil</script>');
 assert.equal(next.configEvents['2026-10-14'],'最新行事');assert.equal(state.globalTaskData,'<b>共通</b>');
 assert.match(next.globalTaskData,/data-state="2"/);assert.match(next.globalTaskData,/<b>編集<\/b>/);assert.equal(next.globalTaskData.includes('evil'),false);
 state.globalTaskData='別端末';assert.throws(()=>editor.prepareGlobalSave(state,'<b>共通</b>','下書き'),/更新/);
});
test('drafts are scoped to account, survive reload, and an old save cannot remove a newer draft',()=>{
 const s=storage(),a=editor.globalDraftStore(s,'a'),b=editor.globalDraftStore(s,'b');
 const draft={id:'first',originalHtml:'元',html:'下書き'};a.write(draft);assert.equal(b.read(),null);assert.equal(editor.globalDraftStore(s,'a').read().html,'下書き');
 a.write({...draft,id:'second',html:'新しい下書き'});a.clearIfUnchanged(draft);assert.equal(a.read().html,'新しい下書き');
 a.clearIfUnchanged(a.read());assert.equal(a.read(),null);
});
test('draft storage failure never silently succeeds or deletes the current draft',()=>{
 const s=storage(),a=editor.globalDraftStore(s,'a');a.write({id:'1',originalHtml:'元',html:'下書き'});s.setItem=()=>{throw Error('quota')};
 assert.throws(()=>a.write({id:'2',originalHtml:'元',html:'新版'}),/quota/);assert.equal(a.read().html,'下書き');
});
test('slot save preserves rich tasks and other fields, rejects stale or invalid targets',()=>{
 const state=defaultState(2026);state.dateSchedules['2026-10-15']={'１限':'元','２限':'隣'};state.globalTaskData='共通';
 const next=editor.prepareSlotSave(state,'2026-10-15','１限','元','<b>教材</b><br><span class="todo-badge state-3" data-state="3">急</span> 配布<script>evil</script>');
 assert.equal(next.dateSchedules['2026-10-15']['２限'],'隣');assert.equal(next.globalTaskData,'共通');assert.equal(state.dateSchedules['2026-10-15']['１限'],'元');
 assert.match(next.dateSchedules['2026-10-15']['１限'],/<b>教材<\/b><br>/);assert.match(next.dateSchedules['2026-10-15']['１限'],/data-state="3"/);assert.doesNotMatch(next.dateSchedules['2026-10-15']['１限'],/evil/);
 assert.throws(()=>editor.prepareSlotSave(state,'2026-10-15','１限','古い本文','下書き'),/更新/);
 assert.throws(()=>editor.prepareSlotSave(state,'2027-04-01','１限','','下書き'),/年度/);
 assert.throws(()=>editor.prepareSlotSave(state,'2026-10-15','不正','','下書き'),/枠/);
 assert.equal(editor.prepareSlotSave(state,'2026-10-16','朝','','追加').dateSchedules['2026-10-16']['朝'],'追加');
});
test('slot drafts are isolated by account, date and slot and preserve newer edits',()=>{
 const s=storage(),a=editor.slotDraftStore(s,'a','2026-10-15','１限'),draft={id:'1',originalHtml:'元',html:'下書き'};
 a.write(draft);assert.equal(editor.slotDraftStore(s,'a','2026-10-15','１限').read().html,'下書き');
 assert.equal(editor.slotDraftStore(s,'b','2026-10-15','１限').read(),null);assert.equal(editor.slotDraftStore(s,'a','2026-10-16','１限').read(),null);assert.equal(editor.slotDraftStore(s,'a','2026-10-15','２限').read(),null);
 a.write({...draft,id:'2',html:'新しい下書き'});a.clearIfUnchanged(draft);assert.equal(a.read().html,'新しい下書き');a.clearIfUnchanged(a.read());assert.equal(a.read(),null);
 a.write(draft);s.setItem=()=>{throw Error('quota')};assert.throws(()=>a.write({...draft,html:'保存不可'}),/quota/);assert.equal(a.read().html,'下書き');
});
test('event edits preserve other data, reject stale changes, and allow clearing',()=>{
 const state=defaultState(2026);state.configEvents['2026-10-15']='会議';state.globalTaskData='共通';
 const next=editor.prepareEventSave(state,'2026-10-15','会議','<b>研修</b><script>bad</script>');
 assert.equal(next.configEvents['2026-10-15'],'<b>研修</b>');assert.equal(next.globalTaskData,'共通');assert.equal(state.configEvents['2026-10-15'],'会議');
 assert.throws(()=>editor.prepareEventSave(state,'2026-10-15','古い行事','編集'),/更新/);
 assert.throws(()=>editor.prepareEventSave(state,'2027-04-01','','編集'),/年度/);
 assert.equal(editor.prepareEventSave(state,'2026-10-15','会議','<br>').configEvents['2026-10-15'],undefined);
 const s=storage();editor.eventDraftStore(s,'a','2026-10-15').write({id:'1',html:'下書き',originalHtml:'会議'});
 assert.equal(editor.eventDraftStore(s,'a','2026-10-16').read(),null);assert.equal(editor.eventDraftStore(s,'b','2026-10-15').read(),null);
});
