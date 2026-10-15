import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CARRIERS,COSCO_PORTAL,normalizeCarriers,messageTemplate,portalTemplate,recognizeCarrier} from '../core.js';
import {validateSettings,createConfig,parseConfig} from '../config.js';
import {createService} from '../service.js';

const record={container:'MSMU7504817',mbl:'COSU6123456780',row:12,carrier:'COS'};
const COSCO_DEFAULT=DEFAULT_CARRIERS.find(p=>p.id==='cosco');
const cosco=()=>normalizeCarriers().find(profile=>profile.id==='cosco');

function setup({testMode=false,...overrides}={}){
  let db={settings:{account:'me@example.com',gmailIndex:0,testMode},ledger:{}};
  const calls={read:0,prepareTicket:[],submitTicket:[],prepareMail:0,sendMail:0};
  const dependencies={
    storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},
    readSheet:async()=>{calls.read++;return {records:[record],readAt:1};},
    prepareMail:async()=>{calls.prepareMail++;return {tabId:8};},sendMail:async()=>{calls.sendMail++;return {confirmed:true};},
    prepareTicket:async payload=>{calls.prepareTicket.push(payload);return {tabId:9};},
    submitTicket:async(prepared,payload)=>{calls.submitTicket.push({prepared,payload});return {confirmed:true,ticketId:'123456',evidence:'/support/tickets/123456'};},
    uuid:()=>'test-request',...overrides};
  return {service:createService(dependencies),calls,db:()=>db};
}

test('COSCO is a built-in portal carrier recognized from the sheet SSL "COS"',()=>{
  const profile=cosco();
  assert.equal(profile.channel,'cosco-portal');
  assert.deepEqual(profile.portal,{...COSCO_PORTAL});
  assert.equal(profile.portal.reference,'AHIA');assert.equal(profile.portal.requester,'service@darwinpacific.com');
  assert.equal(recognizeCarrier(record).carrier.id,'cosco');
  assert.equal(recognizeCarrier({...record,carrier:''}).carrier.id,'cosco','COSU MBL prefix');
  for(const id of ['maersk','msc'])assert.equal(normalizeCarriers().find(p=>p.id===id).channel,'email');
});

test('portal config validates channel and a single requester, and round-trips through JSON',()=>{
  assert.throws(()=>normalizeCarriers([{...COSCO_DEFAULT,channel:'fax'}]),/发送方式/);
  assert.throws(()=>normalizeCarriers([{...COSCO_DEFAULT,portal:{...COSCO_PORTAL,requester:'a@example.com, b@example.com'}}]),/Requester/);
  assert.throws(()=>normalizeCarriers([{...COSCO_DEFAULT,portal:{...COSCO_PORTAL,reference:''}}]),/SCAC/);
  const settings=validateSettings({carriers:[{...COSCO_DEFAULT,portal:{...COSCO_PORTAL,requester:'Ops@Example.com'}}],defaultCarrierId:'cosco'});
  assert.equal(settings.carriers[0].portal.requester,'ops@example.com');
  assert.deepEqual(parseConfig(JSON.stringify(createConfig(settings))).carriers,settings.carriers);
  const email=normalizeCarriers([{id:'x',name:'X',greeting:'X',to:[],cc:[]}])[0];
  assert.equal(email.channel,'email');assert.equal('portal' in email,false);
});

test('portal ticket uses the default mail body, always Detention, and is never rendered as an email',()=>{
  const ticket=portalTemplate(record,{carrier:cosco()});
  assert.equal(ticket.inquiryType,'detention');
  assert.equal(ticket.bodyText,'Dear Cosco,\n\nCould you please advise the detention LFD for the container below?\n\nContainer#\tMBL#\nMSMU7504817\tCOSU6123456780');
  assert.match(ticket.html,/<table[^>]*>.*Container#.*MBL#.*MSMU7504817.*COSU6123456780/);
  assert.equal(ticket.shipmentType,'Per Diem');assert.equal(ticket.service,'Last Free Day');assert.equal(ticket.reference,'AHIA');
  assert.throws(()=>messageTemplate(record,{carrier:cosco()}),/工单网站/);
  assert.throws(()=>portalTemplate(record,{carrier:{...cosco(),portal:{...COSCO_PORTAL,requester:''}}}),/Requester/);
});

test('identify reports the portal channel with Detention even when Demurrage is selected',async()=>{
  const t=setup();
  const identified=await t.service.run(record.container,'identify',{inquiryType:'demurrage'});
  assert.equal(identified.carrierId,'cosco');assert.equal(identified.channel,'cosco-portal');
  assert.equal(identified.inquiryType,'detention');assert.deepEqual(identified.configurationMissing,[]);
});

test('test mode only fills the ticket in a background tab and never submits',async()=>{
  const t=setup({testMode:true});
  const entry=await t.service.run(record.container,'send',{inquiryType:'demurrage'});
  assert.equal(entry.status,'draft');assert.equal(entry.channel,'cosco-portal');assert.equal(entry.tabId,9);
  assert.equal(t.calls.prepareTicket.length,1);assert.equal(t.calls.prepareTicket[0].submit,false);
  assert.equal(t.calls.submitTicket.length,0);assert.equal(t.calls.prepareMail,0);
  assert.equal(entry.requester,'service@darwinpacific.com');assert.equal(entry.reference,'AHIA');assert.equal('to' in entry,false);
});

test('live send fills, waits for submit and records the ticket; duplicates stay locked',async()=>{
  const t=setup();
  const entry=await t.service.run(record.container,'send');
  assert.equal(entry.status,'sent');assert.equal(entry.ticketId,'123456');assert.equal(entry.inquiryType,'detention');
  assert.equal(t.calls.prepareTicket[0].submit,true);
  const payload=t.calls.submitTicket[0].payload;
  assert.equal(payload.requestId,'test-request');assert.equal(payload.container,record.container);assert.equal(payload.mbl,record.mbl);assert.equal(payload.reference,'AHIA');
  assert.equal(t.calls.sendMail,0);
  await assert.rejects(t.service.run(record.container,'send'),/已有/);
  assert.equal(t.calls.submitTicket.length,1);
});

test('captcha timeout before Submit is "not submitted", not "uncertain"',async()=>{
  const t=setup({submitTicket:async()=>{const error=new Error('等待人机验证超时，工单未提交。');error.notTransmitted=true;throw error;}});
  await assert.rejects(t.service.run(record.container,'send'),/工单未提交/);
  const [entry]=Object.values(t.db().ledger);assert.equal(entry.status,'needs_review');assert.equal(entry.tabId,9);
});

test('failure after Submit was clicked stays uncertain and locked',async()=>{
  const t=setup({submitTicket:async()=>{throw new Error('未检测到 COSCO 工单提交成功');}});
  await assert.rejects(t.service.run(record.container,'send'),/待核实/);
  assert.equal(Object.values(t.db().ledger)[0].status,'uncertain');
  await assert.rejects(t.service.run(record.container,'send'),/已有/);
});
