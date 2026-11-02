import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCarriers,messageTemplate} from '../src/core/core.ts';
import {validateSettings,createConfig,parseConfig,DEFAULT_SETTINGS} from '../src/core/config.ts';
import {createService} from '../src/core/service.ts';

const record={container:'MRSU4786640',mbl:'MAEU276301677',row:1,carrier:'MSK'};

test('Gmail stays the default; the mail program option is Foxmail and the former "system" value migrates to it',()=>{
  assert.equal(DEFAULT_SETTINGS.mailClient,'gmail');assert.equal(validateSettings({}).mailClient,'gmail');
  assert.equal(validateSettings({mailClient:'foxmail'}).mailClient,'foxmail');
  assert.equal(validateSettings({mailClient:'outlook'}).mailClient,'outlook');
  assert.equal(parseConfig(JSON.stringify(createConfig(validateSettings({mailClient:'outlook'})))).mailClient,'outlook');
  assert.equal(validateSettings({mailClient:'system'}).mailClient,'foxmail','saved settings and old exports keep working');
  assert.throws(()=>validateSettings({mailClient:'thunderbird'}),/邮件发送方式/);
  assert.equal(parseConfig(JSON.stringify({format:'lfd-inquiry-config',version:1,settings:{mailClient:'system'}})).mailClient,'foxmail');
});

test('with the mail program a send opens a Foxmail-formatted mailto draft and waits for 「我已发送」',async()=>{
  let db={settings:{gmailIndex:0,mailClient:'foxmail',carriers:normalizeCarriers()},ledger:{}};
  let gmail=0;
  const service=createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},
    readSheet:async()=>({records:[record],readAt:1}),prepareMail:async()=>{gmail++;return {tabId:8};},sendMail:async()=>{gmail++;return {confirmed:true};},uuid:()=>'r'});
  const entry=await service.run(record.container,'send');
  assert.equal(gmail,0,'Gmail is not used');
  assert.equal(entry.status,'draft');assert.equal(entry.mailClient,'foxmail');assert.equal(entry.background,undefined);
  const url=new URL(entry.mailto);
  assert.equal(url.protocol,'mailto:');assert.equal(decodeURIComponent(url.pathname),'us.customerexperience@maersk.com');
  assert.equal(url.searchParams.get('cc'),'truck@darwinpacific.com;service@darwinpacific.com');
  assert.equal(url.searchParams.get('subject'),'Demurrage LFD Inquiry - Container#MRSU4786640 MBL#MAEU276301677');
  assert.match(url.searchParams.get('body'),/^Dear MSK,<br><br>Could you please advise the demurrage LFD/);
  assert.match(url.searchParams.get('body'),/<tr><td>MRSU4786640<\/td><td>MAEU276301677<\/td><\/tr><\/table>$/);
  await assert.rejects(service.run(record.container,'send'),/已有/,'the lock still prevents a second message');
  await service.markSent('r');
  const [saved]=Object.values(db.ledger);assert.equal(saved.status,'sent');assert.match(saved.confirmation,/用户确认/);
  await assert.rejects(service.markSent('r'),/已确认/);
});

test('a duplicate lock reports the blocking record, and releasing it allows a forced resend',async()=>{
  let db={settings:{gmailIndex:0,mailClient:'system',carriers:normalizeCarriers()},ledger:{}};
  let id=0;
  const service=createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},
    readSheet:async()=>({records:[record],readAt:1}),prepareMail:async()=>({tabId:8}),sendMail:async()=>({confirmed:true}),uuid:()=>`r${++id}`});
  const first=await service.run(record.container,'send');
  const error=await service.run(record.container,'send').then(()=>null,e=>e);
  assert.match(error.message,/已有/);
  assert.deepEqual(error.duplicate.map(b=>[b.container,b.status,b.requestId,b.running]),[[record.container,'draft',first.requestId,false]]);
  await service.release(error.duplicate[0].key);
  const again=await service.run(record.container,'send');
  assert.equal(again.status,'draft');assert.notEqual(again.requestId,first.requestId);
  assert.equal(db.archive.length,1,'the released record is archived, not lost');
});


