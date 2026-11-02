// Simulated Gmail page for gmail-autocc.js, which is a classic content script.
const results=document.querySelector('#results'),fixture=document.querySelector('#fixture');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let push,opened=0,config={enabled:true,senders:['me@example.com'],cc:['a@example.com','b@example.com']};
globalThis.chrome={runtime:{lastError:null,onMessage:{addListener:fn=>{push=fn;}},sendMessage:(message,callback)=>{if(message.type==='autoCcOpen')opened++;callback({ok:true,data:config});}}};
await new Promise(resolve=>{const script=document.createElement('script');script.type='module';script.src='/src/content/gmail-autocc.ts';script.onload=resolve;document.head.append(script);});
const send=next=>{config=next;push({type:'autoCc',config:next});};
// Gmail: the Cc row appears after clicking its link; Enter turns the text into a chip.
function compose({from='me@example.com',to='',cc=''}={}){
  const form=document.createElement('form');
  form.innerHTML=`<input type="hidden" name="composeid" value="1"><input type="hidden" name="from" value="${from}"><div name="to">${to?`<span role="option" data-hovercard-id="${to}">${to}</span>`:''}</div><span class="aB gQ pE" role="link" aria-label="添加抄送收件人 (Ctrl-Shift-C)">抄送</span><div name="cc" hidden>${cc?`<span role="option" data-hovercard-id="${cc}">${cc}</span>`:''}<input></div>`;
  const row=form.querySelector('[name=cc]'),input=row.querySelector('input');
  form.querySelector('[role=link]').onclick=()=>{row.hidden=false;};
  input.addEventListener('keydown',event=>{if(event.keyCode!==13||!input.value)return;const chip=document.createElement('span');chip.setAttribute('role','option');chip.dataset.hovercardId=input.value;chip.textContent=input.value;row.prepend(chip);input.value='';});
  fixture.append(form);return form;
}
const chips=form=>[...form.querySelectorAll('[name=cc] [data-hovercard-id]')].map(node=>node.dataset.hovercardId).sort();
async function test(name,fn){fixture.replaceChildren();try{await fn();results.insertAdjacentHTML('beforeend','<li>PASS: '+name+'</li>');}catch(error){const li=document.createElement('li');li.textContent='FAIL: '+name+': '+error.message;results.append(li);}}
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const on={enabled:true,senders:['me@example.com'],cc:['a@example.com','b@example.com']};
await test('adds the configured Cc when the sender passes, opening the Cc row first',async()=>{send(on);const form=compose();await pause(900);assert(chips(form).join()==='a@example.com,b@example.com','got '+chips(form));});
await test('stays silent for any other sender',async()=>{send(on);const form=compose({from:'other@example.com'});await pause(700);assert(!chips(form).length&&form.querySelector('[name=cc]').hidden,'changed the form');});
await test('falls back to the account in the title when From has no value',async()=>{send(on);const form=compose({from:''});await pause(900);assert(chips(form).length===2,'not added');});
await test('stays silent when the sender cannot be told',async()=>{send(on);const form=compose({from:''});form.insertAdjacentHTML('beforeend','<select name="from"><option>x</option></select>');await pause(0);const title=document.title;document.title='Gmail';const other=compose({from:''});await pause(700);document.title=title;assert(!chips(other).length,'added without a known sender');});
await test('does not repeat an address already there, nor the sender itself',async()=>{send({...on,cc:['a@example.com','me@example.com','b@example.com']});const form=compose({to:'a@example.com'});await pause(900);assert(chips(form).join()==='b@example.com','got '+chips(form));});
await test('an address removed by hand is not added back',async()=>{send(on);const form=compose();await pause(900);form.querySelector('[data-hovercard-id="a@example.com"]').remove();await pause(700);assert(chips(form).join()==='b@example.com','added back: '+chips(form));});
await test('keeps the caret in the field the user is in',async()=>{send(on);const box=document.createElement('input');fixture.append(box);box.focus();compose();await pause(900);assert(document.activeElement===box,'focus moved');});
await test('off: no button and no change; a change from the plugin applies at once',async()=>{send({...on,enabled:false});const form=compose();await pause(600);assert(!document.getElementById('lfd-auto-cc'),'button shown');assert(!chips(form).length,'added while off');send(on);await pause(100);assert(document.getElementById('lfd-auto-cc'),'button missing after switching on');});
await test('the button sits right of the Gmail logo and opens the settings',async()=>{send(on);fixture.innerHTML='<a aria-label="Gmail" href="#inbox" style="position:fixed;left:-256px;width:74px;height:24px">hidden</a><a aria-label="Gmail" href="#inbox" style="display:inline-block;width:109px;height:40px">logo</a>';const logo=fixture.lastChild.getBoundingClientRect();await pause(400);const button=document.getElementById('lfd-auto-cc');assert(button.getBoundingClientRect().left===Math.round(logo.right+10),'placed at '+button.style.left);const before=opened;button.click();button.click();await pause(0);assert(opened===before+1,'a double click asked twice: '+(opened-before));});
await test('the button keeps clear of the search box',async()=>{send(on);fixture.innerHTML='<a aria-label="Gmail" href="#inbox" style="position:fixed;left:64px;top:12px;width:109px;height:44px">logo</a><form style="position:fixed;left:256px;top:8px;width:400px"><input name="q"></form>';await pause(400);const box=document.getElementById('lfd-auto-cc').getBoundingClientRect();assert(256-box.right>=13,'gap '+(256-box.right));});
