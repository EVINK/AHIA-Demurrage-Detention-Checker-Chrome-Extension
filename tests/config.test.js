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
  assert.equal(exported.format,'lfd-inquiry-config');assert.equal(exported.version,1);
  assert.deepEqual(Object.keys(exported),['format','version','settings']);
  const result=parseConfig(JSON.stringify(exported));
  assert.deepEqual(result,{...initial,testMode:true});
  assert.deepEqual(result.carriers[0].aliases,['EXAMPLE LINE']);
  assert.deepEqual(result.carriers[0].mblPrefixes,['EXLU']);
  assert.equal(result.carriers[0].bodyTemplate,custom.bodyTemplate.replaceAll('{{greeting}}','{{steam shipping line}}'));
  assert.equal(result.account,'operator@example.com');
  assert.deepEqual(parseConfig('\uFEFF'+JSON.stringify(exported)),result);
});

test('import always re-enables test mode even when exported from live send mode',()=>{
  assert.equal(createConfig(settings()).settings.testMode,false);
  assert.equal(parseConfig(json()).testMode,true);
});

test('legacy saved settings receive new defaults and partial edits preserve prior configuration',()=>{
  const legacy={sheetUrl:DEFAULT_SETTINGS.sheetUrl,account:'legacy@example.com',gmailIndex:2,extraCc:false,testMode:false};
  const migrated=validateSettings(legacy);
  assert.equal(migrated.account,'legacy@example.com');assert.equal(migrated.testMode,false);
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
  result.carriers[0].to.push('additional@example.com');
  assert.deepEqual(original,custom);
  const defaults=validateSettings();defaults.carriers[0].name='Changed';
  assert.notEqual(validateSettings().carriers[0].name,'Changed');
});

test('invalid JSON, format, version and missing settings fail with actionable messages',()=>{
  assert.throws(()=>parseConfig('{oops'),/JSON 格式/);
  for(const value of ['null','[]','42'])assert.throws(()=>parseConfig(value),/对象/);
  assert.throws(()=>parseConfig(json({format:'other-app'})),/format/);
  for(const version of [0,2,'1',null])assert.throws(()=>parseConfig(json({version})),/version/);
  assert.throws(()=>parseConfig('{"format":"lfd-inquiry-config","version":1}'),/settings/);
  assert.throws(()=>parseConfig(json({settings:null})),/对象/);
});

test('settings reject bad account, untrusted sheet URL, invalid index and coerced booleans',()=>{
  for(const account of ['not-an-email','.x@example.com','x..y@example.com','x@example.com\nBcc: other@example.com','x@example.com,other@example.com'])
    assert.throws(()=>validateSettings({account}),/账号地址/);
  for(const sheetUrl of ['http://www.kdocs.cn/l/example','https://evil.example/l/example','https://www.kdocs.cn/l/example?x=y','https://www.kdocs.cn/l/example#x','https://user:pass@www.kdocs.cn/l/example','javascript:alert(1)'])
    assert.throws(()=>validateSettings({sheetUrl}),/分享链接/);
  for(const gmailIndex of [-1,21,1.5,'0'])assert.throws(()=>validateSettings({gmailIndex}),/编号/);
  assert.throws(()=>validateSettings({testMode:'false'}),/testMode/);
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
