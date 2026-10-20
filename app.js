import {messageTemplate,portalTemplate,recognizeCarrier,containerNumber,DEFAULT_BODY_TEMPLATE,DEFAULT_SUBJECT_TEMPLATE,COSCO_PORTAL,ONE_CHAT,PORTAL_INQUIRY_TYPE,DEFAULT_CARRIERS,chatTemplate,addressList,INQUIRY_TYPES,ON_HIRE,inquiryChannel} from './core.js';
import {DEFAULT_SETTINGS,validateSettings,createConfig,parseConfig,MAX_CONFIG_BYTES} from './config.js';
const $=id=>document.getElementById(id);
const demo=!globalThis.chrome?.runtime?.id;
const copy=value=>JSON.parse(JSON.stringify(value));
const types=INQUIRY_TYPES;
const sources={sheet:'提柜表航司列','mbl-prefix':'MBL 前缀',manual:'手动选择'};
let settings=copy(DEFAULT_SETTINGS),busy=false,initializing=true,debounce,pollTimer,polling=false,requestSequence=0,lastOperationId='',lastRenderedOperation='',lastResult=null,draftTabId=null,missingConfiguration=false,editingId='',newProfile=null,pendingImport=null;
let demoSettings=copy(DEFAULT_SETTINGS),demoOperation=null,lookingUp=false,tasksTimer=null;
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
        result={...record,carrierId:profile.id,carrierName:profile.name,carrierSource:recognized.carrierSource,inquiryType:message.options.inquiryType,configurationMissing:profile.channel==='one-chat'?[]:[...(profile.channel!=='cosco-portal'&&!profile.to.length?['to']:[]),...(!profile.bodyTemplate.trim()?['bodyTemplate']:[])]};
      }catch(error){result={...record,inquiryType:message.options.inquiryType,unrecognizedCarrier:true,recognitionError:error.message,configurationMissing:['carrier']};}
      demoOperation={...demoOperation,status:'complete',result};return result;
    }
    throw new Error('界面演示不会操作真实 Gmail 或在线表格。');
  }
  const response=await chrome.runtime.sendMessage(message);
  if(!response?.ok)throw Object.assign(new Error(response?.error||'插件未返回结果。请检查 Gmail 后再操作。'),response?.duplicate?{duplicate:response.duplicate}:{});
  return response.data;
}
// Not found in the cache nor in the sheet: query once, then let the user decide whether to look again.
const notFound=message=>/未找到该柜号/.test(message||'');
let notFoundContainer='';
function showNotFound(container){
  notFoundContainer=container;
  $('notFoundText').textContent=`提柜表中找不到柜号 ${container}，请检查柜号是否输入正确。`;
  if(!$('notFound').open)$('notFound').showModal();
}
// Sending was blocked by existing records (duplicate lock): show them and offer a forced resend.
const recordStatus={preparing:'准备中',draft:'草稿已生成 / 已填写未提交',sending:'发送中',sent:'已发送',uncertain:'结果待核实',needs_review:'未完成'};
let duplicateRetry=null;
function showDuplicate(blocking,mode){
  const running=blocking.some(b=>b.running);
  $('duplicateText').textContent=blocking.map(b=>`${b.container}：${recordStatus[b.status]||b.status}${b.time?'（'+new Date(b.time).toLocaleString()+'）':''}`).join('\n')
    +(running?'\n\n该任务仍在后台进行，请先在「进行中」终止。':'\n\n「强制重发」会解除这条记录的锁定并重新发送；如果之前其实已经发出，对方会收到重复的邮件 / 消息。');
  $('duplicateForce').disabled=running;
  duplicateRetry={blocking,mode};
  if(!$('duplicate').open)$('duplicate').showModal();
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
  if(!value){syncSendButtons();$('deleteCarrier').disabled=!newProfile&&settings.carriers.length<2;}
}
function syncSendButtons(){
  const pendingExtra=$('extraContainers').hidden?0:blockedRows();
  $('send').disabled=busy||lookingUp||pendingExtra>0||missingConfiguration||!$('manualMbl').value.trim();$('draft').disabled=$('send').disabled;
}
function syncMode(){
  const test=settings.testMode!==false;
  $('modeBadge').textContent=demo?'界面演示 · 示例数据':test?'测试模式 · 不发送':'正式模式';
  $('modeBadge').classList.toggle('live',!test&&!demo);
  const channel=matchedChannel(),portal=channel==='cosco-portal',chat=channel==='one-chat';
  // 「＋」 (more containers in the same chat) only exists for ONE; other carriers hide it and any extra boxes.
  // Several containers: ONE chats and On-Hire emails.
  const multi=chat||(Boolean(matchedProfile())&&$('inquiryType').value===ON_HIRE);
  $('addContainer').hidden=!multi;$('extraContainers').hidden=!multi&&Boolean(matchedProfile());$('removeMain').hidden=!rows().length;
  const count=multi?1+extraContainers().length:1,suffix=count>1?` · ${count} 个柜号`:'';
  const system=channel==='email'&&mailProgram(settings.mailClient);
  $('send').textContent=system?(test?'打开邮件程序（测试模式）':'打开邮件程序发送')+suffix:chat?(test?`联系 ONE 客服（测试模式·不发送）${count>1?' · '+count+' 个柜号':''}`:`发送 ONE 在线客服消息${count>1?'（'+count+' 个柜号）':''}`):portal?(test?'填写 COSCO 工单（测试模式）':'提交 COSCO 工单')+suffix:(test?'生成草稿（测试模式）':'发送邮件')+suffix;
  $('draft').textContent=system?'打开邮件程序':chat?'转人工但不发送':portal?'仅填写工单':'仅生成草稿';
}
// The channel the current inquiry will use (On-Hire is always email).
function matchedChannel(){const profile=matchedProfile();return profile?inquiryChannel(profile,$('inquiryType').value):undefined;}
function matchedProfile(){const selected=$('carrier').value;return settings.carriers.find(p=>p.id===(selected&&selected!=='auto'?selected:lastResult?.carrierId));}
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
  for(const key of ['sheetUrl','account','gmailIndex','defaultInquiryType','mailClient'])$(key).value=settings[key];syncMailClientNotice();
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
  $('channel').value=profile.channel||'email';fillPortal(profile.portal);fillChat(profile.chat);syncChannel();
  const onHire=profile.onHire||{to:[],cc:[],subjectTemplate:'',bodyTemplate:''};
  $('onHireTo').value=onHire.to.join(', ');$('onHireCc').value=onHire.cc.join(', ');$('onHireSubject').value=onHire.subjectTemplate||'';$('onHireBody').value=onHire.bodyTemplate||'';
  const incomplete=profile.channel==='one-chat'?false:profile.channel==='cosco-portal'?!profile.portal?.requester||!profile.bodyTemplate:!profile.to.length||!profile.bodyTemplate;
  $('profileState').textContent=incomplete?'尚未完成 · 可先保存配置':'已配置';
  $('deleteCarrier').hidden=Boolean(profileOverride);$('deleteCarrier').disabled=busy||settings.carriers.length<2;
}
function fillPortal(portal={}){for(const [field,key]of [['portalRequester','requester'],['portalReference','reference'],['portalShipmentType','shipmentType'],['portalService','service']])$(field).value=portal?.[key]||'';}
function fillChat(chat={}){for(const [field,key]of [['chatFirstName','firstName'],['chatLastName','lastName'],['chatEmail','email'],['chatCountry','country'],['chatMessage','message']])$(field).value=chat?.[key]||'';}
function syncChannel(){const channel=$('channel').value,portal=channel==='cosco-portal',chat=channel==='one-chat';$('emailFields').hidden=portal||chat;$('subjectFields').hidden=portal||chat;$('portalFields').hidden=!portal;$('chatFields').hidden=!chat;$('bodyFields').hidden=chat;}
function startNewProfile(name='新船公司'){
  // Settings saved before COSCO / ONE support existed lack those built-in profiles; offer them by name.
  const builtin=DEFAULT_CARRIERS.find(p=>p.channel!=='email'&&!settings.carriers.some(c=>c.id===p.id)&&[p.name,...p.aliases].some(alias=>alias.toUpperCase()===name.trim().toUpperCase()));
  if(builtin){
    fillSelect('editCarrier',false,editingId);loadProfile(builtin.id,copy(builtin));showPage('config');$('page-config').scrollTop=0;status(`已填入 ${builtin.name} ${builtin.channel==='one-chat'?'在线客服':'工单'}默认配置，核对后点击保存。`);return;
  }
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
  const type=data.inquiryType||$('inquiryType').value,onHire=type===ON_HIRE;
  const channel=profile?inquiryChannel(profile,type):undefined,portal=channel==='cosco-portal',chat=channel==='one-chat';
  const missing=data.configurationMissing||(portal&&onHire?(profile.portal.requester?[]:['requester']):onHire&&profile?[...(!profile.onHire.to.length?['onHireTo']:[]),...(!profile.onHire.bodyTemplate?['onHireBody']:[]),...(!profile.onHire.subjectTemplate?['onHireSubject']:[])]
    :chat?[]:[...(!profile?['carrier']:[]),...(profile&&!portal&&!profile.to.length?['to']:[]),...(portal&&!profile.portal.requester?['requester']:[]),...(profile&&!profile.bodyTemplate?['bodyTemplate']:[])]);
  if(portal&&!onHire)$('inquiryType').value=PORTAL_INQUIRY_TYPE;
  refreshRows();
  missingConfiguration=missing.length>0||Boolean(data.unrecognizedCarrier);
  $('matchCarrier').textContent=data.unrecognizedCarrier?'需要选择船公司':data.carrierName||profile?.name||'等待识别';
  $('manualMbl').value=record.mbl||'';$('matchMbl').textContent=record.mbl||'请手动填写 MBL';
  $('matchSource').textContent=data.unrecognizedCarrier?data.recognitionError||'无法自动识别':sources[data.carrierSource||record.carrierSource]||'自动识别';
  $('previewType').textContent=types[portal&&!onHire?PORTAL_INQUIRY_TYPE:type]||type;
  $('source').textContent=data.demo?'界面演示 · 示例数据':record.row?`${record.fromCache?'本地缓存':'提柜'} · 第 ${record.row} 行${record.sourceTime?' · '+new Date(record.sourceTime).toLocaleTimeString():''}`:'来自本次提柜表查询';
  $('needsConfig').hidden=!missingConfiguration;
  if(missingConfiguration){
    $('missingTitle').textContent=data.unrecognizedCarrier?'暂未识别船公司':'首次使用：请补充配置';
    const names={onHireTo:'On-Hire 收件邮箱',onHireBody:'On-Hire 正文模板',onHireSubject:'On-Hire 主题模板',carrier:'船公司',to:'收件邮箱',requester:'工单 Requester',body:'正文模板',bodyTemplate:'正文模板',subjectTemplate:'主题模板'};
    $('missingDetail').textContent=data.recognitionError||`请为 ${profile?.name||data.carrierName||'此船公司'} 填写${missing.map(key=>names[key]||key).join('、')}，再生成邮件。`;
    $('configureDetected').textContent=profile?'配置 '+profile.name:'新增或选择船公司';clearPreview();
  }else{
    try{
      if(chat){
        const message=chatTemplate(record,{carrier:profile,inquiryType:type,more:extraContainers()});
        $('to').textContent=`ONE 在线客服 · ${message.firstName} ${message.lastName} · ${message.email}`;$('cc').textContent='—';$('subject').textContent=`Container Number · ${record.container}${message.messages.length>1?` · 共 ${message.messages.length} 条消息`:''}`;
        $('mailBody').replaceChildren();for(const line of message.messages){const p=document.createElement('p');p.textContent=line;$('mailBody').append(p);}
      }else if(portal){
        const ticket=portalTemplate(record,{carrier:profile,inquiryType:type,...(onHire?{more:extraContainers()}:{})});
        $('to').textContent=`COSCO 工单 · ${new URL(ticket.url).hostname} · Requester ${ticket.requester}`;$('cc').textContent='—';$('subject').textContent=ticket.fields.map(f=>f.value).join(' · ');$('mailBody').innerHTML=ticket.html;
      }else{
        const message=messageTemplate(record,{carrier:profile,inquiryType:type,...(onHire?{more:extraContainers()}:{})});
        $('to').textContent=message.to.join(', ');$('cc').textContent=message.cc.join(', ')||'—';$('subject').textContent=message.subject;$('mailBody').innerHTML=message.html;
      }
    }catch(error){clearPreview();status(error.message,'error');}
  }
  draftTabId=data.status==='draft'&&Number.isInteger(data.tabId)?data.tabId:null;$('openDraft').hidden=draftTabId===null;
  $('openDraft').textContent=chat?'打开 ONE 聊天页 ↗':portal?'打开 COSCO 工单页 ↗':'打开 Gmail 草稿 ↗';$('signatureNote').hidden=portal||chat;$('signatureNote').textContent=settings.mailClient==='foxmail'?'＋ Foxmail 中的签名':settings.mailClient==='system'?'＋ 邮件程序中的签名（纯文本正文）':'＋ Gmail 中的原签名';
  syncMode();setBusy(busy);
}
function reportResult(data,mode){
  renderResult(data);
  const portal=data.channel==='cosco-portal',chat=data.channel==='one-chat';
  if(mailProgram(data.mailClient)&&data.status==='draft'){status(`已打开${data.mailClient==='foxmail'?' Foxmail ':'邮件程序'}写信窗口。请检查后在邮件程序里发送，发完后到「进行中」或「记录」点「我已发送」。`,'success');return;}
  if(data.background){status(`已加入后台任务：${(data.containers||[data.container]).join('、')}。可在「进行中」查看进度，现在可以继续查询其他柜号。`,'success');return;}
  if(data.status==='draft')status(chat?`ONE 客服${data.agent?' '+data.agent:''}已接入，消息已填入聊天框，测试模式下未发送。可打开聊天页查看。`:portal?'COSCO 工单已填好，测试模式下未提交。可打开工单页检查。':'Gmail 草稿已填好，原签名已保留，尚未发送。可打开草稿检查。','success');
  else if(data.status==='sent')status(chat?`已查询：ONE 客服${data.agent?' '+data.agent:''}已读消息，回复请在聊天页查看。`:portal?`COSCO 工单已提交${data.ticketId?' #'+data.ticketId:''}。`:'Gmail 已显示发送成功。','success');
  else if(data.unrecognizedCarrier)status(data.recognitionError||'请选择船公司或补充识别规则。','error');
  else if(missingConfiguration)status('已匹配柜号和船公司；完成提示中的配置后即可生成草稿。');
  else status(data.demo?'演示匹配完成；未读取在线表格，也不会创建邮件。':mode==='identify'?(data.channel==='one-chat'?'已匹配 MBL 和船公司。点击发送 ONE 在线客服消息继续。':data.channel==='cosco-portal'?'已匹配 MBL 和船公司。点击填写 COSCO 工单继续。':'已匹配 MBL 和船公司。点击生成草稿继续。'):'邮件预览已更新。','success');
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
    if(operation.mode==='identify'){lookingUp=true;syncSendButtons();}else setBusy(true);status(operation.mode==='identify'?'正在查表并识别船公司… 可关闭弹窗，后台会继续。':matchedChannel()==='one-chat'&&operation.mode!=='identify'?'正在后台联系 ONE 在线客服，转人工可能需要几分钟… 可关闭弹窗。':matchedChannel()==='cosco-portal'&&operation.mode==='send'?'已打开 COSCO 工单页：请在该页完成人机验证，插件随后自动提交（3 分钟内）。':'正在后台准备邮件… 可关闭弹窗，完成后重新打开查看。','running');startPolling();return;
  }
  if(operation.id&&lastRenderedOperation===operation.id)return;
  lastRenderedOperation=operation.id||'';
  if(operation.mode==='identify'&&operation.status!=='running'){lookingUp=false;}
  if(operation.status==='complete'){setBusy(false);reportResult(operation.result,operation.mode);}
  else if(operation.status==='failed'||operation.status==='interrupted'){setBusy(false);if(operation.mode==='identify')lookupError(operation.error||'请点击重新查表。');if(operation.mode==='identify'&&notFound(operation.error)&&operation.container===$('container').value.trim().toUpperCase())showNotFound(operation.container);status(operation.error||(operation.status==='interrupted'?'上次操作已中断，请先检查 Gmail 草稿和已发送记录。':'操作失败。'),'error');}
}
function renderHistory(ledger={}){
  const root=$('history');root.replaceChildren();const entries=Object.entries(ledger).sort((a,b)=>(b[1].time||0)-(a[1].time||0));$('historyCount').textContent=entries.length;
  if(!entries.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='暂无操作记录';root.append(empty);return;}
  const statuses={preparing:'准备中 / 中断待核实',draft:'草稿已生成 · 未自动发送',sending:'发送中 / 待核实',sent:'Gmail 已确认发送',uncertain:'发送结果待核实',needs_review:'准备失败，请检查草稿'};
  const chatStatuses={preparing:'准备中 / 中断待核实',draft:'客服已接入 · 消息未发送（测试模式）',sending:'联系客服中 / 待核实',sent:'已查询（客服已读）',uncertain:'客服消息结果待核实',needs_review:'消息未发送，请检查聊天页'};
  const portalStatuses={preparing:'准备中 / 中断待核实',draft:'工单已填写 · 未提交',sending:'等待人机验证 / 提交中',sent:'COSCO 工单已提交',uncertain:'工单提交结果待核实',needs_review:'工单未提交，请检查页面'};
  for(const [key,entry]of entries){
    const row=document.createElement('div');row.className='history-row';
    const content=document.createElement('div'),name=document.createElement('strong');name.textContent=entry.container+' · '+entry.mbl;content.append(name);
    const detail=document.createElement('p');detail.textContent=`${entry.carrierName||'Maersk'} · ${types[entry.inquiryType]||'Demurrage'} · ${new Date(entry.time).toLocaleString()}`;content.append(detail);
    const portal=entry.channel==='cosco-portal',chat=entry.channel==='one-chat',system=mailProgram(entry.mailClient);
    const state=document.createElement('div');state.className='history-state';state.textContent=(system&&entry.status==='draft'?'已打开邮件程序 · 待确认发送':system&&entry.status==='sent'?'已发送（用户确认）':(chat?chatStatuses:portal?portalStatuses:statuses)[entry.status]||entry.status)+(entry.ticketId?` #${entry.ticketId}`:'')+(entry.agent?` · ${entry.agent}`:'');content.append(state);
    if(entry.detail){const note=document.createElement('p');note.textContent=entry.detail;content.append(note);}
    const buttons=document.createElement('div');buttons.className='history-buttons';
    if(['draft','uncertain',...(portal||chat?['needs_review']:[])].includes(entry.status)&&Number.isInteger(entry.tabId)){const open=document.createElement('button');open.textContent=chat?'打开聊天页':portal?'打开工单页':entry.status==='draft'?'打开草稿':'打开写信页';open.disabled=busy;open.addEventListener('click',()=>openDraft(entry.tabId));buttons.append(open);}
    if(system&&entry.status==='draft'){
      const reopen=document.createElement('button');reopen.textContent='重新打开邮件';reopen.addEventListener('click',()=>openMailto(entry.mailto));
      const sent=document.createElement('button');sent.textContent='我已发送';sent.addEventListener('click',()=>markSent(entry.requestId));buttons.append(reopen,sent);
    }
    const release=document.createElement('button');release.textContent='解除锁定';release.disabled=busy;
    release.addEventListener('click',async()=>{if(busy||!confirm(`${entry.channel==='one-chat'?'请先检查 ONE 聊天页中消息是否已发送。':entry.channel==='cosco-portal'?'请先检查 COSCO 工单是否已提交（工单页或 Requester 邮箱的确认邮件）。':'请先检查 Gmail 已发送和草稿。'}\n\n解除 ${entry.container} 的锁定会允许再次生成同类邮件。确认已核实并需要重新生成？`))return;try{await rpc({type:'release',key});await refreshState();status('已解除该条记录的锁定。');}catch(error){status(error.message,'error');}});
    buttons.append(release);row.append(content,buttons);root.append(row);
  }
}
function renderTasks(ledger={}){
  // Running tasks, plus tasks that need attention (failed, interrupted, unconfirmed) from the last 24 hours.
  const groups=new Map();
  for(const entry of Object.values(ledger)){
    const attention=entry.interrupted||(mailProgram(entry.mailClient)&&entry.status==='draft')||['needs_review','uncertain','preparing','sending'].includes(entry.status);
    if(!entry.running&&!attention)continue;
    const id=entry.requestId||entry.container;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(entry);
  }
  const all=[...groups.values()].sort((a,b)=>(b[0].time||0)-(a[0].time||0));
  const running=all.filter(group=>group[0].running),attention=all.filter(group=>!group[0].running);
  $('taskCount').textContent=running.length;
  const root=$('tasks');root.replaceChildren();
  const heading=text=>{const h=document.createElement('h3');h.className='task-heading';h.textContent=text;root.append(h);};
  const row=group=>{
    const entry=group[0],item=document.createElement('div');item.className='task-row';
    const content=document.createElement('div'),name=document.createElement('strong');name.textContent=group.map(e=>e.container).join('、');content.append(name);
    const detail=document.createElement('p');const minutes=Math.max(0,Math.round((Date.now()-(entry.time||Date.now()))/60000));
    detail.textContent=`${entry.carrierName||''} · ${types[entry.inquiryType]||''} · ${new Date(entry.time).toLocaleTimeString()} 开始${entry.running?` · 已 ${minutes} 分钟`:''}`;content.append(detail);
    const step=document.createElement('div');step.className='task-step'+(entry.running?'':' interrupted');
    step.textContent=entry.running?(entry.step||'进行中')+(entry.agent?` · ${entry.agent}`:''):mailProgram(entry.mailClient)&&entry.status==='draft'?'已打开邮件程序，发完后请点「我已发送」':entry.interrupted?'已中断，请打开页面核实结果':`${entry.status==='uncertain'?'结果待核实':'未完成'}：${entry.detail||''}`;content.append(step);
    const buttons=document.createElement('div');buttons.className='history-buttons';
    if(Number.isInteger(entry.tabId)){const open=document.createElement('button');open.textContent=entry.channel==='one-chat'?'打开聊天':entry.channel==='cosco-portal'&&/人机验证/.test(entry.step||'')?'去验证':'打开页面';open.addEventListener('click',()=>openDraft(entry.tabId));buttons.append(open);}
    if(entry.running){
      const stop=document.createElement('button');stop.textContent='终止';stop.className='danger-button';
      stop.addEventListener('click',async()=>{if(!confirm(`终止 ${group.map(e=>e.container).join('、')} 的任务？插件会关闭它的窗口。已经发出的消息无法撤回。`))return;try{await rpc({type:'cancel',requestId:entry.requestId});status('任务已终止。');await refreshState();}catch(error){status(error.message,'error');}});
      buttons.append(stop);
    }else{
      if(mailProgram(entry.mailClient)&&entry.status==='draft'){
        const reopen=document.createElement('button');reopen.textContent='重新打开邮件';reopen.addEventListener('click',()=>openMailto(entry.mailto));
        const sent=document.createElement('button');sent.textContent='我已发送';sent.addEventListener('click',()=>markSent(entry.requestId));buttons.append(reopen,sent);
      }
      if(['uncertain','needs_review'].includes(entry.status)&&!entry.interrupted||entry.interrupted){
        const verified=document.createElement('button');verified.textContent='我已核实已发送';verified.title='在对应页面确认消息/邮件确实已经发出后点击，记录改为已发送并保持防重复锁';
        verified.addEventListener('click',()=>{if(confirm('确认这条消息/邮件确实已经发出？记录会改为已发送，并继续防止重复发送。'))markSent(entry.requestId);});buttons.append(verified);
      }
      // Release the lock and put the containers back on the query page for the user to send again.
      const resend=document.createElement('button');resend.textContent='重新发送';
      resend.addEventListener('click',async()=>{
        if(!confirm(`解除 ${group.map(e=>e.container).join('、')} 的锁定并重新填回查询页？${entry.status==='uncertain'?'\n\n注意：结果待核实，之前可能已经发出，重新发送可能重复。':''}`))return;
        try{await rpc({type:'deleteTask',requestId:entry.requestId});await refreshState();refill(group.map(e=>e.container),entry);}catch(error){status(error.message,'error');}
      });buttons.append(resend);
      const remove=document.createElement('button');remove.textContent='删除';
      remove.addEventListener('click',async()=>{if(!confirm(`删除 ${group.map(e=>e.container).join('、')} 的任务？会解除防重复锁，之后可以重新查询发送。${entry.status==='uncertain'?'\n\n注意：这个任务的结果待核实，消息可能已经发出，请先核实。':''}`))return;try{await rpc({type:'deleteTask',requestId:entry.requestId});status('任务已删除，可以重新发送。');await refreshState();}catch(error){status(error.message,'error');}});
      buttons.append(remove);
    }
    item.append(content,buttons);root.append(item);
  };
  if(!all.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='没有进行中的任务';root.append(empty);}
  if(running.length){heading(`进行中（${running.length}）`);running.forEach(row);}
  if(attention.length){heading(`需要处理（${attention.length}）`);attention.forEach(row);}
  // Keep the list fresh while anything runs in the background.
  if(running.length&&!tasksTimer)tasksTimer=setInterval(()=>refreshState().catch(()=>{}),2000);
  if(!running.length&&tasksTimer){clearInterval(tasksTimer);tasksTimer=null;}
}
// Put containers back on the query page (first in the main box, others as extra rows) with the same type.
function refill(containers,entry){
  showPage('query');$('extraContainers').replaceChildren();
  if(entry.inquiryType)$('inquiryType').value=entry.inquiryType;
  $('container').value=containers[0];$('container').dispatchEvent(new Event('input',{bubbles:true}));
  for(const container of containers.slice(1))addExtraRow(container,{focus:false});
  status('已解除锁定并填回查询页，确认后点击发送。');
}
async function refreshState({initial=false}={}){
  const state=await rpc({type:'state'});settings=validateSettings(state.settings);renderHistory(state.ledger);renderTasks(state.ledger);
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
  const multi=matchedChannel()==='one-chat'||$('inquiryType').value===ON_HIRE;
  const more=mode==='identify'||!multi?[]:extraContainers();
  if(mode!=='identify'&&multi&&blockedRows()){status('列表中有柜号尚未查到、找不到或船公司不同，请删除后再发送。','error');return;}
  if(mode==='identify'){lastResult=null;$('manualMbl').value='';missingConfiguration=false;clearPreview();}
  // Lookups never lock the popup: the user can type the next container while this one is read.
  const sequence=++requestSequence;rememberInput();
  if(mode==='identify'){lookingUp=true;syncSendButtons();}else setBusy(true);
  status(mode==='identify'?'正在匹配本地数据，未命中时查表… 可以继续输入其他柜号。':'正在加入后台任务…','running');
  const previousOperation=lastOperationId;
  try{
    startPolling();const data=await rpc({type:'run',mode,container:$('container').value.trim().toUpperCase(),options:{...options(),forceRefresh,...(mode==='identify'?{}:{manualMbl:$('manualMbl').value,useConfirmed:true,...(more.length?{more}:{})})}});
    if(sequence!==requestSequence)return;
    lookingUp=false;setBusy(false);
    if(data.mailto)openMailto(data.mailto);
    if(data.mailto||data.background){$('extraContainers').replaceChildren();syncMode();}
    reportResult(data,mode);
    if(data.background){$('extraContainers').replaceChildren();syncMode();}
    const state=await rpc({type:'state'});renderHistory(state.ledger);renderTasks(state.ledger);if(state.operation?.id!==previousOperation){lastOperationId=state.operation?.id||lastOperationId;lastRenderedOperation=lastOperationId;}
  }catch(error){if(sequence===requestSequence&&error.duplicate&&mode!=='identify'){lookingUp=false;setBusy(false);status(error.message,'error');showDuplicate(error.duplicate,mode);return;}
    if(sequence===requestSequence){lookingUp=false;setBusy(false);if(mode==='identify')lookupError(error.message);status(error.message,'error');if(mode==='identify'&&notFound(error.message))showNotFound($('container').value.trim().toUpperCase());try{const state=await rpc({type:'state'});renderHistory(state.ledger);renderTasks(state.ledger);lastRenderedOperation=state.operation?.id||lastRenderedOperation;}catch{}}}
  finally{if(sequence===requestSequence&&!busy&&!lookingUp){clearInterval(pollTimer);pollTimer=null;}}
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
  clearTimeout(debounce);if($('notFound').open)$('notFound').close();rememberInput();draftTabId=null;$('openDraft').hidden=true;
  if(busy||initializing)return;
  lastResult=null;$('manualMbl').value='';missingConfiguration=false;$('needsConfig').hidden=true;clearPreview();$('matchCarrier').textContent='等待重新识别';$('matchMbl').textContent='MBL 将从「提柜」匹配';$('matchSource').textContent='仅查表，不会发送邮件';setBusy(false);syncMode();
  if(/^[A-Za-z]{4}\d{7}$/.test($('container').value.trim()))debounce=setTimeout(()=>perform('identify'),700);
}
async function saveSettings(next){
  if(busy)throw new Error('后台操作进行中，请完成后再修改配置。');
  const normalized=validateSettings(next);settings=validateSettings(await rpc({type:'settings',settings:normalized}));hydrateSettings();
  if(lastResult){const refreshed={...lastResult,configurationMissing:undefined};renderResult(refreshed);}setBusy(false);
}
// Mail drafts opened in a local program (Foxmail, or another default mail program) are sent by the user.
function mailProgram(client){return client==='foxmail'||client==='system';}
// Launch the computer's default mail program with the filled message.
function openMailto(url){const a=document.createElement('a');a.href=url;a.rel='noopener';document.body.append(a);a.click();a.remove();}
async function markSent(requestId){try{await rpc({type:'markSent',requestId});status('已记录为已发送。','success');await refreshState();}catch(error){status(error.message,'error');}}
async function openDraft(tabId){if(busy)return;try{await rpc({type:'openDraft',tabId});}catch(error){status(error.message,'error');}}
function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function scriptText(){const response=await fetch('./airscript/LFD_ReadOnly.js');if(!response.ok)throw new Error('无法读取插件中的只读脚本。');return response.text();}
document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>showPage(button.dataset.page)));
$('container').addEventListener('input',()=>{$('container').value=$('container').value.toUpperCase().replace(/\s/g,'');scheduleIdentify();});
for(const id of ['carrier','inquiryType'])$(id).addEventListener('change',()=>{editMatch();syncMode();});$('manualMbl').addEventListener('input',editMatch);
$('inquiry').addEventListener('submit',event=>{event.preventDefault();perform('send');});$('identify').addEventListener('click',()=>perform('identify'));$('draft').addEventListener('click',()=>perform('draft'));$('openDraft').addEventListener('click',()=>openDraft(draftTabId));
$('configureDetected').addEventListener('click',()=>{const id=lastResult?.carrierId||lastResult?.carrier?.id;if(settings.carriers.some(p=>p.id===id)){showPage('config');loadProfile(id);$('page-config').scrollTop=0;$('carrierTo').focus();}else startNewProfile(typeof lastResult?.carrier==='string'?lastResult.carrier:'新船公司');});
$('newCarrier').addEventListener('click',()=>startNewProfile());
$('channel').addEventListener('change',()=>{if($('channel').value==='cosco-portal'&&!$('portalShipmentType').value.trim())fillPortal(COSCO_PORTAL);if($('channel').value==='one-chat'&&!$('chatMessage').value.trim())fillChat(ONE_CHAT);syncChannel();});$('editCarrier').addEventListener('change',()=>loadProfile($('editCarrier').value));
$('standardTemplate').addEventListener('click',()=>{$('bodyTemplate').value=DEFAULT_BODY_TEMPLATE;$('subjectTemplate').value=DEFAULT_SUBJECT_TEMPLATE;status('已填入标准模板，点击保存后生效。');});
$('carrierForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  try{
    const original=newProfile||settings.carriers.find(p=>p.id===editingId);
    const list=value=>value.split(/[,;，；\n]+/).map(v=>v.trim()).filter(Boolean);
    const channel=$('channel').value,portal=channel==='cosco-portal'?{requester:$('portalRequester').value.trim(),reference:$('portalReference').value.trim(),shipmentType:$('portalShipmentType').value.trim(),service:$('portalService').value.trim()}:undefined;
    const chat=channel==='one-chat'?{firstName:$('chatFirstName').value.trim(),lastName:$('chatLastName').value.trim(),email:$('chatEmail').value.trim(),country:$('chatCountry').value.trim(),message:$('chatMessage').value.trim()}:undefined;
    const {portal:_previousPortal,chat:_previousChat,...base}=original;
    const onHire={to:addressList($('onHireTo').value),cc:addressList($('onHireCc').value),subjectTemplate:$('onHireSubject').value,bodyTemplate:$('onHireBody').value};
    const profile={...base,channel,onHire,...(portal?{portal}:{}),...(chat?{chat}:{}),name:$('carrierName').value.trim(),greeting:$('greeting').value.trim(),to:addressList($('carrierTo').value),cc:addressList($('carrierCc').value),aliases:list($('aliases').value),mblPrefixes:$('mblPrefixes').value.split(/[\s,;，；]+/).filter(Boolean),bodyTemplate:$('bodyTemplate').value,subjectTemplate:$('subjectTemplate').value};
    const carriers=newProfile?[...settings.carriers,profile]:settings.carriers.map(p=>p.id===editingId?profile:p);const id=profile.id;
    await saveSettings({...settings,carriers});loadProfile(id);status(`${profile.name} 配置已保存${chat?'。':portal?(!portal.requester||!profile.bodyTemplate?'，补齐 Requester 和正文后可填写工单。':'。'):!profile.to.length||!profile.bodyTemplate?'，补齐邮箱和正文后可生成邮件。':'。'}`,'success');
  }catch(error){status(error.message,'error');}
});
$('deleteCarrier').addEventListener('click',async()=>{
  if(busy||settings.carriers.length<2)return;const profile=settings.carriers.find(p=>p.id===editingId);
  if(!confirm(`删除 ${profile.name} 的船公司配置？操作记录仍然保留。`))return;
  try{const carriers=settings.carriers.filter(p=>p.id!==editingId);editingId=carriers[0].id;await saveSettings({...settings,carriers,defaultCarrierId:settings.defaultCarrierId===profile.id?'auto':settings.defaultCarrierId});status('船公司配置已删除。');}catch(error){status(error.message,'error');}
});
function syncMailClientNotice(){const value=$('mailClient').value;$('mailClientNotice').hidden=!mailProgram(value);$('mailClientFoxmail').hidden=value!=='foxmail';$('mailClientSystem').hidden=value!=='system';}
$('mailClient').addEventListener('change',syncMailClientNotice);
$('connectionForm').addEventListener('submit',async event=>{event.preventDefault();if(mailProgram($('mailClient').value)&&!mailProgram(settings.mailClient)&&!confirm('改用电脑上的邮件程序（Foxmail 等）后，插件只能打开写好的邮件，不能自动发送，也无法确认是否已发出，需要你发完后点「我已发送」。推荐继续使用 Gmail 网页。\n\n确定改用电脑上的邮件程序？'))return;try{await saveSettings({...settings,sheetUrl:$('sheetUrl').value.trim(),account:$('account').value.trim(),gmailIndex:Number($('gmailIndex').value),testMode:$('testMode').checked,defaultCarrierId:$('defaultCarrierId').value,defaultInquiryType:$('defaultInquiryType').value,mailClient:$('mailClient').value});status('连接与默认选项已保存。','success');}catch(error){status(error.message,'error');}});
$('exportConfig').addEventListener('click',()=>{try{download(JSON.stringify(createConfig(settings),null,2)+'\n','lfd-inquiry-config.json','application/json');status('配置 JSON 已导出。','success');}catch(error){status(error.message,'error');}});
// The system file picker makes the toolbar popup go blank/close on Windows, so importing from the popup
// opens the extension page in a normal tab (straight to this section), where the picker works.
$('importLabel').addEventListener('click',event=>{
  if(demo||!chrome.tabs?.getCurrent)return;
  event.preventDefault();
  chrome.tabs.getCurrent(tab=>{
    if(tab){$('importFile').click();return;}
    chrome.tabs.create({url:chrome.runtime.getURL('app.html#import')});window.close();
  });
});
$('importFile').addEventListener('change',async event=>{
  pendingImport=null;$('importReview').hidden=true;const file=event.target.files[0];if(!file)return;
  try{if(file.size>MAX_CONFIG_BYTES)throw new Error('配置文件超过 256 KiB。');pendingImport=parseConfig(await file.text());$('importSummary').textContent=`将替换为 ${pendingImport.carriers.length} 家船公司：${pendingImport.carriers.map(p=>p.name).join('、')}。发件账号：${pendingImport.account}。操作记录保留，测试模式开启。`;$('importReview').hidden=false;status('已校验配置文件；查看摘要后点击应用。');}catch(error){status(error.message,'error');}finally{event.target.value='';}
});
$('applyImport').addEventListener('click',async()=>{if(!pendingImport)return;try{await saveSettings(pendingImport);pendingImport=null;$('importReview').hidden=true;status('配置已导入，测试模式已开启。','success');}catch(error){status(error.message,'error');}});
$('cancelImport').addEventListener('click',()=>{pendingImport=null;$('importReview').hidden=true;});
$('copyScript').addEventListener('click',async()=>{try{const text=await scriptText();try{await navigator.clipboard.writeText(text);status('只读脚本已复制，可到金山文档粘贴并保存。','success');}catch{$('scriptFallback').hidden=false;$('scriptFallback').value=text;$('scriptFallback').focus();$('scriptFallback').select();status('请复制下方已选中的脚本，或点击下载。');}}catch(error){status(error.message,'error');}});
$('downloadScript').addEventListener('click',async()=>{try{download(await scriptText(),'LFD_ReadOnly_v1.js','text/javascript');status('只读脚本已下载。','success');}catch(error){status(error.message,'error');}});
// Extra containers (On-Hire email, ONE chat). Each box is looked up on its own without replacing the main
// result. The first container's carrier is the reference: other carriers get a red border and block sending.
const parseContainers=text=>[...new Set(String(text||'').toUpperCase().match(/[A-Z]{4}\d{7}/g)||[])];
const baseCarrier=()=>lastResult&&!lastResult.unrecognizedCarrier?lastResult.carrierId:null;
const rows=()=>[...document.querySelectorAll('.extra-row')];
function refreshRows(){
  const base=baseCarrier(),baseName=lastResult?.carrierName||'第一个柜号';
  for(const row of rows()){
    if(row.dataset.state!=='checked')continue;
    const mismatch=Boolean(base)&&row.dataset.carrierId!==base,note=row.querySelector('.extra-status');
    row.classList.toggle('mismatch',mismatch);
    note.className='extra-status '+(mismatch?'error':'ok');
    note.textContent=mismatch?`${row.dataset.carrierName||'未识别船公司'} · 与第一个柜号的船公司（${baseName}）不同，请删除`:`${row.dataset.carrierName} · ${row.dataset.mbl}`;
  }
}
function extraContainers(){const base=baseCarrier();return rows().filter(row=>row.dataset.state==='checked'&&row.dataset.carrierId===base).map(row=>({container:row.dataset.container,mbl:row.dataset.mbl}));}
// Rows still loading, not found, or of another carrier must be resolved before sending.
function blockedRows(){const base=baseCarrier();return rows().filter(row=>['pending','error'].includes(row.dataset.state)||(row.dataset.state==='checked'&&base&&row.dataset.carrierId!==base)).length;}
function addExtraRow(value='',{focus=true,after=null}={}){
  if(rows().length>=29){status('一次最多 30 个柜号。','error');return null;}
  const row=document.createElement('div');row.className='extra-row';
  const input=document.createElement('input');input.maxLength=32;input.placeholder='再加一个柜号…';input.autocomplete='off';input.spellcheck=false;
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='移除这个柜号';
  const note=document.createElement('span');note.className='extra-status';note.textContent='粘贴柜号后自动查询';
  let timer,sequence=0;
  const done=(state,text,cls='')=>{row.dataset.state=state;note.textContent=text;note.className='extra-status '+cls;row.classList.remove('mismatch');refreshRows();syncSendButtons();syncMode();if(lastResult)renderResult(lastResult);};
  const lookup=()=>{
    input.value=input.value.toUpperCase().replace(/\s/g,'');clearTimeout(timer);for(const key of ['container','mbl','carrierId','carrierName'])delete row.dataset[key];
    if(!/^[A-Z]{4}\d{7}$/.test(input.value)){done('',input.value?'柜号须为 4 个字母 + 7 位数字':'粘贴柜号后自动查询');return;}
    const container=input.value,mine=++sequence;
    if(container===$('container').value.trim().toUpperCase()||rows().some(other=>other!==row&&other.dataset.container===container)){done('error','这个柜号已经在列表里了','error');return;}
    done('pending','正在查询…');
    timer=setTimeout(async()=>{
      try{
        const data=await rpc({type:'peek',container,options:{carrierId:'auto',inquiryType:$('inquiryType').value}});
        if(mine!==sequence)return;
        Object.assign(row.dataset,{container,mbl:data.mbl||'',carrierId:data.unrecognizedCarrier?'':data.carrierId||'',carrierName:data.carrierName||data.unrecognizedCarrier||''});
        if(!data.mbl){done('error','没有取得 MBL，请删除或在表格中补全','error');return;}
        done('checked','');
      }catch(error){if(mine===sequence)done('error',notFound(error.message)?'提柜表中找不到这个柜号':error.message,'error');}
    },400);
  };
  input.addEventListener('input',lookup);
  // Pasting several containers into a row fills it with the first and adds rows below for the rest.
  input.addEventListener('paste',event=>{
    const list=parseContainers(event.clipboardData?.getData('text'));if(list.length<2)return;
    event.preventDefault();input.value=list[0];lookup();
    let last=row;for(const container of list.slice(1))last=addExtraRow(container,{focus:false,after:last})||last;
  });
  remove.addEventListener('click',()=>{row.remove();refreshRows();syncSendButtons();syncMode();if(lastResult)renderResult(lastResult);});
  row.append(input,remove,note);
  if(after)after.after(row);else $('extraContainers').append(row);
  if(value){input.value=value;lookup();}
  if(focus)input.focus();
  return row;
}
$('addContainer').addEventListener('click',()=>addExtraRow());
// Pasting several containers into the main box: the first stays here, each of the others gets a row.
$('container').addEventListener('paste',event=>{
  const list=parseContainers(event.clipboardData?.getData('text'));if(list.length<2)return;
  event.preventDefault();$('extraContainers').replaceChildren();
  $('container').value=list[0];$('container').dispatchEvent(new Event('input',{bubbles:true}));
  for(const container of list.slice(1))addExtraRow(container,{focus:false});
  status(`已识别 ${list.length} 个柜号，正在逐个查询 MBL 和船公司。`,'running');
});
// Removing the first box moves the next one up.
$('removeMain').addEventListener('click',()=>{
  const next=rows()[0];
  $('container').value=next?next.querySelector('input').value:'';next?.remove();
  $('container').dispatchEvent(new Event('input',{bubbles:true}));$('container').focus();
});
$('duplicateCancel').addEventListener('click',()=>$('duplicate').close());
$('duplicateView').addEventListener('click',()=>{$('duplicate').close();showPage('history');});
$('duplicateForce').addEventListener('click',async()=>{
  const retry=duplicateRetry;$('duplicate').close();if(!retry)return;
  try{for(const b of retry.blocking)await rpc({type:'release',key:b.key});status('已解除旧记录的锁定，正在重新发送…','running');await refreshState();perform(retry.mode);}
  catch(error){status(error.message,'error');}
});
$('notFoundOk').addEventListener('click',()=>{$('notFound').close();$('container').value='';scheduleIdentify();$('matchCarrier').textContent='尚未识别船公司';$('matchSource').textContent='选择船公司可覆盖自动识别结果';status('请重新输入柜号。');$('container').focus();});
$('notFoundRetry').addEventListener('click',()=>{$('notFound').close();if($('container').value.trim().toUpperCase()!==notFoundContainer)$('container').value=notFoundContainer;perform('identify');});
// Esc closes the dialog like 确定 would, but keeps the input so the user can correct it.
$('notFound').addEventListener('cancel',()=>{status('柜号未找到，可修改后重新查询。','error');});
$('testNotification').addEventListener('click',async()=>{try{await rpc({type:'testNotification'});status('已发送测试通知，请点击它。');}catch(error){status(error.message,'error');}});
$('refresh').addEventListener('click',()=>refreshState().catch(error=>status(error.message,'error')));
try{await refreshState({initial:true});}catch(error){status(error.message,'error');}finally{initializing=false;if(!lastResult&&!busy&&!$('notFound').open&&/^[A-Za-z]{4}\d{7}$/.test($('container').value.trim()))scheduleIdentify();}
// Opened from the popup's 「选择 JSON 文件」: go straight to the import section of the config page.
if(location.hash==='#import'){showPage('config');$('importSection').open=true;$('page-config').scrollTop=$('importSection').offsetTop-$('page-config').offsetTop-12;status('在此页面点击「选择 JSON 文件」导入配置。');}
