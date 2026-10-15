import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const original=readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const imports=original.match(/^import .*;\r?$/gm)||[];
assert.equal(imports.length,6,'Update the isolated worker harness if its imports change.');
const source=original.replace(/^import .*;\r?$/gm,'');
const appUrl='chrome-extension://test-extension/app.html';
const sender={id:'test-extension',url:appUrl};
const clone=value=>structuredClone(value);
const defaults={sheetUrl:'https://www.kdocs.cn/l/example',account:'test@example.com',gmailIndex:0,testMode:true};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(predicate){
  for(let i=0;i<30;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}
  assert.fail('Worker did not reach the expected observable state.');
}

function setup({data={},run=async()=>({status:'draft',tabId:42}),read=async value=>value,tabs=[],scriptError=null}={}){
  let db={settings:{...defaults},ledger:{},...clone(data)},listener,deps,id=0;
  const calls={fetched:[],run:[],release:[],writes:[],created:[],updated:[],queries:[],scripts:[],access:[],removed:[]};
  const tabMap=new Map(tabs.map(tab=>[tab.id,clone(tab)]));
  const readKdocsPage=()=>{},gmailPage=()=>{},coscoPage=()=>{},onePage=()=>{};
  const chrome={
    storage:{local:{
      setAccessLevel:async value=>{calls.access.push(clone(value));},
      get:async keys=>read(Object.fromEntries(keys.filter(key=>Object.hasOwn(db,key)).map(key=>[key,clone(db[key])])),keys),
      set:async value=>{const saved=clone(value);calls.writes.push(saved);db={...db,...saved};}
    }},
    runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{
      remove:async tabId=>{calls.removed.push(tabId);tabMap.delete(tabId);},
      query:async options=>{calls.queries.push(clone(options));return [...tabMap.values()].filter(tab=>tab.url?.startsWith('https://www.kdocs.cn/')).map(clone);},
      create:async options=>{calls.created.push(clone(options));const tab={id:100+calls.created.length,status:'complete',...options};tabMap.set(tab.id,tab);return clone(tab);},
      get:async tabId=>{if(!tabMap.has(tabId))throw new Error('Tab no longer exists');return clone(tabMap.get(tabId));},
      update:async(tabId,options)=>{calls.updated.push({tabId,...clone(options)});const tab={...tabMap.get(tabId),...options};tabMap.set(tabId,tab);return clone(tab);}
    },
    scripting:{executeScript:async args=>{
      if(scriptError)throw new Error(scriptError);
      calls.scripts.push({tabId:args.target.tabId,page:args.func===readKdocsPage?'kdocs':'gmail',args:clone(args.args)});
      return [{result:{ok:true,data:args.func===readKdocsPage?{records:[],readAt:123}:{bodyHash:'unchanged-signature',confirmed:true}}}];
    }}
  };
  vm.runInNewContext(source,{
    chrome,URL,URLSearchParams,Date,setTimeout,fetch:async url=>{calls.fetched.push(url);return {text:async()=>'// LFD build: 3\nmain();'};},
    crypto:{randomUUID:()=>`operation-${++id}`},readKdocsPage,gmailPage,coscoPage,onePage,
    validateSettings:value=>({...defaults,...clone(value)}),
    createService:dependencies=>{deps=dependencies;return {active:()=>new Set(),
      run:async(...args)=>{calls.run.push(clone(args));return run(...args);},
      release:async key=>{calls.release.push(key);return true;}
    };}
  },{filename:'worker.js'});
  function send(message,{from=sender,ignoreResponse=false}={}){
    let resolve;const response=new Promise(yes=>{resolve=yes;});
    const accepted=listener(message,from,value=>{if(!ignoreResponse)resolve(clone(value));});
    return {accepted,response};
  }
  return {send,calls,deps,db:()=>clone(db),removeTab:tabId=>chrome.tabs.remove(tabId),updateTab:(tabId,options)=>chrome.tabs.update(tabId,options)};
}

test('lookup persists running before work and completes after popup response is ignored',async()=>{
  const gate=deferred();let t;
  t=setup({run:async()=>{assert.equal(t.db().operation.status,'running');return gate.promise;}});
  const submitted=t.send({type:'run',container:'MRSU4786640',mode:'draft',options:{carrierId:'auto'}},{ignoreResponse:true});
  assert.equal(submitted.accepted,true);
  await until(()=>t.calls.run.length===1);
  assert.equal(t.db().operation.status,'running');
  assert.equal(t.db().operation.container,'MRSU4786640');
  assert.deepEqual(t.db().operation.options,{carrierId:'auto'});
  gate.resolve({status:'draft',tabId:42,carrierId:'maersk'});
  await until(()=>t.db().operation.status==='complete');
  assert.deepEqual(t.db().operation.result,{status:'draft',tabId:42,carrierId:'maersk'});
  const reopened=await t.send({type:'state'}).response;
  assert.equal(reopened.ok,true);assert.equal(reopened.data.operation.status,'complete');
  assert.equal(t.calls.run.length,1,'Reopening reads persisted state without retrying the job.');
  assert.deepEqual(t.calls.access,[{accessLevel:'TRUSTED_CONTEXTS'}]);
});

