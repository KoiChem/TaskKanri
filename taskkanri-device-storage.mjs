export function scopedStorage(storage,namespace) {
  const prefix=`TASKKANRI_USER:${namespace}:`;
  const keys=()=>Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(prefix));
  return {get length(){return keys().length},key:i=>keys()[i]?.slice(prefix.length)??null,getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>storage.setItem(prefix+k,v),removeItem:k=>storage.removeItem(prefix+k)};
}
export function jsonStore(storage) {return {read:k=>{const raw=storage.getItem(k);if(raw===null)return null;try{return JSON.parse(raw)}catch{try{storage.setItem('quarantine:'+k+':'+crypto.randomUUID(),raw)}catch{}const error=new Error('端末の同期データが破損しています。データを書き出して保全してください。');error.blocked=true;throw error}},write:(k,v)=>storage.setItem(k,JSON.stringify(v)),remove:k=>storage.removeItem(k)};}
export function clientId(session) {let id=session.getItem('TASKKANRI_CLIENT_ID');if(!id){id=crypto.randomUUID();session.setItem('TASKKANRI_CLIENT_ID',id)}return id;}
export function acquireClientId(session,locks=globalThis.navigator?.locks,onRelease=fn=>window.addEventListener('pagehide',fn,{once:true})) {
  if(!locks)return Promise.reject(new Error('同期の保存保護にはSafari 15.4以降が必要です。ブラウザーを更新してください。'));
  return new Promise((resolve,reject)=>{
    const attempt=()=>{const id=clientId(session);locks.request('TASKKANRI_TAB:'+id,{ifAvailable:true},lock=>{
      if(!lock){session.setItem('TASKKANRI_CLIENT_ID',crypto.randomUUID());attempt();return;}
      resolve(id);return new Promise(release=>onRelease(release));
    }).catch(reject)};attempt();
  });
}
export function syncStore(storage,user,id) {
  const userStore=jsonStore(scopedStorage(storage,user));const tabStore=jsonStore(scopedStorage(storage,`${user}:tab:${id}`));
  return {read:k=>(k==='pending'?tabStore:userStore).read(k),write:(k,v)=>(k==='pending'?tabStore:userStore).write(k,v),remove:k=>(k==='pending'?tabStore:userStore).remove(k)};
}
