// State and behavior of the popup. Pages only render what is here and call its actions.
import {computed,nextTick,reactive,ref,shallowRef,watch} from 'vue';
import {messageTemplate,portalTemplate,recognizeCarrier,containerNumber,COSCO_PORTAL,ONE_CHAT,DEFAULT_CARRIERS,chatTemplate,addressList,INQUIRY_TYPES,inquiryChannel,findType,resolveType,missingConfiguration,supportsManyContainers,standardBody,standardSubject,newInquiryType,newProfile,carrierLabel,channelsFor} from '../core/core.ts';
import {DEFAULT_SETTINGS,validateSettings,createConfig,parseConfig} from '../core/config.ts';
import {translate,resolveLanguage} from '../core/i18n.ts';

export const demo=!globalThis.chrome?.runtime?.id;
const copy=value=>JSON.parse(JSON.stringify(value));
const remembered=(key,fallback)=>{try{return {...fallback,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{return fallback;}};

// ---- Language: follows the browser until the user picks one. The last one used shows at once.
const HTML_LANG={zh:'zh-CN',en:'en',es:'es'};
export const language=ref('en');
export const t=text=>translate(text,language.value);
const browserLanguage=()=>globalThis.chrome?.i18n?.getUILanguage?.()||navigator.language;
function applyLanguage(choice){
  language.value=resolveLanguage(choice,browserLanguage());
  document.documentElement.lang=HTML_LANG[language.value];
  try{localStorage.setItem('lfd-language',language.value);}catch{}
}
try{applyLanguage(localStorage.getItem('lfd-language')||'');}catch{applyLanguage('');}

// ---- In-app dialogs, set up by App.vue: native ones stop working once the user ticks Chrome's "prevent this page
// from creating additional dialogs".
let askDialog=async text=>false;
export function useAsk(ask){askDialog=ask;}
const ask=text=>askDialog(text);

// ---- Shared state
const sources={sheet:'提柜表航司列','mbl-prefix':'MBL 前缀',manual:'手动选择'};
const recordStatus={preparing:'准备中',draft:'草稿已生成 / 已填写未提交',sending:'发送中',sent:'已发送',uncertain:'结果待核实',needs_review:'未完成'};
export const settings=shallowRef(copy(DEFAULT_SETTINGS));
export const ledger=shallowRef({});
export const message=reactive({text:'正在连接插件…',type:''});
export function status(text,type=''){message.text=text;message.type=type;}
export const busy=ref(false);
const lookingUp=ref(false);
const configMissing=ref(false);
const lastResult=shallowRef(null);
const draftTabId=ref(null);
let initializing=true,debounce,pollTimer,polling=false,requestSequence=0,lastOperationId='',lastRenderedOperation='',tasksTimer=null;
let demoSettings=copy(DEFAULT_SETTINGS),demoOperation=null;
try{demoSettings=validateSettings(JSON.parse(localStorage.getItem('lfd-demo-settings')||'null')||DEFAULT_SETTINGS);}catch{}

export const terminalMode=computed(()=>settings.value.mode==='terminal');
export const kind=computed(()=>terminalMode.value?'码头':'船公司');
const listKey=()=>terminalMode.value?'terminals':'carriers';
export const profiles=computed(()=>settings.value[listKey()]);
export const typeTitle=entry=>entry.typeLabel||INQUIRY_TYPES[entry.inquiryType]||entry.inquiryType||'';
// Mail drafts opened in the computer's mail program are sent by the user. 'system' is the former name of the
// option, still found on older records.
export const mailProgram=client=>['foxmail','outlook','system'].includes(client);

async function rpc(request){
  if(demo){
    if(request.type==='clearCache'){demoOperation=null;return true;}
    if(request.type==='state')return {settings:copy(demoSettings),ledger:{},operation:demoOperation};
    if(request.type==='settings'){demoSettings=validateSettings(request.settings);localStorage.setItem('lfd-demo-settings',JSON.stringify(demoSettings));return copy(demoSettings);}
    if(request.type==='run'){
      if(!['identify','preview'].includes(request.mode))throw new Error('这是本地界面演示。安装后的插件才能生成 Gmail 草稿。');
      const container=containerNumber(request.container),id=crypto.randomUUID();
      demoOperation={id,status:'running',mode:request.mode,container,options:request.options};
      await new Promise(resolve=>setTimeout(resolve,350));
      const record={container,mbl:container.startsWith('MSCU')?'MEDU1234567':'MAEU276301677',row:326,sourceTime:Date.now(),demo:true};
      let result;
      try{
        const list=request.options.mode==='terminal'?demoSettings.terminals:demoSettings.carriers;
        const recognized=request.options.carrierId==='auto'?recognizeCarrier(record,list):{carrier:list.find(p=>p.id===request.options.carrierId),carrierSource:'manual'};
        if(!recognized.carrier)throw new Error('请选择已配置的项目。');
        const profile=recognized.carrier,type=resolveType(profile,request.options.inquiryType)||profile.types[0]?.id||'';
        result={...record,carrierId:profile.id,carrierName:profile.name,carrierSource:recognized.carrierSource,inquiryType:type,channel:inquiryChannel(profile,type),configurationMissing:missingConfiguration(profile,type)};
      }catch(error){result={...record,inquiryType:request.options.inquiryType,unrecognizedCarrier:true,recognitionError:error.message,configurationMissing:['carrier']};}
      demoOperation={...demoOperation,status:'complete',result};return result;
    }
    throw new Error('界面演示不会操作真实 Gmail 或在线表格。');
  }
  const response=await chrome.runtime.sendMessage(request);
  if(!response?.ok)throw Object.assign(new Error(response?.error||'插件未返回结果。请检查 Gmail 后再操作。'),response?.duplicate?{duplicate:response.duplicate}:{});
  return response.data;
}

// ---- Where the user was: reopening returns to the same page, selection, open sections and scroll position.
export const ui=reactive(remembered('lfd-popup-ui',{page:'query',scroll:{},profile:{},type:{},open:[]}));
// Skipped while following another window's change: that window's position is the one to remember.
let followingChange=false;
function rememberUi(){if(followingChange)return;try{localStorage.setItem('lfd-popup-ui',JSON.stringify(ui));}catch{}}
export function showPage(page){
  ui.page=page;rememberUi();
  nextTick(()=>{const node=document.getElementById('page-'+page);if(node)node.scrollTop=ui.scroll[page]||0;});
}
export function rememberScroll(page,top){if(ui.page===page){ui.scroll[page]=top;rememberUi();}}
export const isOpen=id=>ui.open.includes(id);
export function setOpen(id,open){
  if(open===isOpen(id))return;
  ui.open=open?[...ui.open,id]:ui.open.filter(item=>item!==id);rememberUi();
}
const focusField=id=>nextTick(()=>document.getElementById(id)?.focus());

// ---- Query page
export const query=reactive({container:'',carrier:'auto',inquiryType:'demurrage',mbl:''});
const storedInput=()=>remembered('lfd-popup-input',{});
function rememberInput(){try{localStorage.setItem('lfd-popup-input',JSON.stringify({container:query.container,carrierId:query.carrier,inquiryType:query.inquiryType}));}catch{}}
export const view=reactive({
  matchCarrier:'尚未识别船公司',matchMbl:'',matchSource:'',previewType:'Demurrage',
  source:'',to:'—',cc:'—',subject:'—',html:'',lines:[],previewReady:false,
  needsConfig:false,missingTitle:'首次使用：请补充配置',missingDetail:'',configureLabel:'配置此船公司',
  openDraftLabel:'打开 Gmail 草稿 ↗',signatureNote:'＋ Gmail 中的原签名',signatureVisible:true
});
export const carrierOptions=computed(()=>{
  if(terminalMode.value&&!settings.value.terminals.length)return [{label:t('请先添加码头'),value:''}];
  return [...(terminalMode.value?[]:[{label:t('自动识别'),value:'auto'}]),...profiles.value.map(p=>({label:p.name,value:p.id}))];
});
function fillQueryCarrier(value){
  const options=carrierOptions.value;
  query.carrier=options.some(option=>option.value===value)?value:options[0]?.value??'';
}
export const matchedProfile=computed(()=>{const selected=query.carrier;return profiles.value.find(p=>p.id===(selected&&selected!=='auto'?selected:lastResult.value?.carrierId));});
// All types known in the current mode, for the moment before a carrier has been matched.
function knownTypes(){
  const known=new Map(Object.entries(INQUIRY_TYPES).map(([id,label])=>[id,{id,label}]));
  for(const profile of profiles.value)for(const type of profile.types)if(!known.has(type.id))known.set(type.id,type);
  return [...known.values()];
}
const typeList=computed(()=>matchedProfile.value?matchedProfile.value.types:knownTypes());
export const typeOptions=computed(()=>typeList.value.map(type=>({label:type.label,value:type.id})));
function fillTypes(value=query.inquiryType){
  const profile=matchedProfile.value,list=typeList.value,wanted=profile?resolveType(profile,value):value;
  query.inquiryType=list.some(type=>type.id===wanted)?wanted:list[0]?.id??'';
}
const matchedChannel=computed(()=>matchedProfile.value?inquiryChannel(matchedProfile.value,query.inquiryType):undefined);
const options=()=>({carrierId:query.carrier||'auto',inquiryType:query.inquiryType,mode:settings.value.mode});

// Extra containers (On-Hire email, ONE chat). Each box is looked up on its own without replacing the main result.
// The first container's carrier is the reference: other carriers get a red border and block sending.
export const rows=reactive([]);
let rowKey=0;
const parseContainers=text=>[...new Set(String(text||'').toUpperCase().match(/[A-Z]{4}\d{7}/g)||[])];
const baseCarrier=()=>lastResult.value&&!lastResult.value.unrecognizedCarrier?lastResult.value.carrierId:null;
function refreshRows(){
  const base=baseCarrier(),baseName=lastResult.value?.carrierName||'第一个柜号';
  for(const row of rows){
    if(row.state!=='checked')continue;
    row.mismatch=Boolean(base)&&row.carrierId!==base;
    row.cls=row.mismatch?'error':'ok';
    row.note=row.mismatch?`${row.carrierName||'未识别船公司'} · 与第一个柜号的船公司（${baseName}）不同，请删除`:`${row.carrierName} · ${row.mbl}`;
  }
}
const extraContainers=()=>{const base=baseCarrier();return rows.filter(row=>row.state==='checked'&&row.carrierId===base).map(row=>({container:row.container,mbl:row.mbl}));};
// Rows still loading, not found, or of another carrier must be resolved before sending.
const blockedRows=()=>{const base=baseCarrier();return rows.filter(row=>['pending','error'].includes(row.state)||(row.state==='checked'&&base&&row.carrierId!==base)).length;};
function rowDone(row,state,text,cls=''){row.state=state;row.note=text;row.cls=cls;row.mismatch=false;refreshRows();if(lastResult.value)renderResult(lastResult.value);}
export function rowLookup(row){
  row.value=row.value.toUpperCase().replace(/\s/g,'');clearTimeout(row.timer);
  Object.assign(row,{container:'',mbl:'',carrierId:'',carrierName:''});
  if(!/^[A-Z]{4}\d{7}$/.test(row.value)){rowDone(row,'',row.value?'柜号须为 4 个字母 + 7 位数字':'粘贴柜号后自动查询');return;}
  const container=row.value,mine=++row.sequence;
  if(container===query.container.trim().toUpperCase()||rows.some(other=>other!==row&&other.container===container)){rowDone(row,'error','这个柜号已经在列表里了','error');return;}
  rowDone(row,'pending','正在查询…');
  row.timer=setTimeout(async()=>{
    try{
      const data=await rpc({type:'peek',container,options:{...options(),carrierId:terminalMode.value?query.carrier:'auto'}});
      if(mine!==row.sequence)return;
      Object.assign(row,{container,mbl:data.mbl||'',carrierId:data.unrecognizedCarrier?'':data.carrierId||'',carrierName:data.carrierName||data.unrecognizedCarrier||''});
      if(!data.mbl){rowDone(row,'error','没有取得 MBL，请删除或在表格中补全','error');return;}
      rowDone(row,'checked','');
    }catch(error){if(mine===row.sequence)rowDone(row,'error',notFound(error.message)?'提柜表中找不到这个柜号':error.message,'error');}
  },400);
}
export function addExtraRow(value='',{focus=true,after=-1}={}){
  if(rows.length>=29){status('一次最多 30 个柜号。','error');return -1;}
  const row=reactive({key:++rowKey,value,state:'',note:'粘贴柜号后自动查询',cls:'',mismatch:false,container:'',mbl:'',carrierId:'',carrierName:'',timer:null,sequence:0});
  const index=after>=0?after+1:rows.length;
  rows.splice(index,0,row);
  if(value)rowLookup(row);
  if(focus)focusField(`extra-${row.key}`);
  return index;
}
export function removeRow(row){clearTimeout(row.timer);rows.splice(rows.indexOf(row),1);refreshRows();if(lastResult.value)renderResult(lastResult.value);}
// Pasting several containers into a row fills it with the first and adds rows below for the rest.
export function pasteIntoRow(event,row){
  const list=parseContainers(event.clipboardData?.getData('text'));if(list.length<2)return;
  event.preventDefault();row.value=list[0];rowLookup(row);
  let last=rows.indexOf(row);for(const container of list.slice(1)){const placed=addExtraRow(container,{focus:false,after:last});if(placed>=0)last=placed;}
}
const clearRows=()=>{rows.forEach(row=>clearTimeout(row.timer));rows.splice(0);};
// Pasting several containers into the main box: the first stays here, each of the others gets a row.
export function pasteIntoContainer(event){
  const list=parseContainers(event.clipboardData?.getData('text'));if(list.length<2)return;
  event.preventDefault();clearRows();
  query.container=list[0];containerInput(list[0]);
  for(const container of list.slice(1))addExtraRow(container,{focus:false});
  status(`已识别 ${list.length} 个柜号，正在逐个查询 MBL 和船公司。`,'running');
}
// Removing the first box moves the next one up.
export function removeMain(){
  const next=rows[0];
  const value=next?next.value:'';if(next){clearTimeout(next.timer);rows.shift();}
  containerInput(value);focusField('container');
}
export function containerInput(value){query.container=value.toUpperCase().replace(/\s/g,'');scheduleIdentify();}

export const multi=computed(()=>supportsManyContainers(matchedProfile.value,query.inquiryType));
export const extrasVisible=computed(()=>multi.value||!matchedProfile.value);
export const sendDisabled=computed(()=>{
  const pendingExtra=extrasVisible.value?blockedRows():0;
  return busy.value||lookingUp.value||pendingExtra>0||configMissing.value||!query.mbl.trim();
});
export const sendLabel=computed(()=>{
  const channel=matchedChannel.value,count=multi.value?1+extraContainers().length:1,suffix=count>1?` · ${count} 个柜号`:'';
  if(channel==='email'&&mailProgram(settings.value.mailClient))return '打开邮件程序发送'+suffix;
  if(channel==='one-chat')return `发送 ONE 在线客服消息${count>1?'（'+count+' 个柜号）':''}`;
  return (channel==='cosco-portal'?'提交 COSCO 工单':'发送邮件')+suffix;
});
export const draftLabel=computed(()=>{
  const channel=matchedChannel.value;
  return channel==='email'&&mailProgram(settings.value.mailClient)?'打开邮件程序':channel==='one-chat'?'转人工但不发送':channel==='cosco-portal'?'仅填写工单':'仅生成草稿';
});
export const openDraftVisible=computed(()=>draftTabId.value!==null);

function clearPreview(){
  view.source='';view.to='—';view.cc='—';view.subject='—';view.html='';view.lines=[];view.previewReady=false;
}
function lookupError(text){view.matchCarrier='查表未完成';view.matchMbl='尚未取得 MBL';view.matchSource=text;clearPreview();}
function resetResult(){lastResult.value=null;configMissing.value=false;view.needsConfig=false;clearPreview();}
function renderResult(data){
  if(!data)return;lastResult.value=data;
  const record=data.record?{...data.record,...data}:data;
  const carrierId=data.carrierId||data.carrier?.id,profile=profiles.value.find(p=>p.id===carrierId);
  fillTypes(data.inquiryType||query.inquiryType);
  const type=query.inquiryType,typeEntry=findType(profile,type);
  const channel=profile?inquiryChannel(profile,type):undefined,portal=channel==='cosco-portal',chat=channel==='one-chat';
  const missing=data.configurationMissing||(profile?missingConfiguration(profile,type):['carrier']);
  const unknown=missing.includes('carrier');
  refreshRows();
  configMissing.value=missing.length>0;
  view.matchCarrier=unknown?`需要选择${kind.value}`:data.carrierName||profile?.name||'等待识别';
  query.mbl=record.mbl||'';view.matchMbl=record.mbl||'请手动填写 MBL';
  view.matchSource=unknown?data.recognitionError||'无法自动识别':sources[data.carrierSource||record.carrierSource]||'自动识别';
  view.previewType=typeEntry?.label||typeTitle({inquiryType:type});
  view.source=data.demo?'界面演示 · 示例数据':record.row?`${record.fromCache?'本地缓存':'提柜'} · 第 ${record.row} 行${record.sourceTime?' · '+new Date(record.sourceTime).toLocaleTimeString():''}`:'来自本次提柜表查询';
  view.needsConfig=configMissing.value;
  if(configMissing.value){
    view.missingTitle=unknown?`暂未确定${kind.value}`:'首次使用：请补充配置';
    const names={carrier:kind.value,type:'查询类型',to:'收件邮箱',requester:'工单 Requester',bodyTemplate:'正文模板',subjectTemplate:'主题模板'};
    view.missingDetail=data.recognitionError||(missing.includes('type')?`请先为 ${profile?.name} 添加查询类型。`:`请为 ${profile?.name||data.carrierName||'此项'} 的 ${typeEntry?.label||''} 填写${missing.map(key=>names[key]||key).join('、')}，再生成邮件。`);
    view.configureLabel=profile?'配置 '+profile.name:`新增或选择${kind.value}`;clearPreview();
  }else{
    try{
      const more=supportsManyContainers(profile,type)?{more:extraContainers()}:{};
      if(chat){
        const chatMessage=chatTemplate(record,{carrier:profile,inquiryType:type,more:extraContainers()});
        view.to=`ONE 在线客服 · ${chatMessage.firstName} ${chatMessage.lastName} · ${chatMessage.email}`;view.cc='—';view.subject=`Container Number · ${record.container}${chatMessage.messages.length>1?` · 共 ${chatMessage.messages.length} 条消息`:''}`;
        view.html='';view.lines=chatMessage.messages;
      }else if(portal){
        const ticket=portalTemplate(record,{carrier:profile,inquiryType:type,...more});
        view.to=`COSCO 工单 · ${new URL(ticket.url).hostname} · Requester ${ticket.requester}`;view.cc='—';view.subject=ticket.fields.map(f=>f.value).join(' · ');view.html=ticket.html;view.lines=[];
      }else{
        const mail=messageTemplate(record,{carrier:profile,inquiryType:type,...more});
        view.to=mail.to.join(', ');view.cc=mail.cc.join(', ')||'—';view.subject=mail.subject;view.html=mail.html;view.lines=[];
      }
      view.previewReady=true;
    }catch(error){clearPreview();status(error.message,'error');}
  }
  draftTabId.value=data.status==='draft'&&Number.isInteger(data.tabId)?data.tabId:null;
  view.openDraftLabel=chat?'打开 ONE 聊天页 ↗':portal?'打开 COSCO 工单页 ↗':'打开 Gmail 草稿 ↗';
  view.signatureVisible=!portal&&!chat;
  view.signatureNote=settings.value.mailClient==='outlook'?'＋ Outlook 中的签名（纯文本正文）':mailProgram(settings.value.mailClient)?'＋ Foxmail 中的签名':'＋ Gmail 中的原签名';
}
function reportResult(data,mode){
  renderResult(data);
  const portal=data.channel==='cosco-portal',chat=data.channel==='one-chat';
  if(mailProgram(data.mailClient)&&data.status==='draft'){const name=data.mailClient==='outlook'?'Outlook':'Foxmail';status(`已请求打开 ${name} 写信窗口：检查后在 ${name} 里发送，发完后到「进行中」或「记录」点「我已发送」。如果没有弹出写信窗口，请确认已安装 ${name} 并设为 Windows 默认邮件程序（配置页有下载和设置入口）。`,'success');return;}
  if(data.background){status(`已加入后台任务：${(data.containers||[data.container]).join('、')}。`,'success');return;}
  if(data.status==='draft')status(chat?`ONE 客服${data.agent?' '+data.agent:''}已接入，消息已填入聊天框，尚未发送。可打开聊天页查看。`:portal?'COSCO 工单已填好，尚未提交。可打开工单页检查。':'Gmail 草稿已填好，原签名已保留，尚未发送。可打开草稿检查。','success');
  else if(data.status==='sent')status(chat?`已查询：ONE 客服${data.agent?' '+data.agent:''}已读消息，回复请在聊天页查看。`:portal?`COSCO 工单已提交${data.ticketId?' #'+data.ticketId:''}。`:'Gmail 已显示发送成功。','success');
  else if(data.unrecognizedCarrier)status(data.recognitionError||'请选择船公司或补充识别规则。','error');
  else if(configMissing.value)status('已匹配柜号；完成提示中的配置后即可生成草稿。');
  else status(data.demo?'演示匹配完成；未读取在线表格，也不会创建邮件。':mode==='identify'?'已匹配 MBL。':'邮件预览已更新。','success');
}
function syncOperation(operation,{restore=false}={}){
  if(!operation)return;
  if(restore){
    query.container=operation.container||query.container;
    if(operation.options){if(carrierOptions.value.some(o=>o.value===operation.options.carrierId))query.carrier=operation.options.carrierId;fillTypes(operation.options.inquiryType||query.inquiryType);}
    rememberInput();
  }
  lastOperationId=operation.id||lastOperationId;
  if(operation.status==='running'){
    if(operation.mode==='identify')lookingUp.value=true;else busy.value=true;
    status(operation.mode==='identify'?'正在查表并识别船公司… 可关闭弹窗，后台会继续。':matchedChannel.value==='one-chat'?'正在后台联系 ONE 在线客服，转人工可能需要几分钟… 可关闭弹窗。':matchedChannel.value==='cosco-portal'&&operation.mode==='send'?'已打开 COSCO 工单页：请在该页完成人机验证，插件随后自动提交（3 分钟内）。':'正在后台准备邮件… 可关闭弹窗，完成后重新打开查看。','running');startPolling();return;
  }
  if(operation.id&&lastRenderedOperation===operation.id)return;
  lastRenderedOperation=operation.id||'';
  if(operation.mode==='identify')lookingUp.value=false;
  if(operation.status==='complete'){busy.value=false;reportResult(operation.result,operation.mode);}
  else if(operation.status==='failed'||operation.status==='interrupted'){
    busy.value=false;
    if(operation.mode==='identify')lookupError(operation.error||'请点击重新查表。');
    if(operation.mode==='identify'&&notFound(operation.error)&&operation.container===query.container.trim().toUpperCase())showNotFound(operation.container);
    status(operation.error||(operation.status==='interrupted'?'上次操作已中断，请先检查 Gmail 草稿和已发送记录。':'操作失败。'),'error');
  }
}
function setLedger(next={}){
  ledger.value=next;
  // Keep the list fresh while anything runs in the background.
  const running=taskGroups.value.running.length>0;
  if(running&&!tasksTimer)tasksTimer=setInterval(()=>refreshState().catch(()=>{}),2000);
  if(!running&&tasksTimer){clearInterval(tasksTimer);tasksTimer=null;}
}
export async function refreshState({initial=false}={}){
  const state=await rpc({type:'state'});
  // Only the first read: afterwards this page holds the newest settings, possibly with a write still on its way.
  if(initial){
    settings.value=validateSettings(state.settings);applyLanguage(settings.value.language);
    if(state.openTarget==='autoCc'){ui.page='config';ui.scroll.config=0;if(!isOpen('autoCcSection'))ui.open=[...ui.open,'autoCcSection'];openedAutoCc=true;}
  }
  setLedger(state.ledger);
  if(initial){
    const saved=storedInput();query.container=saved.container||'';
    fillQueryCarrier(saved.carrierId||(terminalMode.value?'':settings.value.defaultCarrierId));fillTypes(saved.inquiryType||settings.value.defaultInquiryType);renderAll();
    const restore=state.operation?.status==='running'||!saved.container||saved.container===state.operation?.container;
    if(restore)syncOperation(state.operation,{restore:true});
    else{lastOperationId=state.operation?.id||'';lastRenderedOperation=lastOperationId;}
    if(!state.operation||!restore)status(demo?'界面演示：MRSU4786640 为 Maersk 示例；MSCU1234567 为 MSC 示例。':'');
  }else syncOperation(state.operation);
  return state;
}
export const refresh=()=>refreshState().catch(error=>status(error.message,'error'));
function startPolling(){
  if(pollTimer)return;
  pollTimer=setInterval(async()=>{
    if(polling)return;polling=true;
    try{const state=await refreshState();if(state.operation?.status!=='running'&&!busy.value){clearInterval(pollTimer);pollTimer=null;}}
    catch(error){status(error.message,'error');}finally{polling=false;}
  },850);
}
const validContainer=value=>/^[A-Za-z]{4}\d{7}$/.test(value.trim());
export async function perform(mode,forceRefresh=false){
  clearTimeout(debounce);
  if(busy.value||initializing)return;
  if(!validContainer(query.container)){status('柜号须为 4 个英文字母 + 7 位数字。','error');return;}
  const isMulti=multi.value,more=mode==='identify'||!isMulti?[]:extraContainers();
  if(mode!=='identify'&&isMulti&&blockedRows()){status('列表中有柜号尚未查到、找不到或船公司不同，请删除后再发送。','error');return;}
  if(mode==='identify'){lastResult.value=null;query.mbl='';configMissing.value=false;clearPreview();}
  // Lookups never lock the popup: the user can type the next container while this one is read.
  const sequence=++requestSequence;rememberInput();
  if(mode==='identify')lookingUp.value=true;else busy.value=true;
  status(mode==='identify'?'正在匹配本地数据，未命中时查表… 可以继续输入其他柜号。':'正在加入后台任务…','running');
  const previousOperation=lastOperationId;
  try{
    startPolling();
    const data=await rpc({type:'run',mode,container:query.container.trim().toUpperCase(),options:{...options(),forceRefresh,...(mode==='identify'?{}:{manualMbl:query.mbl,useConfirmed:true,...(more.length?{more}:{})})}});
    if(sequence!==requestSequence)return;
    lookingUp.value=false;busy.value=false;
    if(data.mailto)openMailto(data.mailto);
    if(data.mailto||data.background)clearRows();
    reportResult(data,mode);
    const state=await rpc({type:'state'});setLedger(state.ledger);
    if(state.operation?.id!==previousOperation){lastOperationId=state.operation?.id||lastOperationId;lastRenderedOperation=lastOperationId;}
  }catch(error){
    if(sequence===requestSequence&&error.duplicate&&mode!=='identify'){lookingUp.value=false;busy.value=false;status(error.message,'error');showDuplicate(error.duplicate,mode);return;}
    if(sequence===requestSequence){
      lookingUp.value=false;busy.value=false;
      if(mode==='identify')lookupError(error.message);
      status(error.message,'error');
      if(mode==='identify'&&notFound(error.message))showNotFound(query.container.trim().toUpperCase());
      try{const state=await rpc({type:'state'});setLedger(state.ledger);lastRenderedOperation=state.operation?.id||lastRenderedOperation;}catch{}
    }
  }finally{if(sequence===requestSequence&&!busy.value&&!lookingUp.value){clearInterval(pollTimer);pollTimer=null;}}
}
export function pressEnter(){if(!sendDisabled.value)perform('send');}
function editMatch(){
  if(busy.value)return;
  const selected=query.carrier,profile=matchedProfile.value;
  renderResult({...lastResult.value,container:query.container.trim().toUpperCase(),mbl:query.mbl.trim().toUpperCase(),
    carrierId:profile?.id,carrierName:profile?.name,carrierSource:selected==='auto'?lastResult.value?.carrierSource:'manual',
    inquiryType:query.inquiryType,configurationMissing:undefined,unrecognizedCarrier:profile?'':'unknown',needsTerminal:false,recognitionError:profile?'':`请选择${kind.value}。`});
}
export function chooseCarrier(value){query.carrier=value;fillTypes();rememberInput();editMatch();}
export function chooseType(value){query.inquiryType=value;editMatch();}
export function editMbl(value){query.mbl=value;editMatch();}
function scheduleIdentify(){
  clearTimeout(debounce);notFoundDialog.show=false;rememberInput();draftTabId.value=null;
  if(busy.value||initializing)return;
  lastResult.value=null;query.mbl='';configMissing.value=false;view.needsConfig=false;clearPreview();
  view.matchCarrier='等待重新识别';view.matchMbl='';view.matchSource='';
  if(validContainer(query.container))debounce=setTimeout(()=>perform('identify'),700);
}
// Launch the computer's default mail program with the filled message.
export function openMailto(url){const a=document.createElement('a');a.href=url;a.rel='noopener';document.body.append(a);a.click();a.remove();}
export async function markSent(requestId){try{await rpc({type:'markSent',requestId});status('已记录为已发送。','success');await refreshState();}catch(error){status(error.message,'error');}}
export async function openDraft(tabId=draftTabId.value){if(busy.value)return;try{await rpc({type:'openDraft',tabId});}catch(error){status(error.message,'error');}}
export function configureDetected(){
  const id=lastResult.value?.carrierId;
  if(profiles.value.some(p=>p.id===id)){
    showPage('config');flushSave();ui.type[id]=query.inquiryType||ui.type[id];renderProfile(id);
    nextTick(()=>{document.getElementById('page-config').scrollTop=0;focusField('carrierTo');});
  }else openAddProfile(typeof lastResult.value?.unrecognizedCarrier==='string'?lastResult.value.unrecognizedCarrier:'');
}

// ---- Dialogs of the query page
// Not found in the cache nor in the sheet: query once, then let the user decide whether to look again.
const notFound=text=>/未找到该柜号/.test(text||'');
export const notFoundDialog=reactive({show:false,container:''});
function showNotFound(container){notFoundDialog.container=container;notFoundDialog.show=true;}
export function notFoundOk(){
  notFoundDialog.show=false;query.container='';scheduleIdentify();
  view.matchCarrier='尚未识别船公司';view.matchSource='';status('请重新输入柜号。');focusField('container');
}
export function notFoundRetry(){notFoundDialog.show=false;if(query.container.trim().toUpperCase()!==notFoundDialog.container)query.container=notFoundDialog.container;perform('identify');}
// Esc closes it like 确定 would, but keeps the input so the user can correct it.
export function notFoundEsc(){notFoundDialog.show=false;status('柜号未找到，可修改后重新查询。','error');}
// Sending was blocked by existing records (duplicate lock): show them and offer a forced resend.
export const duplicateDialog=reactive({show:false,lines:[],note:'',running:false,blocking:[],mode:''});
function showDuplicate(blocking,mode){
  const running=blocking.some(b=>b.running);
  Object.assign(duplicateDialog,{show:true,running,blocking,mode,
    lines:blocking.map(b=>`${b.container}：${t(recordStatus[b.status]||b.status)}${b.time?'（'+new Date(b.time).toLocaleString()+'）':''}`),
    note:running?'该任务仍在后台进行，请先在「进行中」终止。':'「强制重发」会解除这条记录的锁定并重新发送；如果之前其实已经发出，对方会收到重复的邮件 / 消息。'});
}
export function duplicateView(){duplicateDialog.show=false;showPage('history');}
export async function duplicateForce(){
  const {blocking,mode}=duplicateDialog;duplicateDialog.show=false;
  try{for(const b of blocking)await rpc({type:'release',key:b.key});status('已解除旧记录的锁定，正在重新发送…','running');await refreshState();perform(mode);}
  catch(error){status(error.message,'error');}
}

// ---- History and tasks
const statuses={preparing:'准备中 / 中断待核实',draft:'草稿已生成 · 未自动发送',sending:'发送中 / 待核实',sent:'Gmail 已确认发送',uncertain:'发送结果待核实',needs_review:'准备失败，请检查草稿'};
const chatStatuses={preparing:'准备中 / 中断待核实',draft:'客服已接入 · 消息未发送',sending:'联系客服中 / 待核实',sent:'已查询（客服已读）',uncertain:'客服消息结果待核实',needs_review:'消息未发送，请检查聊天页'};
const portalStatuses={preparing:'准备中 / 中断待核实',draft:'工单已填写 · 未提交',sending:'等待人机验证 / 提交中',sent:'COSCO 工单已提交',uncertain:'工单提交结果待核实',needs_review:'工单未提交，请检查页面'};
export const historyRows=computed(()=>Object.entries(ledger.value).sort((a:any,b:any)=>(b[1].time||0)-(a[1].time||0)).map(([key,entry]:any)=>{
  const portal=entry.channel==='cosco-portal',chat=entry.channel==='one-chat',system=mailProgram(entry.mailClient);
  return {key,entry,system,
    detail:`${entry.carrierName||'Maersk'} · ${typeTitle(entry)||'Demurrage'} · ${new Date(entry.time).toLocaleString()}`,
    state:system&&entry.status==='draft'?'已打开邮件程序 · 待确认发送':system&&entry.status==='sent'?'已发送（用户确认）':(chat?chatStatuses:portal?portalStatuses:statuses)[entry.status]||entry.status,
    suffix:(entry.ticketId?` #${entry.ticketId}`:'')+(entry.agent?` · ${entry.agent}`:''),
    openable:['draft','uncertain',...(portal||chat?['needs_review']:[])].includes(entry.status)&&Number.isInteger(entry.tabId),
    openLabel:chat?'打开聊天页':portal?'打开工单页':entry.status==='draft'?'打开草稿':'打开写信页'};
}));
export async function releaseRecord(key,entry){
  if(busy.value)return;
  const first=entry.channel==='one-chat'?'请先检查 ONE 聊天页中消息是否已发送。':entry.channel==='cosco-portal'?'请先检查 COSCO 工单是否已提交（工单页或 Requester 邮箱的确认邮件）。':'请先检查 Gmail 已发送和草稿。';
  if(!await ask(`${first}\n\n解除 ${entry.container} 的锁定会允许再次生成同类邮件。确认已核实并需要重新生成？`))return;
  try{await rpc({type:'release',key});await refreshState();status('已解除该条记录的锁定。');}catch(error){status(error.message,'error');}
}
// Running tasks, plus tasks that need attention (failed, interrupted, unconfirmed).
export const taskGroups=computed(()=>{
  const groups=new Map();
  for(const entry of Object.values(ledger.value) as any[]){
    const attention=entry.interrupted||(mailProgram(entry.mailClient)&&entry.status==='draft')||['needs_review','uncertain','preparing','sending'].includes(entry.status);
    if(!entry.running&&!attention)continue;
    const id=entry.requestId||entry.container;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(entry);
  }
  const all=[...groups.values()].sort((a,b)=>(b[0].time||0)-(a[0].time||0));
  return {all,running:all.filter(group=>group[0].running),attention:all.filter(group=>!group[0].running)};
});
export function taskView(group){
  const entry=group[0],minutes=Math.max(0,Math.round((Date.now()-(entry.time||Date.now()))/60000));
  return {entry,names:group.map(e=>e.container).join('、'),
    detail:`${entry.carrierName||''} · ${typeTitle(entry)} · ${new Date(entry.time).toLocaleTimeString()} 开始${entry.running?` · 已 ${minutes} 分钟`:''}`,
    step:entry.running?(entry.step||'进行中')+(entry.agent?` · ${entry.agent}`:''):mailProgram(entry.mailClient)&&entry.status==='draft'?'已打开邮件程序，发完后请点「我已发送」':entry.interrupted?'已中断，请打开页面核实结果':`${entry.status==='uncertain'?'结果待核实':'未完成'}：${entry.detail||''}`,
    openLabel:entry.channel==='one-chat'?'打开聊天':entry.channel==='cosco-portal'&&/人机验证/.test(entry.step||'')?'去验证':'打开页面',
    canVerify:Boolean(entry.interrupted)||['uncertain','needs_review'].includes(entry.status),
    system:mailProgram(entry.mailClient)&&entry.status==='draft'};
}
export async function stopTask(view){
  if(!await ask(`终止 ${view.names} 的任务？插件会关闭它的窗口。已经发出的消息无法撤回。`))return;
  try{await rpc({type:'cancel',requestId:view.entry.requestId});status('任务已终止。');await refreshState();}catch(error){status(error.message,'error');}
}
export async function verifySent(view){if(await ask('确认这条消息/邮件确实已经发出？记录会改为已发送，并继续防止重复发送。'))markSent(view.entry.requestId);}
// Release the lock and put the containers back on the query page for the user to send again.
export async function resendTask(view,group){
  if(!await ask(`解除 ${view.names} 的锁定并重新填回查询页？${view.entry.status==='uncertain'?'\n\n注意：结果待核实，之前可能已经发出，重新发送可能重复。':''}`))return;
  try{await rpc({type:'deleteTask',requestId:view.entry.requestId});await refreshState();refill(group.map(e=>e.container),view.entry);}catch(error){status(error.message,'error');}
}
export async function deleteTask(view){
  if(!await ask(`删除 ${view.names} 的任务？会解除防重复锁，之后可以重新查询发送。${view.entry.status==='uncertain'?'\n\n注意：这个任务的结果待核实，消息可能已经发出，请先核实。':''}`))return;
  try{await rpc({type:'deleteTask',requestId:view.entry.requestId});status('任务已删除，可以重新发送。');await refreshState();}catch(error){status(error.message,'error');}
}
// Put containers back on the query page (first in the main box, others as extra rows) with the same type.
function refill(containers,entry){
  showPage('query');clearRows();
  if(entry.inquiryType)fillTypes(entry.inquiryType);
  containerInput(containers[0]);
  for(const container of containers.slice(1))addExtraRow(container,{focus:false});
  status('已解除锁定并填回查询页，确认后点击发送。');
}

// ---- Config page. Everything saves itself. Text that cannot be saved yet (half-typed address or placeholder) is kept
// in a local draft, so closing the popup to copy something elsewhere never loses it; reopening restores it and retries.
const DRAFT_KEY='lfd-config-draft';
export const form=reactive({
  name:'',greeting:'',aliases:'',prefixes:'',typeLabel:'',to:'',cc:'',subject:'',body:'',channel:'email',
  portalRequester:'',portalReference:'',portalShipmentType:'',portalService:'',
  chatFirstName:'',chatLastName:'',chatEmail:'',chatCountry:'',chatMessage:'',
  sheetUrl:'',gmailIndex:0,defaultCarrierId:'auto',defaultInquiryType:'demurrage',mailClient:'gmail',mailProgram:'foxmail',
  autoCcEnabled:false,autoCcSenders:'',autoCcCc:''
});
export const editingId=ref('');
export const editingType=ref('');
export const saveLine=reactive({text:'修改后自动保存',type:''});
export const adding=reactive({profile:false,profileName:'',type:false,typeName:''});
export const importText=ref('');
export const scriptFallback=ref('');
let saveTimer=null,saveQueue=Promise.resolve(),pendingWrites=0,rendering=0,openedAutoCc=false;
const quietly=work=>{rendering++;try{work();}finally{rendering--;}};
const saveState=(text,type='')=>{saveLine.text=text;saveLine.type=type;};
export const currentProfile=computed(()=>profiles.value.find(p=>p.id===editingId.value));
export const currentType=computed(()=>findType(currentProfile.value,editingType.value));
const isBuiltinType=id=>Object.hasOwn(INQUIRY_TYPES,id);
export const customType=computed(()=>Boolean(currentType.value)&&!isBuiltinType(currentType.value.id));
export const profileOptions=computed(()=>profiles.value.map(p=>({label:p.name,value:p.id})));
export const editTypeOptions=computed(()=>(currentProfile.value?.types||[]).map(type=>({label:type.label,value:type.id})));
export const channelOptions=computed(()=>[['email','Gmail 邮件'],['cosco-portal','COSCO 工单网站（需手动完成人机验证）'],['one-chat','ONE 在线客服聊天']]
  .filter(([value])=>channelsFor(editingId.value).includes(value)).map(([value,label])=>({value,label:t(label)})));
// COSCO's ticket site and ONE's chat belong to those two; everyone else only sends email.
export const channelVisible=computed(()=>Boolean(currentType.value)&&channelsFor(editingId.value).length>1);
export const editChannel=computed(()=>currentType.value?form.channel:'email');
export const deleteDisabled=computed(()=>!terminalMode.value&&profiles.value.length<2);
export const defaultCarrierOptions=computed(()=>[{label:t('自动识别'),value:'auto'},...settings.value.carriers.map(p=>({label:p.name,value:p.id}))]);
export const defaultTypeOptions=computed(()=>{
  const all=new Map<string,string>(Object.entries(INQUIRY_TYPES));
  for(const profile of [...settings.value.carriers,...settings.value.terminals])for(const type of profile.types)if(!all.has(type.id))all.set(type.id,`${type.label}（${profile.name}）`);
  return [...all].map(([value,label])=>({label,value}));
});
const chosenMailClient=()=>form.mailClient==='program'?form.mailProgram:'gmail';

function renderConnection(){
  const current=settings.value;
  quietly(()=>Object.assign(form,{sheetUrl:current.sheetUrl,gmailIndex:current.gmailIndex,defaultCarrierId:current.defaultCarrierId,defaultInquiryType:current.defaultInquiryType,
    mailClient:mailProgram(current.mailClient)?'program':'gmail',mailProgram:current.mailClient==='outlook'?'outlook':'foxmail',
    autoCcEnabled:current.autoCc.enabled,autoCcSenders:current.autoCc.senders.join(', '),autoCcCc:current.autoCc.cc.join(', ')}));
}
function renderProfile(id){
  const list=profiles.value,profile=list.find(p=>p.id===id)||list[0];
  editingId.value=profile?.id||'';ui.profile[settings.value.mode]=editingId.value;rememberUi();
  if(!profile)return;
  quietly(()=>{
    Object.assign(form,{name:profile.name,greeting:profile.greeting,aliases:profile.aliases.join(', '),prefixes:profile.mblPrefixes.join(', ')});
    fillPortal(profile.portal);fillChat(profile.chat);
  });
  renderType(ui.type[editingId.value]);
}
function renderType(id){
  const profile=currentProfile.value,type=findType(profile,id)||profile.types[0];
  editingType.value=type?.id||'';ui.type[editingId.value]=editingType.value;rememberUi();
  if(type)quietly(()=>Object.assign(form,{typeLabel:type.label,to:type.to.join(', '),cc:type.cc.join(', '),subject:type.subjectTemplate,body:type.bodyTemplate,channel:type.channel}));
  showChannelSettings();restoreDraft();
}
function fillPortal(portal:any={}){Object.assign(form,{portalRequester:portal?.requester||'',portalReference:portal?.reference||'',portalShipmentType:portal?.shipmentType||'',portalService:portal?.service||''});}
function fillChat(chat:any={}){Object.assign(form,{chatFirstName:chat?.firstName||'',chatLastName:chat?.lastName||'',chatEmail:chat?.email||'',chatCountry:chat?.country||'',chatMessage:chat?.message||''});}
// Channel-specific settings are the only thing to fill for these types, so show them.
function showChannelSettings(){if(editChannel.value!=='email')setOpen('advanced',true);}
export function channelChanged(){
  if(form.channel==='cosco-portal'&&!form.portalShipmentType.trim())fillPortal(COSCO_PORTAL);
  if(form.channel==='one-chat'&&!form.chatMessage.trim())fillChat(ONE_CHAT);
  showChannelSettings();
}
function renderAll(){renderConnection();renderProfile(ui.profile[settings.value.mode]);}

function writeDraft(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({mode:settings.value.mode,profile:editingId.value,type:editingType.value,fields:{...form}}));}catch{}}
function clearDraft(){try{localStorage.removeItem(DRAFT_KEY);}catch{}}
// Only the draft this save covers: an unsaved edit of another carrier stays until the user returns to it.
function clearSavedDraft({mode,profile,type}){try{const draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if(draft?.mode===mode&&draft.profile===profile&&draft.type===type)clearDraft();}catch{}}
function restoreDraft(){
  let draft;try{draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');}catch{}
  if(!draft||draft.mode!==settings.value.mode||draft.profile!==editingId.value||draft.type!==editingType.value)return;
  quietly(()=>Object.assign(form,draft.fields));
  showChannelSettings();scheduleSave();
}
function collectSettings(){
  const current=settings.value;
  const next={...current,sheetUrl:form.sheetUrl.trim(),gmailIndex:Number(form.gmailIndex),defaultCarrierId:form.defaultCarrierId,defaultInquiryType:form.defaultInquiryType,mailClient:chosenMailClient(),autoCc:{enabled:form.autoCcEnabled,senders:addressList(form.autoCcSenders),cc:addressList(form.autoCcCc)}};
  const profile=currentProfile.value;if(!profile)return next;
  const name=form.name.trim(),type=currentType.value;
  if(profiles.value.some(p=>p.id!==profile.id&&carrierLabel(p.name)===carrierLabel(name)))throw new Error(`已有同名的${kind.value}「${name}」。`);
  const list=value=>value.split(/[,;，；\n]+/).map(v=>v.trim()).filter(Boolean);
  const edited:any={...profile,name,greeting:form.greeting.trim(),...(terminalMode.value?{}:{aliases:list(form.aliases),mblPrefixes:form.prefixes.split(/[\s,;，；]+/).filter(Boolean)})};
  if(type){
    const channel=terminalMode.value?'email':form.channel,label=isBuiltinType(type.id)?type.label:form.typeLabel.trim();
    if(profile.types.some(t=>t.id!==type.id&&carrierLabel(t.label)===carrierLabel(label)))throw new Error(`${profile.name} 已有同名的查询类型「${label}」。`);
    edited.types=profile.types.map(t=>t.id===type.id?{...t,label,channel,to:addressList(form.to),cc:addressList(form.cc),subjectTemplate:form.subject,bodyTemplate:form.body}:t);
    if(channel==='cosco-portal')edited.portal={...profile.portal,requester:form.portalRequester.trim(),reference:form.portalReference.trim(),shipmentType:form.portalShipmentType.trim(),service:form.portalService.trim()};
    if(channel==='one-chat')edited.chat={firstName:form.chatFirstName.trim(),lastName:form.chatLastName.trim(),email:form.chatEmail.trim(),country:form.chatCountry.trim(),message:form.chatMessage.trim()};
  }
  return {...next,[listKey()]:profiles.value.map(p=>p.id===profile.id?edited:p)};
}
// Writes go out in order; the page's own copy is already current, so the form is never redrawn under the cursor.
function persist(next){
  // What this save covers, taken now: by the time it lands the user may be on another carrier.
  const saved={mode:settings.value.mode,profile:editingId.value,type:editingType.value};
  settings.value=next;pendingWrites++;
  const work=saveQueue.then(()=>rpc({type:'settings',settings:next})).finally(()=>{pendingWrites--;});
  saveQueue=work.catch(()=>{});
  work.then(()=>{clearSavedDraft(saved);if(!saveTimer)saveState('已自动保存','success');},error=>{saveState('未保存：'+error.message,'error');status(error.message,'error');});
  return work;
}
function afterConfigChange(){
  fillQueryCarrier(query.carrier||(terminalMode.value?ui.profile.terminal:settings.value.defaultCarrierId));fillTypes();
  if(lastResult.value)renderResult({...lastResult.value,configurationMissing:lastResult.value.unrecognizedCarrier||lastResult.value.needsTerminal?lastResult.value.configurationMissing:undefined});
}
function scheduleSave(){clearTimeout(saveTimer);writeDraft();saveState('正在保存…');saveTimer=setTimeout(flushSave,400);}
export function flushSave(){
  if(saveTimer===null)return;
  clearTimeout(saveTimer);saveTimer=null;
  let next;
  try{next=validateSettings(collectSettings());}
  catch(error){saveState('未保存：'+error.message,'error');return;}
  persist(next);afterConfigChange();
}
watch(form,()=>{if(!rendering)scheduleSave();},{deep:true,flush:'sync'});
function discardPendingEdits(){clearTimeout(saveTimer);saveTimer=null;clearDraft();}
export function selectProfile(id){flushSave();renderProfile(id);}
export function selectType(id){flushSave();renderType(id);}
export function openAddProfile(name=''){
  showPage('config');nextTick(()=>{document.getElementById('page-config').scrollTop=0;});
  adding.profile=true;adding.profileName=name;focusField('newProfileName');
  status(`输入${kind.value}名称后点击「添加」。`);
}
export function closeAddProfile(){adding.profile=false;adding.profileName='';}
export function addProfile(){
  const name=adding.profileName.trim();
  if(!name){status(`请填写${kind.value}名称。`,'error');return;}
  flushSave();
  const same=profiles.value.find(p=>[p.name,...p.aliases].some(alias=>carrierLabel(alias)===carrierLabel(name)));
  closeAddProfile();
  if(same){renderProfile(same.id);status(`${same.name} 已经存在，每家只保留一份配置。`);return;}
  if(profiles.value.length>=50){status(`最多配置 50 个${kind.value}。`,'error');return;}
  // A carrier deleted earlier comes back with its built-in settings when added by name.
  const builtin=terminalMode.value?null:DEFAULT_CARRIERS.find(p=>[p.name,...p.aliases].some(alias=>carrierLabel(alias)===carrierLabel(name))&&!profiles.value.some(c=>c.id===p.id));
  const profile=builtin?copy(builtin):newProfile(`${terminalMode.value?'terminal':'carrier'}-${crypto.randomUUID().slice(0,8)}`,name,{terminal:terminalMode.value});
  persist(validateSettings({...settings.value,[listKey()]:[...profiles.value,profile]}));
  afterConfigChange();renderProfile(profile.id);
  if(terminalMode.value){openAddType();status(`已添加 ${name}。为它添加第一个查询类型。`);}
  else{focusField('carrierTo');status(`已添加 ${profile.name}，填写收件邮箱即可使用。`,'success');}
}
export function openAddType(){adding.type=true;focusField('newTypeName');}
export function closeAddType(){adding.type=false;adding.typeName='';}
export function addType(){
  const label=adding.typeName.trim(),profile=currentProfile.value;
  if(!label){status('请填写类型名称。','error');return;}
  flushSave();
  const same=profile.types.find(type=>carrierLabel(type.label)===carrierLabel(label));
  closeAddType();
  if(same){renderType(same.id);status(`${profile.name} 已有 ${same.label}。`);return;}
  const builtin=Object.entries(INQUIRY_TYPES).find(([,title])=>carrierLabel(title)===carrierLabel(label));
  const type=newInquiryType(builtin?builtin[0]:`type-${crypto.randomUUID().slice(0,8)}`,builtin?builtin[1]:label);
  persist(validateSettings({...settings.value,[listKey()]:profiles.value.map(p=>p.id===profile.id?{...p,types:[...p.types,type]}:p)}));
  afterConfigChange();renderType(type.id);focusField('carrierTo');status(`已添加 ${type.label}，填写收件邮箱即可使用。`,'success');
}
export async function deleteProfile(){
  const profile=currentProfile.value;if(!profile||deleteDisabled.value)return;
  if(!await ask(`删除 ${profile.name} 的配置？操作记录仍然保留。`))return;
  discardPendingEdits();delete ui.type[profile.id];
  const list=profiles.value.filter(p=>p.id!==profile.id);
  persist(validateSettings({...settings.value,[listKey()]:list,defaultCarrierId:settings.value.defaultCarrierId===profile.id?'auto':settings.value.defaultCarrierId}));
  if(lastResult.value?.carrierId===profile.id)resetResult();
  afterConfigChange();renderConnection();renderProfile(list[0]?.id);
  status(`${profile.name} 已删除。`);
}
export async function deleteType(){
  const profile=currentProfile.value,type=currentType.value;
  if(!type||!await ask(`删除 ${profile.name} 的 ${type.label} 配置？`))return;
  discardPendingEdits();
  persist(validateSettings({...settings.value,[listKey()]:profiles.value.map(p=>p.id===profile.id?{...p,types:p.types.filter(t=>t.id!==type.id)}:p)}));
  afterConfigChange();renderType('');status(`${type.label} 已删除。`);
}
export function useStandardTemplate(){form.body=standardBody(editingType.value);form.subject=standardSubject(editingType.value);}
export function setMode(mode){
  if(mode===settings.value.mode)return;
  flushSave();persist(validateSettings({...settings.value,mode}));
  resetResult();clearRows();
  fillQueryCarrier(terminalMode.value?ui.profile.terminal:settings.value.defaultCarrierId);fillTypes();renderAll();
  status(mode==='terminal'?(settings.value.terminals.length?'已切换到码头模式。':'已切换到码头模式。请先到配置页添加码头。'):'已切换到航司模式。');
  if(query.container)scheduleIdentify();
}
export function setLanguage(value){flushSave();applyLanguage(value);persist(validateSettings({...settings.value,language:value}));}
// Only on the user's click. Chrome always asks before opening another program; a page cannot replace that prompt.
export function openDefaultApps(){openMailto('ms-settings:defaultapps');}
function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function scriptText(){const response=await fetch('./airscript/LFD_ReadOnly.js');if(!response.ok)throw new Error('无法读取插件中的只读脚本。');return response.text();}
export function exportConfig(){try{download(JSON.stringify(createConfig(settings.value),null,2)+'\n','trucker-helper-config.json','application/json');status('配置 JSON 已导出。','success');}catch(error){status(error.message,'error');}}
function afterReplace(){resetResult();fillQueryCarrier(terminalMode.value?ui.profile.terminal:settings.value.defaultCarrierId);fillTypes();renderAll();}
// Pasted, not picked: on Windows the system file picker makes the toolbar popup go blank and close.
function applyImport(){
  const text=importText.value;if(!text.trim())return;
  try{
    const next=parseConfig(text,settings.value);
    discardPendingEdits();persist(next);importText.value='';afterReplace();
    status(`配置已导入：${next.carriers.length} 家船公司、${next.terminals.length} 个码头。`,'success');
  }catch(error){status(error.message,'error');}
}
let importTimer;
export function importInput(value){importText.value=value;clearTimeout(importTimer);importTimer=setTimeout(applyImport,250);}
export async function restoreDefaults(){
  if(!await ask('恢复默认配置？船公司、模板和连接设置会换成插件内置内容，码头配置和操作记录保留。'))return;
  const {mode,terminals,autoCc,language:chosen}=settings.value;
  discardPendingEdits();persist(validateSettings({mode,terminals,autoCc,language:chosen}));afterReplace();status('已恢复默认配置。','success');
}
export async function clearCache(){
  clearTimeout(debounce);if(busy.value)return;
  try{
    busy.value=true;await rpc({type:'clearCache'});
    lastResult.value=null;lastOperationId='';lastRenderedOperation='';draftTabId.value=null;configMissing.value=false;
    query.mbl='';view.needsConfig=false;
    lookupError('本地缓存已清除，请点击查询或重新粘贴柜号。');
    status('本地缓存已清除，配置和邮件操作记录已保留。','success');
  }catch(error){status(error.message,'error');}finally{busy.value=false;}
}
export async function testNotification(){try{await rpc({type:'testNotification'});status('已发送测试通知，请点击它。');}catch(error){status(error.message,'error');}}
export async function copyScript(){
  try{
    const text=await scriptText();
    try{await navigator.clipboard.writeText(text);status('只读脚本已复制，可到金山文档粘贴并保存。','success');}
    catch{scriptFallback.value=text;nextTick(()=>{const box:any=document.getElementById('scriptFallback');box?.focus();box?.select();});status('请复制下方已选中的脚本，或点击下载。');}
  }catch(error){status(error.message,'error');}
}
export async function downloadScript(){try{download(await scriptText(),'LFD_ReadOnly_v1.js','text/javascript');status('只读脚本已下载。','success');}catch(error){status(error.message,'error');}}

function showAutoCcSection(){
  showPage('config');setOpen('autoCcSection',true);
  nextTick(()=>document.getElementById('autoCcSection')?.scrollIntoView());
}
// Starts everything once the page is mounted, then returns the popup to where the user left off.
export async function boot(){
  try{await refreshState({initial:true});}
  catch(error){status(error.message,'error');}
  finally{
    initializing=false;
    if(!lastResult.value&&!busy.value&&!notFoundDialog.show&&validContainer(query.container))scheduleIdentify();
  }
  showPage(ui.page);
  if(openedAutoCc)nextTick(()=>document.getElementById('autoCcSection')?.scrollIntoView());
  // The popup closes as soon as it loses focus (e.g. to copy text from another window).
  addEventListener('pagehide',flushSave);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flushSave();});
  if(demo)return;
  // The Gmail button asks a page that is already open to show the section.
  chrome.runtime.onMessage.addListener(request=>{if(request?.type==='showAutoCc')showAutoCcSection();});
  // Another window of the plugin changed something. The field being typed in is left alone.
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local'||!changes.settings?.newValue||saveTimer||pendingWrites)return;
    let next;try{next=validateSettings(changes.settings.newValue);}catch{return;}
    if(JSON.stringify(next)===JSON.stringify(settings.value))return;
    settings.value=next;followingChange=true;applyLanguage(next.language);
    const typing=document.activeElement?.closest?.('#page-config form');
    fillQueryCarrier(query.carrier);fillTypes();
    if(!typing)renderAll();
    followingChange=false;
  });
}
