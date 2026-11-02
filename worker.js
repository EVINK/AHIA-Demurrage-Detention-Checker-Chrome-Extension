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
// The reCAPTCHA is completed by the user in a small floating window. Chrome cannot keep it always on
// top, so when it falls behind another window a notification brings it back.
const noticeTabs=new Map();
// Windows may refuse a background program's focus request and only flash it in the taskbar; ask again
// shortly after, and flash the taskbar entry in case the system still keeps it behind.
async function raise(windowId){
  await pause(300);
  await chrome.windows.update(windowId,{focused:true}).catch(()=>{});
  await chrome.windows.update(windowId,{drawAttention:true}).catch(()=>{});
}
// Move a tab into a small floating popup window (once) and bring it to the front.
// ONE and COSCO pages run in their own small popup window at the bottom-right of the browser, without
// taking focus and never as a tab in the user's window.
async function openWork(url,size={width:456,height:700}){
  const anchor=await chrome.windows.getLastFocused({windowTypes:['normal']}).catch(()=>null);
  const place=anchor?.width?{left:Math.max(0,anchor.left+anchor.width-size.width-16),top:Math.max(0,anchor.top+anchor.height-size.height-16)}:{};
  const win=await chrome.windows.create({url,type:'popup',focused:false,...size,...place});
  await chrome.windows.update(win.id,{...size,...place}).catch(()=>{});
  const tabId=win.tabs?.[0]?.id??(await chrome.tabs.query({windowId:win.id}))[0].id;
  await loaded(tabId);return {id:tabId};
}
async function floatTab(tabId,size={width:456,height:700}){
  const tab=await chrome.tabs.get(tabId),win=await chrome.windows.get(tab.windowId,{populate:true});
  if(win.type==='popup'){
    // Restore the minimized work window to a small floating window in front.
    await chrome.windows.update(win.id,{state:'normal'});await chrome.windows.update(win.id,{...size,focused:true});
    await raise(win.id);return win.id;
  }
  const created=await chrome.windows.create({tabId,type:'popup',...size,focused:true});
  raise(created.id);
  // Re-apply the size: browser launch flags (e.g. --window-size) can override it on creation.
  await chrome.windows.update(created.id,size).catch(()=>{});
  return created.id;
}
function notify(id,tabId,title,message,sticky=false){
  noticeTabs.set(id,tabId);
  chrome.notifications.create(id,{type:'basic',iconUrl:chrome.runtime.getURL('icons/icon128.png'),title,message,priority:2,requireInteraction:sticky}).catch(()=>{});
}
// ONE: a small window with only the chat box (the rest of the page is hidden); COSCO: the ticket page.
async function showTab(tabId){
  const tab=await chrome.tabs.get(tabId);
  if(tab.url?.startsWith('https://www.one-line.com/')){
    await inFrame(tabId,'top','chatOnly',{},5000).catch(()=>{});
    return floatTab(tabId);
  }
  return floatTab(tabId);
}
chrome.notifications.onClicked.addListener(id=>{
  // Config page 「发送测试通知」: confirm that clicks on system notifications reach this browser.
  if(id==='lfd-test'){chrome.notifications.clear(id).catch(()=>{});notify('lfd-test-ok',-1,'插件已收到点击','通知点击正常，COSCO 人机验证和 ONE 客服回复的通知点击后会打开对应小窗。');return;}
  // The worker may have restarted since the notification was shown, so the tab id is also part of the id.
  const tabId=noticeTabs.get(id)??Number(id.match(/^lfd-.*-(\d+)$/)?.[1]);if(!Number.isInteger(tabId))return;
  showTab(tabId).catch(()=>{});chrome.notifications.clear(id).catch(()=>{});
});
// The reCAPTCHA is completed by the user in a small floating window. Chrome cannot keep it always on
// top, so when it falls behind another window a notification brings it back.
async function captchaWindow(tabId,container){
  const windowId=await floatTab(tabId);
  const notice=`lfd-captcha-${tabId}`;let notified=false;
  const onFocus=focused=>{
    if(notified||focused===windowId)return;notified=true;
    notify(notice,tabId,'COSCO 工单等待人机验证',`柜号 ${container}：请在小窗中勾选「I'm not a robot」，插件随后自动提交。点击此通知打开小窗。`,true);
  };
  chrome.windows.onFocusChanged.addListener(onFocus);
  return {windowId,stop:()=>{chrome.windows.onFocusChanged.removeListener(onFocus);noticeTabs.delete(notice);chrome.notifications.clear(notice).catch(()=>{});}};
}
// After the inquiry is read, keep watching the chat for the agent's answer and announce it.
async function watchReplies(tabId,payload,agent){
  const end=Date.now()+15*60000,list=(payload.containers||[payload.container]).join('、');
  while(Date.now()<end){
    let state;try{state=await inFrame(tabId,'chat','replies',payload,8000);}catch{return;}
    if(state.replies.length){notify(`lfd-one-reply-${tabId}`,tabId,`ONE 客服${agent?' '+agent:''}已回复（${list}）`,state.replies.join(' ').slice(0,240)+'\n点击打开聊天小窗。',true);return;}
    if(state.ended)return;
    await pause(5000);
  }
}
async function focusTab(tabId){const tab=await chrome.tabs.get(tabId);await chrome.windows.update(tab.windowId,{focused:true});await chrome.tabs.update(tabId,{active:true});}
const ONE_CHAT_URL='https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking';
const AGENT_TIMEOUT=10*60000,READ_TIMEOUT=5*60000;
// Start the chat, walk the bot menus, transfer to an agent and, once one joins, `type` or `send` the message.
let chatQueue=Promise.resolve();
// Remembered in session storage so a restarted worker still finds the open chat window.
const chatWindow={get:async()=>(await chrome.storage.session.get('chatTab')).chatTab,set:tabId=>chrome.storage.session.set({chatTab:tabId})};
function chatTurn(work){const run=chatQueue.then(work,work);chatQueue=run.catch(()=>{});return run;}
// The previous ONE chat window, if it is still open and an agent is still in the conversation.
async function liveChat(){
  const chatTab=await chatWindow.get().catch(()=>null);
  if(!Number.isInteger(chatTab))return null;
  try{await chrome.tabs.get(chatTab);}catch{await chatWindow.set(null);return null;}
  const state=await inFrame(chatTab,'chat','agent',{},5000).catch(()=>null);
  if(state?.agent&&!state.ended)return chatTab;
  // The agent closed the conversation: close the window this extension opened for it and start over.
  await chrome.tabs.remove(chatTab).catch(()=>{});await chatWindow.set(null);return null;
}
// Send the messages (after reaching an agent unless appending), then wait until every message is Read.
async function deliver(tabId,payload,progress,appended){
  let sent;
  try{sent=appended?(progress('发送消息'),await inFrame(tabId,'chat','send',payload)):await toAgent(tabId,payload,'send',progress);}
  catch(error){if(error.sent>0)return {tabId,sendError:error};throw error;}
  try{return {tabId,agent:sent.agent,sent:await waitRead(tabId,payload,progress,sent.agent)};}
  catch(error){return {tabId,agent:sent.agent,sendError:error};}
}
async function waitRead(tabId,payload,progress,agent){
  progress('等待客服已读');
  // Done only when the agent has read every message (Sent → Delivered → Read).
  const end=Date.now()+READ_TIMEOUT;let statuses=[];
  while(Date.now()<end){
    ({statuses}=await inFrame(tabId,'chat','receipt',payload));
    const read=statuses.filter(status=>/^Read$/i.test(status)).length;
    if(read===statuses.length){watchReplies(tabId,payload,agent);return {confirmed:true,agent,evidence:`${read} 条消息均已读`};}
    progress(`等待客服已读（${read}/${statuses.length}）`);
    await pause(3000);
  }
  const error=new Error(`ONE 客服 5 分钟内未读完消息（${statuses.map(s=>s||'未找到').join(' / ')}）`);
  error.read=statuses.map(status=>/^Read$/i.test(status));
  throw error;
}
async function toAgent(tabId,payload,last,progress=()=>{}){
  progress('开始对话，选择菜单');
  await inFrame(tabId,'chat','start',payload,90000);
  await inFrame(tabId,'calc','finish',payload,60000);
  progress('转人工');
  await inFrame(tabId,'chat','transfer',payload,90000);
  progress('等待客服接入');
  // Agents close idle chats within minutes, so act as soon as one joins.
  const end=Date.now()+AGENT_TIMEOUT;
  for(;;){
    const state=await inFrame(tabId,'chat','agent');
    if(state.agent)break;
    if(state.ended)throw new Error('ONE 对话已结束，客服未接入');
    if(Date.now()>end)throw new Error('等待 ONE 客服接入超时（10 分钟）');
    await pause(3000);
  }
  progress(last==='send'?'客服已接入，发送消息':'客服已接入，填入消息');
  return inFrame(tabId,'chat',last,payload);
}
// Run onePage in whichever frame of the tab is `kind`; frames appear asynchronously, so retry until one answers.
async function inFrame(tabId,kind,action,payload={},timeout=45000){
  const end=Date.now()+timeout;let lastError='';
  while(Date.now()<end){
    let results=[];
    try{results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:onePage,args:[kind,action,payload],world:'MAIN'});}
    catch(error){lastError=error.message;if(/No tab with id|tab was closed|No frame/i.test(error.message))throw Object.assign(new Error('ONE 页面已被关闭'),{closed:true});}
    const hit=results.map(r=>r?.result).find(r=>r&&!(r.ok&&r.data?.skip));
    if(hit){if(!hit.ok)throw Object.assign(new Error(hit.error||'ONE 页面操作失败。'),hit.sent?{sent:hit.sent}:{});return hit.data;}
    await pause(1000);
  }
  throw new Error(`ONE 页面没有加载出所需的${kind==='chat'?'聊天窗口':kind==='calc'?'计算器':'页面'}${lastError?'（'+lastError+'）':''}。`);
}
async function closedByGmail(tabId){const end=Date.now()+SEND_CLOSE_TIMEOUT;while(Date.now()<end){try{await chrome.tabs.get(tabId);}catch{return true;}await pause(500);}return false;}
// With `origin`, also waits out redirects through other sites: a tab can report 'complete' on such a stop, where
// scripts may not run yet.
async function loaded(tabId,origin=''){const end=Date.now()+25000;while(Date.now()<end){const tab=await chrome.tabs.get(tabId);if(tab.status==='complete'&&(!origin||tab.url?.startsWith(origin)))return;await new Promise(r=>setTimeout(r,200));}throw new Error(origin.includes('kdocs')?'金山文档页面没有打开，请确认这个浏览器已登录金山文档。':origin.includes('mail.google')?'Gmail 页面没有打开，请确认这个浏览器已登录 Gmail。':'页面加载超时。');}
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
      await loaded(tab.id,'https://www.kdocs.cn/');return await execute(tab.id,readKdocsPage,[{name:'LFD_ReadOnly_v1',code,build}],'MAIN');
    }finally{
      await chrome.tabs.remove(tab.id).catch(()=>{});
    }
  },
  prepareMail:async payload=>{
    const url=new URL(`https://mail.google.com/mail/u/${payload.gmailIndex}/`);
    url.search=new URLSearchParams({view:'cm',fs:'1',to:payload.to.join(','),cc:payload.cc.join(','),su:payload.subject});
    const tab=await chrome.tabs.create({url:url.href,active:false});await loaded(tab.id,'https://mail.google.com/');
    const result=await execute(tab.id,gmailPage,['prepare',payload]);return {...result,tabId:tab.id};
  },
  prepareTicket:async(payload,progress=()=>{})=>{
    progress('填写 COSCO 工单');
    // Filled in a background tab; for the reCAPTCHA it is moved into a small floating window (submitTicket).
    // Detention: support.cosco-usa.com; On-Hire: coscoshippingla.freshdesk.com (validated in core).
    const url=new URL(payload.url||COSCO_TICKET_URL);
    if(!['support.cosco-usa.com','coscoshippingla.freshdesk.com'].includes(url.hostname))throw new Error('COSCO 工单网址无效。');
    const tab=await openWork(url.href);
    await execute(tab.id,coscoPage,['fill',payload]);return {tabId:tab.id};
  },
  submitTicket:async(prepared,payload,progress=()=>{})=>{
    progress('等待人机验证（小窗）');
    let before,float;
    try{
      before=(await chrome.tabs.get(prepared.tabId)).url;
      float=await captchaWindow(prepared.tabId,payload.container);
      await execute(prepared.tabId,coscoPage,['submit',payload]);
    }
    catch(error){error.notTransmitted=true;throw error;}
    finally{float?.stop();}
    const end=Date.now()+30000;
    while(Date.now()<end){
      let tab;try{tab=await chrome.tabs.get(prepared.tabId);}catch{throw new Error('COSCO 工单页在提交后被关闭，无法确认是否提交成功');}
      if(tab.status==='complete'&&tab.url!==before)break;
      await pause(500);
    }
    const result=await execute(prepared.tabId,coscoPage,['result']);
    // Submitted: the floating window has done its job. On any failure it stays open for the user.
    if(result.confirmed){chrome.windows.remove(float.windowId).catch(()=>{});return result;}
    const error=new Error(`未检测到 COSCO 工单提交成功${result.reason?'：'+result.reason:''}`);
    // Still on the form with validation errors: the ticket was not accepted.
    if(result.formStillOpen&&result.reason)error.notTransmitted=true;
    throw error;
  },
  // ONE allows one chat per browser: tasks take turns; a task appends to the previous chat while its window
  // is open and the agent is still there, otherwise it opens a new window and a new conversation.
  prepareChat:async(payload,progress=()=>{})=>{
    progress('排队中（等待前一个 ONE 任务）');
    return chatTurn(async()=>{
      const reuse=await liveChat();
      if(reuse){
        progress('追加到当前 ONE 对话');
        if(!payload.send){
          const typed=await inFrame(reuse,'chat','type',{...payload,append:true});
          notify(`lfd-one-typed-${reuse}`,reuse,`已追加到 ONE 客服 ${typed.agent} 的对话（未发送）`,`${(payload.containers||[payload.container]).join('、')}：消息已填入聊天框，未发送。点击打开聊天小窗查看。`,true);
          return {tabId:reuse,agent:typed.agent};
        }
        return deliver(reuse,payload,progress,true);
      }
      progress('打开 ONE 页面');
      const tab=await openWork(ONE_CHAT_URL);
      // A new conversation: forget any unfinished chat ONE would resume (in the page and in the chat frame's
      // own storage), then reload. If ONE still resumes an old chat, clear it there and retry once.
      const fresh=async()=>{
        await inFrame(tab.id,'top','reset');
        await inFrame(tab.id,'chat','reset',{},15000).catch(()=>{});
        await chrome.tabs.reload(tab.id);await pause(500);await loaded(tab.id);
        await inFrame(tab.id,'top','open',payload);
        // From here on the small window shows only the chat box.
        await inFrame(tab.id,'top','chatOnly',{},5000).catch(()=>{});
      };
      progress('填写聊天表单');
      await fresh();
      try{await inFrame(tab.id,'chat','form',payload);}
      catch(error){
        if(!/已有进行中的对话/.test(error.message))throw error;
        await inFrame(tab.id,'chat','reset');await fresh();
        await inFrame(tab.id,'chat','form',payload);
      }
      await chatWindow.set(tab.id);
      if(!payload.send){
        // 「转人工但不发送」 goes all the way to the agent and types the message, but never sends it.
        const typed=await toAgent(tab.id,payload,'type',progress);
        notify(`lfd-one-typed-${tab.id}`,tab.id,`ONE 客服 ${typed.agent} 已接入（未发送）`,`${(payload.containers||[payload.container]).join('、')}：消息已填入聊天框，未发送。点击打开聊天小窗查看。`,true);
        return {tabId:tab.id,agent:typed.agent};
      }
      return deliver(tab.id,payload,progress,false);
    });
  },
  // A real send finishes in prepareChat; failures after a message went out surface here as "uncertain".
  sendChat:async prepared=>{if(prepared.sendError)throw prepared.sendError;return prepared.sent;},
  sendMail:async(prepared,payload)=>{
    const sent=await execute(prepared.tabId,gmailPage,['send',{...payload,bodyHash:prepared.bodyHash}]);
    if(!await closedByGmail(prepared.tabId))throw new Error('Gmail 出现了发送提示，但写信页未自动关闭，邮件可能没有真正发出。已保留该标签页供核实');
    return sent;
  }
});
// Popup lifetime is shorter than a lookup. Persist its job so closing/reopening
// the popup never repeats the query or creates a second draft.
// Operations run concurrently; only the newest is persisted for a reopened popup to restore.
const pendingOperations=new Set();let latestOperation='';
async function persist(operation){if(operation.id===latestOperation)await chrome.storage.local.set({operation});}
async function runOperation(message){
  const operation={id:crypto.randomUUID(),status:'running',mode:message.mode,container:message.container,options:message.options,time:Date.now()};
  pendingOperations.add(operation.id);latestOperation=operation.id;
  try{
    await persist(operation);
    operation.result=await service.run(message.container,message.mode,
      ['draft','send'].includes(message.mode)?{...message.options,useConfirmed:true}:message.options);
    operation.status='complete';
    await persist(operation);
    return operation.result;
  }catch(error){
    operation.status='failed';operation.error=error.message;
    await persist(operation);throw error;
  }finally{pendingOperations.delete(operation.id);}
}
async function state(){
  const pendingAtRead=new Set(pendingOperations);
  const value=await store.get(['settings','ledger','operation']);
  const active=service.active();
  for(const entry of Object.values(value.ledger||{}))
    if(entry.running&&!active.has(entry.requestId))Object.assign(entry,{running:false,interrupted:true,step:'',detail:entry.detail||'插件后台被中断，请打开对应页面核实结果。'});
  const id=value.operation?.id;
  if(value.operation?.status==='running'&&!pendingAtRead.has(id)&&!pendingOperations.has(id)){
    value.operation={...value.operation,status:'interrupted',error:'上次查询中断。请核对操作记录与 Gmail 草稿，再重新查询。'};
  }
  return value;
}
// Auto CC in Gmail: content scripts cannot read storage (trusted contexts only), so they get just this part.
const GMAIL_MESSAGES=['autoCcConfig','autoCcOpen'];
async function autoCcConfig(){return (await store.get(['settings'])).settings.autoCc;}
// The Gmail button opens the toolbar popup on the Auto CC section, or a small window where Chrome cannot.
async function openAutoCc(){
  await chrome.storage.session.set({openTarget:'autoCc'});
  try{await chrome.action.openPopup();}
  catch{await chrome.windows.create({url:chrome.runtime.getURL('app.html'),type:'popup',width:800,height:660});}
  return true;
}
async function takeOpenTarget(){
  const {openTarget}=await chrome.storage.session.get('openTarget');
  if(openTarget)await chrome.storage.session.set({openTarget:null});
  return openTarget||'';
}
// Open Gmail pages follow changes made anywhere, right away.
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if(area!=='local'||!changes.settings)return;
  const was=JSON.stringify(changes.settings.oldValue?.autoCc),now=changes.settings.newValue?.autoCc;
  if(!now||was===JSON.stringify(now))return;
  for(const tab of await chrome.tabs.query({url:'https://mail.google.com/*'}))chrome.tabs.sendMessage(tab.id,{type:'autoCc',config:now}).catch(()=>{});
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id===chrome.runtime.id&&String(sender.tab?.url||'').startsWith('https://mail.google.com/')&&GMAIL_MESSAGES.includes(message?.type)){
    (message.type==='autoCcOpen'?openAutoCc():autoCcConfig()).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));
    return true;
  }
  // Only this extension's own app.html (popup or tab, any #fragment such as #import).
  if(sender.id!==chrome.runtime.id||String(sender.url||'').split('#')[0]!==chrome.runtime.getURL('app.html'))return false;
  (async()=>{
    if(message.type==='run')return runOperation(message);
    // Look up an extra container for a multi-container ONE chat without replacing the popup's main result.
    if(message.type==='peek')return service.run(message.container,'identify',message.options||{});
    if(message.type==='release')return service.release(message.key);
    if(message.type==='cancel'){
      // Stop a running task: flag it, then close its window so any wait ends immediately.
      const tabId=await service.cancel(message.requestId);
      if(Number.isInteger(tabId))await chrome.tabs.remove(tabId).catch(()=>{});
      return true;
    }
    if(message.type==='deleteTask')return service.releaseTask(message.requestId);
    if(message.type==='markSent')return service.markSent(message.requestId);
    if(message.type==='testNotification'){notify('lfd-test',-1,'LFD Inquiry 测试通知','请点击这条通知。插件收到点击后会再弹出「插件已收到点击」。',true);return true;}
    if(message.type==='state')return {...await state(),openTarget:await takeOpenTarget()};
    if(message.type==='clearCache'){
      if(pendingOperations.size)throw new Error('请等当前查询完成后再清除缓存。');
      await chrome.storage.local.set({sheetCache:null,operation:null});return true;
    }
    if(message.type==='openDraft'){
      const {ledger={}}=await store.get(['ledger']);
      if(!Number.isInteger(message.tabId)||!Object.values(ledger).some(entry=>entry.tabId===message.tabId&&(entry.running||['draft','uncertain','needs_review'].includes(entry.status))))throw new Error('草稿标签页不在插件记录中。请到 Gmail 草稿中查看。');
      const tab=await chrome.tabs.get(message.tabId);
      if(!['https://mail.google.com/','https://support.cosco-usa.com/','https://coscoshippingla.freshdesk.com/','https://www.one-line.com/'].some(origin=>tab.url?.startsWith(origin)))throw new Error('原草稿标签页已变更，请到 Gmail 草稿中查看。');
      // ONE chats and COSCO tickets open as small floating windows; Gmail drafts as a normal tab.
      if(/^https:\/\/(www\.one-line\.com|support\.cosco-usa\.com|coscoshippingla\.freshdesk\.com)\//.test(tab.url||''))await showTab(message.tabId);else await focusTab(message.tabId);return true;
    }
    if(message.type==='settings'){
      // Config auto-saves while lookups run; a running job keeps the settings it started with.
      const settings=validateSettings(message.settings);
      await chrome.storage.local.set({settings});return settings;
    }
    throw new Error('未知操作。');
  })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message,...(error.duplicate?{duplicate:error.duplicate}:{})}));return true;
});
