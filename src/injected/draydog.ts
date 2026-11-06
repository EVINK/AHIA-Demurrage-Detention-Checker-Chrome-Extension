// @ts-nocheck
// Self-contained function injected into an app.draydog.com tab (MAIN world).
// Dray Dog's web app keeps its sign-in in localStorage (see below) and calls
// https://api.draydog.com with that header. Reading it here keeps the token inside the Dray Dog page: it is never
// returned to the extension. 'auth' reads who is signed in, 'containers' reads containers; 'watch' starts tracking
// containers (step 4 of the owner's process, the same as clicking Start Tracking).
export async function draydogPage(action,payload){
  try{
    const API='https://api.draydog.com';
    const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
    // Current sign-in: `auth_header_info` {header:"Bearer …", orgID}; other organisations: `auth_headers_by_org_id`.
    const info=read('auth_header_info');
    const entries=[
      ...(typeof info?.header==='string'&&info.header.trim()?[[info.orgID,info.header]]:[]),
      ...Object.entries(read('auth_headers_by_org_id')||{})
    ].filter(([,value])=>typeof value==='string'&&value.trim());
    if(action==='auth'){
      if(!entries.length)return {ok:true,data:{loggedIn:false,url:location.href}};
      // Several organisations: any valid token answers /users/current/info/ for its own org.
      for(const [org,value] of entries){
        const response=await fetch(API+'/users/current/info/',{headers:{Authorization:value}});
        if(response.status===401||response.status===403)continue;
        if(!response.ok)throw new Error(`Draydog 返回错误 ${response.status}`);
        const info=await response.json();
        return {ok:true,data:{loggedIn:true,org:Number(org)||org,organization:info.current_organization?.name||'',user:[info.first_name,info.last_name].filter(Boolean).join(' ')||info.email||'',url:location.href}};
      }
      return {ok:true,data:{loggedIn:false,expired:true,url:location.href}};
    }
    // The signed-in header; the token stays in this page.
    const header=entries[0]?.[1];
    if(!header)throw new Error('Draydog 未登录。');
    const call=async(path,options={})=>{
      const response=await fetch(API+path,{...options,headers:{Authorization:header,'Content-Type':'application/json',...(options.headers||{})}});
      if(response.status===401||response.status===403)throw new Error('Draydog 登录已过期，请重新登录。');
      if(!response.ok)throw new Error(`Draydog 返回错误 ${response.status}`);
      return response.json();
    };
    const numbers=[...new Set((payload?.numbers||[]).filter(n=>/^[A-Z]{4}\d{7}$/.test(n)))];
    if(action==='containers'){
      // 100 numbers per request keeps the URL short; pages of 100 within each.
      const containers=[],unwatched=[],lineCheck=[];
      for(let i=0;i<numbers.length;i+=100){
        const group=numbers.slice(i,i+100);
        for(let page=1;page<20;page++){
          const query=new URLSearchParams({container_numbers:group.join(','),page_size:'100',page:String(page)});
          const data=await call('/containers/?'+query);
          if(page===1)unwatched.push(...(data.unwatched_containers||[]));
          containers.push(...(data.containers||[]));
          if((data.containers||[]).length<100)break;
        }
        // Lines that do not share their LFD with the terminal: Dray Dog shows "Check Line for LFD" instead of a date.
        const check=await call('/containers/?'+new URLSearchParams({container_numbers:group.join(','),page_size:'100',needs_line_lfd_check:'true'}));
        lineCheck.push(...(check.containers||[]).map(c=>c.container_number));
      }
      // raw_data is large and unused.
      const trim=c=>JSON.parse(JSON.stringify(c,(key,value)=>key==='raw_data'?undefined:value));
      return {ok:true,data:{containers:containers.map(trim),unwatched:[...new Set(unwatched)],lineCheck:[...new Set(lineCheck)]}};
    }
    // Notes (owner, 11/6: "SSL LFD mm/dd" for OOCL containers). Every note, newest first: the card shows only the latest.
    if(action==='notes'){
      const out={};
      for(const number of numbers){
        const list=await call(`/containers/${encodeURIComponent(number)}/notes/`);
        out[number]=(list||[]).map(n=>({id:n.id,body:String(n.body||''),time:n.time||''}));
      }
      return {ok:true,data:out};
    }
    if(action==='addNote'){
      const added=[],errors=[];
      for(const note of payload?.notes||[]){
        const number=String(note?.container||''),body=String(note?.body||'').trim();
        if(!/^[A-Z]{4}\d{7}$/.test(number)||!body||body.length>200){errors.push({container:number,message:'note 内容无效'});continue;}
        try{const saved=await call(`/containers/${encodeURIComponent(number)}/notes/`,{method:'POST',body:JSON.stringify({body})});added.push({container:number,id:saved?.id,body:saved?.body||body});}
        catch(error){errors.push({container:number,message:error.message});}
      }
      return {ok:true,data:{added,errors}};
    }
    if(action==='watch'){
      if(!numbers.length)return {ok:true,data:{container_numbers:[],errors:[]}};
      const data=await call('/containers/watch/',{method:'POST',body:JSON.stringify(numbers.map(container_number=>({container_number,port_complex:'la_lb'})))});
      return {ok:true,data:{container_numbers:data.container_numbers||[],errors:(data.errors||[]).map(e=>({container:e.container_number,message:e.message}))}};
    }
    throw new Error('未知的 Draydog 操作。');
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
