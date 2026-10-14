import {createService} from './service.js';
import {readKdocsPage} from './kdocs.js';
import {gmailPage} from './gmail.js';
import {coscoPage} from './cosco.js';
import {validateSettings} from './config.js';
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
async function execute(tabId,func,args=[]){
  const result=await chrome.scripting.executeScript({target:{tabId},func,args});
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
async function closedByGmail(tabId){const end=Date.now()+SEND_CLOSE_TIMEOUT;while(Date.now()<end){try{await chrome.tabs.get(tabId);}catch{return true;}await pause(500);}return false;}
async function loaded(tabId){const end=Date.now()+25000;while(Date.now()<end){if((await chrome.tabs.get(tabId)).status==='complete')return;await new Promise(r=>setTimeout(r,200));}throw new Error('页面加载超时。');}
const store={get:async keys=>{const result=await chrome.storage.local.get(keys);result.settings=validateSettings(result.settings||{});return result;},set:data=>chrome.storage.local.set(data)};
const service=createService({storage:store,
  readSheet:async settings=>{
    // Own this temporary tab; never select scripts or change UI in user tabs.
    const tab=await chrome.tabs.create({url:new URL(settings.sheetUrl).href,active:false});
    try{
      await loaded(tab.id);return await execute(tab.id,readKdocsPage);
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
      if(!['https://mail.google.com/','https://support.cosco-usa.com/'].some(origin=>tab.url?.startsWith(origin)))throw new Error('原草稿标签页已变更，请到 Gmail 草稿中查看。');
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
