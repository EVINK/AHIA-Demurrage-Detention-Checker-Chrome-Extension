import {messageTemplate,recognizeCarrier,containerNumber,DEFAULT_BODY_TEMPLATE,DEFAULT_SUBJECT_TEMPLATE,addressList} from './core.js';
import {DEFAULT_SETTINGS,validateSettings,createConfig,parseConfig,MAX_CONFIG_BYTES} from './config.js';
const $=id=>document.getElementById(id);
const demo=!globalThis.chrome?.runtime?.id;
const copy=value=>JSON.parse(JSON.stringify(value));
const types={demurrage:'Demurrage',detention:'Detention'};
const sources={sheet:'提柜表航司列','mbl-prefix':'MBL 前缀',manual:'手动选择'};
let settings=copy(DEFAULT_SETTINGS),busy=false,initializing=true,debounce,pollTimer,polling=false,requestSequence=0,lastOperationId='',lastRenderedOperation='',lastResult=null,draftTabId=null,missingConfiguration=false,editingId='',newProfile=null,pendingImport=null;
let demoSettings=copy(DEFAULT_SETTINGS),demoOperation=null;
try{demoSettings=validateSettings(JSON.parse(localStorage.getItem('lfd-demo-settings')||'null')||DEFAULT_SETTINGS);}catch{}
function storedInput(){try{return JSON.parse(localStorage.getItem('lfd-popup-input')||'{}');}catch{return {};}}
function rememberInput(){try{localStorage.setItem('lfd-popup-input',JSON.stringify({container:$('container').value,carrierId:$('carrier').value,inquiryType:$('inquiryType').value}));}catch{}}
async function rpc(message){
  if(demo){
    if(message.type==='clearCache'){demoOperation=null;return true;}
    if(message.type==='state')return {settings:copy(demoSettings),ledger:{},operation:demoOperation};
    if(message.type==='settings'){demoSettings=validateSettings(message.settings);localStorage.setItem('lfd-demo-settings',JSON.stringify(demoSettings));return copy(demoSettings);}
    if(message.type==='run'){
      if(!['identify','preview'].includes(message.mode))throw new Error('这是本地界面演示。安装后的插件才能生成 Gmail 草稿。');
      const container=containerNumber(message.container),id=crypto.randomUUID();
      demoOperation={id,status:'running',mode:message.mode,container,options:message.options};
      await new Promise(resolve=>setTimeout(resolve,350));
      const record={container,mbl:container.startsWith('MSCU')?'MEDU1234567':'MAEU276301677',row:326,sourceTime:Date.now(),demo:true};
      let result;
      try{
        const recognized=message.options.carrierId==='auto'?recognizeCarrier(record,demoSettings.carriers):{carrier:demoSettings.carriers.find(p=>p.id===message.options.carrierId),carrierSource:'manual'};
        if(!recognized.carrier)throw new Error('请选择已配置的船公司。');
        const profile=recognized.carrier;
        result={...record,carrierId:profile.id,carrierName:profile.name,carrierSource:recognized.carrierSource,inquiryType:message.options.inquiryType,configurationMissing:[...(!profile.to.length?['to']:[]),...(!profile.bodyTemplate.trim()?['bodyTemplate']:[])]};
      }catch(error){result={...record,inquiryType:message.options.inquiryType,unrecognizedCarrier:true,recognitionError:error.message,configurationMissing:['carrier']};}
      demoOperation={...demoOperation,status:'complete',result};return result;
    }
    throw new Error('界面演示不会操作真实 Gmail 或在线表格。');
  }
  const response=await chrome.runtime.sendMessage(message);
  if(!response?.ok)throw new Error(response?.error||'插件未返回结果。请检查 Gmail 后再操作。');
  return response.data;
}
function status(text,type=''){ $('status').textContent=text;$('status').className=type;$('statusDot').className='status-dot '+type; }
function lookupError(message){
  $('matchCarrier').textContent='查表未完成';$('matchMbl').textContent='尚未取得 MBL';
  $('matchSource').textContent=message;clearPreview();
}
function showPage(page){
  document.querySelectorAll('.page').forEach(node=>{const active=node.id==='page-'+page;node.hidden=!active;node.classList.toggle('active',active);});
  document.querySelectorAll('.tab').forEach(node=>{const active=node.dataset.page===page;node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));});
}
function setBusy(value){
  busy=value;
  document.querySelectorAll('button:not(.tab),input,select,textarea').forEach(node=>node.disabled=value);
  if(!value){$('send').disabled=missingConfiguration||!$('manualMbl').value.trim();$('draft').disabled=$('send').disabled;$('deleteCarrier').disabled=!newProfile&&settings.carriers.length<2;}
}
function syncMode(){
  const test=settings.testMode!==false;
  $('modeBadge').textContent=demo?'界面演示 · 示例数据':test?'测试模式 · 不发送':'正式模式';
  $('modeBadge').classList.toggle('live',!test&&!demo);
  $('send').textContent=test?'生成草稿（测试模式）':'发送邮件';
}
function options(){return {carrierId:$('carrier').value||'auto',inquiryType:$('inquiryType').value};}
function fillSelect(id,includeAuto,value){
  const select=$(id);select.replaceChildren();
  if(includeAuto)select.add(new Option('自动识别','auto'));
  for(const profile of settings.carriers)select.add(new Option(profile.name,profile.id));
  select.value=[...select.options].some(option=>option.value===value)?value:includeAuto?'auto':settings.carriers[0].id;
}
function hydrateSettings(){
  const selected=$('carrier').value||settings.defaultCarrierId;
  fillSelect('carrier',true,selected);fillSelect('defaultCarrierId',true,settings.defaultCarrierId);fillSelect('editCarrier',false,editingId||settings.carriers[0].id);
  for(const key of ['sheetUrl','account','gmailIndex','defaultInquiryType'])$(key).value=settings[key];
  $('testMode').checked=settings.testMode!==false;syncMode();
  loadProfile($('editCarrier').value);
}
function loadProfile(id,profileOverride){
  const profile=profileOverride||settings.carriers.find(p=>p.id===id);if(!profile)return;
  editingId=profile.id;newProfile=profileOverride?copy(profile):null;
  if(profileOverride){$('editCarrier').add(new Option(profile.name+'（未保存）',profile.id));}
  $('editCarrier').value=profile.id;
  for(const [field,key]of [['carrierName','name'],['greeting','greeting'],['subjectTemplate','subjectTemplate'],['bodyTemplate','bodyTemplate']])$(field).value=profile[key]||'';
  for(const [field,key]of [['carrierTo','to'],['carrierCc','cc'],['aliases','aliases'],['mblPrefixes','mblPrefixes']])$(field).value=(profile[key]||[]).join(', ');
  $('profileState').textContent=!profile.to.length||!profile.bodyTemplate?'尚未完成 · 可先保存配置':'已配置';
  $('deleteCarrier').hidden=Boolean(profileOverride);$('deleteCarrier').disabled=busy||settings.carriers.length<2;
}
function startNewProfile(name='新船公司'){
  const profile={id:'carrier-'+crypto.randomUUID().slice(0,8),name,greeting:name,to:[],cc:[],aliases:name==='新船公司'?[]:[name],mblPrefixes:[],bodyTemplate:'',subjectTemplate:DEFAULT_SUBJECT_TEMPLATE};
  fillSelect('editCarrier',false,editingId);loadProfile(profile.id,profile);showPage('config');$('page-config').scrollTop=0;$('carrierName').focus();status('填写收件邮箱和正文，或点击「使用标准模板」。');
}
function clearPreview(){
  $('source').textContent='识别完成后显示当前模板';
  for(const id of ['to','cc'])$(id).textContent='—';$('subject').textContent='等待匹配柜号和 MBL';
  $('mailBody').replaceChildren();const note=document.createElement('p');note.className='empty-preview';note.textContent='匹配船公司并完成配置后显示邮件预览。';$('mailBody').append(note);
}
function renderResult(data){
  if(!data)return;lastResult=data;
  const record=data.record?{...data.record,...data}:data;
  const carrierId=data.carrierId||data.carrier?.id,profile=settings.carriers.find(p=>p.id===carrierId);
  const type=data.inquiryType||$('inquiryType').value;
  const missing=data.configurationMissing||[...(!profile?['carrier']:[]),...(profile&&!profile.to.length?['to']:[]),...(profile&&!profile.bodyTemplate?['bodyTemplate']:[])];
  missingConfiguration=missing.length>0||Boolean(data.unrecognizedCarrier);
  $('matchCarrier').textContent=data.unrecognizedCarrier?'需要选择船公司':data.carrierName||profile?.name||'等待识别';
  $('manualMbl').value=record.mbl||'';$('matchMbl').textContent=record.mbl||'请手动填写 MBL';
  $('matchSource').textContent=data.unrecognizedCarrier?data.recognitionError||'无法自动识别':sources[data.carrierSource||record.carrierSource]||'自动识别';
  $('previewType').textContent=types[type]||type;
  $('source').textContent=data.demo?'界面演示 · 示例数据':record.row?`${record.fromCache?'本地缓存':'提柜'} · 第 ${record.row} 行${record.sourceTime?' · '+new Date(record.sourceTime).toLocaleTimeString():''}`:'来自本次提柜表查询';
  $('needsConfig').hidden=!missingConfiguration;
  if(missingConfiguration){
    $('missingTitle').textContent=data.unrecognizedCarrier?'暂未识别船公司':'首次使用：请补充配置';
    const names={carrier:'船公司',to:'收件邮箱',body:'正文模板',bodyTemplate:'正文模板',subjectTemplate:'主题模板'};
    $('missingDetail').textContent=data.recognitionError||`请为 ${profile?.name||data.carrierName||'此船公司'} 填写${missing.map(key=>names[key]||key).join('、')}，再生成邮件。`;
    $('configureDetected').textContent=profile?'配置 '+profile.name:'新增或选择船公司';clearPreview();
  }else{
    try{
      const message=messageTemplate(record,{carrier:profile,inquiryType:type});
      $('to').textContent=message.to.join(', ');$('cc').textContent=message.cc.join(', ')||'—';$('subject').textContent=message.subject;$('mailBody').innerHTML=message.html;
    }catch(error){clearPreview();status(error.message,'error');}
  }
  draftTabId=data.status==='draft'&&Number.isInteger(data.tabId)?data.tabId:null;$('openDraft').hidden=draftTabId===null;
  setBusy(busy);
}
function reportResult(data,mode){
  renderResult(data);
  if(data.status==='draft')status('Gmail 草稿已填好，原签名已保留，尚未发送。可打开草稿检查。','success');
  else if(data.status==='sent')status('Gmail 已显示发送成功。','success');
  else if(data.unrecognizedCarrier)status(data.recognitionError||'请选择船公司或补充识别规则。','error');
  else if(missingConfiguration)status('已匹配柜号和船公司；完成提示中的配置后即可生成草稿。');
  else status(data.demo?'演示匹配完成；未读取在线表格，也不会创建邮件。':mode==='identify'?'已匹配 MBL 和船公司。点击生成草稿继续。':'邮件预览已更新。','success');
}
function syncOperation(operation,{restore=false}={}){
  if(!operation)return;
  if(restore){
    $('container').value=operation.container||$('container').value;
    if(operation.options){if([...$('carrier').options].some(o=>o.value===operation.options.carrierId))$('carrier').value=operation.options.carrierId;$('inquiryType').value=operation.options.inquiryType||$('inquiryType').value;}
    rememberInput();
  }
  lastOperationId=operation.id||lastOperationId;
  if(operation.status==='running'){
    setBusy(true);status(operation.mode==='identify'?'正在查表并识别船公司… 可关闭弹窗，后台会继续。':'正在后台准备邮件… 可关闭弹窗，完成后重新打开查看。','running');startPolling();return;
  }
  if(operation.id&&lastRenderedOperation===operation.id)return;
  lastRenderedOperation=operation.id||'';
  if(operation.status==='complete'){setBusy(false);reportResult(operation.result,operation.mode);}
  else if(operation.status==='failed'||operation.status==='interrupted'){setBusy(false);if(operation.mode==='identify')lookupError(operation.error||'请点击重新查表。');status(operation.error||(operation.status==='interrupted'?'上次操作已中断，请先检查 Gmail 草稿和已发送记录。':'操作失败。'),'error');}
}
function renderHistory(ledger={}){
  const root=$('history');root.replaceChildren();const entries=Object.entries(ledger).sort((a,b)=>(b[1].time||0)-(a[1].time||0));$('historyCount').textContent=entries.length;
  if(!entries.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='暂无操作记录';root.append(empty);return;}
  const statuses={preparing:'准备中 / 中断待核实',draft:'草稿已生成 · 未自动发送',sending:'发送中 / 待核实',sent:'Gmail 已确认发送',uncertain:'发送结果待核实',needs_review:'准备失败，请检查草稿'};
  for(const [key,entry]of entries){
    const row=document.createElement('div');row.className='history-row';
    const content=document.createElement('div'),name=document.createElement('strong');name.textContent=entry.container+' · '+entry.mbl;content.append(name);
    const detail=document.createElement('p');detail.textContent=`${entry.carrierName||'Maersk'} · ${types[entry.inquiryType]||'Demurrage'} · ${new Date(entry.time).toLocaleString()}`;content.append(detail);
    const state=document.createElement('div');state.className='history-state';state.textContent=statuses[entry.status]||entry.status;content.append(state);
    if(entry.detail){const note=document.createElement('p');note.textContent=entry.detail;content.append(note);}
    const buttons=document.createElement('div');buttons.className='history-buttons';
    if(entry.status==='draft'&&Number.isInteger(entry.tabId)){const open=document.createElement('button');open.textContent='打开草稿';open.disabled=busy;open.addEventListener('click',()=>openDraft(entry.tabId));buttons.append(open);}
    const release=document.createElement('button');release.textContent='解除锁定';release.disabled=busy;
    release.addEventListener('click',async()=>{if(busy||!confirm(`请先检查 Gmail 已发送和草稿。\n\n解除 ${entry.container} 的锁定会允许再次生成同类邮件。确认已核实并需要重新生成？`))return;try{await rpc({type:'release',key});await refreshState();status('已解除该条记录的锁定。');}catch(error){status(error.message,'error');}});
    buttons.append(release);row.append(content,buttons);root.append(row);
  }
}
async function refreshState({initial=false}={}){
  const state=await rpc({type:'state'});settings=validateSettings(state.settings);renderHistory(state.ledger);
  if(initial){
    hydrateSettings();const saved=storedInput();$('container').value=saved.container||'';
    fillSelect('carrier',true,saved.carrierId||settings.defaultCarrierId);$('inquiryType').value=types[saved.inquiryType]?saved.inquiryType:settings.defaultInquiryType;
    const restore=state.operation?.status==='running'||!saved.container||saved.container===state.operation?.container;
    if(restore)syncOperation(state.operation,{restore:true});
    else {lastOperationId=state.operation?.id||'';lastRenderedOperation=lastOperationId;}
    if(!state.operation||!restore)status(demo?'界面演示：MRSU4786640 为 Maersk 示例；MSCU1234567 为 MSC 示例。':settings.testMode!==false?'输入完整柜号即可查表。测试模式下不会发送邮件。':'输入完整柜号即可查表。正式发送需要点击发送按钮。');
  }else syncOperation(state.operation);
  return state;
}
function startPolling(){
  if(pollTimer)return;
  pollTimer=setInterval(async()=>{if(polling)return;polling=true;try{const state=await refreshState();if(state.operation?.status!=='running'&&!busy){clearInterval(pollTimer);pollTimer=null;}}catch(error){status(error.message,'error');}finally{polling=false;}},850);
}
async function perform(mode,forceRefresh=false){
  clearTimeout(debounce);if(busy||initializing||!$('inquiry').reportValidity())return;
  if(mode==='identify'){lastResult=null;$('manualMbl').value='';missingConfiguration=false;clearPreview();}
  const sequence=++requestSequence;rememberInput();setBusy(true);status(mode==='identify'?'正在匹配本地数据，未命中时查表…':'正在准备 Gmail 邮件…','running');
  const previousOperation=lastOperationId;
  try{
    startPolling();const data=await rpc({type:'run',mode,container:$('container').value.trim().toUpperCase(),options:{...options(),forceRefresh,...(mode==='identify'?{}:{manualMbl:$('manualMbl').value,useConfirmed:true})}});
    if(sequence!==requestSequence)return;
    setBusy(false);reportResult(data,mode);
    const state=await rpc({type:'state'});renderHistory(state.ledger);if(state.operation?.id!==previousOperation){lastOperationId=state.operation?.id||lastOperationId;lastRenderedOperation=lastOperationId;}
  }catch(error){if(sequence===requestSequence){setBusy(false);if(mode==='identify')lookupError(error.message);status(error.message,'error');try{const state=await rpc({type:'state'});renderHistory(state.ledger);lastRenderedOperation=state.operation?.id||lastRenderedOperation;}catch{}}}
  finally{if(sequence===requestSequence&&!busy){clearInterval(pollTimer);pollTimer=null;}}
}
function editMatch(){
  if(busy)return;
  const selected=$('carrier').value;
  const profile=settings.carriers.find(p=>p.id===(selected==='auto'?lastResult?.carrierId:selected));
  renderResult({...lastResult,container:$('container').value.trim().toUpperCase(),mbl:$('manualMbl').value.trim().toUpperCase(),
    carrierId:profile?.id,carrierName:profile?.name,carrierSource:selected==='auto'?lastResult?.carrierSource:'manual',
    inquiryType:$('inquiryType').value,configurationMissing:undefined,unrecognizedCarrier:profile?'':'unknown',recognitionError:profile?'':'请选择船公司。'});
}
$('clearCache').addEventListener('click',async()=>{
  clearTimeout(debounce);if(busy)return;
  try{
    setBusy(true);await rpc({type:'clearCache'});
    lastResult=null;lastOperationId='';lastRenderedOperation='';draftTabId=null;missingConfiguration=false;
    $('manualMbl').value='';$('needsConfig').hidden=true;$('openDraft').hidden=true;
    lookupError('本地缓存已清除，请点击查询或重新粘贴柜号。');
    status('本地缓存已清除，航司配置和邮件操作记录已保留。','success');
  }catch(error){status(error.message,'error');}finally{setBusy(false);}
});
function scheduleIdentify(){
  clearTimeout(debounce);rememberInput();draftTabId=null;$('openDraft').hidden=true;
  if(busy||initializing)return;
  lastResult=null;$('manualMbl').value='';missingConfiguration=false;$('needsConfig').hidden=true;clearPreview();$('matchCarrier').textContent='等待重新识别';$('matchMbl').textContent='MBL 将从「提柜」匹配';$('matchSource').textContent='仅查表，不会发送邮件';setBusy(false);
  if(/^[A-Za-z]{4}\d{7}$/.test($('container').value.trim()))debounce=setTimeout(()=>perform('identify'),700);
}
async function saveSettings(next){
  if(busy)throw new Error('后台操作进行中，请完成后再修改配置。');
  const normalized=validateSettings(next);settings=validateSettings(await rpc({type:'settings',settings:normalized}));hydrateSettings();
  if(lastResult){const refreshed={...lastResult,configurationMissing:undefined};renderResult(refreshed);}setBusy(false);
}
async function openDraft(tabId){if(busy)return;try{await rpc({type:'openDraft',tabId});}catch(error){status(error.message,'error');}}
function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function scriptText(){const response=await fetch('./airscript/LFD_ReadOnly.js');if(!response.ok)throw new Error('无法读取插件中的只读脚本。');return response.text();}
document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>showPage(button.dataset.page)));
$('container').addEventListener('input',()=>{$('container').value=$('container').value.toUpperCase().replace(/\s/g,'');scheduleIdentify();});
for(const id of ['carrier','inquiryType'])$(id).addEventListener('change',editMatch);$('manualMbl').addEventListener('input',editMatch);
$('inquiry').addEventListener('submit',event=>{event.preventDefault();perform('send');});$('identify').addEventListener('click',()=>perform('identify'));$('draft').addEventListener('click',()=>perform('draft'));$('openDraft').addEventListener('click',()=>openDraft(draftTabId));
$('configureDetected').addEventListener('click',()=>{const id=lastResult?.carrierId||lastResult?.carrier?.id;if(settings.carriers.some(p=>p.id===id)){showPage('config');loadProfile(id);$('page-config').scrollTop=0;$('carrierTo').focus();}else startNewProfile(typeof lastResult?.carrier==='string'?lastResult.carrier:'新船公司');});
$('newCarrier').addEventListener('click',()=>startNewProfile());$('editCarrier').addEventListener('change',()=>loadProfile($('editCarrier').value));
$('standardTemplate').addEventListener('click',()=>{$('bodyTemplate').value=DEFAULT_BODY_TEMPLATE;$('subjectTemplate').value=DEFAULT_SUBJECT_TEMPLATE;status('已填入标准模板，点击保存后生效。');});
$('carrierForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  try{
    const original=newProfile||settings.carriers.find(p=>p.id===editingId);
    const list=value=>value.split(/[,;，；\n]+/).map(v=>v.trim()).filter(Boolean);
    const profile={...original,name:$('carrierName').value.trim(),greeting:$('greeting').value.trim(),to:addressList($('carrierTo').value),cc:addressList($('carrierCc').value),aliases:list($('aliases').value),mblPrefixes:$('mblPrefixes').value.split(/[\s,;，；]+/).filter(Boolean),bodyTemplate:$('bodyTemplate').value,subjectTemplate:$('subjectTemplate').value};
    const carriers=newProfile?[...settings.carriers,profile]:settings.carriers.map(p=>p.id===editingId?profile:p);const id=profile.id;
    await saveSettings({...settings,carriers});loadProfile(id);status(`${profile.name} 配置已保存${!profile.to.length||!profile.bodyTemplate?'，补齐邮箱和正文后可生成邮件。':'。'}`,'success');
  }catch(error){status(error.message,'error');}
});
$('deleteCarrier').addEventListener('click',async()=>{
  if(busy||settings.carriers.length<2)return;const profile=settings.carriers.find(p=>p.id===editingId);
  if(!confirm(`删除 ${profile.name} 的船公司配置？操作记录仍然保留。`))return;
  try{const carriers=settings.carriers.filter(p=>p.id!==editingId);editingId=carriers[0].id;await saveSettings({...settings,carriers,defaultCarrierId:settings.defaultCarrierId===profile.id?'auto':settings.defaultCarrierId});status('船公司配置已删除。');}catch(error){status(error.message,'error');}
});
$('connectionForm').addEventListener('submit',async event=>{event.preventDefault();try{await saveSettings({...settings,sheetUrl:$('sheetUrl').value.trim(),account:$('account').value.trim(),gmailIndex:Number($('gmailIndex').value),testMode:$('testMode').checked,defaultCarrierId:$('defaultCarrierId').value,defaultInquiryType:$('defaultInquiryType').value});status('连接与默认选项已保存。','success');}catch(error){status(error.message,'error');}});
$('exportConfig').addEventListener('click',()=>{try{download(JSON.stringify(createConfig(settings),null,2)+'\n','lfd-inquiry-config.json','application/json');status('配置 JSON 已导出。','success');}catch(error){status(error.message,'error');}});
$('importFile').addEventListener('change',async event=>{
  pendingImport=null;$('importReview').hidden=true;const file=event.target.files[0];if(!file)return;
  try{if(file.size>MAX_CONFIG_BYTES)throw new Error('配置文件超过 256 KiB。');pendingImport=parseConfig(await file.text());$('importSummary').textContent=`将替换为 ${pendingImport.carriers.length} 家船公司：${pendingImport.carriers.map(p=>p.name).join('、')}。发件账号：${pendingImport.account}。操作记录保留，测试模式开启。`;$('importReview').hidden=false;status('已校验配置文件；查看摘要后点击应用。');}catch(error){status(error.message,'error');}finally{event.target.value='';}
});
$('applyImport').addEventListener('click',async()=>{if(!pendingImport)return;try{await saveSettings(pendingImport);pendingImport=null;$('importReview').hidden=true;status('配置已导入，测试模式已开启。','success');}catch(error){status(error.message,'error');}});
$('cancelImport').addEventListener('click',()=>{pendingImport=null;$('importReview').hidden=true;});
$('copyScript').addEventListener('click',async()=>{try{const text=await scriptText();try{await navigator.clipboard.writeText(text);status('只读脚本已复制，可到金山文档粘贴并保存。','success');}catch{$('scriptFallback').hidden=false;$('scriptFallback').value=text;$('scriptFallback').focus();$('scriptFallback').select();status('请复制下方已选中的脚本，或点击下载。');}}catch(error){status(error.message,'error');}});
$('downloadScript').addEventListener('click',async()=>{try{download(await scriptText(),'LFD_ReadOnly_v1.js','text/javascript');status('只读脚本已下载。','success');}catch(error){status(error.message,'error');}});
$('refresh').addEventListener('click',()=>refreshState().catch(error=>status(error.message,'error')));
try{await refreshState({initial:true});}catch(error){status(error.message,'error');}finally{initializing=false;if(!lastResult&&!busy&&/^[A-Za-z]{4}\d{7}$/.test($('container').value.trim()))scheduleIdentify();}
