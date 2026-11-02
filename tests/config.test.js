import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,MAX_CONFIG_BYTES,validateSettings,createConfig,parseConfig} from '../config.js';

const custom={
  id:'custom',name:'自定义航司',greeting:'Dear Operations,',
  aliases:['EXAMPLE LINE'],mblPrefixes:['EXLU'],
  to:['lfd@example.com','operations@example.com'],cc:['trucking@example.com'],
  bodyTemplate:'{{greeting}}\n\nPlease confirm the {{type}} LFD.\n{{table}}\nContainer: {{container}} / {{mbl}}',
  subjectTemplate:'{{Type}} LFD - {{carrier}} - {{container}} - {{mbl}}'
};
const settings=()=>validateSettings({
  carriers:[custom],defaultCarrierId:'custom',defaultInquiryType:'detention',
  account:'Operator@Example.com',extraCc:false,testMode:false
});
const json=patch=>JSON.stringify({...createConfig(settings()),...patch});

test('portable configuration round-trips custom carriers, routing and editable templates',()=>{
  const initial=settings();
  const exported=createConfig(initial);
  assert.equal(exported.format,'lfd-inquiry-config');assert.equal(exported.version,2);
  assert.deepEqual(Object.keys(exported),['format','version','settings']);
  const result=parseConfig(JSON.stringify(exported));
  assert.deepEqual(result,initial);
  assert.deepEqual(result.carriers[0].aliases,['EXAMPLE LINE']);
  assert.deepEqual(result.carriers[0].mblPrefixes,['EXLU']);
  assert.equal(result.carriers[0].types[0].bodyTemplate,custom.bodyTemplate.replaceAll('{{greeting}}','{{steam shipping line}}'));
  assert.deepEqual(parseConfig('\uFEFF'+JSON.stringify(exported)),result);
});

test('the retired account and test mode settings are accepted from old data and dropped',()=>{
  for(const key of ['account','testMode','extraCc'])assert.equal(Object.hasOwn(settings(),key),false);
  const old=parseConfig(JSON.stringify({format:'lfd-inquiry-config',version:1,settings:{account:'x@example.com',testMode:true,carriers:[custom],defaultCarrierId:'custom'}}));
  assert.equal(old.carriers[0].id,'custom');assert.equal(Object.hasOwn(old,'testMode'),false);
});

test('legacy saved settings receive new defaults and partial edits preserve prior configuration',()=>{
  const legacy={sheetUrl:DEFAULT_SETTINGS.sheetUrl,account:'legacy@example.com',gmailIndex:2,extraCc:false,testMode:false};
  const migrated=validateSettings(legacy);
  assert.equal(migrated.defaultCarrierId,'auto');assert.equal(migrated.defaultInquiryType,'demurrage');
  assert.ok(migrated.carriers.some(carrier=>carrier.id==='maersk'));
  assert.ok(migrated.carriers.some(carrier=>carrier.id==='msc'));
  const updated=validateSettings({gmailIndex:3},{previous:settings()});
  assert.equal(updated.gmailIndex,3);assert.equal(updated.defaultCarrierId,'custom');
  assert.deepEqual(updated.carriers,settings().carriers);
});

test('automatic carrier choice is valid without any manually selected carrier',()=>{
  assert.equal(validateSettings({carriers:[custom],defaultCarrierId:'auto'}).defaultCarrierId,'auto');
  assert.throws(()=>validateSettings({carriers:[custom],defaultCarrierId:'removed'}),/默认航司/);
});

test('configuration copies do not mutate source settings or shared defaults',()=>{
  const original=structuredClone(custom);
  const result=validateSettings({carriers:[original],defaultCarrierId:'custom'});
  result.carriers[0].types[0].to.push('additional@example.com');
  assert.deepEqual(original,custom);
  const defaults=validateSettings();defaults.carriers[0].name='Changed';
  assert.notEqual(validateSettings().carriers[0].name,'Changed');
});

test('invalid JSON, format, version and missing settings fail with actionable messages',()=>{
  assert.throws(()=>parseConfig('{oops'),/JSON 格式/);
  for(const value of ['null','[]','42'])assert.throws(()=>parseConfig(value),/对象/);
  assert.throws(()=>parseConfig(json({format:'other-app'})),/format/);
  for(const version of [0,3,'1',null])assert.throws(()=>parseConfig(json({version})),/version/);
  assert.throws(()=>parseConfig('{"format":"lfd-inquiry-config","version":1}'),/settings/);
  assert.throws(()=>parseConfig(json({settings:null})),/对象/);
});

