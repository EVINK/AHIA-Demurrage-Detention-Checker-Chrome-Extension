import {DEFAULT_CARRIERS} from './defaults.js';
export const TO='us.customerexperience@maersk.com';
export const CC=['truck@darwinpacific.com','service@darwinpacific.com'];
export const QUESTION='Could you please advise the demurrage LFD for the container below?';
export const DEFAULT_BODY_TEMPLATE='Dear {{steam shipping line}},\n\nCould you please advise the {{type}} LFD for the container below?\n\n{{table}}';
export const DEFAULT_SUBJECT_TEMPLATE='{{Type}} LFD Inquiry - Container#{{container}} MBL#{{mbl}}';
// COSCO USA takes LFD inquiries through its Freshdesk ticket portal; Per Diem is always Detention.
export const COSCO_PORTAL=Object.freeze({requester:'service@darwinpacific.com',shipmentType:'Per Diem',service:'Last Free Day',reference:''});
// COSCO On-Hire goes through COSCO Shipping LA's Freshdesk portal (Type Equipment → On / Off Hire).
export const COSCO_ON_HIRE=Object.freeze({url:'https://coscoshippingla.freshdesk.com/support/tickets/new',type:'Equipment',service:'On / Off Hire',region:'Southern California'});
export const COSCO_ON_HIRE_BODY='Dear {{steam shipping line}},\n\nPlease onhire below containers to LBCT,PCT,ETS,FMS,APM\n\n{{table}}';
const TICKET_HOSTS=['support.cosco-usa.com','coscoshippingla.freshdesk.com'];
export const CHANNELS=['email','cosco-portal','one-chat'];
// These two are one company's own website: nobody else's inquiry may go there.
export const CHANNEL_OWNERS=Object.freeze({'cosco-portal':'cosco','one-chat':'one'});
export const channelsFor=profileId=>CHANNELS.filter(channel=>!CHANNEL_OWNERS[channel]||CHANNEL_OWNERS[channel]===profileId);
// ONE takes LFD inquiries through the live chat on one-line.com (Salesforce messaging, transferred to an agent).
export const ONE_CHAT=Object.freeze({firstName:'LET',lastName:'TANG',email:'service@darwinpacific.com',country:'United States',message:'Please advise {{type}} LFD for {{container}} / {{mbl}}'});
export const PORTAL_INQUIRY_TYPE='detention';
export {DEFAULT_CARRIERS};
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
  if(!allowEmpty&&!result.length)throw new Error('请先配置收件邮箱。');
  return result;
}
// The built-in inquiry types. Every carrier / terminal keeps its own list in profile.types, each entry with its
// own channel, recipients and templates; users can add more entries with the same fields.
export const INQUIRY_TYPES=Object.freeze({demurrage:'Demurrage',detention:'Detention','on-hire':'On-Hire'});
export const ON_HIRE='on-hire';
const TYPE_ERROR='查询类型须为 Demurrage、Detention、On-Hire 或已配置的自定义类型。';
/** A valid type id: a built-in one, or one defined by any of the given profiles. */
export function inquiryType(value='demurrage',profiles=[]){
  if(typeof value!=='string')throw new Error(TYPE_ERROR);
  const result=value.trim().toLowerCase();
  if(!Object.hasOwn(INQUIRY_TYPES,result)&&!profiles.some(profile=>findType(profile,result)))throw new Error(TYPE_ERROR);
  return result;
}
export const findType=(profile,id)=>profile?.types?.find(type=>type.id===id);
/** The channel an inquiry actually uses. */
export const inquiryChannel=(profile,id)=>findType(profile,id)?.channel||'email';
/** The carrier's type for a request; COSCO's portal only knows Detention, so Demurrage there means Detention. */
export function resolveType(profile,requested){
  if(findType(profile,requested))return requested;
  return requested!==ON_HIRE&&inquiryChannel(profile,PORTAL_INQUIRY_TYPE)==='cosco-portal'&&findType(profile,PORTAL_INQUIRY_TYPE)?PORTAL_INQUIRY_TYPE:'';
}
/** Several containers in one message: chats, On-Hire, and custom email types. Demurrage/Detention are one at a time. */
export function supportsManyContainers(profile,id){
  const type=findType(profile,id);if(!type)return false;
  return type.channel==='one-chat'||id===ON_HIRE||(type.channel==='email'&&id!=='demurrage'&&id!=='detention');
}
/** What still has to be filled in before this type can go out. */
export function missingConfiguration(profile,id){
  const type=findType(profile,id);
  if(!type)return ['type'];
  if(type.channel==='one-chat')return [];
  if(type.channel==='cosco-portal')return [...(!profile.portal?.requester?['requester']:[]),...(!type.bodyTemplate?['bodyTemplate']:[])];
  return [...(!type.to.length?['to']:[]),...(!type.bodyTemplate?['bodyTemplate']:[]),...(!type.subjectTemplate?['subjectTemplate']:[])];
}
export const standardBody=id=>id===ON_HIRE?ON_HIRE_BODY_TEMPLATE:DEFAULT_BODY_TEMPLATE;
export const standardSubject=id=>id===ON_HIRE?ON_HIRE_SUBJECT_TEMPLATE:DEFAULT_SUBJECT_TEMPLATE;
/** A new email type: To is left for the user, Cc starts with the company's two addresses. */
export const newInquiryType=(id,label)=>({id,label,channel:'email',to:[],cc:[...CC],subjectTemplate:standardSubject(id),bodyTemplate:standardBody(id)});
/** A new carrier starts with the three built-in types; a new terminal starts empty, the user adds its options. */
export function newProfile(id,name,{terminal=false}={}){
  return {id,name,greeting:name,aliases:terminal?[]:[name],mblPrefixes:[],types:terminal?[]:Object.entries(INQUIRY_TYPES).map(([key,label])=>newInquiryType(key,label))};
}
function profileText(value,label){
  if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\u0000-\u001f\u007f]/.test(value))throw new Error(`${label}须为 1–80 个字符的单行纯文本。`);
  return value.trim();
}
export const carrierLabel=value=>value.normalize('NFKC').trim().toUpperCase().replace(/[\s._-]+/g,'');
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
function templateText(value,kind){
  const body=kind==='body',label=body?'正文模板':'主题模板';
  if(typeof value!=='string')throw new Error(`${label}须为纯文本。`);
  const result=value.replace(/\r\n?/g,'\n').trim().replaceAll('{{greeting}}','{{steam shipping line}}');
  if(!result)return '';
  if(result.length>(body?10000:400)||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(result)||(!body&&/[\n\t]/.test(result)))throw new Error(`${label}过长或含有无效控制字符。`);
  const tokens=[...result.matchAll(/\{\{([^{}]*)\}\}/g)].map(m=>m[1]);
  const allowed=['steam shipping line','carrier','type','Type','container','mbl',...(body?['table']:[])];
  if(tokens.some(token=>!allowed.includes(token))||/\{\{|\}\}/.test(result.replace(/\{\{([^{}]*)\}\}/g,'')))throw new Error(`${label}含有未知或不完整的占位符。`);
  if(body&&tokens.filter(token=>token==='table').length!==1)throw new Error('正文模板必须包含且仅包含一个 {{table}}。');
  if(!body&&(!tokens.includes('container')||!tokens.includes('mbl')))throw new Error('主题模板必须包含 {{container}} 和 {{mbl}}。');
  return result;
}
export const ON_HIRE_BODY_TEMPLATE='Dear {{steam shipping line}},\n\nPlease on-hire below containers to Terminal A, B,C,D,...,etc.\n\n{{table}}';
export const ON_HIRE_SUBJECT_TEMPLATE='On-Hire Request - Container#{{container}} MBL#{{mbl}}';
// Optional. 'AHIA' is the old built-in value, removed from saved settings and imported files as they are read.
function portalReference(value){
  const reference=String(value??'').trim();
  return reference&&reference!=='AHIA'?profileText(reference,'PD INV /BL /BKG /HOU # /SCAC Code'):'';
}
function portalFields(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('COSCO 工单配置格式无效。');
  const requester=addressList(value.requester);
  if(requester.length>1)throw new Error('Requester 只能填写一个邮箱。');
  const onHire={...COSCO_ON_HIRE,...(value.onHire||{})};
  let url;try{url=new URL(onHire.url);}catch{}
  if(!url||url.protocol!=='https:'||!TICKET_HOSTS.includes(url.hostname))throw new Error('COSCO On-Hire 工单网址无效。');
  return {requester:requester[0]||'',shipmentType:profileText(value.shipmentType,'Shipment Type'),
    service:profileText(value.service,'Per Diem Services'),reference:portalReference(value.reference),
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
function typeFields(value,profileId){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string')throw new Error('查询类型配置格式无效。');
  const id=value.id.trim().toLowerCase();
  if(!/^[a-z][a-z0-9_-]{0,63}$/.test(id))throw new Error('查询类型 ID 无效。');
  const channel=value.channel===undefined?'email':value.channel;
  if(!CHANNELS.includes(channel))throw new Error('发送方式无效。');
  const to=addressList(value.to),cc=addressList(value.cc).filter(address=>!to.includes(address));
  // Saved by an earlier version that offered every channel to every carrier: back to email.
  return {id,label:profileText(value.label??INQUIRY_TYPES[id]??'','查询类型名称'),channel:channelsFor(profileId).includes(channel)?channel:'email',to,cc,
    subjectTemplate:templateText(value.subjectTemplate??'','subject'),bodyTemplate:templateText(value.bodyTemplate??'','body')};
}
/** Old format: top-level To/Cc/templates shared by Demurrage and Detention, plus an onHire sub-object. */
function legacyTypes(profile,id){
  const builtin=DEFAULT_CARRIERS.find(item=>item.id===id),template=builtin?.types?.[0];
  const channel=profile.channel??(builtin?.types.find(type=>type.id!==ON_HIRE)?.channel||'email');
  if(!CHANNELS.includes(channel))throw new Error('船公司发送方式无效。');
  const shared={channel,to:profile.to,cc:profile.cc,subjectTemplate:profile.subjectTemplate??template?.subjectTemplate??'',bodyTemplate:profile.bodyTemplate??template?.bodyTemplate??''};
  const hire=profile.onHire??{to:[],cc:[]};
  if(!hire||typeof hire!=='object'||Array.isArray(hire))throw new Error('On-Hire 邮件配置格式无效。');
  const portal=channel==='cosco-portal';
  // COSCO's own wording also replaces the generic text an earlier version may have saved.
  const hireBody=!hire.bodyTemplate||(portal&&hire.bodyTemplate.trim()===ON_HIRE_BODY_TEMPLATE)?(portal?COSCO_ON_HIRE_BODY:ON_HIRE_BODY_TEMPLATE):hire.bodyTemplate;
  return [...(portal?[]:[{id:'demurrage',...shared}]),{id:'detention',...shared},
    {id:ON_HIRE,channel:portal?'cosco-portal':'email',to:hire.to,cc:hire.cc,subjectTemplate:hire.subjectTemplate||ON_HIRE_SUBJECT_TEMPLATE,bodyTemplate:hireBody}];
}
function normalizeProfile(profile,label){
  if(!profile||typeof profile!=='object'||Array.isArray(profile)||typeof profile.id!=='string')throw new Error(`${label}配置格式无效。`);
  if(['__proto__','constructor','prototype'].some(key=>Object.prototype.hasOwnProperty.call(profile,key)))throw new Error(`${label}配置包含不允许的字段。`);
  const id=profile.id.trim().toLowerCase();
  if(id==='auto'||!/^[a-z][a-z0-9_-]{0,63}$/.test(id))throw new Error(`${label} ID 无效（auto 为保留名称）。`);
  const builtin=DEFAULT_CARRIERS.find(item=>item.id===id);
  const types=(Array.isArray(profile.types)?profile.types:legacyTypes(profile,id)).map(type=>typeFields(type,id));
  if(new Set(types.map(type=>type.id)).size!==types.length)throw new Error(`${label}的查询类型重复。`);
  const uses=channel=>types.some(type=>type.channel===channel);
  const portal=uses('cosco-portal')?portalFields(profile.portal??builtin?.portal??COSCO_PORTAL):undefined;
  const chat=uses('one-chat')?chatFields(profile.chat??builtin?.chat??ONE_CHAT):undefined;
  return {id,name:profileText(profile.name,`${label}名称`),greeting:profileText(profile.greeting,'邮件称呼'),
    aliases:profileList(profile.aliases??builtin?.aliases??[],`${label}别名`),
    mblPrefixes:profileList(profile.mblPrefixes??builtin?.mblPrefixes??[],'MBL 前缀',true),
    ...(portal?{portal}:{}),...(chat?{chat}:{}),types};
}
// One entry per carrier. Older versions could save the same carrier twice: keep the better-configured entry
// and carry over the other one's recognition rules, so nothing that identified the carrier is lost.
function mergeDuplicates(profiles){
  const score=profile=>profile.types.filter(type=>missingConfiguration(profile,type.id).length===0).length;
  const result=[];
  for(const profile of profiles){
    const index=result.findIndex(item=>item.id===profile.id||carrierLabel(item.name)===carrierLabel(profile.name));
    if(index<0){result.push(profile);continue;}
    const [keep,other]=score(profile)>score(result[index])?[profile,result[index]]:[result[index],profile];
    result[index]={...keep,aliases:[...new Map([...keep.aliases,...other.aliases].map(alias=>[carrierLabel(alias),alias])).values()].slice(0,50),
      mblPrefixes:[...new Set([...keep.mblPrefixes,...other.mblPrefixes])].slice(0,50)};
  }
  return result;
}
export function normalizeCarriers(input=DEFAULT_CARRIERS){
  if(!Array.isArray(input)||!input.length||input.length>50)throw new Error('船公司配置须包含 1–50 条记录。');
  return mergeDuplicates(input.map(profile=>normalizeProfile(profile,'船公司')));
}
/** Terminals have the same shape as carriers, but none are built in. */
export function normalizeTerminals(input=[]){
  if(!Array.isArray(input)||input.length>50)throw new Error('码头配置最多 50 条记录。');
  return mergeDuplicates(input.map(profile=>normalizeProfile(profile,'码头')));
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
  const profile=normalizeCarriers([rawProfile])[0],requested=inquiryType(options.inquiryType,[profile]),id=resolveType(profile,requested)||requested,type=findType(profile,id);
  if(!type)throw new Error(`${profile.name} 没有配置 ${INQUIRY_TYPES[id]||id} 这个查询类型。`);
  if(type.channel!=='email')throw new Error(`${profile.name} 使用${type.channel==='one-chat'?'在线客服':'工单网站'}，不发邮件。`);
  if(!type.to.length)throw new Error(`请先在 ${profile.name} 的配置中填写 ${type.label} 收件邮箱。`);
  if(!type.bodyTemplate||!type.subjectTemplate)throw new Error(`首次使用该类型，请先配置 ${profile.name} 的 ${type.label} 正文模板和主题模板。`);
  if(options.more?.length&&!supportsManyContainers(profile,id))throw new Error('只有 On-Hire 和自定义类型的邮件支持一次发送多个柜号。');
  const {subject,bodyText,html,mailtoHtml}=renderTemplates(record,profile,type,options.more||[],options.plainTextLayout==='labels'?'labels':'table');
  return {to:[...type.to],cc:[...type.cc],question:`Could you please advise the ${type.label.toLowerCase()} LFD for the container below?`,carrierId:profile.id,carrierName:profile.name,inquiryType:id,typeLabel:type.label,subject,bodyText,html,mailtoHtml};
}
/** Ticket content for a carrier whose channel is a support portal instead of email. */
export function portalTemplate(record,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('工单选项格式无效。');
  const profile=normalizeCarriers([options.carrier])[0],id=resolveType(profile,options.inquiryType||PORTAL_INQUIRY_TYPE),type=findType(profile,id),onHire=id===ON_HIRE;
  if(type?.channel!=='cosco-portal')throw new Error(`${profile.name} 不是工单网站方式。`);
  if(!profile.portal.requester)throw new Error('请先配置 COSCO 工单的 Requester 邮箱。');
  if(options.more?.length&&!onHire)throw new Error('只有 On-Hire 工单支持一次提交多个柜号。');
  const portal=profile.portal;
  if(!type.bodyTemplate)throw new Error('首次使用该船公司，请先配置正文模板。');
  if(onHire){
    // On-Hire: Type Equipment → Services / Region / Number of Containers / Container # / SCAC Code; Description
    // from the carrier's On-Hire template with {{table}} as the Container# / MBL# table (one row per container).
    const {bodyText,html,items}=renderTemplates(record,profile,type,options.more||[]);
    const fields=[{label:'Type',value:portal.onHire.type,kind:'select'},{label:'Services',value:portal.onHire.service,kind:'select'},{label:'Region',value:portal.onHire.region,kind:'select'},
      {label:'Number of Containers',value:String(items.length),kind:'input'},{label:'Container #',value:items.map(item=>item.container).join(' '),kind:'input'},{label:'SCAC Code',value:portal.reference,kind:'input'}].filter(field=>field.value);
    return {channel:'cosco-portal',url:portal.onHire.url,requester:portal.requester,fields,containers:items.map(item=>item.container),carrierId:profile.id,carrierName:profile.name,inquiryType:id,typeLabel:type.label,bodyText,html};
  }
  const {bodyText,html}=renderTemplates(record,profile,type);
  const fields=[{label:'Shipment Type',value:portal.shipmentType,kind:'select'},{label:'Per Diem Services',value:portal.service,kind:'select'},{label:'PD INV /BL /BKG /HOU # /SCAC Code',value:portal.reference,kind:'input'}].filter(field=>field.value);
  return {channel:'cosco-portal',url:'https://support.cosco-usa.com/support/tickets/new',...portal,fields,carrierId:profile.id,carrierName:profile.name,inquiryType:id,typeLabel:type.label,bodyText,html};
}
/** Chat message for a carrier whose channel is the ONE live chat. */
export function chatTemplate(record,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('聊天选项格式无效。');
  const profile=normalizeCarriers([options.carrier])[0],id=inquiryType(options.inquiryType,[profile]),type=findType(profile,id);
  if(type?.channel!=='one-chat')throw new Error(`${profile.name} 不是 ONE 在线客服方式。`);
  // Several containers share one chat, one message per container (each must be read by the agent).
  const items=[record,...(options.more||[])].map(item=>({container:containerNumber(item.container),mbl:mblNumber(item.mbl)}));
  if(new Set(items.map(item=>item.container)).size!==items.length)throw new Error('同一会话中的柜号不能重复。');
  if(items.length>10)throw new Error('一个 ONE 会话最多查询 10 个柜号。');
  const values={type:type.label.toLowerCase(),Type:type.label,carrier:profile.name};
  const messages=items.map(item=>profile.chat.message.replace(/\{\{([^{}]*)\}\}/g,(_,token)=>({...values,...item})[token]));
  const message=messages.join('\n');
  return {channel:'one-chat',...profile.chat,message,messages,containers:items.map(item=>item.container),carrierId:profile.id,carrierName:profile.name,inquiryType:id,typeLabel:type.label};
}
function renderTemplates(record,profile,type,more=[],tableStyle='table'){
  // Several containers in one email (On-Hire): one table row each; {{container}} / {{mbl}} list them all.
  const items=[record,...more].map(item=>({container:containerNumber(item.container),mbl:mblNumber(item.mbl)}));
  if(new Set(items.map(item=>item.container)).size!==items.length)throw new Error('同一封邮件中的柜号不能重复。');
  if(items.length>30)throw new Error('一封邮件最多 30 个柜号。');
  const container=items.map(item=>item.container).join(', '),mbl=[...new Set(items.map(item=>item.mbl))].join(', ');
  const lines=tableStyle==='lines';
  const values={'steam shipping line':profile.greeting,carrier:profile.name,type:type.label.toLowerCase(),Type:type.label,container,mbl,
    table:tableStyle==='labels'?items.map(item=>`Container#: ${item.container}\nMBL#: ${item.mbl}`).join('\n\n'):lines?items.map(item=>`${item.container} ${item.mbl}`).join('\n'):`Container#\tMBL#\n${items.map(item=>`${item.container}\t${item.mbl}`).join('\n')}`};
  const fill=text=>text.replace(/\{\{([^{}]*)\}\}/g,(_,token)=>values[token]);
  const subject=type.subjectTemplate?fill(type.subjectTemplate):'';
  if(subject.length>998)throw new Error('生成的邮件主题过长，请缩短主题模板。');
  const htmlText=text=>fill(text).trim().split(/\n[\t ]*\n+/).filter(Boolean).map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('');
  const table=`<table cellpadding="7" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px"><tr><th style="border:1px solid #888;text-align:left">Container#</th><th style="border:1px solid #888;text-align:left">MBL#</th></tr>${items.map(item=>`<tr><td style="border:1px solid #888">${escapeHtml(item.container)}</td><td style="border:1px solid #888">${escapeHtml(item.mbl)}</td></tr>`).join('')}</table>`;
  const [before,after]=type.bodyTemplate.split('{{table}}');
  const html=htmlText(before)+(lines?`<p>${items.map(item=>escapeHtml(`${item.container} ${item.mbl}`)).join('<br>')}</p>`:table)+htmlText(after);
  if(html.length>20000)throw new Error('生成的邮件正文过长，请缩短正文模板。');
  // Foxmail reads a mailto body as HTML: line breaks must be <br> and only attribute-based table borders
  // survive (verified in Foxmail on 2026-10-20).
  const brText=text=>escapeHtml(fill(text)).replace(/\r\n|\r|\n/g,'<br>');
  const mailtoTable=`<table border=1 cellpadding=6 cellspacing=0 bordercolor=#888888><tr><th align=left>Container#</th><th align=left>MBL#</th></tr>${items.map(item=>`<tr><td>${escapeHtml(item.container)}</td><td>${escapeHtml(item.mbl)}</td></tr>`).join('')}</table>`;
  const mailtoHtml=brText(before)+mailtoTable+brText(after||'');
  return {subject,bodyText:fill(type.bodyTemplate),html,items,mailtoHtml};
}
