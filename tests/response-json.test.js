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
