import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCarriers,messageTemplate,INQUIRY_TYPES,inquiryType,ON_HIRE_BODY_TEMPLATE,ON_HIRE_SUBJECT_TEMPLATE} from '../core.js';
import {validateSettings,createConfig,parseConfig} from '../config.js';
import {createService} from '../service.js';

const withOnHire=(id,to=['onhire@example.com'])=>normalizeCarriers().map(p=>p.id===id?{...p,onHire:{to,cc:[],subjectTemplate:'On-Hire LFD Inquiry - {{container}} / {{mbl}}',bodyTemplate:'Dear {{steam shipping line}},\n\nPlease advise on-hire.\n\n{{table}}'}}:p);

test('On-Hire is a third inquiry type with its own title',()=>{
  assert.equal(inquiryType('On-Hire'),'on-hire');assert.equal(INQUIRY_TYPES['on-hire'],'On-Hire');
  assert.throws(()=>inquiryType('onhire'),/On-Hire/);
});

test('every carrier gets On-Hire email settings; recipients must be configured first',()=>{
  const [maersk]=normalizeCarriers();
  assert.deepEqual(maersk.onHire,{to:[],cc:[],subjectTemplate:ON_HIRE_SUBJECT_TEMPLATE,bodyTemplate:ON_HIRE_BODY_TEMPLATE},'standard On-Hire text until the user writes their own');
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
    prepareTicket:async p=>{calls.ticket++;calls.tickets=[...(calls.tickets||[]),p];return {tabId:9};},submitTicket:async()=>({confirmed:true}),
    prepareChat:async()=>{calls.chat++;return {tabId:10};},sendChat:async()=>({confirmed:true}),
    uuid:()=>'r'});
  const run=async(...args)=>{const started=await service.run(...args);return args[1]==='identify'?started:service.job(started.requestId);};
  return {run,calls,db:()=>db};
}

test('On-Hire for ONE is sent by email, not chat; COSCO On-Hire is a ticket',async()=>{
  const one=setup(withOnHire('one'),{container:'TRHU6206940',mbl:'ONEYSZPGR9159802',row:1,carrier:'ONE'});
  const identified=await one.run('TRHU6206940','identify',{inquiryType:'on-hire'});
  assert.equal(identified.channel,'email');assert.equal(identified.inquiryType,'on-hire');assert.deepEqual(identified.configurationMissing,[]);
  const entry=await one.run('TRHU6206940','send',{inquiryType:'on-hire'});
  assert.equal(entry.status,'sent');assert.equal(entry.channel,'email');assert.deepEqual(entry.to,['onhire@example.com']);
  assert.equal(one.calls.chat,0);assert.equal(one.calls.mail.length,1);assert.match(one.calls.mail[0].subject,/^On-Hire LFD Inquiry/);
  // COSCO's On-Hire is a ticket on coscoshippingla.freshdesk.com with all containers in one ticket.
  const cosco=setup(normalizeCarriers(),{container:'TRHU6630515',mbl:'COSU6466276490',row:2,carrier:'COS'});
  const coscoIdentified=await cosco.run('TRHU6630515','identify',{inquiryType:'on-hire'});
  assert.equal(coscoIdentified.inquiryType,'on-hire');assert.equal(coscoIdentified.channel,'cosco-portal');assert.deepEqual(coscoIdentified.configurationMissing,[]);
  await cosco.run('TRHU6630515','send',{inquiryType:'on-hire'});
  assert.equal(cosco.calls.ticket,1);assert.equal(cosco.calls.mail.length,0);
  const detention=await cosco.run('TRHU6630515','send',{inquiryType:'detention'});
  assert.equal(detention.channel,'cosco-portal');assert.equal(cosco.calls.ticket,2,'Detention is a separate ticket and lock');
});

test('missing On-Hire recipients are reported by identify and stop a send',async()=>{
  const t=setup(normalizeCarriers(),{container:'MRSU4786640',mbl:'MAEU276301677',row:3,carrier:'MSK'});
  const identified=await t.run('MRSU4786640','identify',{inquiryType:'on-hire'});
  assert.deepEqual(identified.configurationMissing,['onHireTo']);
  await assert.rejects(t.run('MRSU4786640','send',{inquiryType:'on-hire'}),/On-Hire/);
  assert.equal(t.calls.mail.length,0);
});

