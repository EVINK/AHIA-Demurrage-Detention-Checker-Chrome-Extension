// @ts-nocheck
// 查柜 rules (steps 7–13), Chrome-free so they are unit tested. Input: Dray Dog containers (api.draydog.com
// GET /containers/) and the 提柜 baseline read by TH_ReadPickup. Output: cell changes and row moves, each change
// carrying the value read, so the write script can refuse a cell someone changed in the meantime.
//
// 提柜 columns: A 放行 ✔, B 运输/扣留/查验信息, C MBL, D 柜号, G 摆置, H 车架, K LFD (date serial, mm/dd),
// L PIN formula (never written), M 预约日期 (date serial), N 预约时段 (day fraction, hh:mm), P 码头.

export const COLUMNS={A:1,B:2,G:7,H:8,K:11,M:13,N:14};
const TZ='America/Los_Angeles';

// Hold keywords, editable by the owner (11/4) on the 实验性功能 page. Each Dray Dog hold is matched first by its
// text (`by:'text'`, the terminal's own wording, case-insensitive), then by Dray Dog's hold type (`by:'type'`).
// `word` is what goes in column B; an empty word means "not a hold". A hold matching nothing is unknown: the run
// pauses and asks the owner, and the answer is added here.
// (LBCT's "Customs BL Genereal Release" is a Customs Hold: LBCT reports the container as "NO (HOLD)", and the team
// marks it Custom_H. "Customs Status Unavailable" is a status nobody knows yet, not a hold.)
export const DEFAULT_HOLD_RULES=Object.freeze([
  ...[['Customs Hold','Custom_H'],['Line Hold','Line_H'],['Freight Hold','Freight_H'],['TMF Hold','TMF_H'],['CTF Hold','CTF_H'],
    ['USDA Hold','USDA_H'],['Terminal Hold','Terminal_H'],['Demurrage Hold','Demurrage_H'],['FDA Hold','FDA_H'],['Customs Exam Hold','CEX']]
    .map(([match,word])=>({match,by:'type',word})),
  {match:'Customs Status Unavailable',by:'text',word:''}
]);
const lower=text=>String(text||'').trim().toLowerCase();
/** Checks and cleans a rule list from storage or the page. */
export function validHoldRules(rules){
  if(!Array.isArray(rules))return DEFAULT_HOLD_RULES.map(r=>({...r}));
  const out=[],seen=new Set();
  for(const r of rules){
    const match=String(r?.match||'').trim().slice(0,200),by=['type','tag','label'].includes(r?.by)?r.by:'text',word=String(r?.word||'').trim().slice(0,40);
    if(!match)continue;
    if(word&&!/^[A-Za-z][A-Za-z0-9_\-]*$/.test(word))throw new Error(`B 列写法只能用字母、数字、_ 和 -：${word}`);
    const key=by+':'+lower(match);if(seen.has(key))continue;seen.add(key);
    out.push({match,by,word});
  }
  return out;
}
/** A Dray Dog hold → {word} (word '' = not a hold), or null when no rule knows it. */
export function holdRuleFor(hold,rules){
  const text=lower(hold.raw_type),type=lower(hold.type);
  return rules.find(r=>r.by==='text'&&lower(r.match)===text)||(type?rules.find(r=>r.by==='type'&&lower(r.match)===type):null)||null;
}
/** Words the plugin adds and removes in B: every rule's word and Closed_Area. Anything else in B (ETA, 卸船,
 * CEX-1A, 倉儲 …) is the team's and stays. */
export function managedPattern(rules=DEFAULT_HOLD_RULES){
  const words=[...new Set([...rules.map(r=>r.word).filter(w=>w&&w!=='CEX'),'Closed_Area'])];
  const quoted=words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).map(w=>/^Custom_H$/i.test(w)?'Customs?_H':w);
  return new RegExp(`(^|[^A-Za-z])(${quoted.join('|')})(?![A-Za-z])`,'gi');
}

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

