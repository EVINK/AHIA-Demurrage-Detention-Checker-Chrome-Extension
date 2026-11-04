// @ts-nocheck
// Experimental 查柜 (container check), steps 1–3 of the owner's manual process:
//   1. run the 提柜表's shared AirScript 「ListA_Push 推送Available V2」, which writes the list to the template's
//      Available V2 sheet, then read the containers back from Available V2 with the read-only TH_ReadV2 script;
//   2. keep the list and per-container history in chrome.storage.local (`chaguiCache`);
//   3. open Dray Dog in a background tab and check the sign-in; when signed out, bring the login page forward.
// Progress is stored in `chaguiRun`, which the 实验性功能 page follows through storage.onChanged.
import {airScriptPage} from '../injected/airscript.ts';
import {draydogPage} from '../injected/draydog.ts';
import {observe,parseBaseline,plan,statusWords,SHOWN,unknownHolds,validHoldRules} from '../core/chagui-rules.ts';

export const PICKUP_URL='https://www.kdocs.cn/l/ce3LmgRtHK2F';
export const TEMPLATE_URL='https://www.kdocs.cn/l/cl7RhcdagjJs';
export const DRAYDOG_URL='https://app.draydog.com/';
const PUSH_TITLE='ListA_Push';
const READ_TITLE='TH_ReadV2';
const LOGIN_WAIT=10*60000;      // how long the Dray Dog login page waits for the user

export const STEPS=[
  ['push','运行 ListA_Push，更新 Available V2'],
  ['read','从 Available V2 读取柜号'],
  ['cache','写入查柜缓存'],
  ['draydog','打开 Draydog 并检查登录'],
  ['track','未追踪的柜子 Start Tracking'],
  ['status','读取 Draydog 状态'],
  ['baseline','读取提柜表'],
  ['plan','计算要改的格子和要移动的行'],
  ['apply','写入提柜表'],
  ['verify','重新读取并复核'],
  ['save','保存缓存和本轮记录']
];
// The owner approved Start Tracking (11/3), so a preview tracks too; it never writes the sheet.
export const PREVIEW_STEPS=['push','read','cache','draydog','track','status','baseline','plan','save'];
const pause=ms=>new Promise(r=>setTimeout(r,ms));

// The cache follows the owner's existing 查柜 cache (schemaVersion 1, built by the manual agent runs), so that file
// imports as is. Per container: inLatestTemplate, lastObservedStatus (Dray Dog), lastVerifiedApplied (what was written
// to the 提柜表 and verified), position (G/H), pendingReview. Row numbers are hints only, never identity.
export const POSITION_RULES={Decked:['Deck','OWN'],WheeledOrWMarker:['Wheeled','POOL'],NoDeckedOrWheeledEvidence:['Ground','OWN'],
  sources:'Inspect Availability terminal and secondary/tertiary source location fields; top-level Grounded does not override detailed Decked.'};
const POLICY='Refresh live source status; compare by exact container ID and source/target fields; write or move only changed records; never use saved row number as identity; unknown individual statuses stay null.';
const KEEP_RUN_RECORDS=200;
export function emptyCache(){
  return {schemaVersion:1,updatedAt:null,timezone:'America/Los_Angeles',templateUrl:TEMPLATE_URL,pickupUrl:PICKUP_URL,policy:POLICY,runs:[],containers:{},positionRules:POSITION_RULES};
}
const isCache=value=>value&&typeof value==='object'&&value.schemaVersion===1&&value.containers&&typeof value.containers==='object'&&!Array.isArray(value.containers);

/** Marks this run's list in the cache. Records of containers off the list stay as history. */
export function mergeCache(cache,list,now=Date.now()){
  const previous=isCache(cache)?cache:emptyCache();
  const containers={...previous.containers};
  const before=new Set(Object.entries(containers).filter(([,entry])=>entry?.inLatestTemplate).map(([id])=>id));
  const current=new Set(list.containers.map(c=>c.container));
  for(const [id,entry] of Object.entries(containers))if(entry?.inLatestTemplate&&!current.has(id))containers[id]={...entry,inLatestTemplate:false};
  for(const {container,terminal} of list.containers){
    const old=containers[container]||{lastObservedStatus:null,lastVerifiedApplied:null};
    containers[container]={...old,inLatestTemplate:true,templateTerminal:terminal,firstListedAt:old.firstListedAt||new Date(now).toISOString(),lastListedAt:new Date(now).toISOString()};
  }
  const added=[...current].filter(c=>!before.has(c)),removed=[...before].filter(c=>!current.has(c));
  const run={timestamp:new Date(now).toISOString(),source:'Trucker Helper',scope:'list',searchedCount:current.size,newlyListed:added,droppedFromList:removed,listStamp:list.stamp||''};
  return {cache:{...emptyCache(),...previous,updatedAt:new Date(now).toISOString(),list,containers,runs:[...(previous.runs||[]),run].slice(-KEEP_RUN_RECORDS)},added,removed};
}