test('On-Hire sends several containers of the same carrier in one email table; another carrier is refused',async()=>{
  const records=[{container:'OOLU9995789',mbl:'OOLU4055290001',row:1,carrier:'OOCL'},{container:'FFAU8502590',mbl:'OOLU4055290002',row:2,carrier:'OOCL'},{container:'TIIU8074576',mbl:'ZIMUNGB208771',row:3,carrier:'ZIM'}];
  const carriers=[...normalizeCarriers(),{id:'oocl',name:'OOCL',greeting:'OOCL',to:[],cc:[],aliases:['OOCL'],mblPrefixes:['OOLU'],onHire:{to:['onhire@oocl.example']}},{id:'zim',name:'ZIM',greeting:'ZIM',to:[],cc:[],aliases:['ZIM'],mblPrefixes:[]}];
  let db={settings:{account:'me@example.com',gmailIndex:0,testMode:false,carriers},ledger:{}};const mails=[];
  const service=createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},readSheet:async()=>({records,readAt:1}),
    prepareMail:async p=>{mails.push(p);return {tabId:8};},sendMail:async()=>({confirmed:true,evidence:'ok'}),uuid:()=>'r'});
  await service.run('OOLU9995789','identify',{inquiryType:'on-hire'});
  await assert.rejects(service.run('OOLU9995789','send',{inquiryType:'on-hire',more:[{container:'TIIU8074576',mbl:'ZIMUNGB208771'}]}),/不是 OOCL/);
  const started=await service.run('OOLU9995789','send',{inquiryType:'on-hire',more:[{container:'FFAU8502590',mbl:'OOLU4055290002'}]});
  await service.job(started.requestId);
  assert.equal(mails.length,1,'one email for both containers');
  assert.equal(mails[0].bodyText.split('\n').slice(-2).join('|'),'OOLU9995789\tOOLU4055290001|FFAU8502590\tOOLU4055290002');
  assert.match(mails[0].subject,/OOLU9995789, FFAU8502590/);
  assert.deepEqual(Object.values(db.ledger).map(e=>[e.container,e.status]),[['OOLU9995789','sent'],['FFAU8502590','sent']]);
  await assert.rejects(service.run('OOLU9995789','send',{inquiryType:'demurrage',more:[{container:'FFAU8502590',mbl:'OOLU4055290002'}]}),/On-Hire/);
});

test('COSCO On-Hire ticket: Equipment fields, container count and list, a Container#/MBL# table row each',async()=>{
  const {portalTemplate}=await import('../core.js');
  const cosco=normalizeCarriers().find(p=>p.id==='cosco');
  const ticket=portalTemplate({container:'TRHU6630515',mbl:'COSU6466276490'},{carrier:cosco,inquiryType:'on-hire',more:[{container:'OOCU8526498',mbl:'COSU6466276590'}]});
  assert.equal(ticket.url,'https://coscoshippingla.freshdesk.com/support/tickets/new');
  assert.deepEqual(ticket.fields.map(f=>[f.label,f.value,f.kind]),[['Type','Equipment','select'],['Services','On / Off Hire','select'],['Region','Southern California','select'],['Number of Containers','2','input'],['Container #','TRHU6630515 OOCU8526498','input'],['SCAC Code','AHIA','input']]);
  assert.equal(ticket.bodyText,'Dear Cosco,\n\nPlease onhire below containers to LBCT,PCT,ETS,FMS,APM\n\nContainer#\tMBL#\nTRHU6630515\tCOSU6466276490\nOOCU8526498\tCOSU6466276590');
  assert.match(ticket.html,/<table[^>]*><tr><th[^>]*>Container#<\/th><th[^>]*>MBL#<\/th><\/tr><tr><td[^>]*>TRHU6630515<\/td><td[^>]*>COSU6466276490<\/td><\/tr><tr><td[^>]*>OOCU8526498<\/td><td[^>]*>COSU6466276590<\/td><\/tr><\/table>$/);
  assert.throws(()=>portalTemplate({container:'TRHU6630515',mbl:'COSU6466276490'},{carrier:cosco,more:[{container:'OOCU8526498',mbl:'COSU6466276590'}]}),/On-Hire/);
});

test('COSCO keeps its own On-Hire wording even if a generic default was saved earlier',()=>{
  const {ON_HIRE_BODY_TEMPLATE:generic,COSCO_ON_HIRE_BODY}={ON_HIRE_BODY_TEMPLATE,COSCO_ON_HIRE_BODY:'Dear {{steam shipping line}},\n\nPlease onhire below containers to LBCT,PCT,ETS,FMS,APM\n\n{{table}}'};
  const saved=normalizeCarriers().map(p=>p.id==='cosco'?{...p,onHire:{...p.onHire,bodyTemplate:generic}}:p);
  assert.equal(normalizeCarriers(saved).find(p=>p.id==='cosco').onHire.bodyTemplate,COSCO_ON_HIRE_BODY);
  const custom=normalizeCarriers().map(p=>p.id==='cosco'?{...p,onHire:{...p.onHire,bodyTemplate:'My own text\n{{table}}'}}:p);
  assert.equal(normalizeCarriers(custom).find(p=>p.id==='cosco').onHire.bodyTemplate,'My own text\n{{table}}');
});
