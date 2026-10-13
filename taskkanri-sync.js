import {supabaseConfig} from './supabase-config.js';
import {SyncEngine} from './taskkanri-sync-engine.mjs';
import {acquireClientId,syncStore} from './taskkanri-device-storage.mjs';
import {mergePayload,toPayload,samePayload} from './taskkanri-sync-model.mjs';

const blockedCodes=new Set(['42501','22023','PGRST202','PGRST301']);
function checked(result) {if(result.error){const e=new Error(result.error.code==='42501'?'このアカウントは同期を許可されていません。':result.error.code==='PGRST202'?'Supabaseの初期設定が必要です。':result.error.message);e.blocked=blockedCodes.has(result.error.code);e.permissionDenied=result.error.code==='42501';throw e}return result.data}
export function statusLabel(engine) {
 const stamp=engine?.updatedAt?new Date(engine.updatedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'';
 return ({loading:'読み込み中',empty:'PC版で同期を開始してください',synced:`同期済み ${stamp}`,pending:'未送信の変更あり',saving:'保存中',offline:`オフライン・最終取得 ${stamp}`,conflict:'変更が競合しています',deferred:'入力を終えると最新データを表示します',blocked:'同期を停止しています'})[engine?.status]||'未接続';
}
export class SyncController {
 constructor({mode,getState,onAccount=()=>{},onData=()=>{},onStatus=()=>{},canApply=()=>true}) {
  Object.assign(this,{mode,getState,onAccount,onData,onStatus,canApply});this.engine=null;this.user=null;this.client=null;this.generation=0;this.composing=false;this.retry=0;
  this.visibility=()=>{if(document.visibilityState==='visible')void this.refresh()};
  document.addEventListener('visibilitychange',this.visibility);window.addEventListener('online',this.visibility);
  document.addEventListener('compositionstart',()=>this.composing=true);document.addEventListener('compositionend',()=>{this.composing=false;if(this.engine?.pending)this.schedule()});
  this.interval=setInterval(()=>{if(document.visibilityState==='visible')void this.refresh()},15000);
 }
 async start() {
  const {createClient}=await import('./vendor/supabase.js');
  this.client=createClient(supabaseConfig.url,supabaseConfig.publishableKey,{auth:{storageKey:'TASKKANRI_SUPABASE_AUTH',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  this.id=await acquireClientId(sessionStorage);
  this.client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT')void this.activate(null);else if(['SIGNED_IN','USER_UPDATED','TOKEN_REFRESHED'].includes(event) && (session?.user.id!==this.user?.id || event==='TOKEN_REFRESHED' && this.engine?.status==='blocked'))setTimeout(()=>void this.activate(session).catch(e=>this.onStatus(e.message)),0)});
  const {data,error}=await this.client.auth.getSession();if(error)throw error;
  await this.activate(data.session);
  window.addEventListener('pagehide',()=>this.engine?.stop(),{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
 }
 async activate(session) {
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
  this.user=session.user;this.onAccount(this.user);
  const transport={get:async meta=>checked(await this.client.from('taskkanri_documents').select(meta?'revision,updated_at':'revision,updated_at,payload').eq('user_id',session.user.id).maybeSingle()),save:async req=>checked(await this.client.rpc('save_taskkanri_document',{expected_revision:req.expectedRevision,mutation_id:req.mutationId,payload:req.payload}))};
  this.engine=new SyncEngine({transport,store,canApply:this.canApply,
   onChange:engine=>{this.onStatus(statusLabel(engine),engine);},onData:doc=>this.onData(mergePayload(doc.payload,this.getState()),doc)});
  // Preserve a local master that was saved when writing the pending queue failed.
  const cache=this.engine.store.read('cache');if(cache)this.engine.validate(cache);
  if(this.mode==='desktop' && cache && !this.engine.pending && !samePayload(toPayload(this.getState()),cache.payload)) {
    this.engine.payload=cache.payload;this.engine.revision=cache.revision;this.engine.queue(this.getState());
  }
  if(offline){this.engine.loadCached();this.engine.emit('offline');return;}
  try{await this.engine.load();if(this.engine?.pending && this.engine.status!=='conflict')this.schedule();}
  catch(e){this.engine?.emit(e.blocked?'blocked':'offline',e.message);throw e;}
 }
 dirty(state) {
  const engine=this.engine;if(!engine?.payload)return;
  const latest=engine.pending?.nextPayload||engine.pending?.request.payload||engine.payload;
  if(samePayload(toPayload(state),latest))return;
  engine.queue(state);this.schedule();
 }
 schedule() {
  clearTimeout(this.sendTimer);this.sendTimer=setTimeout(()=>{if(this.composing){this.schedule();return;}void this.flush()},800);
  if(!this.maxTimer)this.maxTimer=setTimeout(()=>{this.maxTimer=null;if(!this.composing)void this.flush()},5000);
 }
 async flush() {
  if(this.composing)return {status:'pending'};
  clearTimeout(this.sendTimer);clearTimeout(this.maxTimer);this.maxTimer=null;
  const engine=this.engine;if(!engine)return {status:'stopped'};
  const result=await engine.flush();if(engine!==this.engine)return {status:'stopped'};
  if(result.error?.permissionDenied){await this.activate(null);this.onStatus(result.error.message);return result;}
  if(result.status==='error'&&!result.error.blocked){const delay=[2000,5000,15000][this.retry++]||60000;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{if(document.visibilityState==='visible')void this.flush()},delay);}
  else if(result.status==='saved'||result.status==='duplicate'){this.retry=0;if(engine.pending)this.schedule();}
  return result;
 }
 async refresh(){if(!this.engine)return;const engine=this.engine;try{
   const {data,error}=await this.client.auth.getSession();if(error)throw error;
   if(!data.session||data.session.expires_at*1000<=Date.now()){await this.activate(null);return;}
   if(data.session.user.id!==this.user?.id){await this.activate(data.session);return;}
   if(!checked(await this.client.rpc('taskkanri_is_allowed'))){const e=new Error('このアカウントは同期を許可されていません。');e.permissionDenied=true;throw e;}
   if(engine!==this.engine)return;
   if(engine.pending && !['conflict','blocked'].includes(engine.status))await this.flush();else await engine.refresh();
 }catch(e){if(engine!==this.engine)return;if(e.permissionDenied){await this.activate(null);this.onStatus(e.message);}else engine.emit(e.blocked?'blocked':'offline',e.message)}}
 async login(email,password){const result=await this.client.auth.signInWithPassword({email,password});checked(result);await this.activate(result.data.session);}
 async logout(){clearTimeout(this.retryTimer);const result=await this.client.auth.signOut({scope:'local'});checked(result);await this.activate(null);}
 async initialize(state){if(!this.engine||this.engine.status!=='empty')throw new Error('初期登録できません。同期状態を確認してください');this.engine.queue(state,{initial:true});return this.flush();}
 async save(state){if(!this.engine || !navigator.onLine || this.engine.pending || this.engine.busy || this.engine.status!=='synced')throw new Error('同期済みの状態で操作してください。');this.engine.queue(state);return this.flush();}
}
