// Experimental Auto CC: runs on every Gmail page, does nothing until switched on in the config page.
// When the sender of a compose or reply window is one of the configured senders, the configured Cc addresses
// are added. Anything else (other sender, sender unknown, unexpected page) is silently left alone.
(()=>{
  const EMAIL=/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g;
  const addressesIn=text=>String(text||'').toLowerCase().match(EMAIL)||[];
  const visible=node=>Boolean(node&&node.getClientRects().length);
  const BUTTON_ID='lfd-auto-cc';
  // The extension's own LFD compose tab already has its Cc, and verifies recipients while filling.
  if(new URLSearchParams(location.search).get('view')==='cm')return;
  let config={enabled:false,senders:[],cc:[]},observer=null,timer=null;
  // Per compose window: addresses already handled, so one the user removes by hand is not added back.
  const handled=new WeakMap();
  const ask=message=>new Promise((resolve,reject)=>{
    try{chrome.runtime.sendMessage(message,response=>{if(chrome.runtime.lastError||!response?.ok)reject(new Error('unavailable'));else resolve(response.data);});}
    catch(error){reject(error);}
  });
  const composeForms=()=>[...new Set([...document.querySelectorAll('form input[name="composeid"],form input[name="subjectbox"]')].map(node=>node.closest('form')))];
  // '' when it cannot be told for certain, which counts as not passing.
  function senderOf(form){
    const explicit=addressesIn(form.querySelector('input[name="from"]')?.value)[0];
    if(explicit)return explicit;
    const hasChoice=form.querySelector('select[name="from"]')||[...form.querySelectorAll('[aria-label],[data-tooltip]')].some(node=>visible(node)&&/^(From\b|发件人)/i.test(node.getAttribute('aria-label')||node.getAttribute('data-tooltip')||''));
    return hasChoice?'':addressesIn(document.title)[0]||'';
  }
  function recipientsOf(form){
    const attributes=[...form.querySelectorAll('[data-hovercard-id],[email]')].flatMap(node=>addressesIn(node.getAttribute('data-hovercard-id')||node.getAttribute('email')));
    const inputs=[...form.querySelectorAll('input[name="to"],input[name="cc"],input[name="bcc"],[name="to"] input,[name="cc"] input,[name="bcc"] input')].flatMap(node=>addressesIn(node.value));
    return new Set([...attributes,...inputs]);
  }
  function revealCc(form){
    const collapsed=form.querySelector('.aoD.hl');if(visible(collapsed))collapsed.click();
    const link=[...form.querySelectorAll('[role="link"],.aB.gQ.pE')].find(node=>visible(node)&&/(^|\s)(cc|抄送)(\s|$)/i.test(node.getAttribute('aria-label')||node.textContent||''));
    link?.click();
  }
  // Gmail turns text ending in a comma into recipient chips. The caret goes back where the user had it.
  function typeInto(input,list){
    const active=document.activeElement,selection=getSelection(),range=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;
    const text=list.join(', ')+', ';
    input.focus();
    if(!document.execCommand('insertText',false,text)){input.value+=text;input.dispatchEvent(new Event('input',{bubbles:true}));}
    input.blur();
    if(active&&active!==document.body){active.focus();if(range){selection.removeAllRanges();selection.addRange(range);}}
  }
  function fillForm(form){
    const sender=senderOf(form);
    if(!sender||!config.senders.includes(sender))return false;
    const done=handled.get(form)||new Set(),present=recipientsOf(form);
    const missing=config.cc.filter(address=>address!==sender&&!done.has(address)&&!present.has(address));
    for(const address of config.cc)if(present.has(address))done.add(address);
    handled.set(form,done);
    if(!missing.length)return false;
    const input=form.querySelector('[name="cc"] input');
    if(!visible(input)){revealCc(form);return true;}
    typeInto(input,missing);for(const address of missing)done.add(address);
    return false;
  }
  function placeButton(){
    let button=document.getElementById(BUTTON_ID);
    if(!config.enabled){button?.remove();return;}
    if(!button){
      button=document.createElement('button');button.id=BUTTON_ID;button.type='button';button.textContent='Auto CC';button.title='LFD Inquiry：打开 Auto CC 设置';
      button.style.cssText='position:fixed;z-index:2147483000;height:28px;padding:0 10px;border:1px solid #23674f;border-radius:14px;background:#e8f3ee;color:#23674f;font:600 12px/26px Arial,sans-serif;cursor:pointer';
      button.addEventListener('click',()=>{ask({type:'autoCcOpen'}).catch(()=>{});});
      document.body.append(button);
    }
    const logo=[...document.querySelectorAll('a[aria-label="Gmail"],a[title="Gmail"],header a[href$="#inbox"]')].find(visible);
    const box=logo?.getBoundingClientRect();
    button.style.left=`${box?Math.round(box.right+10):190}px`;button.style.top=`${box?Math.round(box.top+box.height/2-14):18}px`;
  }
  function scan(){
    timer=null;placeButton();
    if(!config.enabled||!config.cc.length||!config.senders.length)return;
    if(composeForms().map(fillForm).some(Boolean))schedule(400);
  }
  function schedule(delay=250){if(!timer)timer=setTimeout(scan,delay);}
  function apply(next){
    config=next;
    if(config.enabled&&!observer){observer=new MutationObserver(()=>schedule());observer.observe(document.body,{childList:true,subtree:true});addEventListener('resize',placeButton);}
    if(!config.enabled&&observer){observer.disconnect();observer=null;removeEventListener('resize',placeButton);}
    schedule(0);
  }
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='autoCc'&&message.config)apply(message.config);});
  ask({type:'autoCcConfig'}).then(apply).catch(()=>{});
})();
