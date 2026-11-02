// Experimental Auto CC: runs on every Gmail page, does nothing until switched on in the config page.
// When the sender of a compose or reply window is one of the configured senders, the configured Cc addresses
// are added. Anything else (other sender, sender unknown, unexpected page) is silently left alone.
(()=>{
  const EMAIL=/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g;
  const addressesIn=text=>String(text||'').toLowerCase().match(EMAIL)||[];
  const visible=node=>Boolean(node&&node.getClientRects().length);
  const BUTTON_ID='lfd-auto-cc',SEARCH_GAP=14;
  // The extension's own LFD compose tab already has its Cc, and verifies recipients while filling. It opens with
  // view=cm&fs=1, which Gmail rewrites to fs=1 once loaded.
  const query=new URLSearchParams(location.search);
  if(query.get('view')==='cm'||query.get('fs')==='1')return;
  let config={enabled:false,senders:[],cc:[]},observer=null,timer=null;
  // Per compose window: addresses already handled, so one the user removes by hand is not added back.
  const handled=new WeakMap();
  // Compose windows whose Cc row is being opened, with where the user's caret was before Gmail moved it there.
  const opening=new WeakMap();
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
  function messageBody(form){
    let root=form;while(root&&!root.querySelector('[contenteditable="true"][role="textbox"]'))root=root.parentElement;
    return root?.querySelector('[contenteditable="true"][role="textbox"]');
  }
  // Gmail's own shortcut opens the Cc row. It also works in a reply, where the row is collapsed and has no Cc link.
  function shortcut(target){for(const type of ['keydown','keyup'])target.dispatchEvent(new KeyboardEvent(type,{key:'C',code:'KeyC',keyCode:67,which:67,ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));}
  function revealCc(form){
    const link=form.querySelector('.aB.gQ.pE');
    if(visible(link)){link.click();return;}
    const body=messageBody(form);
    if(body)shortcut(body);
  }
  const enter=input=>{for(const type of ['keydown','keypress','keyup'])input.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));};
  function caret(){const selection=getSelection();return {active:document.activeElement,range:selection.rangeCount?selection.getRangeAt(0).cloneRange():null};}
  // A reply can open before Gmail has placed the caret anywhere: then it belongs in the message.
  function restore({active,range},form){
    if(!active?.isConnected||active===document.body){messageBody(form)?.focus();return;}
    active.focus();
    if(range){const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
  }
  // Each address goes in like a typed one: Enter turns it into a recipient chip.
  function typeInto(input,list){
    input.focus();
    for(const address of list){
      if(!document.execCommand('insertText',false,address)){input.value=address;input.dispatchEvent(new Event('input',{bubbles:true}));}
      enter(input);
    }
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
    const state=opening.get(form)||{tries:0,from:caret()};opening.set(form,state);
    if(!visible(input)){
      if(state.tries++>=5)return false;
      revealCc(form);return true;
    }
    typeInto(input,missing);for(const address of missing)done.add(address);
    restore(state.from,form);opening.delete(form);
    return false;
  }
  function placeButton(){
    let button=document.getElementById(BUTTON_ID);
    if(!config.enabled){button?.remove();return;}
    if(!button){
      button=document.createElement('button');button.id=BUTTON_ID;button.type='button';button.textContent='Auto CC';button.title='Trucker Helper: Auto CC';
      button.style.cssText='position:fixed;z-index:2147483000;height:28px;padding:0 8px;border:1px solid #23674f;border-radius:14px;background:#e8f3ee;color:#23674f;font:600 12px/26px Arial,sans-serif;cursor:pointer';
      let clicked=0;
      button.addEventListener('click',()=>{if(Date.now()-clicked<1000)return;clicked=Date.now();ask({type:'autoCcOpen'}).catch(()=>{});});
      document.body.append(button);
    }
    const logo=[...document.querySelectorAll('a[aria-label="Gmail"],a[title="Gmail"],header a[href$="#inbox"]')].find(node=>visible(node)&&node.getBoundingClientRect().left>=0);
    const box=logo?.getBoundingClientRect();
    // Keeps clear of the search box, which starts close to the logo.
    const search=document.querySelector('form input[name="q"]')?.closest('form')?.getBoundingClientRect();
    const left=box?box.right+10:190,limit=search?.width?search.left-button.offsetWidth-SEARCH_GAP:left;
    button.style.left=`${Math.round(Math.min(left,limit))}px`;button.style.top=`${box?Math.round(box.top+box.height/2-14):18}px`;
  }
  function scan(){
    timer=null;placeButton();
    if(!config.enabled||!config.cc.length||!config.senders.length)return;
    if(composeForms().map(fillForm).some(Boolean))schedule(100);
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
