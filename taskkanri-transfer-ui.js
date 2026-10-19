import {importErrorMessage,importReadinessError} from './taskkanri-transfer-errors.mjs';
import {serializePayload,normalizeImportedPayload} from './taskkanri-core.mjs';
import {planImport,applyImport,importValueText} from './taskkanri-import.mjs';
import {exportFilename,downloadJson} from './taskkanri-export.mjs';

export function installDataTransfer({controller,getState,prepareImport=async()=>{},saveImportedState,beforeOpen=()=>{},onReturn=()=>{}}){
 const dialog=document.createElement('dialog');dialog.className='transfer-dialog';dialog.setAttribute('aria-label','データの移動');document.body.append(dialog);
 const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);
 let plan=null,raw=null,filename='',identity=null,saving=false,previousExport=null,opener=null;
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node};
 const q=s=>dialog.querySelector(s);
 function finish(){if(saving)return;dialog.close();onReturn();opener?.isConnected&&opener.focus({preventScroll:true})}
 dialog.addEventListener('cancel',event=>{event.preventDefault();finish()});
 function shell(title,wide=false){
  dialog.classList.toggle('transfer-wide',wide);dialog.replaceChildren();
  const header=el('div',undefined,'transfer-heading'),heading=el('h2',title);heading.id='transfer-title';dialog.setAttribute('aria-labelledby',heading.id);
  const close=el('button','閉じる');close.type='button';close.onclick=finish;header.append(heading,close);
  const body=el('div',undefined,'transfer-body'),message=el('p',undefined,'transfer-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');const footer=el('div',undefined,'transfer-footer');dialog.append(header,body,message,footer);return {body,footer,message};
 }
 function show(){beforeOpen();if(!dialog.open)dialog.showModal()}
 function capture(){const result=serializePayload(getState());if(!result.ok)throw new Error(result.error);return result.value}
 function checkReady(){
  const error=importReadinessError(controller.engine,controller.offlineMode);if(error)throw error;
 }
 function offerOffline(footer,error){
  if(!error?.canUseOffline||footer.querySelector('[data-import-offline]'))return;
  const offline=el('button','オフラインで差分を確認',footer.querySelector('.transfer-primary')?'':'transfer-primary');offline.type='button';offline.dataset.importOffline='';
  offline.onclick=async()=>{
   footer.querySelectorAll('button').forEach(button=>button.disabled=true);
   try{await controller.enterOffline();await prepareImport();checkReady();preview()}
   catch(failure){q('.transfer-message').textContent=importErrorMessage(failure,'prepare')}
   finally{footer.querySelectorAll('button').forEach(button=>button.disabled=false)}
  };
  footer.prepend(offline);
 }
 function exportMenu(event){
  opener=event?.currentTarget||document.activeElement;
  const {body,message}=shell('データをエクスポート');
  body.append(el('p','予定・タスク・設定を、PC版でも使えるファイルに書き出します。'));
  const file=el('button','ファイルに保存','transfer-option');file.type='button';file.onclick=()=>{try{downloadJson(capture());message.textContent='ファイルの保存を開始しました。'}catch(error){message.textContent=error.message}};
  const share=el('button','メールなどで共有','transfer-option');share.type='button';
  let exportFile;
  try{exportFile=new File([JSON.stringify(capture(),null,2)],exportFilename(),{type:'application/json'})}catch(error){message.textContent=error.message}
  const supported=!!exportFile&&!!navigator.canShare?.({files:[exportFile]})&&!!navigator.share;
  share.disabled=!supported;
  share.onclick=async()=>{
   try{
    const currentFile=new File([JSON.stringify(capture(),null,2)],exportFilename(),{type:'application/json'});
    if(!navigator.canShare?.({files:[currentFile]}))throw new Error('このファイルは共有できません。「ファイルに保存」を使ってください。');
    await navigator.share({files:[currentFile],title:'TaskKanri バックアップ'});
    message.textContent='共有先にファイルを渡しました。送信は選んだアプリで確認してください。';
   }catch(error){message.textContent=error.name==='AbortError'?'共有をキャンセルしました。':error.message}
  };
  body.append(file,share,el('p',supported?'共有メニューでGmailなどのメールアプリを選べます。表示されるアプリは端末によって異なります。':'この端末ではJSONファイルの共有に対応していません。ファイルに保存してから、Gmailなどで添付してください。','transfer-hint'));
  show();
 }
 function preview(){
  const {body,footer,message}=shell('取り込む変更を確認',true);
  plan=planImport(getState(),raw);identity=controller.user?.id;
  body.append(el('p',filename,'transfer-filename'),el('p','チェックした項目をファイルの内容に置き換えます。チェックを外した項目と、ファイルにない既存データは残します。','transfer-hint'));
  if(!plan.rows.length){body.append(el('p','変更のある項目はありません。'));show();return}
  const allLabel=el('label',undefined,'transfer-select-all'),all=el('input');all.type='checkbox';all.checked=true;allLabel.append(all,el('span','すべて選択'));body.append(allLabel);
  let yearConfirm;
  if(plan.yearChanged){const box=el('div',undefined,'transfer-year');box.append(el('p',`${getState().currentYear}年度 → ${plan.year}年度への変更を含みます。既存の予定は元の日付のまま残ります。`));const label=el('label');yearConfirm=el('input');yearConfirm.type='checkbox';label.append(yearConfirm,el('span','年度の変更を確認しました'));box.append(label);body.append(box)}
  const groups=new Map();
  for(const row of plan.rows){
   let section=groups.get(row.group);if(!section){section=el('section',undefined,'transfer-group');section.append(el('h3',row.group));body.append(section);groups.set(row.group,section)}
   const item=el('article',undefined,'transfer-row'),label=el('label',undefined,'transfer-row-label'),checkbox=el('input');checkbox.type='checkbox';checkbox.checked=true;checkbox.dataset.importId=row.id;
   label.append(checkbox,el('span',row.label));if(row.deletion)label.append(el('span','内容を削除','transfer-delete'));item.append(label);
   const compare=el('div',undefined,'transfer-compare');for(const [title,value] of [['現在',row.before],['取り込み後',row.after]]){const column=el('div');column.append(el('strong',title),el('div',importValueText(value,row.path[0]),'transfer-value'));compare.append(column)}item.append(compare);section.append(item);
  }
  const back=el('button','キャンセル');back.type='button';back.onclick=finish;const apply=el('button',undefined,'transfer-primary');apply.type='button';footer.append(back,apply);
  const checkboxes=()=>[...body.querySelectorAll('[data-import-id]')];
  const update=()=>{const boxes=checkboxes(),count=boxes.filter(b=>b.checked).length;all.checked=count===boxes.length;all.indeterminate=count>0&&count<boxes.length;apply.textContent=`選択した${count}件を取り込む`;const yearSelected=boxes.some(b=>b.checked&&b.dataset.importId==='["currentYear"]');apply.disabled=saving||count===0||yearSelected&&!yearConfirm?.checked;};
  all.onchange=()=>{checkboxes().forEach(b=>b.checked=all.checked);update()};body.addEventListener('change',update);update();
  apply.onclick=async()=>{
   try{
    checkReady();
    if(identity!==controller.user?.id)throw new Error('アカウントが変更されました。ファイルを選び直してください。');
    let next;
    try{next=applyImport(getState(),plan,checkboxes().filter(b=>b.checked).map(b=>b.dataset.importId))}catch(error){if(error.message.includes('確認中に')){preview();q('.transfer-message').textContent=error.message;return}throw error}
    previousExport=capture();saving=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll('button,input').forEach(node=>node.disabled=true);message.textContent='取り込んでいます…';
    await saveImportedState(next,plan.before);
    const count=checkboxes().filter(b=>b.checked).length;
    const completed=shell('取り込みが完了しました');completed.body.append(el('p',`${count}件の変更をこの端末に保存しました。`),el('p',controller.offlineMode?'オフラインモードのため、通信は行っていません。':controller.user?'変更は同期の対象になります。同期状況は設定で確認できます。':'端末に保存しました。'));
    const backup=el('button','取り込み前のデータを書き出す','transfer-option');backup.type='button';backup.onclick=()=>downloadJson(previousExport,exportFilename('before-import'));completed.body.append(backup);const done=el('button','完了','transfer-primary');done.type='button';done.onclick=finish;completed.footer.append(done);
   }catch(error){message.textContent=importErrorMessage(error,'save');offerOffline(footer,error)}
   finally{saving=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll('button,input').forEach(node=>node.disabled=false);if(q('[data-import-id]'))update()}
  };
  show();
 }
 async function importFile(file){
  if(!file||saving)return;
  opener=document.activeElement;let stage='read';
  try{
   if(file.size>16*1024*1024)throw new Error('ファイルが大きすぎます。16MB以下のTaskKanriファイルを選んでください。');
   raw=await file.text();filename=file.name;
   stage='validate';const validated=normalizeImportedPayload(raw);if(!validated.ok)throw new Error(validated.error);
   stage='prepare';await prepareImport();
   stage='ready';checkReady();
   stage='preview';filename=file.name;preview();
  }catch(error){
   const {message,footer}=shell('インポートできませんでした');message.textContent=importErrorMessage(error,stage);
   const retry=el('button','ファイルを選び直す');retry.type='button';retry.onclick=()=>input.click();footer.append(retry);offerOffline(footer,error);show();
  }
 }
 input.onchange=async()=>{const file=input.files?.[0];try{await importFile(file)}finally{input.value=''}};
 return {exportMenu,importFile,chooseImport(){input.click()},dialog};
}
