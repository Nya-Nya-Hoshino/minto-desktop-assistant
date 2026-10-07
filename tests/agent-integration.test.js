'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {desktop}=require('./agent-desktop-harness');
test('desktop agent check exposes builtins and bundled skills without changing current save',async t=>{
 const app=await desktop(t),before=await app.call('state');const result=await app.call('agent-test');assert.equal(result.ok,true);assert.ok(result.tools.includes('run_command'));assert.ok(result.skills.some(x=>x.name==='file-inspection'));const after=await app.call('state');assert.equal(before.save.id,after.save.id);assert.equal(after.save.messages.length,0);assert.ok(fs.existsSync(path.join(app.root,'agent-workspace')));
});
test('cancellation keeps task busy until the command process has actually exited',async t=>{
 const http=require('node:http');const server=http.createServer((request,response)=>{request.resume();request.on('end',()=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:'sleep',type:'function',function:{name:'run_command',arguments:'{"command":"Start-Sleep -Seconds 20"}'}}]}}]}));});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const app=await desktop(t);await app.call('settings-save',{llm:{api_base:'http://127.0.0.1:'+server.address().port,model:'Exact'},voice:{enabled:false}});await app.call('chat',{text:'执行睡眠命令',observe:false});
 for(let i=0;i<100&&!app.messages.some(x=>x.channel==='minto:agent-event'&&x.value.status==='tool-start');i++)await new Promise(r=>setTimeout(r,20));assert.ok(app.messages.some(x=>x.channel==='minto:agent-event'&&x.value.status==='tool-start'));
 await app.call('cancel');assert.equal((await app.call('state')).busy,true);
 for(let i=0;i<500&&(await app.call('state')).busy;i++)await new Promise(r=>setTimeout(r,20));assert.equal((await app.call('state')).busy,false);assert.ok(app.messages.some(x=>x.channel==='minto:agent-event'&&x.value.status==='cancelled'));
});
test('event redaction preserves numeric fields and hides exact configured values',async t=>{
 const app=await desktop(t);await app.call('settings-save',{agent:{mcp_servers_json:JSON.stringify([{id:'x',transport:'stdio',command:'unused',args:[],env:{VALUE:'1'}}])}});
 const result=app.context.redactAgent({step:1,input:{text:'value 1'}});assert.equal(result.step,1);assert.equal(result.input.text,'value [redacted]');
});
test('redaction retains request credential snapshot after settings change',async t=>{
 const app=await desktop(t);await app.call('settings-save',{llm:{api_key:'NewExactSecret'}});assert.equal(app.context.redactAgent({output:'OldExactSecret'},['OldExactSecret']).output,'[redacted]');
});
test('tool preparation errors have start and error events',async t=>{
 const app=await desktop(t);await app.call('settings-save',{llm:{api_base:'http://localhost',model:'Exact'},voice:{enabled:false},agent:{working_directory:path.join(app.root,'does-not-exist')}});await app.call('chat',{text:'读取文件',observe:false});await new Promise(r=>setTimeout(r,20));const events=app.messages.filter(x=>x.channel==='minto:agent-event').map(x=>x.value.status);assert.deepEqual(events,['start','error']);assert.equal((await app.call('state')).busy,false);
});

test('skill setup failure closes an already connected MCP client',async t=>{
 const {McpTools}=require('../services/mcp-service');const original=McpTools.prototype.close,connect=McpTools.prototype.connect,clients=[];McpTools.prototype.connect=async function(...args){clients.push(this);return connect.apply(this,args);};let closes=0;McpTools.prototype.close=async function(){closes++;return original.call(this);};t.after(async()=>{McpTools.prototype.close=original;McpTools.prototype.connect=connect;for(const client of clients)await original.call(client);});
 const app=await desktop(t);await app.call('settings-save',{agent:{skill_directories_json:JSON.stringify([path.join(__dirname,'../package.json')]),mcp_servers_json:JSON.stringify([{id:'ExactServer',transport:'stdio',command:process.execPath,args:[path.join(__dirname,'fixtures/mcp-agent-server.cjs')]}])}});
 await assert.rejects(()=>app.call('agent-test'),/ENOTDIR/);assert.equal(closes,1);
});
