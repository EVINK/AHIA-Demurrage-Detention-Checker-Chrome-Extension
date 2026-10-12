// Self-contained DOM adapter; only run in a NEW compose tab created by this extension.
export async function gmailPage(action,payload){
  try {
  const email=/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;
  if(!payload||!Array.isArray(payload.to)||!payload.to.length||!Array.isArray(payload.cc)||[...payload.to,...payload.cc].some(v=>typeof v!=='string'||!email.test(v)))throw new Error('邮件收件地址配置缺失或格式不正确。');
  if(typeof payload.bodyText!=='string'||!payload.bodyText.trim()||typeof payload.html!=='string'||!payload.html.trim()||payload.html.length>20000)throw new Error('邮件正文模板缺失或格式不正确。');
  const template=document.createElement('template');template.innerHTML=payload.html;
  const allowedTags=new Set(['P','TABLE','THEAD','TBODY','TR','TH','TD','BR']);
  for(const element of template.content.querySelectorAll('*')){
    if(!allowedTags.has(element.tagName))throw new Error('邮件正文模板含有不允许的 HTML。');
    for(const attribute of element.attributes){
      if(attribute.name==='style'){
        if(/url\s*\(|expression\s*\(|@|\\|[<>]/i.test(attribute.value))throw new Error('邮件正文模板含有不允许的 HTML 样式。');
      }else if(!(element.tagName==='TABLE'&&['cellpadding','cellspacing'].includes(attribute.name)&&/^\d{1,2}$/.test(attribute.value)))throw new Error('邮件正文模板含有不允许的 HTML 属性。');
    }
  }
  const compact=value=>value.replace(/\s+/g,'');
  const table=template.content.querySelector('table');
  if(template.content.querySelectorAll('table').length!==1||!table?.textContent.includes(payload.container)||!table?.textContent.includes(payload.mbl)||compact(template.content.textContent)!==compact(payload.bodyText))throw new Error('邮件正文模板与正文或柜号不符。');
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn,description,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const v=fn();if(v)return v;await pause(150);}throw new Error(description);}
  const visible=e=>e&&e.getClientRects().length>0;
  const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const subject=await waitFor(()=>document.querySelector('input[name="subjectbox"]'),'Gmail 写信页未加载，或需要登录。');
  const body=await waitFor(()=>[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].find(visible),'未找到邮件正文。');
  const signature=await waitFor(()=>body.querySelector('.gmail_signature'),'未检测到 Gmail 原签名，已停止。');
  function account(){
    const from=document.querySelector('input[name="from"]');
    if(!from)throw new Error('无法识别 Gmail 发件人控件，已停止。');
    const explicit=from.value?.trim();
    const title=document.title.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    if(!explicit){
      const fromControl=[...document.querySelectorAll('select[name="from"],[aria-label],[data-tooltip]')].filter(visible).some(e=>e.matches('select[name="from"]')||/^(From\b|发件人)/i.test(e.getAttribute('aria-label')||e.getAttribute('data-tooltip')||''));
      const fromLabel=[...document.querySelectorAll('label,td,span')].filter(visible).some(e=>/^(From|发件人)\s*[:：]?$/i.test(e.textContent.trim()));
      if(fromControl||fromLabel)throw new Error('检测到发件地址选择器，但无法核实所选别名，已停止。');
    }
    return (explicit||title||'').toLowerCase();
  }
  const chips=name=>[...document.querySelectorAll(`[name="${name}"] [role="option"][data-hovercard-id]`)];
  const addresses=name=>chips(name).map(e=>e.getAttribute('data-hovercard-id').toLowerCase()).sort();
  const equal=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  function verify(){
    if(account()!==payload.account.toLowerCase())throw new Error('当前 Gmail 发件账号与设置不符。');
    if(subject.value!==payload.subject)throw new Error('邮件主题发生变化。');
    if(!equal(addresses('to'),payload.to.map(v=>v.toLowerCase()))||!equal(addresses('cc'),payload.cc.map(v=>v.toLowerCase()))||addresses('bcc').length)throw new Error('收件人、抄送或密送与配置不符。请检查其他自动抄送插件。');
    for(const name of ['to','cc','bcc'])if([...document.querySelectorAll(`[name="${name}"] input`)].some(e=>e.value.trim()))throw new Error('存在尚未确认的收件地址。');
    if(!signature.textContent.trim()&&!signature.querySelector('img'))throw new Error('签名为空。');
  }
  if(action==='prepare'){
    if(body.dataset.lfdRequest)throw new Error('此写信页已处理，不能重复插入。');
    await pause(1000);verify();
    const originalSignature=signature.outerHTML;
    const clone=body.cloneNode(true);clone.querySelectorAll('.gmail_signature').forEach(e=>e.remove());
    if(clone.textContent.trim())throw new Error('写信页已有正文，已停止以避免覆盖。');
    body.focus();const selection=window.getSelection(),range=document.createRange();
    range.selectNodeContents(body);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
    if(!document.execCommand('insertHTML',false,payload.html+'<br><br>'))throw new Error('Gmail 未接受正文插入。');
    body.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    await pause(300);
    if(!body.textContent.includes(payload.container)||!body.textContent.includes(payload.mbl)||!compact(body.textContent).startsWith(compact(payload.bodyText)))throw new Error('正文插入验证失败。');
    if(body.querySelector('.gmail_signature')?.outerHTML!==originalSignature)throw new Error('签名发生变化，已停止。');
    body.dataset.lfdRequest=payload.requestId;verify();
    return {ok:true,data:{bodyHash:await digest(body.innerHTML),signatureText:signature.innerText}};
  }
  if(action!=='send')throw new Error('未知 Gmail 操作。');
  verify();
  if(body.dataset.lfdRequest!==payload.requestId||await digest(body.innerHTML)!==payload.bodyHash)throw new Error('草稿内容发生变化，已停止自动发送。');
  const send=[...document.querySelectorAll('[role="button"]')].filter(visible).filter(e=>/^(发送\s|Send\s)/.test(e.getAttribute('aria-label')||e.getAttribute('data-tooltip')||''));
  if(send.length!==1)throw new Error('无法唯一识别 Gmail 发送按钮。');
  let evidence='';
  const observer=new MutationObserver(()=>{
    const alerts=[...document.querySelectorAll('[role="alert"],[role="status"],.vh,.bAq')].filter(visible);
    const found=alerts.find(e=>/邮件已发送|已发送邮件|Message sent/i.test(e.textContent));
    if(found)evidence=found.textContent.trim().slice(0,200);
  });
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  try{send[0].click();await waitFor(()=>evidence,'未收到发送成功提示，请核实 Gmail 已发送。',15000);return {ok:true,data:{confirmed:true,evidence}};}
  finally{observer.disconnect();}
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
