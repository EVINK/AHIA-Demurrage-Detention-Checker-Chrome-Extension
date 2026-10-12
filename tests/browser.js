import {gmailPage as gmailAdapter} from '../gmail.js';
import {messageTemplate} from '../core.js';
import {readKdocsPage as kdocsAdapter} from '../kdocs.js';
async function unwrap(result){const r=await result;if(!r.ok)throw new Error(r.error);return r.data;}
const gmailPage=(...args)=>unwrap(gmailAdapter(...args));
const readKdocsPage=(...args)=>unwrap(kdocsAdapter(...args));
const results=document.querySelector('#results'),fixture=document.querySelector('#fixture');
const record={container:'MRSU4786640',mbl:'MAEU276301677'};
const payload={...messageTemplate(record),...record,account:'me@example.com',requestId:'fixture-test'};
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
await test('blocks wrong account',async()=>{let blocked=false;try{await gmailPage('prepare',{...payload,account:'other@example.com'});}catch(e){blocked=/账号/.test(e.message);}assert(blocked,'wrong sender accepted');});
await test('blocks an unverifiable send-as selector',async()=>{const label=document.createElement('label');label.textContent='发件人：';fixture.append(label);let blocked=false;try{await gmailPage('prepare',payload);}catch(e){blocked=/别名/.test(e.message);}assert(blocked,'ambiguous send-as accepted');});
await test('blocks unexpected BCC',async()=>{const chip=document.createElement('div');chip.setAttribute('role','option');chip.dataset.hovercardId='unexpected@example.com';fixture.querySelector('[name=bcc]').append(chip);let blocked=false;try{await gmailPage('prepare',payload);}catch(e){blocked=/密送/.test(e.message);}assert(blocked,'unexpected BCC accepted');});
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
fixture.replaceChildren();document.title='Browser adapter tests — complete';
