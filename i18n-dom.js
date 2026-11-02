// Keeps the page in the chosen language: every text and label is translated as it appears, including messages the
// code writes later, and goes back through its Chinese source when the language changes. Mail previews stay as they are.
import {translate} from './i18n.js';

const ATTRIBUTES=['title','placeholder','aria-label'];
const LEAVE_ALONE='script,style,textarea,#mailBody,#subject,#language';
const HTML_LANG={zh:'zh-CN',en:'en',es:'es'};

export function createLocalizer(root=document.documentElement){
  let language='zh';
  const memory=new WeakMap();
  // Reuses the remembered source unless the code has written something new since.
  const render=(owner,key,current,write)=>{
    const seen=memory.get(owner)||{},entry=seen[key];
    const source=entry&&entry.shown===current?entry.source:current,shown=translate(source,language);
    seen[key]={source,shown};memory.set(owner,seen);
    if(shown!==current)write(shown);
  };
  const text=node=>{if(!node.parentElement?.closest(LEAVE_ALONE))render(node,'text',node.nodeValue,value=>{node.nodeValue=value;});};
  const attributes=element=>{
    if(element.closest('#mailBody,#subject'))return;
    for(const name of ATTRIBUTES)if(element.hasAttribute(name))render(element,name,element.getAttribute(name),value=>element.setAttribute(name,value));
  };
  const walk=start=>{
    if(start.nodeType===Node.TEXT_NODE){text(start);return;}
    if(start.nodeType!==Node.ELEMENT_NODE)return;
    attributes(start);
    const walker=document.createTreeWalker(start,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const node=walker.currentNode;if(node.nodeType===Node.TEXT_NODE)text(node);else attributes(node);}
  };
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='childList')record.addedNodes.forEach(walk);
      else if(record.type==='characterData')text(record.target);
      else attributes(record.target);
    }
  }).observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRIBUTES});
  return {set(next){language=next;document.documentElement.lang=HTML_LANG[next]||next;walk(root);},get language(){return language;}};
}
