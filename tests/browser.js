import {gmailPage as gmailAdapter} from '/src/injected/gmail.ts';
import {messageTemplate,portalTemplate,normalizeCarriers} from '/src/core/core.ts';
import {coscoPage as coscoAdapter} from '/src/injected/cosco.ts';
import {readKdocsPage as kdocsAdapter} from '/src/injected/kdocs.ts';
import {onePage} from '/src/injected/one.ts';
async function unwrap(result){const r=await result;if(!r.ok)throw new Error(r.error);return r.data;}
const gmailPage=(...args)=>unwrap(gmailAdapter(...args));
const readKdocsPage=(...args)=>unwrap(kdocsAdapter(...args));
const coscoPage=(...args)=>unwrap(coscoAdapter(...args));
const results=document.querySelector('#results'),fixture=document.querySelector('#fixture');
const record={container:'MRSU4786640',mbl:'MAEU276301677'};
const payload={...messageTemplate(record),...record,requestId:'fixture-test'};
let sendClicks=0;
function reset(current=payload){
  sendClicks=0;
  document.title='写邮件 - me@example.com - Gmail';
  fixture.innerHTML='<input name="from" type="hidden" value=""><input name="subjectbox"><div name="to"></div><div name="cc"></div><div name="bcc"></div><div contenteditable="true" role="textbox"><div><br></div><div class="gmail_signature"><b>Example signature</b><br>测试签名</div></div><div role="button" tabindex="0" aria-label="发送 (Ctrl-Enter)">Mock Send</div><div role="status"></div>';
  fixture.querySelector('[name=subjectbox]').value=current.subject;
  for(const [name,list]of [['to',current.to],['cc',current.cc]])for(const email of list){const chip=document.createElement('div');chip.setAttribute('role','option');chip.dataset.hovercardId=email;chip.textContent=email;fixture.querySelector(`[name=${name}]`).append(chip);}
  fixture.querySelector('[role=button]').onclick=()=>{sendClicks++;fixture.querySelector('[role=status]').textContent='Message sent';};
}
async function test(name,fn,current=payload){try{reset(current);await fn();const li=document.createElement('li');li.textContent='PASS: '+name;results.append(li);}catch(e){const li=document.createElement('li');li.textContent='FAIL: '+name+': '+e.message;results.append(li);}}
function assert(v,msg){if(!v)throw new Error(msg);}
await test('preserves rich signature and inserts table; detects mock send success',async()=>{
  const sig=fixture.querySelector('.gmail_signature').outerHTML;
  const prepared=await gmailPage('prepare',payload);
  assert(fixture.querySelector('.gmail_signature').outerHTML===sig,'signature changed');assert(fixture.querySelector('table'),'missing table');
  const result=await gmailPage('send',{...payload,...prepared});assert(result.confirmed,'not confirmed');
});
await test('blocks edited draft before send',async()=>{const prepared=await gmailPage('prepare',payload);fixture.querySelector('[contenteditable]').append('user edit');let blocked=false;try{await gmailPage('send',{...payload,...prepared});}catch(e){blocked=/发生变化/.test(e.message);}assert(blocked,'edited draft was accepted');});
await test('sends from any account: the sender is not checked',async()=>{document.title='写邮件 - someone-else@example.com - Gmail';fixture.querySelector('[name=from]').value='someone-else@example.com';await gmailPage('prepare',payload);assert(fixture.querySelector('table'),'stopped on the sender');});
await test('accepts To and Cc merged in one collapsed line (the Cc field has no chips yet)',async()=>{const form=document.createElement('form');for(const node of [...fixture.querySelectorAll('[name=subjectbox],[name=to],[name=cc],[name=bcc]')])form.append(node);fixture.prepend(form);form.querySelector('[name=cc]').replaceChildren();const row=document.createElement('div');row.className='aoD hl';row.textContent=[...payload.to,...payload.cc].join(', ');form.prepend(row);await gmailPage('prepare',payload);assert(fixture.querySelector('table'),'merged recipients rejected');});
await test('accepts recipients Gmail only keeps in hidden inputs',async()=>{const cc=fixture.querySelector('[name=cc]');cc.replaceChildren();for(const address of payload.cc){const input=document.createElement('input');input.type='hidden';input.name='cc';input.value=address;fixture.append(input);}await gmailPage('prepare',payload);assert(fixture.querySelector('table'),'hidden recipients rejected');});
await test('expands the collapsed recipients when they are not readable yet',async()=>{const cc=fixture.querySelector('[name=cc]'),chips=[...cc.children];cc.replaceChildren();const form=document.createElement('form');for(const node of [...fixture.querySelectorAll('[name=subjectbox],[name=to],[name=cc],[name=bcc]')])form.append(node);fixture.prepend(form);const row=document.createElement('div');row.className='aoD hl';row.textContent='3 recipients';fixture.addEventListener('keydown',event=>{if(event.ctrlKey&&event.shiftKey&&event.keyCode===67)cc.append(...chips);},{once:true});form.prepend(row);await gmailPage('prepare',payload);assert(fixture.querySelector('table'),'did not expand');});
await test('an address that appears only in the signature does not count as a recipient',async()=>{const cc=fixture.querySelector('[name=cc]');cc.replaceChildren();fixture.querySelector('.gmail_signature').append(' '+payload.cc.join(' '));let blocked='';try{await gmailPage('prepare',payload);}catch(e){blocked=e.message;}assert(/Cc 缺少/.test(blocked),'signature passed as Cc: '+blocked);});
await test('an account without a signature still prepares and sends',async()=>{fixture.querySelector('.gmail_signature').remove();const prepared=await gmailPage('prepare',payload);assert(fixture.querySelector('table'),'stopped without a signature');const result=await gmailPage('send',{...payload,...prepared});assert(result.confirmed,'not sent');});
await test('accepts extra Cc/Bcc added by another extension',async()=>{for(const name of ['cc','bcc']){const chip=document.createElement('div');chip.setAttribute('role','option');chip.dataset.hovercardId='added-by-other@example.com';fixture.querySelector(`[name=${name}]`).append(chip);}const prepared=await gmailPage('prepare',payload);assert(prepared.bodyHash,'extra recipients blocked the draft');});
await test('blocks when a configured Cc is missing',async()=>{fixture.querySelector('[name=cc] [role=option]').remove();let blocked='';try{await gmailPage('prepare',payload);}catch(e){blocked=e.message;}assert(/Cc 缺少/.test(blocked),'missing Cc accepted: '+blocked);});
const custom={...payload,to:['operations@example.com','freetime@example.com'],subject:`Detention LFD Inquiry - Container#${record.container} MBL#${record.mbl}`,
  bodyText:`Dear MSC Team,\nPlease confirm the detention free time & final return date.\nContainer# MBL# ${record.container} ${record.mbl}`,
  html:`<p>Dear MSC Team,</p><p>Please confirm the detention free time &amp; final return date.</p><table><tr><th>Container#</th><th>MBL#</th></tr><tr><td>${record.container}</td><td>${record.mbl}</td></tr></table>`};
