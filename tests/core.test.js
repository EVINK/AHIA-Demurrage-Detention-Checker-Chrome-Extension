import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {containerNumber,lookup,messageTemplate,QUESTION,TO,CC,DEFAULT_CARRIERS,DEFAULT_BODY_TEMPLATE,DEFAULT_SUBJECT_TEMPLATE,addressList,inquiryType,normalizeCarriers,normalizeTerminals,recognizeCarrier,findType,newProfile,newInquiryType,missingConfiguration,ON_HIRE_BODY_TEMPLATE,channelsFor} from '../core.js';
import {createService} from '../service.js';
const withType=(profile,id,patch)=>({...profile,types:profile.types.map(type=>type.id===id?{...type,...patch}:type)});
const withAllTypes=(profile,patch)=>({...profile,types:profile.types.map(type=>({...type,...patch}))});
const record={container:'MRSU4786640',mbl:'MAEU276301677',row:326};
test('normalizes casing but rejects partial numbers and header injection',()=>{
  assert.equal(containerNumber(' mrsu4786640 '),record.container);
  for(const v of ['MRSU478664','MRSU47866400','MRSU4786640\nBcc: x@y.com'])assert.throws(()=>containerNumber(v));
});
test('never selects first duplicate, blank MBL, or unmatched container',()=>{
  assert.deepEqual(lookup([record],record.container),record);
  assert.throws(()=>lookup([record,record],record.container),/多行/);
  assert.throws(()=>lookup([{...record,mbl:''}],record.container),/MBL/);
  assert.throws(()=>lookup([{...record,mbl:'X\r\nBcc: x@y.com'}],record.container),/MBL/);
  assert.throws(()=>lookup([],record.container),/未找到/);
});
test('exact user wording and subject',()=>{
  const m=messageTemplate(record);
  assert.equal(m.subject,'Demurrage LFD Inquiry - Container#MRSU4786640 MBL#MAEU276301677');
  assert.deepEqual(m.to,[TO]);assert.equal(m.carrierId,'maersk');assert.equal(m.inquiryType,'demurrage');assert.equal(m.question,QUESTION);
  assert.ok(m.html.includes(QUESTION));assert.ok(m.html.includes('<table'));
});

test('duplicate lookup picks first complete document row without mixing fields',()=>{
  const rows=[{...record,row:40,mbl:'MAEULATER',carrier:'MSK'},{...record,row:10,mbl:'',carrier:'MSC'},
    {...record,row:20,mbl:'MEDUPARTIAL',carrier:' '},{...record,row:30,mbl:'MAEUFIRST',carrier:'MSK'}];
  const result=lookup(rows,record.container);
  assert.equal(result.row,30);assert.equal(result.mbl,'MAEUFIRST');assert.equal(result.carrier,'MSK');
  assert.equal(rows.length,4);
});

test('new and existing caches remove other duplicates without rereading existing cache',async()=>{
  const rows=[{...record,row:10,mbl:'',carrier:'MSK'},{...record,row:20,carrier:'MSK'},{...record,row:30,carrier:'MSC'}];
  const t=setup({readSheet:async()=>({records:rows,readAt:1})});
  await t.service.run(record.container,'identify');
  assert.equal(t.db().sheetCache.records.length,1);assert.equal(t.db().sheetCache.records[0].row,20);
  t.db().sheetCache.records=structuredClone(rows);
  const old=createService({...t.dependencies,readSheet:async()=>{throw new Error('must not read');}});
  await old.run(record.container,'identify');
  assert.equal(t.db().sheetCache.records.length,1);assert.equal(t.db().sheetCache.records[0].row,20);
});

