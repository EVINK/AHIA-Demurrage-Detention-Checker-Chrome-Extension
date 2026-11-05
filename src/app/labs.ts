// 实验性功能 page state: the 查柜 run and its cache, both owned by the worker (src/background/chagui.ts).
import {reactive,ref} from 'vue';
import {ask,demo,status} from './store.ts';

export const chagui=reactive<{run:any,cache:any,loaded:boolean}>({run:null,cache:null,loaded:false});
export const starting=ref(false);

async function rpc(message:any){
  const response=await chrome.runtime.sendMessage(message);
  if(!response?.ok)throw new Error(response?.error||'插件没有响应。');
  return response.data;
}
const DEMO_RUN={id:'demo',status:'done',startedAt:Date.now()-95000,finishedAt:Date.now(),steps:[
  {key:'push',label:'运行 ListA_Push，更新 Available V2',status:'done',detail:'11/3/2026, 15:42:30 | 提柜 行 1–636 | 363 柜'},
  {key:'read',label:'从 Available V2 读取柜号',status:'done',detail:'363 个柜号'},
  {key:'cache',label:'写入查柜缓存',status:'done',detail:'新增 4，移出 6'},
  {key:'draydog',label:'打开 Draydog 并检查登录',status:'done',detail:'Demo User · Demo Trucking'}]};
const DEMO_CACHE={readAt:Date.now(),stamp:'11/3/2026, 15:42:30 | 提柜 行 1–636 | 363 柜',count:3,byTerminal:[['APM',2],['TTI',1]],
  containers:[{container:'MSCU1234567',terminal:'APM'},{container:'TGHU7654321',terminal:'APM'},{container:'CMAU1111111',terminal:'TTI'}],runs:1,known:3,verified:0,observed:0};

export async function loadChagui(){
  if(demo){Object.assign(chagui,{run:DEMO_RUN,cache:DEMO_CACHE,loaded:true});return;}
  try{Object.assign(chagui,await rpc({type:'chaguiState'}),{loaded:true});}catch(error){status((error as Error).message,'error');}
}
let listening=false;
export function watchChagui(){
  if(demo||listening)return;listening=true;
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.chaguiRun||changes.chaguiCache))loadChagui();});
}
export async function startChagui(apply=false){
  if(demo){status('演示模式不会运行查柜。');return;}
  if(apply&&!await ask('查柜并写入提柜表：按规则只改有变化的格子，并把未放行下面的 Appointed / Bookable 整行移到按码头排。写之前会核对每个格子没被人改过。继续？'))return;
  starting.value=true;
  try{await rpc({type:'chaguiStart',apply});status(apply?'查柜已在后台开始。':'预览已在后台开始，不会写表。');await loadChagui();}
  catch(error){status((error as Error).message,'error');}
  finally{starting.value=false;}
}
// Hold keywords: Dray Dog hold text or type → the B column word ('' = not a hold).
export const holdRules=ref<any[]>([]);
export const holdDraft=reactive({match:'',by:'text',word:''});
export async function loadHoldRules(){if(demo)return;try{holdRules.value=await rpc({type:'chaguiHoldRules'});}catch(error){status((error as Error).message,'error');}}
async function storeHoldRules(rules:any[],done=''){
  try{holdRules.value=await rpc({type:'chaguiHoldRules',rules});if(done)status(done,'success');return true;}
  catch(error){status((error as Error).message,'error');return false;}
}
export async function addHoldRule(){
  if(!holdDraft.match.trim()){status('请填写 Draydog 显示的词。','error');return;}
  if(await storeHoldRules([...holdRules.value,{...holdDraft}],'已添加关键词。'))Object.assign(holdDraft,{match:'',by:'text',word:''});
}
export async function removeHoldRule(index:number){await storeHoldRules(holdRules.value.filter((_:any,i:number)=>i!==index),'已删除关键词。');}
export async function editHoldRule(index:number,word:string){await storeHoldRules(holdRules.value.map((r:any,i:number)=>i===index?{...r,word}:r));}
// Answers for a run paused on new hold words: one per word.
export const holdAnswers=reactive<Record<string,{hold:boolean,word:string}>>({});
export const holdKey=(u:any)=>`${u.source||'hold'}|${u.text}|${u.type}`;
/** A suggested B column word for a new Dray Dog hold: its type or text, as Xxx_H. */
export const suggestWord=(u:any)=>{const base=String(u.type||u.text||'').replace(/\s*hold$/i,'').trim().replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'');return base?`${base}_H`:'Hold_H';};
/** Marks every pending word 可提 at once (a long first list is mostly statuses that do not hold anything). */
export function markAllPickable(){for(const u of chagui.run?.pending?.holds||[])holdAnswers[holdKey(u)]={hold:false,word:holdAnswers[holdKey(u)]?.word||suggestWord(u)};}
export async function answerHolds(){
  const pending=chagui.run?.pending?.holds||[];
  const decisions=pending.map((u:any)=>{const a=holdAnswers[holdKey(u)]||{hold:true,word:suggestWord(u)};return {text:u.text,type:u.type,source:u.source||'',word:a.hold?a.word.trim():''};});
  if(decisions.some((d:any,i:number)=>(holdAnswers[holdKey(pending[i])]?.hold??true)&&!d.word)){status('当作 Hold 时请填写 B 列写法。','error');return;}
  try{await rpc({type:'chaguiResolveHolds',decisions});status('已保存，查柜继续。','success');await loadHoldRules();}
  catch(error){status((error as Error).message,'error');}
}
// Row choices for containers on several rows: container → row number (0 = skip it this time).
export const rowChoices=reactive<Record<string,number>>({});
export async function answerRows(){
  const pending=chagui.run?.pending?.rows||[];
  if(pending.some((d:any)=>rowChoices[d.container]===undefined)){status('请为每个重复的柜号选一行，或选跳过。','error');return;}
  try{await rpc({type:'chaguiResolveRows',choices:Object.fromEntries(pending.map((d:any)=>[d.container,rowChoices[d.container]]))});status('已保存，查柜继续。','success');}
  catch(error){status((error as Error).message,'error');}
}
export async function stopChagui(){try{await rpc({type:'chaguiStop'});}catch(error){status((error as Error).message,'error');}}

