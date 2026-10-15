import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCarriers} from '../core.js';
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
  assert.equal(url.searchParams.get('cc'),'truck@darwinpacific.com,service@darwinpacific.com');
  assert.equal(url.searchParams.get('subject'),'Demurrage LFD Inquiry - Container#MRSU4786640 MBL#MAEU276301677');
  assert.match(url.searchParams.get('body'),/^Dear MSK,\r\n\r\nCould you please advise the demurrage LFD/);
  assert.match(url.searchParams.get('body'),/MRSU4786640\tMAEU276301677$/);
  await assert.rejects(service.run(record.container,'send'),/已有/,'the lock still prevents a second message');
  await service.markSent('r');
  const [saved]=Object.values(db.ledger);assert.equal(saved.status,'sent');assert.match(saved.confirmation,/用户确认/);
  await assert.rejects(service.markSent('r'),/已确认/);
});