test('new cache excludes single and duplicate incomplete rows; old cache is cleaned',async()=>{
  const incomplete=[{...record,container:'MSCU1234567',carrier:''},
    {...record,container:'MSCU1234567',mbl:'',carrier:'MSC'},
    {...record,container:'OOCU1234567',carrier:' '}];
  const t=setup({readSheet:async()=>({records:[...incomplete,{...record,carrier:'MSK'}],readAt:1})});
  await t.service.run(record.container,'identify');
  assert.equal(t.db().sheetCache.records.length,1);
  t.db().sheetCache.records.push(...incomplete);
  await t.service.run(record.container,'identify');
  assert.equal(t.db().sheetCache.records.length,1);
});
test('address lists accept common separators, normalize and deduplicate; invalid addresses stop',()=>{
  assert.deepEqual(addressList('A@Example.com; b@example.com，a@example.com\nC@example.com； d@example.com'),['a@example.com','b@example.com','c@example.com','d@example.com']);
  assert.deepEqual(addressList(['A@example.com,b@example.com','a@example.com']),['a@example.com','b@example.com']);
  assert.deepEqual(addressList(''),[]);
  for(const bad of ['me','a@-example.com','a..b@example.com','a@example.com\nBcc: evil@example.com','Name <a@example.com>',[{}]])assert.throws(()=>addressList(bad));
  assert.throws(()=>addressList('',{allowEmpty:false}),/收件邮箱/);
});
test('carrier configuration copies whitelisted fields, fills old defaults, rejects duplicate ids and controls',()=>{
  const input=[{id:'maersk',name:'Maersk',greeting:'MSK',to:TO,cc:CC,unknown:'ignored'}];
  const profiles=normalizeCarriers(input),demurrage=findType(profiles[0],'demurrage');assert.equal(demurrage.bodyTemplate,DEFAULT_BODY_TEMPLATE);assert.equal(demurrage.subjectTemplate,DEFAULT_SUBJECT_TEMPLATE);
  assert.deepEqual(profiles[0].aliases,['MAERSK','MSK','马士基']);assert.deepEqual(profiles[0].mblPrefixes,['MAEU']);assert.ok(!('unknown' in profiles[0]));
  demurrage.to.push('other@example.com');assert.equal(input[0].to,TO);
  assert.equal(normalizeCarriers([DEFAULT_CARRIERS[0],{...DEFAULT_CARRIERS[0],id:'MAERSK'}]).length,1,'same id is one carrier');
  assert.throws(()=>normalizeCarriers([{...DEFAULT_CARRIERS[0],name:'Maersk\nBcc:'}]),/单行/);
  assert.throws(()=>normalizeCarriers([JSON.parse('{"id":"custom","name":"Custom","greeting":"Team","to":[],"__proto__":{}}')]),/不允许/);
});
test('detention is an explicit type with corresponding subject and body',()=>{
  assert.equal(inquiryType(' Detention '),'detention');assert.throws(()=>inquiryType('storage'),/查询类型/);
  const mail=messageTemplate(record,{inquiryType:'detention'});
  assert.equal(mail.subject,`Detention LFD Inquiry - Container#${record.container} MBL#${record.mbl}`);
  assert.equal(mail.question,'Could you please advise the detention LFD for the container below?');assert.ok(mail.html.includes(mail.question));
});
test('a carrier may be saved without recipients but cannot produce an inquiry until configured',()=>{
  const msc=withAllTypes(normalizeCarriers().find(profile=>profile.id==='msc'),{to:[]});
  assert.throws(()=>messageTemplate(record,{carrier:msc}),/收件邮箱/);
  const mail=messageTemplate(record,{carrier:withType(msc,'detention',{to:'one@example.com;two@example.com'}),inquiryType:'detention'});
  assert.deepEqual(mail.to,['one@example.com','two@example.com']);assert.equal(mail.carrierId,'msc');assert.ok(mail.html.startsWith('<p>Dear MSC,</p>'));
});
test('custom templates replace supported tokens and preserve table position and plain body text',()=>{
  const custom={id:'custom',name:'Ocean Team',greeting:'Support',to:['ocean@example.com'],cc:[],bodyTemplate:'Hello {{greeting}},\nFor {{carrier}}, please confirm {{Type}} / {{type}}.\n\n{{table}}\n\nReference {{container}} / {{mbl}}.\nThank you.',subjectTemplate:'{{carrier}} {{Type}} request: {{container}} / {{mbl}}'};
  const mail=messageTemplate(record,{profile:custom,inquiryType:'detention'});
  assert.equal(mail.subject,`Ocean Team Detention request: ${record.container} / ${record.mbl}`);
  assert.ok(mail.html.includes('<br>For Ocean Team, please confirm Detention / detention.'));
  assert.ok(mail.html.indexOf('</table>')<mail.html.indexOf('Reference'));
  assert.ok(mail.bodyText.includes(`Container#\tMBL#\n${record.container}\t${record.mbl}`));assert.ok(mail.bodyText.includes('Thank you.'));
});
test('custom names, greetings and body markup are literal text, never active HTML',()=>{
  const custom={id:'safe',name:'A & B',greeting:'<img src=x onerror="alert(1)">',to:['ocean@example.com'],cc:[],bodyTemplate:'Dear {{greeting}},\n\n<script>bad()</script> {{type}} for {{carrier}}\n\n{{table}}',subjectTemplate:DEFAULT_SUBJECT_TEMPLATE};
  const mail=messageTemplate(record,{carrier:custom});
  assert.ok(mail.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));assert.ok(mail.html.includes('&lt;script&gt;bad()&lt;/script&gt;'));assert.ok(mail.html.includes('A &amp; B'));
  assert.ok(!mail.html.includes('<img'));assert.ok(!mail.html.includes('<script>'));assert.equal((mail.html.match(/<table\b/g)||[]).length,1);
});
test('HTML expansion beyond the Gmail adapter limit fails before returning a usable message',()=>{
  const carrier=withType(DEFAULT_CARRIERS[0],'demurrage',{bodyTemplate:'<'.repeat(6000)+' {{type}} {{table}}'});
  assert.ok(findType(normalizeCarriers([carrier])[0],'demurrage').bodyTemplate.length<10000,'plain text is within the saved-template limit');
  assert.throws(()=>messageTemplate(record,{carrier}),/邮件正文过长/);
});
test('template validation prevents missing table, unknown tokens and subject header injection',()=>{
  const p=DEFAULT_CARRIERS[0];
  for(const bodyTemplate of ['{{type}} no table','{{type}} {{table}} {{table}}','{{type}} {{table}} {{unknown}}','{{type}} {{table}} {{oops'])assert.throws(()=>normalizeCarriers([withType(p,'demurrage',{bodyTemplate})]));
  for(const subjectTemplate of ['{{Type}} {{container}}','{{Type}} {{container}} {{mbl}} {{table}}','{{Type}} {{container}} {{mbl}}\nBcc: bad@example.com'])assert.throws(()=>normalizeCarriers([withType(p,'demurrage',{subjectTemplate})]));
});
test('lookup preserves source carrier text when present without synthesizing it',()=>{
  assert.equal(lookup([{...record,carrier:' 马士基 '}],record.container).carrier,' 马士基 ');
  assert.ok(!Object.hasOwn(lookup([record],record.container),'carrier'));
});
test('automatic recognition uses exact sheet aliases before optional MBL prefix evidence',()=>{
  const fromSheet=recognizeCarrier({...record,carrier:'ｍｓｋ'});assert.equal(fromSheet.carrier.id,'maersk');assert.equal(fromSheet.carrierSource,'sheet');
  const fromPrefix=recognizeCarrier(record);assert.equal(fromPrefix.carrier.id,'maersk');assert.equal(fromPrefix.carrierSource,'mbl-prefix');
  const msc=recognizeCarrier({...record,mbl:'MEDU123456789',carrier:'地中海'});assert.equal(msc.carrier.id,'msc');
  const withoutPrefix=recognizeCarrier({...record,mbl:'276301677',carrier:'Maersk'});assert.equal(withoutPrefix.carrierSource,'sheet');
});
test('unknown sheet names, conflicting sheet/prefix and ambiguous prefixes never silently pick a carrier',()=>{
  assert.throws(()=>recognizeCarrier({...record,carrier:'Unknown carrier'}),/未识别/);
  assert.throws(()=>recognizeCarrier({...record,carrier:'MSC'}),/冲突/);
  assert.throws(()=>recognizeCarrier({...record,mbl:'123456789'}),/无法自动识别/);
  const carriers=[...DEFAULT_CARRIERS,{id:'other',name:'Other',greeting:'Other',to:['other@example.com'],cc:[],mblPrefixes:['MA']}];
  assert.throws(()=>recognizeCarrier(record,carriers),/多个/);
  assert.throws(()=>recognizeCarrier({...record,carrier:'MSK'},carriers),/多个/);
});
// draft/send start a background job; tests wait for it the way the task list does.
function waitForJobs(service){
  const run=async(container,mode,...rest)=>{const started=await service.run(container,mode,...rest);if(!['send','draft'].includes(mode))return started;assert.equal(started.background,true);return service.job(started.requestId);};
  return {...service,run};
}
function setup(overrides={}){
  let db={settings:{account:'me@example.com',gmailIndex:0,extraCc:true,testMode:false},ledger:{}};
  const calls={read:0,prepare:0,send:0};
  const dependencies={storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},readSheet:async()=>{calls.read++;return {records:[record],readAt:Date.now()};},prepareMail:async p=>{calls.prepare++;calls.payload=p;assert.ok(!p.cc.includes('amerihua2606@gmail.com'));return {tabId:8,bodyHash:'hash'};},sendMail:async()=>{calls.send++;return {confirmed:true,evidence:'Message sent'};},uuid:()=> 'test-request',...overrides};
  return {service:waitForJobs(createService(dependencies)),calls,db:()=>db,dependencies};
}

