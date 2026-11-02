import {DEFAULT_CARRIERS,normalizeCarriers,normalizeTerminals,inquiryType} from './core.js';

export const CONFIG_FORMAT='lfd-inquiry-config';
// Version 2: per-type carrier settings and terminals. Version 1 files still import.
export const CONFIG_VERSION=2;
const IMPORTABLE_VERSIONS=[1,2];
export const MAX_CONFIG_BYTES=256*1024;
export const DEFAULT_SETTINGS=Object.freeze({
  sheetUrl:'https://www.kdocs.cn/l/ce3LmgRtHK2F',
  gmailIndex:0,
  // Which list the popup works with: 'carrier' (船公司) or 'terminal' (码头).
  mode:'carrier',
  carriers:DEFAULT_CARRIERS,
  terminals:[],
  defaultCarrierId:'auto',
  defaultInquiryType:'demurrage',
  // 'gmail': Gmail web compose (automatic). The computer's default mail program via mailto: 'foxmail' reads the
  // body as HTML (<br> + bordered table); 'outlook' reads it as plain text. Verified in both on 2026-10-20.
  // The former 'system' option becomes 'foxmail'.
  mailClient:'gmail'
});
const SETTING_KEYS=Object.keys(DEFAULT_SETTINGS);
const ENVELOPE_KEYS=['format','version','settings'];
// Fields of older versions, accepted and dropped so their saved settings and exported files keep working.
const RETIRED_KEYS=['extraCc','account','testMode'];

function object(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new Error(`${label}必须是 JSON 对象。`);
  return value;
}
function allowKeys(value,allowed,label){
  for(const key of Object.keys(value)){
    if(!allowed.includes(key))throw new Error(`${label}包含不支持的字段：${key}。`);
  }
}
function pickSettings(value,label){
  object(value,label);allowKeys(value,[...SETTING_KEYS,...RETIRED_KEYS],label);
  const result={};
  for(const key of SETTING_KEYS)if(Object.hasOwn(value,key))result[key]=value[key];
  return result;
}

function mailClient(value){
  if(value==='system')return 'foxmail';
  if(!['gmail','foxmail','outlook'].includes(value))throw new Error('邮件发送方式须为 Gmail 网页或电脑默认邮件程序（Foxmail / Outlook）。');
  return value;
}
/** Validate a partial update and return only the supported, normalized settings. */
export function validateSettings(input={}, {previous}={}){
  const update=pickSettings(input,'配置');
  const old=previous===undefined?{}:pickSettings(previous,'已有配置');
  const settings={...DEFAULT_SETTINGS,...old,...update};
  let url;
  try{
    if(typeof settings.sheetUrl!=='string')throw new Error();
    url=new URL(settings.sheetUrl);
    if(url.origin!=='https://www.kdocs.cn'||!/^\/l\/[A-Za-z0-9]+$/.test(url.pathname)||
      url.search||url.hash||url.username||url.password)throw new Error();
  }catch{throw new Error('请填写金山文档分享链接：https://www.kdocs.cn/l/…');}
  if(!Number.isInteger(settings.gmailIndex)||settings.gmailIndex<0||settings.gmailIndex>20)
    throw new Error('Gmail 账号编号须为 0–20 的整数。');
  if(!['carrier','terminal'].includes(settings.mode))throw new Error('模式须为航司模式或码头模式。');
  const carriers=normalizeCarriers(settings.carriers),terminals=normalizeTerminals(settings.terminals);
  // A default that pointed at a merged duplicate falls back to automatic recognition.
  const merged=Array.isArray(settings.carriers)&&settings.carriers.some(carrier=>carrier?.id===settings.defaultCarrierId);
  const defaultCarrierId=merged&&!carriers.some(carrier=>carrier.id===settings.defaultCarrierId)?'auto':settings.defaultCarrierId;
  if(typeof defaultCarrierId!=='string'||(defaultCarrierId!=='auto'&&!carriers.some(carrier=>carrier.id===defaultCarrierId)))
    throw new Error('默认航司不存在，请从已配置的航司中选择。');
  return {
    sheetUrl:url.href,
    gmailIndex:settings.gmailIndex,
    mode:settings.mode,
    carriers,
    terminals,
    defaultCarrierId,
    defaultInquiryType:inquiryType(settings.defaultInquiryType,[...carriers,...terminals]),
    mailClient:mailClient(settings.mailClient)
  };
}

/** Export only configuration; logs, drafts, signature HTML and credentials are excluded. */
export function createConfig(settings){
  return {format:CONFIG_FORMAT,version:CONFIG_VERSION,settings:validateSettings(settings)};
}

/** Terminals and the mode the file does not mention (every version 1 file) stay as they are. */
export function parseConfig(text,current){
  if(typeof text!=='string')throw new Error('配置文件必须是 JSON 文本。');
  if(text.length>MAX_CONFIG_BYTES||new TextEncoder().encode(text).byteLength>MAX_CONFIG_BYTES)
    throw new Error('配置文件超过 256 KiB，请使用较小的 JSON 配置文件。');
  let parsed;
  try{parsed=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('JSON 格式无效，请检查逗号、引号和括号。');}
  object(parsed,'配置文件');allowKeys(parsed,ENVELOPE_KEYS,'配置文件');
  if(parsed.format!==CONFIG_FORMAT)throw new Error('不是 LFD 插件配置文件：format 必须为 lfd-inquiry-config。');
  if(!IMPORTABLE_VERSIONS.includes(parsed.version))throw new Error('不支持此配置版本：version 必须为 1 或 2。');
  if(!Object.hasOwn(parsed,'settings'))throw new Error('配置文件缺少 settings 对象。');
  return validateSettings(parsed.settings,current?{previous:{terminals:current.terminals,mode:current.mode}}:undefined);
}
