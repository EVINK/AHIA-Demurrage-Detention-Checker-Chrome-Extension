import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CARRIERS,ONE_CHAT,normalizeCarriers,chatTemplate,messageTemplate,recognizeCarrier} from '../core.js';
import {validateSettings,createConfig,parseConfig} from '../config.js';
import {createService} from '../service.js';

const record={container:'TRHU6206940',mbl:'ONEYSZPGR9159802',row:20,carrier:'ONE'};
const one=()=>normalizeCarriers().find(profile=>profile.id==='one');

function setup({testMode=false,...overrides}={}){
  let db={settings:{account:'me@example.com',gmailIndex:0,testMode},ledger:{}};
  const calls={prepareChat:[],sendChat:[],prepareMail:0};
  const dependencies={
    storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},
    readSheet:async()=>({records:[record],readAt:1}),
    prepareMail:async()=>{calls.prepareMail++;return {tabId:8};},sendMail:async()=>({confirmed:true}),
    prepareChat:async payload=>{calls.prepareChat.push(payload);return {tabId:11,...(payload.send?{}:{agent:'Liza (ONE)'})};},
    sendChat:async(prepared,payload)=>{calls.sendChat.push({prepared,payload});return {confirmed:true,agent:'Liza (ONE)',evidence:'Please advise … Read • 11:16 AM'};},
    uuid:()=>'test-request',...overrides};
  const service=createService(dependencies);
  // send/draft for background channels return at once; wait for the job like the popup's task list does.
  const run=async(...args)=>{const started=await service.run(...args);assert.equal(started.background,true);return service.job(started.requestId);};
  return {service:{...service,run:(container,mode,...rest)=>['send','draft'].includes(mode)?run(container,mode,...rest):service.run(container,mode,...rest)},calls,db:()=>db};
}

test('ONE is a built-in live-chat carrier recognized from the sheet SSL or the ONEY prefix',()=>{
  const profile=one();
  assert.equal(profile.channel,'one-chat');assert.deepEqual(profile.chat,{...ONE_CHAT});
  assert.equal(recognizeCarrier(record).carrier.id,'one');
  assert.equal(recognizeCarrier({...record,carrier:''}).carrier.id,'one');
  assert.throws(()=>messageTemplate(record,{carrier:profile}),/在线客服|工单网站/);
});

test('chat message follows the selected type: demurrage and detention',()=>{
  assert.equal(chatTemplate(record,{carrier:one(),inquiryType:'demurrage'}).message,'Please advise demurrage LFD for TRHU6206940 / ONEYSZPGR9159802');
  assert.equal(chatTemplate(record,{carrier:one(),inquiryType:'detention'}).message,'Please advise detention LFD for TRHU6206940 / ONEYSZPGR9159802');
});

test('chat config validates the message template and email, and round-trips through JSON',()=>{
  const base=DEFAULT_CARRIERS.find(p=>p.id==='one');
  assert.throws(()=>normalizeCarriers([{...base,chat:{...ONE_CHAT,message:'Please advise LFD for {{container}}'}}]),/必须包含/);
  assert.throws(()=>normalizeCarriers([{...base,chat:{...ONE_CHAT,message:'{{type}} {{container}} {{mbl}} {{oops}}'}}]),/未知/);
  assert.throws(()=>normalizeCarriers([{...base,chat:{...ONE_CHAT,email:'a@b.com, c@d.com'}}]),/Email/);
  const settings=validateSettings({carriers:[{...base,chat:{...ONE_CHAT,firstName:'Amy'}}],defaultCarrierId:'one'});
  assert.equal(settings.carriers[0].chat.firstName,'Amy');
  assert.deepEqual(parseConfig(JSON.stringify(createConfig(settings))).carriers,settings.carriers);
});

test('identify keeps the chosen type for ONE (unlike COSCO) and reports no missing configuration',async()=>{
  const t=setup();
  for(const type of ['demurrage','detention']){
    const identified=await t.service.run(record.container,'identify',{inquiryType:type});
    assert.equal(identified.channel,'one-chat');assert.equal(identified.inquiryType,type);assert.deepEqual(identified.configurationMissing,[]);
  }
});

