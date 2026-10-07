'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const i18n=require('../i18n'),marked=require('../libs/marked.umd.js'),appearance=require('../renderer/appearance');
const read=file=>{const target=path.join(__dirname,'..',file);return fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';};
class Element {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.attributes={};this.textContent='';this.innerHTML='';this.hidden=false;this.value='';this.style={setProperty(){}};}
 append(...nodes){this.children.push(...nodes);} appendChild(node){this.append(node);return node;} replaceChildren(...nodes){this.children=nodes;} addEventListener(name,callback){this.listeners[name]=callback;} setAttribute(name,value){this.attributes[name]=String(value);} getAttribute(name){return this.attributes[name];} focus(){} setPointerCapture(){}
}
function documentFor(html){const nodes=new Map(),listeners={},properties=new Map();for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Element(match[1]);node.id=match[2];node.hidden=/\bhidden(?:\s|>)/.test(match[0]);for(const attribute of match[0].matchAll(/([a-z-]+)="([^"]*)"/g))node.setAttribute(attribute[1],attribute[2]);nodes.set(node.id,node);}return {nodes,listeners,properties,title:'',documentElement:{style:{setProperty:(key,value)=>properties.set(key,value)}},getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),addEventListener:(name,callback)=>listeners[name]=callback};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const ui={language:'zh-CN',font_family:'Microsoft YaHei',font_size:14};
const original='  # 设置\r\n\r\n| 字段 | 值 |\r\n| --- | --- |\r\n| Exact_ID | **原文** |\r\n\r\n```js\r\nconst Exact_ID = "<unsafe>";\r\n```\r\n\r\n- 原文\r\n- 第二行\r\n';
async function reader(initial={markdown:original,ui},overrides={}){
 const source=read('renderer/markdown.js');assert.ok(source,'Markdown reader script is implemented');
 const document=documentFor(read('renderer/markdown.html')),events={},sanitizations=[];
 const bridge={state:async()=>initial,onState:callback=>events.state=callback,...overrides};
 const window={mintoMarkdown:bridge,MintoI18n:i18n,MintoAppearance:appearance,marked,DOMPurify:{sanitize:(html,options)=>{sanitizations.push({html,options});return '<p>Sanitized output</p>';}}};
 vm.runInNewContext(source,{window,document,console});await settle();return {document,events,sanitizations};
}
async function chat(messages,overrides={}){
 const document=documentFor(read('renderer/chat.html')),events={},requests=[],value={settings:{ui},save:{id:'Save_Exact',messages,relationship:{score:60}},relationshipStage:'温暖',busy:false,busyAudio:false,paused:false};
 const api={state:async()=>value,onState:callback=>events.state=callback,onAgent:callback=>events.agent=callback,onReply:callback=>events.reply=callback,markdownMenu:async data=>requests.push(JSON.parse(JSON.stringify(data))),...overrides};
 vm.runInNewContext(read('renderer/chat.js'),{document,window:{minto:api,MintoI18n:{...i18n,apply(){}},MintoAppearance:appearance,addEventListener(){}},console});await settle();return {document,events,requests,value};
}
test('assistant context menu uses the exact stored message index without altering chat text',async()=>{
 const messages=[{role:'user',content:'Question'},{role:'assistant',content:original},{role:'user',content:'Next'},{role:'assistant',content:'普通の返事です。'}],app=await chat(messages),rows=app.document.getElementById('chat-history').children;
 assert.equal(rows[0].children[1].listeners.contextmenu,undefined);
 for(const index of [1,3]){const content=rows[index].children[1];assert.equal(content.textContent,messages[index].content);assert.equal(typeof content.listeners.contextmenu,'function');let prevented=0,stopped=0;await content.listeners.contextmenu({preventDefault:()=>prevented++,stopPropagation:()=>stopped++});assert.equal(prevented,1);assert.equal(stopped,1);}
 assert.deepEqual(app.requests,[{save_id:'Save_Exact',message_index:1},{save_id:'Save_Exact',message_index:3}]);
 const next={...app.value,save:{...app.value.save,id:'Second_Save',messages:[{role:'assistant',content:'Old reply'}]}};app.events.state(next);await app.document.getElementById('chat-history').children[0].children[1].listeners.contextmenu({preventDefault(){},stopPropagation(){}});assert.deepEqual(app.requests[2],{save_id:'Second_Save',message_index:0});
});
test('context menu failure produces the localized reader error',async()=>{
 const app=await chat([{role:'assistant',content:'Reply'}],{markdownMenu:async()=>{throw new Error('Exact diagnostic');}}),content=app.document.getElementById('chat-history').children[0].children[1];assert.equal(typeof content.listeners.contextmenu,'function');await content.listeners.contextmenu({preventDefault(){},stopPropagation(){}});assert.equal(app.document.getElementById('chat-status').textContent,'无法打开 Markdown 阅读窗口');
});
test('reader preserves exact Markdown source and switches between preview and source',async()=>{
 const app=await reader(),node=id=>app.document.getElementById(id);assert.equal(node('markdown-source').textContent,original);assert.equal(node('markdown-preview').hidden,false);assert.equal(node('markdown-source').hidden,true);assert.equal(node('markdown-preview-tab').getAttribute('aria-selected'),'true');
 node('markdown-source-tab').onclick();assert.equal(node('markdown-source').hidden,false);assert.equal(node('markdown-preview').hidden,true);assert.equal(node('markdown-source-tab').getAttribute('aria-selected'),'true');assert.equal(node('markdown-source').textContent,original);
 node('markdown-preview-tab').onclick();assert.equal(node('markdown-preview').hidden,false);assert.equal(node('markdown-source').hidden,true);
});
test('reader sends parsed GFM HTML through the restrictive sanitizer before displaying it',async()=>{
 const app=await reader(),call=app.sanitizations[0];assert.ok(call);assert.match(call.html,/<h1>设置<\/h1>/);assert.match(call.html,/<table>/);assert.match(call.html,/<pre><code class="language-js">/);assert.match(call.html,/<ul>/);assert.equal(call.options.USE_PROFILES.html,true);assert.ok(call.options.FORBID_ATTR.includes('style'));
 for(const tag of ['script','style','img','iframe','object','embed','form','input','button','textarea','select','link','meta','base','audio','video'])assert.ok(call.options.FORBID_TAGS.includes(tag),tag);
 assert.equal(app.document.getElementById('markdown-preview').innerHTML,'<p>Sanitized output</p>');
});
test('reader blocks links without invoking application tools',async()=>{
 const app=await reader(),preview=app.document.getElementById('markdown-preview');let prevented=0;assert.equal(typeof preview.listeners.click,'function');preview.listeners.click({target:{closest:selector=>{assert.equal(selector,'a');return {}; }},preventDefault:()=>prevented++});assert.equal(prevented,1);
});
test('reader updates three-language controls and appearance while preserving source content',async()=>{
 const app=await reader(),node=id=>app.document.getElementById(id);node('markdown-source-tab').onclick();
 for(const language of ['zh-CN','ja','en']){app.events.state({markdown:original,ui:{...ui,language,font_family:'Yu Gothic',font_size:21}});assert.equal(app.document.documentElement.lang,language);assert.equal(node('markdown-preview-tab').textContent,i18n.translate(language,'预览'));assert.equal(node('markdown-source-tab').textContent,i18n.translate(language,'原文'));assert.equal(app.document.title,i18n.translate(language,'Markdown 阅读'));assert.equal(node('markdown-source').textContent,original);assert.equal(node('markdown-source').hidden,false);}
 assert.equal(app.document.properties.get('--minto-ui-scale'),'1.5');assert.ok(app.document.properties.get('--minto-font-family').startsWith('"Yu Gothic"'));
 for(const source of ['Markdown 阅读','预览','原文','无法打开 Markdown 阅读窗口'])for(const language of ['ja','en'])assert.ok(Object.hasOwn(i18n.catalogs[language],source));
});
test('reader declares local-only scripts with network, images, frames and forms denied',()=>{
 const html=read('renderer/markdown.html');assert.ok(html,'Markdown reader document is implemented');const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];assert.ok(policy);
 for(const rule of ["default-src 'none'","script-src 'self'","connect-src 'none'","img-src 'none'","object-src 'none'","frame-src 'none'","form-action 'none'","base-uri 'none'"])assert.ok(policy.includes(rule),rule);
 for(const file of ['../i18n.js','appearance.js','../libs/marked.umd.js','../libs/purify.min.js','markdown.js'])assert.ok(html.includes('src="'+file+'"'),file);assert.ok(html.includes('href="appearance.css"'));assert.equal(html.includes('src="chat.js"'),false);
});
