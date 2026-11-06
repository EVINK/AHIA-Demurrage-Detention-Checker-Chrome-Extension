// @ts-nocheck
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
  // A one-off edit from the query page may drop the container table; its text must still match.
  const tableOk=payload.edited?template.content.querySelectorAll('table').length<=1:template.content.querySelectorAll('table').length===1&&table?.textContent.includes(payload.container)&&table?.textContent.includes(payload.mbl);
  if(!tableOk||compact(template.content.textContent)!==compact(payload.bodyText))throw new Error('邮件正文模板与正文或柜号不符。');
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn,description,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const v=fn();if(v)return v;await pause(150);}const v=fn();if(v)return v;throw new Error(description);}
  const visible=e=>e&&e.getClientRects().length>0;
  const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const subject=await waitFor(()=>document.querySelector('input[name="subjectbox"]'),'Gmail 写信页未加载，或需要登录。');
  const body=await waitFor(()=>[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].find(visible),'未找到邮件正文。');
  // Kept untouched when the account has one; an account without a signature sends just the same.
  const signature=await waitFor(()=>body.querySelector('.gmail_signature'),'',4000).catch(()=>null);
  const addressesIn=text=>String(text||'').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g)||[];
  const pendingInputs=name=>[...document.querySelectorAll(`[name="${name}"] input,[name="${name}"] textarea`)];
  // One field: its chips, plus any plain or hidden input carrying the same name.
  function fieldAddresses(name){
    const chips=[...document.querySelectorAll(`[name="${name}"] [data-hovercard-id],[name="${name}"] [email]`)].flatMap(e=>addressesIn(e.getAttribute('data-hovercard-id')||e.getAttribute('email')));
    const inputs=[...pendingInputs(name),...document.querySelectorAll(`input[name="${name}"],textarea[name="${name}"]`)].flatMap(e=>addressesIn(e.value));
    return [...chips,...inputs];
  }
  // Until the recipient area is opened, Gmail shows To and Cc merged in one collapsed line and the Cc field has
  // no chips, so also read the whole recipient area. The message body stays out: a signature often contains
  // one of these very addresses and must not pass for a recipient.
  function recipientArea(){
    let root=subject.closest('form');
    if(!root){root=subject.parentElement;while(root.parentElement&&root.parentElement!==document.body&&!root.querySelector('[name="to"]'))root=root.parentElement;}
    const copy=root.cloneNode(true);
    copy.querySelectorAll('script,style,[contenteditable],.gmail_signature,[name="from"],[name="subjectbox"]').forEach(e=>e.remove());
    const attributes=[...copy.querySelectorAll('[data-hovercard-id],[email]')].flatMap(e=>addressesIn(e.getAttribute('data-hovercard-id')||e.getAttribute('email')));
    // Node by node: joined text runs one address into the next one and garbles both.
    const texts=[],walker=document.createTreeWalker(copy,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())texts.push(...addressesIn(walker.currentNode.nodeValue));
    return [...attributes,...texts];
  }
  // Every configured To / Cc must be on the page. Extra recipients (e.g. added by another auto-Cc/Bcc
  // extension the user also runs) are accepted. Returns '' when complete, else what is missing.
  function recipientMismatch(){
    const parts=[],merged=recipientArea();
    for(const [name,label,expected] of [['to','To',payload.to],['cc','Cc',payload.cc]]){
      const actual=new Set([...fieldAddresses(name),...merged]),missing=expected.map(v=>v.toLowerCase()).filter(v=>!actual.has(v));
      if(missing.length)parts.push(`${label} 缺少 ${missing.join(', ')}`);
    }
    return parts.join('；');
  }
  // Gmail's Cc shortcut opens the collapsed line and renders the real To and Cc fields; clicking it does not.
  function expandRecipients(){for(const type of ['keydown','keyup'])body.dispatchEvent(new KeyboardEvent(type,{key:'C',code:'KeyC',keyCode:67,which:67,ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));}
  function verify(){
    if(subject.value!==payload.subject)throw new Error('邮件主题发生变化。');
    const mismatch=recipientMismatch();
    if(mismatch)throw new Error(`Gmail 写信页中的收件人与配置不符（${mismatch}）。`);
    // Text still in a recipient box is fine when it is one of the configured addresses Gmail has yet to turn into a chip.
    const configured=[...payload.to,...payload.cc].map(v=>v.toLowerCase());
    for(const name of ['to','cc','bcc'])if(pendingInputs(name).some(e=>{const text=e.value.trim(),found=addressesIn(text);return text&&(!found.length||found.some(v=>!configured.includes(v)));}))throw new Error('存在尚未确认的收件地址。');
  }
  if(action==='prepare'){
    if(body.dataset.lfdRequest)throw new Error('此写信页已处理，不能重复插入。');
    // Gmail renders the recipient chips lazily (slower in a background tab): wait until they settle.
    await pause(1000);await waitFor(()=>!recipientMismatch(),'',4000).catch(()=>{});
    if(recipientMismatch()){expandRecipients();await waitFor(()=>!recipientMismatch(),'',6000).catch(()=>{});}
    verify();
    const originalSignature=signature?.outerHTML;
    // Whatever the new compose body already holds (Gmail's "Help me write" prompt and the like) is replaced; only the
    // signature, with its "--" prefix, stays.
    body.focus();const selection=window.getSelection(),range=document.createRange();
    let keep=signature?[...body.childNodes].find(node=>node.contains(signature)):null;
    if(keep?.previousSibling?.classList?.contains('gmail_signature_prefix'))keep=keep.previousSibling;
    range.setStart(body,0);if(keep)range.setEndBefore(keep);else range.setEnd(body,body.childNodes.length);
    if(!range.collapsed){selection.removeAllRanges();selection.addRange(range);document.execCommand('delete');}
    // Anything the delete left behind goes too.
    for(const node of [...body.childNodes]){if(keep&&(node===keep||keep.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING))break;node.remove();}
    range.selectNodeContents(body);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
    if(!document.execCommand('insertHTML',false,payload.html+'<br><br>'))throw new Error('Gmail 未接受正文插入。');
    body.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    await pause(300);
    if((!payload.edited&&(!body.textContent.includes(payload.container)||!body.textContent.includes(payload.mbl)))||!compact(body.textContent).startsWith(compact(payload.bodyText)))throw new Error('正文插入验证失败。');
    if(signature&&body.querySelector('.gmail_signature')?.outerHTML!==originalSignature)throw new Error('签名发生变化，已停止。');
    body.dataset.lfdRequest=payload.requestId;verify();
    return {ok:true,data:{bodyHash:await digest(body.innerHTML),signatureText:signature?.innerText||''}};
  }
  if(action!=='send')throw new Error('未知 Gmail 操作。');
  verify();
  if(body.dataset.lfdRequest!==payload.requestId||await digest(body.innerHTML)!==payload.bodyHash)throw new Error('草稿内容发生变化，已停止自动发送。');
  const send=[...document.querySelectorAll('[role="button"]')].filter(visible).filter(e=>/^(发送\s|Send\s)/.test(e.getAttribute('aria-label')||e.getAttribute('data-tooltip')||''));
  if(send.length!==1)throw new Error('无法唯一识别 Gmail 发送按钮。');
  let evidence='';
  const observer=new MutationObserver(()=>{
    const alerts=[...document.querySelectorAll('[role="alert"],[role="status"],.vh,.bAq')].filter(visible);
    const found=alerts.find(e=>/邮件已发送|Message sent/i.test(e.textContent));
    if(found)evidence=found.textContent.trim().slice(0,200);
  });
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  try{send[0].click();await waitFor(()=>evidence,'未收到发送成功提示，请核实 Gmail 已发送。',15000);return {ok:true,data:{confirmed:true,evidence}};}
  finally{observer.disconnect();}
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
