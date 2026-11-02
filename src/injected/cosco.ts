// @ts-nocheck
// Self-contained DOM adapter; only run in a NEW COSCO USA ticket tab created by this extension.
// The reCAPTCHA is always completed by the user; this adapter only waits for it.
export async function coscoPage(action,payload){
  try {
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn,description,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const v=fn();if(v)return v;await pause(150);}const v=fn();if(v)return v;throw new Error(description);}
  const visible=e=>e&&e.getClientRects().length>0;
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
  const compact=value=>String(value||'').replace(/\s+/g,'');
  if(action==='result'){
    const ticket=location.pathname.match(/^\/support\/tickets\/(\d+)/)?.[1];
    const text=document.body?.innerText||'';
    const notice=text.match(/[^\n]*(ticket has been[^\n]*(submitted|created)|successfully (submitted|created)|工单已(提交|创建))[^\n]*/i)?.[0];
    if(ticket||notice)return {ok:true,data:{confirmed:true,ticketId:ticket||'',evidence:(notice||location.pathname).trim().slice(0,200)}};
    const form=document.querySelector('form#new_helpdesk_ticket');
    const errors=[...document.querySelectorAll('label.error,.error-message,.alert-error,.alert-danger')].filter(visible).map(e=>e.innerText.trim()).filter(Boolean);
    return {ok:true,data:{confirmed:false,formStillOpen:visible(form),reason:errors.join(' ').slice(0,300)}};
  }
  if(!payload||typeof payload.html!=='string'||!payload.html.trim()||payload.html.length>20000||typeof payload.bodyText!=='string')throw new Error('工单正文模板缺失或格式不正确。');
  for(const key of ['requester','container','mbl'])if(typeof payload[key]!=='string'||!payload[key].trim())throw new Error('工单字段配置缺失。');
  // The ticket's own fields, filled in order (later ones appear only after earlier selects are chosen):
  // [{label, value, kind:'select'|'input'}]. Detention: Shipment Type / Per Diem Services / PD INV…;
  // On-Hire: Type / Services / Region / Number of Containers / Container # / SCAC Code.
  if(!Array.isArray(payload.fields)||!payload.fields.length||payload.fields.some(f=>typeof f?.label!=='string'||typeof f.value!=='string'||!['select','input'].includes(f.kind)))throw new Error('工单字段配置缺失。');
  const containers=Array.isArray(payload.containers)&&payload.containers.length?payload.containers:[payload.container];
  const template=document.createElement('template');template.innerHTML=payload.html;
  const allowedTags=new Set(['P','TABLE','THEAD','TBODY','TR','TH','TD','BR']);
  for(const element of template.content.querySelectorAll('*')){
    if(!allowedTags.has(element.tagName))throw new Error('工单正文模板含有不允许的 HTML。');
    for(const attribute of element.attributes){
      if(attribute.name==='style'){if(/url\s*\(|expression\s*\(|@|\\|[<>]/i.test(attribute.value))throw new Error('工单正文模板含有不允许的 HTML 样式。');}
      else if(!(element.tagName==='TABLE'&&['cellpadding','cellspacing'].includes(attribute.name)&&/^\d{1,2}$/.test(attribute.value)))throw new Error('工单正文模板含有不允许的 HTML 属性。');
    }
  }
  if(compact(template.content.textContent)!==compact(payload.bodyText))throw new Error('工单正文模板与正文不符。');
  const form=await waitFor(()=>document.querySelector('form#new_helpdesk_ticket'),'COSCO 工单页面未加载，或页面结构已变化。');
  // Locate fields by their visible labels so renamed custom-field ids do not silently pick the wrong control.
  function field(pattern,selector){
    const labels=[...form.querySelectorAll('label')].filter(visible).filter(l=>pattern.test(l.innerText.replace(/[*\s]+$/,'').trim()));
    const controls=[...new Set(labels.map(l=>(l.htmlFor&&document.getElementById(l.htmlFor))||l.closest('.control-group')?.querySelector(selector)).filter(e=>e&&e.matches(selector)))];
    return controls.length===1?controls[0]:null;
  }
  const need=(control,name)=>{if(!control)throw new Error(`COSCO 工单页面找不到唯一的「${name}」字段，页面可能已改版，已停止。`);return control;};
  const requester=()=>field(/^Requester$/i,'input');
  const exactLabel=label=>new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i');
  const control=f=>field(exactLabel(f.label),f.kind==='select'?'select':'input');
  const descriptionArea=()=>form.querySelector('textarea[name="helpdesk_ticket[ticket_body_attributes][description_html]"]');
  // Redactor keeps an off-screen helper contenteditable before the visible .redactor_editor; never write into it.
  const editor=()=>{
    const box=descriptionArea()?.closest('.controls,.control-group');if(!box)return null;
    return box.querySelector('.redactor_editor[contenteditable="true"]')||[...box.querySelectorAll('[contenteditable="true"]')].filter(visible).sort((a,b)=>b.offsetWidth*b.offsetHeight-a.offsetWidth*a.offsetHeight)[0]||null;
  };
  function fire(control){for(const type of ['input','change','blur'])control.dispatchEvent(new Event(type,{bubbles:true}));}
  function choose(select,value,name){
    const option=[...select.options].find(o=>clean(o.value)===clean(value)||clean(o.textContent)===clean(value));
    if(!option)throw new Error(`「${name}」没有选项「${value}」，页面可能已改版，已停止。`);
    select.value=option.value;fire(select);
  }
  function descriptionText(){const node=editor();if(node)return node.innerText;const area=descriptionArea();const t=document.createElement('template');t.innerHTML=area?.value||'';return t.content.textContent;}
  function verify(){
    if(clean(need(requester(),'Requester').value)!==clean(payload.requester))throw new Error('Requester 与配置不符。');
    for(const f of payload.fields){
      const c=need(control(f),f.label),value=f.kind==='select'?clean(c.selectedOptions?.[0]?.textContent||c.value):c.value.trim();
      if(f.kind==='select'?value!==clean(f.value)&&clean(c.value)!==clean(f.value):value!==f.value.trim())throw new Error(`${f.label} 与配置不符。`);
    }
    const text=descriptionText();
    if(containers.some(c=>!text.includes(c))||!text.includes(payload.mbl)||!compact(text).startsWith(compact(payload.bodyText).slice(0,40)))throw new Error('Description 内容与模板不符。');
  }
  if(action==='fill'){
    if(form.dataset.lfdRequest)throw new Error('此工单页已处理，不能重复填写。');
    const email=need(requester(),'Requester');
    if(email.value.trim()&&clean(email.value)!==clean(payload.requester))throw new Error('Requester 已有其他邮箱，已停止以避免覆盖。');
    email.value=payload.requester;fire(email);
    for(const f of payload.fields){
      const c=await waitFor(()=>control(f),`COSCO 工单页面没有出现「${f.label}」字段，页面可能已改版，已停止。`,8000);
      if(f.kind==='select')choose(c,f.value,f.label);
      else{if(c.value.trim()&&c.value.trim()!==f.value.trim())throw new Error(`「${f.label}」已有其他内容，已停止以避免覆盖。`);c.value=f.value;fire(c);}
    }
    const area=need(descriptionArea(),'Description');
    const body=await waitFor(()=>editor()||(visible(area)&&area),'未找到 Description 编辑器。',10000);
    if(body!==area){
      if(body.innerText.trim())throw new Error('Description 已有内容，已停止以避免覆盖。');
      body.focus();const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(body);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertHTML',false,payload.html))body.innerHTML=payload.html;
      body.dispatchEvent(new InputEvent('input',{bubbles:true}));body.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
    }
    area.value=body===area?payload.html:body.innerHTML;fire(area);
    await pause(300);verify();
    form.dataset.lfdRequest=payload.requestId;
    return {ok:true,data:{filled:true}};
  }
  if(action!=='submit')throw new Error('未知 COSCO 工单操作。');
  if(form.dataset.lfdRequest!==payload.requestId)throw new Error('工单页面已变化，已停止自动提交。');
  verify();
  // Bring the checkbox into view in the small floating window.
  document.querySelector('.g-recaptcha,.recaptcha-control,iframe[title*="reCAPTCHA"]')?.scrollIntoView({block:'center'});
  // Wait for the user to complete the reCAPTCHA themselves; its token appears in this hidden field.
  const token=()=>[...document.querySelectorAll('textarea[name="g-recaptcha-response"]')].some(e=>e.value.trim());
  await waitFor(token,'等待人机验证超时，工单未提交。请在 COSCO 页面完成验证后手动提交，或解除锁定后重试。',payload.captchaTimeout||180000);
  verify();
  const buttons=[...form.querySelectorAll('button[type="submit"],input[type="submit"]')].filter(visible).filter(e=>/^submit$/i.test((e.innerText||e.value||'').trim()));
  if(buttons.length!==1)throw new Error('无法唯一识别 Submit 按钮，工单未提交。');
  buttons[0].click();
  return {ok:true,data:{clicked:true}};
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
