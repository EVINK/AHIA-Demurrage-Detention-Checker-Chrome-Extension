// @ts-nocheck
// 查柜 rules (steps 7–13), Chrome-free so they are unit tested. Input: Dray Dog containers (api.draydog.com
// GET /containers/) and the 提柜 baseline read by TH_ReadPickup. Output: cell changes and row moves, each change
// carrying the value read, so the write script can refuse a cell someone changed in the meantime.
//
// 提柜 columns: A 放行 ✔, B 运输/扣留/查验信息, C MBL, D 柜号, G 摆置, H 车架, K LFD (date serial, mm/dd),
// L PIN formula (never written), M 预约日期 (date serial), N 预约时段 (day fraction, hh:mm), P 码头.

export const COLUMNS={A:1,B:2,G:7,H:8,K:11,M:13,N:14};
const TZ='America/Los_Angeles';

// Dray Dog hold types → the B column words the sheet already uses.
const HOLD_WORDS={'Customs Hold':'Custom_H','Line Hold':'Line_H','Freight Hold':'Freight_H','TMF Hold':'TMF_H','CTF Hold':'CTF_H',
  'USDA Hold':'USDA_H','Terminal Hold':'Terminal_H','Demurrage Hold':'Demurrage_H','FDA Hold':'FDA_H','Customs Exam Hold':'CEX'};
// Words the plugin adds and removes in B. Anything else in B (ETA, 卸船, CEX-1A, 倉儲 …) is the team's and stays.
const MANAGED=/(^|[^A-Za-z])(Customs?_H|Line_H|Freight_H|TMF_H|CTF_H|USDA_H|Terminal_H|Demurrage_H|FDA_H|Closed_Area)(?![A-Za-z])/gi;
// A customs status nobody knows yet is not a hold. (LBCT's "Customs BL General Release" stays one: LBCT reports the
// container as "NO (HOLD)", and the team marks it Custom_H.)
const NOT_A_HOLD=/status unavailable/i;

