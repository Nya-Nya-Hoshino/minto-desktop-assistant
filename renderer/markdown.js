'use strict';
const api=window.mintoMarkdown,i18n=window.MintoI18n;
const preview=document.getElementById('markdown-preview'),source=document.getElementById('markdown-source'),previewTab=document.getElementById('markdown-preview-tab'),sourceTab=document.getElementById('markdown-source-tab'),title=document.getElementById('markdown-title'),status=document.getElementById('markdown-status');
let language='zh-CN',lastMarkdown;
function selectSource(selected){preview.hidden=selected;source.hidden=!selected;previewTab.setAttribute('aria-selected',String(!selected));sourceTab.setAttribute('aria-selected',String(selected));}
previewTab.onclick=()=>selectSource(false);
sourceTab.onclick=()=>selectSource(true);
function blockLink(event){if(event.target.closest('a'))event.preventDefault();}
preview.addEventListener('click',blockLink);
preview.addEventListener('auxclick',blockLink);
preview.addEventListener('contextmenu',blockLink);
function render(state){
 language=state.ui.language;
 window.MintoAppearance.apply(document,state.ui);
 document.documentElement.lang=language;
 document.title=title.textContent=i18n.translate(language,'Markdown 阅读');
 previewTab.textContent=i18n.translate(language,'预览');
 sourceTab.textContent=i18n.translate(language,'原文');
 if(state.markdown!==lastMarkdown){
  source.textContent=state.markdown;
  const html=window.marked.parse(state.markdown,{async:false,gfm:true});
  preview.innerHTML=window.DOMPurify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['script','style','img','iframe','object','embed','form','input','button','textarea','select','option','link','meta','base','audio','video','source','track','canvas'],FORBID_ATTR:['style','href','src','srcset','target','download','ping','action','formaction','background','id','name']});
  lastMarkdown=state.markdown;
 }
 status.hidden=true;
}
api.onState(render);
api.state().then(render).catch(()=>{status.textContent=i18n.translate(language,'无法打开 Markdown 阅读窗口');status.hidden=false;});