/** Takes in a cache file from the manual runs. Its records win; the plugin's latest list keeps its flags. */
export function importCache(current,text){
  if(typeof text!=='string'||!text.trim())throw new Error('请粘贴缓存 JSON。');
  if(text.length>20*1024*1024)throw new Error('缓存文件过大。');
  let data;try{data=JSON.parse(text);}catch{throw new Error('缓存不是有效的 JSON。');}
  if(!isCache(data))throw new Error('这不是查柜缓存（需要 schemaVersion 1 和 containers）。');
  const ids=Object.keys(data.containers);
  if(ids.some(id=>!/^[A-Z]{4}\d{7}$/.test(id)))throw new Error('缓存中有无效柜号。');
  let merged={...emptyCache(),...data,runs:Array.isArray(data.runs)?data.runs:[],positionRules:data.positionRules||POSITION_RULES};
  // A list read by the plugin after the file was written stays the latest one.
  if(isCache(current)&&current.list&&(!data.updatedAt||current.list.readAt>Date.parse(data.updatedAt))){
    merged=mergeCache({...merged,containers:Object.fromEntries(Object.entries(merged.containers).map(([id,e])=>[id,{...e,inLatestTemplate:false}]))},current.list,current.list.readAt).cache;
  }
  return {cache:merged,count:ids.length};
}

/** Container count written by ListA_Push, from its log line "List A 已写入：… | 363 柜". */
export const pushedCount=line=>{const m=String(line).match(/\|\s*(\d+)\s*柜\s*$/);return m?Number(m[1]):null;};

