import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCarriers,messageTemplate,INQUIRY_TYPES,inquiryType,findType,inquiryChannel,COSCO_ON_HIRE_BODY,ON_HIRE_BODY_TEMPLATE} from '../src/core/core.ts';
import {validateSettings,createConfig,parseConfig} from '../src/core/config.ts';
import {createService} from '../src/core/service.ts';

const setOnHire=(profile,patch)=>({...profile,types:profile.types.map(type=>type.id==='on-hire'?{...type,...patch}:type)});
const withOnHire=(id,to=['onhire@example.com'])=>normalizeCarriers().map(p=>p.id===id?setOnHire(p,{to,cc:[],subjectTemplate:'On-Hire LFD Inquiry - {{container}} / {{mbl}}',bodyTemplate:'Dear {{steam shipping line}},\n\nPlease advise on-hire.\n\n{{table}}'}):p);

test('On-Hire is a third inquiry type with its own title',()=>{
  assert.equal(inquiryType('On-Hire'),'on-hire');assert.equal(INQUIRY_TYPES['on-hire'],'On-Hire');
  assert.throws(()=>inquiryType('onhire'),/On-Hire/);
});

test('every email carrier has its own On-Hire entry; recipients must be configured first',()=>{
  const [maersk]=normalizeCarriers();
  assert.deepEqual(findType(maersk,'on-hire').to,[]);assert.equal(findType(maersk,'on-hire').bodyTemplate,ON_HIRE_BODY_TEMPLATE);
  assert.throws(()=>messageTemplate({container:'MRSU4786640',mbl:'MAEU276301677'},{carrier:maersk,inquiryType:'on-hire'}),/On-Hire 收件邮箱/);
  const custom=setOnHire(maersk,{to:['onhire@example.com'],cc:['ops@example.com'],subjectTemplate:'On-Hire {{container}} {{mbl}}',bodyTemplate:'Please confirm on-hire.\n{{table}}'});
  const message=messageTemplate({container:'MRSU4786640',mbl:'MAEU276301677'},{carrier:custom,inquiryType:'on-hire'});
  assert.deepEqual(message.to,['onhire@example.com']);assert.deepEqual(message.cc,['ops@example.com']);
  assert.equal(message.subject,'On-Hire MRSU4786640 MAEU276301677');assert.match(message.bodyText,/^Please confirm on-hire\./);
});

test('On-Hire settings round-trip through the JSON config',()=>{
  const settings=validateSettings({carriers:withOnHire('maersk')});
  assert.deepEqual(parseConfig(JSON.stringify(createConfig(settings))).carriers,settings.carriers);
});

function setup(carriers,record){
  let db={settings:{gmailIndex:0,carriers},ledger:{}};
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
  assert.deepEqual(identified.configurationMissing,['to']);
  await assert.rejects(t.run('MRSU4786640','send',{inquiryType:'on-hire'}),/On-Hire/);
  assert.equal(t.calls.mail.length,0);
});

test('On-Hire sends several containers of the same carrier in one email table; another carrier is refused',async()=>{
  const records=[{container:'OOLU9995789',mbl:'OOLU4055290001',row:1,carrier:'OOCL'},{container:'FFAU8502590',mbl:'OOLU4055290002',row:2,carrier:'OOCL'},{container:'TIIU8074576',mbl:'ZIMUNGB208771',row:3,carrier:'ZIM'}];
  const carriers=[{id:'oocl',name:'OOCL',greeting:'OOCL',to:[],cc:[],aliases:['OOCL'],mblPrefixes:['OOLU'],onHire:{to:['onhire@oocl.example']}},{id:'zim',name:'ZIM',greeting:'ZIM',to:[],cc:[],aliases:['ZIM'],mblPrefixes:[]}];
  let db={settings:{gmailIndex:0,carriers},ledger:{}};const mails=[];
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
  await assert.rejects(service.run('OOLU9995789','send',{inquiryType:'demurrage',more:[{container:'FFAU8502590',mbl:'OOLU4055290002'}]}),/Demurrage 收件邮箱/);
});

