'use strict';
const api=window.minto,i18n=window.MintoI18n;
window.mintoChat={toggle:visible=>api.chatToggle(visible),setStatus:source=>api.petStatus(source)};
function render(state){i18n.apply(document,state.settings.ui.language);}
api.onState(render);api.state().then(render);
api.onReply(reply=>{if(reply.status==='done'){window.mintoPet.applyReply(reply);api.chatReveal();}else if(reply.status==='start'&&reply.proactive)api.chatReveal();});
document.getElementById('chat-toggle').onclick=()=>api.chatToggle();
document.getElementById('zoom-in').onclick=()=>api.resize(1.08);
document.getElementById('zoom-out').onclick=()=>api.resize(0.92);
