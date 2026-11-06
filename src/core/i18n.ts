// @ts-nocheck
// Interface languages. The source text is Chinese: strings pass through translate() at the point they reach the
// user, so messages raised anywhere (worker, Gmail, COSCO, ONE, KDocs pages) need no change. Mail is never translated.
import {STRINGS as MAIN_STRINGS} from './i18n-strings.ts';
import {LAB_STRINGS} from './i18n-labs.ts';
import {OOCL_STRINGS} from './i18n-oocl.ts';
import {CHANGELOG_STRINGS} from './i18n-changelog.ts';
const STRINGS=[...MAIN_STRINGS,...LAB_STRINGS,...OOCL_STRINGS,...CHANGELOG_STRINGS];

export const LANGUAGES=Object.freeze({zh:'中文',en:'English',es:'Español'});
const COLUMN={en:1,es:2};
/** An explicit choice wins; otherwise the browser language decides. */
export function resolveLanguage(choice,browser=''){
  if(Object.hasOwn(LANGUAGES,choice))return choice;
  const code=String(browser).toLowerCase();
  return code.startsWith('zh')?'zh':code.startsWith('es')?'es':'en';
}
const quote=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const CJK=/[㐀-鿿]/;
// Pieces joined in code may carry their own spaces: the surrounding text decides those.
const ROWS=STRINGS.map(row=>row.map(text=>text.trim()));
const entries=ROWS.map(row=>{
  const parts=row[0].split('{}'),holes=parts.length-1;
  return {key:row[0],row,holes,weight:row[0].replaceAll('{}','').length,
    whole:holes?new RegExp(`^${parts.map(quote).join('([\\s\\S]*?)')}$`):null,
    inner:new RegExp(parts.map(quote).join('([^\\s，。；：、（）「」·]+)'),'g')};
}).sort((a,b)=>b.weight-a.weight);
const exact=new Map(ROWS.map(row=>[row[0],row]));
const fill=(pattern,args,lang)=>pattern.replace(/\{(\d)(l?)\}/g,(_,index,lower)=>{
  const value=translate(args[Number(index)]??'',lang);
  return lower?value.toLowerCase():value;
});
const cache={en:new Map(),es:new Map()};
function lookup(core,lang){
  const column=COLUMN[lang],row=exact.get(core);
  if(row)return row[column];
  for(const entry of entries){
    if(!entry.holes)continue;
    const match=core.match(entry.whole);
    if(match)return fill(entry.row[column],match.slice(1),lang);
  }
  // Pieces joined in code: translate what is known and keep the rest (names, numbers) as it is.
  let text=core;
  for(const entry of entries){
    if(!CJK.test(text))break;
    if(!entry.weight)continue;
    entry.inner.lastIndex=0;
    text=text.replace(entry.inner,(...match)=>fill(entry.row[column],match.slice(1,entry.holes+1),lang));
  }
  return text.replace(/[，；：。（）「」“”]/g,c=>({'，':', ','；':'; ','：':': ','。':'. ','（':' (','）':') ','「':'"','」':'"','“':'"','”':'"'}[c]));
}
export function translate(text,lang){
  if(lang==='zh'||!COLUMN[lang]||typeof text!=='string'||!CJK.test(text))return text;
  const known=cache[lang].get(text);
  if(known!==undefined)return known;
  const [,lead,core,trail]=text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const result=lead+lookup(core,lang)+trail;
  cache[lang].set(text,result);
  return result;
}
