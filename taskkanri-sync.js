import {supabaseConfig} from './supabase-config.js';
import {SyncEngine} from './taskkanri-sync-engine.mjs';
import {receivedChanges,combineReceivedChanges} from './taskkanri-received-changes.mjs';
import {acquireClientId,syncStore} from './taskkanri-device-storage.mjs';
import {defaultState} from './taskkanri-core.mjs';
import {mergePayload,toPayload,samePayload} from './taskkanri-sync-model.mjs';

export function consumeDesktopStartup(storage,navigationType) {
 const seen=storage.getItem('TASKKANRI_DESKTOP_OPENED');
 storage.setItem('TASKKANRI_DESKTOP_OPENED','true');
 return !seen && navigationType==='navigate';
}
const blockedCodes=new Set(['42501','22023','PGRST202','PGRST301']);
function checked(result) {if(result.error){const e=new Error(result.error.message==='app_update_required'?'アプリを更新してください。未送信データは保持しています。':result.error.code==='42501'?'このアカウントは同期を許可されていません。':result.error.code==='PGRST202'?'Supabaseの初期設定が必要です。':result.error.message);e.upgradeRequired=result.error.message==='app_update_required';e.blocked=blockedCodes.has(result.error.code);e.permissionDenied=result.error.code==='42501';throw e}return result.data}
export function statusLabel(engine) {
 if(engine?.manualOffline)return 'オフラインモード';
 const stamp=engine?.lastSuccessfulSyncAt?new Date(engine.lastSuccessfulSyncAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'';
 return ({loading:'読み込み中',storing:'端末に保存中…',cached:'端末の保存内容',unloaded:'同期して最新データを取得',empty:'PC版で同期を開始してください',synced:`同期済み ${stamp}`,pending:'未送信の変更あり',saving:'保存中',offline:`オフライン・最終取得 ${stamp}`,conflict:'変更が競合しています',deferred:'入力を終えると最新データを表示します',blocked:'同期を停止しています'})[engine?.status]||'未接続';
}
export class SyncController {
 constructor({mode,getState,storage=globalThis.localStorage,onAccount=()=>{},onData=()=>{},onStatus=()=>{},canApply=()=>true,beforeAccountChange=()=>{}}) {
  Object.assign(this,{mode,getState,storage,onAccount,onData,onStatus,canApply,beforeAccountChange});this.engine=null;this.user=null;this.client=null;this.generation=0;this.composing=false;this.retry=0;this.networkRequests=new Set();
  this.visibility=()=>{if(document.visibilityState==='visible')void this.refresh()};
  document.addEventListener('visibilitychange',this.visibility);window.addEventListener('online',this.visibility);
  document.addEventListener('compositionstart',()=>this.composing=true);document.addEventListener('compositionend',()=>{this.composing=false;if(this.engine?.pending)this.schedule()});
  this.interval=mode==='desktop'?null:setInterval(()=>{if(document.visibilityState==='visible')void this.refresh()},15000);
 }
 async fetchOnline(input,init={}) {
  if(this.offlineMode)throw new Error('オフラインモードでは通信しません。');
  const abort=new AbortController(),source=init.signal;
  const cancel=()=>abort.abort();if(source?.aborted)cancel();else source?.addEventListener('abort',cancel,{once:true});
  this.networkRequests.add(abort);
  try{return await globalThis.fetch(input,{...init,signal:abort.signal})}
  finally{source?.removeEventListener('abort',cancel);this.networkRequests.delete(abort)}
 }
 async start() {
  // Show the saved mode immediately, while retaining the tab lock before loading edits.
  if(localStorage.getItem('TASKKANRI_OFFLINE_MODE')==='true')this.onStatus('オフラインモード');
  if(this.mode==='desktop')this.allowStartupRead=consumeDesktopStartup(sessionStorage,globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type);
  this.id=await acquireClientId(sessionStorage);
  if(localStorage.getItem('TASKKANRI_OFFLINE_MODE')==='true'){await this.enterOffline();return;}
  if(this.offlineMode)return;
  if(this.mode==='desktop'){
   let saved;try{saved=JSON.parse(localStorage.getItem('TASKKANRI_SUPABASE_AUTH'));}catch{}
   if(!saved?.user?.id){await this.enterOffline({automatic:true,account:null});return;}
   this.restoreAccount(saved.user);
  }
  await this.connectClient();
  if(this.offlineMode)return;
  const {data,error}=await this.client.auth.getSession();if(this.offlineMode)return;
  if(error){this.engine?.emit('offline',error.message);throw error;}
  await this.activate(data.session);
  window.addEventListener('pagehide',()=>this.engine?.stop(),{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
 }
 async connectClient(){
  if(this.client)return;
  const {createClient}=await import('./vendor/supabase.js');
  if(this.offlineMode)return;
  this.client=createClient(supabaseConfig.url,supabaseConfig.publishableKey,{global:{fetch:(...args)=>this.fetchOnline(...args)},auth:{storageKey:'TASKKANRI_SUPABASE_AUTH',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  this.client.auth.onAuthStateChange((event,session)=>{if(this.offlineMode)return;if(event==='SIGNED_OUT')setTimeout(()=>void this.activate(null).catch(e=>this.engine?.emit('offline',e.message)),0);else if(['SIGNED_IN','USER_UPDATED','TOKEN_REFRESHED'].includes(event) && (session?.user.id!==this.user?.id || event==='TOKEN_REFRESHED' && this.engine?.status==='blocked'))setTimeout(()=>void this.activate(session).catch(e=>this.onStatus(e.message)),0)});
 }
 restoreAccount(user) {
  this.user=user;this.authPending=true;
  this.onAccount(user);
  const store=syncStore(this.storage,user.id,this.id);
  const transport={get:async meta=>checked(await this.client.from('taskkanri_documents').select(meta?'revision,updated_at':'revision,updated_at,payload').eq('user_id',user.id).maybeSingle()),save:async req=>checked(await this.client.rpc('save_taskkanri_document',{expected_revision:req.expectedRevision,mutation_id:req.mutationId,payload:req.payload}))};
  this.engine=new SyncEngine({transport,store,canApply:this.canApply,onChange:engine=>this.onStatus(statusLabel(engine),engine),onData:(doc,context)=>this.mode==='desktop'?this.applyDocument(doc,context):this.onData(mergePayload(doc.payload,this.getState()),doc)});
  const cache=store.read('cache');if(cache)this.engine.validate(cache);
  if(this.mode==='desktop'&&cache&&!this.engine.pending&&!samePayload(toPayload(this.getState()),toPayload(mergePayload(cache.payload,this.getState())))) {
   this.engine.payload=cache.payload;this.engine.revision=cache.revision;this.engine.queue(this.getState());
  }
  this.engine.loadCached();
  this.engine.emit(this.engine.pending?'pending':this.engine.payload?'cached':'loading');
 }
 async activate(session) {
  if(this.offlineMode)return;
  if(session?.user?.id===this.user?.id&&this.engine&&!this.authPending)return;
  const valid=session&&Number.isFinite(session.expires_at)&&session.expires_at*1000>Date.now();
  if(!valid)this.needsLogin=true;
  const changing=!!this.user&&(!valid||this.user.id!==session.user.id);
  if(changing)this.beforeAccountChange();
  const generation=++this.generation;
  if(!valid){
   this.engine?.stop();this.engine=null;clearTimeout(this.sendTimer);clearTimeout(this.retryTimer);clearTimeout(this.maxTimer);this.user=null;this.onAccount(null);
   if(this.mode==='desktop')await this.enterOffline({automatic:true,account:null});else this.onStatus('未接続');return;
  }
  if(session.user.id!==this.user?.id||!this.engine){
   this.engine?.stop();if(changing)this.onAccount(null);clearTimeout(this.sendTimer);clearTimeout(this.retryTimer);clearTimeout(this.maxTimer);this.retry=0;
   this.restoreAccount(session.user);
  }
  this.authPending=false;this.connecting=true;
  const engine=this.engine,store=engine.store;
  const read=this.mode!=='desktop'||this.allowStartupRead&&!engine.pending;this.allowStartupRead=false;
  // Both endpoints enforce authorization; apply the document only after the explicit check succeeds.
  const [permission,document]=await Promise.allSettled([
   this.client.rpc('taskkanri_is_allowed').then(checked),
   read?engine.transport.get(false):Promise.resolve(undefined)
  ]);
  if(generation!==this.generation||engine!==this.engine||this.offlineMode)return;
  try {
   if(permission.status==='rejected')throw permission.reason;
   if(!permission.value){const error=new Error('このアカウントは同期を許可されていません。');error.blocked=true;throw error;}
   this.needsLogin=false;store.write('permission',{userId:session.user.id});
   localStorage.setItem('TASKKANRI_LAST_ACCOUNT',JSON.stringify({id:this.user.id,email:this.user.email}));
   if(document.status==='rejected')throw document.reason;
   if(read)await engine.load({remote:document.value,restoreCache:false,deferApply:this.mode==='desktop'});
   else engine.emit(engine.pending?'pending':engine.payload?'cached':'unloaded');
   if(this.storage.flush)await this.storage.flush();
   if(engine===this.engine&&engine.pending&&engine.status!=='conflict')this.schedule();
  }catch(error){
   if(engine!==this.engine||this.offlineMode)return;
   if(error.blocked)store.remove('permission');
   engine.emit(error.blocked?'blocked':'offline',error.message);throw error;
  }finally{if(engine===this.engine){this.connecting=false;this.onStatus(statusLabel(engine),engine);}}
 }
 dirty(state) {
  const engine=this.engine;if(!engine||!engine.payload&&!engine.pending)return;
  const latest=engine.pending?.nextPayload||engine.pending?.request.payload||engine.payload;
  if(samePayload(toPayload(state),latest))return;
  if(this.offlineMode&&this.localOnly){engine.queue(state,{offline:true});void engine.flush();return;}
  engine.queue(state,{offline:!!this.offlineMode,initial:!engine.payload&&!!engine.pending});if(!this.offlineMode)this.schedule();
 }
 schedule() {
  if(this.offlineMode||this.mode==='desktop')return;
  clearTimeout(this.sendTimer);this.sendTimer=setTimeout(()=>{if(this.composing){this.schedule();return;}void this.flush()},800);
  if(!this.maxTimer)this.maxTimer=setTimeout(()=>{this.maxTimer=null;if(!this.composing)void this.flush()},5000);
 }
 async flush(options) {
  if(this.offlineMode)return {status:'pending'};
  if(this.composing)return {status:'pending'};
  clearTimeout(this.sendTimer);clearTimeout(this.maxTimer);this.maxTimer=null;
  const engine=this.engine;if(!engine||this.authPending||this.connecting)return {status:'stopped'};
  const result=await engine.flush(options);if(engine!==this.engine)return {status:'stopped'};
  if(result.error?.permissionDenied){await this.activate(null);this.onStatus(result.error.message);return result;}
  if(this.mode!=='desktop'&&result.status==='error'&&!result.error.blocked){const delay=[2000,5000,15000][this.retry++]||60000;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{if(document.visibilityState==='visible')void this.flush()},delay);}
  else if(result.status==='saved'||result.status==='duplicate'){this.retry=0;if(engine.pending)this.schedule();}
  return result;
 }
 applyDocument(doc,context){
  const before=this.mode==='desktop'&&this.receivedSync?structuredClone(this.getState()):null;
  this.onData(mergePayload(doc.payload,this.getState()),doc);
  const report=this.receivedSync;
  if(before&&context?.source!=='cache'&&report?.engine===this.engine&&report.userId===this.user?.id)report.groups.push(receivedChanges(before,this.getState()));
 }
 async refresh({manual=false}={}){
  if(this.mode==='desktop'&&!manual)return {status:this.engine?.status||'stopped'};
  if(this.offlineMode)return {status:'synced'};
  if(this.connecting)return {status:'stopped',error:new Error('接続確認が終わってから同期してください。')};
  if(!this.engine)return {status:'stopped',error:new Error('ログインしてから更新してください。')};
  const engine=this.engine;const before=engine.revision;
  const report=this.mode==='desktop'?{engine,userId:this.user?.id,groups:[],initial:!engine.payload&&!engine.store.read('cache')}:null;
  this.receivedSync=report;
  const resultReport=()=>report?{receivedChanges:combineReceivedChanges(report.groups),initialReceived:report.initial}:{};
  try{
   const {data,error}=await this.client.auth.getSession();if(this.offlineMode||engine!==this.engine)return {status:'stopped'};if(error)throw error;
   if(!data.session||data.session.expires_at*1000<=Date.now()){await this.activate(null);return {status:'stopped',error:new Error('ログインし直してください。')};}
   if(data.session.user.id!==this.user?.id){await this.activate(data.session);return {status:this.engine?.status||'stopped'};}
   if(!checked(await this.client.rpc('taskkanri_is_allowed'))){const e=new Error('このアカウントは同期を許可されていません。');e.permissionDenied=true;throw e;}
   if(engine!==this.engine)return {status:'stopped'};
   this.authPending=false;
   if(engine.pending && !['conflict','blocked'].includes(engine.status))await this.flush();else if(!engine.payload)await engine.load();else await engine.refresh();
   return {status:engine.status,changed:engine.revision!==before,error:engine.error?new Error(engine.error):undefined,...resultReport()};
  }catch(e){
   if(engine!==this.engine)return {status:'stopped',error:e};
   if(e.permissionDenied){await this.activate(null);this.onStatus(e.message);}else engine.emit(e.blocked?'blocked':'offline',e.message);
   return {status:'error',error:e,...resultReport()};
  }finally{if(this.receivedSync===report)this.receivedSync=null;}
 }
 async login(email,password){
  const automatic=this.automaticOffline;
  try{
   if(automatic){this.offlineMode=false;await this.connectClient();}
   if(!this.client)throw new Error('オンラインに戻ってからログインしてください。');
   const generation=this.generation;
   const result=await this.client.auth.signInWithPassword({email,password});
   if(this.offlineMode||generation!==this.generation)return {cancelled:true};
   checked(result);this.automaticOffline=false;this.allowStartupRead=true;await this.activate(result.data.session);
  }catch(error){if(automatic&&this.automaticOffline){this.offlineMode=true;this.client?.auth.stopAutoRefresh();}throw error;}
 }
 stopForReset(){
  this.offlineMode=true;++this.generation;clearInterval(this.interval);clearTimeout(this.sendTimer);clearTimeout(this.retryTimer);clearTimeout(this.maxTimer);for(const request of this.networkRequests)request.abort();this.client?.auth.stopAutoRefresh();this.engine?.stop();this.engine=null;
 }
 async logout(){clearTimeout(this.retryTimer);const result=await this.client.auth.signOut({scope:'local'});checked(result);await this.activate(null);}
 async initialize(state){if(!this.engine||this.engine.status!=='empty')throw new Error('初期登録できません。同期状態を確認してください');this.engine.queue(state,{initial:true});return this.flush();}
 async enterOffline({automatic=false,account:chosenAccount}={}){
  if(this.offlineMode)return;
  let account=chosenAccount===null?null:this.user;
  if(!account&&chosenAccount!==null){try{account=JSON.parse(localStorage.getItem('TASKKANRI_LAST_ACCOUNT'))||JSON.parse(localStorage.getItem('TASKKANRI_SUPABASE_AUTH'))?.user;}catch{}}
  const accountStore=account&&this.id?syncStore(this.storage,account.id,this.id):null;
  const cache=accountStore?.read('cache');
  const current=this.getState();
  if(account&&!cache&&!this.engine?.payload&&!this.engine?.pending)account=null;
  const store=account?accountStore:syncStore(this.storage,'offline-local','shared');
  const existing=this.engine;
  // Persist the preference before changing the visible account or stopping requests.
  if(!automatic)localStorage.setItem('TASKKANRI_OFFLINE_MODE','true');
  this.automaticOffline=automatic;
  this.offlineMode=true;this.localOnly=!account;++this.generation;this.client?.auth.stopAutoRefresh();
  clearInterval(this.interval);this.interval=null;for(const request of this.networkRequests)request.abort();
  clearTimeout(this.sendTimer);clearTimeout(this.retryTimer);clearTimeout(this.maxTimer);this.maxTimer=null;
  this.engine=null;existing?.stop();
  this.user=account||{id:'offline-local',email:'この端末専用'};this.onAccount(this.user);
  const transport={get:async()=>store.read('cache'),save:async req=>{
   const document={revision:req.expectedRevision+1,payload:req.payload,updated_at:new Date().toISOString()};
   store.write('cache',document);if(store.flush)await store.flush();return {status:'saved',appliedRevision:document.revision,updatedAt:document.updated_at};
  }};
  this.engine=new SyncEngine({store,transport,canApply:this.canApply,onChange:e=>this.onStatus('オフラインモード',e),onData:(doc,context)=>this.mode==='desktop'?this.applyDocument(doc,context):this.onData(mergePayload(doc.payload,this.getState()),doc)});
  this.engine.manualOffline=true;
  if(!this.engine.loadCached()){
   const pending=this.engine.pending;
   await this.engine.accept({revision:Math.max(1,pending?.request.expectedRevision||0),payload:pending?.nextPayload||pending?.request.payload||toPayload(this.mode==='desktop'?current:defaultState())});
  }
  if(this.storage.flush)await this.storage.flush();this.engine.emit('synced');
 }
 resumeOnline(){localStorage.removeItem('TASKKANRI_OFFLINE_MODE');location.reload();}
 stageOfflineImport(state){
  const e=this.engine;
  if(!this.offlineMode||!e?.active)throw new Error('端末内の保存処理を準備できません。保存データを消さずにページを開き直してください。');
  if(e.payload&&samePayload(e.pending?.nextPayload||e.pending?.request?.payload||e.payload,toPayload(state)))return;
  const previous={pending:e.pending,cache:e.store.read('cache'),payload:e.payload,revision:e.revision,status:e.status,error:e.error};
  let cacheChanged=false;
  try{
   e.manualOffline=true;e.queue(state,{offline:true,initial:!e.payload});
   if(!e.payload){
    const document={revision:Math.max(1,e.pending.request.expectedRevision),payload:toPayload(state)};
    e.store.write('cache',document);cacheChanged=true;e.payload=document.payload;e.revision=document.revision;
   }
  }catch(error){
   try{
    if(e.pending!==previous.pending){if(previous.pending)e.store.write('pending',previous.pending);else e.store.remove('pending')}
    if(cacheChanged){if(previous.cache)e.store.write('cache',previous.cache);else e.store.remove('cache')}
    e.pending=previous.pending;e.payload=previous.payload;e.revision=previous.revision;e.status=previous.status;e.error=previous.error;
   }catch{throw new Error('端末内の未送信データを復元できません。保存データを消さずに確認してください。')}
   throw error;
  }
 }
 async save(state,{defer=false,canApply}={}){
  if(this.offlineMode){
   const e=this.engine;if(!e?.payload)throw new Error('端末のデータを読み込んでください。');
   e.queue(state,{offline:true});
   if(this.localOnly)return e.flush();
   this.onData(mergePayload(toPayload(state),this.getState()),{revision:e.revision,payload:toPayload(state)});
   if(this.storage.flush)await this.storage.flush();return {status:'saved'};
  }

  const e=this.engine;
  if(!e||!navigator.onLine||!e.payload||['blocked','conflict','empty','loading','offline'].includes(e.status)||!defer&&(e.pending||e.busy||e.status!=='synced'))throw new Error('同期を確認してから操作してください。');
  e.queue(state);if(defer){if(this.storage.flush)await this.storage.flush();this.schedule();return {status:'pending'};}return this.flush(canApply?{canApply:()=>this.engine===e&&samePayload(e.pending?.nextPayload||e.pending?.request?.payload,toPayload(state))&&canApply()}:undefined);
 }
}