await test('prepares custom detention body for multiple recipients and preserves signature without sending',async()=>{
  const sig=fixture.querySelector('.gmail_signature').outerHTML;
  await gmailPage('prepare',custom);
  const body=fixture.querySelector('[contenteditable]');
  assert(body.textContent.includes('Please confirm the detention free time & final return date.'),'custom body lost');
  assert(!body.textContent.includes('demurrage'),'old demurrage body inserted');
  assert(fixture.querySelector('.gmail_signature').outerHTML===sig,'signature changed');
  assert(sendClicks===0,'prepare clicked send');
},custom);
await test('rejects missing expected body text before inserting',async()=>{
  const {bodyText,...invalid}=payload;let blocked=false;
  try{await gmailPage('prepare',invalid);}catch(e){blocked=/正文模板/.test(e.message);}
  assert(blocked&&!fixture.querySelector('table')&&sendClicks===0,'missing body text accepted');
});
await test('rejects active HTML before inserting',async()=>{
  let blocked=false;try{await gmailPage('prepare',{...payload,html:payload.html+'<img src="x" onerror="throw Error(1)">'});}catch(e){blocked=/HTML/.test(e.message);}
  assert(blocked&&!fixture.querySelector('table')&&sendClicks===0,'active HTML accepted');
});
await test('rejects mismatched custom body text before inserting',async()=>{
  let blocked=false;try{await gmailPage('prepare',{...custom,bodyText:custom.bodyText.replace('detention','demurrage')});}catch(e){blocked=/正文/.test(e.message);}
  assert(blocked&&!fixture.querySelector('table')&&sendClicks===0,'mismatched body accepted');
},custom);
await test('KDocs adapter requires a fresh, complete set of result chunks',async()=>{
  fixture.innerHTML='<iframe id="excelIde"></iframe>';
  const frame=fixture.querySelector('iframe'),doc=frame.contentDocument;
  doc.body.innerHTML='<div class="scriptListItem active"><div class="ks-title">LFD_ReadOnly_v1</div></div><div class="view-lines">// LFD_ReadOnly_v1</div><button id="run-script">Run</button><pre id="logs"></pre>';
  doc.querySelector('#run-script').onclick=()=>{doc.querySelector('#logs').textContent='LFD_START:'+JSON.stringify({id:123,count:1,chunks:1,sheet:'提柜'})+'\nLFD_CHUNK:'+JSON.stringify({id:123,index:0,rows:[[record.container,record.mbl,326]]})+'\nLFD_END:123';};
  const data=await readKdocsPage();assert(data.records.length===1&&data.records[0].mbl===record.mbl,'bad result');
  assert(!Object.hasOwn(data.records[0],'carrier'),'legacy record gained an invented carrier');
});
await test('KDocs adapter reads the carrier from version 2 four-field records',async()=>{
  fixture.innerHTML='<iframe id="excelIde"></iframe>';
  const doc=fixture.querySelector('iframe').contentDocument;
  doc.body.innerHTML='<div class="scriptListItem active"><div class="ks-title">LFD_ReadOnly_v1</div></div><div class="view-lines">// LFD_ReadOnly_v1</div><button id="run-script">Run</button><pre id="logs"></pre>';
  doc.querySelector('#run-script').onclick=()=>{doc.querySelector('#logs').textContent='LFD_START:'+JSON.stringify({id:128,version:2,count:1,chunks:1,sheet:'提柜'})+'\nLFD_CHUNK:'+JSON.stringify({id:128,index:0,rows:[[record.container,'MEDU1234567',326,'MSC']]})+'\nLFD_END:128';};
  const data=await readKdocsPage();assert(data.records.length===1&&data.records[0].carrier==='MSC'&&data.records[0].mbl==='MEDU1234567','carrier field lost');
});
await test('KDocs adapter rejects truncated data even with an end marker',async()=>{
  fixture.innerHTML='<iframe id="excelIde"></iframe>';
  const doc=fixture.querySelector('iframe').contentDocument;
  doc.body.innerHTML='<div class="scriptListItem active"><div class="ks-title">LFD_ReadOnly_v1</div></div><div class="view-lines">// LFD_ReadOnly_v1</div><button id="run-script">Run</button><pre id="logs"></pre>';
  doc.querySelector('#run-script').onclick=()=>{doc.querySelector('#logs').textContent='LFD_START:'+JSON.stringify({id:124,count:12,chunks:2,sheet:'提柜'})+'\nLFD_END:124';};
  let blocked=false;try{await readKdocsPage();}catch(e){blocked=/不完整/.test(e.message);}assert(blocked,'truncated data accepted');
});
await test('KDocs adapter ignores truncated historical logs and logs after the current end marker',async()=>{
  fixture.innerHTML='<iframe id="excelIde"></iframe>';
  const doc=fixture.querySelector('iframe').contentDocument;
  doc.body.innerHTML='<div class="scriptListItem active"><div class="ks-title">LFD_ReadOnly_v1</div></div><div class="view-lines">// LFD_ReadOnly_v1</div><button id="run-script">Run</button><pre id="logs"></pre>';
  const logs=doc.querySelector('#logs');
  logs.textContent='LFD_START:'+JSON.stringify({id:125,count:1,chunks:1,sheet:'提柜'})+'\nLFD_CHUNK:{"id":125,"rows":[';
  doc.querySelector('#run-script').onclick=()=>{logs.textContent+='\nLFD_START:'+JSON.stringify({id:126,count:1,chunks:1,sheet:'提柜'})+'\nLFD_CHUNK:'+JSON.stringify({id:126,index:0,rows:[[record.container,record.mbl,326]]})+'\nLFD_END:126\nLFD_CHUNK:{"id":125,"rows":[';};
  const data=await readKdocsPage();assert(data.records.length===1&&data.records[0].mbl===record.mbl,'historical or following truncated logs poisoned current result');
});
await test('KDocs adapter rejects damaged JSON in the current completed run',async()=>{
  fixture.innerHTML='<iframe id="excelIde"></iframe>';
  const doc=fixture.querySelector('iframe').contentDocument;
  doc.body.innerHTML='<div class="scriptListItem active"><div class="ks-title">LFD_ReadOnly_v1</div></div><div class="view-lines">// LFD_ReadOnly_v1</div><button id="run-script">Run</button><pre id="logs"></pre>';
  doc.querySelector('#run-script').onclick=()=>{doc.querySelector('#logs').textContent='LFD_START:'+JSON.stringify({id:127,count:1,chunks:1,sheet:'提柜'})+'\nLFD_CHUNK:{"id":127,"rows":[\nLFD_END:127';};
  let blocked=false;try{await readKdocsPage();}catch(e){blocked=/损坏/.test(e.message);}assert(blocked,'damaged current JSON accepted');
});
await test('opens a closed editor through SVG-styled toolbar labels and expands My Scripts',async()=>{
  fixture.innerHTML='<div id="ToolsTab" role="button">效率</div><div id="toolbar"></div>';
  let opened=0;
  fixture.querySelector('#ToolsTab').onclick=()=>{
    const toolbar=fixture.querySelector('#toolbar');
    toolbar.innerHTML='<button id="advanced"><svg><style>.icon{fill:#333}</style></svg><span>高级开发</span></button>';
    toolbar.querySelector('#advanced').onclick=()=>{
      const wrapper=document.createElement('div');toolbar.append(wrapper);
      const menu=document.createElement('div');menu.setAttribute('role','option');menu.innerHTML='<svg><style>.arrow{fill:#888}</style></svg><span>AirScript脚本编辑器</span>';wrapper.append(menu);
      menu.onclick=()=>{
        opened++;const frame=document.createElement('iframe');frame.id='excelIde';fixture.append(frame);
        const doc=frame.contentDocument;
        doc.body.innerHTML='<div class="listItem"><div class="header-title"><span class="title-content" id="my-scripts">我的脚本</span></div></div><button id="run-script">Run</button><div class="view-lines">// LFD_ReadOnly_v1</div><pre id="logs"></pre>';
        doc.querySelector('#my-scripts').onclick=()=>{doc.querySelector('.listItem').classList.add('open');setTimeout(()=>{const item=doc.createElement('div');item.className='scriptListItem active';item.innerHTML='<div class="ks-title">LFD_ReadOnly_v1</div>';doc.body.append(item);},800);};
        doc.querySelector('#run-script').onclick=()=>{doc.querySelector('#logs').textContent='LFD_START:'+JSON.stringify({id:900,count:1,chunks:1,sheet:'提柜'})+'\nLFD_CHUNK:'+JSON.stringify({id:900,index:0,rows:[['MSDU6134964','MEDUACU76689',82,'MSC']]})+'\nLFD_END:900';};
      };
    };
  };
  const result=await readKdocsPage();
  assert(opened===1,'editor should open exactly once');
  assert(result.records[0].carrier==='MSC'&&result.records[0].mbl==='MEDUACU76689','fresh carrier result missing');
});