test('COSCO On-Hire ticket: Equipment fields, container count and list, a Container#/MBL# table row each',async()=>{
  const {portalTemplate}=await import('../src/core/core.ts');
  const cosco=normalizeCarriers().find(p=>p.id==='cosco');
  const ticket=portalTemplate({container:'TRHU6630515',mbl:'COSU6466276490'},{carrier:cosco,inquiryType:'on-hire',more:[{container:'OOCU8526498',mbl:'COSU6466276590'}]});
  assert.equal(ticket.url,'https://coscoshippingla.freshdesk.com/support/tickets/new');
  assert.deepEqual(ticket.fields.map(f=>[f.label,f.value,f.kind]),[['Type','Equipment','select'],['Services','On / Off Hire','select'],['Region','Southern California','select'],['Number of Containers','2','input'],['Container #','TRHU6630515 OOCU8526498','input']]);
  assert.equal(ticket.bodyText,'Dear Cosco,\n\nPlease onhire below containers to LBCT,PCT,ETS,FMS,APM\n\nContainer#\tMBL#\nTRHU6630515\tCOSU6466276490\nOOCU8526498\tCOSU6466276590');
  assert.match(ticket.html,/<table[^>]*><tr><th[^>]*>Container#<\/th><th[^>]*>MBL#<\/th><\/tr><tr><td[^>]*>TRHU6630515<\/td><td[^>]*>COSU6466276490<\/td><\/tr><tr><td[^>]*>OOCU8526498<\/td><td[^>]*>COSU6466276590<\/td><\/tr><\/table>$/);
  assert.throws(()=>portalTemplate({container:'TRHU6630515',mbl:'COSU6466276490'},{carrier:cosco,more:[{container:'OOCU8526498',mbl:'COSU6466276590'}]}),/On-Hire/);
});

test('an old COSCO entry with the generic On-Hire text converts to COSCO\'s own wording; custom text stays',()=>{
  const old=body=>({id:'cosco',name:'COSCO',greeting:'Cosco',channel:'cosco-portal',to:[],cc:[],bodyTemplate:'x {{table}}',onHire:{to:[],cc:[],bodyTemplate:body}});
  assert.equal(findType(normalizeCarriers([old(ON_HIRE_BODY_TEMPLATE)])[0],'on-hire').bodyTemplate,COSCO_ON_HIRE_BODY);
  assert.equal(findType(normalizeCarriers([old('My own text\n{{table}}')])[0],'on-hire').bodyTemplate,'My own text\n{{table}}');
  assert.equal(inquiryChannel(normalizeCarriers([old('')])[0],'on-hire'),'cosco-portal');
});

test('Demurrage and Detention take several containers like On-Hire: one email, one lock each, other carriers refused',async()=>{
  const records=[{container:'OOLU9995789',mbl:'OOLU4055290001',row:1,carrier:'OOCL'},{container:'FFAU8502590',mbl:'OOLU4055290002',row:2,carrier:'OOCL'},{container:'TIIU8074576',mbl:'ZIMUNGB208771',row:3,carrier:'ZIM'}];
  const carriers=[{id:'oocl',name:'OOCL',greeting:'OOCL',to:['lfd@oocl.example'],cc:[],aliases:['OOCL'],mblPrefixes:['OOLU'],bodyTemplate:'Dear {{steam shipping line}},\n\nPlease advise the {{type}} LFD.\n\n{{table}}',subjectTemplate:'{{Type}} LFD Inquiry - Container#{{container}} MBL#{{mbl}}'},{id:'zim',name:'ZIM',greeting:'ZIM',to:['z@zim.example'],cc:[],aliases:['ZIM'],mblPrefixes:[]}];
  let db={settings:{gmailIndex:0,carriers},ledger:{}};const mails=[];
  const service=createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},readSheet:async()=>({records,readAt:1}),
    prepareMail:async p=>{mails.push(p);return {tabId:8};},sendMail:async()=>({confirmed:true,evidence:'ok'}),uuid:()=>'r'+mails.length});
  await service.run('OOLU9995789','identify',{inquiryType:'demurrage'});
  await assert.rejects(service.run('OOLU9995789','draft',{inquiryType:'demurrage',more:[{container:'TIIU8074576',mbl:'ZIMUNGB208771'}]}),/不是 OOCL/);
  for(const type of ['demurrage','detention']){
    const started=await service.run('OOLU9995789','draft',{inquiryType:type,more:[{container:'FFAU8502590',mbl:'OOLU4055290002'}]});
    await service.job(started.requestId);
  }
  assert.equal(mails.length,2,'one email per type');
  assert.equal(mails[0].subject,'Demurrage LFD Inquiry - Container#OOLU9995789, FFAU8502590 MBL#OOLU4055290001, OOLU4055290002');
  assert.equal(mails[0].bodyText.split('\n').slice(-2).join('|'),'OOLU9995789\tOOLU4055290001|FFAU8502590\tOOLU4055290002');
  assert.equal(Object.keys(db.ledger).length,4,'a lock per container and type');
  await assert.rejects(service.run('OOLU9995789','draft',{inquiryType:'demurrage',more:[{container:'FFAU8502590',mbl:'OOLU4055290002'}]}),/已有/);
});
