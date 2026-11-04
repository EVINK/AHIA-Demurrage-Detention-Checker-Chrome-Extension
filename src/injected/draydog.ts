// @ts-nocheck
// Self-contained function injected into an app.draydog.com tab (MAIN world).
// Dray Dog's web app keeps its sign-in in localStorage (see below) and calls
// https://api.draydog.com with that header. Reading it here keeps the token inside the Dray Dog page: it is never
// returned to the extension. 'auth' only reads who is signed in; nothing is changed on Dray Dog.
export async function draydogPage(action){
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
    throw new Error('未知的 Draydog 操作。');
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
