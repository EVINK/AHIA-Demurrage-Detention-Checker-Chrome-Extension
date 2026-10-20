import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCarriers,messageTemplate} from '../core.js';
import {validateSettings,createConfig,parseConfig,DEFAULT_SETTINGS} from '../config.js';
import {createService} from '../service.js';

const record={container:'MRSU4786640',mbl:'MAEU276301677',row:1,carrier:'MSK'};

test('Gmail stays the default mail client; the system mail program is an explicit choice',()=>{
  assert.equal(DEFAULT_SETTINGS.mailClient,'gmail');assert.equal(validateSettings({}).mailClient,'gmail');
  assert.equal(validateSettings({mailClient:'system'}).mailClient,'system');
  assert.throws(()=>validateSettings({mailClient:'outlook'}),/邮件发送方式/);
  const settings=validateSettings({mailClient:'system'});
  assert.equal(parseConfig(JSON.stringify(createConfig(settings))).mailClient,'system');
});

test('with the system mail program a send opens a mailto draft and waits for 「我已发送」',async()=>{
  let db={settings:{account:'me@example.com',gmailIndex:0,testMode:false,mailClient:'system',carriers:normalizeCarriers()},ledger:{}};
  let gmail=0;
  const service=createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},
    readSheet:async()=>({records:[record],readAt:1}),prepareMail:async()=>{gmail++;return {tabId:8};},sendMail:async()=>{gmail++;return {confirmed:true};},uuid:()=>'r'});
  const entry=await service.run(record.container,'send');
  assert.equal(gmail,0,'Gmail is not used');
  assert.equal(entry.status,'draft');assert.equal(entry.mailClient,'system');assert.equal(entry.background,undefined);
  const url=new URL(entry.mailto);
  assert.equal(url.protocol,'mailto:');assert.equal(decodeURIComponent(url.pathname),'us.customerexperience@maersk.com');
  assert.equal(url.searchParams.get('cc'),'truck@darwinpacific.com;service@darwinpacific.com');
  assert.equal(url.searchParams.get('subject'),'Demurrage LFD Inquiry - Container#MRSU4786640 MBL#MAEU276301677');
  assert.match(url.searchParams.get('body'),/^Dear MSK,\r\n\r\nCould you please advise the demurrage LFD/);
  assert.match(url.searchParams.get('body'),/Container#: MRSU4786640\r\nMBL#: MAEU276301677$/);
  await assert.rejects(service.run(record.container,'send'),/已有/,'the lock still prevents a second message');
  await service.markSent('r');
  const [saved]=Object.values(db.ledger);assert.equal(saved.status,'sent');assert.match(saved.confirmation,/用户确认/);
  await assert.rejects(service.markSent('r'),/已确认/);
});

test('a duplicate lock reports the blocking record, and releasing it allows a forced resend',async()=>{
  let db={settings:{account:'me@example.com',gmailIndex:0,testMode:false,mailClient:'system',carriers:normalizeCarriers()},ledger:{}};
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


test('system text labels preserve a custom template and each On-Hire container; Gmail retains its table',()=>{
  const carrier=normalizeCarriers()[0];
  carrier.onHire={...carrier.onHire,to:['first@example.com','second@example.com'],bodyTemplate:'Dear {{steam shipping line}},\r\n\r\nPlease arrange on-hire.\r\n\r\n{{table}}\r\n\r\nThank you.',subjectTemplate:'On-Hire {{container}} {{mbl}}'};
  const options={carrier,inquiryType:'on-hire',more:[{container:'MSDU6134964',mbl:'MEDUACU76689'}]};
  const plain=messageTemplate(record,{...options,plainTextLayout:'labels'});
  assert.match(plain.bodyText,/Container#: MRSU4786640\nMBL#: MAEU276301677\n\nContainer#: MSDU6134964\nMBL#: MEDUACU76689/);
  assert.match(plain.bodyText,/Thank you\.$/);
  assert.doesNotMatch(plain.bodyText,/\t/);
  const gmail=messageTemplate(record,options);
  assert.match(gmail.bodyText,/Container#\tMBL#/);
  assert.equal(plain.html,gmail.html);
});