const coscoRecord={container:'MSMU7504817',mbl:'MEDUAFS11232'};
const ticket={...portalTemplate(coscoRecord,{carrier:normalizeCarriers().find(p=>p.id==='cosco')}),...coscoRecord,requestId:'cosco-test',captchaTimeout:3000};
let ticketSubmits=0;
function coscoForm({requester=''}={}){
  ticketSubmits=0;
  fixture.innerHTML=`<form id="new_helpdesk_ticket" onsubmit="return false">
    <div class="control-group"><label for="helpdesk_ticket_email">Requester <span>*</span></label><div class="controls"><input type="email" id="helpdesk_ticket_email" name="helpdesk_ticket[email]"></div></div>
    <div class="control-group"><label for="helpdesk_ticket_ticket_type">Shipment Type *</label><div class="controls"><select id="helpdesk_ticket_ticket_type"><option value="">...</option><option value="Export">Export</option><option value="Per Diem">Per Diem</option></select></div></div>
    <div id="section"></div>
    <div class="control-group"><label>Description *</label><div class="controls"><div class="redactor_box"><div contenteditable="true" style="position:absolute;left:-9999px;width:1px;height:1px"></div><div class="redactor_editor" contenteditable="true"><p><br></p></div><textarea name="helpdesk_ticket[ticket_body_attributes][description_html]" style="display:none"></textarea></div></div></div>
    <textarea name="g-recaptcha-response" style="display:none"></textarea>
    <button type="submit">Submit</button><button type="button">Cancel</button></form>`;
  fixture.querySelector('#helpdesk_ticket_email').value=requester;
  // Like Freshdesk, the Per Diem section only appears after the type changes.
  fixture.querySelector('#helpdesk_ticket_ticket_type').addEventListener('change',event=>setTimeout(()=>{
    fixture.querySelector('#section').innerHTML=event.target.value!=='Per Diem'?'':`<div class="control-group"><label for="cf_service">Per Diem Services *</label><div class="controls"><select id="cf_service"><option value="">...</option><option>Last Free Day</option><option>Perdiem Inquiry</option></select></div></div>
      <div class="control-group"><label for="cf_ref">PD INV /BL /BKG /HOU # /SCAC Code *</label><div class="controls"><input id="cf_ref"></div></div>`;
  },300));
  fixture.querySelector('button[type=submit]').addEventListener('click',()=>ticketSubmits++);
}
await test('COSCO ticket: fills every field, waits for the user captcha, then submits once',async()=>{
  coscoForm();
  await coscoPage('fill',ticket);
  assert(fixture.querySelector('#helpdesk_ticket_email').value==='service@darwinpacific.com','requester');
  assert(fixture.querySelector('#helpdesk_ticket_ticket_type').value==='Per Diem','type');
  assert(fixture.querySelector('#cf_service').value==='Last Free Day','service');
  assert(fixture.querySelector('#cf_ref').value==='','an empty reference is left alone');
  const editor=fixture.querySelector('.redactor_editor');
  assert(!fixture.querySelector('[contenteditable]:not(.redactor_editor)').innerText.trim(),'wrote into Redactor\'s hidden helper');
  assert(editor.querySelector('table')&&editor.innerText.includes('MSMU7504817')&&editor.innerText.includes('MEDUAFS11232'),'table');
  assert(/Dear Cosco/.test(editor.innerText)&&/detention LFD/.test(editor.innerText),'body');
  assert(fixture.querySelector('textarea[name*=description]').value.includes('MSMU7504817'),'textarea sync');
  assert(ticketSubmits===0,'fill must not submit');
  const submitting=coscoPage('submit',ticket);
  await new Promise(r=>setTimeout(r,500));assert(ticketSubmits===0,'submitted before captcha');
  fixture.querySelector('textarea[name="g-recaptcha-response"]').value='user-solved-token';
  const result=await submitting;assert(result.clicked&&ticketSubmits===1,'not submitted exactly once');
});
await test('COSCO ticket: captcha never completed means nothing is submitted',async()=>{
  coscoForm();await coscoPage('fill',ticket);let error='';
  try{await coscoPage('submit',{...ticket,captchaTimeout:400});}catch(e){error=e.message;}
  assert(/人机验证超时/.test(error)&&ticketSubmits===0,'timed out submit');
});
await test('COSCO ticket: edited field after fill blocks submit',async()=>{
  coscoForm();await coscoPage('fill',ticket);fixture.querySelector('#cf_service').value='OTHER';
  fixture.querySelector('textarea[name="g-recaptcha-response"]').value='token';let error='';
  try{await coscoPage('submit',ticket);}catch(e){error=e.message;}
  assert(/Per Diem Services/.test(error)&&ticketSubmits===0,'edited form submitted');
});
await test('COSCO ticket: a different prefilled requester is not overwritten',async()=>{
  coscoForm({requester:'someone@else.com'});let error='';
  try{await coscoPage('fill',ticket);}catch(e){error=e.message;}
  assert(/Requester/.test(error)&&fixture.querySelector('#helpdesk_ticket_email').value==='someone@else.com','requester overwritten');
});
await test('COSCO ticket: missing option stops instead of choosing something else',async()=>{
  coscoForm();let error='';
  try{await coscoPage('fill',{...ticket,fields:ticket.fields.map(f=>f.label==='Per Diem Services'?{...f,value:'Nonexistent'}:f)});}catch(e){error=e.message;}
  assert(/没有选项/.test(error),'missing option accepted: '+error);
});
await test('English KDocs UI: opens the editor via Tools / Advanced Development / My Scripts, re-expanding a collapsed ribbon',async()=>{
  fixture.innerHTML='<div id="ToolsTab" role="button">Tools</div><div id="toolbar"></div>';
  let opened=0,ribbon=true;
  // Tools is already the selected tab: the first click collapses the ribbon, the second shows it again.
  fixture.querySelector('#ToolsTab').onclick=()=>{
    ribbon=!ribbon;const toolbar=fixture.querySelector('#toolbar');
    toolbar.innerHTML=ribbon?'<button id="advanced"><span>Advanced Development</span></button>':'';
    if(!ribbon)return;
    toolbar.querySelector('#advanced').onclick=()=>{
      const menu=document.createElement('div');menu.setAttribute('role','option');menu.innerHTML='<span>AirScript Script Editor</span>';toolbar.append(menu);
      menu.onclick=()=>{
        opened++;const frame=document.createElement('iframe');frame.id='excelIde';fixture.append(frame);
        const doc=frame.contentDocument;
        doc.body.innerHTML='<div class="listItem"><div class="header-title"><span class="title-content" id="mine">My Scripts</span></div></div><button id="run-script">Run</button><div class="view-lines">// LFD_ReadOnly_v1</div><pre id="logs"></pre>';
        doc.querySelector('#mine').onclick=()=>{doc.querySelector('.listItem').classList.add('open');const item=doc.createElement('div');item.className='scriptListItem active';item.innerHTML='<div class="ks-title">LFD_ReadOnly_v1</div>';doc.body.append(item);};
        doc.querySelector('#run-script').onclick=()=>{doc.querySelector('#logs').textContent='LFD_START:'+JSON.stringify({id:901,count:1,chunks:1,sheet:'提柜'})+'\nLFD_CHUNK:'+JSON.stringify({id:901,index:0,rows:[['CSNU5509665','COSU6466280560',886,'COS']]})+'\nLFD_END:901';};
      };
    };
  };
  const result=await readKdocsPage();
  assert(opened===1,'editor should open exactly once');
  assert(result.records[0].container==='CSNU5509665'&&result.records[0].carrier==='COS','English UI result missing');
});
fixture.replaceChildren();document.title='Browser adapter tests — complete';
// ONE: the adapter only acts on ONE's own hosts, so it runs here with that location.
const oneTop=new Function('location',`return (${onePage.toString()})`)({hostname:'www.one-line.com',pathname:'/one-ecom/manage-shipment/cargo-tracking'});
const oneOptions={country:'United States',continueWait:400};
function oneForm({frameAfter=-1,keepDisabled=false}={}){
  sessionStorage.removeItem('lfd-one-trace');delete window.__lfdOneTrace;
  fixture.innerHTML='<div class="chat-icon">chat</div><div id="one-chat-wrapper" style="display:none"><input class="selected" value="United States"><div class="start-chat"><span>Continue</span></div></div>';
  const form={clicks:0},start=fixture.querySelector('.start-chat');
  fixture.querySelector('.chat-icon').onclick=()=>{fixture.querySelector('#one-chat-wrapper').style.display='block';};
  start.onclick=()=>{form.clicks++;if(keepDisabled)start.classList.add('disabled');if(form.clicks===frameAfter){const frame=document.createElement('iframe');frame.id='embeddedMessagingFrame';fixture.append(frame);}};
  return form;
}
await test('ONE: the chat box arriving on the first click is simply opened',async()=>{const form=oneForm({frameAfter:1});const r=await unwrap(oneTop('top','open',oneOptions));assert(r.opened===true&&form.clicks===1,'not opened');assert(!sessionStorage.getItem('lfd-one-trace'),'trace left behind');});
await test('ONE: a late chat box asks for one more attempt, which clicks Continue again',async()=>{const form=oneForm({frameAfter:2});const first=await unwrap(oneTop('top','open',oneOptions));assert(first.opened===false,'gave up early');const second=await unwrap(oneTop('top','retryOpen',oneOptions));assert(second.opened===true&&form.clicks===2,'second click missing');});
await test('ONE: Continue still busy is not clicked twice',async()=>{const form=oneForm({keepDisabled:true});await unwrap(oneTop('top','open',oneOptions));const r=await oneTop('top','retryOpen',oneOptions);assert(!r.ok&&form.clicks===1,'clicked a busy button');assert(r.diagnostics.continueDisabled===true,'busy state not recorded');});
await test('ONE: giving up reports the page state for the record',async()=>{const form=oneForm();await unwrap(oneTop('top','open',oneOptions));const r=await oneTop('top','retryOpen',oneOptions);assert(!r.ok&&/90 秒/.test(r.error),'wrong error: '+r.error);const d=r.diagnostics;assert(form.clicks===2&&d.clicks===2&&d.retried===true,'attempts not recorded');for(const key of ['clickedAt','failedAt','visibilityAtClick','visibility','navigation','embeddedBootstrap','messagingService'])assert(d[key]!==undefined,'missing '+key);assert(d.chatFrame===false&&d.wrapperVisible===true&&Array.isArray(d.network),'state wrong');assert(!sessionStorage.getItem('lfd-one-trace'),'trace left behind');});
await test('ONE: a page that reloaded itself after Continue is noted',async()=>{oneForm({frameAfter:-1});sessionStorage.setItem('lfd-one-trace',JSON.stringify({clicks:1,clickedAt:'earlier'}));await unwrap(oneTop('top','open',oneOptions));assert(JSON.parse(sessionStorage.getItem('lfd-one-trace')).reloadedAfterContinue===true,'reload not noted');});
await test('ONE: the page state shows the empty chat frame and brings the page back',async()=>{oneForm();fixture.insertAdjacentHTML('beforeend','<iframe id="embeddedMessagingFrame" src="about:blank" style="width:40px;height:30px"></iframe><style id="lfd-chat-only"></style>');const r=await unwrap(oneTop('top','state',{unhide:true}));assert(r.chatFrame===true&&r.frameRect&&r.readyState,'state wrong: '+JSON.stringify([r.chatFrame,r.frameRect,r.readyState]));assert(!document.getElementById('lfd-chat-only'),'page still hidden');});