export function createChagui({execute,loaded,notify,focusTab}){
  let active=null;
  const get=async()=>(await chrome.storage.local.get('chaguiRun')).chaguiRun||null;
  const save=run=>chrome.storage.local.set({chaguiRun:{...run,updatedAt:Date.now()}});
  async function state(){
    const {chaguiRun:run=null,chaguiCache:cache=null}=await chrome.storage.local.get(['chaguiRun','chaguiCache']);
    // The worker stopped (browser closed, extension reloaded) in the middle of a run.
    // A run lives only in this worker's memory: one this worker is not running is dead.
    if(['running','waiting'].includes(run?.status)&&active!==run.id){
      const stopped={...run,status:'error',error:'查柜被中断（浏览器或插件重启），请重新运行。',steps:run.steps.map(s=>s.status==='running'?{...s,status:'error'}:s),pending:undefined};
      await save(stopped);return {run:stopped,cache:summary(cache)};
    }
    return {run,cache:summary(cache)};
  }
  const summary=cache=>{
    if(!isCache(cache))return null;
    const records=Object.values(cache.containers);
    const listed=cache.list?.containers||Object.entries(cache.containers).filter(([,e])=>e?.inLatestTemplate).map(([container,e])=>({container,terminal:e.templateTerminal||e.lastObservedStatus?.terminal||'Other'}));
    return {readAt:cache.list?.readAt||Date.parse(cache.updatedAt)||0,stamp:cache.list?.stamp||'',count:listed.length,
      byTerminal:Object.entries(listed.reduce((acc,c)=>(acc[c.terminal]=(acc[c.terminal]||0)+1,acc),{})),containers:listed,
      known:records.length,verified:records.filter(e=>e?.lastVerifiedApplied).length,observed:records.filter(e=>e?.lastObservedStatus).length,runs:cache.runs.length,
      // Read-only view: this list's Appointed and Bookable containers as Dray Dog last showed them.
      ready:listed.map(({container})=>({container,status:cache.containers[container]?.lastObservedStatus})).filter(e=>['Appointed','Bookable'].includes(e.status?.category))
        .map(({container,status:s})=>({container,category:s.category,terminal:s.terminal,holds:s.holds,lfd:s.lineCheck?'':(s.lfd||''),lineLfd:s.lineLfd||s.noteLfd||'',appointment:s.appointmentDateTime||'',position:s.position||'',available:s.availableForPickup,observedRun:s.observedRun}))};
  };
  async function importFile(text){
    if(active)throw new Error('查柜进行中，请完成后再导入。');
    const {chaguiCache}=await chrome.storage.local.get('chaguiCache');
    const {cache,count}=importCache(chaguiCache,text);
    await chrome.storage.local.set({chaguiCache:cache});
    return {count};
  }
  const exportFile=async()=>(await chrome.storage.local.get('chaguiCache')).chaguiCache||emptyCache();

  async function withTab(url,origin,work){
    const tab=await chrome.tabs.create({url,active:false});
    try{await loaded(tab.id,origin);return await work(tab.id);}
    finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
  }

  /** apply=false: preview — everything up to the plan, no sheet writes and no Start Tracking. */
  // retry: after a failed run, start again from the failed step. Finished steps 1–2 are reused (the list
  // pushed and read back); everything from Dray Dog on runs again, since it is quick and must be fresh.
  async function start({apply=false,retry=false}={}){
    if(active)throw new Error('查柜正在进行中。');
    let resume=null;
    if(retry){
      const {chaguiRun:previous,chaguiCache:cache}=await chrome.storage.local.get(['chaguiRun','chaguiCache']);
      if(previous?.status!=='error')throw new Error('没有可重试的失败步骤。');
      apply=Boolean(previous.apply);
      const stepOf=key=>previous.steps.find(s=>s.key===key);
      const done=key=>stepOf(key)?.status==='done';
      if(done('push'))resume={push:stepOf('push')};
      if(done('push')&&done('read')&&done('cache')&&cache?.list?.readAt>=previous.startedAt)resume={...resume,read:stepOf('read'),cache:stepOf('cache'),list:cache.list};
    }
    const keys=apply?STEPS.map(s=>s[0]):PREVIEW_STEPS;
    const run={id:Date.now().toString(36),status:'running',apply,retry,startedAt:Date.now(),steps:STEPS.filter(([key])=>keys.includes(key)).map(([key,label])=>({key,label,status:resume?.[key]?'done':'waiting',detail:resume?.[key]?resume[key].detail:''}))};
    run.resume=resume;
    active=run.id;await save(run);
    execute1(run).finally(()=>{active=null;});
    return run;
  }

  // Hold keywords (core/chagui-rules.ts DEFAULT_HOLD_RULES until the owner edits them).
  const loadHoldRules=async()=>validHoldRules((await chrome.storage.local.get('chaguiHoldRules')).chaguiHoldRules);
  async function saveHoldRules(rules){const clean=validHoldRules(rules);await chrome.storage.local.set({chaguiHoldRules:clean});return clean;}
  let waiting=null;
  /** Pauses the run on holds no keyword knows, until the owner answers each one on the page (resolveHolds). */
  async function askHolds(run,step,unknown){
    run.status='waiting';run.pending={holds:unknown};
    await step('status','running',`发现 ${unknown.length} 个新的 Hold 词，请在插件里选择怎么处理`);
    notify('lfd-chagui-holds',-1,'查柜发现新的 Hold 词',`${unknown.map(u=>u.text||u.type).join('、')}：请打开插件「实验性功能」选择当作 Hold 还是忽略，选完后查柜自动继续。`,true);
    // An idle service worker stops after 30 seconds; extension API calls keep it alive while the owner decides.
    const keep=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
    let timer;
    try{
      return await new Promise((resolve,reject)=>{waiting={resolve,reject,run,unknown};timer=setTimeout(()=>reject(new Error('等待处理新的 Hold 词超时（30 分钟），查柜停止。')),30*60000);});
    }finally{
      clearInterval(keep);clearTimeout(timer);waiting=null;delete run.pending;run.status='running';
      chrome.notifications.clear('lfd-chagui-holds').catch(()=>{});await save(run);
    }
  }
  /** decisions: one per pending hold, {text, type, word} (word '' = not a hold). Adds them as keywords and goes on. */
  async function resolveHolds(decisions){
    if(!waiting)throw new Error('没有在等待处理的 Hold 词。');
    const same=(d,u)=>d.text===u.text&&d.type===u.type&&(d.source||'')===(u.source||'');
    if(!Array.isArray(decisions)||waiting.unknown.some(u=>!decisions.some(d=>same(d,u))))throw new Error('请为每个新的 Hold 词选择处理方式。');
    const rules=await loadHoldRules();
    for(const d of decisions)rules.push(d.source==='tag'?{match:d.text,by:'tag',word:d.word||''}:d.text?{match:d.text,by:'text',word:d.word||''}:{match:d.type,by:'type',word:d.word||''});
    const saved=await saveHoldRules(rules);
    waiting.resolve(saved);return saved;
  }
  function stopWaiting(){if(waiting)waiting.reject(new Error('已停止：新的 Hold 词没有处理。'));return true;}

  async function bundled(file){
    const code=await (await fetch(chrome.runtime.getURL('airscript/'+file))).text();
    const build=Number(code.match(/TH build:\s*(\d+)/)?.[1]);
    if(!build)throw new Error(`插件内的 ${file} 脚本缺少版本号。`);
    return {code,build};
  }
  const readPickup=async script=>parseBaseline((await withTab(PICKUP_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:'TH_ReadPickup',group:'mine',install:script,expect:{type:'chunks'},timeout:120000}],'MAIN'))).rows);

  async function execute1(run){
    const step=async(key,status,detail='')=>{run.steps=run.steps.map(s=>s.key===key?{...s,status,detail}:s);await save(run);};
    let current='push',draydogTab=null;
    try{
      // 1a. Run the document's own ListA_Push (it carries the authorized 云文档 API service).
      const resume=run.resume||{};delete run.resume;
      let line,containers,cache;
      if(resume.push)line=resume.push.detail;
      else{
        await step('push','running');
        const pushed=await withTab(PICKUP_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:PUSH_TITLE,prefix:true,group:'shared',expect:{type:'line',pattern:'^List A 已写入：'},timeout:180000}],'MAIN'));
        line=pushed.line.replace(/^List A 已写入：/,'');
        await step('push','done',line);
      }
      if(resume.list){containers=resume.list.containers;({chaguiCache:cache}=await chrome.storage.local.get('chaguiCache'));}
      else{
      // 1b. Read Available V2 back with the plugin's read-only script.
      current='read';await step('read','running');
      const read=await withTab(TEMPLATE_URL,'https://www.kdocs.cn/',async tabId=>execute(tabId,airScriptPage,[{title:READ_TITLE,group:'mine',install:await bundled('TH_ReadV2.js'),expect:{type:'chunks'},timeout:90000}],'MAIN'));
      containers=read.rows.filter(r=>Array.isArray(r)&&/^[A-Z]{4}\d{7}$/.test(r[0])).map(([container,terminal])=>({container,terminal:String(terminal||'Other')}));
      const expected=pushedCount(line);
      if(expected!==null&&expected!==containers.length)throw new Error(`Available V2 有 ${containers.length} 个柜号，与 ListA_Push 写入的 ${expected} 个不一致，可能有人同时在改表，请稍后重试。`);
      if(read.meta.stamp&&!String(read.meta.stamp).startsWith(line.split(' | ')[0]))throw new Error('Available V2 的更新记录不是刚才这一次，可能被其他运行覆盖，请稍后重试。');
      await step('read','done',`${containers.length} 个柜号`);
      // 2. Cache: this run's list.
      current='cache';await step('cache','running');
      ({chaguiCache:cache}=await chrome.storage.local.get('chaguiCache'));
      const merged=mergeCache(cache,{readAt:Date.now(),stamp:read.meta.stamp||line,pushLine:line,containers});
      cache=merged.cache;await chrome.storage.local.set({chaguiCache:cache});
      await step('cache','done',`新增 ${merged.added.length}，移出 ${merged.removed.length}`);
      }
      // 3. Dray Dog sign-in; the tab stays open for steps 4–5.
      current='draydog';await step('draydog','running');
      const signIn=await draydog(run,step);draydogTab=signIn.tabId;
      await step('draydog','done',signIn.who);
      const numbers=containers.map(c=>c.container);
      // 4. Start Tracking for containers Dray Dog does not track yet (apply runs only).
      let status=await execute(draydogTab,draydogPage,['containers',{numbers}],'MAIN');
      let newlyTracked=[];
      if(run.steps.some(s=>s.key==='track')){
        current='track';await step('track','running');
        if(status.unwatched.length){
          const watched=await execute(draydogTab,draydogPage,['watch',{numbers:status.unwatched}],'MAIN');
          newlyTracked=watched.container_numbers;
          await step('track','running',`已加入 ${newlyTracked.length} 个，重新查询`);
          status=await execute(draydogTab,draydogPage,['containers',{numbers}],'MAIN');
          await step('track','done',`新加入 ${newlyTracked.length} 个${watched.errors.length?`，${watched.errors.length} 个失败`:''}`);
        }else await step('track','done','全部已在追踪');
      }
      // 5. Status of every container.
      current='status';await step('status','running');
      const observedAt=new Date().toISOString();
      const lineCheck=new Set(status.lineCheck||[]);
      let holdRules=await loadHoldRules();
      const observeAll=()=>status.containers.map(c=>observe(c,Date.now(),{lineCheck:lineCheck.has(c.container_number),holdRules}));
      let statuses=observeAll();
      // A hold no keyword knows: stop, tell the owner, and go on once each one has an answer.
      const unknown=unknownHolds(statuses);
      if(unknown.length){
        if(draydogTab)await chrome.tabs.remove(draydogTab).catch(()=>{});draydogTab=null;
        holdRules=await askHolds(run,step,unknown);
        statuses=observeAll();
      }
      const appointed=statuses.filter(s=>s.category==='Appointed').map(s=>s.container),bookable=statuses.filter(s=>s.category==='Bookable').map(s=>s.container);
      await step('status','done',`${statuses.length} 个有数据；Appointed ${appointed.length}，Bookable ${bookable.length}${status.unwatched.length&&!run.apply?`；${status.unwatched.length} 个未追踪`:''}`);
      if(draydogTab)await chrome.tabs.remove(draydogTab).catch(()=>{});draydogTab=null;
      cache=recordObserved(cache,statuses,observedAt);await chrome.storage.local.set({chaguiCache:cache});
      // 6. 提柜表 baseline.
      current='baseline';await step('baseline','running');
      const readScript=await bundled('TH_ReadPickup.js');
      const baseline=await readPickup(readScript);
      if(!baseline.markers.unreleased.length||!baseline.markers.byTerminal.length)throw new Error('提柜表里找不到“未放行”或“按码头排”分区。');
      await step('baseline','done',`${baseline.rows.length} 行`);
      // 7–13. Plan.
      current='plan';await step('plan','running');
      const planned=plan(statuses,baseline,{holdRules});
      run.plan={changes:planned.changes,moves:planned.moves,skipped:planned.skipped,appointed,bookable};
      const cellCount=planned.changes.reduce((n,c)=>n+c.cells.length,0);
      await step('plan','done',`${planned.changes.length} 个柜子 ${cellCount} 个格子要改，${planned.moves.length} 行要移动${planned.skipped.length?`，${planned.skipped.length} 个需人工`:''}`);
      let applied=null,verified=null;
      if(run.apply&&(planned.changes.length||planned.moves.length)){
        // Write: TH_Apply with this run's data.
        current='apply';await step('apply','running');
        const template=await bundled('TH_Apply.js');
        const payload={id:run.id+'a',changes:planned.changes.map(({container,mbl,cells})=>({container,mbl,cells:cells.map(({col,column,before,after})=>({col,column,before,after}))})),moves:planned.moves};
        const code=template.code.replace('const PAYLOAD = null;',`const PAYLOAD = ${JSON.stringify(payload)};`);
        const result=await withTab(PICKUP_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:'TH_Apply',group:'mine',install:{code,build:template.build,always:true},expect:{type:'chunks'},timeout:300000}],'MAIN'));
        applied=result.rows.map(r=>JSON.parse(r));
        // Show where rows really landed (the plan's `to` is a forecast); a move that did not happen loses its arrow.
        for(const move of run.plan.moves){const real=applied.find(r=>r.container===move.container&&r.move)?.move;move.to=real?.to||null;move.done=Boolean(real?.to);}
        await save(run);
        const done=applied.reduce((n,r)=>n+(r.applied?.length||0),0),skippedCells=applied.reduce((n,r)=>n+(r.skipped?.length||0),0),moved=applied.filter(r=>r.move?.to).length;
        await step('apply','done',`写入 ${done} 个格子，移动 ${moved} 行${skippedCells?`，跳过 ${skippedCells} 个`:''}`);
        // 14. Read back and compare.
        current='verify';await step('verify','running');
        const after=await readPickup(readScript);
        verified=verify(planned,applied,after);
        await step('verify',verified.problems.length?'error':'done',verified.problems.length?`${verified.problems.length} 处与预期不符：${verified.problems.slice(0,3).join('；')}`:`${verified.ok.length} 个柜子核对无误`);
      }else if(run.apply){await step('apply','done','没有需要修改的');await step('verify','done','无需复核');}
      // 15. Cache and report.
      current='save';if(run.steps.some(s=>s.key==='save'))await step('save','running');
      cache=recordRun(cache,{run,statuses,appointed,bookable,newlyTracked,planned,applied,verified,baseline});
      await chrome.storage.local.set({chaguiCache:cache});
      if(run.steps.some(s=>s.key==='save'))await step('save','done',`${appointed.length} Appointed，${bookable.length} Bookable`);
      run.status=verified?.problems.length?'error':'done';run.error=verified?.problems.length?'写表后复核有不符，请查看。':undefined;run.finishedAt=Date.now();await save(run);
      notify('lfd-chagui',-1,run.apply?'查柜完成':'查柜预览完成',run.apply?`Appointed ${appointed.length}，Bookable ${bookable.length}；改了 ${applied?applied.reduce((n,r)=>n+(r.applied?.length||0),0):0} 个格子。`:`将修改 ${cellCount} 个格子、移动 ${planned.moves.length} 行（预览，未写表）。`);
    }catch(error){
      run.steps=run.steps.map(s=>s.key===current?{...s,status:'error',detail:error.message}:s);
      run.status='error';run.error=error.message;run.finishedAt=Date.now();await save(run);
      notify('lfd-chagui',-1,'查柜失败',error.message);
    }finally{
      if(draydogTab)await chrome.tabs.remove(draydogTab).catch(()=>{});
    }
  }

  async function draydog(run,step){
    const tab=await chrome.tabs.create({url:DRAYDOG_URL,active:false});
    const who=auth=>`${auth.user}${auth.organization?' · '+auth.organization:''}`;
    let ok=false;
    try{
      await loaded(tab.id,'https://app.draydog.com/');
      let auth=await execute(tab.id,draydogPage,['auth'],'MAIN');
      if(auth.loggedIn){ok=true;return {who:who(auth),tabId:tab.id};}
      // Signed out: show the login page and wait. The user signs in; the plugin never types credentials.
      if(!/\/login/.test(auth.url))await chrome.tabs.update(tab.id,{url:DRAYDOG_URL+'login'});
      await focusTab(tab.id).catch(()=>{});
      notify('lfd-chagui-login',tab.id,'请登录 Draydog','查柜需要 Draydog 账号。请在打开的页面登录，登录后插件自动继续。',true);
      await step('draydog','running','等待登录 Draydog');
      const end=Date.now()+LOGIN_WAIT;
      while(Date.now()<end){
        await pause(3000);
        try{await chrome.tabs.get(tab.id);}catch{throw new Error('Draydog 登录页已关闭，查柜停止。');}
        try{auth=await execute(tab.id,draydogPage,['auth'],'MAIN');}catch{continue;}
        await save(run);
        if(auth.loggedIn){chrome.notifications.clear('lfd-chagui-login').catch(()=>{});ok=true;return {who:who(auth),tabId:tab.id};}
      }
      throw new Error('等待 Draydog 登录超时（10 分钟）。');
    }finally{
      if(!ok)await chrome.tabs.remove(tab.id).catch(()=>{});
    }
  }
  return {start,state,importFile,exportFile,resolveHolds,stopWaiting,holdRules:loadHoldRules,setHoldRules:saveHoldRules};
}

