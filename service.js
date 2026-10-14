import {containerNumber, mblNumber, lookup, cacheRecords, messageTemplate, normalizeCarriers, addressList, inquiryType, recognizeCarrier} from './core.js';
export function createService({storage, readSheet, prepareMail, sendMail, now = Date.now, uuid = () => crypto.randomUUID()}) {
  let queue = Promise.resolve();
  function serial(action) {const work = queue.then(action); queue = work.catch(() => {}); return work;}
  async function run(value, mode, options={}) {
    if (!['identify','preview','draft','send'].includes(mode)) throw new Error('操作无效。');
    if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('查询选项格式无效。');
    const container = containerNumber(value);
    const {settings = {}, ledger = {}} = await storage.get(['settings','ledger']);
    const carriers=normalizeCarriers(settings.carriers);
    const selectedId=options.carrierId!==undefined?options.carrierId:settings.defaultCarrierId!==undefined?settings.defaultCarrierId:'auto';
    if(typeof selectedId!=='string'||!selectedId.trim())throw new Error('请先选择并配置船公司。');
    const selected=selectedId.trim().toLowerCase();
    let carrier=selected==='auto'?null:carriers.find(profile=>profile.id===selected);
    if(selected!=='auto'&&!carrier)throw new Error('选中的船公司不存在，请检查配置。');
    if(carrier&&mode!=='identify'){
      addressList(carrier.to,{allowEmpty:false});
      if(!carrier.bodyTemplate||!carrier.subjectTemplate)throw new Error('首次使用该船公司，请先配置正文模板和主题模板。');
    }
    const type=inquiryType(options.inquiryType!==undefined?options.inquiryType:settings.defaultInquiryType);
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
      // Invalidate first: a failed explicit refresh must not fall back to old data.
      await storage.set({sheetCache:null});
      sheet=await readSheet(settings);
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
    if(mode==='identify')return {...record,carrierId:carrier.id,carrierName:carrier.name,inquiryType:type,
      configurationMissing:[...(!carrier.to.length?['to']:[]),...(!carrier.bodyTemplate?['bodyTemplate']:[]),...(!carrier.subjectTemplate?['subjectTemplate']:[])]};
    const message = messageTemplate(record,{carrier,inquiryType:type});
    if (mode === 'preview') return {...record, ...message};
    const key = JSON.stringify([account, record.container, record.mbl, carrier.id, type]);
    const legacyKey=JSON.stringify([account,record.container,record.mbl]);
    if (ledger[key]||(carrier.id==='maersk'&&type==='demurrage'&&ledger[legacyKey])) throw new Error('该柜号在所选船公司和查询类型下已有草稿、发送或待核实记录。请先核对发送记录，避免重复。');
    const entry = {...record, account,carrierId:carrier.id,carrierName:carrier.name,inquiryType:type,to:[...message.to],cc:[...message.cc],subject:message.subject,requestId:uuid(),status:'preparing',time:now()};
    ledger[key] = entry; await storage.set({ledger});
    let transmissionStarted = false;
    try {
      const prepared = await prepareMail({...message, ...record, account, gmailIndex:settings.gmailIndex, requestId:entry.requestId});
      entry.tabId = prepared.tabId;
      entry.status = 'draft'; await storage.set({ledger});
      if (mode === 'draft') return entry;
      entry.status = 'sending'; await storage.set({ledger});
      transmissionStarted = true;
      const sent = await sendMail(prepared, {...message,...record,account,requestId:entry.requestId});
      if (!sent?.confirmed) throw new Error('没有检测到 Gmail 发送成功确认。');
      entry.status = 'sent'; entry.confirmation = sent.evidence;
      await storage.set({ledger}); return entry;
    } catch (error) {
      entry.status = transmissionStarted ? 'uncertain' : 'needs_review'; entry.detail = error.message;
      await storage.set({ledger});
      throw new Error(transmissionStarted ? `发送结果待核实（${error.message}），已阻止重试。请查看 Gmail 已发送和草稿后，再处理记录。` : `${error.message} 自动发送已停止，请检查 Gmail 草稿。`);
    }
  }
  return {run:(value,mode,options)=>serial(()=>run(value,mode,options)),release:key=>serial(async()=>{
    const {ledger={},archive=[]}=await storage.get(['ledger','archive']);
    if(!ledger[key])throw new Error('记录不存在。');
    archive.push({...ledger[key],releasedAt:now()});delete ledger[key];await storage.set({ledger,archive});
  })};
}
