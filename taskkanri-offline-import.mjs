import {serializePayload} from './taskkanri-core.mjs';
import {archiveRecovery} from './taskkanri-recovery-archive.mjs';

// The local master and durable offline queue must agree before reporting success.
export async function saveOfflineImport(controller,service,storage,masterKey,next){
 if(!controller.offlineMode)throw new Error('端末への取り込みはオフラインモードで実行してください。');
 const serialized=serializePayload(next);if(!serialized.ok)throw new Error(serialized.error);
 const previous=storage.getItem(masterKey),engine=controller.engine;
 const result=await service.importRawWithRecovery(serialized.value,record=>archiveRecovery(record,{namespace:controller.user?.id}));if(!result.ok)throw new Error(result.error);
 try{if(controller.engine!==engine)throw new Error('保存中に利用するアカウントが変わりました。ファイルを選び直してください。');controller.stageOfflineImport(result.state)}
 catch(error){
  try{if(previous===null)storage.removeItem(masterKey);else storage.setItem(masterKey,previous);service.load()}
  catch{throw new Error('端末への保存と復元を完了できませんでした。取り込み前の復旧用バックアップは保持しています。保存データを消さずに確認してください。')}
  throw new Error('端末内の未送信データを保存できないため取り込みを中止し、元のデータに戻しました。'+(error?.message||''));
 }
 return result;
}
