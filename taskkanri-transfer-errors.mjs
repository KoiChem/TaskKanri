const stages={read:'ファイルの読み込み',validate:'ファイル形式の確認',prepare:'端末の保存状態の確認',ready:'同期状態の確認',preview:'差分一覧の作成',save:'取り込んだデータの保存'};
export function importErrorMessage(error,stage='preview'){
 const name=typeof error?.name==='string'&&error.name.trim()?error.name:'UnknownError';
 const original=typeof error?.message==='string'?error.message.trim():typeof error==='string'?error.trim():'';
 let reason=original;
 if(name==='NotReadableError'||name==='NotFoundError')reason='ファイルを読み込めませんでした。ファイルを端末に保存し直してから選び直してください。';
 else if(name==='QuotaExceededError')reason='端末の保存容量が不足しています。現在のデータをエクスポートして保管し、空き容量を確認してください。';
 else if(name==='SecurityError'||name==='NotAllowedError')reason='ブラウザに読み込みや保存が制限されています。ファイルを端末に保存し直し、ブラウザの設定を確認してください。';
 else if(name==='AbortError')reason='ファイルの読み込みまたは処理が中断されました。ファイルを選び直してください。';
 if(!reason)reason='ブラウザから詳しい理由を取得できませんでした。この画面のエラー情報をお知らせください。';
 return `${stages[stage]||stages.preview}で処理を中止しました。\n${reason}\n\nエラー情報：TK-IMPORT-${stage.toUpperCase()} / ${name}`;
}

export function importReadinessError(engine,offlineMode=false){
 if(offlineMode)return null;
 if(!engine)return null;
 const stopped={blocked:['ImportSyncBlockedError','同期が停止しています。同期設定で理由を確認してください。'],conflict:['ImportConflictError','別の端末の変更と競合しています。未送信データを保管し、同期設定で競合を確認してください。'],deferred:['ImportEditingError','編集中の内容と、ほかの端末から届いた更新を確認してから取り込んでください。']};
 let name,message,canUseOffline=false;
 if(stopped[engine.status])[name,message]=stopped[engine.status];
 else if(engine.busy||['loading','offline'].includes(engine.status)){
  name='ImportSyncPendingError';
  message=engine.busy?'クラウドへの保存が応答待ちになっています。':engine.status==='loading'?'クラウドデータの読み込みが完了していません。':'クラウドと通信できていません。';
  canUseOffline=!engine.manualOffline;
  message+=canUseOffline?'\n通信を止めて、端末の保存データとの比較に進めます。オフラインに切り替えても、取り込みはまだ確定しません。':'\n端末への保存状況を確認してください。';
 }else return null;
 const error=new Error([message,engine.error].filter(Boolean).join('\n'));error.name=name;error.canUseOffline=canUseOffline;return error;
}
