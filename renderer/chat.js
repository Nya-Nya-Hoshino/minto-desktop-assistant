'use strict';
const api=window.minto,i18n=window.MintoI18n;let currentState,lastSave='',renderedCount=-1,language='zh-CN',statusSource='話したいこと、聞かせてほしいのです。',submitting=false;
const panel=document.getElementById('chat-panel'),history=document.getElementById('chat-history'),status=document.getElementById('chat-status'),input=document.getElementById('chat-input'),t=(source,values)=>i18n.translate(language,source,values);
function setStatus(source){statusSource=source;status.textContent=i18n.localizeError(language,t(source));}
function toggle(force){api.chatToggle(force);if(force!==false)input.focus();}
window.mintoChat={toggle,setStatus};
function append(role,text,messageIndex){const row=document.createElement('div');row.className='message '+role;const label=document.createElement('small');label.textContent=role==='user'?t('あなた'):'ミント';const content=document.createElement('span');content.textContent=text;if(role==='assistant')content.addEventListener('contextmenu',async event=>{event.preventDefault();event.stopPropagation();try{await api.markdownMenu({save_id:currentState.save.id,message_index:messageIndex});}catch{setStatus('无法打开 Markdown 阅读窗口');}});row.append(label,content);history.appendChild(row);}
const activity=document.getElementById('agent-activity'),activityRecords=[];
function clearActivity(){activityRecords.length=0;activity.replaceChildren();activity.hidden=true;}
function activityRow(event){const row=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent=event.status==='tool-start'?t('第 {step} 步 · {tool}',{step:event.step??'',tool:event.tool??''}):t(event.isError?'工具错误 · {tool}':'工具返回 · {tool}',{tool:event.tool??''});if(event.isError)row.className='tool-error';body.textContent=event.status==='tool-start'?JSON.stringify(event.input??{},null,2):String(event.output??event.message??'');row.append(summary,body);return row;}
function activityRender(){const expanded=[...activity.children].map(row=>row.open);activity.replaceChildren(...activityRecords.map((event,index)=>{const row=activityRow(event);row.open=Boolean(expanded[index]);return row;}));activity.hidden=activityRecords.length===0;activity.scrollTop=activity.scrollHeight;}
function agentEvent(event){if(event.status==='start'){clearActivity();setStatus('正在使用工具');return;}if(event.status==='tool-start'||event.status==='tool-result'){activityRecords.push(event);activity.appendChild(activityRow(event));if(activityRecords.length>100){activityRecords.shift();activity.firstElementChild.remove();}activity.hidden=false;activity.scrollTop=activity.scrollHeight;return;}const messages={done:'工具执行完成',cancelled:'工具执行已停止',error:'工具执行失败'};if(Object.hasOwn(messages,event.status))setStatus(event.message?messages[event.status]+'\n'+event.message:messages[event.status]);}
api.onAgent(agentEvent);
const latest=document.getElementById('chat-latest');
function atLatest(){return history.scrollHeight-history.scrollTop-history.clientHeight<48;}
function scrollLatest(){history.scrollTop=history.scrollHeight;latest.hidden=true;}
latest.onclick=scrollLatest;history.addEventListener('scroll',()=>{if(atLatest())latest.hidden=true;});
function resizeInput(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,100)+'px';}
input.addEventListener('input',resizeInput);
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();document.getElementById('chat-form').requestSubmit();}});
function render(state){
 const saveChanged=lastSave!==state.save.id,follow=saveChanged||atLatest(),scrollTop=history.scrollTop;
 if(lastSave&&saveChanged)clearActivity();window.MintoAppearance.apply(document,state.settings.ui);const changed=language!==state.settings.ui.language;language=state.settings.ui.language;currentState=state;
 document.getElementById('relationship-label').textContent=t('好感 {score}/100 · {stage}',{score:state.save.relationship.score,stage:t(state.relationshipStage)});document.getElementById('relationship-meter').value=state.save.relationship.score;
 if(changed){i18n.apply(document,language);setStatus(statusSource);activityRender();}
 if(changed||saveChanged||renderedCount!==state.save.messages.length){const newMessages=!saveChanged&&state.save.messages.length>renderedCount;history.replaceChildren();for(const [messageIndex,message] of state.save.messages.entries())append(message.role,message.content,messageIndex);if(follow)scrollLatest();else{history.scrollTop=scrollTop;if(newMessages)latest.hidden=false;}lastSave=state.save.id;renderedCount=state.save.messages.length;}
 document.getElementById('chat-empty').hidden=state.save.messages.length!==0;
 document.getElementById('send-button').hidden=state.busy&&!state.busyProactive;document.getElementById('send-button').disabled=submitting;
 document.getElementById('cancel-button').hidden=!(state.busy||state.busyAudio);document.getElementById('observe-screen-button').disabled=state.busy;document.getElementById('observe-region-button').disabled=state.busy||state.busyAudio;document.getElementById('pause-button').textContent=t(state.paused?'観察を再開':'観察を休む');
 if(state.busy)setStatus('少し待ってほしいのです…');else if(['少し待ってほしいのです…','考えているのです…'].includes(statusSource))setStatus('');
}
i18n.apply(document,language);api.onState(render);api.state().then(render).catch(()=>setStatus('設定を読み込めませんでした。'));
api.onReply(reply=>{if(reply.status==='start'){if(reply.proactive)api.chatReveal();setStatus('考えているのです…');}if(reply.status==='done'){api.chatReveal();setStatus('');}if(['error','cancelled','observation-error','summary-error'].includes(reply.status))setStatus(reply.detail?reply.message+'\n'+reply.detail:reply.message);});
document.getElementById('chat-form').addEventListener('submit',async event=>{
 event.preventDefault();const draft=input.value,text=draft.trim();if(!text||submitting||(currentState?.busy&&!currentState?.busyProactive))return;
 submitting=true;document.getElementById('send-button').disabled=true;setStatus('考えているのです…');
 try{await api.chat({text,observe:document.getElementById('observe-checkbox').checked});if(input.value===draft){input.value='';resizeInput();}scrollLatest();}
 catch(error){setStatus('送信できませんでした。設定を確認してください。'+(error.message?'\n'+error.message:''));}
 finally{submitting=false;document.getElementById('send-button').disabled=false;}
});
document.getElementById('observe-region-button').onclick=async()=>{try{const result=await api.regionSelect();if(!result.cancelled){await api.observeNow();toggle(true);setStatus('画面を見ているのです…');}}catch(error){setStatus(error.message);}};
document.getElementById('cancel-button').onclick=()=>api.cancel();document.getElementById('chat-close').onclick=()=>toggle(false);document.getElementById('settings-button').onclick=()=>api.openSettings();document.getElementById('pause-button').onclick=()=>api.pause();document.getElementById('chat-zoom-in').onclick=()=>api.resize(1.08);document.getElementById('chat-zoom-out').onclick=()=>api.resize(0.92);
document.getElementById('observe-screen-button').onclick=async()=>{try{await api.observeNow();toggle(true);setStatus('画面を見ているのです…');}catch{setStatus('画面を観察できませんでした。設定を確認してください。');}};

const resizeHandle=document.getElementById('chat-resize-handle');let resizing=null;
resizeHandle.onpointerdown=event=>{if(event.button!==0)return;resizing={x:event.screenX,y:event.screenY};resizeHandle.setPointerCapture(event.pointerId);event.preventDefault();};
resizeHandle.onpointermove=event=>{if(!resizing)return;api.chatResize({dw:event.screenX-resizing.x,dh:event.screenY-resizing.y});resizing={x:event.screenX,y:event.screenY};};
resizeHandle.onpointerup=resizeHandle.onpointercancel=()=>{resizing=null;};
window.addEventListener('focus',()=>input.focus());
