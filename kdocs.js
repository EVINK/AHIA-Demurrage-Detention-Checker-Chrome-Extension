// Self-contained function injected into the workbook's top frame.
export async function readKdocsPage() {
  try {
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn,description,timeout=20000){
    const end=Date.now()+timeout;
    while(Date.now()<end){const value=fn();if(value)return value;await pause(150);}
    throw new Error(description);
  }
  const visible=e=>e&&e.getClientRects().length>0;
  // SVG icons can embed <style> nodes: textContent includes their CSS, whereas
  // innerText is the label a user actually sees on the toolbar.
  const exact=(doc,selector,text)=>[...doc.querySelectorAll(selector)].find(e=>visible(e)&&(e.innerText??e.textContent).trim()===text);
  let frame=document.querySelector('#excelIde');
  if(!frame||!visible(frame)){
    const tools=await waitFor(()=>document.querySelector('#ToolsTab'),'金山文档尚未加载，或当前不是表格页面。');
    tools.click();
    (await waitFor(()=>exact(document,'button,[role="button"]','高级开发'),'未找到高级开发入口。')).click();
    // Click the actionable option, never its identically labelled outer wrapper.
    (await waitFor(()=>exact(document,'[role="option"],[role="menuitem"]','AirScript脚本编辑器'),'未找到 AirScript 编辑器。')).click();
    frame=await waitFor(()=>{const f=document.querySelector('#excelIde');return visible(f)&&f;},'脚本编辑器未打开。');
  }
  const doc=await waitFor(()=>frame.contentDocument?.querySelector('#run-script')&&frame.contentDocument,'脚本编辑器尚未加载或需要登录。');
  const ownScripts=()=>[...doc.querySelectorAll('.scriptListItem')].filter(e=>e.querySelector('.ks-title')?.textContent.trim()==='LFD_ReadOnly_v1');
  if(!ownScripts().length){
    const group=await waitFor(()=>exact(doc,'.title-content','我的脚本'),'未找到“我的脚本”分组，请检查金山文档登录状态。');
    // Only the title is actionable; the identically labelled listItem is not.
    // Do not collapse an already-open group whose records are still loading.
    if(!group.closest('.listItem')?.classList.contains('open'))group.click();
  }
  const items=await waitFor(()=>{const found=ownScripts();return found.length?found:null;},'“我的脚本”中未加载到 LFD_ReadOnly_v1，请检查账号和脚本是否存在。');
  if(items.length!==1)throw new Error('“我的脚本”中存在多个 LFD_ReadOnly_v1，请保留唯一的查询脚本。');
  items[0].querySelector('.ks-title').click();
  await waitFor(()=>items[0].classList.contains('active'),'没有选中只读脚本。');
  await pause(350);
  if(doc.querySelector('.scriptListItem.active .ks-title')?.textContent.trim()!=='LFD_ReadOnly_v1')throw new Error('选中的脚本发生变化，已停止。');
  await waitFor(()=>[...doc.querySelectorAll('.view-lines')].some(e=>e.textContent.includes('LFD_')),'只读脚本代码未加载，请先在编辑器中定位脚本顶部。');
  const previous=doc.body.innerText.split('\n').filter(l=>l.startsWith('LFD_START:{')).at(-1);
  const run=doc.querySelector('#run-script');
  if(!run||run.disabled)throw new Error('脚本正在运行，请稍后重试。');
  run.click();
  return {ok:true,data:await waitFor(()=>{
    const lines=doc.body.innerText.split('\n');
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
    return {readAt:Date.now(),records:rows.map(r=>({container:r[0],mbl:r[1],row:r[2],...(r.length===4?{carrier:r[3]}:{})})),stoppedAtCancellation:meta.stoppedAtCancellation};
  },'没有得到完整的新查询结果。请查看只读脚本日志。',30000)};
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
