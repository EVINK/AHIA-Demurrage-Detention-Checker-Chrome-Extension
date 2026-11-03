import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCarriers,messageTemplate,findType,supportsManyContainers} from '../src/core/core.ts';
import {createService} from '../src/core/service.ts';

const OLD_BODY='Dear {{steam shipping line}},\n\nCould you please advise the {{type}} LFD for the container below?\n\n{{table}}';
const OLD_SUBJECT='{{Type}} LFD Inquiry - Container#{{container}} MBL#{{mbl}}';

test('{{s}} adds the plural only for several containers; old default templates move to the plural ones, custom text stays',()=>{
  const [carrier]=normalizeCarriers([{id:'x',name:'X',greeting:'X',to:['a@example.com'],cc:[],aliases:['X'],mblPrefixes:[],bodyTemplate:OLD_BODY,subjectTemplate:OLD_SUBJECT}]);
  const type=findType(carrier,'demurrage');
  assert.match(type.subjectTemplate,/Container\{\{s\}\}#/);assert.match(type.bodyTemplate,/container\{\{s\}\} below/);
  const one=messageTemplate({container:'OOLU9995789',mbl:'OOLU4055290001'},{carrier,inquiryType:'demurrage'});
  assert.equal(one.subject,'Demurrage LFD Inquiry - Container#OOLU9995789 MBL#OOLU4055290001');assert.match(one.bodyText,/the container below/);
  const two=messageTemplate({container:'OOLU9995789',mbl:'OOLU4055290001'},{carrier,inquiryType:'demurrage',more:[{container:'FFAU8502590',mbl:'OOLU4055290002'}]});
  assert.equal(two.subject,'Demurrage LFD Inquiry - Containers#OOLU9995789, FFAU8502590 MBLs#OOLU4055290001, OOLU4055290002');assert.match(two.bodyText,/the containers below/);
  const [own]=normalizeCarriers([{id:'y',name:'Y',greeting:'Y',to:['a@example.com'],cc:[],aliases:['Y'],mblPrefixes:[],bodyTemplate:'Hi {{table}}',subjectTemplate:'LFD {{container}} {{mbl}}'}]);
  assert.equal(findType(own,'demurrage').subjectTemplate,'LFD {{container}} {{mbl}}');assert.equal(findType(own,'demurrage').bodyTemplate,'Hi {{table}}');
});

test('COSCO tickets take one container each, including On-Hire; email and ONE chat take several',()=>{
  const carriers=normalizeCarriers();const of=id=>carriers.find(p=>p.id===id);
  assert.equal(supportsManyContainers(of('cosco'),'on-hire'),false);assert.equal(supportsManyContainers(of('cosco'),'detention'),false);
  assert.equal(supportsManyContainers(of('one'),'demurrage'),true);assert.equal(supportsManyContainers(of('msc'),'detention'),true);
});

function service(records,carriers,hooks={}){
  let db={settings:{gmailIndex:0,carriers},ledger:{}};
  return createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},readSheet:async()=>({records,readAt:1}),
    prepareMail:async p=>{(hooks.mails||[]).push(p);return {tabId:8};},sendMail:async()=>({confirmed:true,evidence:'ok'}),
    prepareTicket:hooks.prepareTicket,submitTicket:async()=>({confirmed:true}),uuid:(()=>{let n=0;return ()=>'r'+(++n);})()});
}

test('COSCO tickets wait in line: the second ticket starts only after the first is done',async()=>{
  const records=[{container:'TRHU6630515',mbl:'COSU6466276490',row:1,carrier:'COS'},{container:'OOCU8526498',mbl:'COSU6466276590',row:2,carrier:'COS'}];
  const order=[];let release;const first=new Promise(resolve=>{release=resolve;});
  const s=service(records,normalizeCarriers(),{prepareTicket:async p=>{order.push('start '+p.fields.at(-1)?.value);if(order.length===1)await first;order.push('end');return {tabId:9};}});
  await assert.rejects(s.run('TRHU6630515','send',{inquiryType:'on-hire',more:[{container:'OOCU8526498',mbl:'COSU6466276590'}]}),/一次只能查询一个柜号/);
  const a=await s.run('TRHU6630515','send',{inquiryType:'on-hire'}),b=await s.run('OOCU8526498','send',{inquiryType:'on-hire'});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(order.length,1,'the second ticket has not started');
  release();await s.job(a.requestId);await s.job(b.requestId);
  assert.deepEqual(order.map(x=>x.split(' ')[0]),['start','end','start','end']);
});

test('a carrier chosen for the group vouches for its containers; automatic recognition still checks them',async()=>{
  const records=[{container:'OOLU9995789',mbl:'OOLU4055290001',row:1,carrier:'OOCL'},{container:'TIIU8074576',mbl:'ZIMUNGB208771',row:2,carrier:'ZIM'}];
  const carriers=[{id:'oocl',name:'OOCL',greeting:'OOCL',to:['lfd@oocl.example'],cc:[],aliases:['OOCL'],mblPrefixes:['OOLU'],bodyTemplate:'Hi\n{{table}}',subjectTemplate:'LFD {{container}} {{mbl}}'},{id:'zim',name:'ZIM',greeting:'ZIM',to:['z@example.com'],cc:[],aliases:['ZIM'],mblPrefixes:[]}];
  const mails=[];const s=service(records,carriers,{mails});
  await s.run('OOLU9995789','identify',{inquiryType:'demurrage'});
  await assert.rejects(s.run('OOLU9995789','draft',{inquiryType:'demurrage',more:[{container:'TIIU8074576',mbl:'ZIMUNGB208771'}]}),/不是 OOCL/);
  const started=await s.run('OOLU9995789','draft',{inquiryType:'demurrage',carrierId:'oocl',more:[{container:'TIIU8074576',mbl:'ZIMUNGB208771'}]});
  await s.job(started.requestId);
  assert.equal(mails.length,1);assert.match(mails[0].subject,/OOLU9995789, TIIU8074576/);
});
