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
export const ask=text=>askDialog(text);

// ---- Shared state
const sources={sheet:'提柜表航司列','mbl-prefix':'MBL 前缀',manual:'手动选择'};
const recordStatus={preparing:'准备中',draft:'草稿已生成 / 已填写未提交',sending:'发送中',sent:'已发送',uncertain:'结果待核实',needs_review:'未完成'};
export const settings=shallowRef(copy(DEFAULT_SETTINGS));
export const ledger=shallowRef({});
export const message=reactive({text:'正在连接插件…',type:''});
export function status(text,type=''){message.text=text;message.type=type;}
export const busy=ref(false);
let tasksTimer=null;
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
    if(request.type==='history')return {ledger:{},archive:[]};
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

// ---- Query page. Containers are pasted or typed into one box; each is looked up on its own, then they are grouped by
// carrier. Every group goes out with its own carrier's settings: one message where the channel takes several
// containers, one request each where it does not (COSCO tickets).
export const query=reactive({text:'',inquiryType:'demurrage'});
const storedInput=()=>remembered('lfd-popup-input',{});
const parseContainers=text=>[...new Set(String(text||'').toUpperCase().match(/[A-Z]{4}\d{7}/g)||[])];
export const entries=reactive([]);
let entryKey=0,parseTimer=null;
function rememberInput(){try{localStorage.setItem('lfd-popup-input',JSON.stringify({containers:entries.map(entry=>entry.container),inquiryType:query.inquiryType}));}catch{}}
const terminalChoice=()=>{const list=settings.value.terminals;return list.find(p=>p.id===ui.profile.terminal)?.id||list[0]?.id||'';};
const notFound=text=>/未找到该柜号/.test(text||'');
function newEntry(container){return reactive({key:++entryKey,container,state:'pending',mbl:'',carrierId:'',carrierName:'',sheetCarrier:'',error:'',override:'',manualMbl:'',sequence:0,timer:null});}
export function lookup(entry,forceRefresh=false){
  clearTimeout(entry.timer);const mine=++entry.sequence;entry.state='pending';entry.error='';
  entry.timer=setTimeout(async()=>{
    try{
      const data=await rpc({type:'peek',container:entry.container,options:{carrierId:terminalMode.value?terminalChoice()||'auto':'auto',inquiryType:query.inquiryType,mode:settings.value.mode,...(forceRefresh?{forceRefresh}:{})}});
      if(mine!==entry.sequence)return;
      const unknown=Boolean(data.unrecognizedCarrier!==undefined&&data.unrecognizedCarrier!==false||data.needsTerminal);
      Object.assign(entry,{state:'done',mbl:data.mbl||'',carrierId:unknown?'':data.carrierId||'',carrierName:unknown?'':data.carrierName||'',
        sheetCarrier:typeof data.unrecognizedCarrier==='string'?data.unrecognizedCarrier:data.carrier||'',error:unknown?data.recognitionError||'':''});
    }catch(error){if(mine===entry.sequence)Object.assign(entry,{state:notFound(error.message)?'notfound':'error',error:error.message});}
  },120);
}
function syncEntries(){
  clearTimeout(parseTimer);parseTimer=null;
  const list=parseContainers(query.text).slice(0,60);
  for(const container of list)if(!entries.some(entry=>entry.container===container)){const entry=newEntry(container);entries.push(entry);lookup(entry);}
  for(let index=entries.length-1;index>=0;index--)if(!list.includes(entries[index].container)){clearTimeout(entries[index].timer);entries.splice(index,1);}
  entries.sort((a,b)=>list.indexOf(a.container)-list.indexOf(b.container));
  rememberInput();
}
export function containersInput(value){query.text=value.toUpperCase();clearTimeout(parseTimer);parseTimer=setTimeout(syncEntries,400);}
function setContainers(list){query.text=list.join('\n');syncEntries();}
export function removeEntry(entry){setContainers(parseContainers(query.text).filter(container=>container!==entry.container));}
export function relookAll(forceRefresh=false){for(const entry of entries)lookup(entry,forceRefresh);}
export function setManualMbl(entry,value){entry.manualMbl=value.toUpperCase().trim();}
export function setOverride(entry,value){entry.override=value;}
const carrierOf=entry=>entry.override||entry.carrierId;
const mblOf=entry=>(entry.manualMbl||entry.mbl||'').trim().toUpperCase();
// All types known in the current mode: containers of different carriers share the one selection.
function knownTypes(){
  const known=new Map(Object.entries(INQUIRY_TYPES).map(([id,label])=>[id,{id,label}]));
  for(const profile of profiles.value)for(const type of profile.types)if(!known.has(type.id))known.set(type.id,type);
  return [...known.values()];
}
export const typeOptions=computed(()=>knownTypes().map(type=>({label:type.label,value:type.id})));
export function chooseType(value){query.inquiryType=value;rememberInput();}
export const profileChoices=computed(()=>profiles.value.map(p=>({label:p.name,value:p.id})));
// A container already on record for this carrier and type is not sent again unless the user asks.
const lockOf=(entry,carrierId,type)=>Object.entries(ledger.value).find(([,record]:any)=>record.container===entry.container&&record.mbl===mblOf(entry)&&(record.carrierId||'maersk')===carrierId&&(record.inquiryType||'demurrage')===type);
export const pendingCount=computed(()=>entries.filter(entry=>entry.state==='pending').length);
export const unresolved=computed(()=>entries.filter(entry=>entry.state!=='pending'&&(!carrierOf(entry)||!mblOf(entry))));
export const groups=computed(()=>{
  const byCarrier=new Map();
  for(const entry of entries){
    if(entry.state==='pending'||!carrierOf(entry)||!mblOf(entry))continue;
    const id=carrierOf(entry);if(!byCarrier.has(id))byCarrier.set(id,[]);byCarrier.get(id).push(entry);
  }
  return [...byCarrier].map(([id,list])=>{
    const profile=profiles.value.find(p=>p.id===id);
    const type=profile?resolveType(profile,query.inquiryType):'',typeEntry=findType(profile,type),channel=type?inquiryChannel(profile,type):'email';
    const many=Boolean(type)&&supportsManyContainers(profile,type),missing=!profile?['carrier']:type?missingConfiguration(profile,type):['type'];
    const rows=list.map(entry=>{const lock=type?lockOf(entry,id,type):null;return {entry,lock:lock?{key:lock[0],status:(lock[1] as any).status}:null};});
    const ready=missing.length?[]:rows.filter(row=>!row.lock).map(row=>row.entry);
    const recipients=!typeEntry?'':channel==='one-chat'?`ONE 在线客服 · ${profile.chat?.email||''}`:channel==='cosco-portal'?`COSCO 工单 · Requester ${profile.portal?.requester||''}`:[typeEntry.to.join(', '),typeEntry.cc.length?`Cc ${typeEntry.cc.join(', ')}`:''].filter(Boolean).join(' · ');
    return {id,profile,name:profile?.name||id,type,typeLabel:typeEntry?.label||'',channel,many,missing,rows,ready,recipients,runs:many?(ready.length?[ready]:[]):ready.map(entry=>[entry])};
  });
});
export const totals=computed(()=>{const ready=groups.value.filter(group=>group.ready.length);return {containers:ready.reduce((n,group)=>n+group.ready.length,0),carriers:ready.length};});
export const sendAllLabel=computed(()=>{const {containers,carriers}=totals.value;return containers?`全部发送 · ${containers} 个柜号${carriers>1?` · ${carriers} 家${kind.value}`:''}`:'全部发送';});
const channelNames={email:'Gmail 邮件','cosco-portal':'COSCO 工单','one-chat':'ONE 在线客服'};
export const channelName=group=>group.channel==='email'&&mailProgram(settings.value.mailClient)?'电脑邮件程序':channelNames[group.channel];
export function groupLabels(group){
  if(group.channel==='one-chat')return {send:'发送 ONE 消息',draft:'转人工但不发送'};
  if(group.channel==='cosco-portal')return {send:'提交工单',draft:'仅填写工单'};
  if(mailProgram(settings.value.mailClient))return {send:'打开邮件程序',draft:''};
  return {send:'发送邮件',draft:'仅生成草稿'};
}
export const recordLabel=status=>recordStatus[status]||status;
export function entryNote(entry){
  if(entry.state==='pending')return '正在查询…';
  if(entry.state==='notfound')return '提柜表中找不到这个柜号';
  if(entry.state==='error')return entry.error;
  if(!mblOf(entry))return '没有取得 MBL，请填写';
  if(!carrierOf(entry))return entry.sheetCarrier?`表中船公司「${entry.sheetCarrier}」未配置，请选择`:`请选择${kind.value}`;
  return '';
}
export function previewOf(group){
  const items=(group.ready.length?group.ready:group.rows.map(row=>row.entry)).map(entry=>({container:entry.container,mbl:mblOf(entry)}));
  if(!items.length||group.missing.length)return null;
  const [first,...rest]=items;
  try{
    if(group.channel==='one-chat'){const chat=chatTemplate(first,{carrier:group.profile,inquiryType:group.type,more:rest.slice(0,9)});return {to:`${chat.firstName} ${chat.lastName} · ${chat.email}`,subject:'',html:'',lines:chat.messages};}
    if(group.channel==='cosco-portal'){const ticket=portalTemplate(first,{carrier:group.profile,inquiryType:group.type,...(group.many&&rest.length?{more:rest}:{})});return {to:new URL(ticket.url).hostname,subject:ticket.fields.map(f=>f.value).join(' · '),html:ticket.html,lines:[],note:!group.many&&items.length>1?`共 ${items.length} 张工单，这里是第一张`:''};}
    const mail=messageTemplate(first,{carrier:group.profile,inquiryType:group.type,...(rest.length?{more:rest}:{})});
    return {to:mail.to.join(', '),cc:mail.cc.join(', '),subject:mail.subject,html:mail.html,lines:[]};
  }catch(error){return {error:error.message};}
}
export const sending=reactive({});
async function runGroup(group,mode){
  const queued=[],failed=[],duplicates=[];
  for(const run of group.runs){
    const [first,...rest]=run;
    try{
      const data=await rpc({type:'run',mode,container:first.container,options:{carrierId:group.id,inquiryType:query.inquiryType,mode:settings.value.mode,manualMbl:mblOf(first),useConfirmed:true,...(rest.length?{more:rest.map(entry=>({container:entry.container,mbl:mblOf(entry)}))}:{})}});
      if(data.mailto)openMailto(data.mailto);
      queued.push(...run.map(entry=>entry.container));
    }catch(error){if(error.duplicate)duplicates.push(...error.duplicate);else failed.push(`${run.map(entry=>entry.container).join('、')}：${t(error.message)}`);}
  }
  return {queued,failed,duplicates};
}
async function dispatch(list,mode){
  if(busy.value)return;
  busy.value=true;for(const group of list)sending[group.id]=true;
  status('正在加入后台任务…','running');
  const results=[];
  try{for(const group of list)results.push(await runGroup(group,mode));}
  finally{busy.value=false;for(const group of list)delete sending[group.id];}
  const queued=results.flatMap(result=>result.queued),failed=results.flatMap(result=>result.failed),duplicates=results.flatMap(result=>result.duplicates);
  if(queued.length)setContainers(parseContainers(query.text).filter(container=>!queued.includes(container)));
  const parts=[...(queued.length?[`已加入后台任务：${queued.join('、')}。`]:[]),...failed.map(line=>`未发送 ${line}`)];
  if(parts.length)status(parts.join(' '),failed.length?'error':'success');
  await refreshState().catch(()=>{});
  if(duplicates.length)showDuplicate(duplicates,mode);
}
export const sendGroup=(group,mode)=>dispatch([group],mode);
export const sendAll=mode=>dispatch(groups.value.filter(group=>group.ready.length),mode);
// Sends one container again although it is on record: its lock is released first, after the user agrees.
export async function resendLocked(row){
  if(!await ask(`${row.entry.container} 已有记录（${t(recordLabel(row.lock.status))}）。解除锁定后可以再次发送；如果之前其实已经发出，对方会收到重复的邮件 / 消息。确定解除？`))return;
  try{await rpc({type:'release',key:row.lock.key});await refreshState();status('已解除该条记录的锁定。');}catch(error){status(error.message,'error');}
}
export function moveGroup(group,carrierId){for(const row of group.rows)row.entry.override=carrierId===row.entry.carrierId?'':carrierId;}
export function configureCarrier(group){
  if(!group.profile){openAddProfile(group.name);return;}
  showPage('config');flushSave();if(group.type)ui.type[group.id]=group.type;renderProfile(group.id);
  nextTick(()=>{document.getElementById('page-config').scrollTop=0;focusField('carrierTo');});
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
    const saved=storedInput();
    query.inquiryType=typeOptions.value.some(option=>option.value===saved.inquiryType)?saved.inquiryType:settings.value.defaultInquiryType;
    setContainers(Array.isArray(saved.containers)?saved.containers:saved.container?[saved.container]:[]);
    renderAll();
    status(demo?'界面演示：MRSU4786640 为 Maersk 示例；MSCU1234567 为 MSC 示例。':'');
  }
  return state;
}
export const refresh=()=>refreshState().catch(error=>status(error.message,'error'));
// Launch the computer's default mail program with the filled message.
export function openMailto(url){const a=document.createElement('a');a.href=url;a.rel='noopener';document.body.append(a);a.click();a.remove();}
export async function markSent(requestId){try{await rpc({type:'markSent',requestId});status('已记录为已发送。','success');await refreshState();}catch(error){status(error.message,'error');}}
export async function openDraft(tabId){if(busy.value)return;try{await rpc({type:'openDraft',tabId});}catch(error){status(error.message,'error');}}

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
  try{for(const b of blocking)await rpc({type:'release',key:b.key});status('已解除旧记录的锁定，正在重新发送…','running');await refreshState();sendAll(mode);}
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
    recovered:entry.recovery?`重载 ${entry.recovery.reloads} 次后恢复`:'',
    diagnostics:entry.diagnostics||entry.recovery?{...entry.recovery&&{recovery:entry.recovery},...entry.diagnostics}:null,
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
// Put the containers back on the query page with the same type.
function refill(containers,entry){
  showPage('query');
  if(entry.inquiryType)query.inquiryType=entry.inquiryType;
  setContainers(containers);
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
// The query page's groups follow the settings by themselves; a type that no longer exists falls back to the first.
function afterConfigChange(){if(!typeOptions.value.some(option=>option.value===query.inquiryType))query.inquiryType=typeOptions.value[0]?.value||'demurrage';}
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
  for(const entry of entries)entry.override='';
  afterConfigChange();renderAll();relookAll();
  status(mode==='terminal'?(settings.value.terminals.length?'已切换到码头模式。':'已切换到码头模式。请先到配置页添加码头。'):'已切换到航司模式。');
}
export function setLanguage(value){flushSave();applyLanguage(value);persist(validateSettings({...settings.value,language:value}));}
// Only on the user's click. Chrome always asks before opening another program; a page cannot replace that prompt.
export function openDefaultApps(){openMailto('ms-settings:defaultapps');}
function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function scriptText(){const response=await fetch('./airscript/LFD_ReadOnly.js');if(!response.ok)throw new Error('无法读取插件中的只读脚本。');return response.text();}
export async function exportHistory(){
  try{const {ledger:current,archive}=await rpc({type:'history'});download(JSON.stringify({exportedAt:new Date().toISOString(),ledger:current,archive},null,2)+'\n','trucker-helper-history.json','application/json');status('记录已导出。','success');}
  catch(error){status(error.message,'error');}
}
export function exportConfig(){try{download(JSON.stringify(createConfig(settings.value),null,2)+'\n','trucker-helper-config.json','application/json');status('配置 JSON 已导出。','success');}catch(error){status(error.message,'error');}}
function afterReplace(){afterConfigChange();renderAll();relookAll();}
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
  if(busy.value)return;
  try{
    busy.value=true;await rpc({type:'clearCache'});
    status('本地缓存已清除，配置和邮件操作记录已保留。','success');
    relookAll();
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
    afterConfigChange();
    if(!typing)renderAll();
    followingChange=false;
  });
}