test('test mode reaches the agent and types the message but never sends it',async()=>{
  const t=setup({testMode:true});
  const entry=await t.service.run(record.container,'send');
  assert.equal(entry.status,'draft');assert.equal(entry.channel,'one-chat');assert.equal(entry.tabId,11);
  assert.equal(t.calls.prepareChat[0].send,false);assert.equal(t.calls.sendChat.length,0);assert.equal(t.calls.prepareMail,0);
  assert.equal(entry.agent,'Liza (ONE)','test mode reaches the agent');
  assert.equal(entry.chatMessage,'Please advise demurrage LFD for TRHU6206940 / ONEYSZPGR9159802');
});

test('live send records the agent and delivery; demurrage and detention lock separately',async()=>{
  const t=setup();
  const demurrage=await t.service.run(record.container,'send',{inquiryType:'demurrage'});
  assert.equal(demurrage.status,'sent');assert.equal(demurrage.agent,'Liza (ONE)');assert.match(demurrage.confirmation,/Read/);
  const payload=t.calls.sendChat[0].payload;
  assert.equal(payload.message,'Please advise demurrage LFD for TRHU6206940 / ONEYSZPGR9159802');
  assert.equal(payload.firstName,'LET');assert.equal(payload.email,'service@darwinpacific.com');assert.equal(payload.container,record.container);
  await assert.rejects(t.service.run(record.container,'send',{inquiryType:'demurrage'}),/已有/);
  const detention=await t.service.run(record.container,'send',{inquiryType:'detention'});
  assert.equal(detention.status,'sent');assert.equal(t.calls.sendChat[1].payload.message,'Please advise detention LFD for TRHU6206940 / ONEYSZPGR9159802');
});

test('failure before the message is sent (no agent) is "not sent", after sending it is uncertain',async()=>{
  const early=setup({sendChat:async()=>{const error=new Error('等待 ONE 客服接入超时（10 分钟）');error.notTransmitted=true;throw error;}});
  await assert.rejects(early.service.run(record.container,'send'),/消息未发送/);
  assert.equal(Object.values(early.db().ledger)[0].status,'needs_review');
  const late=setup({sendChat:async()=>{throw new Error('ONE 客服消息未显示 Delivered/Read');}});
  await assert.rejects(late.service.run(record.container,'send'),/待核实/);
  assert.equal(Object.values(late.db().ledger)[0].status,'uncertain');
  await assert.rejects(late.service.run(record.container,'send'),/已有/);
});

test('a multi-container chat sends one message per container and partial reads are recorded per container',async()=>{
  const second={container:'ONEU4567236',mbl:'ONEYTA6PTU000000'};
  const t=setup({sendChat:async()=>{const error=new Error('未读完');error.read=[true,false];throw error;}});
  await t.service.run(record.container,'identify');
  await assert.rejects(t.service.run(record.container,'send',{more:[second]}),/待核实/);
  const sent=t.calls.prepareChat[0];
  assert.deepEqual(sent.messages,['Please advise demurrage LFD for TRHU6206940 / ONEYSZPGR9159802','Please advise demurrage LFD for ONEU4567236 / ONEYTA6PTU000000']);
  const entries=Object.values(t.db().ledger);
  assert.deepEqual(entries.map(e=>[e.container,e.status]),[['TRHU6206940','sent'],['ONEU4567236','uncertain']]);
  assert.deepEqual(entries.map(e=>e.chatMessage),sent.messages);
});

test('a failed task the user verified as sent becomes sent and keeps its duplicate lock',async()=>{
  const t=setup({sendChat:async()=>{throw new Error('消息没有出现在对话中');}});
  await assert.rejects(t.service.run(record.container,'send'),/待核实/);
  const [entry]=Object.values(t.db().ledger);assert.equal(entry.status,'uncertain');
  await t.service.markSent(entry.requestId);
  const [verified]=Object.values(t.db().ledger);assert.equal(verified.status,'sent');assert.equal(verified.confirmation,'用户核实已发送');
  await assert.rejects(t.service.run(record.container,'send'),/已有/);
});
