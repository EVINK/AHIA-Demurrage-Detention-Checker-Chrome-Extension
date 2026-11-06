// @ts-nocheck
// Self-contained function injected into OOCL's Real Time Release site (rtr.home.oocl.com) or its sign-in page
// (exiamfw.home.oocl.com, Keycloak). Owner, 11/6: the plugin signs in with the account saved in the plugin
// (chrome.storage.local only) and searches by bill of lading. 'state' and 'login' run on the sign-in page,
// 'check' and 'search' on the RTR page with its own session cookie.
export async function ooclPage(action,payload){
  try{
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    if(action==='state'){
      const form=document.querySelector('#kc-form-login')||document.querySelector('#username')?.closest('form');
      const error=[...document.querySelectorAll('#input-error,.kc-feedback-text,.alert-error,.alert-warning,.pf-c-alert__title,[class*="alert"] span')]
        .map(e=>e.innerText.trim()).filter(Boolean)[0]||'';
      return {ok:true,data:{form:Boolean(form&&document.querySelector('#username')&&document.querySelector('#password')),error,url:location.href,title:document.title}};
    }
    if(action==='login'){
      const user=document.querySelector('#username'),pass=document.querySelector('#password'),button=document.querySelector('#kc-login');
      if(!user||!pass||!button)throw new Error('OOCL 登录页结构已变化，找不到账号、密码或登录按钮。');
      const put=(input,value)=>{
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        setter.call(input,value);
        for(const type of ['input','change'])input.dispatchEvent(new Event(type,{bubbles:true}));
      };
      put(user,String(payload?.username||''));put(pass,String(payload?.password||''));
      // The cookie notice checkbox: ticking it is the same as the page's own wording ("once login, we will assume…").
      const agree=document.querySelector('#agree');
      if(agree&&!agree.checked)agree.click();
      await pause(200);
      button.disabled=false;button.click();
      return {ok:true,data:{submitted:true}};
    }
    if(action==='check'){
      const response=await fetch('/api/check',{credentials:'include',headers:{'X-Requested-With':'XMLHttpRequest'}});
      return {ok:true,data:{signedIn:response.ok,status:response.status}};
    }
    // Signs the site's session out, so a newly saved account is really tried. → the sign-out page to open.
    if(action==='logout'){
      const response=await fetch('/api/frm/sso/logout',{credentials:'include',headers:{'X-Requested-With':'XMLHttpRequest'}});
      const data=await response.json().catch(()=>null);
      const url=typeof data?.data==='string'&&/^https:\/\/[a-z0-9.-]+\.oocl\.com\//i.test(data.data)?data.data:'';
      return {ok:true,data:{url}};
    }
    if(action==='search'){
      const terms=[...new Set((payload?.terms||[]).map(t=>String(t||'').trim()).filter(Boolean))];
      const keep=row=>Object.fromEntries(Object.entries(row||{}).filter(([,v])=>v==null||['string','number','boolean'].includes(typeof v)));
      const out={};
      for(const term of terms){
        const response=await fetch('/api/todo/search/'+encodeURIComponent(term),{credentials:'include',headers:{'X-Requested-With':'XMLHttpRequest',Accept:'application/json'}});
        if(response.status===401||response.status===403)throw new Error('OOCL 登录已过期，请重新运行。');
        if(!response.ok){out[term]={error:`OOCL 返回错误 ${response.status}`,cntrData:[],messages:[]};continue;}
        const data=await response.json().catch(()=>({}));
        out[term]={cntrData:(data.cntrData||[]).map(keep),messages:(data.messages||[]).map(m=>typeof m==='string'?m:(m?.message||m?.text||JSON.stringify(m))).slice(0,5)};
        await pause(300);
      }
      return {ok:true,data:out};
    }
    throw new Error('未知的 OOCL 操作。');
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
