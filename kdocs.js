// Self-contained function injected into the workbook's top frame (MAIN world, see logLines).
export async function readKdocsPage(script) {
  try {
  // script: {name, code, build} bundled with the extension. The account's 「我的脚本」 copy is
  // installed when missing and replaced when its "LFD build" is older; cells are never written.
  const name=script?.name||'LFD_ReadOnly_v1';
  const buildOf=code=>Number(String(code||'').match(/LFD build:\s*(\d+)/)?.[1]||0);
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn,description,timeout=20000){
    const end=Date.now()+timeout;
    while(Date.now()<end){const value=fn();if(value)return value;await pause(150);}
    // Background tabs get throttled timers; check once more after the deadline.
    const value=fn();if(value)return value;
    throw new Error(description);
  }
  const visible=e=>e&&e.getClientRects().length>0;
  // SVG icons can embed <style> nodes: textContent includes their CSS, whereas
  // innerText is the label a user actually sees on the toolbar.
  const exact=(doc,selector,text)=>[...doc.querySelectorAll(selector)].find(e=>visible(e)&&(e.innerText??e.textContent).trim()===text);
  // KDocs UI labels by language (zh-CN and en verified; zh-TW best effort). Structure and ids are language-independent.
  const LABELS={
    advanced:['高级开发','Advanced Development','進階開發','高級開發'],
    editor:['AirScript脚本编辑器','AirScript Script Editor','AirScript腳本編輯器'],
    myScripts:['我的脚本','My Scripts','我的腳本']
  };
  const label=(doc,selector,key)=>{for(const text of LABELS[key]){const found=exact(doc,selector,text);if(found)return found;}return null;};
  let frame=document.querySelector('#excelIde');
  if(!frame||!visible(frame)){
    const tools=await waitFor(()=>document.querySelector('#ToolsTab'),'金山文档尚未加载，或当前不是表格页面。');
    tools.click();
    // Clicking the already-selected Tools tab collapses the ribbon; click once more if the entry stays hidden.
    let advanced;
    try{advanced=await waitFor(()=>label(document,'button,[role="button"]','advanced'),'',4000);}
    catch{tools.click();advanced=await waitFor(()=>label(document,'button,[role="button"]','advanced'),'未找到高级开发（Advanced Development）入口。');}
    advanced.click();
    // Click the actionable option, never its identically labelled outer wrapper.
    (await waitFor(()=>label(document,'[role="option"],[role="menuitem"]','editor'),'未找到 AirScript 编辑器。')).click();
    frame=await waitFor(()=>{const f=document.querySelector('#excelIde');return visible(f)&&f;},'脚本编辑器未打开。');
  }
  const doc=await waitFor(()=>frame.contentDocument?.querySelector('#run-script')&&frame.contentDocument,'脚本编辑器尚未加载或需要登录。');
  const ownScripts=()=>[...doc.querySelectorAll('.scriptListItem')].filter(e=>e.querySelector('.ks-title')?.textContent.trim()==='LFD_ReadOnly_v1');
  const myScripts=()=>waitFor(()=>label(doc,'.title-content','myScripts'),'未找到“我的脚本”（My Scripts）分组，请检查金山文档登录状态。');
  if(!ownScripts().length){
    const group=await myScripts();
    // Only the title is actionable; the identically labelled listItem is not.
    // Do not collapse an already-open group whose records are still loading.
    if(!group.closest('.listItem')?.classList.contains('open'))group.click();
  }
  const model=()=>frame.contentWindow.monaco?.editor?.getModels().find(m=>!/^var Context/.test(m.getLineContent(1)));
  const activeTitle=()=>doc.querySelector('.scriptListItem.active .ks-title')?.textContent.trim();
  let items;
  try{items=await waitFor(()=>{const found=ownScripts();return found.length?found:null;},'',script?8000:20000);}
  catch{
    if(!script)throw new Error('“我的脚本”中未加载到 LFD_ReadOnly_v1，请检查账号和脚本是否存在。');
    // Not installed for this account yet: create it under 「我的脚本」 and name it.
    const add=(await myScripts()).closest('.listItem')?.querySelector('.dropdown-version-left-btn');
    if(!add)throw new Error('找不到“我的脚本”的新建按钮，无法自动安装只读脚本。');
    add.click();
    const input=await waitFor(()=>[...doc.querySelectorAll('input.ant-input')].find(visible),'新建脚本后没有出现命名输入框。');
    Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype,'value').set.call(input,name);
    input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    input.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    // Enter usually commits the name; blurring the field is the fallback that also commits it.
    try{items=await waitFor(()=>{const found=ownScripts();return found.length?found:null;},'',2000);}
    catch{input.blur();input.dispatchEvent(new frame.contentWindow.FocusEvent('focusout',{bubbles:true}));
      items=await waitFor(()=>{const found=ownScripts();return found.length?found:null;},'自动安装只读脚本时命名失败。');}
  }
  if(items.length!==1)throw new Error('“我的脚本”中存在多个 LFD_ReadOnly_v1，请保留唯一的查询脚本。');
  if(!items[0].classList.contains('active'))items[0].querySelector('.ks-title').click();
  await waitFor(()=>items[0].classList.contains('active'),'没有选中只读脚本。');
  await pause(350);
  if(activeTitle()!==name)throw new Error('选中的脚本发生变化，已停止。');
  let installed=false;
  if(script){
    // A brand-new script has an empty model; an existing one loads its saved code.
    const current=await waitFor(()=>{const m=model();if(!m)return null;const v=m.getValue();return v.includes('LFD_')||!v.trim()?{text:v}:null;},'只读脚本代码未加载。');
    if(buildOf(current.text)<script.build){
      if(current.text.trim()&&!current.text.includes('LFD_'))throw new Error('LFD_ReadOnly_v1 的内容不是查询脚本，已停止以避免覆盖。');
      model().setValue(script.code);
      const save=doc.querySelector('button .kd-icon-save')?.closest('button');
      if(!save)throw new Error('找不到脚本保存按钮，无法更新只读脚本。');
      save.click();await pause(1500);
      if(activeTitle()!==name||model().getValue()!==script.code)throw new Error('更新只读脚本失败，请稍后重试。');
      installed=true;
    }
  }
  await waitFor(()=>[...doc.querySelectorAll('.view-lines')].some(e=>e.textContent.includes('LFD_')),'只读脚本代码未加载，请先在编辑器中定位脚本顶部。');
  // The log panel is a virtual list that only renders the few visible rows, so a long run's
  // LFD_START is not in the DOM. Read the list's full data from its React props instead
  // (only visible in the page's MAIN world); fall back to the rendered text otherwise.
  function logLines(){
    const holder=[...doc.querySelectorAll('.rc-virtual-list-holder')].find(h=>h.querySelector('.logItem'));
    const list=holder?.closest('.rc-virtual-list');
    const key=list&&Object.keys(list).find(k=>k.startsWith('__reactFiber'));
    for(let fiber=key&&list[key],depth=0;fiber&&depth<15;fiber=fiber.return,depth++){
      const data=fiber.memoizedProps?.data;
      if(Array.isArray(data)&&data.every(item=>Array.isArray(item?.args)))return data.map(item=>item.args.map(String).join(' '));
    }
    return doc.body.innerText.split('\n');
  }
  const previous=logLines().filter(l=>l.startsWith('LFD_START:{')).at(-1);
  const run=doc.querySelector('#run-script');
  if(!run||run.disabled)throw new Error('脚本正在运行，请稍后重试。');
  run.click();
  return {ok:true,data:await waitFor(()=>{
    const lines=logLines();
    const startIndex=lines.findLastIndex(l=>l.startsWith('LFD_START:{'));
    const start=lines[startIndex];
    if(!start||start===previous)return null;
    let meta;try{meta=JSON.parse(start.slice(10));}catch{return null;}
    const endIndex=lines.indexOf('LFD_END:'+meta.id,startIndex+1);
    if(endIndex===-1)return null;
    let pieces;
    try{pieces=lines.slice(startIndex+1,endIndex).filter(l=>l.startsWith('LFD_CHUNK:')).map(l=>JSON.parse(l.slice(10)));}
    catch{throw new Error('本次查询日志分段损坏，不能使用部分数据。');}
    if(pieces.some(p=>!p||p.id!==meta.id))throw new Error('本次查询日志混入其他运行的数据，已停止。');
    if(meta.sheet!=='提柜'||!Number.isInteger(meta.count)||meta.count<0||!Number.isInteger(meta.chunks)||meta.chunks<0||pieces.length!==meta.chunks)throw new Error('查询日志不完整，不能使用部分数据。');
    pieces.sort((a,b)=>a.index-b.index);
    if(pieces.some((p,i)=>p.index!==i||!Array.isArray(p.rows)))throw new Error('查询日志分段异常。');
    const rows=pieces.flatMap(p=>p.rows);
    if(rows.length!==meta.count||rows.some(r=>!Array.isArray(r)||![3,4].includes(r.length)||typeof r[0]!=='string'||typeof r[1]!=='string'||!Number.isInteger(r[2])||(r.length===4&&typeof r[3]!=='string')))throw new Error('查询结果校验失败。');
    if(script&&!(meta.build>=script.build))throw new Error('运行的只读脚本版本过旧，请重试或检查“我的脚本”中的 LFD_ReadOnly_v1。');
    return {readAt:Date.now(),installed,build:meta.build,records:rows.map(r=>({container:r[0],mbl:r[1],row:r[2],...(r.length===4?{carrier:r[3]}:{})})),cancelledSections:meta.cancelledSections,skippedRows:meta.skippedRows};
  },'没有得到完整的新查询结果。请查看只读脚本日志。',30000)};
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
