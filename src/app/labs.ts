// 实验性功能 page state: the 查柜 run and its cache, both owned by the worker (src/background/chagui.ts).
import {reactive,ref} from 'vue';
import {demo,status} from './store.ts';

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
export async function startChagui(){
  if(demo){status('演示模式不会运行查柜。');return;}
  starting.value=true;
  try{await rpc({type:'chaguiStart'});status('查柜已在后台开始。');await loadChagui();}
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
export const timeText=(ms:number)=>ms?new Date(ms).toLocaleString():'';
export const duration=(run:any)=>run?.finishedAt?`${Math.round((run.finishedAt-run.startedAt)/1000)} 秒`:'';
