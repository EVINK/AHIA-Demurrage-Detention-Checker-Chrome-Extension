import {containerNumber, mblNumber, lookup, cacheRecords, messageTemplate, portalTemplate, chatTemplate, normalizeCarriers, addressList, inquiryType, recognizeCarrier, inquiryChannel, PORTAL_INQUIRY_TYPE, ON_HIRE} from './core.js';
export function createService({storage, readSheet, prepareMail, sendMail, prepareTicket, submitTicket, prepareChat, sendChat, now = Date.now, uuid = () => crypto.randomUUID()}) {
  let queue = Promise.resolve();
  const active=new Set(),jobs=new Map(),cancelled=new Set();
  // Only ledger mutations are serialized; lookups and transmissions run concurrently.
  function serial(action) {const work = queue.then(action); queue = work.catch(() => {}); return work;}
  // Concurrent cache misses share one sheet read.
  let reading=null;
  function readOnce(settings){if(!reading)reading=Promise.resolve().then(()=>readSheet(settings)).finally(()=>{reading=null;});return reading;}
  async function run(value, mode, options={}) {
    if (!['identify','preview','draft','send'].includes(mode)) throw new Error('操作无效。');
    if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('查询选项格式无效。');
    const container = containerNumber(value);
    const {settings = {}} = await storage.get(['settings']);
    const carriers=normalizeCarriers(settings.carriers);
    const selectedId=options.carrierId!==undefined?options.carrierId:settings.defaultCarrierId!==undefined?settings.defaultCarrierId:'auto';
    if(typeof selectedId!=='string'||!selectedId.trim())throw new Error('请先选择并配置船公司。');
    const selected=selectedId.trim().toLowerCase();
    let carrier=selected==='auto'?null:carriers.find(profile=>profile.id===selected);
    if(selected!=='auto'&&!carrier)throw new Error('选中的船公司不存在，请检查配置。');
    const requestedType=inquiryType(options.inquiryType!==undefined?options.inquiryType:settings.defaultInquiryType);
    if(carrier&&mode!=='identify'&&requestedType===ON_HIRE&&carrier.channel==='cosco-portal'){
      if(!carrier.portal.requester)throw new Error('请先配置 COSCO 工单的 Requester 邮箱。');
    }else if(carrier&&mode!=='identify'&&requestedType===ON_HIRE){
      if(!carrier.onHire.to.length)throw new Error(`请先在 ${carrier.name} 的配置中填写 On-Hire 收件邮箱。`);
      if(!carrier.onHire.bodyTemplate||!carrier.onHire.subjectTemplate)throw new Error(`请先在 ${carrier.name} 的配置中填写 On-Hire 正文模板和主题模板。`);
    }else if(carrier&&mode!=='identify'){
      if(carrier.channel==='email'){
        addressList(carrier.to,{allowEmpty:false});
        if(!carrier.bodyTemplate||!carrier.subjectTemplate)throw new Error('首次使用该船公司，请先配置正文模板和主题模板。');
      }else if(carrier.channel==='cosco-portal'&&(!carrier.bodyTemplate||!carrier.portal.requester))throw new Error('首次使用该船公司，请先配置工单 Requester 和正文模板。');
    }
    let type=requestedType;
    const accounts=addressList(settings.account,{allowEmpty:false});
    if(accounts.length!==1)throw new Error('请配置唯一的 Gmail 发件账号。');
    const account=accounts[0];
    // Test mode is enforced in the background, not just by a disabled UI button.
    if(mode==='send' && settings.testMode!==false) mode='draft';
    const cacheKey=JSON.stringify([settings.sheetUrl,account]);
    const {sheetCache}=await storage.get(['sheetCache']);
    let sheet=sheetCache?.version===1&&sheetCache.key===cacheKey&&Array.isArray(sheetCache.records)?sheetCache:null;
    if(sheet){
      const cleaned=cacheRecords(sheet.records);
      if(cleaned.length!==sheet.records.length){sheet={...sheet,records:cleaned};await storage.set({sheetCache:sheet});}
    }
    const cacheHit=options.forceRefresh!==true&&sheet?.records.some(r=>String(r.container).trim().toUpperCase()===container);
    const manual=mode!=='identify'&&options.manualMbl?.trim();
    if(!cacheHit&&!manual&&options.useConfirmed===true)throw new Error('请先查询，或手动填写 MBL 并选择船公司。');
    if(!cacheHit&&!manual){
      // Invalidate first only for an explicit refresh: it must not fall back to old data.
      // A plain cache miss keeps the snapshot, so one failed read does not break every other container.
      if(options.forceRefresh===true)await storage.set({sheetCache:null});
      sheet=await readOnce(settings);
      if(!Array.isArray(sheet.records))throw new Error('提柜表查询结果格式异常。');
      await storage.set({sheetCache:{version:1,key:cacheKey,records:cacheRecords(sheet.records),readAt:sheet.readAt}});
    }
    let matched;
    try{matched=lookup(sheet?.records||[],container);}catch(error){
      if(!manual)throw error;
      if(selected==='auto')throw new Error('未匹配到完整记录，请手动选择船公司并填写 MBL。');
    }
    const record = {...(matched||{container}),...(manual?{mbl:mblNumber(options.manualMbl)}:{}),sourceTime:sheet?.readAt,fromCache:!!cacheHit};
    let carrierSource='manual';
    if(selected==='auto'){
      try{({carrier,carrierSource}=recognizeCarrier(record,carriers));}
      catch(error){
        if(mode==='identify')return {...record,inquiryType:type,unrecognizedCarrier:record.carrier||'',configurationMissing:['carrier'],recognitionError:error.message};
        throw error;
      }
    }
    record.carrierSource=carrierSource;
    // On-Hire is an email for every carrier; COSCO's portal only handles Detention.
    const channel=inquiryChannel(carrier,type),portal=channel==='cosco-portal',chat=channel==='one-chat';
    if(portal&&type!==ON_HIRE)type=PORTAL_INQUIRY_TYPE;
    if(mode==='identify')return {...record,carrierId:carrier.id,carrierName:carrier.name,channel,inquiryType:type,
      configurationMissing:portal&&type===ON_HIRE?(carrier.portal.requester?[]:['requester']):type===ON_HIRE?[...(!carrier.onHire.to.length?['onHireTo']:[]),...(!carrier.onHire.bodyTemplate?['onHireBody']:[]),...(!carrier.onHire.subjectTemplate?['onHireSubject']:[])]:chat?[]:portal?[...(!carrier.portal.requester?['requester']:[]),...(!carrier.bodyTemplate?['bodyTemplate']:[])]:
        [...(!carrier.to.length?['to']:[]),...(!carrier.bodyTemplate?['bodyTemplate']:[]),...(!carrier.subjectTemplate?['subjectTemplate']:[])]};
    const more=Array.isArray(options.more)?options.more:[];
    if(more.length&&(!(chat||type===ON_HIRE)||mode==='identify'))throw new Error('只有 ONE 在线客服和 On-Hire 邮件支持一次查询多个柜号。');
    // Extra containers must be cached ONE records of the same carrier (or explicitly carry a manual MBL).
    const extras=more.map(item=>{
      const extraContainer=containerNumber(item?.container);
      const cached=sheet?.records.find(r=>String(r.container).trim().toUpperCase()===extraContainer);
      // Every container must belong to the first container's carrier (the user removes the others).
      if(cached){let found;try{found=recognizeCarrier(cached,carriers).carrier;}catch{}if(found?.id!==carrier.id)throw new Error(`${extraContainer} 不是 ${carrier.name} 的柜号，请从列表中删除后再发送。`);}
      if(!cached&&!item.mbl)throw new Error(`${extraContainer} 尚未查询，请先查询后再加入。`);
      return {container:extraContainer,mbl:mblNumber(item.mbl||cached.mbl)};
    });
    const message = chat?chatTemplate(record,{carrier,inquiryType:type,more:extras}):portal?portalTemplate(record,{carrier,inquiryType:type,more:extras}):messageTemplate(record,{carrier,inquiryType:type,more:extras,plainTextLayout:settings.mailClient==='system'?'labels':'table'});
    if (mode === 'preview') return {...record, ...message};
    const items=[{container:record.container,mbl:record.mbl},...extras];
    const keys=items.map(item=>JSON.stringify([account, item.container, item.mbl, carrier.id, type]));
    const legacyKey=JSON.stringify([account,record.container,record.mbl]);
    const requestId=uuid();
    const base={account,carrierId:carrier.id,carrierName:carrier.name,channel,inquiryType:type,
      ...(chat?{chatMessage:message.message,email:message.email,...(extras.length?{batch:items.map(item=>item.container)}:{})}:portal?{requester:message.requester,reference:message.reference}:{to:[...message.to],cc:[...message.cc],subject:message.subject}),
      requestId,status:'preparing',time:now(),running:true,step:'排队中'};
    // Check and take the duplicate locks atomically; this is the only serialized step of a send.
    const first=await serial(async()=>{
      const {ledger={}}=await storage.get(['ledger']);
      // Tell the popup which records block the send, so it can offer to look at them or force a resend.
      const blocking=[...keys.map((key,index)=>[key,items[index].container]),...(carrier.id==='maersk'&&type==='demurrage'?[[legacyKey,record.container]]:[])]
        .filter(([key])=>ledger[key]).map(([key,container])=>({key,container,status:ledger[key].status,time:ledger[key].time,requestId:ledger[key].requestId,running:active.has(ledger[key].requestId)}));
      if(blocking.length)throw Object.assign(new Error(`${blocking.map(b=>b.container).join('、')} 在所选船公司和查询类型下已有草稿、发送或待核实记录。请先核对发送记录，避免重复。`),{duplicate:blocking});
      keys.forEach((key,index)=>{ledger[key]={...(index?{container:items[index].container,mbl:items[index].mbl,sourceTime:record.sourceTime}:record),...base,...(chat?{chatMessage:message.messages[index]}:{})};});
      await storage.set({ledger});return ledger[keys[0]];
    });
    if(channel==='email'&&['system','foxmail'].includes(settings.mailClient)){
      // Opened by the popup itself (a user click is needed to launch an external program).
      const mailto=mailtoUrl(message,settings.mailClient);
      return serial(async()=>{
        const {ledger={}}=await storage.get(['ledger']);
        for(const key of keys)if(ledger[key]?.requestId===requestId)ledger[key]={...ledger[key],status:'draft',mailClient:settings.mailClient,mailto,bodyText:message.bodyText,running:false,step:''};
        await storage.set({ledger});return {...ledger[keys[0]],containers:items.map(item=>item.container)};
      });
    }
    // Every channel transmits as a background job so the popup never waits on Gmail, COSCO or ONE.
    const job=transmit({keys,mode,channel,message,record,account,settings,requestId});
    active.add(requestId);jobs.set(requestId,job);
    job.catch(()=>{}).finally(()=>{active.delete(requestId);setTimeout(()=>jobs.delete(requestId),60000);});
    return {...first,background:true,containers:items.map(item=>item.container)};
  }
  // The computer's default mail program: the extension can only open a filled compose window; sending is
  // done (and confirmed with 「我已发送」) by the user.
  function mailtoUrl(message,client){
    const body=client==='foxmail'?message.mailtoHtml:message.bodyText.replace(/\r\n|\r|\n/g,'\r\n');
    const query=[['cc',message.cc.join(';')],['subject',message.subject],['body',body]]
      .filter(([,value])=>value).map(([key,value])=>`${key}=${encodeURIComponent(value)}`).join('&');
    const url=`mailto:${message.to.map(encodeURIComponent).join(';')}?${query}`;
    // Windows hands mailto links to the mail program through a command line of limited length.
    if(url.length>8000)throw new Error('邮件内容过长，无法通过邮件程序打开，请减少柜号或改用 Gmail 网页。');
    return url;
  }
  // Only background jobs call this; the run that created the entries already released the queue.
  async function transmit({keys,mode,channel,message,record,account,settings,requestId}){
    const chat=channel==='one-chat',portal=channel==='cosco-portal';
    const write=(patch,only=keys)=>serial(async()=>{
      const {ledger={}}=await storage.get(['ledger']);
      for(const key of only)if(ledger[key]?.requestId===requestId)ledger[key]={...ledger[key],...(typeof patch==='function'?patch(key):patch),updatedAt:now()};
      await storage.set({ledger});return ledger[keys[0]];
    });
    // Adapters report each step; a cancelled task stops at its next step.
    const progress=step=>{if(cancelled.has(requestId))throw Object.assign(new Error('任务已手动终止'),{cancelled:true});write({step}).catch(()=>{});};
    let transmissionStarted = false;
    try {
      const payload={...message,...record,requestId};
      const prepared = chat?await prepareChat({...payload,send:mode==='send'},progress)
        :portal?await prepareTicket({...payload,submit:mode==='send'},progress)
        :await prepareMail({...payload, account, gmailIndex:settings.gmailIndex});
      let entry=await write({tabId:prepared.tabId,...(prepared.agent?{agent:prepared.agent}:{}),status:'draft',...(mode==='draft'?{running:false,step:''}:{})});
      if (mode === 'draft') return entry;
      await write({status:'sending'});
      transmissionStarted = true;
      const sent = chat?await sendChat(prepared,payload,progress)
        :portal?await submitTicket(prepared,payload,progress)
        :await sendMail(prepared, {...payload,account});
      if (!sent?.confirmed) throw new Error(chat?'没有检测到 ONE 客服已读消息。':portal?'没有检测到 COSCO 工单提交成功。':'没有检测到 Gmail 发送成功确认。');
      return await write({status:'sent',confirmation:sent.evidence,running:false,step:'',...(sent.ticketId?{ticketId:sent.ticketId}:{}),...(sent.agent?{agent:sent.agent}:{})});
    } catch (error) {
      // An adapter marks errors raised before anything was submitted (e.g. captcha never completed).
      if(error?.notTransmitted===true)transmissionStarted=false;
      if(cancelled.has(requestId))error=Object.assign(new Error('任务已手动终止'),{read:error?.read});
      const failed={status:transmissionStarted?'uncertain':'needs_review',detail:error.message,running:false,step:''};
      // A multi-container chat may have some messages read already: those containers count as queried.
      const read=Array.isArray(error?.read)?error.read:[];
      await write(key=>read[keys.indexOf(key)]?{status:'sent',confirmation:'客服已读',running:false,step:''}:failed).catch(()=>{});
      if(portal&&!transmissionStarted)throw new Error(`${error.message} 工单未提交，页面已保留。`);
      if(chat)throw new Error(transmissionStarted?`ONE 客服消息结果待核实（${error.message}），已阻止重试。请打开聊天页查看。`:`${error.message} 消息未发送，聊天页已保留。`);
      throw new Error(transmissionStarted ? `发送结果待核实（${error.message}），已阻止重试。请查看 Gmail 已发送和草稿后，再处理记录。` : `${error.message} 自动发送已停止，请检查 Gmail 草稿。`);
    }
  }
  // 「我已发送」 for a mail-program draft: only the user knows it went out.
  const markSent=requestId=>serial(async()=>{
    const {ledger={}}=await storage.get(['ledger']);
    // Mail-program drafts, and failed/uncertain tasks the user checked and found sent. The lock stays.
    if(active.has(requestId))throw new Error('该任务仍在后台进行。');
    const keys=Object.keys(ledger).filter(key=>ledger[key].requestId===requestId&&((['system','foxmail'].includes(ledger[key].mailClient)&&ledger[key].status==='draft')||['uncertain','needs_review','preparing','sending'].includes(ledger[key].status)));
    if(!keys.length)throw new Error('记录不存在或已确认。');
    for(const key of keys)ledger[key]={...ledger[key],status:'sent',confirmation:['system','foxmail'].includes(ledger[key].mailClient)?'用户确认已在邮件程序中发送':'用户核实已发送',sentAt:now(),running:false,interrupted:false};
    await storage.set({ledger});return keys.length;
  });
  async function cancel(requestId){
    if(!active.has(requestId))throw new Error('任务已经结束。');
    cancelled.add(requestId);
    const {ledger={}}=await storage.get(['ledger']);
    return Object.values(ledger).find(entry=>entry.requestId===requestId)?.tabId;
  }
  // Delete a finished task: release every container lock it took (archived like a manual release).
  const releaseTask=requestId=>serial(async()=>{
    if(active.has(requestId))throw new Error('该任务仍在后台进行，请先终止任务。');
    const {ledger={},archive=[]}=await storage.get(['ledger','archive']);
    const keys=Object.keys(ledger).filter(key=>ledger[key].requestId===requestId);
    if(!keys.length)throw new Error('任务不存在。');
    for(const key of keys){archive.push({...ledger[key],releasedAt:now()});delete ledger[key];}
    await storage.set({ledger,archive});return keys.length;
  });
  return {active:()=>new Set(active),cancel,releaseTask,markSent,job:requestId=>jobs.get(requestId)||Promise.reject(new Error('任务不存在。')),run,release:key=>serial(async()=>{
    const {ledger={},archive=[]}=await storage.get(['ledger','archive']);
    if(!ledger[key])throw new Error('记录不存在。');
    if(active.has(ledger[key].requestId))throw new Error('该任务仍在后台进行，请先终止任务。');
    archive.push({...ledger[key],releasedAt:now()});delete ledger[key];await storage.set({ledger,archive});
  })};
}
