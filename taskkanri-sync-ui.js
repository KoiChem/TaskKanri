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
 quarantineButton.onclick=()=>run(()=>downloadJson(controller.engine.quarantined||controller.engine.store.read('quarantine'),exportFilename('received')));
 document.body.append(dialog);let opener;
 const q=s=>dialog.querySelector(s);const tell=message=>q('[data-message]').textContent=message;
 const serialized=state=>{const result=serializePayload(state);if(!result.ok)throw new Error(result.error);return result.value};
 const run=async(fn)=>{try{await fn();update()}catch(e){tell(e.message)}};
 q('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>opener?.focus());
 q('form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;const email=f.email.value;const password=f.password.value;f.password.value='';void run(()=>controller.login(email,password));};
 q('[data-backup]').onclick=()=>run(()=>downloadJson(serialized(getInitialState())));
 q('[data-initialize]').onclick=()=>run(async()=>{const state=getInitialState();const check=serialized(state);if(!confirm('この端末の予定・共通タスクで同期を開始しますか？\n先に「データを書き出す」でバックアップできます。'))return;localStorage.setItem('TASKKANRI_PRE_SYNC_BACKUP:'+controller.user.id,JSON.stringify(check));await controller.initialize(state)});
 q('[data-draft]').onclick=()=>run(()=>downloadJson({app:'TaskKanri',exportedAt:new Date().toISOString(),pending:controller.engine?.pending},exportFilename('unsent')));
 q('[data-reload]').onclick=()=>run(async()=>{if(controller.engine?.pending){downloadJson({app:'TaskKanri',pending:controller.engine.pending},exportFilename('unsent'));if(!confirm('未送信データを書き出しました。クラウドの最新データを読み込みますか？'))return;}await controller.engine?.discardPending()});
 q('[data-refresh]').onclick=()=>run(()=>controller.refresh());q('[data-logout]').onclick=()=>run(async()=>{if(controller.engine?.pending&&!confirm('未送信の変更をこの端末に保持してログアウトしますか？'))return;await controller.logout()});
 function update(){const e=controller.engine;q('form').hidden=!!controller.user;q('[data-actions]').hidden=!controller.user;q('[data-account]').textContent=controller.user?.email||'';
 quarantineButton.hidden=!e?.quarantined;
 q('[data-initialize]').hidden=mobile||e?.status!=='empty';q('[data-backup]').hidden=mobile;q('[data-draft]').hidden=!e?.pending;q('[data-reload]').hidden=!e?.pending && !['blocked','conflict'].includes(e?.status);
 q('[data-summary]').textContent=!mobile&&e?.status==='empty'?formatStateSummary(summarizeState(getInitialState())):'';
 if(e?.error)tell(e.error);
 }
 return {open(event){opener=event?.currentTarget||document.activeElement;update();if(!dialog.open)dialog.showModal()},update,tell,dialog};
}