test('lookups run concurrently; the newest operation is the one a reopened popup restores',async()=>{
  const gates={MRSU4786640:deferred(),MSCU1234567:deferred()};
  const t=setup({run:container=>gates[container].promise});
  const first=t.send({type:'run',container:'MRSU4786640',mode:'identify'});
  await until(()=>t.calls.run.length===1);
  const second=t.send({type:'run',container:'MSCU1234567',mode:'identify'});
  await until(()=>t.calls.run.length===2);
  assert.equal(t.db().operation.container,'MSCU1234567');
  gates.MSCU1234567.resolve({mbl:'B'});assert.equal((await second.response).ok,true);
  gates.MRSU4786640.resolve({mbl:'A'});assert.equal((await first.response).ok,true);
  assert.equal(t.db().operation.container,'MSCU1234567','an older operation finishing later must not replace the newest');
  assert.deepEqual(t.db().operation.result,{mbl:'B'});
  const state=await t.send({type:'state'}).response;assert.equal(state.data.operation.status,'complete');
});

test('failure persists its error for a reopened popup and permits a later operation',async()=>{
  let attempt=0;
  const t=setup({run:async()=>{if(!attempt++)throw new Error('提柜表未加载');return {status:'preview'};}});
  const failed=await t.send({type:'run',container:'MRSU4786640',mode:'preview'}).response;
  assert.equal(failed.ok,false);assert.equal(failed.error,'提柜表未加载');
  assert.equal(t.db().operation.status,'failed');assert.equal(t.db().operation.error,'提柜表未加载');
  const reopened=await t.send({type:'state'}).response;
  assert.equal(reopened.data.operation.status,'failed');
  const retried=await t.send({type:'run',container:'MRSU4786640',mode:'preview'}).response;
  assert.equal(retried.ok,true);assert.equal(t.db().operation.status,'complete');
});

test('restarting a worker marks a previously running job interrupted without replaying it',async()=>{
  const t=setup({data:{operation:{id:'old-operation',status:'running',container:'MRSU4786640',mode:'draft',time:1}}});
  const state=await t.send({type:'state'}).response;
  assert.equal(state.ok,true);assert.equal(state.data.operation.status,'interrupted');
  assert.match(state.data.operation.error,/核对.*Gmail 草稿/);
  assert.equal(t.db().operation.status,'running','Recovery is a read-time interpretation, so it cannot overwrite a later result.');
  assert.equal(t.calls.run.length,0);assert.deepEqual(t.db().ledger,{});assert.deepEqual(t.calls.writes,[]);
  const writes=t.calls.writes.length;
  const repeated=await t.send({type:'state'}).response;
  assert.equal(repeated.data.operation.status,'interrupted');
  assert.equal(t.calls.writes.length,writes,'Recovery polling never writes operation history.');
});

test('a delayed state read cannot overwrite a job that finished while its running snapshot was in flight',async()=>{
  const runGate=deferred(),readGate=deferred(),captured=deferred();let snapshot;
  const t=setup({run:()=>runGate.promise,read:async(value,keys)=>{
    if(keys.includes('operation')&&value.operation?.status==='running'){
      snapshot=value;captured.resolve();return readGate.promise;
    }
    return value;
  }});
  const job=t.send({type:'run',container:'MRSU4786640',mode:'draft'});
  await until(()=>t.calls.run.length===1);
  const state=t.send({type:'state'});
  await captured.promise;
  runGate.resolve({status:'draft'});await job.response;
  assert.equal(t.db().operation.status,'complete');
  readGate.resolve(snapshot);
  const result=await state.response;
  assert.equal(result.ok,true);
  assert.notEqual(result.data.operation.status,'interrupted');
  assert.equal(t.db().operation.status,'complete','A stale popup read must not overwrite the persisted completed result.');
});

