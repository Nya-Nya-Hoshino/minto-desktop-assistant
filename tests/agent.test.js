'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
function load(file){try{return require(file);}catch(e){if(e.code==='MODULE_NOT_FOUND'&&e.message.includes(file))return {};throw e;}}
const {AgentTools}=load('../services/agent-tools'),{runAgent}=load('../services/agent-service');
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-agent-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('file tools read exact names and search real content without changing identifiers',async t=>{
 const root=temp(t);fs.writeFileSync(path.join(root,'Exact_Name.txt'),'first\n日本語 Token_A\nlast');
 const tools=new AgentTools({workingDirectory:root,skillRoots:[],commandTimeout:5});
 assert.match(await tools.execute('read_file',{path:'Exact_Name.txt',start_line:2,line_count:1}),/日本語 Token_A/);
 assert.match(await tools.execute('list_directory',{path:'.'}),/Exact_Name.txt/);
 assert.match(await tools.execute('search_files',{path:'.',text:'Token_A'}),/Exact_Name.txt/);
 await assert.rejects(()=>tools.execute('read_file',{path:'absent.txt'}));
 await assert.rejects(()=>tools.execute('read_file',{path:'Exact_Name.txt',unexpected:true}));
});
test('command executes in requested working directory with Unicode output and nonzero result',async t=>{
 const root=temp(t),tools=new AgentTools({workingDirectory:root,skillRoots:[],commandTimeout:5});
 const result=JSON.parse(await tools.execute('run_command',{command:"[Console]::WriteLine('日本語'); exit 7"}));
 assert.equal(result.exit_code,7);assert.match(result.stdout,/日本語/);
});
test('cancelling command terminates it instead of waiting for its normal duration',async t=>{
 const tools=new AgentTools({workingDirectory:temp(t),skillRoots:[],commandTimeout:30}),controller=new AbortController();
 const start=Date.now(),running=tools.execute('run_command',{command:'Start-Sleep -Seconds 20'},{signal:controller.signal});
 setTimeout(()=>controller.abort(),300);await assert.rejects(()=>running,{name:'AbortError'});assert.ok(Date.now()-start<10000);
});
test('skill discovery loads metadata first and referenced resources only on request',async t=>{
 const root=temp(t),skill=path.join(root,'inspect-files');fs.mkdirSync(path.join(skill,'references'),{recursive:true});
 fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: inspect-files\ndescription: >-\n  Inspect documents and exact identifiers.\n---\nPRIVATE_BODY\nRead references/help.md');fs.writeFileSync(path.join(skill,'references/help.md'),'resource detail');
 const tools=new AgentTools({workingDirectory:root,skillRoots:[root],commandTimeout:5});
 const index=await tools.execute('list_skills',{});assert.match(index,/inspect-files/);assert.doesNotMatch(index,/PRIVATE_BODY/);
 assert.match(await tools.execute('load_skill',{name:'inspect-files'}),/PRIVATE_BODY/);
 assert.match(await tools.execute('read_skill_resource',{name:'inspect-files',path:'references/help.md'}),/resource detail/);
 await assert.rejects(()=>tools.execute('read_skill_resource',{name:'inspect-files',path:'../outside.txt'}));
});
test('native tool loop retains call IDs and thinking content, then returns verified Japanese',async t=>{
 const root=temp(t);fs.writeFileSync(path.join(root,'note.txt'),'EXACT_FACT');const tools=new AgentTools({workingDirectory:root,skillRoots:[],commandTimeout:5});
 const bodies=[],events=[];const fetcher=async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);let message;
 if(bodies.length===1)message={content:null,reasoning_content:'thinking',tool_calls:[{id:'call_exact',type:'function',function:{name:'read_file',arguments:'{"path":"note.txt"}'}}]};
 else if(body.messages[0].content.includes('公開本文の言語'))message={content:'{"japanese":true}'};
 else message={content:JSON.stringify({text:'ファイルを確認できたのです。',emotion:'happy',pose:'mPose3',relationshipSignal:{signal:'neutral',evidence:''}})};
 return new Response(JSON.stringify({choices:[{message}]}));};
 const answer=await runAgent({provider:'DeepSeek',api_base:'https://api.deepseek.com',model:'deepseek-flash'},[],'请读取 note.txt',null,{tools,fetcher,onEvent:e=>events.push(e),maxSteps:3});
 assert.equal(answer.text,'ファイルを確認できたのです。');assert.ok(bodies[0].tools.some(x=>x.function.name==='read_file'));
 const second=bodies[1].messages;assert.equal(second.find(x=>x.role==='assistant').reasoning_content,'thinking');assert.equal(second.find(x=>x.role==='tool').tool_call_id,'call_exact');assert.match(second.find(x=>x.role==='tool').content,/EXACT_FACT/);
 assert.ok(events.some(x=>x.status==='tool-result'&&x.tool==='read_file'));
});
test('tool errors return to model for recovery rather than ending the task',async t=>{
 const tools=new AgentTools({workingDirectory:temp(t),skillRoots:[],commandTimeout:5});let count=0,sawError=false;
 const fetcher=async(_url,init)=>{const b=JSON.parse(init.body);count++;if(count===2)sawError=b.messages.some(x=>x.role==='tool'&&x.content.includes('ENOENT'));
 const content=b.messages[0].content.includes('公開本文の言語')?'{"japanese":true}':JSON.stringify({text:'そのファイルは見つからなかったのです。',emotion:'sad',pose:'mPose0'});
 return new Response(JSON.stringify({choices:[{message:count===1?{content:null,tool_calls:[{id:'one',type:'function',function:{name:'read_file',arguments:'{"path":"missing"}'}}]}:{content}}]}));};
 await runAgent({provider:'custom',api_base:'http://localhost',model:'Exact'},[],'读取 missing',null,{tools,fetcher,maxSteps:2});assert.equal(sawError,true);
});
test('truncated tool response never executes a command',async t=>{
 const root=temp(t),tools=new AgentTools({workingDirectory:root,skillRoots:[],commandTimeout:5});
 const fetcher=async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:null,tool_calls:[{id:'truncated',type:'function',function:{name:'run_command',arguments:'{"command":"Set-Content marker.txt unsafe"}'}}]}}]}));
 await assert.rejects(()=>runAgent({provider:'custom',api_base:'http://localhost',model:'Exact'},[],'执行任务',null,{tools,fetcher,maxSteps:2}));assert.equal(fs.existsSync(path.join(root,'marker.txt')),false);
});
test('duplicate call IDs are rejected before any tool executes',async()=>{
 let executed=0;const tools={skills:{list:()=>[]},definitions:()=>[],execute:async()=>{executed++;return 'ok';}};
 const call={id:'same',type:'function',function:{name:'run_command',arguments:'{"command":"echo x"}'}};
 const fetcher=async()=>new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[call,call]}}]}));
 await assert.rejects(()=>runAgent({provider:'custom',api_base:'http://localhost',model:'Exact'},[],'运行',null,{tools,fetcher,maxSteps:1}));assert.equal(executed,0);
});
test('single-file searches reject oversized input before reading its content',async t=>{
 const root=temp(t),file=path.join(root,'large.txt');fs.writeFileSync(file,'x'.repeat(600*1024));const tools=new AgentTools({workingDirectory:root,skillRoots:[],commandTimeout:5});await assert.rejects(()=>tools.execute('search_files',{path:'large.txt',text:'x'}));
});

test('single-file searches enforce the match limit and report truncation',async t=>{
 const root=temp(t);fs.writeFileSync(path.join(root,'matches.txt'),Array(250).fill('ExactMatch').join('\n'));const tools=new AgentTools({workingDirectory:root,skillRoots:[],commandTimeout:5});const result=JSON.parse(await tools.execute('search_files',{path:'matches.txt',text:'ExactMatch'}));assert.ok(result.matches.length>0&&result.matches.length<=200);assert.equal(result.scanned,1);assert.equal(result.truncated,true);
});
