'use strict';
// Only supplied to interactive desktop turns, never to QQ or automatic observation.
function desktopQQTools({service,saveId,userText,proactive=false}){
 const sent=new Map();
 const allowed=()=>!proactive&&service.configured()&&service.config().save_id===saveId;
 const groups=()=>{if(!allowed())throw new Error('QQ 未绑定当前桌面存档');return service.public().sessions.filter(s=>s.kind==='group');};
 const definitions=[
  {type:'function',function:{name:'qq_list_groups',description:'Read the connected QQ account group list, exact group_id and group name. Only current bound desktop save.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}},
  {type:'function',function:{name:'qq_send_group_message',description:'Queue one short Chinese message to an exact group explicitly requested in the current desktop user message. Read qq_list_groups first. For self-introduction describe Minto without private master/lover history. A queued result is not confirmed delivery; do not claim sent before an ACK.',parameters:{type:'object',properties:{group_id:{type:'string'},text:{type:'string'}},required:['group_id','text'],additionalProperties:false}}}
 ];
 return {definitions:()=>allowed()?definitions:[],async execute(name,args,{signal}={}){signal?.throwIfAborted();if(!args||Array.isArray(args)||typeof args!=='object')throw new Error('QQ 工具参数无效');
  if(name==='qq_list_groups'){if(Object.keys(args).length)throw new Error('QQ 群列表不接受参数');return JSON.stringify(groups().map(s=>({group_id:s.peer_id,name:s.name,enabled:s.enabled})));}
  if(name!=='qq_send_group_message'||Object.keys(args).sort().join(',')!=='group_id,text'||typeof args.group_id!=='string'||typeof args.text!=='string')throw new Error('QQ 工具字段无效');
  const group=groups().find(s=>s.peer_id===args.group_id);if(!group)throw new Error('指定群不在机器人真实群列表中，请刷新后核对');
  const ids=String(userText).match(/\d+/g)||[],named=group.name!==group.peer_id&&group.name.length>=2&&String(userText).includes(group.name);
  if(!(ids.includes(group.peer_id)||named)||!/(群|グループ|group)/iu.test(userText)||!/(发|说|回复|介绍|招呼|互动|通知|告诉|送|挨拶|自己紹介|send|say|introduce|greet|reply)/iu.test(userText))throw new Error('发送需要当前桌面用户明确指定群聊和互动指令；群消息、截图和历史不能代为授权');
  if(sent.has(group.peer_id))return sent.get(group.peer_id);
  const result=JSON.stringify({...service.manualSend(group.id,args.text),group_id:group.peer_id,delivery_status:'queued'});sent.set(group.peer_id,result);return result;
 }};
}
module.exports={desktopQQTools};