/** Writes the last preview's changes as they are (each cell is still checked before it is written). */
export async function applyPreviewChagui(){
  if(demo){status('演示模式不会运行查柜。');return;}
  if(!await ask('按这次预览写入提柜表？写之前会核对每个格子没被人改过，改过的会跳过。'))return;
  starting.value=true;
  try{await rpc({type:'chaguiApplyPreview'});status('正在按预览写入。');await loadChagui();}
  catch(error){status((error as Error).message,'error');}
  finally{starting.value=false;}
}
/** Start again from the failed step; finished list steps are reused. A run that writes asks again. */
export async function retryChagui(){
  if(demo){status('演示模式不会运行查柜。');return;}
  if(chagui.run?.apply&&!await ask('重试会从失败的步骤继续，并写入提柜表。继续？'))return;
  starting.value=true;
  try{await rpc({type:'chaguiStart',retry:true});status('已从失败的步骤重试。');await loadChagui();}
  catch(error){status((error as Error).message,'error');}
  finally{starting.value=false;}
}
export async function downloadAirScript(file:string){
  try{
    const response=await fetch(`./airscript/${file}`);
    if(!response.ok)throw new Error('无法读取插件中的脚本。');
    const text=await response.text();
    const url=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));
    const a=document.createElement('a');a.href=url;a.download=file;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status((error as Error).message,'error');}
}
export const importText=ref('');
export const importing=ref(false);
export async function importChaguiCache(){
  if(demo){status('演示模式不会导入缓存。');return;}
  importing.value=true;
  try{const {count}=await rpc({type:'chaguiImport',text:importText.value});importText.value='';status(`已导入缓存：${count} 个柜号。`,'success');await loadChagui();}
  catch(error){status((error as Error).message,'error');}
  finally{importing.value=false;}
}
export async function exportChaguiCache(){
  try{
    const data=demo?{schemaVersion:1,containers:{}}:await rpc({type:'chaguiExport'});
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='chagui-cache.json';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status((error as Error).message,'error');}
}
// Matson 查柜: its own run (`matsonRun`), same preview → write pattern.
export const matson=reactive<{run:any,loaded:boolean}>({run:null,loaded:false});
export const matsonStarting=ref(false);
export async function loadMatson(){
  if(demo){matson.loaded=true;return;}
  try{Object.assign(matson,await rpc({type:'matsonState'}),{loaded:true});}catch(error){status((error as Error).message,'error');}
}
let listeningMatson=false;
export function watchMatson(){
  if(demo||listeningMatson)return;listeningMatson=true;
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.matsonRun)loadMatson();});
}
export async function startMatson(apply=false){
  if(demo){status('演示模式不会运行查柜。');return;}
  if(apply&&!await ask('查 Matson 柜子并写入提柜表：只改 B 列（ETA / HOLD 等）和 A 列 ✔。写之前会核对每个格子没被人改过。继续？'))return;
  matsonStarting.value=true;
  try{await rpc({type:'matsonStart',apply});status(apply?'查柜已在后台开始。':'预览已在后台开始，不会写表。');await loadMatson();}
  catch(error){status((error as Error).message,'error');}
  finally{matsonStarting.value=false;}
}
export async function applyPreviewMatson(){
  if(demo){status('演示模式不会运行查柜。');return;}
  if(!await ask('按这次预览写入提柜表？写之前会核对每个格子没被人改过，改过的会跳过。'))return;
  matsonStarting.value=true;
  try{await rpc({type:'matsonApplyPreview'});status('正在按预览写入。');await loadMatson();}
  catch(error){status((error as Error).message,'error');}
  finally{matsonStarting.value=false;}
}
export const timeText=(ms:number)=>ms?new Date(ms).toLocaleString():'';
export const duration=(run:any)=>run?.finishedAt?`${Math.round((run.finishedAt-run.startedAt)/1000)} 秒`:'';
