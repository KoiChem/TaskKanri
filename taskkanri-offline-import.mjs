import {serializePayload} from './taskkanri-core.mjs';

// The local master and durable offline queue must agree before reporting success.
export function saveOfflineImport(controller,service,storage,masterKey,next){
 if(!controller.offlineMode)throw new Error('端末への取り込みはオフラインモードで実行してください。');
 const serialized=serializePayload(next);if(!serialized.ok)throw new Error(serialized.error);
 const previous=storage.getItem(masterKey);
 const result=service.importRaw(serialized.value);if(!result.ok)throw new Error(result.error);
 try{controller.stageOfflineImport(result.state)}
 catch(error){
  try{if(previous===null)storage.removeItem(masterKey);else storage.setItem(masterKey,previous);service.load()}
  catch{throw new Error('端末への保存と復元を完了できませんでした。取り込み前の復旧用バックアップは保持しています。保存データを消さずに確認してください。')}
  throw new Error('端末内の未送信データを保存できないため取り込みを中止し、元のデータに戻しました。'+(error?.message||''));
 }
 return result;
}
