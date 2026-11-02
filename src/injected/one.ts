// @ts-nocheck
// Self-contained adapter for the ONE live chat. Injected into every frame of a tab the extension
// opened on one-line.com; each call targets one frame kind and the other frames return {skip:true}.
//   top   www.one-line.com             chat launcher and country picker
//   chat  one-line.my.site.com         Salesforce messaging (pre-chat form, bot menus, agent)
//   calc  cms-resources-*.one-line.com free-days calculator that holds FINISHED MY INQUIRY
export async function onePage(kind,action,payload){
  try {
  const here=location.hostname==='www.one-line.com'?'top'
    :location.hostname==='one-line.my.site.com'&&/\/ESWOneMessaging\w*\//.test(location.pathname)&&!/\/assets\//.test(location.pathname)?'chat'
    :/^cms-resources-[a-z]+\.one-line\.com$/.test(location.hostname)&&/freedays-and-dndcalculator/.test(location.pathname)?'calc':'';
  if(here!==kind)return {ok:true,data:{skip:true}};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  // Hidden pages get throttled timers (up to one per minute), so always check once more after the deadline.
  async function waitFor(fn,description,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const v=fn();if(v)return v;await pause(250);}const v=fn();if(v)return v;throw new Error(description);}
  const visible=e=>e&&e.getClientRects().length>0;
  // Salesforce LWC hides component internals from querySelectorAll; a TreeWalker (plus open shadow roots) sees them.
  const deepAll=pred=>{const out=[];const walk=root=>{const w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);for(let n=w.currentNode;n;n=w.nextNode()){if(n.nodeType!==1)continue;if(pred(n))out.push(n);if(n.shadowRoot)walk(n.shadowRoot);}};walk(document.body);return out;};
  const text=e=>(e.textContent||'').replace(/\s+/g,' ').trim();
  const setValue=(input,value)=>{
    const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
    input.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText'}));
    input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
  };
  // Menus are re-posted as new messages; earlier copies stay but are disabled, so take the newest enabled one.
  const option=label=>deepAll(e=>e.tagName==='BUTTON'&&!e.disabled&&visible(e)&&text(e)===label).at(-1);
  async function choose(label){(await waitFor(()=>option(label),`ONE 客服菜单中没有出现「${label}」，页面可能已改版。`,45000)).click();await pause(800);}

  // ONE resumes an unfinished chat on every page load. Forget it (the old chat simply expires) so each
  // inquiry starts a new conversation. Only chat-session keys are removed.
  const forget=storage=>Object.keys(storage).filter(k=>/^(ChatInfo|chat_transcript_id|chat_historyShown|sessionOwner)$|_WEB_STORAGE$/.test(k));
  if(action==='reset'&&(kind==='top'||kind==='chat')){
    const keys=[...forget(localStorage).map(k=>(localStorage.removeItem(k),k)),...forget(sessionStorage).map(k=>(sessionStorage.removeItem(k),k))];
    return {ok:true,data:{cleared:keys}};
  }
  if(kind==='top'&&action==='chatOnly'){
    // Floating window shows only the chat: hide the rest of the page and let the chat frame fill it.
    // Only once the chat frame exists; otherwise ONE's own page (and any notice on it) stays visible.
    if(!document.getElementById('embeddedMessagingFrame'))return {ok:true,data:{chatOnly:false}};
    if(!document.getElementById('lfd-chat-only')){
      const style=document.createElement('style');style.id='lfd-chat-only';
      style.textContent='html,body{overflow:hidden!important;background:#fff!important}body>*:not(#embedded-messaging){display:none!important}#embeddedMessagingFrame{inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;border-radius:0!important;box-shadow:none!important}';
      document.head.append(style);
    }
    return {ok:true,data:{chatOnly:!!document.getElementById('embeddedMessagingFrame')}};
  }
  if(kind==='top'){
    if(action!=='open'&&action!=='retryOpen')throw new Error('未知 ONE 页面操作。');
    const wrapper=()=>document.querySelector('#one-chat-wrapper');
    const maintenance=()=>[...document.querySelectorAll('.mtn-combile-block,#one-chat-wrapper-mtn')].find(visible);
    const chatFrame=()=>document.getElementById('embeddedMessagingFrame');
    // The chat box normally appears within seconds. When it does not, nobody knows why yet, so a failure records
    // what the page looked like. Kept in sessionStorage so it survives the page reloading itself.
    const TRACE='lfd-one-trace',continueWait=payload.continueWait??45000;
    const storedTrace=()=>{try{return JSON.parse(sessionStorage.getItem(TRACE)||'null');}catch{return null;}};
    const keepTrace=trace=>{try{sessionStorage.setItem(TRACE,JSON.stringify(trace));}catch{}};
    const forgetTrace=()=>{try{sessionStorage.removeItem(TRACE);}catch{}};
    function watch(trace){
      const note=(key,value)=>{trace[key]=[...(trace[key]||[]),value].slice(-6);keepTrace(trace);};
      addEventListener('error',event=>{const target=event.target;if(target&&target!==window)note('loadErrors',target.src||target.href||target.tagName);else note('pageErrors',String(event.message).slice(0,160));},true);
      addEventListener('unhandledrejection',event=>note('pageErrors',String(event.reason?.message||event.reason).slice(0,160)));
      addEventListener('onEmbeddedMessagingReady',()=>{trace.embeddedReadyAt=new Date().toISOString();keepTrace(trace);});
      addEventListener('pagehide',()=>{trace.pageLeftAt=new Date().toISOString();keepTrace(trace);});
      return trace;
    }
    function snapshot(trace){
      const box=wrapper(),start=box?.querySelector('.start-chat'),script=pattern=>[...document.scripts].some(item=>pattern.test(item.src));
      const network=performance.getEntriesByType('resource').filter(entry=>/salesforce|my\.site\.com|force\.com|liveagent|livechat_department|one_chat/i.test(entry.name)).slice(-14)
        .map(entry=>{const url=new URL(entry.name);return {url:url.host+url.pathname,status:entry.responseStatus,ms:Math.round(entry.duration)};});
      return {...trace,failedAt:new Date().toISOString(),path:location.pathname,visibility:document.visibilityState,hasFocus:document.hasFocus(),navigation:performance.getEntriesByType('navigation')[0]?.type,
        wrapperVisible:visible(box),loading:Boolean(box?.classList.contains('chat-loading')),continueDisabled:Boolean(start?.classList.contains('disabled')),maintenance:maintenance()?text(maintenance()).slice(0,200):'',
        customizeScript:script(/PilotMessagingCustomize/),bootstrapScript:script(/bootstrap(\.min)?\.js/),embeddedBootstrap:typeof window.embeddedservice_bootstrap,messagingService:typeof window.messaging_service,chatFrame:Boolean(chatFrame()),network};
    }
    async function clickContinue(button,trace){
      Object.assign(trace,{clicks:(trace.clicks||0)+1,clickedAt:new Date().toISOString(),visibilityAtClick:document.visibilityState,focusAtClick:document.hasFocus()});
      keepTrace(trace);button.click();
      const outcome=await waitFor(()=>chatFrame()?'chat':maintenance()?'maintenance':null,'',continueWait).catch(()=>null);
      if(outcome==='maintenance'){forgetTrace();throw new Error(`ONE 在线客服暂不可用：${text(maintenance()).slice(0,200)}`);}
      if(outcome==='chat'){forgetTrace();return {opened:true};}
      return null;
    }
    if(action==='retryOpen'){
      const trace=window.__lfdOneTrace||watch(storedTrace()||{});window.__lfdOneTrace=trace;trace.retried=true;keepTrace(trace);
      if(chatFrame()){forgetTrace();return {ok:true,data:{opened:true}};}
      const button=wrapper()?.querySelector('.start-chat');
      // A disabled button means ONE is still working on the first click: a second one would do nothing.
      const result=visible(button)&&!button.classList.contains('disabled')?await clickContinue(button,trace):await waitFor(()=>chatFrame(),'',continueWait).then(()=>({opened:true}),()=>null);
      if(result){forgetTrace();return {ok:true,data:result};}
      const diagnostics=snapshot(trace);forgetTrace();
      throw Object.assign(new Error('点击 Continue 后 ONE 聊天窗口 90 秒内没有出现，请打开 ONE 小窗查看页面提示。'),{diagnostics});
    }
    if(maintenance())throw new Error(`ONE 在线客服暂不可用：${text(maintenance()).slice(0,200)}`);
    // ONE reopened an earlier conversation by itself: the chat frame is already there (the form step decides).
    if(document.getElementById('embeddedMessagingFrame')&&!visible(wrapper()))return {ok:true,data:{opened:true,resumed:true}};
    if(!visible(wrapper())){
      (await waitFor(()=>document.querySelector('.chat-icon'),'ONE 页面上没有找到在线客服图标（可能仍接回了旧对话）。')).click();
      await waitFor(()=>visible(wrapper()),'ONE 在线客服窗口没有打开。');
    }
    const country=await waitFor(()=>wrapper().querySelector('input.selected'),'没有找到 ONE 在线客服的国家选择。');
    if(country.value.trim()!==payload.country){
      country.click();
      const item=await waitFor(()=>[...wrapper().querySelectorAll('li.group-item')].find(li=>text(li)===payload.country),`ONE 在线客服没有「${payload.country}」这个国家。`,5000);
      item.click();await pause(500);
      if(country.value.trim()!==payload.country)throw new Error('选择 ONE 在线客服国家失败。');
    }
    // ONE marks the country offline outside its live-chat hours; Continue is then disabled and does nothing.
    const status=wrapper().querySelector('.selected-status-icon')?.className||country.className;
    if(/\boffline\b/.test(status))throw new Error(`ONE 在线客服（${payload.country}）当前不在服务时间，请稍后再查询。`);
    const label=await waitFor(()=>[...wrapper().querySelectorAll('*')].find(e=>visible(e)&&e.childElementCount===0&&text(e)==='Continue'),'没有找到 Continue 按钮。');
    const button=label.closest('.start-chat')||label;
    if(button.classList.contains('disabled'))throw new Error(`ONE 在线客服（${payload.country}）的 Continue 不可用，可能不在服务时间。`);
    // A trace left by an earlier click on this page means ONE reloaded the page instead of opening the chat.
    const earlier=storedTrace(),trace=watch({...earlier,...(earlier?{reloadedAfterContinue:true}:{})});window.__lfdOneTrace=trace;
    const result=await clickContinue(button,trace);
    // Not there yet: the worker brings the window forward and asks for one more attempt.
    if(!result)return {ok:true,data:{opened:false}};
    return {ok:true,data:{opened:true}};
  }

  if(kind==='calc'){
    if(action!=='finish')throw new Error('未知 ONE 计算器操作。');
    (await waitFor(()=>[...document.querySelectorAll('button')].find(b=>visible(b)&&text(b)==='FINISHED MY INQUIRY'),'没有找到 FINISHED MY INQUIRY 按钮。')).click();
    return {ok:true,data:{finished:true}};
  }

  const field=name=>deepAll(e=>e.tagName==='INPUT'&&e.name===name)[0];
  const textarea=()=>deepAll(e=>e.tagName==='TEXTAREA'&&visible(e))[0];
  const events=()=>deepAll(e=>e.matches('li.slds-chat-listitem_event')).map(text);
  function agent(){
    const list=events(),start=list.findLastIndex(e=>/^Transfer requested/.test(e));
    if(start<0)return null;
    const joined=list.slice(start).map(e=>e.match(/^(.+?) joined\b/)?.[1]).filter(name=>name&&name!=='ONE Customer Service').at(-1);
    return joined||null;
  }
  function verifyForm(){
    for(const [name,value] of [['_firstName',payload.firstName],['_lastName',payload.lastName],['_email',payload.email],['Container_Number',payload.container]]){
      if(field(name)?.value.trim()!==value)throw new Error('ONE 聊天表单内容与配置不符，已停止。');
    }
    const type=deepAll(e=>e.tagName==='BUTTON'&&e.name==='Reference_Type')[0];
    if(text(type||{})!=='Container Number'||!field('agree')?.checked)throw new Error('ONE 聊天表单未正确选择 Container Number 或未勾选同意条款。');
  }

  if(action==='form'){
    // Wait for whatever the chat frame shows first: the entry, the form, or a resumed conversation.
    const conversation=()=>textarea()||deepAll(e=>e.matches('li.slds-chat-listitem')).length;
    await waitFor(()=>conversation()||field('_firstName')||deepAll(e=>e.classList.contains('guide-content-item')).length,'ONE 聊天窗口没有加载出来。');
    if(conversation())throw new Error('ONE 在线客服中已有进行中的对话，请先在该页面结束对话后再试。');
    if(!field('_firstName')){
      const entry=await waitFor(()=>deepAll(e=>e.classList.contains('guide-content-item')&&/ONE Chat/.test(e.textContent))[0],'没有找到「ONE Chat」入口。');
      entry.click();
    }
    await waitFor(()=>field('_firstName'),'ONE 聊天表单没有出现。');
    setValue(field('_firstName'),payload.firstName);setValue(field('_lastName'),payload.lastName);setValue(field('_email'),payload.email);
    const type=deepAll(e=>e.tagName==='BUTTON'&&e.name==='Reference_Type')[0];
    if(!type)throw new Error('没有找到 Reference Type 选项。');
    if(text(type)!=='Container Number'){
      type.click();
      (await waitFor(()=>deepAll(e=>visible(e)&&e.getAttribute('role')==='option'&&e.getAttribute('data-value')==='Container Number')[0],'Reference Type 没有 Container Number 选项。',8000)).click();
    }
    setValue(await waitFor(()=>field('Container_Number'),'没有出现 Reference Number 输入框。',8000),payload.container);
    const agree=field('agree');if(agree&&!agree.checked)agree.click();
    await pause(500);verifyForm();
    const start=deepAll(e=>e.tagName==='BUTTON'&&text(e)==='Start the Chat')[0];
    if(!start||start.disabled)throw new Error('ONE 聊天表单无法提交，请检查必填项。');
    return {ok:true,data:{filled:true}};
  }
  if(action==='start'){
    verifyForm();
    deepAll(e=>e.tagName==='BUTTON'&&text(e)==='Start the Chat')[0].click();
    await choose('Import');
    await choose('Last Free Day / Demurrage & Detention');
    return {ok:true,data:{menu:true}};
  }
  if(action==='transfer'){await choose('Transfer to a Customer Care Agent');return {ok:true,data:{requested:true}};}
  if(action==='agent'){
    const ended=events().some(e=>/ended the chat|chat (has )?ended|conversation ended|timed out/i.test(e));
    return {ok:true,data:{agent:agent(),ended}};
  }
  const messages=Array.isArray(payload?.messages)&&payload.messages.length?payload.messages:[payload?.message];
  // Message bubbles are custom components whose text the page hides from textContent; walk the text nodes.
  const deepText=root=>{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let out='';for(let n=w.nextNode();n;n=w.nextNode())out+=' '+n.nodeValue;return out.replace(/\s+/g,' ').trim();};
  const bubbles=()=>deepAll(e=>e.matches('li.slds-chat-listitem_outbound'));
  const bubble=message=>bubbles().filter(li=>deepText(li).includes(message.replace(/\s+/g,' ').trim())).at(-1);
  if(action==='type'||action==='send'){
    const name=agent();if(!name)throw new Error('ONE 客服还没有接入，消息未发送。');
    const box=textarea();if(!box||box.disabled)throw new Error('ONE 聊天输入框不可用，消息未发送。');
    if(action==='type'){
      // Test mode: every message sits in the box, one per line, for the user to review. Nothing is sent.
      // Appending to an earlier test chat adds the new lines under the ones already waiting there.
      if(box.value.trim()&&!payload.append)throw new Error('ONE 聊天输入框中已有内容，已停止以避免覆盖。');
      const value=[box.value.trim(),...messages].filter(Boolean).join('\n');
      box.focus();setValue(box,value);await pause(400);
      if(box.value!==value)throw new Error('ONE 聊天消息填写失败，消息未发送。');
      return {ok:true,data:{typed:true,agent:name}};
    }
    if(box.value.trim())throw new Error('ONE 聊天输入框中已有未发送的内容，已停止以避免覆盖。请在聊天窗口处理后重试。');
    // One message per container, each sent only after the previous one appears in the conversation.
    let sent=0;
    for(const message of messages){
      if(bubble(message)){sent++;continue;}
      box.focus();setValue(box,message);await pause(400);
      if(box.value!==message)throw Object.assign(new Error('ONE 聊天消息填写失败。'),{sent});
      const send=deepAll(e=>e.tagName==='BUTTON'&&e.classList.contains('embeddedMessagingSendButton')&&visible(e))[0];
      if(!send||send.disabled)throw Object.assign(new Error('没有找到可用的发送按钮。'),{sent});
      send.click();
      await waitFor(()=>bubble(message),'消息没有出现在对话中。',20000).catch(error=>{throw Object.assign(error,{sent:sent+1});});
      sent++;await pause(800);
    }
    return {ok:true,data:{clicked:sent,agent:name}};
  }
  if(action==='replies'){
    // Agent messages that arrived after our last inquiry message (system events are separate list items).
    const items=deepAll(e=>e.matches('li.slds-chat-listitem_inbound,li.slds-chat-listitem_outbound'));
    const last=items.findLastIndex(li=>li.matches('.slds-chat-listitem_outbound')&&messages.some(m=>deepText(li).includes(m)));
    const replies=last<0?[]:items.slice(last+1).filter(li=>li.matches('.slds-chat-listitem_inbound')).map(li=>deepText(li).replace(/\s*\S+ \(ONE\) • .*$/,'')).filter(Boolean);
    return {ok:true,data:{replies,ended:events().some(e=>/ended the chat|chat (has )?ended|conversation ended|timed out/i.test(e))}};
  }
  if(action==='receipt'){
    // Receipt under each outbound bubble: Sent → Delivered → Read.
    const statuses=messages.map(message=>{
      const mine=bubble(message);
      // Walk the bubble itself: component boundaries can hide descendants from contains()/querySelector.
      let receipt=null;
      if(mine){const w=document.createTreeWalker(mine,NodeFilter.SHOW_ELEMENT);for(let n=w.nextNode();n&&!receipt;n=w.nextNode())if(n.classList?.contains('embedded-messaging-chat-message-receipt-text'))receipt=n;}
      return receipt?text(receipt).split('•')[0].trim():'';
    });
    return {ok:true,data:{statuses}};
  }
  throw new Error('未知 ONE 聊天操作。');
  // `sent` tells the extension a message already went out before the error (so the result is "uncertain").
  }catch(error){return {ok:false,error:error.message||String(error),...(error.sent?{sent:error.sent}:{}),...(error.diagnostics?{diagnostics:error.diagnostics}:{})};}
}
