import {supabaseConfig} from './supabase-config.js';
import {SyncEngine} from './taskkanri-sync-engine.mjs';
import {acquireClientId,syncStore} from './taskkanri-device-storage.mjs';
import {defaultState} from './taskkanri-core.mjs';
import {mergePayload,toPayload,samePayload} from './taskkanri-sync-model.mjs';

const blockedCodes=new Set(['42501','22023','PGRST202','PGRST301']);
function checked(result) {if(result.error){const e=new Error(result.error.message==='app_update_required'?'アプリを更新してください。未送信データは保持しています。':result.error.code==='42501'?'このアカウントは同期を許可されていません。':result.error.code==='PGRST202'?'Supabaseの初期設定が必要です。':result.error.message);e.blocked=blockedCodes.has(result.error.code);e.permissionDenied=result.error.code==='42501';throw e}return result.data}
export function statusLabel(engine) {
 if(engine?.manualOffline)return 'オフラインモード';
 const stamp=engine?.lastSuccessfulSyncAt?new Date(engine.lastSuccessfulSyncAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'';
 return ({loading:'読み込み中',empty:'PC版で同期を開始してください',synced:`同期済み ${stamp}`,pending:'未送信の変更あり',saving:'保存中',offline:`オフライン・最終取得 ${stamp}`,conflict:'変更が競合しています',deferred:'入力を終えると最新データを表示します',blocked:'同期を停止しています'})[engine?.status]||'未接続';
}
export class SyncController {
 constructor({mode,getState,onAccount=()=>{},onData=()=>{},onStatus=()=>{},canApply=()=>true}) {
  Object.assign(this,{mode,getState,onAccount,onData,onStatus,canApply});this.engine=null;this.user=null;this.client=null;this.generation=0;this.composing=false;this.retry=0;this.networkRequests=new Set();
  this.visibility=()=>{if(document.visibilityState==='visible')void this.refresh()};
  document.addEventListener('visibilitychange',this.visibility);window.addEventListener('online',this.visibility);
  document.addEventListener('compositionstart',()=>this.composing=true);document.addEventListener('compositionend',()=>{this.composing=false;if(this.engine?.pending)this.schedule()});
  this.interval=setInterval(()=>{if(document.visibilityState==='visible')void this.refresh()},15000);
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
  this.id=await acquireClientId(sessionStorage);
  if(localStorage.getItem('TASKKANRI_OFFLINE_MODE')==='true'){await this.enterOffline();return;}
  if(this.offlineMode)return;
  const {createClient}=await import('./vendor/supabase.js');
  if(this.offlineMode)return;
  this.client=createClient(supabaseConfig.url,supabaseConfig.publishableKey,{global:{fetch:(...args)=>this.fetchOnline(...args)},auth:{storageKey:'TASKKANRI_SUPABASE_AUTH',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  this.client.auth.onAuthStateChange((event,session)=>{if(this.offlineMode)return;if(event==='SIGNED_OUT')void this.activate(null);else if(['SIGNED_IN','USER_UPDATED','TOKEN_REFRESHED'].includes(event) && (session?.user.id!==this.user?.id || event==='TOKEN_REFRESHED' && this.engine?.status==='blocked'))setTimeout(()=>void this.activate(session).catch(e=>this.onStatus(e.message)),0)});
  const {data,error}=await this.client.auth.getSession();if(this.offlineMode)return;if(error)throw error;
  await this.activate(data.session);
  window.addEventListener('pagehide',()=>this.engine?.stop(),{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
 }
 async activate(session) {
  if(this.offlineMode)return;
  if(session?.user?.id===this.user?.id && this.engine)return;
  const hadUser=!!this.user;
  const generation=++this.generation;this.engine?.stop();this.engine=null;clearTimeout(this.sendTimer);clearTimeout(this.retryTimer);clearTimeout(this.maxTimer);this.user=null;this.retry=0;
  if(hadUser)this.onAccount(null);
  if(!session || !Number.isFinite(session.expires_at) || session.expires_at*1000<=Date.now()){this.onAccount(null);this.onStatus('未接続');return;}
  const store=syncStore(localStorage,session.user.id,this.id);let offline=false;
  try {
    if(!checked(await this.client.rpc('taskkanri_is_allowed'))){const error=new Error('このアカウントは同期を許可されていません。SUPABASE_SETUP.mdの設定を確認してください。');error.blocked=true;throw error;}
    if(generation!==this.generation)return;
    store.write('permission',{userId:session.user.id});
  } catch(error) {
    if(generation!==this.generation)return;
    if(error.blocked){store.remove('permission');this.onAccount(null);throw error;}
    if(store.read('permission')?.userId!==session.user.id || !store.read('cache'))throw error;
    offline=true;
  }
  if(generation!==this.generation)return;
  this.user=session.user;localStorage.setItem('TASKKANRI_LAST_ACCOUNT',JSON.stringify({id:this.user.id,email:this.user.email}));this.onAccount(this.user);
  const transport={get:async meta=>checked(await this.client.from('taskkanri_documents').select(meta?'revision,updated_at':'revision,updated_at,payload').eq('user_id',session.user.id).maybeSingle()),save:async req=>checked(await this.client.rpc('save_taskkanri_document',{expected_revision:req.expectedRevision,mutation_id:req.mutationId,payload:req.payload}))};
  this.engine=new SyncEngine({transport,store,canApply:this.canApply,
   onChange:engine=>{this.onStatus(statusLabel(engine),engine);},onData:doc=>this.onData(mergePayload(doc.payload,this.getState()),doc)});
  // Preserve a local master that was saved when writing the pending queue failed.
  const cache=this.engine.store.read('cache');if(cache)this.engine.validate(cache);
  if(this.mode==='desktop' && cache && !this.engine.pending && !samePayload(toPayload(this.getState()),toPayload(mergePayload(cache.payload,this.getState())))) {
    this.engine.payload=cache.payload;this.engine.revision=cache.revision;this.engine.queue(this.getState());
  }
  if(offline){this.engine.loadCached();this.engine.emit('offline');return;}
  const engine=this.engine;
  try{await engine.load();if(engine===this.engine&&engine.pending&&engine.status!=='conflict')this.schedule();}
  catch(e){if(engine!==this.engine||this.offlineMode)return;engine.emit(e.blocked?'blocked':'offline',e.message);throw e;}
 }
 dirty(state) {
  const engine=this.engine;if(!engine?.payload)return;
  const latest=engine.pending?.nextPayload||engine.pending?.request.payload||engine.payload;
  if(samePayload(toPayload(state),latest))return;
  if(this.offlineMode&&this.localOnly){engine.accept({revision:engine.revision+1,payload:toPayload(state)});return;}
  engine.queue(state);if(!this.offlineMode)this.schedule();
 }
 schedule() {
  if(this.offlineMode)return;
  clearTimeout(this.sendTimer);this.sendTimer=setTimeout(()=>{if(this.composing){this.schedule();return;}void this.flush()},800);
  if(!this.maxTimer)this.maxTimer=setTimeout(()=>{this.maxTimer=null;if(!this.composing)void this.flush()},5000);
 }
 async flush() {
  if(this.offlineMode)return {status:'pending'};
  if(this.composing)return {status:'pending'};
  clearTimeout(this.sendTimer);clearTimeout(this.maxTimer);this.maxTimer=null;
  const engine=this.engine;if(!engine)return {status:'stopped'};
  const result=await engine.flush();if(engine!==this.engine)return {status:'stopped'};
  if(result.error?.permissionDenied){await this.activate(null);this.onStatus(result.error.message);return result;}
  if(result.status==='error'&&!result.error.blocked){const delay=[2000,5000,15000][this.retry++]||60000;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{if(document.visibilityState==='visible')void this.flush()},delay);}
  else if(result.status==='saved'||result.status==='duplicate'){this.retry=0;if(engine.pending)this.schedule();}
  return result;
 }
 async refresh(){
  if(this.offlineMode)return {status:'synced'};
  if(!this.engine)return {status:'stopped',error:new Error('ログインしてから更新してください。')};
  const engine=this.engine;const before=engine.revision;
  try{
   const {data,error}=await this.client.auth.getSession();if(this.offlineMode||engine!==this.engine)return {status:'stopped'};if(error)throw error;
   if(!data.session||data.session.expires_at*1000<=Date.now()){await this.activate(null);return {status:'stopped',error:new Error('ログインし直してください。')};}
   if(data.session.user.id!==this.user?.id){await this.activate(data.session);return {status:this.engine?.status||'stopped'};}
   if(!checked(await this.client.rpc('taskkanri_is_allowed'))){const e=new Error('このアカウントは同期を許可されていません。');e.permissionDenied=true;throw e;}
   if(engine!==this.engine)return {status:'stopped'};
   if(engine.pending && !['conflict','blocked'].includes(engine.status))await this.flush();else await engine.refresh();
   return {status:engine.status,changed:engine.revision!==before,error:engine.error?new Error(engine.error):undefined};
  }catch(e){
   if(engine!==this.engine)return {status:'stopped',error:e};
   if(e.permissionDenied){await this.activate(null);this.onStatus(e.message);}else engine.emit(e.blocked?'blocked':'offline',e.message);
   return {status:'error',error:e};
  }
 }
 async login(email,password){if(!this.client)throw new Error('オンラインに戻ってからログインしてください。');const generation=this.generation;const result=await this.client.auth.signInWithPassword({email,password});if(this.offlineMode||generation!==this.generation)return {cancelled:true};checked(result);await this.activate(result.data.session);}
 async logout(){clearTimeout(this.retryTimer);const result=await this.client.auth.signOut({scope:'local'});checked(result);await this.activate(null);}
 async initialize(state){if(!this.engine||this.engine.status!=='empty')throw new Error('初期登録できません。同期状態を確認してください');this.engine.queue(state,{initial:true});return this.flush();}
 async enterOffline(){
  if(this.offlineMode)return;
  let account=this.user;
  if(!account){try{account=JSON.parse(localStorage.getItem('TASKKANRI_LAST_ACCOUNT'))||JSON.parse(localStorage.getItem('TASKKANRI_SUPABASE_AUTH'))?.user;}catch{}}
  const accountStore=account&&this.id?syncStore(localStorage,account.id,this.id):null;
  const cache=accountStore?.read('cache');
  const current=this.getState();
  if(account&&!cache&&!this.engine?.payload&&!this.engine?.pending)account=null;
  const store=account?accountStore:syncStore(localStorage,'offline-local','shared');
  const existing=this.engine;
  // Persist the preference before changing the visible account or stopping requests.
  localStorage.setItem('TASKKANRI_OFFLINE_MODE','true');
  this.offlineMode=true;this.localOnly=!account;++this.generation;this.client?.auth.stopAutoRefresh();
  clearInterval(this.interval);this.interval=null;for(const request of this.networkRequests)request.abort();
  clearTimeout(this.sendTimer);clearTimeout(this.retryTimer);clearTimeout(this.maxTimer);this.maxTimer=null;
  this.engine=null;existing?.stop();
  this.user=account||{id:'offline-local',email:'この端末専用'};this.onAccount(this.user);
  const transport={get:async()=>store.read('cache'),save:async req=>{
   const document={revision:req.expectedRevision+1,payload:req.payload,updated_at:new Date().toISOString()};
   store.write('cache',document);return {status:'saved',appliedRevision:document.revision,updatedAt:document.updated_at};
  }};
  this.engine=new SyncEngine({store,transport,canApply:this.canApply,onChange:e=>this.onStatus('オフラインモード',e),onData:doc=>this.onData(mergePayload(doc.payload,this.getState()),doc)});
  this.engine.manualOffline=true;
  if(!this.engine.loadCached()){
   const pending=this.engine.pending;
   this.engine.accept({revision:Math.max(1,pending?.request.expectedRevision||0),payload:pending?.nextPayload||pending?.request.payload||toPayload(this.mode==='desktop'?current:defaultState())});
  }
  this.engine.emit('synced');
 }
 resumeOnline(){localStorage.removeItem('TASKKANRI_OFFLINE_MODE');location.reload();}
 async save(state,{defer=false}={}){
  if(this.offlineMode){
   const e=this.engine;if(!e?.payload)throw new Error('端末のデータを読み込んでください。');
   e.queue(state);
   if(this.localOnly)return e.flush();
   this.onData(mergePayload(toPayload(state),this.getState()),{revision:e.revision,payload:toPayload(state)});
   return {status:'saved'};
  }

  const e=this.engine;
  if(!e||!navigator.onLine||!e.payload||['blocked','conflict','empty','loading','offline'].includes(e.status)||!defer&&(e.pending||e.busy||e.status!=='synced'))throw new Error('同期を確認してから操作してください。');
  e.queue(state);if(defer){this.schedule();return {status:'pending'};}return this.flush();
 }
}