test('recovery of an old job cannot overwrite a newer job completed during the state read',async()=>{
  const readGate=deferred(),captured=deferred();let snapshot;
  const t=setup({
    data:{operation:{id:'orphaned-operation',status:'running',container:'MSCU1234567',mode:'draft'}},
    read:async(value,keys)=>{
      if(keys.includes('operation')&&value.operation?.id==='orphaned-operation'){
        snapshot=value;captured.resolve();return readGate.promise;
      }
      return value;
    }
  });
  const state=t.send({type:'state'});await captured.promise;
  const next=await t.send({type:'run',container:'MRSU4786640',mode:'draft'}).response;
  assert.equal(next.ok,true);
  const completed=t.db().operation;
  assert.equal(completed.status,'complete');assert.notEqual(completed.id,'orphaned-operation');
  readGate.resolve(snapshot);await state.response;
  assert.deepEqual(t.db().operation,completed,'Recovery must not overwrite a newer query result.');
});

test('sheet and compose adapters create background tabs and preserve recipients in the compose URL',async()=>{
  const t=setup();
  const sheet=await t.deps.readSheet(defaults);
  assert.deepEqual(clone(sheet),{records:[],readAt:123});
  const payload={gmailIndex:2,to:['lfd@example.com','operations@example.com'],cc:['cc@example.com'],subject:'Detention LFD - MRSU4786640'};
  const prepared=await t.deps.prepareMail(payload);
  assert.equal(t.calls.created.length,2);
  assert.ok(t.calls.created.every(tab=>tab.active===false));
  const url=new URL(t.calls.created[1].url);
  assert.equal(url.origin,'https://mail.google.com');assert.equal(url.pathname,'/mail/u/2/');
  assert.equal(url.searchParams.get('to'),payload.to.join(','));
  assert.equal(url.searchParams.get('cc'),payload.cc.join(','));
  assert.equal(url.searchParams.get('su'),payload.subject);
  assert.equal(prepared.tabId,102);assert.equal(prepared.bodyHash,'unchanged-signature');
  assert.deepEqual(t.calls.updated,[],'Lookup never activates tabs and closes the popup.');
  assert.deepEqual(t.calls.scripts.map(call=>call.page),['kdocs','gmail']);
  assert.equal(t.calls.scripts[1].args[0],'prepare');
});

test('lookup owns and closes a background tab without touching existing KDocs tabs',async()=>{
  const t=setup({tabs:[{id:7,status:'complete',url:defaults.sheetUrl}]});
  await t.deps.readSheet(defaults);
  assert.deepEqual(t.calls.created,[{url:defaults.sheetUrl,active:false}]);assert.deepEqual(t.calls.updated,[]);
  assert.equal(t.calls.scripts[0].tabId,101);
  assert.deepEqual(t.calls.fetched,['chrome-extension://test-extension/airscript/LFD_ReadOnly.js']);
  assert.deepEqual(t.calls.scripts[0].args,[{name:'LFD_ReadOnly_v1',code:'// LFD build: 3\nmain();',build:3}],'bundled script and build reach the page adapter');
  assert.deepEqual(t.calls.removed,[101]);assert.deepEqual(t.calls.queries,[]);
});

test('failed lookup closes only its temporary tab and preserves the original error',async()=>{
  const t=setup({tabs:[{id:7,status:'complete',url:defaults.sheetUrl}],scriptError:'editor unavailable'});
  await assert.rejects(t.deps.readSheet(defaults),/editor unavailable/);
  assert.deepEqual(t.calls.removed,[101]);assert.deepEqual(t.calls.updated,[]);
});

test('openDraft activates only a recorded draft tab still on Gmail',async()=>{
  const t=setup({
    data:{ledger:{draft:{tabId:42,status:'draft'},sent:{tabId:43,status:'sent'},changed:{tabId:44,status:'draft'}}},
    tabs:[{id:42,url:'https://mail.google.com/mail/u/0/?view=cm'},{id:43,url:'https://mail.google.com/mail/u/0/#sent'},{id:44,url:'https://mail.google.com.evil.example/'}]
  });
  assert.equal((await t.send({type:'openDraft',tabId:42}).response).ok,true);
  assert.deepEqual(t.calls.updated,[{tabId:42,active:true}]);
  for(const tabId of [43,99,'42']){
    const denied=await t.send({type:'openDraft',tabId}).response;
    assert.equal(denied.ok,false);assert.match(denied.error,/不在插件记录/);
  }
  const changed=await t.send({type:'openDraft',tabId:44}).response;
  assert.equal(changed.ok,false);assert.match(changed.error,/标签页已变更/);
  assert.equal(t.calls.updated.length,1);
});

test('settings cannot change during a job and are allowed after it finishes',async()=>{
  const gate=deferred(),t=setup({run:()=>gate.promise});
  const job=t.send({type:'run',container:'MRSU4786640',mode:'draft'});
  const rejected=await t.send({type:'settings',settings:{account:'changed@example.com'}}).response;
  assert.equal(rejected.ok,false);assert.match(rejected.error,/查询完成/);
  assert.equal(t.db().settings.account,'test@example.com');
  gate.resolve({status:'draft'});await job.response;
  const saved=await t.send({type:'settings',settings:{account:'changed@example.com'}}).response;
  assert.equal(saved.ok,true);assert.equal(t.db().settings.account,'changed@example.com');
});

