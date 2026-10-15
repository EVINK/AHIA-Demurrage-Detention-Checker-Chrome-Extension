import {createService} from './service.js';
import {readKdocsPage} from './kdocs.js';
import {gmailPage} from './gmail.js';
import {coscoPage} from './cosco.js';
import {onePage} from './one.js';
import {validateSettings} from './config.js';
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
async function execute(tabId,func,args=[],world='ISOLATED'){
  const result=await chrome.scripting.executeScript({target:{tabId},func,args,world});
  if(!result?.[0]||result[0].result===undefined)throw new Error('页面操作没有返回结果。请检查对应页面。');
  const response=result[0].result;
  if(!response.ok)throw new Error(response.error||'页面操作失败。');
  return response.data;
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Gmail closes its full-screen compose tab only after the message has really left
// (after any Undo Send delay). The "Message sent" toast alone can appear while the
// send is still pending, e.g. when Chrome throttles or freezes the background tab.
const SEND_CLOSE_TIMEOUT=60000;
const COSCO_TICKET_URL='https://support.cosco-usa.com/support/tickets/new';
const ONE_CHAT_URL='https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking';
const AGENT_TIMEOUT=10*60000,READ_TIMEOUT=5*60000;
// Start the chat, walk the bot menus, transfer to an agent and, once one joins, `type` or `send` the message.
async function toAgent(tabId,payload,last){
  await inFrame(tabId,'chat','start',payload,90000);
  await inFrame(tabId,'calc','finish',payload,60000);
  await inFrame(tabId,'chat','transfer',payload,90000);
  // Agents close idle chats within minutes, so act as soon as one joins.
  const end=Date.now()+AGENT_TIMEOUT;
  for(;;){
    const state=await inFrame(tabId,'chat','agent');
    if(state.agent)break;
    if(state.ended)throw new Error('ONE 对话已结束，客服未接入');
    if(Date.now()>end)throw new Error('等待 ONE 客服接入超时（10 分钟）');
    await pause(3000);
  }
  return inFrame(tabId,'chat',last,payload);
}
// Run onePage in whichever frame of the tab is `kind`; frames appear asynchronously, so retry until one answers.
async function inFrame(tabId,kind,action,payload={},timeout=45000){
  const end=Date.now()+timeout;let lastError='';
  while(Date.now()<end){
    let results=[];
    try{results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:onePage,args:[kind,action,payload],world:'MAIN'});}
    catch(error){lastError=error.message;}
    const hit=results.map(r=>r?.result).find(r=>r&&!(r.ok&&r.data?.skip));
    if(hit){if(!hit.ok)throw new Error(hit.error||'ONE 页面操作失败。');return hit.data;}
    await pause(1000);
  }
  throw new Error(`ONE 页面没有加载出所需的${kind==='chat'?'聊天窗口':kind==='calc'?'计算器':'页面'}${lastError?'（'+lastError+'）':''}。`);
}
async function closedByGmail(tabId){const end=Date.now()+SEND_CLOSE_TIMEOUT;while(Date.now()<end){try{await chrome.tabs.get(tabId);}catch{return true;}await pause(500);}return false;}
async function loaded(tabId){const end=Date.now()+25000;while(Date.now()<end){if((await chrome.tabs.get(tabId)).status==='complete')return;await new Promise(r=>setTimeout(r,200));}throw new Error('页面加载超时。');}
const store={get:async keys=>{const result=await chrome.storage.local.get(keys);result.settings=validateSettings(result.settings||{});return result;},set:data=>chrome.storage.local.set(data)};
const service=createService({storage:store,
  readSheet:async settings=>{
    // Own this temporary tab; never select scripts or change UI in user tabs.
    // Bundled read-only script: installed into / upgraded in the account's 「我的脚本」 when needed.
    const code=await (await fetch(chrome.runtime.getURL('airscript/LFD_ReadOnly.js'))).text();
    const build=Number(code.match(/LFD build:\s*(\d+)/)?.[1]);
    if(!build)throw new Error('插件内的只读脚本缺少版本号。');
    const tab=await chrome.tabs.create({url:new URL(settings.sheetUrl).href,active:false});
    try{
      // MAIN world: the AirScript log list's full data is only reachable from page scripts.
      await loaded(tab.id);return await execute(tab.id,readKdocsPage,[{name:'LFD_ReadOnly_v1',code,build}],'MAIN');
    }finally{
      await chrome.tabs.remove(tab.id).catch(()=>{});
    }
  },
  prepareMail:async payload=>{
    const url=new URL(`https://mail.google.com/mail/u/${payload.gmailIndex}/`);
    url.search=new URLSearchParams({view:'cm',fs:'1',to:payload.to.join(','),cc:payload.cc.join(','),su:payload.subject});
    const tab=await chrome.tabs.create({url:url.href,active:false});await loaded(tab.id);
    const result=await execute(tab.id,gmailPage,['prepare',payload]);return {...result,tabId:tab.id};
  },
  prepareTicket:async payload=>{
    // Submitting needs the user to complete the reCAPTCHA, so that tab is opened in front.
    const tab=await chrome.tabs.create({url:COSCO_TICKET_URL,active:payload.submit===true});await loaded(tab.id);
    await execute(tab.id,coscoPage,['fill',payload]);return {tabId:tab.id};
  },
  submitTicket:async(prepared,payload)=>{
    let before;
    try{before=(await chrome.tabs.get(prepared.tabId)).url;await execute(prepared.tabId,coscoPage,['submit',payload]);}
    catch(error){error.notTransmitted=true;throw error;}
    const end=Date.now()+30000;
    while(Date.now()<end){
      let tab;try{tab=await chrome.tabs.get(prepared.tabId);}catch{throw new Error('COSCO 工单页在提交后被关闭，无法确认是否提交成功');}
      if(tab.status==='complete'&&tab.url!==before)break;
      await pause(500);
    }
    const result=await execute(prepared.tabId,coscoPage,['result']);
    if(result.confirmed)return result;
    const error=new Error(`未检测到 COSCO 工单提交成功${result.reason?'：'+result.reason:''}`);
    // Still on the form with validation errors: the ticket was not accepted.
    if(result.formStillOpen&&result.reason)error.notTransmitted=true;
    throw error;
  },
  prepareChat:async payload=>{
    const tab=await chrome.tabs.create({url:ONE_CHAT_URL,active:false});await loaded(tab.id);
    // Start a new conversation every time: forget any unfinished chat ONE would resume, then reload.
    await inFrame(tab.id,'top','reset');
    await inFrame(tab.id,'chat','reset',{},8000).catch(()=>{});
    await chrome.tabs.reload(tab.id);await pause(500);await loaded(tab.id);
    await inFrame(tab.id,'top','open',payload);
    await inFrame(tab.id,'chat','form',payload);
    if(payload.send)return {tabId:tab.id};
    // Test mode goes all the way to the agent and types the message, but never sends it.
    const typed=await toAgent(tab.id,payload,'type');
    return {tabId:tab.id,agent:typed.agent};
  },
  sendChat:async(prepared,payload)=>{
    const tabId=prepared.tabId;
    let sent;
    try{sent=await toAgent(tabId,payload,'send');}catch(error){error.notTransmitted=true;throw error;}
    // Done only when the agent has read it (Sent → Delivered → Read).
    const end=Date.now()+READ_TIMEOUT;let receipt;
    while(Date.now()<end){receipt=await inFrame(tabId,'chat','receipt',payload);if(/^Read$/i.test(receipt.status))return {confirmed:true,agent:sent.agent,evidence:receipt.evidence};await pause(3000);}
    throw new Error(`ONE 客服 5 分钟内未读消息（当前状态：${receipt?.status||'未找到消息'}）`);
  },
  sendMail:async(prepared,payload)=>{
    const sent=await execute(prepared.tabId,gmailPage,['send',{...payload,bodyHash:prepared.bodyHash}]);
    if(!await closedByGmail(prepared.tabId))throw new Error('Gmail 出现了发送提示，但写信页未自动关闭，邮件可能没有真正发出。已保留该标签页供核实');
    return sent;
  }
});
// Popup lifetime is shorter than a lookup. Persist its job so closing/reopening
// the popup never repeats the query or creates a second draft.
let pendingOperation=null;
async function runOperation(message){
  if(pendingOperation)throw new Error('已有查询正在进行。重新打开插件可查看进度。');
  const operation={id:crypto.randomUUID(),status:'running',mode:message.mode,container:message.container,options:message.options,time:Date.now()};
  pendingOperation=operation.id;
  try{
    await chrome.storage.local.set({operation});
    operation.result=await service.run(message.container,message.mode,
      ['draft','send'].includes(message.mode)?{...message.options,useConfirmed:true}:message.options);
    operation.status='complete';
    await chrome.storage.local.set({operation});
    return operation.result;
  }catch(error){
    operation.status='failed';operation.error=error.message;
    await chrome.storage.local.set({operation});throw error;
  }finally{pendingOperation=null;}
}
async function state(){
  const pendingAtRead=pendingOperation;
  const value=await store.get(['settings','ledger','operation']);
  if(value.operation?.status==='running'&&!pendingAtRead&&!pendingOperation){
    value.operation={...value.operation,status:'interrupted',error:'上次查询中断。请核对操作记录与 Gmail 草稿，再重新查询。'};
  }
  return value;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('app.html'))return false;
  (async()=>{
    if(message.type==='run')return runOperation(message);
    if(message.type==='release')return service.release(message.key);
    if(message.type==='state')return state();
    if(message.type==='clearCache'){
      if(pendingOperation)throw new Error('请等当前操作完成后再清除缓存。');
      await chrome.storage.local.set({sheetCache:null,operation:null});return true;
    }
    if(message.type==='openDraft'){
      const {ledger={}}=await store.get(['ledger']);
      if(!Number.isInteger(message.tabId)||!Object.values(ledger).some(entry=>entry.tabId===message.tabId&&['draft','uncertain','needs_review'].includes(entry.status)))throw new Error('草稿标签页不在插件记录中。请到 Gmail 草稿中查看。');
      const tab=await chrome.tabs.get(message.tabId);
      if(!['https://mail.google.com/','https://support.cosco-usa.com/','https://www.one-line.com/'].some(origin=>tab.url?.startsWith(origin)))throw new Error('原草稿标签页已变更，请到 Gmail 草稿中查看。');
      await chrome.tabs.update(message.tabId,{active:true});return true;
    }
    if(message.type==='settings'){
      if(pendingOperation)throw new Error('请等当前查询完成后再修改配置。');
      const settings=validateSettings(message.settings);
      await chrome.storage.local.set({settings});return settings;
    }
    throw new Error('未知操作。');
  })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
});
