// @ts-nocheck
// OOCL Demurrage LFD (owner, 11/6). The query page's OOCL Demurrage group runs here instead of an email:
//   1–4. sign in to OOCL Real Time Release with the account saved in the plugin and search each bill of lading;
//   5.   add a Draydog note "SSL LFD mm/dd" unless that note is there;
//   6–7. the earlier of OOCL's and Draydog's LFD goes to column K of the 提柜表, and the results show in the plugin.
// Same safety as 查柜: a preview never writes (no note, no sheet); a write goes through TH_Apply (each cell checked
// against the value read) and is read back. Progress in `ooclRun`. 查柜 uses lookup() for its OOCL containers.
// The account lives in chrome.storage.local `ooclAccount` only: never in the settings export, never sent to the page
// other than OOCL's own sign-in form, and the password never goes back to the popup.
import {airScriptPage} from '../injected/airscript.ts';
import {draydogPage} from '../injected/draydog.ts';
import {ooclPage} from '../injected/oocl.ts';
import {parseBaseline,observe} from '../core/chagui-rules.ts';
import {RTR_URL,LOGIN_ORIGIN,rtrRows,searchTerm,ooclPlan} from '../core/oocl-rules.ts';
import {PICKUP_URL,DRAYDOG_URL,verify,openDraydog} from './chagui.ts';

const PREVIEW_FRESH=30*60000;
const SIGN_IN_WAIT=90000;
export const OOCL_STEPS=[
  ['oocl','登录 OOCL 并按提单号查询'],
  ['draydog','读取 Draydog 的 LFD 和 note'],
  ['baseline','读取提柜表'],
  ['plan','比较 LFD，计算要改的'],
  ['note','在 Draydog 写 SSL LFD note'],
  ['apply','写入提柜表 K 列'],
  ['verify','重新读取并复核']
];
const PREVIEW_STEPS=['oocl','draydog','baseline','plan'];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export const NO_ACCOUNT='还没有配置 OOCL 账号，请先在配置页填写账号密码。';