test('messages from another extension or page are refused before any work or storage access',async()=>{
  const t=setup();
  for(const from of [
    {id:'other-extension',url:appUrl},
    {id:'test-extension',url:'https://mail.google.com/'},
    {id:'test-extension',url:`${appUrl}?other=1`},
    {id:'test-extension',url:'chrome-extension://test-extension/other.html'}
  ])assert.equal(t.send({type:'run',container:'MRSU4786640',mode:'draft'},{from}).accepted,false);
  assert.deepEqual(t.calls.run,[]);assert.deepEqual(t.calls.writes,[]);assert.deepEqual(t.calls.created,[]);
});

test('clear cache preserves settings, ledger and archive and refuses during a job',async()=>{
  const gate=deferred();
  const t=setup({data:{sheetCache:{records:[{container:'MRSU4786640'}]},ledger:{saved:{status:'sent'}},archive:[{status:'draft'}],operation:{status:'complete'}},run:()=>gate.promise});
  const before=t.db();
  assert.equal((await t.send({type:'clearCache'}).response).ok,true);
  assert.equal(t.db().sheetCache,null);assert.equal(t.db().operation,null);
  assert.deepEqual(t.db().settings,before.settings);assert.deepEqual(t.db().ledger,before.ledger);assert.deepEqual(t.db().archive,before.archive);
  const job=t.send({type:'run',container:'MRSU4786640',mode:'identify'});
  await until(()=>t.calls.run.length===1);
  assert.equal((await t.send({type:'clearCache'}).response).ok,false);
  gate.resolve({});await job.response;
});

test('send is confirmed only after Gmail closes its own compose tab',async()=>{
  const t=setup({tabs:[{id:42,url:'https://mail.google.com/mail/u/0/?view=cm'}]});
  let settled=false;
  const sending=t.deps.sendMail({tabId:42,bodyHash:'hash'},{requestId:'r'}).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.equal(settled,false,'A toast alone must not mark the message sent while the compose tab is still open.');
  await t.removeTab(42);
  assert.deepEqual(await sending,{bodyHash:'unchanged-signature',confirmed:true});
  assert.equal(t.calls.scripts.at(-1).args[0],'send');
});

test('COSCO submit waits for the post-submit page and reports the ticket',async()=>{
  const t=setup({tabs:[{id:9,status:'complete',url:'https://support.cosco-usa.com/support/tickets/new'}]});
  const submitting=t.deps.submitTicket({tabId:9},{requestId:'r'});
  await until(()=>t.calls.scripts.length===1);
  assert.deepEqual(t.calls.scripts.map(s=>s.args[0]),['submit']);
  await t.updateTab(9,{url:'https://support.cosco-usa.com/support/tickets/123456'});
  const result=await submitting;
  assert.equal(result.confirmed,true);
  assert.deepEqual(t.calls.scripts.map(s=>s.args[0]),['submit','result']);
});

test('COSCO submit errors raised in the page are marked as not submitted',async()=>{
  const t=setup({tabs:[{id:9,status:'complete',url:'https://support.cosco-usa.com/support/tickets/new'}],scriptError:'等待人机验证超时'});
  await assert.rejects(t.deps.submitTicket({tabId:9},{requestId:'r'}),error=>error.notTransmitted===true);
});

test('COSCO ticket tab opens in front only when it will be submitted',async()=>{
  const t=setup();
  await t.deps.prepareTicket({submit:false});await t.deps.prepareTicket({submit:true});
  assert.deepEqual(t.calls.created.map(c=>[c.url,c.active]),[['https://support.cosco-usa.com/support/tickets/new',false],['https://support.cosco-usa.com/support/tickets/new',true]]);
  assert.deepEqual(t.calls.scripts.map(s=>s.args[0]),['fill','fill']);
});

test('state shows a background job lost by a worker restart as interrupted, without changing storage',async()=>{
  const t=setup({data:{ledger:{k:{container:'TRHU6206940',status:'sending',running:true,requestId:'gone',step:'等待客服接入'}}}});
  const state=(await t.send({type:'state'}).response).data;
  assert.equal(state.ledger.k.interrupted,true);assert.equal(state.ledger.k.running,false);assert.match(state.ledger.k.detail,/中断/);
  assert.equal(t.db().ledger.k.running,true,'the stored entry is left for the user to verify');
});
