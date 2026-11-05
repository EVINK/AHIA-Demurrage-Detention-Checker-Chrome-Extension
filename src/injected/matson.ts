// @ts-nocheck
// Self-contained function injected into a www.matson.com tab (MAIN world). It calls the same endpoints the site's own
// pages call (shipment tracking by bill of lading, interactive vessel schedule), one request at a time, from the page
// itself, so the site's cookies and its form token (`#ttr` on the tracking page) apply. Nothing is typed or clicked.
export async function matsonPage(action,payload){
  try{
    const BASE='/wp-content/plugins/matson-plugin/Api_calls/';
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const post=async(file,data)=>{
      const response=await fetch(BASE+file,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams(data)});
      if(!response.ok)throw new Error(`Matson 返回错误 ${response.status}`);
      const text=await response.text();
      try{return JSON.parse(text);}catch{return null;}
    };
    if(action==='track'){
      const ttr=document.querySelector('#ttr')?.value||'';
      const out={};
      for(const bl of payload?.bls||[]){
        if(!/^\d{6,}$/.test(bl))continue;
        const data=await post('tracking_booking_proxy.php',{container_trackingnumber:bl,trackingVal:'tckbil',ttr});
        // Only the fields the rules use.
        out[bl]=Array.isArray(data)?data.map(e=>({bookingNumber:e.bookingNumber,containerNumber:e.containerNumber,checkDigit:e.checkDigit,originCode:e.originCode,loadPort:e.loadPort,dischargePort:e.dischargePort,
          vessel:e.vessel,voyage:e.voyage,direction:e.direction,vesselETA:e.vesselETA,availableDate:e.availableDate,
          events:(e.events||[]).map(v=>({date:v.date,location:v.location,status:v.status}))})):[];
        await wait(400);
      }
      return {ok:true,data:out};
    }
    if(action==='schedule'){
      const out={};
      for(const q of payload?.queries||[]){
        const data=await post('search.php',{selectedOrigin:q.origin,selectedDestination:'LAX',selectedStartDate:q.start,selectedEndDate:q.end});
        out[`${q.origin}|${q.start}|${q.end}`]=Array.isArray(data)?data.map(r=>({arrive:r.arrive,depart:r.depart,vvd:r.vvd,vessvoy:r.vessvoy})):[];
        await wait(400);
      }
      return {ok:true,data:out};
    }
    throw new Error('未知的 Matson 操作。');
  }catch(error){return {ok:false,error:error.message||String(error)};}
}
