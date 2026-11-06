// OOCL Demurrage LFD in the popup: the account form on the config page and the run on the query page. The run
// and the account belong to the worker (src/background/oocl.ts); the password is sent once and never read back.
import {reactive,ref,watch} from 'vue';
import {ask,demo,status,ooclAccount,loadOoclAccount,resumeOocl,ooclStarted,refreshState} from './store.ts';

async function rpc(message:any){
  const response=await chrome.runtime.sendMessage(message);
  if(!response?.ok)throw new Error(response?.error||'插件没有响应。');
  return response.data;
}
export const ooclForm=reactive({username:'',password:'',checking:false,result:'',ok:false});
// What the user typed but has not confirmed yet survives the popup closing: it is kept as a draft in
// chrome.storage.local (this machine's extension storage only, never synced or exported) and cleared once the
// account is saved or deleted.
const DRAFT_KEY='ooclDraft';
let draft:{username:string,password:string}|null=null;
let draftLoaded=false;
function applyDraft(){if(draft&&!ooclForm.checking){ooclForm.username=draft.username;ooclForm.password=draft.password;}}
function clearDraft(){draft=null;if(!demo)chrome.storage.local.remove(DRAFT_KEY).catch(()=>{});}
if(!demo)chrome.storage.local.get(DRAFT_KEY).then(data=>{
  const saved=data?.[DRAFT_KEY];
  if(saved&&typeof saved.username==='string'&&typeof saved.password==='string')draft={username:saved.username,password:saved.password};
  draftLoaded=true;applyDraft();
}).catch(()=>{draftLoaded=true;});
watch(()=>[ooclForm.username,ooclForm.password],([username,password])=>{
  if(demo||!draftLoaded||ooclForm.checking)return;
  if(username===ooclAccount.username&&!password){clearDraft();return;}
  draft={username,password};
  chrome.storage.local.set({[DRAFT_KEY]:draft}).catch(()=>{});
});
export function fillOoclForm(){ooclForm.username=ooclAccount.username;ooclForm.password='';ooclForm.result=ooclAccount.saved?(ooclAccount.checkedAt?`已保存 · 上次检查通过 ${new Date(ooclAccount.checkedAt).toLocaleString()}`:'已保存'):'';ooclForm.ok=ooclAccount.saved;applyDraft();}
/** 确定并检查连通性: saves the account (an empty password keeps the saved one) and signs in once. */
export async function checkOocl(){
  if(demo){status('演示模式不会连接 OOCL。');return;}
  ooclForm.checking=true;ooclForm.result='正在登录 OOCL 检查…';ooclForm.ok=false;
  try{
    Object.assign(ooclAccount,await rpc({type:'ooclSaveAccount',username:ooclForm.username,password:ooclForm.password}));
    clearDraft();ooclForm.password='';ooclForm.ok=true;ooclForm.result='连通性正常，账号已保存在本机插件里。';
    status('OOCL 账号检查通过。','success');
    resumeOocl();
  }catch(error){ooclForm.result=(error as Error).message;status((error as Error).message,'error');await loadOoclAccount();}
  finally{ooclForm.checking=false;}
}
export async function clearOocl(){
  if(!await ask('删除插件里保存的 OOCL 账号密码？'))return;
  try{Object.assign(ooclAccount,await rpc({type:'ooclClearAccount'}));clearDraft();fillOoclForm();status('OOCL 账号已删除。');}catch(error){status((error as Error).message,'error');}
}

export const oocl=reactive<{run:any,loaded:boolean}>({run:null,loaded:false});
export const ooclWriting=ref(false);
export async function loadOocl(){
  if(demo){oocl.loaded=true;return;}
  try{const data=await rpc({type:'ooclState'});oocl.run=data.run;Object.assign(ooclAccount,data.account);oocl.loaded=true;}catch(error){status((error as Error).message,'error');}
}
let listening=false;
export function watchOocl(){
  if(demo||listening)return;listening=true;
  // The run's records (记录, the query page's locks) change with it.
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.ooclRun)loadOocl();if(changes.ledger&&oocl.run)refreshState().catch(()=>{});});
  watch(ooclStarted,()=>loadOocl());
}
export async function applyPreviewOocl(){
  if(demo){status('演示模式不会写表。');return;}
  if(!await ask('写入这次查询的结果？Draydog 写 SSL LFD note，提柜表 K 列写入较早的 LFD（写之前核对格子没被人改过）。'))return;
  ooclWriting.value=true;
  try{await rpc({type:'ooclApplyPreview'});status('正在按查询结果写入。');await loadOocl();}
  catch(error){status((error as Error).message,'error');}
  finally{ooclWriting.value=false;}
}
export async function dismissOocl(){if(!demo)await chrome.storage.local.remove('ooclRun').catch(()=>{});oocl.run=null;}
