'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
let McpTools;try{({McpTools}=require('../services/mcp-service'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('real MCP stdio connection lists exact names and executes opaque alias',async t=>{
 assert.equal(typeof McpTools,'function');const mcp=new McpTools([{id:'ExactServer',transport:'stdio',command:process.execPath,args:[path.join(__dirname,'fixtures/mcp-agent-server.cjs')]}],{workingDirectory:__dirname});t.after(()=>mcp.close());
 await mcp.connect();assert.equal(mcp.errors.length,0);const defs=mcp.definitions();assert.equal(defs.length,1);assert.equal(defs[0].function.name,'mcp_1');assert.match(defs[0].function.description,/Exact.Name/);
 const result=await mcp.execute('mcp_1',{value:'原文 Exact_Identifier'});assert.match(result,/原文 Exact_Identifier/);await assert.rejects(()=>mcp.execute('mcp_2',{}));
});
test('MCP tool failure is returned as an error instead of a successful tool event',async t=>{
 const mcp=new McpTools([{id:'ExactServer',transport:'stdio',command:process.execPath,args:[path.join(__dirname,'fixtures/mcp-agent-server.cjs')]}],{workingDirectory:__dirname});t.after(()=>mcp.close());await mcp.connect();await assert.rejects(()=>mcp.execute('mcp_1',{value:'ERROR'}),/remote failure/);
});