/** Tag-like signals of a Dray Dog container besides its own tags and main hold list, as keyword texts. Each
 * distinct text is asked about once (`by:'label'`), so a new kind of status never passes unnoticed:
 * - the "TMF (Pier Pass)" / "PortCheck: CTF" badges (pier_pass, clean_truck_fee records), by state;
 * - holds reported by the other sources (eModal, Port Optimizer …), which the main hold list may not include;
 * - status words and remarks in each source's extra data (customs, freight, line release, delivery order, "available" …);
 * - fees owed at the terminal or line;
 * - an appointment without a truck plate ("No Plate"). */
export function draydogSignals(c){
  const out=[];
  const add=text=>{text=String(text).replace(/\s+/g,' ').trim().slice(0,120);if(text&&!out.some(t=>lower(t)===lower(text)))out.push(text);};
  for(const [name,record] of [['TMF (Pier Pass)',c.pier_pass],['PortCheck: CTF',c.clean_truck_fee]])
    if(record&&typeof record==='object')add(`${name}: ${record.has_hold?'hold':'no hold'}, fee ${record.fee_paid?'paid':'unpaid'}`);
  const main=c.import_status||null;
  for(const s of [main,...(c.import_statuses||[])].filter(Boolean)){
    const source=String(s.source||s.terminal||'source');
    // The main source's holds are the hold list itself; its copy in import_statuses is skipped.
    if(s!==main&&source!==String(main?.source||''))for(const hold of s.holds||[])add(`${source} hold: ${hold}`);
    for(const [key,value] of Object.entries(s.extra_data||{})){
      if(/owed|fees?$/i.test(key)&&typeof value==='number'){if(value>0)add(`${source} ${key}: owed`);continue;}
      if(!/status|available|release|hold|order|customs|freight|remark/i.test(key))continue;
      if(typeof value==='string'&&value.trim())add(`${source} ${key}: ${value}`);
      else if(typeof value==='boolean')add(`${source} ${key}: ${value?'yes':'no'}`);
    }
  }
  const appointment=c.latest_appointment;
  if(appointment&&['scheduled','in_progress'].includes(appointment.status)&&!String(appointment.truck_license_plate_number||'').trim())add('Appointment: no truck plate');
  return out;
}

/** One Dray Dog container → the status the rules and the cache use. Unknown stays null. */
export function observe(c,now=Date.now(),{lineCheck=false,holdRules=DEFAULT_HOLD_RULES}={}){
  const status=c.import_status||null,statuses=c.import_statuses||[];
  const holds=[],unknownHolds=[];
  const parsed=status?.parsed_holds?.length?status.parsed_holds:(status?.holds||[]).map(raw=>({type:null,raw_type:raw}));
  for(const hold of parsed){
    const rule=holdRuleFor(hold,holdRules);
    if(!rule){if(!unknownHolds.some(u=>lower(u.text)===lower(hold.raw_type)))unknownHolds.push({text:String(hold.raw_type||'').trim(),type:hold.type||''});continue;}
    if(rule.word&&!holds.includes(rule.word))holds.push(rule.word);
  }
  // The team's own Dray Dog tags (e.g. "1H", "TEST") go through the same list (`by:'tag'`): an unknown tag pauses
  // the run too, and the answer says whether it holds the container.
  // Dray Dog's own markers (`by:'label'`, owner 11/4): the "TMF (Pier Pass)" and "PortCheck: CTF" badges come from
  // the pier_pass and clean_truck_fee records, not from tags. Each state ("hold / no hold, fee paid / unpaid") is
  // its own keyword, so a state never answered before pauses the run like a new tag.
  // Owner, 11/4: every other tag-like signal Dray Dog has is asked about the first time it appears, too
  // (see draydogSignals).
  const labels=draydogSignals(c);
  for(const [source,list] of [['tag',c.tags||[]],['label',labels]])for(const text of list){
    const rule=holdRules.find(r=>r.by===source&&lower(r.match)===lower(text));
    if(!rule){if(!unknownHolds.some(u=>u.source===source&&lower(u.text)===lower(text)))unknownHolds.push({text:String(text).trim(),type:'',source});continue;}
    if(rule.word&&!holds.includes(rule.word))holds.push(rule.word);
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
    holds,unknownHolds,closedArea:status?.closed_area??null,ready:status?.ready_for_appointment??null,available:status?.available_for_pickup??null,
    // "Check Line for LFD": the terminal date is not the line's, so only the line's own date or a note counts.
    lfd:lineCheck?null:c.last_free_date||status?.last_free_date||null,lineCheck,lineLfd:c.line_last_free_date||status?.line_last_free_date||null,
    note:c.note_body||'',noteLfd:noteLfd(c.note_body,c.last_free_date?Date.parse(c.last_free_date):now),
    appointment:appointment?{status:appointment.status,start:appointment.window_start,end:appointment.window_end||null,...laParts(appointment.window_start)}:null,
    position,eta:c.vessel_eta||status?.eta||null,location:status?.location||'',tags:c.tags||[],mbl:c.master_bl||status?.master_bill_of_lading||''
  };
}

