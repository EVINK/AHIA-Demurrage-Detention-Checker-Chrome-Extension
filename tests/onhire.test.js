import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCarriers,messageTemplate,INQUIRY_TYPES,inquiryType} from '../core.js';
import {validateSettings,createConfig,parseConfig} from '../config.js';
import {createService} from '../service.js';

const withOnHire=(id,to=['onhire@example.com'])=>normalizeCarriers().map(p=>p.id===id?{...p,onHire:{to,cc:[],subjectTemplate:'On-Hire LFD Inquiry - {{container}} / {{mbl}}',bodyTemplate:'Dear {{steam shipping line}},\n\nPlease advise on-hire.\n\n{{table}}'}}:p);

test('On-Hire is a third inquiry type with its own title',()=>{
  assert.equal(inquiryType('On-Hire'),'on-hire');assert.equal(INQUIRY_TYPES['on-hire'],'On-Hire');
  assert.throws(()=>inquiryType('onhire'),/On-Hire/);
});

test('every carrier gets On-Hire email settings; recipients must be configured first',()=>{
  const [maersk]=normalizeCarriers();
  assert.deepEqual(maersk.onHire,{to:[],cc:[],subjectTemplate:'',bodyTemplate:''},'templates are left for the user to write');
  assert.throws(()=>messageTemplate({container:'MRSU4786640',mbl:'MAEU276301677'},{carrier:maersk,inquiryType:'on-hire'}),/On-Hire 收件邮箱/);
  const custom={...maersk,onHire:{to:['onhire@example.com'],cc:['ops@example.com'],subjectTemplate:'On-Hire {{container}} {{mbl}}',bodyTemplate:'Please confirm on-hire.\n{{table}}'}};
  const message=messageTemplate({container:'MRSU4786640',mbl:'MAEU276301677'},{carrier:custom,inquiryType:'on-hire'});
  assert.deepEqual(message.to,['onhire@example.com']);assert.deepEqual(message.cc,['ops@example.com']);
  assert.equal(message.subject,'On-Hire MRSU4786640 MAEU276301677');assert.match(message.bodyText,/^Please confirm on-hire\./);
});

test('On-Hire settings round-trip through the JSON config',()=>{
  const settings=validateSettings({carriers:withOnHire('maersk')});
  assert.deepEqual(parseConfig(JSON.stringify(createConfig(settings))).carriers,settings.carriers);
});

function setup(carriers,record){
  let db={settings:{account:'me@example.com',gmailIndex:0,testMode:false,carriers},ledger:{}};
  const calls={mail:[],ticket:0,chat:0};
  const service=createService({
    storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},
    readSheet:async()=>({records:[record],readAt:1}),
    prepareMail:async p=>{calls.mail.push(p);return {tabId:8,bodyHash:'h'};},sendMail:async()=>({confirmed:true,evidence:'sent'}),
    prepareTicket:async()=>{calls.ticket++;return {tabId:9};},submitTicket:async()=>({confirmed:true}),
    prepareChat:async()=>{calls.chat++;return {tabId:10};},sendChat:async()=>({confirmed:true}),
    uuid:()=>'r'});
  const run=async(...args)=>{const started=await service.run(...args);return args[1]==='identify'?started:service.job(started.requestId);};
  return {run,calls,db:()=>db};
}

test('On-Hire for ONE is sent by email, not chat; COSCO On-Hire waits for its ticket flow',async()=>{
  const one=setup(withOnHire('one'),{container:'TRHU6206940',mbl:'ONEYSZPGR9159802',row:1,carrier:'ONE'});
  const identified=await one.run('TRHU6206940','identify',{inquiryType:'on-hire'});
  assert.equal(identified.channel,'email');assert.equal(identified.inquiryType,'on-hire');assert.deepEqual(identified.configurationMissing,[]);
  const entry=await one.run('TRHU6206940','send',{inquiryType:'on-hire'});
  assert.equal(entry.status,'sent');assert.equal(entry.channel,'email');assert.deepEqual(entry.to,['onhire@example.com']);
  assert.equal(one.calls.chat,0);assert.equal(one.calls.mail.length,1);assert.match(one.calls.mail[0].subject,/^On-Hire LFD Inquiry/);
  // COSCO's On-Hire goes through a ticket flow that is not defined yet: nothing is sent.
  const cosco=setup(withOnHire('cosco'),{container:'CSNU5509665',mbl:'COSU6466280560',row:2,carrier:'COS'});
  const coscoIdentified=await cosco.run('CSNU5509665','identify',{inquiryType:'on-hire'});
  assert.equal(coscoIdentified.inquiryType,'on-hire');assert.deepEqual(coscoIdentified.configurationMissing,['coscoOnHire']);
  await assert.rejects(cosco.run('CSNU5509665','send',{inquiryType:'on-hire'}),/COSCO On-Hire/);
  assert.equal(cosco.calls.ticket,0);assert.equal(cosco.calls.mail.length,0);
  const detention=await cosco.run('CSNU5509665','send',{inquiryType:'detention'});
  assert.equal(detention.channel,'cosco-portal');assert.equal(cosco.calls.ticket,1,'Detention still uses the ticket portal');
});

test('missing On-Hire recipients are reported by identify and stop a send',async()=>{
  const t=setup(normalizeCarriers(),{container:'MRSU4786640',mbl:'MAEU276301677',row:3,carrier:'MSK'});
  const identified=await t.run('MRSU4786640','identify',{inquiryType:'on-hire'});
  assert.deepEqual(identified.configurationMissing,['onHireTo','onHireBody','onHireSubject']);
  await assert.rejects(t.run('MRSU4786640','send',{inquiryType:'on-hire'}),/On-Hire/);
  assert.equal(t.calls.mail.length,0);
});
