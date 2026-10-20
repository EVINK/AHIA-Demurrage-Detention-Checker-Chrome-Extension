import {DEFAULT_CARRIERS,normalizeCarriers,inquiryType} from './core.js';

export const CONFIG_FORMAT='lfd-inquiry-config';
export const CONFIG_VERSION=1;
export const MAX_CONFIG_BYTES=256*1024;
export const DEFAULT_SETTINGS=Object.freeze({
  sheetUrl:'https://www.kdocs.cn/l/ce3LmgRtHK2F',
  account:'amerihua.op001@gmail.com',
  gmailIndex:0,
  testMode:true,
  carriers:DEFAULT_CARRIERS,
  defaultCarrierId:'auto',
  defaultInquiryType:'demurrage',
  // 'gmail': Gmail web compose (automatic); 'foxmail': Foxmail via mailto with an HTML body (line breaks and
  // table kept); 'system': any other default mail program via mailto with a plain-text body.
  mailClient:'gmail'
});
const SETTING_KEYS=Object.keys(DEFAULT_SETTINGS);
const ENVELOPE_KEYS=['format','version','settings'];

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
  object(value,label);allowKeys(value,[...SETTING_KEYS,'extraCc'],label);
  const result={};
  for(const key of SETTING_KEYS)if(Object.hasOwn(value,key))result[key]=value[key];
  return result;
}

function mailClient(value){
  if(!['gmail','foxmail','system'].includes(value))throw new Error('邮件发送方式须为 Gmail 网页、Foxmail 或电脑默认邮件程序。');
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
  if(typeof settings.account!=='string'||settings.account.length>254||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(settings.account.trim()))
    throw new Error('Gmail 账号地址无效。');
  const local=settings.account.trim().split('@')[0];
  if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..'))
    throw new Error('Gmail 账号地址无效。');
  if(!Number.isInteger(settings.gmailIndex)||settings.gmailIndex<0||settings.gmailIndex>20)
    throw new Error('Gmail 账号编号须为 0–20 的整数。');
  for(const key of ['testMode'])if(typeof settings[key]!=='boolean')
    throw new Error(`${key} 必须为 true 或 false。`);
  const carriers=normalizeCarriers(settings.carriers);
  if(typeof settings.defaultCarrierId!=='string'||(settings.defaultCarrierId!=='auto'&&!carriers.some(carrier=>carrier.id===settings.defaultCarrierId)))
    throw new Error('默认航司不存在，请从已配置的航司中选择。');
  return {
    sheetUrl:url.href,
    account:settings.account.trim().toLowerCase(),
    gmailIndex:settings.gmailIndex,
    testMode:settings.testMode,
    carriers,
    defaultCarrierId:settings.defaultCarrierId,
    defaultInquiryType:inquiryType(settings.defaultInquiryType),
    mailClient:mailClient(settings.mailClient)
  };
}

/** Export only configuration; logs, drafts, signature HTML and credentials are excluded. */
export function createConfig(settings){
  return {format:CONFIG_FORMAT,version:CONFIG_VERSION,settings:validateSettings(settings)};
}

/** A portable JSON file always imports in test mode, independent of its prior send mode. */
export function parseConfig(text){
  if(typeof text!=='string')throw new Error('配置文件必须是 JSON 文本。');
  if(text.length>MAX_CONFIG_BYTES||new TextEncoder().encode(text).byteLength>MAX_CONFIG_BYTES)
    throw new Error('配置文件超过 256 KiB，请使用较小的 JSON 配置文件。');
  let parsed;
  try{parsed=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('JSON 格式无效，请检查逗号、引号和括号。');}
  object(parsed,'配置文件');allowKeys(parsed,ENVELOPE_KEYS,'配置文件');
  if(parsed.format!==CONFIG_FORMAT)throw new Error('不是 LFD 插件配置文件：format 必须为 lfd-inquiry-config。');
  if(parsed.version!==CONFIG_VERSION)throw new Error('不支持此配置版本：version 必须为 1。');
  if(!Object.hasOwn(parsed,'settings'))throw new Error('配置文件缺少 settings 对象。');
  const settings=validateSettings(parsed.settings);
  return {...settings,testMode:true};
}