/** Step 14: every planned cell that was written now shows its target, and every move landed. */
export function verify(planned,applied,after){
  const ok=new Set(),problems=[];
  const rows=new Map();for(const r of after.rows)if(/^[A-Z]{4}\d{7}$/.test(r.D))rows.set(r.D,[...(rows.get(r.D)||[]),r]);
  for(const result of applied){
    const change=planned.changes.find(c=>c.container===result.container);
    const found=rows.get(result.container)||[];
    if(found.length!==1){if(result.applied?.length||result.move?.to)problems.push(`${result.container} 找不到或出现多行`);continue;}
    const row=found[0];
    let good=true;
    for(const col of result.applied||[]){
      const cell=change?.cells.find(c=>c.col===col);
      if(cell&&SHOWN[col](row[col])!==cell.afterText){good=false;problems.push(`${result.container} ${col} 列是“${SHOWN[col](row[col])}”，应为“${cell.afterText}”`);}
    }
    if(result.move?.error){good=false;problems.push(`${result.container} 移动失败`);}
    if(good&&(result.applied?.length||result.move?.to))ok.add(result.container);
  }
  return {ok:[...ok],problems};
}

/** Step 5 into the cache, in the owner's field names. */
export function recordObserved(cache,statuses,observedAt){
  const containers={...cache.containers};
  for(const s of statuses){
    containers[s.container]={...(containers[s.container]||{lastVerifiedApplied:null}),lastObservedStatus:{
      category:s.category,rawState:String(s.state||'').replace(/_/g,' ').toUpperCase(),availableForPickup:s.available,readyForAppointment:s.ready,
      rawLocation:s.location,location:s.location,source:'api',lineCheck:s.lineCheck,holds:statusWords(s).join(','),lfd:s.lfd,lineLfd:s.lineLfd,noteLfd:s.noteLfd,note:s.note,
      appointmentDateTime:s.appointment?`${s.appointment.date} ${s.appointment.time}`:null,terminal:s.terminal,position:s.position,eta:s.eta,observedRun:observedAt,tags:s.tags}};
  }
  return {...cache,containers,updatedAt:observedAt};
}

