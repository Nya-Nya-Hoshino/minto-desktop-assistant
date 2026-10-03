'use strict';
const api=window.minto,i18n=window.MintoI18n;let currentState,lastSave='',renderedCount=-1,language='zh-CN',statusSource='話したいこと、聞かせてほしいのです。';
const panel=document.getElementById('chat-panel'),history=document.getElementById('chat-history'),status=document.getElementById('chat-status'),input=document.getElementById('chat-input'),t=source=>i18n.translate(language,source);
function setStatus(source){statusSource=source;status.textContent=i18n.localizeError(language,t(source));}
function toggle(force){api.chatToggle(force);if(force!==false)input.focus();}
window.mintoChat={toggle,setStatus};
function append(role,text){const row=document.createElement('div');row.className='message '+role;const label=document.createElement('small');label.textContent=role==='user'?t('あなた'):'ミント';const content=document.createElement('span');content.textContent=text;row.append(label,content);history.appendChild(row);}
function render(state){const changed=language!==state.settings.ui.language;language=state.settings.ui.language;currentState=state;if(changed){i18n.apply(document,language);setStatus(statusSource);}if(changed||lastSave!==state.save.id||renderedCount!==state.save.messages.length){history.replaceChildren();for(const message of state.save.messages)append(message.role,message.content);history.scrollTop=history.scrollHeight;lastSave=state.save.id;renderedCount=state.save.messages.length;}document.getElementById('send-button').hidden=state.busy;document.getElementById('cancel-button').hidden=!(state.busy||state.busyAudio);input.disabled=state.busy;document.getElementById('observe-screen-button').disabled=state.busy;document.getElementById('pause-button').textContent=t(state.paused?'観察を再開':'観察を休む');if(state.busy)setStatus('少し待ってほしいのです…');else if(['少し待ってほしいのです…','考えているのです…'].includes(statusSource))setStatus('');}
i18n.apply(document,language);api.onState(render);api.state().then(render).catch(()=>setStatus('設定を読み込めませんでした。'));
api.onReply(reply=>{if(reply.status==='start'){if(reply.proactive)api.chatReveal();setStatus('考えているのです…');}if(reply.status==='done'){api.chatReveal();setStatus('');}if(['error','cancelled','observation-error','summary-error'].includes(reply.status))setStatus(reply.message);});
document.getElementById('chat-form').addEventListener('submit',async event=>{event.preventDefault();const text=input.value.trim();if(!text||currentState?.busy)return;try{await api.chat({text,observe:document.getElementById('observe-checkbox').checked});input.value='';setStatus('考えているのです…');}catch{setStatus('送信できませんでした。設定を確認してください。');}});
document.getElementById('cancel-button').onclick=()=>api.cancel();document.getElementById('chat-close').onclick=()=>toggle(false);document.getElementById('settings-button').onclick=()=>api.openSettings();document.getElementById('pause-button').onclick=()=>api.pause();document.getElementById('chat-zoom-in').onclick=()=>api.resize(1.08);document.getElementById('chat-zoom-out').onclick=()=>api.resize(0.92);
document.getElementById('observe-screen-button').onclick=async()=>{try{await api.observeNow();toggle(true);setStatus('画面を見ているのです…');}catch{setStatus('画面を観察できませんでした。設定を確認してください。');}};

const resizeHandle=document.getElementById('chat-resize-handle');let resizing=null;
resizeHandle.onpointerdown=event=>{if(event.button!==0)return;resizing={x:event.screenX,y:event.screenY};resizeHandle.setPointerCapture(event.pointerId);event.preventDefault();};
resizeHandle.onpointermove=event=>{if(!resizing)return;api.chatResize({dw:event.screenX-resizing.x,dh:event.screenY-resizing.y});resizing={x:event.screenX,y:event.screenY};};
resizeHandle.onpointerup=resizeHandle.onpointercancel=()=>{resizing=null;};
window.addEventListener('focus',()=>input.focus());
