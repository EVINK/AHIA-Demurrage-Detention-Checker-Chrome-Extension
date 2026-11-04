// @ts-nocheck
// Experimental 查柜 (container check), steps 1–3 of the owner's manual process:
//   1. run the 提柜表's shared AirScript 「ListA_Push 推送Available V2」, which writes the list to the template's
//      Available V2 sheet, then read the containers back from Available V2 with the read-only TH_ReadV2 script;
//   2. keep the list and per-container history in chrome.storage.local (`chaguiCache`);
//   3. open Dray Dog in a background tab and check the sign-in; when signed out, bring the login page forward.
// Progress is stored in `chaguiRun`, which the 实验性功能 page follows through storage.onChanged.
import {airScriptPage} from '../injected/airscript.ts';
import {draydogPage} from '../injected/draydog.ts';

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
  ['draydog','打开 Draydog 并检查登录']
];
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
    if(run?.status==='running'&&active!==run.id){
      const stopped={...run,status:'error',error:'查柜被中断（浏览器或插件重启），请重新运行。',steps:run.steps.map(s=>s.status==='running'?{...s,status:'error'}:s)};
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
      known:records.length,verified:records.filter(e=>e?.lastVerifiedApplied).length,observed:records.filter(e=>e?.lastObservedStatus).length,runs:cache.runs.length};
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

  async function start(){
    if(active)throw new Error('查柜正在进行中。');
    const run={id:Date.now().toString(36),status:'running',startedAt:Date.now(),steps:STEPS.map(([key,label])=>({key,label,status:'waiting',detail:''}))};
    active=run.id;await save(run);
    execute1(run).finally(()=>{active=null;});
    return run;
  }

  async function execute1(run){
    const step=async(key,status,detail='')=>{run.steps=run.steps.map(s=>s.key===key?{...s,status,detail}:s);await save(run);};
    let current='push';
    try{
      // 1a. Run the document's own ListA_Push (it carries the authorized 云文档 API service).
      await step('push','running');
      const pushed=await withTab(PICKUP_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:PUSH_TITLE,prefix:true,group:'shared',expect:{type:'line',pattern:'^List A 已写入：'},timeout:180000}],'MAIN'));
      const line=pushed.line.replace(/^List A 已写入：/,'');
      await step('push','done',line);
      // 1b. Read Available V2 back with the plugin's read-only script.
      current='read';await step('read','running');
      const code=await (await fetch(chrome.runtime.getURL('airscript/TH_ReadV2.js'))).text();
      const build=Number(code.match(/TH build:\s*(\d+)/)?.[1]);
      if(!build)throw new Error('插件内的 TH_ReadV2 脚本缺少版本号。');
      const read=await withTab(TEMPLATE_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:READ_TITLE,group:'mine',install:{code,build},expect:{type:'chunks'},timeout:90000}],'MAIN'));
      const containers=read.rows.filter(r=>Array.isArray(r)&&/^[A-Z]{4}\d{7}$/.test(r[0])).map(([container,terminal])=>({container,terminal:String(terminal||'Other')}));
      const expected=pushedCount(line);
      if(expected!==null&&expected!==containers.length)throw new Error(`Available V2 有 ${containers.length} 个柜号，与 ListA_Push 写入的 ${expected} 个不一致，可能有人同时在改表，请稍后重试。`);
      if(read.meta.stamp&&!String(read.meta.stamp).startsWith(line.split(' | ')[0]))throw new Error('Available V2 的更新记录不是刚才这一次，可能被其他运行覆盖，请稍后重试。');
      await step('read','done',`${containers.length} 个柜号`);
      // 2. Cache.
      current='cache';await step('cache','running');
      const {chaguiCache}=await chrome.storage.local.get('chaguiCache');
      const merged=mergeCache(chaguiCache,{readAt:Date.now(),stamp:read.meta.stamp||line,pushLine:line,containers});
      await chrome.storage.local.set({chaguiCache:merged.cache});
      await step('cache','done',`新增 ${merged.added.length}，移出 ${merged.removed.length}`);
      // 3. Dray Dog sign-in.
      current='draydog';await step('draydog','running');
      const who=await draydog(run,step);
      await step('draydog','done',who);
      run.status='done';run.finishedAt=Date.now();await save(run);
      notify('lfd-chagui',-1,'查柜完成',`${containers.length} 个柜号已读取并写入缓存，Draydog 已登录。`);
    }catch(error){
      run.steps=run.steps.map(s=>s.key===current?{...s,status:'error',detail:error.message}:s);
      run.status='error';run.error=error.message;run.finishedAt=Date.now();await save(run);
      notify('lfd-chagui',-1,'查柜失败',error.message);
    }
  }

  async function draydog(run,step){
    const tab=await chrome.tabs.create({url:DRAYDOG_URL,active:false});
    let keep=false;
    try{
      await loaded(tab.id,'https://app.draydog.com/');
      let auth=await execute(tab.id,draydogPage,['auth'],'MAIN');
      if(auth.loggedIn)return `${auth.user}${auth.organization?' · '+auth.organization:''}`;
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
        if(auth.loggedIn){chrome.notifications.clear('lfd-chagui-login').catch(()=>{});keep=true;return `${auth.user}${auth.organization?' · '+auth.organization:''}`;}
      }
      throw new Error('等待 Draydog 登录超时（10 分钟）。');
    }finally{
      // After a fresh login the user is looking at Dray Dog: leave that tab alone.
      if(!keep)await chrome.tabs.remove(tab.id).catch(()=>{});
    }
  }
  return {start,state,importFile,exportFile};
}
