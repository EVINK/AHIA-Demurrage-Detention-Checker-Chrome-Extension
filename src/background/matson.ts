// @ts-nocheck
// Experimental Matson 查柜 (owner, 11/5): the Matson containers of the 提柜表 (what Available V2 lists under MATSON),
// their status from matson.com by bill of lading, the vessel's arrival from Matson's vessel schedule, then column B
// (ETA / HOLD and later events) and A ✔ when AVAILABLE without a hold. Rules: core/matson-rules.ts.
// Same safety as 查柜: a preview never writes; a write goes through TH_Apply (each cell checked against the value
// read) and is read back and compared. Progress in `matsonRun`, which the 实验性功能 page follows.
import {airScriptPage} from '../injected/airscript.ts';
import {matsonPage} from '../injected/matson.ts';
import {parseBaseline,validHoldRules,managedPattern} from '../core/chagui-rules.ts';
import {matsonList,observeMatson,scheduleQuery,queryKey,arrivalOf,matsonPlan} from '../core/matson-rules.ts';
import {PICKUP_URL,verify} from './chagui.ts';

export const MATSON_TRACK_URL='https://www.matson.com/shipment-tracking.html';
const MATSON_ORIGIN='https://www.matson.com/';
const PREVIEW_FRESH=30*60000;
export const MATSON_STEPS=[
  ['baseline','读取提柜表里的 Matson 柜子'],
  ['track','在 Matson 按提单号查询'],
  ['schedule','查船期（未卸船的柜子）'],
  ['plan','计算要改的格子'],
  ['apply','写入提柜表'],
  ['verify','重新读取并复核']
];
const PREVIEW_STEPS=['baseline','track','schedule','plan'];