export function createOocl({execute,loaded,notify,focusTab,busy=()=>false}){
  let active=null,checking=null;
  const save=run=>chrome.storage.local.set({ooclRun:{...run,updatedAt:Date.now()}});
  const stored=async()=>{const {ooclAccount:a=null}=await chrome.storage.local.get('ooclAccount');return a?.username&&a?.password?a:null;};
  async function account(){const {ooclAccount:a=null}=await chrome.storage.local.get('ooclAccount');return {username:a?.username||'',saved:Boolean(a?.username&&a?.password),checkedAt:a?.checkedAt||0};}
  /** Saves the account (an empty password keeps the saved one), then signs in once to check it. */
  async function saveAccount({username,password}={}){
    const name=String(username||'').trim(),old=(await chrome.storage.local.get('ooclAccount')).ooclAccount||null;
    const secret=typeof password==='string'&&password?password:(old?.username===name?old?.password:'');
    if(!name||name.length>254)throw new Error('请填写 OOCL 账号（邮箱）。');
    if(!secret||secret.length>200)throw new Error('请填写 OOCL 密码。');
    await chrome.storage.local.set({ooclAccount:{username:name,password:secret,checkedAt:0}});
    await check({fresh:true});
    await chrome.storage.local.set({ooclAccount:{username:name,password:secret,checkedAt:Date.now()}});
    return account();
  }
  async function clearAccount(){await chrome.storage.local.remove('ooclAccount');return account();}
  /** 确定并检查连通性: signs in (signing an older session out first) and calls the site once. */
  async function check({fresh=false}={}){
    if(checking)return checking;
    checking=(async()=>{const tabId=await signedInTab({fresh});await chrome.tabs.remove(tabId).catch(()=>{});return true;})().finally(()=>{checking=null;});
    return checking;
  }
  const settle=async tabId=>{const end=Date.now()+20000;while(Date.now()<end){const tab=await chrome.tabs.get(tabId).catch(()=>null);if(!tab)throw new Error('OOCL 页面已关闭。');if(tab.status==='complete')return tab;await pause(300);}return chrome.tabs.get(tabId);};
  /** A background tab on RTR, signed in. The caller closes it. */
  async function signedInTab({fresh=false}={}){
    const login=await stored();
    if(!login)throw Object.assign(new Error(NO_ACCOUNT),{code:'account'});
    const tab=await chrome.tabs.create({url:RTR_URL,active:false});
    let ok=false,submitted=0,loggedOut=!fresh,odd=0;
    try{
      const end=Date.now()+SIGN_IN_WAIT;
      while(Date.now()<end){
        await pause(700);
        const now=await settle(tab.id);
        const url=now?.url||'';
        if(url.startsWith(RTR_URL)&&!/^\/login/.test(new URL(url).pathname)){
          const state=await execute(tab.id,ooclPage,['check'],'MAIN').catch(()=>null);
          if(!state?.signedIn)continue;
          if(!loggedOut){
            // An older session (maybe another account): sign it out so the saved account is the one tried.
            loggedOut=true;
            const out=await execute(tab.id,ooclPage,['logout'],'MAIN').catch(()=>null);
            await chrome.tabs.update(tab.id,{url:out?.url||RTR_URL+'login'});await pause(1500);
            if(out?.url){await settle(tab.id);await chrome.tabs.update(tab.id,{url:RTR_URL});}
            continue;
          }
          ok=true;return tab.id;
        }
        if(url.startsWith(LOGIN_ORIGIN)){
          const page=await execute(tab.id,ooclPage,['state']).catch(()=>null);
          if(!page)continue;
          if(!page.form){if(++odd>8)throw new Error('OOCL 登录后停在了其他页面（可能要求修改密码或额外验证），请在浏览器里手动登录一次 rtr.home.oocl.com。');continue;}
          if(submitted&&page.error)throw new Error(`OOCL 登录失败：${page.error}`);
          if(submitted>=2)throw new Error('OOCL 登录失败，请检查账号密码。');
          await execute(tab.id,ooclPage,['login',{username:login.username,password:login.password}]);
          loggedOut=true;submitted++;await pause(2500);
        }
      }
      throw new Error('OOCL 登录超时，请检查网络或账号。');
    }finally{
      if(!ok)await chrome.tabs.remove(tab.id).catch(()=>{});
    }
  }
  /** Searches RTR. terms: MBLs or container numbers. → {found:{container:row}, errors:[], messages:{term:[...]}} */
  async function lookup(terms){
    const list=[...new Set(terms.map(searchTerm).filter(Boolean))];
    const out={found:{},errors:[],messages:{}};
    if(!list.length)return out;
    const tabId=await signedInTab();
    try{
      const answers=await execute(tabId,ooclPage,['search',{terms:list}],'MAIN');
      for(const term of list){
        const answer=answers[term]||{};
        if(answer.error)out.errors.push(`${term}：${answer.error}`);
        if(answer.messages?.length)out.messages[term]=answer.messages;
        for(const [container,row] of Object.entries(rtrRows(answer,term)))if(!out.found[container]||(!out.found[container].lfd&&row.lfd))out.found[container]=row;
      }
    }finally{await chrome.tabs.remove(tabId).catch(()=>{});}
    return out;
  }

  async function withTab(url,origin,work){
    const tab=await chrome.tabs.create({url,active:false});
    try{await loaded(tab.id,origin);return await work(tab.id);}
    finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
  }
  async function bundled(file){
    const code=await (await fetch(chrome.runtime.getURL('airscript/'+file))).text();
    const build=Number(code.match(/TH build:\s*(\d+)/)?.[1]);
    if(!build)throw new Error(`插件内的 ${file} 脚本缺少版本号。`);
    return {code,build};
  }
  const readPickup=async()=>{const script=await bundled('TH_ReadPickup.js');return parseBaseline((await withTab(PICKUP_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:'TH_ReadPickup',group:'mine',install:script,expect:{type:'chunks'},timeout:120000}],'MAIN'))).rows);};
  const newRun=(keys,extra={})=>({id:Date.now().toString(36),status:'running',startedAt:Date.now(),...extra,steps:OOCL_STEPS.filter(([key])=>keys.includes(key)).map(([key,label])=>({key,label,status:'waiting',detail:''}))});

  async function state(){
    const {ooclRun:run=null}=await chrome.storage.local.get('ooclRun');
    if(run?.status==='running'&&active!==run.id){
      const stopped={...run,status:'error',error:'OOCL 查询被中断（浏览器或插件重启），请重新运行。',steps:run.steps.map(s=>s.status==='running'?{...s,status:'error'}:s)};
      await save(stopped);return {run:stopped,account:await account()};
    }
    return {run,account:await account()};
  }
  /** items [{container, mbl}] from the query page. */
  async function start({items,apply=false}={}){
    if(active)throw new Error('OOCL 查询正在进行中。');
    if(busy())throw new Error('查柜正在进行中，请等它完成。');
    const list=(Array.isArray(items)?items:[]).map(i=>({container:String(i?.container||'').toUpperCase().trim(),mbl:String(i?.mbl||'').toUpperCase().trim()})).filter(i=>/^[A-Z]{4}\d{7}$/.test(i.container));
    if(!list.length)throw new Error('没有要查询的 OOCL 柜号。');
    if(list.length>60)throw new Error('一次最多查询 60 个柜号。');
    if(!await stored())throw Object.assign(new Error(NO_ACCOUNT),{code:'account'});
    const run=newRun(apply?OOCL_STEPS.map(s=>s[0]):PREVIEW_STEPS,{apply,items:list});
    active=run.id;await save(run);
    execute1(run).finally(()=>{active=null;});
    return run;
  }
  async function execute1(run){
    const step=async(key,status,detail='')=>{run.steps=run.steps.map(s=>s.key===key?{...s,status,detail}:s);await save(run);};
    let current='oocl';
    try{
      // 1–4. OOCL, by bill of lading; a container its bill did not list is searched by its own number.
      await step('oocl','running');
      const result=await lookup(run.items.map(i=>i.mbl||i.container));
      const missing=run.items.filter(i=>!result.found[i.container]);
      if(missing.length){const again=await lookup(missing.map(i=>i.container));Object.assign(result.found,again.found);result.errors.push(...again.errors);}
      const found=result.found,withLfd=run.items.filter(i=>found[i.container]?.lfd);
      await step('oocl','done',`${run.items.length} 个柜子，查到 ${run.items.filter(i=>found[i.container]).length} 个，有 LFD ${withLfd.length} 个${result.errors.length?`；${result.errors.slice(0,2).join('；')}`:''}`);
      // Draydog: its LFD and the notes.
      current='draydog';await step('draydog','running');
      const signIn=await openDraydog({execute,loaded,notify,focusTab},async detail=>{if(detail)await step('draydog','running',detail);else await save(run);});
      const draydog={},notes={};
      try{
        const numbers=run.items.map(i=>i.container);
        const status=await execute(signIn.tabId,draydogPage,['containers',{numbers}],'MAIN');
        // Owner's step 6: compare with the LFD Draydog's card shows (e.g. "LFD: 10/31, Source: LBCT"), CHECK LINE or not.
        for(const c of status.containers)draydog[c.container_number]=observe(c,Date.now());
        const tracked=Object.keys(draydog);
        if(tracked.length)Object.assign(notes,await execute(signIn.tabId,draydogPage,['notes',{numbers:tracked}],'MAIN'));
      }finally{await chrome.tabs.remove(signIn.tabId).catch(()=>{});}
      await step('draydog','done',`${Object.keys(draydog).length} 个在 Draydog 追踪${signIn.who?` · ${signIn.who}`:''}`);
      // 提柜表.
      current='baseline';await step('baseline','running');
      const baseline=await readPickup();
      await step('baseline','done',`${baseline.rows.length} 行`);
      // 5–7. Plan.
      current='plan';await step('plan','running');
      const planned=ooclPlan(run.items,{found,draydog,notes,baseline});
      run.plan=planned;
      await step('plan','done',`K 列要改 ${planned.changes.length} 个，Draydog 要写 note ${planned.notes.length} 个${planned.skipped.length?`，${planned.skipped.length} 个需人工`:''}`);
      if(run.apply)await write(run,step,planned,c=>{current=c;});
      finish(run);
    }catch(error){fail(run,current,error);}
  }
  function finish(run){
    run.status=run.steps.some(s=>s.status==='error')?'error':'done';run.finishedAt=Date.now();
    if(run.status==='error')run.error='写入后复核有不符，请查看。';
    save(run);
    const lfds=(run.plan?.results||[]).filter(r=>r.lfd).map(r=>`${r.container} ${r.lfd.slice(5).replace('-','/')}`);
    notify('lfd-oocl',-1,run.apply?'OOCL LFD 查询完成':'OOCL LFD 查询完成（预览）',lfds.length?lfds.slice(0,6).join('，'):'没有查到 LFD。');
  }
  function fail(run,current,error){
    run.steps=run.steps.map(s=>s.key===current?{...s,status:'error',detail:error.message}:s);
    run.status='error';run.error=error.message;run.finishedAt=Date.now();save(run);
    notify('lfd-oocl',-1,'OOCL LFD 查询失败',error.message);
  }
  /** Draydog notes, then TH_Apply with the K cells, then read back. */
  async function write(run,step,planned,setCurrent){
    setCurrent('note');
    if(planned.notes.length){
      await step('note','running');
      const signIn=await openDraydog({execute,loaded,notify,focusTab},async detail=>{if(detail)await step('note','running',detail);});
      let added;
      try{added=await execute(signIn.tabId,draydogPage,['addNote',{notes:planned.notes}],'MAIN');}
      finally{await chrome.tabs.remove(signIn.tabId).catch(()=>{});}
      run.notesAdded=added.added.map(a=>a.container);
      await step('note',added.errors.length?'error':'done',`写了 ${added.added.length} 条${added.errors.length?`，${added.errors.length} 条失败：${added.errors.slice(0,2).map(e=>`${e.container} ${e.message}`).join('；')}`:''}`);
    }else await step('note','done','都已有 note');
    setCurrent('apply');
    if(!planned.changes.length){await step('apply','done','K 列不用改');await step('verify','done','无需复核');return;}
    await step('apply','running');
    const template=await bundled('TH_Apply.js');
    const payload={id:run.id+'o',changes:planned.changes.map(({container,mbl,cells})=>({container,mbl,cells:cells.map(({col,column,before,after})=>({col,column,before,after}))})),moves:[]};
    const code=template.code.replace('const PAYLOAD = null;',`const PAYLOAD = ${JSON.stringify(payload)};`);
    const result=await withTab(PICKUP_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:'TH_Apply',group:'mine',install:{code,build:template.build,always:true},expect:{type:'chunks'},timeout:300000}],'MAIN'));
    const applied=result.rows.map(r=>JSON.parse(r));
    run.written=applied.reduce((n,r)=>n+(r.applied?.length||0),0);
    const skipped=applied.reduce((n,r)=>n+(r.skipped?.length||0),0);
    await step('apply','done',`写入 ${run.written} 个格子${skipped?`，跳过 ${skipped} 个（写之前被人改过）`:''}`);
    setCurrent('verify');await step('verify','running');
    const verified=verify(planned,applied,await readPickup());
    await step('verify',verified.problems.length?'error':'done',verified.problems.length?`${verified.problems.length} 处与预期不符：${verified.problems.slice(0,3).join('；')}`:`${verified.ok.length} 个柜子核对无误`);
  }
  /** Writes the last preview as it is (each K cell still checked against the value the preview read). */
  async function applyPreview(){
    if(active)throw new Error('OOCL 查询正在进行中。');
    if(busy())throw new Error('查柜正在进行中，请等它完成。');
    const {ooclRun:preview}=await chrome.storage.local.get('ooclRun');
    if(!preview||preview.status!=='done'||preview.apply||!preview.plan)throw new Error('没有可写入的预览，请先查询。');
    if(Date.now()-(preview.finishedAt||0)>PREVIEW_FRESH)throw new Error('预览已超过 30 分钟，表格可能有变化，请重新查询。');
    if(!preview.plan.changes.length&&!preview.plan.notes.length)throw new Error('预览里没有需要修改的。');
    const run=newRun(['note','apply','verify'],{apply:true,fromPreview:preview.id,items:preview.items,plan:preview.plan});
    active=run.id;await save(run);
    (async()=>{
      let current='note';
      const step=async(key,status,detail='')=>{run.steps=run.steps.map(s=>s.key===key?{...s,status,detail}:s);await save(run);};
      try{await write(run,step,run.plan,c=>{current=c;});finish(run);}
      catch(error){fail(run,current,error);}
    })().finally(()=>{active=null;});
    return run;
  }
  /** 查柜: Draydog notes for these containers, then OOCL for the ones still without an SSL LFD. */
  async function addNotes(notes){
    if(!notes.length)return {added:[],errors:[]};
    return withTab(DRAYDOG_URL,'https://app.draydog.com/',tabId=>execute(tabId,draydogPage,['addNote',{notes}],'MAIN'));
  }
  return {start,applyPreview,state,account,saveAccount,clearAccount,check,lookup,addNotes,hasAccount:async()=>Boolean(await stored()),busy:()=>Boolean(active)};
}
