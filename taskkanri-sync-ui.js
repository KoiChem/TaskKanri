import {installOutsideDismiss,mobileSyncLabel} from './mobile-ui.mjs';
import {serializePayload,formatStateSummary,summarizeState,sanitizeHtml} from './taskkanri-core.mjs';
import {exportFilename,downloadJson} from './taskkanri-export.mjs';
export {exportFilename,downloadJson} from './taskkanri-export.mjs';
import {importValueText} from './taskkanri-import.mjs';
import {installDataTransfer} from './taskkanri-transfer-ui.js';
export function installSyncUI(controller,{mobile=false,getInitialState,prepareImport,saveImportedState,beforeRefresh=()=>{}}={}) {
 const dialog=document.createElement('dialog');dialog.className='sync-dialog';dialog.setAttribute('aria-label','同期とアカウント');
 dialog.innerHTML=`<div class="sync-heading"><h2>同期とアカウント</h2><button type="button" data-close>閉じる</button></div>
 <section class="sync-section"><h3>接続状態</h3><p data-state role="status"></p><p data-time></p><button type="button" data-refresh>今すぐ同期</button><span data-shortcut></span><p data-offline-info></p><button type="button" data-offline>オフラインで使う</button><button type="button" data-online hidden>オンラインに戻る</button><p data-message role="status"></p></section>
 <section class="sync-section" data-received hidden></section>
 <section class="sync-section"><h3>データの移動</h3><div class="sync-transfer-actions"><button type="button" data-backup>データを書き出す</button><button type="button" data-import>データを読み込む</button></div><p class="sync-hint">予定・タスク・設定をファイルで移動できます。</p></section>
 <section class="sync-section"><h3>アカウント</h3><p data-account></p><form><label>メールアドレス<input name="email" type="email" autocomplete="username" required></label><label>パスワード<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">ログイン</button></form><div data-actions><p data-summary></p><button type="button" data-initialize>このデータで同期を開始</button><button type="button" data-draft>未送信データを書き出す</button><button type="button" data-reload>最新データを読み込む</button><button type="button" data-logout>ログアウト</button></div></section><p><a href="${mobile?'index.html':'mobile.html'}">${mobile?'PC版を開く':'モバイル版を開く'}</a></p>`;
 const quarantineButton=document.createElement('button');quarantineButton.type='button';quarantineButton.textContent='受信データを書き出す';quarantineButton.hidden=true;dialog.querySelector('[data-actions]').append(quarantineButton);
 quarantineButton.onclick=()=>run(quarantineButton,'書き出しています…',()=>downloadJson(controller.engine.quarantined||controller.engine.store.read('quarantine'),exportFilename('received')),'ダウンロードを開始しました。');
 document.body.append(dialog);if(mobile)installOutsideDismiss(dialog,()=>dialog.close());let opener;
 const q=s=>dialog.querySelector(s);const tell=message=>q('[data-message]').textContent=message;
 const serialized=state=>{const result=serializePayload(state);if(!result.ok)throw new Error(result.error);return result.value};
 let busy=false,reportOwner=null;
 const clearReceived=()=>{q('[data-received]').replaceChildren();q('[data-received]').hidden=true;reportOwner=null;};
 function showReceived(result){
  if(mobile)return;
  clearReceived();const rows=result.receivedChanges||[];if(!rows.length)return;
  reportOwner={engine:controller.engine,userId:controller.user?.id};const section=q('[data-received]');section.hidden=false;
  const title=document.createElement('h3'),success=!result.error&&['synced','saved','duplicate'].includes(result.status);
  title.textContent=(result.initialReceived?'初回データを取得しました':`取り込んだ変更 ${rows.length}件`)+(success?'':'（同期は未完了）');section.append(title);
  const list=document.createElement('div');list.className='sync-received-list';
  for(const row of rows){
   const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${row.label}：${row.kind}`;detail.append(summary);
   const compare=document.createElement('div');compare.className='sync-received-compare';
   for(const [label,value] of [['変更前',row.before],['変更後',row.after]]){const column=document.createElement('div'),heading=document.createElement('strong'),body=document.createElement('div');heading.textContent=label;body.className='sync-received-value';
    if(value===null||value==='')body.textContent='（空欄）';else if(row.rich)body.innerHTML=sanitizeHtml(value);else body.textContent=importValueText(value,row.path[0]);column.append(heading,body);compare.append(column);
   }detail.append(compare);list.append(detail);
  }
  if(result.initialReceived){const more=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`取得した内容を確認（${rows.length}件）`;more.append(summary,list);section.append(more);}else section.append(list);
 }

 const failureMessages={offline:'通信できませんでした。変更は端末に保持しています。接続を確認して「今すぐ同期」を押してください。',conflict:'別の端末の変更と競合しています。未送信データを書き出してから、最新データを確認してください。',blocked:'同期を停止しています。表示された理由を確認してください。',empty:'同期データがありません。PC版で同期を開始してください。',deferred:'編集中のため、変更の反映を待っています。入力を終えてから同期してください。',pending:'未送信の変更を端末に保持しています。もう一度「今すぐ同期」を押してください。',saving:'保存中です。少し待ってから再試行してください。',stopped:'ログインしてから操作してください。'};
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
 q('[data-offline]').onclick=async()=>{try{await controller.enterOffline();dialog.close()}catch(error){tell(error.message)}finally{update()}};
 q('[data-online]').onclick=()=>controller.resumeOnline();
 q('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>opener?.focus());
 q('form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;const email=f.email.value;const password=f.password.value;f.password.value='';void run(q('form button'),'ログイン中…',()=>controller.login(email,password),'ログインしました。');};
 const transfer=installDataTransfer({controller,getState:getInitialState,prepareImport,saveImportedState,beforeOpen:()=>{if(dialog.open)dialog.close()},onReturn:()=>{update();if(!dialog.open)dialog.showModal()}});
 transfer.dialog.addEventListener('close',()=>{if(dialog.open)opener?.focus()});
 const openExport=event=>{dialog.close();transfer.exportMenu(event)};
 q('[data-backup]').onclick=openExport;q('[data-import]').onclick=()=>transfer.chooseImport();

 q('[data-initialize]').onclick=()=>run(q('[data-initialize]'),'同期を開始しています…',async()=>{const state=getInitialState();serialized(state);if(!confirm('この端末の予定・共通タスクで同期を開始しますか？\n先に「データを書き出す」でバックアップできます。'))return {cancelled:true};return controller.initialize(state)},'初回同期が完了しました。');
 q('[data-draft]').onclick=()=>run(q('[data-draft]'),'書き出しています…',()=>downloadJson({app:'TaskKanri',exportedAt:new Date().toISOString(),pending:controller.engine?.pending},exportFilename('unsent')),'ダウンロードを開始しました。');
 q('[data-reload]').onclick=()=>run(q('[data-reload]'),'読み込み中…',async()=>{if(controller.engine?.pending){downloadJson({app:'TaskKanri',pending:controller.engine.pending},exportFilename('unsent'));if(!confirm('未送信データを書き出しました。クラウドの最新データを読み込みますか？'))return {cancelled:true};}await controller.engine?.discardPending();return {status:controller.engine?.status||'stopped'}},'最新データを読み込みました。');
 const requestSync=async({closeOnSuccess=false}={})=>{
  if(busy)return;
  clearReceived();
  if(controller.offlineMode){tell('オフラインモードです。同期するにはオンラインに戻ってください。');if(!dialog.open)dialog.showModal();return;}
  if(controller.composing){tell('日本語の変換を確定してから同期してください。');return;}
  try{beforeRefresh();}catch(error){tell(error.message);if(!dialog.open)dialog.showModal();return;}
  if(!dialog.open){opener=document.activeElement;dialog.showModal();}
  return run(q('[data-refresh]'),'同期中…',async()=>{
    const result=await controller.refresh({manual:true});const status=result.error?result.status:controller.engine?.status||'stopped';showReceived({...result,status});if(closeOnSuccess&&status==='synced'&&!result.error&&!controller.engine?.pending&&!(result.receivedChanges?.length)&&dialog.open)dialog.close();return {...result,status};
  },mobile?result=>result?.changed?'変更を取得しました。':'最新の状態です。':result=>result?.receivedChanges?.length?(result.initialReceived?'初回データを取得しました。':`同期が完了しました。取り込んだ変更が${result.receivedChanges.length}件あります。`):'同期が完了しました。');
 };
 q('[data-refresh]').onclick=()=>requestSync();
 q('[data-shortcut]').hidden=mobile;
 q('[data-shortcut]').textContent=/Mac/.test(navigator.platform)?'⌘ + Option + S':'Ctrl + Alt + S';
 q('[data-logout]').onclick=()=>run(q('[data-logout]'),'ログアウト中…',async()=>{if(controller.engine?.pending&&!confirm('未送信の変更をこの端末に保持してログアウトしますか？'))return {cancelled:true};await controller.logout()},'ログアウトしました。');
 function update(){const e=controller.engine;
 if(reportOwner&&(reportOwner.engine!==e||reportOwner.userId!==controller.user?.id))clearReceived();
 q('[data-offline]').hidden=!!controller.offlineMode;q('[data-offline]').disabled=false;
 q('[data-online]').hidden=!controller.offlineMode;q('[data-online]').disabled=!!e?.busy;
 q('[data-offline-info]').textContent=controller.offlineMode?(controller.localOnly?'この端末専用で保存します。クラウドへは自動統合されません。必要なデータはエクスポートで保管できます。':'通信を停止しています。変更はこの端末に保存し、オンラインに戻ると同期します。'):'通信できないときは、端末に保存されたデータで利用できます。';q('form').hidden=!!controller.user;q('[data-actions]').hidden=!controller.user;q('[data-account]').textContent=controller.user?.email||'';
 quarantineButton.hidden=!e?.quarantined;
 q('[data-logout]').hidden=!!controller.offlineMode;
 q('[data-initialize]').hidden=mobile||e?.status!=='empty';q('[data-draft]').hidden=!e?.pending;q('[data-reload]').hidden=controller.offlineMode||!e?.pending && !['blocked','conflict'].includes(e?.status);
 q('[data-state]').textContent=controller.storage.pending?'端末に保存中…':mobileSyncLabel(controller.user?'読み込み中':'未接続',e);
 const timestamp=e?.lastSuccessfulSyncAt?new Date(e.lastSuccessfulSyncAt):null;
 const cloudTime=e?.updatedAt?new Date(e.updatedAt):null;
 const dateTime=date=>date&&Number.isFinite(date.getTime())?date.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false}):'';
 q('[data-time]').hidden=!!controller.offlineMode;
 q('[data-time]').textContent=[dateTime(timestamp)&&'最終同期 '+dateTime(timestamp),dateTime(cloudTime)&&'クラウド更新 '+dateTime(cloudTime)].filter(Boolean).join('\n');
 q('[data-refresh]').hidden=controller.offlineMode||!e||e.status==='empty';
 q('[data-shortcut]').hidden=mobile||q('[data-refresh]').hidden;
 q('[data-summary]').textContent=!mobile&&e?.status==='empty'?formatStateSummary(summarizeState(getInitialState())):'';
 dialog.querySelectorAll('form input,form button,[data-actions] button,[data-refresh]').forEach(button=>button.disabled=busy);
 if(!busy&&e?.error&&!q('[data-message]').textContent)tell(e.error);
 }
 return {requestSync,exportData:openExport,importFile:transfer.importFile,open(event){opener=event?.currentTarget||document.activeElement;update();if(!dialog.open)dialog.showModal()},update,tell,dialog};
}