test('settings reject untrusted sheet URL, invalid index and invalid mode',()=>{
  for(const sheetUrl of ['http://www.kdocs.cn/l/example','https://evil.example/l/example','https://www.kdocs.cn/l/example?x=y','https://www.kdocs.cn/l/example#x','https://user:pass@www.kdocs.cn/l/example','javascript:alert(1)'])
    assert.throws(()=>validateSettings({sheetUrl}),/分享链接/);
  for(const gmailIndex of [-1,21,1.5,'0'])assert.throws(()=>validateSettings({gmailIndex}),/编号/);
  assert.throws(()=>validateSettings({mode:'harbor'}),/模式/);
  assert.equal(Object.hasOwn(validateSettings({extraCc:true}),'extraCc'),false);
});

test('profile validation and inquiry type validation also run on import',()=>{
  const badProfile={...custom,to:['bad@example.com\nBcc: x@example.com']};
  assert.throws(()=>parseConfig(json({settings:{...settings(),carriers:[badProfile]}})));
  assert.throws(()=>parseConfig(json({settings:{...settings(),defaultCarrierId:'missing'}})),/默认航司/);
  assert.throws(()=>parseConfig(json({settings:{...settings(),defaultInquiryType:'storage'}})));
  assert.throws(()=>parseConfig(json({settings:{...settings(),carriers:[]}})));
});

test('unknown fields and prototype payloads never enter imported settings',()=>{
  for(const field of ['ledger','archive','signature','credentials','token']){
    assert.throws(()=>parseConfig(json({[field]:{secret:'excluded'}})),/不支持的字段/);
    assert.throws(()=>validateSettings({[field]:{secret:'excluded'}}),/不支持的字段/);
  }
  const malicious='{"format":"lfd-inquiry-config","version":1,"settings":{"__proto__":{"polluted":true}}}';
  assert.throws(()=>parseConfig(malicious),/不支持的字段/);
  assert.throws(()=>parseConfig('{"format":"lfd-inquiry-config","version":1,"settings":{},"constructor":{}}'),/不支持的字段/);
  assert.equal({}.polluted,undefined);
});

test('configuration size is measured in UTF-8 bytes, including multibyte content',()=>{
  assert.throws(()=>parseConfig(' '.repeat(MAX_CONFIG_BYTES+1)),/256 KiB/);
  const multibyte='界'.repeat(Math.ceil(MAX_CONFIG_BYTES/3)+1);
  assert.ok(multibyte.length<MAX_CONFIG_BYTES);
  assert.throws(()=>parseConfig(multibyte),/256 KiB/);
  assert.throws(()=>parseConfig(new Uint8Array(1)),/JSON 文本/);
});

test('the supplied configuration ships built in, in the new structure',()=>{
  const defaults=validateSettings();
  assert.deepEqual(defaults.carriers.map(p=>p.name),['Maersk','MSC','EMC','COSCO','ZIM','ONE','CMA','HMM','OOCL','SML','WHL','HPL']);
  assert.equal(defaults.sheetUrl,'https://www.kdocs.cn/l/ce3LmgRtHK2F');assert.deepEqual(defaults.terminals,[]);assert.equal(defaults.mode,'carrier');
  const type=(name,id)=>defaults.carriers.find(p=>p.name===name).types.find(t=>t.id===id);
  assert.deepEqual(type('MSC','demurrage').to,['usa-import.customerservice@msc.com']);
  assert.deepEqual(type('CMA','demurrage').to,['ddsmdisputes@cma-cgm.com']);assert.deepEqual(type('CMA','on-hire').to,['lax-lgb.u.equip@cma-cgm.com']);
  assert.match(type('CMA','on-hire').bodyTemplate,/^Dear CMA Team,/);
  assert.equal(type('COSCO','on-hire').channel,'cosco-portal');assert.equal(type('COSCO','demurrage'),undefined);
  assert.equal(type('ONE','demurrage').channel,'one-chat');assert.equal(type('ONE','on-hire').channel,'email');
});

test('importing a version 1 file converts it and leaves terminals alone; a version 2 file round-trips them',()=>{
  const terminals=[{id:'terminal-a',name:'PCT',greeting:'PCT',aliases:[],mblPrefixes:[],types:[]}];
  const current=validateSettings({terminals});
  const v1=JSON.stringify({format:'lfd-inquiry-config',version:1,settings:{carriers:[custom],defaultCarrierId:'custom'}});
  assert.deepEqual(parseConfig(v1,current).terminals.map(t=>t.name),['PCT']);
  assert.deepEqual(parseConfig(JSON.stringify(createConfig(current))).terminals,current.terminals);
  assert.equal(createConfig(current).version,2);
});

test('a default carrier that pointed at a merged duplicate falls back to automatic recognition',()=>{
  const carriers=[custom,{...custom,id:'custom-2'}];
  const result=validateSettings({carriers,defaultCarrierId:'custom-2'});
  assert.equal(result.carriers.length,1);assert.equal(result.defaultCarrierId,'auto');
});
