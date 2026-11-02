import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BODY_TEMPLATE,DEFAULT_SUBJECT_TEMPLATE} from '../core.js';
import {createService} from '../service.js';

const record={container:'WHSU8284830',mbl:'WHLC031G594231',row:1,carrier:'WHL'};
const whl={id:'whl',name:'WHL',greeting:'WHL',to:['useqc@wanhai.com'],cc:['truck@darwinpacific.com','service@darwinpacific.com'],aliases:['WHL'],mblPrefixes:['WHLC'],bodyTemplate:DEFAULT_BODY_TEMPLATE,subjectTemplate:DEFAULT_SUBJECT_TEMPLATE,
  onHire:{to:['onhire@wanhai.example'],cc:['truck@darwinpacific.com'],subjectTemplate:'On-Hire - {{container}} / {{mbl}}',bodyTemplate:'Dear {{steam shipping line}},\n\nPlease on-hire below containers to Terminal A & B.\n\n{{table}}'}};
const table=rows=>`<table border=1 cellpadding=6 cellspacing=0 bordercolor=#888888><tr><th align=left>Container#</th><th align=left>MBL#</th></tr>${rows.map(([c,m])=>`<tr><td>${c}</td><td>${m}</td></tr>`).join('')}</table>`;

function setup(mailClient='foxmail',records=[record]){
  let db={settings:{gmailIndex:0,mailClient,carriers:[whl]},ledger:{}};let id=0;
  const service=createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},
    readSheet:async()=>({records,readAt:1}),prepareMail:async()=>{throw new Error('Gmail must not be used');},sendMail:async()=>({confirmed:true}),uuid:()=>`r${++id}`});
  return {service,db:()=>db};
}
const parts=url=>{const u=new URL(url);return {to:decodeURIComponent(u.pathname),cc:u.searchParams.get('cc'),subject:u.searchParams.get('subject'),body:u.searchParams.get('body')};};

test('Foxmail Demurrage: HTML body with <br> line breaks and the bordered table (as verified in Foxmail)',async()=>{
  const t=setup();
  const entry=await t.service.run(record.container,'send',{inquiryType:'demurrage'});
  assert.equal(entry.mailClient,'foxmail');assert.equal(entry.status,'draft');
  const mail=parts(entry.mailto);
  assert.equal(mail.to,'useqc@wanhai.com');assert.equal(mail.cc,'truck@darwinpacific.com;service@darwinpacific.com');
  assert.equal(mail.subject,'Demurrage LFD Inquiry - Container#WHSU8284830 MBL#WHLC031G594231');
  assert.equal(mail.body,'Dear WHL,<br><br>Could you please advise the demurrage LFD for the container below?<br><br>'+table([['WHSU8284830','WHLC031G594231']]));
});

test('Foxmail Detention uses the same layout with the Detention wording',async()=>{
  const t=setup();
  const entry=await t.service.run(record.container,'send',{inquiryType:'detention'});
  const mail=parts(entry.mailto);
  assert.match(mail.subject,/^Detention LFD Inquiry/);
  assert.equal(mail.body,'Dear WHL,<br><br>Could you please advise the detention LFD for the container below?<br><br>'+table([['WHSU8284830','WHLC031G594231']]));
});

test('Foxmail On-Hire: several containers become table rows, its own recipients, text is HTML-escaped',async()=>{
  const second={container:'WHSU1234567',mbl:'WHLC031G000002',row:2,carrier:'WHL'};
  const t=setup('foxmail',[record,second]);
  await t.service.run(record.container,'identify',{inquiryType:'on-hire'});
  const entry=await t.service.run(record.container,'send',{inquiryType:'on-hire',more:[{container:second.container,mbl:second.mbl}]});
  const mail=parts(entry.mailto);
  assert.equal(mail.to,'onhire@wanhai.example');assert.equal(mail.cc,'truck@darwinpacific.com');
  assert.equal(mail.subject,'On-Hire - WHSU8284830, WHSU1234567 / WHLC031G594231, WHLC031G000002');
  assert.equal(mail.body,'Dear WHL,<br><br>Please on-hire below containers to Terminal A &amp; B.<br><br>'+table([['WHSU8284830','WHLC031G594231'],['WHSU1234567','WHLC031G000002']]));
  assert.deepEqual(Object.values(t.db().ledger).map(e=>[e.container,e.status,e.mailClient]),[['WHSU8284830','draft','foxmail'],['WHSU1234567','draft','foxmail']]);
});

test('Foxmail drafts wait for 「我已发送」 and keep the duplicate lock; the former "system" option behaves the same',async()=>{
  const t=setup();
  const entry=await t.service.run(record.container,'send');
  await assert.rejects(t.service.run(record.container,'send'),/已有/);
  await t.service.markSent(entry.requestId);
  assert.equal(Object.values(t.db().ledger)[0].status,'sent');
  // Records created under the former 'system' option still reopen and confirm the same way.
  const legacy=setup('system');
  const old=await legacy.service.run(record.container,'send');
  assert.match(parts(old.mailto).body,/<br><br>.*<table border=1/);
});

test('Outlook gets a plain-text body (it shows HTML tags literally); recipients stay semicolon separated',async()=>{
  const t=setup('outlook');
  const entry=await t.service.run(record.container,'send',{inquiryType:'demurrage'});
  assert.equal(entry.mailClient,'outlook');
  const mail=parts(entry.mailto);
  assert.equal(mail.to,'useqc@wanhai.com');assert.equal(mail.cc,'truck@darwinpacific.com;service@darwinpacific.com');
  assert.equal(mail.body,'Dear WHL,\r\n\r\nCould you please advise the demurrage LFD for the container below?\r\n\r\nContainer#: WHSU8284830\r\nMBL#: WHLC031G594231');
  assert.doesNotMatch(mail.body,/<br>|<table/);
});