export function createMatson({execute,loaded,notify,busy=()=>false}){
  let active=null;
  const save=run=>chrome.storage.local.set({matsonRun:{...run,updatedAt:Date.now()}});
  async function state(){
    const {matsonRun:run=null}=await chrome.storage.local.get('matsonRun');
    if(run?.status==='running'&&active!==run.id){
      const stopped={...run,status:'error',error:'Matson 查柜被中断（浏览器或插件重启），请重新运行。',steps:run.steps.map(s=>s.status==='running'?{...s,status:'error'}:s)};
      await save(stopped);return {run:stopped};
    }
    return {run};
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
  const newRun=keys=>({id:Date.now().toString(36),status:'running',startedAt:Date.now(),steps:MATSON_STEPS.filter(([key])=>keys.includes(key)).map(([key,label])=>({key,label,status:'waiting',detail:''}))});

  async function start({apply=false}={}){
    if(active)throw new Error('Matson 查柜正在进行中。');
    if(busy())throw new Error('查柜正在进行中，请等它完成。');
    const run={...newRun(apply?MATSON_STEPS.map(s=>s[0]):PREVIEW_STEPS),apply};
    active=run.id;await save(run);
    execute1(run).finally(()=>{active=null;});
    return run;
  }
  async function execute1(run){
    const step=async(key,status,detail='')=>{run.steps=run.steps.map(s=>s.key===key?{...s,status,detail}:s);await save(run);};
    let current='baseline';
    try{
      // 1. The Matson containers and their MBL, from the 提柜表 (the same filter ListA_Push uses for Available V2).
      await step('baseline','running');
      const baseline=await readPickup();
      const list=matsonList(baseline);
      await step('baseline','done',`${list.containers.length} 个 Matson 柜子${list.skipped.length?`，${list.skipped.length} 个需人工`:''}`);
      // 2. matson.com tracking, one request per bill of lading.
      current='track';await step('track','running');
      const bls=[...new Set(list.containers.map(c=>c.bl))];
      const tracked=bls.length?await withTab(MATSON_TRACK_URL,MATSON_ORIGIN,tabId=>execute(tabId,matsonPage,['track',{bls}],'MAIN')):{};
      const items=list.containers.map(c=>({...c,observation:observeMatson(c.container,tracked[c.bl])}));
      const found=items.filter(i=>i.observation);
      await step('track','done',`${found.length} 个查到；Hold ${found.filter(i=>i.observation.hold).length}，Available ${found.filter(i=>i.observation.available).length}，已卸船 ${found.filter(i=>i.observation.discharged).length}`);
      // 4–5. Vessel schedule for the ones not discharged yet (discharged: the discharge time is the ETA).
      current='schedule';await step('schedule','running');
      const queries=new Map();
      for(const i of found){const q=scheduleQuery(i.observation);if(q){i.query=queryKey(q);queries.set(i.query,q);}}
      const schedules=queries.size?await withTab(MATSON_TRACK_URL,MATSON_ORIGIN,tabId=>execute(tabId,matsonPage,['schedule',{queries:[...queries.values()]}],'MAIN')):{};
      for(const i of found)if(i.query)i.arrival=arrivalOf(i.observation,schedules[i.query]);
      const lookedUp=found.filter(i=>i.query);
      await step('schedule','done',lookedUp.length?`${lookedUp.length} 个柜子，找到到港时间 ${lookedUp.filter(i=>i.arrival).length} 个`:'都已卸船，无需查船期');
      // Plan.
      current='plan';await step('plan','running');
      const holdRules=validHoldRules((await chrome.storage.local.get('chaguiHoldRules')).chaguiHoldRules);
      const planned=matsonPlan(items,baseline,{holdPattern:managedPattern(holdRules)});
      planned.skipped=[...list.skipped,...planned.skipped];
      run.plan=planned;
      const cellCount=planned.changes.reduce((n,c)=>n+c.cells.length,0);
      await step('plan','done',`${planned.changes.length} 个柜子 ${cellCount} 个格子要改，${planned.moves.length} 行要移动${planned.skipped.length?`，${planned.skipped.length} 个需人工`:''}`);
      if(run.apply)await write(run,step,planned,c=>{current=c;});
      run.status=run.steps.some(s=>s.status==='error')?'error':'done';run.finishedAt=Date.now();
      if(run.status==='error')run.error='写表后复核有不符，请查看。';
      await save(run);
      notify('lfd-matson',-1,run.apply?'Matson 查柜完成':'Matson 查柜预览完成',run.apply?`改了 ${run.written||0} 个格子。`:`将修改 ${cellCount} 个格子（预览，未写表）。`);
    }catch(error){
      run.steps=run.steps.map(s=>s.key===current?{...s,status:'error',detail:error.message}:s);
      run.status='error';run.error=error.message;run.finishedAt=Date.now();await save(run);
      notify('lfd-matson',-1,'Matson 查柜失败',error.message);
    }
  }
  /** TH_Apply with this plan (cells only, no moves), then read back and compare. */
  async function write(run,step,planned,setCurrent){
    setCurrent('apply');
    const moves=planned.moves||[];
    if(!planned.changes.length&&!moves.length){await step('apply','done','没有需要修改的');await step('verify','done','无需复核');return;}
    await step('apply','running');
    const template=await bundled('TH_Apply.js');
    const payload={id:run.id+'m',changes:planned.changes.map(({container,mbl,cells})=>({container,mbl,cells:cells.map(({col,column,before,after})=>({col,column,before,after}))})),moves:moves.map(({container,mbl,from,terminal})=>({container,mbl,from,terminal}))};
    const code=template.code.replace('const PAYLOAD = null;',`const PAYLOAD = ${JSON.stringify(payload)};`);
    const result=await withTab(PICKUP_URL,'https://www.kdocs.cn/',tabId=>execute(tabId,airScriptPage,[{title:'TH_Apply',group:'mine',install:{code,build:template.build,always:true},expect:{type:'chunks'},timeout:300000}],'MAIN'));
    const applied=result.rows.map(r=>JSON.parse(r));
    run.written=applied.reduce((n,r)=>n+(r.applied?.length||0),0);
    const skipped=applied.reduce((n,r)=>n+(r.skipped?.length||0),0);
    // Where rows really landed (the plan's `to` is a forecast).
    for(const move of moves){const real=applied.find(r=>r.container===move.container&&r.move)?.move;move.to=real?.to||null;move.done=Boolean(real?.to);}
    const moved=moves.filter(m=>m.done).length;
    await save(run);
    await step('apply','done',`写入 ${run.written} 个格子，移动 ${moved} 行${skipped?`，跳过 ${skipped} 个`:''}`);
    setCurrent('verify');await step('verify','running');
    const verified=verify(planned,applied,await readPickup());
    await step('verify',verified.problems.length?'error':'done',verified.problems.length?`${verified.problems.length} 处与预期不符：${verified.problems.slice(0,3).join('；')}`:`${verified.ok.length} 个柜子核对无误`);
  }
  /** Writes the last preview's plan as it is (each cell still checked against the value the preview read). */
  async function applyPreview(){
    if(active)throw new Error('Matson 查柜正在进行中。');
    if(busy())throw new Error('查柜正在进行中，请等它完成。');
    const {matsonRun:preview}=await chrome.storage.local.get('matsonRun');
    if(!preview||preview.status!=='done'||preview.apply||!preview.plan)throw new Error('没有可写入的预览，请先点「预览」。');
    if(Date.now()-(preview.finishedAt||0)>PREVIEW_FRESH)throw new Error('预览已超过 30 分钟，表格可能有变化，请重新预览。');
    if(!preview.plan.changes.length&&!preview.plan.moves?.length)throw new Error('预览里没有需要修改的。');
    const run={...newRun(['apply','verify']),apply:true,fromPreview:preview.id,plan:preview.plan};
    active=run.id;await save(run);
    (async()=>{
      let current='apply';
      const step=async(key,status,detail='')=>{run.steps=run.steps.map(s=>s.key===key?{...s,status,detail}:s);await save(run);};
      try{
        await write(run,step,run.plan,c=>{current=c;});
        run.status=run.steps.some(s=>s.status==='error')?'error':'done';if(run.status==='error')run.error='写表后复核有不符，请查看。';
        run.finishedAt=Date.now();await save(run);
        notify('lfd-matson',-1,'Matson 查柜完成',`按预览写入 ${run.written||0} 个格子。`);
      }catch(error){
        run.steps=run.steps.map(s=>s.key===current?{...s,status:'error',detail:error.message}:s);
        run.status='error';run.error=error.message;run.finishedAt=Date.now();await save(run);
        notify('lfd-matson',-1,'Matson 查柜失败',error.message);
      }
    })().finally(()=>{active=null;});
    return run;
  }
  return {start,applyPreview,state,busy:()=>Boolean(active)};
}
