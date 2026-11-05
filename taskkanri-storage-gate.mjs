export function acquireStorageGate(locks=globalThis.navigator?.locks){
 if(!locks)return Promise.reject(new Error('端末のデータ保護を利用できません。ブラウザーを更新してください。'));
 return new Promise((resolve,reject)=>{
  let releaseHold,settled=false;
  const finished=locks.request('TASKKANRI_STORAGE_GATE',{mode:'shared'},()=>{
   const hold=new Promise(done=>releaseHold=done);settled=true;
   resolve({release:async()=>{releaseHold();await finished}});return hold;
  });
  finished.catch(error=>{if(!settled)reject(error)});
 });
}
const resetSender=globalThis.crypto.randomUUID();
export function installResetListener(stop){
 if(!globalThis.BroadcastChannel)return null;
 const channel=new BroadcastChannel('TASKKANRI_RESET');
 channel.onmessage=event=>{if(event.data?.type==='reset'&&event.data.sender!==resetSender){sessionStorage.removeItem('TASKKANRI_CLIENT_ID');sessionStorage.removeItem('TASKKANRI_DESKTOP_OPENED');stop()}};
 addEventListener('pagehide',()=>channel.close(),{once:true});return channel;
}
export function notifyReset(){if(!globalThis.BroadcastChannel)return;const channel=new BroadcastChannel('TASKKANRI_RESET');channel.postMessage({type:'reset',sender:resetSender});setTimeout(()=>channel.close(),1000)}
