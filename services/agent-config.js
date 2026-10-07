'use strict';
const KEEP='__MINTO_KEEP_SECRET__';
function serversFrom(text){
 const servers=JSON.parse(text);if(!Array.isArray(servers)||servers.length>20)throw new Error('MCP 配置必须为最多 20 个服务器的 JSON 数组');
 const ids=new Set();for(const server of servers){
  if(!server||typeof server!=='object'||typeof server.id!=='string'||!server.id||server.id.length>80||ids.has(server.id))throw new Error('MCP 服务器 ID 无效或重复');ids.add(server.id);
  const allowed=server.transport==='stdio'?['id','transport','command','args','env']:['id','transport','url','headers'];
  if(Object.keys(server).some(key=>!allowed.includes(key)))throw new Error('MCP 配置包含未知字段');
  if(server.transport==='stdio'){if(typeof server.command!=='string'||!server.command||!Array.isArray(server.args)||server.args.some(x=>typeof x!=='string'))throw new Error('MCP stdio 命令与参数无效');}
  else if(server.transport==='http'){const url=new URL(server.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('MCP HTTP 地址无效');}
  else throw new Error('MCP 传输方式无效');
  for(const field of ['env','headers'])if(server[field]!==undefined&&(!server[field]||Array.isArray(server[field])||typeof server[field]!=='object'||Object.values(server[field]).some(x=>typeof x!=='string')))throw new Error('MCP 环境变量或请求头格式无效');
 }return servers;
}
function validateAgent(config){if(!Number.isInteger(config.max_steps)||config.max_steps<1||config.max_steps>50||!Number.isInteger(config.command_timeout_seconds)||config.command_timeout_seconds<5||config.command_timeout_seconds>600)throw new Error('Agent 步数或命令超时超出范围');serversFrom(config.mcp_servers_json);const dirs=JSON.parse(config.skill_directories_json);if(!Array.isArray(dirs)||dirs.length>50||dirs.some(x=>typeof x!=='string'||!x))throw new Error('Skill 目录必须为路径字符串的 JSON 数组');}
function maskedServers(text){return JSON.stringify(serversFrom(text).map(server=>({...server,...Object.fromEntries(['env','headers'].filter(k=>server[k]).map(k=>[k,Object.fromEntries(Object.keys(server[k]).map(key=>[key,KEEP]))]))})),null,2);}
function mergeSecrets(text,oldText){const old=serversFrom(oldText);return JSON.stringify(serversFrom(text).map(server=>{const previous=old.find(x=>x.id===server.id);for(const field of ['env','headers'])for(const key of Object.keys(server[field]||{}))if(server[field][key]===KEEP){if(!previous?.[field]||!Object.hasOwn(previous[field],key))throw new Error('MCP 保留凭据不存在');server[field][key]=previous[field][key];}return server;}));}
module.exports={serversFrom,validateAgent,maskedServers,mergeSecrets};
