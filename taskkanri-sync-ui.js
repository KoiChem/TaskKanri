import {serializePayload,formatStateSummary,summarizeState} from './taskkanri-core.mjs';
export function exportFilename(identifier='',date=new Date()) {
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'2-digit',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const value=type=>parts.find(part=>part.type===type).value;
 return `${value('year')}${value('month')}${value('day')}${identifier?'_'+identifier:''}_TaskKanri.json`;
}
export function downloadJson(data,name=exportFilename()) {const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function installSyncUI(controller,{mobile=false,getInitialState,onLocalReset=()=>{}}={}) {
 const dialog=document.createElement('dialog');dialog.className='sync-dialog';dialog.setAttribute('aria-label','同期設定');
 dialog.innerHTML='<div class="sync-heading"><h2>同期設定</h2><button type="button" data-close>閉じる</button></div><p data-message role="status"></p><p data-account></p><form><label>メールアドレス<input name="email" type="email" autocomplete="username" required></label><label>パスワード<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">ログイン</button></form><div data-actions><p data-summary></p><button type="button" data-backup>データを書き出す</button><button type="button" data-initialize>このデータで同期を開始</button><button type="button" data-draft>未送信データを書き出す</button><button type="button" data-reload>最新データを読み込む</button><button type="button" data-refresh>更新</button><button type="button" data-logout>ログアウト</button></div><p><a href="'+(mobile?'index.html':'mobile.html')+'">'+(mobile?'PC版を開く':'モバイル表示')+'</a></p>';
 const quarantineButton=document.createElement('button');quarantineButton.type='button';quarantineButton.textContent='受信データを書き出す';quarantineButton.hidden=true;dialog.querySelector('[data-actions]').append(quarantineButton);
 quarantineButton.onclick=()=>run(quarantineButton,'書き出しています…',()=>downloadJson(controller.engine.quarantined||controller.engine.store.read('quarantine'),exportFilename('received')),'ダウンロードを開始しました。');
 document.body.append(dialog);let opener;
 const q=s=>dialog.querySelector(s);const tell=message=>q('[data-message]').textContent=message;
 const serialized=state=>{const result=serializePayload(state);if(!result.ok)throw new Error(result.error);return result.value};
 let busy=false;
 const failureMessages={offline:'通信できませんでした。変更は端末に保持しています。接続を確認して「更新」を押してください。',conflict:'別の端末の変更と競合しています。未送信データを書き出してから、最新データを確認してください。',blocked:'同期を停止しています。表示された理由を確認してください。',empty:'同期データがありません。PC版で同期を開始してください。',deferred:'編集中のため、変更の反映を待っています。入力を終えてから更新してください。',pending:'変更を端末に保持しました。同期完了を待ってから更新してください。',saving:'保存中です。少し待ってから更新してください。',stopped:'ログインしてから操作してください。'};
 const run=async(button,progress,fn,success)=>{
  if(busy)return;busy=true;
  const label=button.textContent;button.textContent=progress;dialog.setAttribute('aria-busy','true');tell(progress);update();
  try{
   const result=await fn();
   if(result?.cancelled){tell('キャンセルしました。');return;}
   if(result?.error||result?.status&&!['saved','duplicate','synced'].includes(result.status)) {
    const reason=result.error?.message||controller.engine?.error;
    tell([failureMessages[result.status]||failureMessages[controller.engine?.status]||'処理を完了できませんでした。',reason].filter(Boolean).join('\n'));return;
   }
   tell(typeof success==='function'?success(result):success);
  }catch(e){tell('処理できませんでした。\n'+e.message);}
  finally{busy=false;button.textContent=label;dialog.removeAttribute('aria-busy');update();}
 };
 q('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>opener?.focus());
 q('form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;const email=f.email.value;const password=f.password.value;f.password.value='';void run(q('form button'),'ログイン中…',()=>controller.login(email,password),'ログインしました。');};
 q('[data-backup]').onclick=()=>run(q('[data-backup]'),'書き出しています…',()=>downloadJson(serialized(getInitialState())),'ダウンロードを開始しました。');
 q('[data-initialize]').onclick=()=>run(q('[data-initialize]'),'同期を開始しています…',async()=>{const state=getInitialState();const check=serialized(state);if(!confirm('この端末の予定・共通タスクで同期を開始しますか？\n先に「データを書き出す」でバックアップできます。'))return {cancelled:true};localStorage.setItem('TASKKANRI_PRE_SYNC_BACKUP:'+controller.user.id,JSON.stringify(check));return controller.initialize(state)},'初回同期が完了しました。');
 q('[data-draft]').onclick=()=>run(q('[data-draft]'),'書き出しています…',()=>downloadJson({app:'TaskKanri',exportedAt:new Date().toISOString(),pending:controller.engine?.pending},exportFilename('unsent')),'ダウンロードを開始しました。');
 q('[data-reload]').onclick=()=>run(q('[data-reload]'),'読み込み中…',async()=>{if(controller.engine?.pending){downloadJson({app:'TaskKanri',pending:controller.engine.pending},exportFilename('unsent'));if(!confirm('未送信データを書き出しました。クラウドの最新データを読み込みますか？'))return {cancelled:true};}await controller.engine?.discardPending();return {status:controller.engine?.status||'stopped'}},'最新データを読み込みました。');
 q('[data-refresh]').onclick=()=>run(q('[data-refresh]'),'確認中…',()=>controller.refresh(),result=>result?.changed?'変更を取得しました。':'最新の状態です。');
 q('[data-logout]').onclick=()=>run(q('[data-logout]'),'ログアウト中…',async()=>{if(controller.engine?.pending&&!confirm('未送信の変更をこの端末に保持してログアウトしますか？'))return {cancelled:true};await controller.logout()},'ログアウトしました。');
 function update(){const e=controller.engine;q('form').hidden=!!controller.user;q('[data-actions]').hidden=!controller.user;q('[data-account]').textContent=controller.user?.email||'';
 quarantineButton.hidden=!e?.quarantined;
 q('[data-initialize]').hidden=mobile||e?.status!=='empty';q('[data-backup]').hidden=mobile;q('[data-draft]').hidden=!e?.pending;q('[data-reload]').hidden=!e?.pending && !['blocked','conflict'].includes(e?.status);
 q('[data-summary]').textContent=!mobile&&e?.status==='empty'?formatStateSummary(summarizeState(getInitialState())):'';
 dialog.querySelectorAll('form input,form button,[data-actions] button').forEach(button=>button.disabled=busy);
 if(!busy&&e?.error&&!q('[data-message]').textContent)tell(e.error);
 }
 return {open(event){opener=event?.currentTarget||document.activeElement;update();if(!dialog.open)dialog.showModal()},update,tell,dialog};
}