/** Status cell: remove words for holds that are gone, add new ones; the team's other text stays as it is. */
export function statusCell(current,words,managed=managedPattern()){
  let text=String(current||'');
  const want=new Set(words.map(w=>w.toLowerCase()));
  const have=new Set();
  managed.lastIndex=0;
  text=text.replace(managed,(all,lead,word)=>{
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
export function targets(s,row,{managed=managedPattern()}={}){
  const out={};
  if(!['Appointed','Bookable'].includes(s.category))return out;
  // 7. Pick-up and holds.
  const words=statusWords(s);
  // Owner, 11/4: every Appointed / Bookable container without a hold gets ✔ (Closed Area still blocks: it is in
  // the B column words). Dray Dog's "available for pickup" is not used: FMS does not report it, and a Bookable
  // container is often "not available" only because it has no appointment yet.
  if(row.A===''||row.A==='✔')out.A=words.length?'':'✔';
  out.B=statusCell(row.B,words,managed);
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

/** Unknown Dray Dog holds of the containers that will be written, once each, with the containers they hold. */
export function unknownHolds(statuses){
  const out=new Map();
  for(const s of statuses){
    if(!['Appointed','Bookable'].includes(s.category))continue;
    for(const u of s.unknownHolds||[]){const key=(u.source||'hold')+'|'+lower(u.text)+'|'+lower(u.type);const seen=out.get(key)||{...u,containers:[]};seen.containers.push(s.container);out.set(key,seen);}
  }
  return [...out.values()];
}

/** Steps 7–13: the cells to change and the rows to move. Every skip carries a reason for the report. */
/** A row with a container in D and nothing else (A–P as read) is not a business row: ListA_Push skips it too. */
export const onlyContainer=r=>[r.A,r.B,r.C,r.E,r.F,r.G,r.H,r.K,r.M,r.N,r.P].every(v=>v===''||v==null);
/** The rows each container can be written to: above 取消DO (the cancelled and delivered history below is never
 * written) and not a bare container number. */
export function businessRows(baseline){
  const {rows,markers}=baseline;
  const cancelled=markers?.cancelled?.length===1?markers.cancelled[0]:Infinity;
  const byId=new Map();
  for(const r of rows)if(/^[A-Z]{4}\d{7}$/.test(r.D)&&r.row<cancelled&&!onlyContainer(r))byId.set(r.D,[...(byId.get(r.D)||[]),r]);
  return byId;
}
/** Containers to be written that sit on more than one business row: the owner picks the right one. */
export function duplicateRows(statuses,baseline){
  const byId=businessRows(baseline);
  return statuses.filter(s=>['Appointed','Bookable'].includes(s.category)&&(byId.get(s.container)?.length||0)>1)
    .map(s=>({container:s.container,rows:byId.get(s.container).map(r=>({row:r.row,A:r.A,B:r.B,C:r.C,P:r.P,G:r.G,H:r.H,K:SHOWN.K(r.K),M:SHOWN.M(r.M),N:SHOWN.N(r.N)}))}));
}

/** Steps 7–13. `chosen`: container → row number the owner picked among duplicate rows. */
export function plan(statuses,baseline,{holdRules=DEFAULT_HOLD_RULES,chosen={}}={}){
  const {rows,markers}=baseline;
  const managed=managedPattern(holdRules);
  const byId=businessRows(baseline);
  const one=list=>list?.length===1?list[0]:null;
  const section={unscheduled:one(markers.unscheduled),unreleased:one(markers.unreleased),byTerminal:one(markers.byTerminal),cancelled:one(markers.cancelled)};
  const changes=[],moves=[],skipped=[];
  for(const s of statuses){
    if(!['Appointed','Bookable'].includes(s.category))continue;
    const found=byId.get(s.container)||[];
    const picked=found.length>1&&chosen[s.container]?found.find(r=>r.row===Number(chosen[s.container])):null;
    if(found.length!==1&&!picked){skipped.push({container:s.container,reason:found.length?`提柜表里有 ${found.length} 行这个柜号，请人工确认`:'提柜表里找不到这个柜号'});continue;}
    const row=picked||found[0];
    const goal=targets(s,row,{managed});
    const cells=[];
    for(const [col,target] of Object.entries(goal)){
      if(target===undefined)continue;
      const before=row[col];
      if(SHOWN[col](before)===targetText[col](target))continue;
      cells.push({col,column:COLUMNS[col],before,beforeText:SHOWN[col](before),after:written[col](target),afterText:targetText[col](target)});
    }
    // `pick`: the chosen row among duplicates, so the write script uses that one rather than refusing.
    if(cells.length)changes.push({container:s.container,mbl:row.C,row:row.row,category:s.category,cells,...(picked?{pick:row.row}:{})});
    // 11. A row below 未放行 moves under 按码头排, next to its terminal.
    if(section.unreleased&&row.row>section.unreleased){
      if(!section.byTerminal||section.byTerminal>section.unreleased){skipped.push({container:s.container,reason:'找不到“按码头排”分区，没有移动'});continue;}
      const next=rows.find(r=>r.row===row.row+1);
      if(next&&!/^[A-Z]{4}\d{7}$/.test(next.D)&&![...Object.values(markers)].flat().includes(next.row)){skipped.push({container:s.container,reason:'这一行下面还有附属行，需要人工移动'});continue;}
      moves.push({container:s.container,mbl:row.C,from:row.row,terminal:row.P,...(picked?{pick:row.row}:{})});
    }
  }
  placeMoves(moves,rows,section);
  return {changes,moves,skipped,section};
}

/** Where each move lands, done in order the way TH_Apply does it: after the last row of the same terminal under
 * 按码头排, else at the end of that section; rows from there down shift by one. Sets `to` on each move. */
export function placeMoves(moves,rows,section){
  if(!moves.length||!section.byTerminal||!section.unreleased)return;
  let sheet=rows.map(r=>({row:r.row,D:r.D,P:r.P}));
  let unreleased=section.unreleased;
  for(const move of moves){
    const source=sheet.find(r=>r.D===move.container&&r.row===move.from);if(!source)continue;
    const from=source.row;
    const group=sheet.filter(r=>r.row>section.byTerminal&&r.row<unreleased&&/^[A-Z]{4}\d{7}$/.test(r.D)&&r.P.toUpperCase()===String(move.terminal).toUpperCase());
    const dest=group.length?Math.max(...group.map(r=>r.row))+1:unreleased;
    move.to=dest;
    // Cut `from`, insert at `dest` (dest is above from): rows dest..from-1 move down one.
    sheet=sheet.map(r=>r===source?{...r,row:dest}:(r.row>=dest&&r.row<from?{...r,row:r.row+1}:r));
    unreleased+=unreleased>=dest&&unreleased<from?1:0;
  }
}
