import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {DEFAULT_CARRIERS,ONE_CHAT,normalizeCarriers,chatTemplate,messageTemplate,recognizeCarrier,inquiryChannel} from '../src/core/core.ts';
import {validateSettings,createConfig,parseConfig} from '../src/core/config.ts';
import {createService,retryBlankChat,waitForAgent,AGENT_WAIT_LIMIT} from '../src/core/service.ts';

const record={container:'TRHU6206940',mbl:'ONEYSZPGR9159802',row:20,carrier:'ONE'};
const one=()=>normalizeCarriers().find(profile=>profile.id==='one');

function setup(overrides={}){
  let db={settings:{gmailIndex:0},ledger:{}};
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
  assert.equal(inquiryChannel(profile,'demurrage'),'one-chat');assert.equal(inquiryChannel(profile,'on-hire'),'email');assert.deepEqual(profile.chat,{...ONE_CHAT});
  assert.equal(recognizeCarrier(record).carrier.id,'one');
  assert.equal(recognizeCarrier({...record,carrier:''}).carrier.id,'one');
  assert.throws(()=>messageTemplate(record,{carrier:profile}),/在线客服|工单网站/);
});

test('chat message follows the selected type: demurrage and detention',()=>{
  assert.equal(chatTemplate(record,{carrier:one(),inquiryType:'demurrage'}).message,'Please advise demurrage LFD for TRHU6206940 / ONEYSZPGR9159802');
  assert.equal(chatTemplate(record,{carrier:one(),inquiryType:'detention'}).message,'Please advise detention LFD for TRHU6206940 / ONEYSZPGR9159802');
});

