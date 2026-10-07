'use strict';
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport,getDefaultEnvironment}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
class McpTools{
 constructor(servers,{workingDirectory,fetcher=fetch}={}){this.servers=servers;this.workingDirectory=workingDirectory;this.fetcher=fetcher;this.clients=[];this.tools=[];this.errors=[];}
 async connect(signal){for(const server of this.servers){signal?.throwIfAborted();const client=new Client({name:'MintoAssistant',version:'0.4.0'},{capabilities:{}});let transport;
  try{transport=server.transport==='stdio'?new StdioClientTransport({command:server.command,args:server.args,env:{...getDefaultEnvironment(),...server.env},cwd:this.workingDirectory,stderr:'pipe'}):new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:server.headers||{}},fetch:this.fetcher});
   transport.stderr?.on('data',()=>{});await client.connect(transport,{signal,timeout:20000});this.clients.push(client);let cursor;
   do{const result=await client.listTools(cursor?{cursor}:{},{signal,timeout:20000});for(const tool of result.tools){if(this.tools.length>=100)throw new Error('MCP tool limit exceeded');this.tools.push({alias:'mcp_'+(this.tools.length+1),client,serverId:server.id,name:tool.name,description:tool.description||'',inputSchema:tool.inputSchema});}cursor=result.nextCursor;}while(cursor);
  }catch(error){await client.close().catch(()=>{});if(signal?.aborted)signal.throwIfAborted();this.errors.push(server.id+': '+error.message);this.tools=this.tools.filter(x=>x.client!==client);}
 }}
 definitions(){return this.tools.map(tool=>({type:'function',function:{name:tool.alias,description:`MCP ${tool.serverId} / ${tool.name}: ${tool.description}`.slice(0,2000),parameters:tool.inputSchema}}));}
 async execute(alias,args,{signal}={}){const tool=this.tools.find(x=>x.alias===alias);if(!tool)throw new Error('Unknown MCP tool: '+alias);const result=await tool.client.callTool({name:tool.name,arguments:args},undefined,{signal,timeout:60000});if(result.isError)throw new Error(JSON.stringify(result));return JSON.stringify(result);}
 async close(){await Promise.allSettled(this.clients.map(client=>client.close()));this.clients=[];this.tools=[];}
}
module.exports={McpTools};