test('identify then draft reuses persisted data even after service restart',async()=>{
  const t=setup();t.db().sheetCache={version:1,key:JSON.stringify([undefined]),records:[{...record,carrier:'MSK'}],readAt:1};await t.service.run(record.container,'identify');
  const restarted=createService(t.dependencies);
  const draft=await restarted.run(record.container,'draft');
  assert.equal(t.calls.read,0);assert.equal(draft.fromCache,true);
  assert.equal(t.calls.prepare,1);assert.equal(t.calls.send,0);
});
test('cache miss refreshes the snapshot and explicit refresh replaces old MBL',async()=>{
  const t=setup();await t.service.run(record.container,'identify');
  await assert.rejects(t.service.run('MSCU1234567','identify'),/未找到/);
  assert.equal(t.calls.read,2);
  t.dependencies.readSheet=async()=>({records:[{...record,mbl:'MAEUNEW123'}],readAt:1234});
  const refreshed=await createService(t.dependencies).run(record.container,'identify',{forceRefresh:true});
  assert.equal(refreshed.mbl,'MAEUNEW123');assert.equal(refreshed.fromCache,false);
});
test('changed document does not reuse the previous document cache',async()=>{
  const t=setup();await t.service.run(record.container,'identify');
  t.db().settings.sheetUrl='https://www.kdocs.cn/l/another';
  await t.service.run(record.container,'identify');assert.equal(t.calls.read,2);
});
test('cached duplicates and blank MBL still block mail',async()=>{
  for(const records of [[record,record],[{...record,mbl:''}]]){
    const t=setup({readSheet:async()=>({records,readAt:1})});
    await assert.rejects(t.service.run(record.container,'identify'));
    await assert.rejects(t.service.run(record.container,'draft'));
    assert.equal(t.calls.prepare,0);
  }
});
test('failed read on a cache miss keeps the existing snapshot for other containers',async()=>{
  const t=setup({readSheet:async()=>({records:[{...record,carrier:'MSK'}],readAt:1})});await t.service.run(record.container,'identify');const before=structuredClone(t.db().sheetCache);
  assert.equal(before.records.length,1);
  const failed=createService({...t.dependencies,readSheet:async()=>{throw new Error('offline');}});
  await assert.rejects(failed.run('ABCU1234567','identify'),/offline/);
  assert.deepEqual(t.db().sheetCache,before);
  assert.equal((await failed.run(record.container,'identify')).mbl,record.mbl);
});
test('failed explicit refresh invalidates old data',async()=>{
  const t=setup();await t.service.run(record.container,'identify');
  const failed=createService({...t.dependencies,readSheet:async()=>{throw new Error('offline');}});
  await assert.rejects(failed.run(record.container,'identify',{forceRefresh:true}),/offline/);
  assert.equal(t.db().sheetCache,null);
  await assert.rejects(failed.run(record.container,'draft'),/offline/);
});
test('confirmed send never reads the sheet and requires manual fields when absent',async()=>{
  const t=setup();
  await assert.rejects(t.service.run(record.container,'draft',{useConfirmed:true}),/先查询/);
  assert.equal(t.calls.read,0);
  const entry=await t.service.run(record.container,'draft',{useConfirmed:true,manualMbl:'MAEU123456',carrierId:'maersk'});
  assert.equal(entry.mbl,'MAEU123456');assert.equal(t.calls.read,0);assert.equal(t.calls.prepare,1);
});
test('preview cannot compose or send',async()=>{const t=setup();await t.service.run(record.container,'preview');assert.equal(t.calls.prepare,0);assert.equal(t.calls.send,0);assert.deepEqual(t.db().ledger,{});});
test('draft preserves lock without sending',async()=>{const t=setup();const e=await t.service.run(record.container,'draft');assert.equal(e.status,'draft');assert.equal(t.calls.send,0);await assert.rejects(t.service.run(record.container,'send'),/已有/);});
test('explicit unknown carrier, empty recipients and invalid inquiry type fail before reading sheet',async()=>{
  for(const options of [{carrierId:'missing'},{carrierId:'carrier-a614893e'},{inquiryType:'invalid'}]){
    const t=setup();await assert.rejects(t.service.run(record.container,'draft',options));assert.equal(t.calls.read,0);assert.equal(t.calls.prepare,0);assert.deepEqual(t.db().ledger,{});
  }
});
test('automatic recognition of a carrier with unconfigured recipients stops before composing',async()=>{
  const t=setup({readSheet:async()=>({records:[{...record,mbl:'MEDU123456789'}],readAt:Date.now()})});
  t.db().settings.carriers=normalizeCarriers().map(p=>p.id==='msc'?withAllTypes(p,{to:[]}):p);
  await assert.rejects(t.service.run(record.container,'draft'),/收件邮箱/);assert.equal(t.calls.prepare,0);assert.deepEqual(t.db().ledger,{});
});
test('identify returns missing configuration for a recognized new carrier without composing or locking',async()=>{
  const t=setup({readSheet:async()=>({records:[{...record,mbl:'OCEAN123456',carrier:'Ocean'}],readAt:Date.now()})});
  t.db().settings.carriers=[...DEFAULT_CARRIERS,{id:'ocean',name:'Ocean',greeting:'Ocean',to:[],cc:[],aliases:[],mblPrefixes:['OCEAN']}];
  const identified=await t.service.run(record.container,'identify');
  assert.equal(identified.carrierId,'ocean');assert.equal(identified.carrierSource,'sheet');assert.deepEqual(identified.configurationMissing,['to','bodyTemplate','subjectTemplate']);
  assert.equal(t.calls.prepare,0);assert.equal(t.calls.send,0);assert.deepEqual(t.db().ledger,{});
  assert.throws(()=>messageTemplate(record,{carrier:t.db().settings.carriers.at(-1)}),/收件邮箱/);
});
test('blank templates may be saved; identifying them reports missing fields but draft generation stops',async()=>{
  const t=setup();t.db().settings.carriers=[withType(DEFAULT_CARRIERS[0],'demurrage',{bodyTemplate:' ',subjectTemplate:''})];
  assert.equal(findType(normalizeCarriers(t.db().settings.carriers)[0],'demurrage').bodyTemplate,'');
  const identified=await t.service.run(record.container,'identify');assert.deepEqual(identified.configurationMissing,['bodyTemplate','subjectTemplate']);
  await assert.rejects(t.service.run(record.container,'draft'),/首次使用/);assert.equal(t.calls.prepare,0);
});
test('identify exposes unknown sheet carrier for first configuration while preview still rejects it',async()=>{
  const t=setup({readSheet:async()=>({records:[{...record,carrier:'New Shipping'}],readAt:Date.now()})});
  const identified=await t.service.run(record.container,'identify');assert.equal(identified.unrecognizedCarrier,'New Shipping');assert.deepEqual(identified.configurationMissing,['carrier']);assert.match(identified.recognitionError,/未识别/);
  await assert.rejects(t.service.run(record.container,'preview'),/未识别/);assert.equal(t.calls.prepare,0);assert.deepEqual(t.db().ledger,{});
});
test('settings defaults and explicit carrier/type choice reach recipient payload and history',async()=>{
  const t=setup();t.db().settings.carriers=normalizeCarriers().map(profile=>profile.id==='msc'?withType(profile,'detention',{to:['first@example.com','second@example.com']}):profile);
  t.db().settings.defaultCarrierId='msc';t.db().settings.defaultInquiryType='detention';
  const entry=await t.service.run(record.container,'draft');
  assert.equal(entry.carrierId,'msc');assert.equal(entry.carrierName,'MSC');assert.equal(entry.carrierSource,'manual');assert.equal(entry.inquiryType,'detention');
  assert.deepEqual(entry.to,['first@example.com','second@example.com']);assert.deepEqual(t.calls.payload.to,entry.to);assert.equal(entry.subject,t.calls.payload.subject);assert.ok(t.calls.payload.bodyText.includes('detention'));
});
test('manual carrier selection can resolve a source conflict and records the override',async()=>{
  const t=setup({readSheet:async()=>({records:[{...record,carrier:'MSC'}],readAt:Date.now()})});
  await assert.rejects(t.service.run(record.container,'preview'),/冲突/);
  const entry=await t.service.run(record.container,'draft',{carrierId:'maersk'});assert.equal(entry.carrierSource,'manual');assert.equal(entry.carrier,'MSC');
});
test('automatic preview records evidence source and fails unknown data rather than falling back to Maersk',async()=>{
  const t=setup();assert.equal((await t.service.run(record.container,'preview')).carrierSource,'mbl-prefix');
  const unknown=setup({readSheet:async()=>({records:[{...record,mbl:'123456789'}],readAt:Date.now()})});
  await assert.rejects(unknown.service.run(record.container,'draft'),/无法自动识别/);assert.equal(unknown.calls.prepare,0);
});
test('extra CC and profile addresses are deduplicated, including across To and CC',async()=>{
  const t=setup();t.db().settings.carriers=[withType(DEFAULT_CARRIERS[0],'demurrage',{to:[TO,CC[0]],cc:[...CC,'AMERIHUA2606@gmail.com','amerihua2606@gmail.com']})];
  const mail=await t.service.run(record.container,'preview');
  assert.deepEqual(mail.to,[TO,CC[0]]);assert.deepEqual(mail.cc,[CC[1],'amerihua2606@gmail.com']);
  t.db().settings.carriers[0].types[0].to.push('amerihua2606@gmail.com');
  assert.ok(!(await t.service.run(record.container,'preview')).cc.includes('amerihua2606@gmail.com'));
});
test('same container allows one draft per inquiry type but prevents repeating either type',async()=>{
  const t=setup();await t.service.run(record.container,'draft',{inquiryType:'demurrage'});await t.service.run(record.container,'draft',{inquiryType:'detention'});
  assert.equal(t.calls.prepare,2);assert.equal(Object.keys(t.db().ledger).length,2);
  for(const type of ['demurrage','detention'])await assert.rejects(t.service.run(record.container,'draft',{inquiryType:type}),/已有/);
});
test('old three-part locks still protect Maersk demurrage while allowing another type',async()=>{
  const t=setup();const oldKey=JSON.stringify(['me@example.com',record.container,record.mbl]);t.db().ledger[oldKey]={...record,status:'draft',account:'me@example.com'};
  await assert.rejects(t.service.run(record.container,'draft'),/已有/);assert.equal(t.calls.prepare,0);
  const entry=await t.service.run(record.container,'draft',{inquiryType:'detention'});assert.equal(entry.inquiryType,'detention');assert.ok(t.db().ledger[oldKey]);
});
test('carrier identity participates in duplicate lock independently of the message wording',async()=>{
  const t=setup();  await t.service.run(record.container,'draft',{carrierId:'maersk'});await t.service.run(record.container,'draft',{carrierId:'msc'});
  assert.equal(t.calls.prepare,2);await assert.rejects(t.service.run(record.container,'draft',{carrierId:'msc'}),/已有/);
});
test('old keeps of test mode no longer hold a send back; the draft button stays a draft',async()=>{
  const t=setup();t.db().settings.testMode=true;const sent=await t.service.run(record.container,'send');assert.equal(sent.status,'sent');assert.equal(t.calls.send,1);
  const d=setup();const draft=await d.service.run(record.container,'draft');assert.equal(draft.status,'draft');assert.equal(d.calls.send,0);
});
test('the sender account takes no part in sending or in the duplicate lock',async()=>{
  const t=setup();delete t.db().settings.account;const entry=await t.service.run(record.container,'send');assert.equal(entry.status,'sent');assert.equal(Object.hasOwn(t.calls.payload,'account'),false);
  await assert.rejects(t.service.run(record.container,'send'),/已有/);
  const legacy=setup();const key=JSON.stringify(['other@example.com',record.container,record.mbl,'maersk','demurrage']);legacy.db().ledger[key]={...record,status:'sent',carrierId:'maersk',inquiryType:'demurrage'};
  await assert.rejects(legacy.service.run(record.container,'send'),error=>error.duplicate?.[0].key===key,'a lock saved with an account in its key still blocks');
});
test('each type has its own recipients and templates; the old shared format converts to one entry per type',()=>{
  const [old]=normalizeCarriers([{id:'old',name:'Old',greeting:'Old',to:['a@example.com'],cc:['b@example.com'],bodyTemplate:'{{type}}\n{{table}}',subjectTemplate:'{{Type}} {{container}} {{mbl}}',onHire:{to:['c@example.com'],cc:[],subjectTemplate:'',bodyTemplate:''}}]);
  assert.deepEqual(old.types.map(type=>[type.id,type.label,type.channel,type.to]),[['demurrage','Demurrage','email',['a@example.com']],['detention','Detention','email',['a@example.com']],['on-hire','On-Hire','email',['c@example.com']]]);
  assert.equal(findType(old,'on-hire').bodyTemplate,ON_HIRE_BODY_TEMPLATE);
  assert.equal(messageTemplate(record,{carrier:old,inquiryType:'detention'}).subject,`Detention ${record.container} ${record.mbl}`);
  const changed=withType(old,'detention',{to:['d@example.com'],subjectTemplate:'Free time {{container}} {{mbl}}'});
  assert.deepEqual(messageTemplate(record,{carrier:changed,inquiryType:'detention'}).to,['d@example.com']);
  assert.deepEqual(messageTemplate(record,{carrier:changed,inquiryType:'demurrage'}).to,['a@example.com'],'the other type is untouched');
});
test('custom types work like the built-in ones, keep their own name and take several containers',async()=>{
  const custom={...newInquiryType('type-exam','Exam Hold'),to:['exam@example.com']};
  const carrier={...normalizeCarriers()[0],types:[...normalizeCarriers()[0].types,custom]};
  assert.deepEqual(custom.cc,CC,'new types start with the default Cc');
  const mail=messageTemplate(record,{carrier,inquiryType:'type-exam',more:[{container:'MSCU1234567',mbl:'MAEU999999999'}]});
  assert.equal(mail.typeLabel,'Exam Hold');assert.match(mail.subject,/^Exam Hold LFD Inquiry/);assert.match(mail.bodyText,/exam hold LFD/);
  assert.throws(()=>inquiryType('type-exam'),/查询类型/);assert.equal(inquiryType('type-exam',[carrier]),'type-exam');
  const t=setup();t.db().settings.carriers=[carrier];
  const entry=await t.service.run(record.container,'draft',{inquiryType:'type-exam'});assert.equal(entry.typeLabel,'Exam Hold');assert.deepEqual(entry.to,['exam@example.com']);
});
test('a new carrier has the three types with the default Cc and no To; a new terminal starts empty',()=>{
  const carrier=newProfile('carrier-x','New Line');
  assert.deepEqual(carrier.types.map(type=>type.id),['demurrage','detention','on-hire']);
  for(const type of carrier.types){assert.deepEqual(type.cc,CC);assert.deepEqual(type.to,[]);assert.ok(type.bodyTemplate);}
  assert.deepEqual(missingConfiguration(normalizeCarriers([carrier])[0],'demurrage'),['to']);
  const terminal=newProfile('terminal-x','PCT',{terminal:true});assert.deepEqual(terminal.types,[]);
  assert.deepEqual(missingConfiguration(normalizeTerminals([terminal])[0],'demurrage'),['type']);
});
test('another carrier\'s website channel falls back to email; COSCO and ONE keep theirs and their recognition data',()=>{
  const defaults=normalizeCarriers(),emc=defaults.find(p=>p.name==='EMC');
  const saved=withType({...emc,chat:{firstName:'LET',lastName:'TANG',email:'service@darwinpacific.com',country:'United States',message:'{{type}} {{container}} {{mbl}}'}},'demurrage',{channel:'one-chat'});
  const [repaired]=normalizeCarriers([saved]);
  assert.equal(findType(repaired,'demurrage').channel,'email');assert.deepEqual(findType(repaired,'demurrage').to,['laxecs@evergreen-shipping.us']);
  assert.equal('chat' in repaired,false,'leftover chat settings go too');assert.deepEqual(repaired.aliases,['EMC','EGL']);
  assert.equal(findType(normalizeCarriers([withType(emc,'detention',{channel:'cosco-portal'})])[0],'detention').channel,'email');
  const one=defaults.find(p=>p.id==='one');assert.deepEqual(one.aliases,['ONE','OCEAN NETWORK EXPRESS']);assert.deepEqual(one.mblPrefixes,['ONEY']);
  assert.equal(findType(one,'demurrage').channel,'one-chat');assert.equal(findType(defaults.find(p=>p.id==='cosco'),'detention').channel,'cosco-portal');
  assert.deepEqual(channelsFor('one'),['email','one-chat']);assert.deepEqual(channelsFor('cosco'),['email','cosco-portal']);assert.deepEqual(channelsFor('carrier-x'),['email']);
});
test('duplicate carriers saved by older versions collapse to the configured entry and keep every alias',()=>{
  const blank={id:'carrier-1',name:'H M M',greeting:'HMM',to:[],cc:[],aliases:['HMM21'],mblPrefixes:['HDMU']};
  const filled={id:'carrier-2',name:'HMM',greeting:'HMM',to:['hmm@example.com'],cc:[],aliases:['HMM'],mblPrefixes:[],bodyTemplate:DEFAULT_BODY_TEMPLATE,subjectTemplate:DEFAULT_SUBJECT_TEMPLATE};
  const result=normalizeCarriers([blank,filled]);
  assert.equal(result.length,1);assert.equal(result[0].id,'carrier-2');assert.deepEqual(result[0].aliases,['HMM','HMM21']);assert.deepEqual(result[0].mblPrefixes,['HDMU']);
});
test('terminal mode uses its own list, never recognizes from the sheet, and locks like a carrier',async()=>{
  const terminal={...newProfile('terminal-pct','PCT',{terminal:true}),types:[{...newInquiryType('type-appt','Appointment'),to:['pct@example.com']}]};
  const t=setup();t.db().settings.terminals=[terminal];t.db().settings.mode='terminal';
  const unset=await t.service.run(record.container,'identify');assert.deepEqual(unset.configurationMissing,['carrier']);assert.match(unset.recognitionError,/码头/);
  await assert.rejects(t.service.run(record.container,'draft'),/码头/);
  await assert.rejects(t.service.run(record.container,'draft',{carrierId:'maersk'}),/码头不存在/);
  const identified=await t.service.run(record.container,'identify',{carrierId:'terminal-pct'});assert.equal(identified.inquiryType,'type-appt','falls to the terminal\'s own type');assert.deepEqual(identified.configurationMissing,[]);
  const entry=await t.service.run(record.container,'draft',{carrierId:'terminal-pct',inquiryType:'type-appt'});
  assert.equal(entry.carrierName,'PCT');assert.deepEqual(entry.to,['pct@example.com']);
  await assert.rejects(t.service.run(record.container,'draft',{carrierId:'terminal-pct',inquiryType:'type-appt'}),/已有/);
  await assert.rejects(t.service.run(record.container,'draft',{carrierId:'terminal-pct',inquiryType:'detention'}),/没有配置/);
});
test('parallel duplicate requests produce only one transmission',async()=>{const t=setup();const results=await Promise.allSettled([t.service.run(record.container,'send'),t.service.run(record.container,'send')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(t.calls.send,1);});
test('uncertain send remains locked after worker recreation',async()=>{
  const t=setup({sendMail:async()=>{throw new Error('tab closed');}});
  await assert.rejects(t.service.run(record.container,'send'),/待核实/);
  assert.equal(Object.values(t.db().ledger)[0].status,'uncertain');
  const fresh=createService(t.dependencies);await assert.rejects(fresh.run(record.container,'send'),/已有/);
});
test('missing success evidence cannot be reported sent',async()=>{const t=setup({sendMail:async()=>({confirmed:false})});await assert.rejects(t.service.run(record.container,'send'),/待核实/);});
test('preparation failure prevents sending',async()=>{const t=setup({prepareMail:async()=>{throw new Error('签名缺失');}});await assert.rejects(t.service.run(record.container,'send'),/签名/);assert.equal(t.calls.send,0);});
test('unlock archives original record',async()=>{const t=setup();await t.service.run(record.container,'draft');const key=Object.keys(t.db().ledger)[0];await t.service.release(key);assert.equal(t.db().archive.length,1);assert.deepEqual(t.db().ledger,{});});
test('AirScript reads named sheet, skips cancelled section, emits complete chunks, never writes',()=>{
  const source=readFileSync(new URL('../airscript/LFD_ReadOnly.js',import.meta.url),'utf8');
  const rows=[['MBL','柜号'],['MAEU123456','MRSU4786640'],['','ABCU1234567'],['取消DO',''],['MAEU999999','ZZZU9999999']];
  const copy=structuredClone(rows);const logs=[];
  const sheet={UsedRange:{Row:1,Column:1,Rows:{Count:rows.length},Columns:{Count:2}},Cells:(r,c)=>({r,c}),Range:(a,b)=>({get Value2(){return rows.slice(a.r-1,b.r).map(row=>row.slice(a.c-1,b.c));}})};
  vm.runInNewContext(source,{Application:{Sheets:name=>{assert.equal(name,'提柜');return sheet;}},console:{log:x=>logs.push(x)},Date});
  assert.deepEqual(rows,copy);
  const meta=JSON.parse(logs.find(x=>x.startsWith('LFD_START:')).slice(10));assert.equal(meta.count,2);assert.equal(meta.cancelledSections,1);
  const chunk=JSON.parse(logs.find(x=>x.startsWith('LFD_CHUNK:')).slice(10));assert.equal(chunk.rows[1][1],'');assert.ok(logs.at(-1).startsWith('LFD_END:'));assert.ok(logs.every(x=>x.length<1000));
});

test('concurrent cache misses share one sheet read',async()=>{
  let reads=0,release;const gate=new Promise(r=>release=r);
  const other={container:'ABCU1234567',mbl:'MAEU999999999',row:400,carrier:'MSK'};
  const t=setup({readSheet:async()=>{reads++;await gate;return {records:[{...record,carrier:'MSK'},other],readAt:1};}});
  const a=t.service.run(record.container,'identify'),b=t.service.run(other.container,'identify');
  await new Promise(r=>setTimeout(r,10));release();
  const [ra,rb]=await Promise.all([a,b]);
  assert.equal(reads,1);assert.equal(ra.mbl,record.mbl);assert.equal(rb.mbl,other.mbl);
});

test('a lookup is not blocked by a background send that is still running',async()=>{
  let release;const gate=new Promise(r=>release=r);
  const other={container:'ABCU1234567',mbl:'MAEU999999999',row:400,carrier:'MSK'};
  const t=setup({readSheet:async()=>({records:[{...record,carrier:'MSK'},other],readAt:1}),prepareMail:async()=>{await gate;return {tabId:8,bodyHash:'h'};}});
  const raw=createService({...t.dependencies,prepareMail:async()=>{await gate;return {tabId:8,bodyHash:'h'};}});
  await raw.run(record.container,'identify');
  const started=await raw.run(record.container,'send');
  assert.equal(started.background,true);assert.equal(started.running,true);
  const lookup=await raw.run(other.container,'identify');
  assert.equal(lookup.mbl,other.mbl,'lookup finished while the send job waits');
  release();await raw.job(started.requestId);
});
