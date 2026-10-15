export const TO='us.customerexperience@maersk.com';
export const CC=['truck@darwinpacific.com','service@darwinpacific.com'];
export const QUESTION='Could you please advise the demurrage LFD for the container below?';
export const DEFAULT_BODY_TEMPLATE='Dear {{steam shipping line}},\n\nCould you please advise the {{type}} LFD for the container below?\n\n{{table}}';
export const DEFAULT_SUBJECT_TEMPLATE='{{Type}} LFD Inquiry - Container#{{container}} MBL#{{mbl}}';
// COSCO USA takes LFD inquiries through its Freshdesk ticket portal; Per Diem is always Detention.
export const COSCO_PORTAL=Object.freeze({requester:'service@darwinpacific.com',shipmentType:'Per Diem',service:'Last Free Day',reference:'AHIA'});
// COSCO On-Hire goes through COSCO Shipping LA's Freshdesk portal (Type Equipment → On / Off Hire).
export const COSCO_ON_HIRE=Object.freeze({url:'https://coscoshippingla.freshdesk.com/support/tickets/new',type:'Equipment',service:'On / Off Hire',region:'Southern California'});
export const COSCO_ON_HIRE_BODY='Dear {{steam shipping line}},\n\nPlease onhire below containers to LBCT,PCT,ETS,FMS,APM\n\n{{table}}';
const TICKET_HOSTS=['support.cosco-usa.com','coscoshippingla.freshdesk.com'];
export const CHANNELS=['email','cosco-portal','one-chat'];
// ONE takes LFD inquiries through the live chat on one-line.com (Salesforce messaging, transferred to an agent).
export const ONE_CHAT=Object.freeze({firstName:'LET',lastName:'TANG',email:'service@darwinpacific.com',country:'United States',message:'Please advise {{type}} LFD for {{container}} / {{mbl}}'});
export const PORTAL_INQUIRY_TYPE='detention';
export const DEFAULT_CARRIERS=[
  {id:'maersk',name:'Maersk',greeting:'MSK',to:[TO],cc:[...CC],aliases:['MAERSK','MSK','马士基'],mblPrefixes:['MAEU'],bodyTemplate:DEFAULT_BODY_TEMPLATE,subjectTemplate:DEFAULT_SUBJECT_TEMPLATE},
  {id:'msc',name:'MSC',greeting:'MSC',to:[],cc:[...CC],aliases:['MSC','地中海'],mblPrefixes:['MEDU'],bodyTemplate:DEFAULT_BODY_TEMPLATE,subjectTemplate:DEFAULT_SUBJECT_TEMPLATE},
  {id:'one',name:'ONE',greeting:'ONE',channel:'one-chat',chat:{...ONE_CHAT},to:[],cc:[],aliases:['ONE','OCEAN NETWORK EXPRESS'],mblPrefixes:['ONEY'],bodyTemplate:'',subjectTemplate:''},
  {id:'cosco',name:'COSCO',greeting:'Cosco',channel:'cosco-portal',portal:{...COSCO_PORTAL},to:[],cc:[],aliases:['COSCO','COS','中远'],mblPrefixes:['COSU'],bodyTemplate:DEFAULT_BODY_TEMPLATE,subjectTemplate:'',onHire:{to:[],cc:[],subjectTemplate:'',bodyTemplate:COSCO_ON_HIRE_BODY}}
];
export function addressList(value,{allowEmpty=true}={}){
  const values=value==null?[]:Array.isArray(value)?value:[value];
  if(values.some(v=>typeof v!=='string'))throw new Error('邮箱地址须为文本或文本列表。');
  const addresses=values.flatMap(v=>v.trim().split(/[\s,;，；]+/)).filter(Boolean).map(v=>v.toLowerCase());
  const email=/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
  for(const address of addresses){
    const local=address.split('@')[0];
    if(address.length>254||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!email.test(address))throw new Error(`邮箱地址格式无效：${address}`);
  }
  const result=[...new Set(addresses)];
  if(!allowEmpty&&!result.length)throw new Error('请先配置该船公司的收件邮箱。');
  return result;
}
// On-Hire is always an email, with its own recipients and templates per carrier (carrier.onHire).
export const INQUIRY_TYPES=Object.freeze({demurrage:'Demurrage',detention:'Detention','on-hire':'On-Hire'});
export const ON_HIRE='on-hire';
export function inquiryType(value='demurrage'){
  if(typeof value!=='string')throw new Error('查询类型须为 Demurrage、Detention 或 On-Hire。');
  const result=value.trim().toLowerCase();
  if(!Object.hasOwn(INQUIRY_TYPES,result))throw new Error('查询类型须为 Demurrage、Detention 或 On-Hire。');
  return result;
}
/** The channel an inquiry actually uses: On-Hire is an email, except COSCO whose On-Hire is a ticket too. */
export const inquiryChannel=(carrier,type)=>type!==ON_HIRE||carrier.channel==='cosco-portal'?carrier.channel:'email';
function profileText(value,label){
  if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\u0000-\u001f\u007f]/.test(value))throw new Error(`${label}须为 1–80 个字符的单行纯文本。`);
  return value.trim();
}
const carrierLabel=value=>value.normalize('NFKC').trim().toUpperCase().replace(/[\s._-]+/g,'');
function profileList(value,label,prefixes=false){
  if(!Array.isArray(value)||value.length>50)throw new Error(`${label}须为最多 50 项的文本列表。`);
  const result=value.map(item=>profileText(item,label));
  if(prefixes){
    if(result.some(item=>!/^[A-Za-z0-9]{2,20}$/.test(item)))throw new Error('MBL 前缀须为 2–20 个英文字母或数字。');
    return [...new Set(result.map(item=>item.toUpperCase()))];
  }
  const seen=new Set();
  return result.filter(item=>{const key=carrierLabel(item);if(!key)throw new Error(`${label}不能仅含空格或分隔符。`);if(seen.has(key))return false;seen.add(key);return true;});
}
function templateText(value,kind,{requireType=true}={}){
  const body=kind==='body',label=body?'正文模板':'主题模板';
  if(typeof value!=='string')throw new Error(`${label}须为纯文本。`);
  const result=value.replace(/\r\n?/g,'\n').trim().replaceAll('{{greeting}}','{{steam shipping line}}');
  if(!result)return '';
  if(result.length>(body?10000:400)||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(result)||(!body&&/[\n\t]/.test(result)))throw new Error(`${label}过长或含有无效控制字符。`);
  const tokens=[...result.matchAll(/\{\{([^{}]*)\}\}/g)].map(m=>m[1]);
  const allowed=['steam shipping line','carrier','type','Type','container','mbl',...(body?['table']:[])];
  if(tokens.some(token=>!allowed.includes(token))||/\{\{|\}\}/.test(result.replace(/\{\{([^{}]*)\}\}/g,'')))throw new Error(`${label}含有未知或不完整的占位符。`);
  if(requireType&&!tokens.some(token=>token==='type'||token==='Type'))throw new Error(`${label}必须包含 {{type}} 或 {{Type}}，使查询类型随选择更新。`);
  if(body&&tokens.filter(token=>token==='table').length!==1)throw new Error('正文模板必须包含且仅包含一个 {{table}}。');
  if(!body&&(!tokens.includes('container')||!tokens.includes('mbl')))throw new Error('主题模板必须包含 {{container}} 和 {{mbl}}。');
  return result;
}
export const ON_HIRE_BODY_TEMPLATE='Dear {{steam shipping line}},\n\nPlease on-hire below containers to Terminal A, B,C,D,...,etc.\n\n{{table}}';
export const ON_HIRE_SUBJECT_TEMPLATE='On-Hire Request - Container#{{container}} MBL#{{mbl}}';
function onHireFields(value,defaults={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('On-Hire 邮件配置格式无效。');
  const to=addressList(value.to),cc=addressList(value.cc).filter(address=>!to.includes(address));
  // Empty templates fall back to the standard On-Hire text.
  // A carrier with its own default (COSCO) also replaces the generic text an earlier version may have saved.
  const body=!value.bodyTemplate||(defaults.bodyTemplate&&value.bodyTemplate.trim()===ON_HIRE_BODY_TEMPLATE)?defaults.bodyTemplate||ON_HIRE_BODY_TEMPLATE:value.bodyTemplate;
  return {to,cc,subjectTemplate:templateText(value.subjectTemplate||defaults.subjectTemplate||ON_HIRE_SUBJECT_TEMPLATE,'subject',{requireType:false}),bodyTemplate:templateText(body,'body',{requireType:false})};
}
function portalFields(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('COSCO 工单配置格式无效。');
  const requester=addressList(value.requester);
  if(requester.length>1)throw new Error('Requester 只能填写一个邮箱。');
  const onHire={...COSCO_ON_HIRE,...(value.onHire||{})};
  let url;try{url=new URL(onHire.url);}catch{}
  if(!url||url.protocol!=='https:'||!TICKET_HOSTS.includes(url.hostname))throw new Error('COSCO On-Hire 工单网址无效。');
  return {requester:requester[0]||'',shipmentType:profileText(value.shipmentType,'Shipment Type'),
    service:profileText(value.service,'Per Diem Services'),reference:profileText(value.reference,'PD INV /BL /BKG /HOU # /SCAC Code'),
    onHire:{url:url.href,type:profileText(onHire.type,'On-Hire Type'),service:profileText(onHire.service,'On-Hire Services'),region:profileText(onHire.region,'On-Hire Region')}};
}
function chatFields(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('ONE 在线客服配置格式无效。');
  const email=addressList(value.email);
  if(email.length!==1)throw new Error('ONE 在线客服 Email 须为一个有效邮箱。');
  const message=String(value.message??'').trim();
  if(!message||message.length>500||/[\u0000-\u001f\u007f]/.test(message))throw new Error('ONE 聊天消息模板须为 1–500 个字符的单行文本。');
  const tokens=[...message.matchAll(/\{\{([^{}]*)\}\}/g)].map(m=>m[1]);
  if(tokens.some(t=>!['type','Type','container','mbl','carrier'].includes(t))||/\{\{|\}\}/.test(message.replace(/\{\{([^{}]*)\}\}/g,'')))throw new Error('ONE 聊天消息模板含有未知或不完整的占位符。');
  if(!tokens.includes('container')||!tokens.includes('mbl')||!tokens.some(t=>t==='type'||t==='Type'))throw new Error('ONE 聊天消息模板必须包含 {{type}}、{{container}} 和 {{mbl}}。');
  return {firstName:profileText(value.firstName,'First Name'),lastName:profileText(value.lastName,'Last Name'),email:email[0],
    country:profileText(value.country??ONE_CHAT.country,'Country'),message};
}
export function normalizeCarriers(input=DEFAULT_CARRIERS){
  if(!Array.isArray(input)||!input.length||input.length>50)throw new Error('船公司配置须包含 1–50 条记录。');
  const ids=new Set();
  return input.map(profile=>{
    if(!profile||typeof profile!=='object'||Array.isArray(profile)||typeof profile.id!=='string')throw new Error('船公司配置格式无效。');
    if(['__proto__','constructor','prototype'].some(key=>Object.prototype.hasOwnProperty.call(profile,key)))throw new Error('船公司配置包含不允许的字段。');
    const id=profile.id.trim().toLowerCase();
    if(id==='auto'||!/^[a-z][a-z0-9_-]{0,63}$/.test(id)||ids.has(id))throw new Error('船公司 ID 无效或重复（auto 为保留名称）。');
    ids.add(id);
    const to=addressList(profile.to),cc=addressList(profile.cc).filter(address=>!to.includes(address));
    const builtin=DEFAULT_CARRIERS.find(item=>item.id===id);
    const channel=profile.channel===undefined?builtin?.channel||'email':profile.channel;
    if(!CHANNELS.includes(channel))throw new Error('船公司发送方式无效。');
    return {id,channel,...(channel==='cosco-portal'?{portal:portalFields(profile.portal===undefined?builtin?.portal||COSCO_PORTAL:profile.portal)}:{}),
      ...(channel==='one-chat'?{chat:chatFields(profile.chat===undefined?builtin?.chat||ONE_CHAT:profile.chat)}:{}),name:profileText(profile.name,'船公司名称'),greeting:profileText(profile.greeting,'邮件称呼'),to,cc,
      aliases:profileList(profile.aliases===undefined?builtin?.aliases||[]:profile.aliases,'船公司别名'),
      mblPrefixes:profileList(profile.mblPrefixes===undefined?builtin?.mblPrefixes||[]:profile.mblPrefixes,'MBL 前缀',true),
      bodyTemplate:templateText(profile.bodyTemplate===undefined?(builtin?builtin.bodyTemplate:''):profile.bodyTemplate,'body'),
      subjectTemplate:templateText(profile.subjectTemplate===undefined?(builtin?builtin.subjectTemplate:''):profile.subjectTemplate,'subject'),
      onHire:onHireFields(profile.onHire===undefined?{to:[],cc:[]}:profile.onHire,builtin?.onHire)};
  });
}
export function containerNumber(value){
  const result=String(value??'').trim().toUpperCase();
  if(!/^[A-Z]{4}\d{7}$/.test(result))throw new Error('柜号须为 4 个英文字母 + 7 位数字。');
  return result;
}
export function mblNumber(value){
  const result=String(value??'').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9 /._-]{2,59}$/.test(result))throw new Error('MBL 缺失或格式异常，请检查提柜表。');
  return result;
}
export function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function deduplicateRecords(records){
  if(!Array.isArray(records))throw new Error('提柜表查询结果格式异常。');
  const groups=new Map();
  for(const record of records){
    const key=String(record.container).trim().toUpperCase();
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(record);
  }
  return [...groups.values()].flatMap(group=>{
    if(group.length===1)return group;
    const complete=group.filter(r=>typeof r.mbl==='string'&&r.mbl.trim()&&typeof r.carrier==='string'&&r.carrier.trim());
    complete.sort((a,b)=>(Number.isInteger(a.row)?a.row:Infinity)-(Number.isInteger(b.row)?b.row:Infinity));
    // Keep unresolved duplicates so lookup can require manual input.
    return complete.length?[complete[0]]:group;
  });
}
export function cacheRecords(records){
  return deduplicateRecords(records).filter(r=>
    /^[A-Z]{4}\d{7}$/.test(String(r.container).trim().toUpperCase())&&
    typeof r.mbl==='string'&&r.mbl.trim()&&typeof r.carrier==='string'&&r.carrier.trim());
}
export function lookup(records,value){
  const container=containerNumber(value);
  if(!Array.isArray(records))throw new Error('提柜表查询结果格式异常。');
  const matches=deduplicateRecords(records).filter(r=>String(r.container).trim().toUpperCase()===container);
  if(!matches.length)throw new Error('提柜表中未找到该柜号。');
  if(matches.length!==1)throw new Error('同一柜号匹配到多行，但没有 MBL 和 SSL 均完整的行，请手动填写 MBL 并选择船公司。');
  if(matches[0].carrier!=null&&typeof matches[0].carrier!=='string')throw new Error('提柜表中的船公司数据格式异常。');
  return {container,mbl:mblNumber(matches[0].mbl),row:matches[0].row,...(typeof matches[0].carrier==='string'?{carrier:matches[0].carrier}:{})};
}
export function recognizeCarrier(record,profiles=DEFAULT_CARRIERS){
  const carriers=normalizeCarriers(profiles),mbl=mblNumber(record.mbl);
  if(record.carrier!=null&&typeof record.carrier!=='string')throw new Error('提柜表中的船公司数据格式异常。');
  const sheetName=(record.carrier||'').trim();
  const prefixMatches=carriers.filter(profile=>profile.mblPrefixes.some(prefix=>mbl.startsWith(prefix)));
  if(sheetName){
    const name=carrierLabel(sheetName);
    const matches=carriers.filter(profile=>[profile.id,profile.name,...profile.aliases].some(alias=>carrierLabel(alias)===name));
    if(matches.length!==1)throw new Error(matches.length?'提柜表船公司匹配到多个配置，请选择船公司或修改别名。':`未识别提柜表船公司“${sheetName}”，请选择船公司或配置对应别名。`);
    if(prefixMatches.length>1)throw new Error('MBL 前缀匹配到多个船公司，请选择船公司或修改前缀配置。');
    if(prefixMatches.length===1&&prefixMatches[0].id!==matches[0].id)throw new Error('提柜表船公司与 MBL 前缀配置冲突，请核对后手动选择船公司。');
    return {carrier:matches[0],carrierSource:'sheet'};
  }
  if(prefixMatches.length!==1)throw new Error(prefixMatches.length?'MBL 前缀匹配到多个船公司，请选择船公司或修改前缀配置。':'无法自动识别船公司，请选择船公司或配置 MBL 前缀。');
  return {carrier:prefixMatches[0],carrierSource:'mbl-prefix'};
}
export function messageTemplate(record,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('邮件选项格式无效。');
  const rawProfile=options.carrier!==undefined?options.carrier:options.profile!==undefined?options.profile:DEFAULT_CARRIERS[0];
  const base=normalizeCarriers([rawProfile])[0],type=inquiryType(options.inquiryType);
  if(type===ON_HIRE){
    if(!base.onHire.to.length)throw new Error(`请先在 ${base.name} 的配置中填写 On-Hire 收件邮箱。`);
    if(!base.onHire.bodyTemplate||!base.onHire.subjectTemplate)throw new Error(`请先在 ${base.name} 的配置中填写 On-Hire 正文模板和主题模板。`);
  }else if(base.channel!=='email')throw new Error(`${base.name} 使用${base.channel==='one-chat'?'在线客服':'工单网站'}，不发邮件。`);
  const profile=type===ON_HIRE?{...base,...base.onHire}:base;
  if(!profile.bodyTemplate||!profile.subjectTemplate)throw new Error('首次使用该船公司，请先配置正文模板和主题模板。');
  const to=addressList(profile.to,{allowEmpty:false});
  if(options.more?.length&&type!==ON_HIRE)throw new Error('只有 On-Hire 邮件支持一次发送多个柜号。');
  const {subject,bodyText,html}=renderTemplates(record,profile,type,options.more||[]);
  return {to,cc:[...profile.cc],question:`Could you please advise the ${type} LFD for the container below?`,carrierId:profile.id,carrierName:profile.name,inquiryType:type,subject,bodyText,html};
}
/** Ticket content for a carrier whose channel is a support portal instead of email. */
export function portalTemplate(record,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('工单选项格式无效。');
  const profile=normalizeCarriers([options.carrier])[0],onHire=options.inquiryType===ON_HIRE,type=onHire?ON_HIRE:PORTAL_INQUIRY_TYPE;
  if(profile.channel!=='cosco-portal')throw new Error(`${profile.name} 不是工单网站方式。`);
  if(!profile.portal.requester)throw new Error('请先配置 COSCO 工单的 Requester 邮箱。');
  if(options.more?.length&&!onHire)throw new Error('只有 On-Hire 工单支持一次提交多个柜号。');
  const portal=profile.portal;
  if(onHire){
    // On-Hire: Type Equipment → Services / Region / Number of Containers / Container # / SCAC Code; Description
    // from the carrier's On-Hire template with {{table}} as one "container MBL" line per container.
    const {bodyText,html,items}=renderTemplates(record,{...profile,...profile.onHire},type,options.more||[],'lines');
    const fields=[{label:'Type',value:portal.onHire.type,kind:'select'},{label:'Services',value:portal.onHire.service,kind:'select'},{label:'Region',value:portal.onHire.region,kind:'select'},
      {label:'Number of Containers',value:String(items.length),kind:'input'},{label:'Container #',value:items.map(item=>item.container).join(' '),kind:'input'},{label:'SCAC Code',value:portal.reference,kind:'input'}];
    return {channel:profile.channel,url:portal.onHire.url,requester:portal.requester,fields,containers:items.map(item=>item.container),carrierId:profile.id,carrierName:profile.name,inquiryType:type,bodyText,html};
  }
  if(!profile.bodyTemplate)throw new Error('首次使用该船公司，请先配置正文模板。');
  const {bodyText,html}=renderTemplates(record,profile,type);
  const fields=[{label:'Shipment Type',value:portal.shipmentType,kind:'select'},{label:'Per Diem Services',value:portal.service,kind:'select'},{label:'PD INV /BL /BKG /HOU # /SCAC Code',value:portal.reference,kind:'input'}];
  return {channel:profile.channel,url:'https://support.cosco-usa.com/support/tickets/new',...portal,fields,carrierId:profile.id,carrierName:profile.name,inquiryType:type,bodyText,html};
}
/** Chat message for a carrier whose channel is the ONE live chat; both inquiry types are supported. */
export function chatTemplate(record,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('聊天选项格式无效。');
  const profile=normalizeCarriers([options.carrier])[0],type=inquiryType(options.inquiryType);
  if(profile.channel!=='one-chat')throw new Error(`${profile.name} 不是 ONE 在线客服方式。`);
  // Several containers share one chat, one message per container (each must be read by the agent).
  const items=[record,...(options.more||[])].map(item=>({container:containerNumber(item.container),mbl:mblNumber(item.mbl)}));
  if(new Set(items.map(item=>item.container)).size!==items.length)throw new Error('同一会话中的柜号不能重复。');
  if(items.length>10)throw new Error('一个 ONE 会话最多查询 10 个柜号。');
  const values={type,Type:INQUIRY_TYPES[type],carrier:profile.name};
  const messages=items.map(item=>profile.chat.message.replace(/\{\{([^{}]*)\}\}/g,(_,token)=>({...values,...item})[token]));
  const message=messages.join('\n');
  return {channel:profile.channel,...profile.chat,message,messages,containers:items.map(item=>item.container),carrierId:profile.id,carrierName:profile.name,inquiryType:type};
}
function renderTemplates(record,profile,type,more=[],tableStyle='table'){
  // Several containers in one email (On-Hire): one table row each; {{container}} / {{mbl}} list them all.
  const items=[record,...more].map(item=>({container:containerNumber(item.container),mbl:mblNumber(item.mbl)}));
  if(new Set(items.map(item=>item.container)).size!==items.length)throw new Error('同一封邮件中的柜号不能重复。');
  if(items.length>30)throw new Error('一封邮件最多 30 个柜号。');
  const container=items.map(item=>item.container).join(', '),mbl=[...new Set(items.map(item=>item.mbl))].join(', ');
  const lines=tableStyle==='lines';
  const values={'steam shipping line':profile.greeting,carrier:profile.name,type,Type:INQUIRY_TYPES[type],container,mbl,
    table:lines?items.map(item=>`${item.container} ${item.mbl}`).join('\n'):`Container#\tMBL#\n${items.map(item=>`${item.container}\t${item.mbl}`).join('\n')}`};
  const fill=text=>text.replace(/\{\{([^{}]*)\}\}/g,(_,token)=>values[token]);
  const subject=profile.subjectTemplate?fill(profile.subjectTemplate):'';
  if(subject.length>998)throw new Error('生成的邮件主题过长，请缩短主题模板。');
  const htmlText=text=>fill(text).trim().split(/\n[\t ]*\n+/).filter(Boolean).map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('');
  const table=`<table cellpadding="7" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px"><tr><th style="border:1px solid #888;text-align:left">Container#</th><th style="border:1px solid #888;text-align:left">MBL#</th></tr>${items.map(item=>`<tr><td style="border:1px solid #888">${escapeHtml(item.container)}</td><td style="border:1px solid #888">${escapeHtml(item.mbl)}</td></tr>`).join('')}</table>`;
  const [before,after]=profile.bodyTemplate.split('{{table}}');
  const html=htmlText(before)+(lines?`<p>${items.map(item=>escapeHtml(`${item.container} ${item.mbl}`)).join('<br>')}</p>`:table)+htmlText(after);
  if(html.length>20000)throw new Error('生成的邮件正文过长，请缩短正文模板。');
  return {subject,bodyText:fill(profile.bodyTemplate),html,items};
}