test('a one-off edit replaces the chat messages, one line per container, and leaves the template alone',()=>{
  const more=[{container:'NYKU4734803',mbl:'ONEYNB6BDCV24500'}];
  const edited=chatTemplate(record,{carrier:one(),inquiryType:'demurrage',more,edit:{body:'First please\r\n\n  Second please  '}});
  assert.deepEqual(edited.messages,['First please','Second please']);assert.equal(edited.message,'First please\nSecond please');
  assert.throws(()=>chatTemplate(record,{carrier:one(),inquiryType:'demurrage',more,edit:{body:'Only one'}}),/每个柜号一行，共 2 行/);
  assert.equal(chatTemplate(record,{carrier:one(),inquiryType:'demurrage'}).message,'Please advise demurrage LFD for TRHU6206940 / ONEYSZPGR9159802');
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

test('draft reaches the agent and types the message but never sends it',async()=>{
  const t=setup();
  const entry=await t.service.run(record.container,'draft');
  assert.equal(entry.status,'draft');assert.equal(entry.channel,'one-chat');assert.equal(entry.tabId,11);
  assert.equal(t.calls.prepareChat[0].send,false);assert.equal(t.calls.sendChat.length,0);assert.equal(t.calls.prepareMail,0);
  assert.equal(entry.agent,'Liza (ONE)','draft reaches the agent');
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

test('the page state of a failed chat start stays on the record',async()=>{
  const failure=Object.assign(new Error('点击 Continue 后 ONE 聊天窗口 90 秒内没有出现，请打开 ONE 小窗查看页面提示。'),{diagnostics:{clicks:2,visibility:'visible',chatFrame:false}});
  const t=setup({prepareChat:async()=>{throw failure;}});
  await assert.rejects(t.service.run(record.container,'send'),/90 秒/);
  const [entry]=Object.values(t.db().ledger);
  assert.equal(entry.status,'needs_review');assert.deepEqual(entry.diagnostics,failure.diagnostics);
});

const blankPage=()=>Object.assign(new Error('ONE 页面没有加载出所需的聊天窗口。'),{notLoaded:true});
test('a blank ONE page is reloaded until it works',async()=>{
  let starts=0;const seen=[];
  const result=await retryBlankChat(async()=>{if(++starts<4)throw blankPage();return 'chat';},async(error,info)=>{seen.push(info.reload);return {};});
  assert.equal(result,'chat');assert.equal(starts,4);assert.deepEqual(seen,[0,1,2]);
});
test('a run that recovered keeps the reload record; a first-time success records nothing',async()=>{
  const records=[];let starts=0;
  await retryBlankChat(async()=>{if(++starts<3)throw blankPage();},async(error,info)=>({reload:info.reload}),record=>{records.push(record);});
  assert.deepEqual(records,[{reloads:2,attempts:[{reload:0},{reload:1}]}]);
  await retryBlankChat(async()=>{},async()=>({}),record=>{records.push(record);});
  assert.equal(records.length,1);
});
test('after five reloads it fails, with every try on the record',async()=>{
  let starts=0;
  await assert.rejects(retryBlankChat(async()=>{starts++;throw starts%2?blankPage():new Error('ONE 页面上没有找到在线客服图标。');},async(error,info)=>({reload:info.reload,left:info.reloadsLeft})),error=>{
    assert.equal(error.diagnostics.attempts.length,6);assert.deepEqual(error.diagnostics.attempts.at(-1),{reload:5,left:0});return true;});
  assert.equal(starts,6,'first load plus five reloads');
});
test('the worker reloads only before the pre-chat form, so a message cannot go out twice',()=>{
  const worker=readFileSync(new URL('../src/background/worker.ts',import.meta.url),'utf8');
  const start=worker.indexOf('const startChat='),retry=worker.indexOf('await retryBlankChat(startChat'),deliver=worker.indexOf('return deliver(tab.id,payload,progress,false)');
  assert.ok(start>0&&retry>start&&deliver>retry,'order');
  assert.doesNotMatch(worker.slice(start,retry),/'send'|deliver|toAgent|'type'/,'nothing is sent inside the retried part');
});
test('other failures are not retried: they may need a person, or a message may be out',async()=>{
  let starts=0;
  await assert.rejects(retryBlankChat(async()=>{starts++;throw new Error('ONE 在线客服（United States）当前不在服务时间，请稍后再查询。');},async()=>({})),/服务时间/);
  assert.equal(starts,1);
});

const wait=(states,options={})=>{const steps=[];let index=0;return {steps,run:waitForAgent({startedAt:0,now:()=>0,pause:async()=>{},progress:step=>steps.push(step),read:async()=>{const next=states[Math.min(index++,states.length-1)];if(next instanceof Error)throw next;return next;},...options})};};
test('the wait goes on through a long queue, shows its text once per change, and returns the agent',async()=>{
  const queue={queue:'You are number 3 in the queue'},states=[...Array(500).fill({}),queue,queue,{queue:'You are number 1 in the queue'},{agent:'Liza'}];
  const t=wait(states);
  assert.equal(await t.run,'Liza');
  assert.deepEqual(t.steps,['等待客服接入','等待客服接入 · You are number 3 in the queue','等待客服接入 · You are number 1 in the queue']);
});
test('the wait stops when the window closes, the chat ends, the page stays silent or the cap passes',async()=>{
  await assert.rejects(wait([Object.assign(new Error('ONE 页面已被关闭'),{closed:true})]).run,/关闭/);
  await assert.rejects(wait([{},{ended:true}]).run,/对话已结束/);
  await assert.rejects(wait([new Error('no frame')]).run,/no frame/);
  const brief=[new Error('blip'),new Error('blip'),{agent:'Liza'}];assert.equal(await wait(brief).run,'Liza','a short gap is tolerated');
  await assert.rejects(waitForAgent({startedAt:0,now:()=>AGENT_WAIT_LIMIT+1,pause:async()=>{},progress:()=>{},read:async()=>({queue:'x'})}),error=>{assert.match(error.message,/2 小时/);assert.equal(error.diagnostics.waitedMinutes,120);return true;});
});
