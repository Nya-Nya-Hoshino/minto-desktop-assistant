const test=require('node:test'),assert=require('node:assert/strict');const {completion,requestReply,parseReply}=require('../services/assistant-service');const config={provider:'DeepSeek',api_base:'https://api.deepseek.com',model:'deepseek-flash'};
const observed='マスター、作業が続いているのですね。ボクは側で見ているのです。';const answer=JSON.stringify({text:observed,emotion:'gentle',pose:'mPose0',relationshipSignal:{signal:'neutral',evidence:''}});
function response(content,extra={}){return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content,...extra}}]}));}
test('image observation plain Japanese is formatted without resending the image or changing the observed text',async()=>{
 const bodies=[];const fetcher=async(_url,init)=>{const b=JSON.parse(init.body);bodies.push(b);if(b.messages[0].content.startsWith('公開本文の言語'))return response('{"japanese":true}');assert.ok(!b.messages.some(m=>Array.isArray(m.content)));assert.equal(JSON.parse(b.messages.at(-1).content).observed_reply,observed);return response(answer);};
 const result=await requestReply(config,[],'これは自動観察です。','screen',{initialRaw:observed,fetcher});assert.equal(result.text,observed);assert.equal(bodies.length,2);
});
test('JSON mode whitespace retries once without forcing JSON and preserves the complete original multimodal input',async()=>{
 const bodies=[],messages=[{role:'system',content:'json を返してください。'},{role:'user',content:[{type:'text',text:'この画面を確認して。'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,screen'}}]}];
 const result=await completion(config,messages,{jsonOutput:true,fetcher:async(_url,init)=>{bodies.push(JSON.parse(init.body));return response(bodies.length===1?' '.repeat(98):answer);}});assert.equal(result,answer);assert.equal(bodies.length,2);assert.deepEqual(bodies[0].messages,bodies[1].messages);assert.deepEqual(bodies[0].response_format,{type:'json_object'});assert.equal(Object.hasOwn(bodies[1],'response_format'),false);
});
test('two blank model responses end with a specific localized error and bounded retry count',async()=>{let count=0;await assert.rejects(()=>completion(config,[],{jsonOutput:true,fetcher:async()=>{count++;return response('  ');}}),/模型返回空白回复/);assert.equal(count,2);});
test('format normalization never changes actual observation text',async()=>{
 let requests=0;await assert.rejects(()=>requestReply(config,[],'自動観察です。','screen',{initialRaw:observed,fetcher:async()=>{requests++;return response(JSON.stringify({text:'存在しない窓が表示されているのです。',emotion:'gentle',pose:'mPose0'}));}}),/格式整理改变了原始回复|回复格式|回复 JSON/);assert.ok(requests<=2);
});
test('cancel after an empty response prevents a retry',async()=>{const controller=new AbortController();let calls=0;await assert.rejects(()=>completion(config,[],{jsonOutput:true,signal:controller.signal,fetcher:async()=>{calls++;controller.abort();return response(' ');}}),{name:'AbortError'});assert.equal(calls,1);});
test('partial reply JSON has a clear format error instead of a raw JSON parser exception',()=>{assert.throws(()=>parseReply('{"text":"マスター'),/回复 JSON 不完整或格式无效/);});
test('empty assistant text with valid tool calls executes through the tool protocol without retrying the model',async()=>{let calls=0;const result=await completion(config,[],{returnMessage:true,tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}],fetcher:async()=>{calls++;return response(null,{tool_calls:[{id:'ExactId',type:'function',function:{name:'read_file',arguments:'{"path":"Exact.txt"}'}}]});}});assert.equal(result.tool_calls[0].id,'ExactId');assert.equal(calls,1);});
test('ordinary chat preserves the actual plain Japanese reply and assesses only the original human message',async()=>{
 const text='ボクは今、もらった扁肉のスープをいただいているところなのですよ。あつあつで、体があったまるのです～。',user='谢谢你一直陪着我',bodies=[];
 const result=await requestReply(config,[{role:'assistant',content:'マスター、おかえりなのです。'}],user,null,{initialRaw:text,fetcher:async(_url,init)=>{
  const body=JSON.parse(init.body);bodies.push(body);if(body.messages[0].content.startsWith('公開本文の言語'))return response('{"japanese":true}');if(!body.messages[0].content.startsWith('json の整形だけを行ってください。'))return response(text);
  const data=JSON.parse(body.messages.at(-1).content);assert.equal(data.original_user,user);assert.equal(data.observed_reply,text);assert.equal(data.proactive,false);assert.ok(!body.messages.some(m=>Array.isArray(m.content)));return response(JSON.stringify({text,emotion:'gentle',pose:'mPose0',relationshipSignal:{signal:'care',evidence:user}}));
 }});assert.equal(result.text,text);assert.equal(result.relationshipSignal.evidence,user);assert.equal(bodies.length,2);
});
test('ordinary plain Japanese final response after a tool result is formatted without replaying the tool',async()=>{
 const {runAgent}=require('../services/agent-service');let executed=0,native=0,formatted=0;const text='ファイルの値は「Exact040」だったのです。';
 const tools={workingDirectory:'ExactWork',skills:{list:()=>[]},definitions:()=>[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}],execute:async()=>{executed++;return 'Exact040';}};
 const result=await runAgent(config,[],'读取文件',null,{tools,fetcher:async(_url,init)=>{
  const body=JSON.parse(init.body);if(body.messages[0].content.startsWith('公開本文の言語'))return response('{"japanese":true}');
  if(body.tools){native++;if(native===1)return response(null,{tool_calls:[{id:'ExactRead',type:'function',function:{name:'read_file',arguments:'{"path":"Exact.txt"}'}}]});assert.ok(body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='ExactRead'&&m.content.includes('Exact040')));return response(text);}
  if(!body.messages[0].content.startsWith('json の整形だけを行ってください。'))return response(text);formatted++;assert.equal(JSON.parse(body.messages.at(-1).content).observed_reply,text);return response(JSON.stringify({text,emotion:'neutral',pose:'mPose0'}));
 }});assert.equal(result.text,text);assert.equal(executed,1);assert.equal(native,2);assert.equal(formatted,1);
});
test('JSON arrays and strings never enter the plain Japanese normalization path',async()=>{
 for(const raw of ['["マスター、ありがとうなのです。"]','"マスター、ありがとうなのです。"']){let formatted=0;
  await assert.rejects(()=>requestReply(config,[],'你好',null,{initialRaw:raw,fetcher:async(_url,init)=>{
   const body=JSON.parse(init.body);if(body.messages[0].content.startsWith('公開本文の言語'))return response('{"japanese":true}');
   if(body.messages[0].content.startsWith('json の整形だけを行ってください。')){formatted++;return response(JSON.stringify({text:raw,emotion:'neutral',pose:'mPose0'}));}return response(raw);
  }}),/回复格式无效/);assert.equal(formatted,0);
 }
});
test('Japanese Markdown containing fenced and inline code is normalized without changing or executing its source',async()=>{
 const text='# ミントのメモ\n\nマスター、ファイルを確認したのです。\n\n```js\nconst Exact_Name = {value: 1};\n```\n\n設定は `{"Exact_Key": true}` だったのです。';let formats=0;
 const result=await requestReply(config,[],'请展示代码',null,{initialRaw:text,fetcher:async(_url,init)=>{const body=JSON.parse(init.body);if(body.messages[0].content.startsWith('公開本文の言語'))return response('{"japanese":true}');if(!body.messages[0].content.startsWith('json の整形だけを行ってください。'))return response(text);formats++;assert.equal(JSON.parse(body.messages.at(-1).content).observed_reply,text);assert.equal(body.tools,undefined);return response(JSON.stringify({text,emotion:'neutral',pose:'mPose0'}));}});assert.equal(result.text,text);assert.equal(formats,1);
});

test('Markdown indentation and trailing newlines survive parsing and plain reply formatting exactly',async()=>{
 const text='    ミントの説明なのです。\n\n';
 assert.equal(parseReply(JSON.stringify({text,emotion:'neutral',pose:'mPose0'})).text,text);
 const result=await requestReply(config,[],'説明して',null,{initialRaw:text,fetcher:async(_url,init)=>{
  const body=JSON.parse(init.body);if(body.messages[0].content.startsWith('公開本文の言語'))return response('{"japanese":true}');
  assert.equal(JSON.parse(body.messages.at(-1).content).observed_reply,text);return response(JSON.stringify({text,emotion:'neutral',pose:'mPose0'}));
 }});assert.equal(result.text,text);
});
