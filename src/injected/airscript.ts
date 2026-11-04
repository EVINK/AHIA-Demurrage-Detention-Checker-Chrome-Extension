// @ts-nocheck
// Self-contained function injected into a KDocs workbook's top frame (MAIN world). Runs one AirScript and reads its log.
// job = {
//   title: exact script title, or prefix when `prefix` is true,
//   group: 'shared' (文档共享脚本, never edited here) | 'mine' (我的脚本),
//   install?: {code, build}   only for 'mine': created when missing, replaced when its "TH build" is older,
//   expect: {type:'line', pattern}        success = a new log line matching `pattern` (RegExp source)
//         | {type:'chunks'}               success = TH_START / TH_CHUNK / TH_END printed by this run
//   timeout?: ms to wait for the result
// }
export async function airScriptPage(job){
  try{
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn,description,timeout=20000){
    const end=Date.now()+timeout;
    while(Date.now()<end){const value=fn();if(value)return value;await pause(150);}
    const value=fn();if(value)return value;
    throw new Error(description);
  }
  const visible=e=>e&&e.getClientRects().length>0;
  const exact=(doc,selector,text)=>[...doc.querySelectorAll(selector)].find(e=>visible(e)&&(e.innerText??e.textContent).trim()===text);
  const LABELS={
    advanced:['高级开发','Advanced Development','進階開發','高級開發'],
    editor:['AirScript脚本编辑器','AirScript Script Editor','AirScript腳本編輯器'],
    mine:['我的脚本','My Scripts','我的腳本'],
    shared:['文档共享脚本','Document Shared Scripts','Shared Scripts','文檔共享腳本','文件共用腳本']
  };
  const label=(doc,selector,key)=>{for(const text of LABELS[key]){const found=exact(doc,selector,text);if(found)return found;}return null;};
  const buildOf=code=>Number(String(code||'').match(/TH build:\s*(\d+)/)?.[1]||0);
  let frame=document.querySelector('#excelIde');
  if(!frame||!visible(frame)){
    const tools=await waitFor(()=>document.querySelector('#ToolsTab'),'金山文档尚未加载，或当前不是表格页面。');
    tools.click();
    let advanced;
    try{advanced=await waitFor(()=>label(document,'button,[role="button"]','advanced'),'',4000);}
    catch{tools.click();advanced=await waitFor(()=>label(document,'button,[role="button"]','advanced'),'未找到高级开发（Advanced Development）入口。');}
    advanced.click();
    (await waitFor(()=>label(document,'[role="option"],[role="menuitem"]','editor'),'未找到 AirScript 编辑器。')).click();
    frame=await waitFor(()=>{const f=document.querySelector('#excelIde');return visible(f)&&f;},'脚本编辑器未打开。');
  }
  // A workbook without document scripts opens on a welcome page: no #run-script until a script is selected.
  const doc=await waitFor(()=>frame.contentDocument?.querySelector('.title-content')&&frame.contentDocument,'脚本编辑器尚未加载或需要登录。');
  const groupOf=key=>{const title=label(doc,'.title-content',key);return title?{title,box:title.closest('.listItem')}:null;};
  const titleMatches=text=>job.prefix?text.startsWith(job.title):text===job.title;
  const found=()=>{
    const group=groupOf(job.group);
    return group?[...group.box.querySelectorAll('.scriptListItem')].filter(e=>titleMatches(e.querySelector('.ks-title')?.textContent.trim()||'')):[];
  };
  const group=await waitFor(()=>groupOf(job.group),job.group==='shared'?'未找到“文档共享脚本”分组，请检查金山文档登录状态。':'未找到“我的脚本”分组，请检查金山文档登录状态。');
  // Do not collapse an already-open group whose records are still loading.
  if(!group.box?.classList.contains('open'))group.title.click();
  const listed=()=>{const list=found();return list.length?list:null;};
  let items=await waitFor(listed,'',job.install?8000:20000).catch(()=>null);
  if(!items){
    // The group can close again while its list loads: open it once more before deciding the script is missing.
    const again=groupOf(job.group);if(again&&!again.box?.classList.contains('open'))again.title.click();
    items=await waitFor(listed,'',5000).catch(()=>null);
  }
  if(!items){
    if(!job.install||job.group!=='mine')throw new Error(`没有找到脚本“${job.title}”，请检查它是否还在这份表格里。`);
    const add=groupOf('mine')?.box?.querySelector('.dropdown-version-left-btn');
    if(!add)throw new Error('找不到“我的脚本”的新建按钮，无法自动安装脚本。');
    add.click();
    const input=await waitFor(()=>[...doc.querySelectorAll('input.ant-input')].find(visible),'新建脚本后没有出现命名输入框。');
    Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype,'value').set.call(input,job.title);
    input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    input.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    try{items=await waitFor(()=>{const list=found();return list.length?list:null;},'',2000);}
    catch{input.blur();input.dispatchEvent(new frame.contentWindow.FocusEvent('focusout',{bubbles:true}));
      items=await waitFor(()=>{const list=found();return list.length?list:null;},'自动安装脚本时命名失败。');}
  }
  if(items.length!==1)throw new Error(`存在多个“${job.title}”脚本，请只保留一个。`);
  const item=items[0];
  // The chosen entry itself must be the active one; other panels can hold their own .active items.
  const activeTitle=()=>item.isConnected&&item.classList.contains('active')?item.querySelector('.ks-title')?.textContent.trim()||'':'';
  if(!item.classList.contains('active'))item.querySelector('.ks-title').click();
  await waitFor(()=>item.classList.contains('active'),'没有选中脚本。');
  await pause(400);
  if(!titleMatches(activeTitle()))throw new Error('选中的脚本发生变化，已停止。');
  const model=()=>frame.contentWindow.monaco?.editor?.getModels().find(m=>!/^var Context/.test(m.getLineContent(1)));
  let installed=false;
  if(job.install){
    const current=await waitFor(()=>{const m=model();if(!m)return null;const v=m.getValue();return v.includes('TH build')||!v.trim()?{text:v}:null;},'脚本代码未加载。');
    if(buildOf(current.text)<job.install.build){
      if(current.text.trim()&&!current.text.includes('TH build'))throw new Error(`“${job.title}”的内容不是插件的脚本，已停止以避免覆盖。`);
      model().setValue(job.install.code);
      const save=doc.querySelector('button .kd-icon-save')?.closest('button');
      if(!save)throw new Error('找不到脚本保存按钮，无法更新脚本。');
      save.click();await pause(1500);
      if(!titleMatches(activeTitle())||model().getValue()!==job.install.code)throw new Error('更新脚本失败，请稍后重试。');
      installed=true;
    }
  }
  // The log list is virtual for long runs: read its full data from React props (MAIN world only), else the DOM.
  // The rendered text of an entry is cut at about 1000 characters, so prefer the data behind it.
  function logData(){
    const holder=[...doc.querySelectorAll('.rc-virtual-list-holder')].find(h=>h.querySelector('.logItem'));
    const start=holder?.closest('.rc-virtual-list')||doc.querySelector('.logItem');
    const key=start&&Object.keys(start).find(k=>k.startsWith('__reactFiber'));
    for(let fiber=key&&start[key],depth=0;fiber&&depth<25;fiber=fiber.return,depth++){
      const props=fiber.memoizedProps||{};
      for(const data of [props.data,props.logs,props.list,props.items]){
        if(Array.isArray(data)&&data.length&&data.every(entry=>Array.isArray(entry?.args)))return data.map(entry=>entry.args.map(String).join(' '));
      }
    }
    return null;
  }
  // Rendered entries: time, level, message, source. The time stamp keeps each entry distinct between runs.
  const domItems=()=>[...doc.querySelectorAll('.logItem')].map(e=>e.innerText.trim());
  const lines=()=>logData()||domItems().map(text=>text.split('\n').slice(2,-1).join('\n')||text);
  const beforeItems=new Set(domItems());
  const beforeLines=lines();
  const errorOf=()=>{
    for(const text of domItems()){
      if(beforeItems.has(text))continue;
      const [,level,...rest]=text.split('\n');
      if(/^(错误|error|錯誤)$/i.test(String(level).trim()))return rest.join(' ').trim();
    }
    return '';
  };
  const run=await waitFor(()=>doc.querySelector('#run-script'),'脚本编辑器尚未加载或需要登录。');
  if(run.disabled)throw new Error('脚本正在运行，请稍后重试。');
  run.click();
  const timeout=job.timeout||60000;
  if(job.expect.type==='line'){
    const pattern=new RegExp(job.expect.pattern);
    const seen=new Set(beforeLines.filter(l=>pattern.test(l)));
    const line=await waitFor(()=>{
      const error=errorOf();if(error)throw new Error('脚本运行出错：'+error);
      return lines().find(l=>pattern.test(l)&&!seen.has(l));
    },`等待脚本“${job.title}”的运行结果超时。`,timeout);
    return {ok:true,data:{line:line.trim(),installed}};
  }
  const previous=beforeLines.filter(l=>l.startsWith('TH_START:{')).at(-1);
  return {ok:true,data:await waitFor(()=>{
    const error=errorOf();if(error)throw new Error('脚本运行出错：'+error);
    const all=lines();
    const startIndex=all.findLastIndex(l=>l.startsWith('TH_START:{'));
    const start=all[startIndex];
    if(!start||start===previous)return null;
    let meta;try{meta=JSON.parse(start.slice(9));}catch{return null;}
    const endIndex=all.indexOf('TH_END:'+meta.id,startIndex+1);
    if(endIndex===-1)return null;
    let pieces;
    try{pieces=all.slice(startIndex+1,endIndex).filter(l=>l.startsWith('TH_CHUNK:')).map(l=>JSON.parse(l.slice(9)));}
    catch{throw new Error('脚本日志分段损坏，不能使用部分数据。');}
    if(pieces.some(p=>!p||p.id!==meta.id)||pieces.length!==meta.chunks)throw new Error('脚本日志不完整，不能使用部分数据。');
    pieces.sort((a,b)=>a.index-b.index);
    const rows=pieces.flatMap(p=>p.rows||[]);
    if(rows.length!==meta.count)throw new Error('脚本结果数量不符，不能使用部分数据。');
    if(job.install&&!(meta.build>=job.install.build))throw new Error('运行的脚本版本过旧，请重试。');
    return {meta,rows,installed};
  },`等待脚本“${job.title}”的运行结果超时。`,timeout)};
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