/** Step 15: verified values per container and the run's audit record. */
export function recordRun(cache,{run,statuses,appointed,bookable,newlyTracked,planned,applied,verified,baseline}){
  const now=new Date().toISOString();
  const containers={...cache.containers};
  const verifiedSet=new Set(verified?.ok||[]);
  const rowOf=new Map(baseline.rows.map(r=>[r.D,r]));
  // TH_Apply reports cells and moves separately: one entry per container here.
  const byContainer=new Map();
  for(const r of applied||[]){const seen=byContainer.get(r.container)||{container:r.container,applied:[]};byContainer.set(r.container,{...seen,...r,applied:[...seen.applied,...(r.applied||[])],move:r.move||seen.move,row:r.row||seen.row});}
  for(const result of byContainer.values()){
    if(!verifiedSet.has(result.container))continue;
    const change=planned.changes.find(c=>c.container===result.container);
    const base=rowOf.get(result.container)||{};
    const value=col=>{const cell=change?.cells.find(c=>c.col===col&&result.applied.includes(col));return cell?cell.afterText:SHOWN[col](base[col]??'');};
    containers[result.container]={...containers[result.container],lastVerifiedApplied:{rowHint:result.move?.to||result.row||base.row,ready:value('A')==='✔',statusCell:value('B'),
      lfd:value('K'),appointmentDate:value('M'),appointmentTime:value('N'),g:value('G'),h:value('H'),terminal:base.P||'',verifiedAt:now},
      position:{g:value('G'),h:value('H'),checkedAt:now,verifiedAfterReload:true}};
  }
  const record={timestamp:now,source:'Trucker Helper',mode:run.apply?'apply':'preview',searchedCount:statuses.length,appointed,bookable,newlyTracked,
    changedAndVerified:verified?.ok||[],changedCellCount:(applied||[]).reduce((n,r)=>n+(r.applied?.length||0),0),
    moved:(applied||[]).filter(r=>r.move?.to).map(r=>r.container),
    changes:planned.changes.map(c=>({row:c.row,id:c.container,delta:c.cells.map(cell=>({column:cell.column,before:cell.beforeText,after:cell.afterText}))})),
    plannedMoves:planned.moves,skipped:[...planned.skipped,...(applied||[]).flatMap(r=>(r.skipped||[]).map(s=>({container:r.container,reason:`${s.col}: ${s.reason}`})))],
    problems:verified?.problems||[]};
  return {...cache,containers,updatedAt:now,runs:[...(cache.runs||[]),record].slice(-KEEP_RUN_RECORDS)};
}