const pad=n=>String(n).padStart(2,'0');
/** 'YYYY-MM-DD' → Excel serial. */
export const serialOf=iso=>{const [y,m,d]=iso.split('-').map(Number);return (Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000;};
/** Excel serial → 'MM/DD'. */
export const mmddOf=serial=>{const t=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);return `${pad(t.getUTCMonth()+1)}/${pad(t.getUTCDate())}`;};
export const hhmmOf=fraction=>{const minutes=Math.round((fraction%1)*1440);return `${pad(Math.floor(minutes/60)%24)}:${pad(minutes%60)}`;};
/** What a K/M cell shows, whether it holds a serial or text. */
export function dateText(value){
  if(value===''||value==null)return '';
  if(typeof value==='number')return mmddOf(value);
  const m=String(value).match(/^(\d{1,2})\/(\d{1,2})/);return m?`${pad(m[1])}/${pad(m[2])}`:String(value);
}
export function timeText(value){
  if(value===''||value==null)return '';
  if(typeof value==='number')return hhmmOf(value);
  const m=String(value).match(/^(\d{1,2}):(\d{2})/);return m?`${pad(m[1])}:${m[2]}`:String(value);
}
/** An instant → {date:'YYYY-MM-DD', time:'HH:MM'} in Los Angeles. */
export function laParts(iso){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
/** "SSL LFD 11/06", "Line LFD 11/6", "Line 11/06" in a note → 'YYYY-MM-DD', the year closest to `near`. */
export function noteLfd(note,near){
  const m=String(note||'').match(/(?:SSL\s*LFD|Line\s*LFD|Line)\s*[:：]?\s*(\d{1,2})\/(\d{1,2})/i);
  if(!m)return null;
  const base=new Date(near||Date.now());let best=null;
  for(const year of [base.getUTCFullYear()-1,base.getUTCFullYear(),base.getUTCFullYear()+1]){
    const iso=`${year}-${pad(m[1])}-${pad(m[2])}`,diff=Math.abs(Date.parse(iso)-base.getTime());
    if(!best||diff<best.diff)best={iso,diff};
  }
  return best.iso;
}
const strings=value=>{const out=[];const walk=v=>{if(v==null)return;if(typeof v==='string')out.push(v);else if(Array.isArray(v))v.forEach(walk);else if(typeof v==='object')Object.values(v).forEach(walk);};walk(value);return out;};

/** One Dray Dog container → the status the rules and the cache use. Unknown stays null. */
export function observe(c,now=Date.now(),{lineCheck=false}={}){
  const status=c.import_status||null,statuses=c.import_statuses||[];
  const holds=[];
  for(const hold of status?.parsed_holds||[]){
    if(NOT_A_HOLD.test(hold.raw_type||''))continue;
    const word=HOLD_WORDS[hold.type]||(hold.type?hold.type.replace(/\s*Hold$/,'').replace(/\s+/g,'_')+'_H':null);
    if(word&&!holds.includes(word))holds.push(word);
  }
  const appointment=c.latest_appointment&&['scheduled','in_progress'].includes(c.latest_appointment.status)&&c.latest_appointment.window_start?c.latest_appointment:null;
  // Deck / wheel evidence: values only (a key is literally named "Wheeled/Decked"), from every source.
  const evidence=[...statuses,status].filter(Boolean).flatMap(s=>[s.location,...strings(s.extra_data)]).concat(appointment?strings(appointment.extra_data):[]).join(' | ');
  const decked=/deck/i.test(evidence);
  const wheeled=[...statuses,status].some(s=>s?.wheeled===true)||/\bwheel(ed|s)?\b/i.test(evidence);
  const position=decked?'Deck':wheeled?'Wheeled':(status||statuses.length)?'Ground':null;
  const category=c.cycle_state==='import_appt_booked'?'Appointed':c.cycle_state==='import_appt_booking'?'Bookable':String(c.cycle_state||'unknown').replace(/_/g,' ').toUpperCase();
  return {
    container:c.container_number,state:c.cycle_state||null,category,
    terminal:String(c.last_related_terminal||status?.terminal||'').toUpperCase(),
    holds,closedArea:status?.closed_area??null,ready:status?.ready_for_appointment??null,available:status?.available_for_pickup??null,
    // "Check Line for LFD": the terminal date is not the line's, so only the line's own date or a note counts.
    lfd:lineCheck?null:c.last_free_date||status?.last_free_date||null,lineCheck,lineLfd:c.line_last_free_date||status?.line_last_free_date||null,
    note:c.note_body||'',noteLfd:noteLfd(c.note_body,c.last_free_date?Date.parse(c.last_free_date):now),
    appointment:appointment?{status:appointment.status,start:appointment.window_start,end:appointment.window_end||null,...laParts(appointment.window_start)}:null,
    position,eta:c.vessel_eta||status?.eta||null,location:status?.location||'',tags:c.tags||[],mbl:c.master_bl||status?.master_bill_of_lading||''
  };
}

/** Status cell: remove words for holds that are gone, add new ones; the team's other text stays as it is. */
export function statusCell(current,words){
  let text=String(current||'');
  const want=new Set(words.map(w=>w.toLowerCase()));
  const have=new Set();
  text=text.replace(MANAGED,(all,lead,word)=>{
    const key=word.toLowerCase().replace(/^customs_h$/,'custom_h');
    if(want.has(key)&&!have.has(key)){have.add(key);return all;}
    return lead;
  });
  // CEX stays once written (CEX-1A, CEX-Xray are exam details the team keeps); add plain CEX only when none.
  if(want.has('cex')&&/CEX/i.test(text))have.add('cex');
  const missing=words.filter(w=>!have.has(w.toLowerCase()));
  text=text.replace(/\s*,\s*,+\s*/g,',').replace(/^[\s,，]+|[\s,，]+$/g,'').replace(/ {2,}/g,' ');
  return missing.length?(text?`${text},${missing.join(',')}`:missing.join(',')):text;
}

/** The B column words for a status, Closed Area included. */
export const statusWords=s=>[...s.holds,...(s.closedArea===true?['Closed_Area']:[])];

/** Target values for one container (steps 7–10). `undefined` = do not touch. */
export function targets(s,row){
  const out={};
  if(!['Appointed','Bookable'].includes(s.category))return out;
  // 7. Pick-up and holds.
  const words=statusWords(s);
  // Owner, 11/4: every Appointed / Bookable container without a hold gets ✔ (Closed Area still blocks: it is in
  // the B column words). Dray Dog's "available for pickup" is not used: FMS does not report it, and a Bookable
  // container is often "not available" only because it has no appointment yet.
  if(row.A===''||row.A==='✔')out.A=words.length?'':'✔';
  out.B=statusCell(row.B,words);
  // 8. Position, only over the standard words (RENT and other manual chassis notes stay).
  if(s.position){
    const [g,h]={Deck:['Deck','OWN'],Wheeled:['Wheeled','POOL'],Ground:['Ground','OWN']}[s.position];
    if(['','Deck','Wheeled','Ground'].includes(row.G))out.G=g;
    if(['','OWN','POOL'].includes(row.H))out.H=h;
  }
  // 9. LFD: the earliest of Dray Dog's, the line's and a note's date; unknown is blank, never a guess.
  const dates=[s.lfd,s.lineLfd,s.noteLfd].filter(Boolean).sort();
  out.K=dates[0]||'';
  // 10. Appointment (Appointed only; a Bookable container keeps whatever is there).
  if(s.category==='Appointed'&&s.appointment){out.M=s.appointment.date;out.N=s.appointment.time;}
  return out;
}

/** Sheet value → comparable text, for each column. */
export const SHOWN={A:v=>String(v),B:v=>String(v),G:v=>String(v),H:v=>String(v),K:dateText,M:dateText,N:timeText};
/** Target → value to write. Dates as serials so the mm/dd format still applies. */
const written={A:v=>v,B:v=>v,G:v=>v,H:v=>v,K:v=>v?serialOf(v):'',M:v=>v?serialOf(v):'',N:v=>{if(!v)return '';const [h,m]=v.split(':').map(Number);return (h*60+m)/1440;}};
const targetText={A:v=>v,B:v=>v,G:v=>v,H:v=>v,K:v=>v?v.slice(5).replace('-','/'):'',M:v=>v?v.slice(5).replace('-','/'):'',N:v=>v};

/** Baseline rows from TH_ReadPickup: [row, A, B, C, D, E, F, G, H, K, M, N, P]. */
export function parseBaseline(rows){
  const list=rows.map(([row,A,B,C,D,E,F,G,H,K,M,N,P])=>({row,A:String(A),B:String(B),C:String(C),D:String(D).toUpperCase().replace(/\s/g,''),E,F,G:String(G),H:String(H),K,M,N,P:String(P).trim()}));
  const text=r=>[r.A,r.B,r.C,r.D].join(' ');
  const find=re=>list.filter(r=>!/^[A-Z]{4}\d{7}$/.test(r.D)&&re.test(text(r))).map(r=>r.row);
  const markers={unscheduled:find(/未排程/),unreleased:find(/未放行/),byTerminal:find(/按码头排/),cancelled:find(/取消\s*D\s*\/?\s*O/i)};
  return {rows:list,markers};
}

/** Steps 7–13: the cells to change and the rows to move. Every skip carries a reason for the report. */
export function plan(statuses,baseline){
  const {rows,markers}=baseline;
  const byId=new Map();
  for(const r of rows)if(/^[A-Z]{4}\d{7}$/.test(r.D))byId.set(r.D,[...(byId.get(r.D)||[]),r]);
  const one=list=>list?.length===1?list[0]:null;
  const section={unscheduled:one(markers.unscheduled),unreleased:one(markers.unreleased),byTerminal:one(markers.byTerminal),cancelled:one(markers.cancelled)};
  const changes=[],moves=[],skipped=[];
  for(const s of statuses){
    if(!['Appointed','Bookable'].includes(s.category))continue;
    const found=byId.get(s.container)||[];
    if(found.length!==1){skipped.push({container:s.container,reason:found.length?`提柜表里有 ${found.length} 行这个柜号，请人工确认`:'提柜表里找不到这个柜号'});continue;}
    const row=found[0];
    if(section.cancelled&&row.row>section.cancelled)continue; // 取消DO and below are not checked
    const goal=targets(s,row);
    const cells=[];
    for(const [col,target] of Object.entries(goal)){
      if(target===undefined)continue;
      const before=row[col];
      if(SHOWN[col](before)===targetText[col](target))continue;
      cells.push({col,column:COLUMNS[col],before,beforeText:SHOWN[col](before),after:written[col](target),afterText:targetText[col](target)});
    }
    if(cells.length)changes.push({container:s.container,mbl:row.C,row:row.row,category:s.category,cells});
    // 11. A row below 未放行 moves under 按码头排, next to its terminal.
    if(section.unreleased&&row.row>section.unreleased){
      if(!section.byTerminal||section.byTerminal>section.unreleased){skipped.push({container:s.container,reason:'找不到“按码头排”分区，没有移动'});continue;}
      const next=rows.find(r=>r.row===row.row+1);
      if(next&&!/^[A-Z]{4}\d{7}$/.test(next.D)&&![...Object.values(markers)].flat().includes(next.row)){skipped.push({container:s.container,reason:'这一行下面还有附属行，需要人工移动'});continue;}
      moves.push({container:s.container,mbl:row.C,from:row.row,terminal:row.P});
    }
  }
  return {changes,moves,skipped,section};
}
