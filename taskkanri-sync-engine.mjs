import { toPayload, mergePayload } from './taskkanri-sync-model.mjs';

/** Network-independent serialized CAS queue. Pending requests are durable before sending. */
export class SyncEngine {
  constructor({transport,store,onChange=()=>{},onData=()=>{},canApply=()=>true}) {
    Object.assign(this,{transport,store,onChange,onData,canApply});
    this.revision=0;this.payload=null;this.pending=store.read('pending');this.busy=false;this.active=true;this.generation=0;this.status='loading';this.deferred=null;
    if(this.pending&&(this.pending.request?.payload?.contractVersion===1||this.pending.nextPayload?.contractVersion===1))store.write('legacy-pending-backup:'+this.pending.request.mutationId,this.pending);
  }
  emit(status,error='') {if(status==='synced')this.lastSuccessfulSyncAt=new Date().toISOString();this.status=status;this.error=error;this.onChange(this);}
  request(payload,revision=this.revision) {return {payload,expectedRevision:revision,mutationId:globalThis.crypto.randomUUID(),attempted:false};}
  persist(pending) {this.store.write('pending',pending);this.pending=pending;}
  validate(document) {
    try {mergePayload(document?.payload);if(!Number.isSafeInteger(document.revision)||document.revision<1)throw new Error('更新番号が不正です');}
    catch(error){error.blocked=true;this.quarantined=document;try{this.store.write('quarantine',{document,reason:error.message,receivedAt:new Date().toISOString()})}catch{/* retain in memory if quota is exhausted */}this.emit('blocked',error.message);throw error;}
  }
  loadCached() {
    const cache=this.store.read('cache');if(!cache)return false;this.validate(cache);
    try {this.onData(this.pending?{...cache,payload:this.pending.nextPayload||this.pending.request.payload}:cache);}catch(error){error.blocked=true;this.emit('blocked',error.message);throw error;}
    this.payload=cache.payload;this.revision=cache.revision;this.updatedAt=cache.updated_at;return true;
  }
  async load() {
    const generation=this.generation;
    this.loadCached();
    const remote=await this.transport.get(false);
    if(!this.active||generation!==this.generation)return;
    if(this.pending) {
      if(remote && remote.revision!==this.pending.request.expectedRevision && !this.pending.request.attempted) this.emit('conflict');
      else this.emit('pending');
      return;
    }
    if(!remote) {this.emit('empty');return;}
    return this.accept(remote);
  }
  accept(document) {
    this.validate(document);
    try {if(document.payload.contractVersion===1 && !this.store.read('legacy-backup'))this.store.write('legacy-backup',document);this.onData(document);this.store.write('cache',document);}catch(error){error.blocked=true;this.emit('blocked',error.message);throw error;}
    this.payload=document.payload;this.revision=document.revision;this.updatedAt=document.updated_at;
    if(document.payload.contractVersion===1)this.queue(mergePayload(document.payload));else this.emit('synced');
  }
  queue(state,{initial=false}={}) {
    if(!this.active||this.status==='conflict'||this.status==='blocked')throw new Error('同期を確認してから操作してください。');
    if(!this.payload&&!initial)throw new Error('PC版で同期を開始してください。');
    const payload=toPayload(state);
    if(this.pending) {
      const next=structuredClone(this.pending);
      if(next.request.attempted||this.busy)next.nextPayload=payload;
      else next.request=this.request(payload,next.request.expectedRevision);
      this.persist(next);
    } else this.persist({request:this.request(payload,initial?0:this.revision)});
    this.emit('pending');
  }
  async flush() {
    if(!this.active||this.busy||!this.pending||['conflict','blocked'].includes(this.status))return {status:this.status};
    this.busy=true;const generation=this.generation;let req,committing=false;
    try {
      const next=structuredClone(this.pending);next.request.attempted=true;this.persist(next);req=structuredClone(next.request);this.emit('saving');
      const result=await this.transport.save(req);
      if(!this.active||generation!==this.generation)return {status:'stopped'};
      if(result.status==='conflict'){this.emit('conflict');return result;}
      if(!['saved','duplicate'].includes(result.status)||!Number.isSafeInteger(result.appliedRevision)||result.appliedRevision<1)throw new Error('保存結果を確認できません');
      let doc={revision:result.appliedRevision,payload:req.payload,updated_at:result.updatedAt};
      if(result.status==='duplicate') {
        doc=await this.transport.get(false);
        if(!this.active||generation!==this.generation)return {status:'stopped'};
        if(!doc)throw new Error('保存済みデータを確認できません');
      }
      const nextPayload=this.pending?.nextPayload;
      this.validate(doc);committing=true;
      if(doc.payload.contractVersion===1&&!this.store.read('legacy-backup'))this.store.write('legacy-backup',doc);
      if(nextPayload) {
        // Rebase only across our own accepted save, never across remote edits.
        if(doc.revision!==result.appliedRevision){this.emit('conflict');return {status:'conflict'};}
        this.store.write('cache',doc);this.persist({request:this.request(toPayload(mergePayload(nextPayload)),doc.revision)});
        this.payload=doc.payload;this.revision=doc.revision;this.updatedAt=doc.updated_at;this.emit('pending');
      } else {
        this.onData(doc);this.store.write('cache',doc);this.store.remove('pending');this.pending=null;
        this.payload=doc.payload;this.revision=doc.revision;this.updatedAt=doc.updated_at;
        if(doc.payload.contractVersion===1){this.queue(mergePayload(doc.payload));}else this.emit('synced');
      }
      return result;
    } catch(error) {
      if(!this.active||generation!==this.generation)return {status:'stopped'};
      if(committing)error.blocked=true;
      this.emit(error.blocked?'blocked':'offline',error.message);return {status:'error',error};
    } finally {this.busy=false;this.onChange(this);}
  }
  async refresh() {
    if(!this.active||this.busy||this.pending)return;
    const generation=this.generation;
    const meta=await this.transport.get(true);
    if(!this.active||generation!==this.generation||this.pending||this.busy)return;
    if(!meta){if(this.payload)this.emit('blocked','クラウドのデータが見つかりません');else this.emit('empty');return;}
    if(meta.revision===this.revision){this.emit('synced');return;}
    const document=await this.transport.get(false);
    if(!this.active||generation!==this.generation||this.pending||this.busy)return;
    if(!document)throw new Error('データを取得できません');
    this.validate(document);
    if(!this.canApply()){this.deferred=document;this.emit('deferred');return;}
    this.deferred=null;this.accept(document);
  }
  async discardPending() {
    if(this.busy)throw new Error('保存結果を確認してから操作してください');
    this.store.remove('pending');this.pending=null;this.emit('loading');await this.load();
  }
  stop() {this.active=false;this.generation++;this.payload=null;this.pending=null;this.deferred=null;this.onChange=()=>{};this.onData=()=>{};}
}
