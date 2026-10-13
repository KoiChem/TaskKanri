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
