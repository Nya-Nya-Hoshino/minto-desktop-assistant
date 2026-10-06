'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function load(name) { try { return require(name); } catch(e) { if(e.code==='MODULE_NOT_FOUND' && e.message.includes(name)) return {}; throw e; } }
const { SaveStore } = load('../services/save-store');
const { parseReply, requestReply, buildPrompt } = load('../services/assistant-service');
const { ObservationGate } = load('../services/observation-service');

test('required service contracts are implemented', () => {
  assert.equal(typeof SaveStore,'function','persistent save service is missing');
  assert.equal(typeof parseReply,'function','reply validation is missing');
  assert.equal(typeof ObservationGate,'function','observation cooldown service is missing');
});

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minto-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('full history survives context limits and restart', t => {
  const dir = temp(t); const store = new SaveStore(dir);
  for (let i=0;i<60;i++) store.append('消息'+i, 'こんにちはなのです。', {});
  assert.equal(store.context(3).length,6);
  const loaded = new SaveStore(dir);
  assert.equal(loaded.current().messages.length,120);
  assert.equal(loaded.current().messages[0].content,'消息0');
});
test('import creates an independent slot and preserves original slot', t => {
  const store = new SaveStore(temp(t));store.append('原始','はいなのです。',{});
  const original = store.current().id;const imported = store.import(store.export(original));
  assert.notEqual(imported.id,original);store.select(imported.id);store.append('新','わかったのです。',{});
  store.select(original);assert.equal(store.current().messages.length,2);
  assert.throws(()=>store.select('../outside'));
});
test('export and import preserve complete verified message metadata', t => {
  const store=new SaveStore(temp(t));
  const metadata={emotion:'happy',pose:'mPose3',proactive:true,screenSummary:'画面に文書が表示されています。',observedAt:'2026-10-03T06:00:00.000Z',display_id:'123'};
  store.append('你好','こんにちはなのです。',metadata);
  const exported=JSON.parse(store.export());const imported=store.import(JSON.stringify(exported));
  assert.deepEqual(imported.messages,exported.messages);
  const invalid=structuredClone(exported);invalid.messages[1].metadata.proactive='true';
  assert.throws(()=>store.import(JSON.stringify(invalid)));
});
test('damaged save import fails without replacing history', t => {
  const store = new SaveStore(temp(t));const id=store.current().id;
  assert.throws(()=>store.import('{bad'));assert.throws(()=>store.import(JSON.stringify({version:1,messages:[{role:'system',content:'bad'}]})));
  assert.equal(store.current().id,id);
});
test('delete active slot leaves a valid selected save', t => {
  const store = new SaveStore(temp(t));const old=store.current().id;
  store.remove(old);assert.notEqual(store.current().id,old);assert.equal(store.list().length,1);
});
test('reply rejects unknown actions and non-Japanese text', () => {
  assert.throws(()=>parseReply('{"text":"你好","emotion":"happy","pose":"mPose3"}'));
  assert.throws(()=>parseReply('{"text":"こんにちは。","emotion":"invented","pose":"mPose3"}'));
  assert.throws(()=>parseReply('{"text":"こんにちは。","emotion":"happy","pose":"mpose3"}'));
  assert.deepEqual(parseReply('{"text":"嬉しいのです！","emotion":"happy","pose":"mPose3"}'),{text:'嬉しいのです！',emotion:'happy',pose:'mPose3'});
  for(const text of ['你好こんにちは。','你好。はい。','This is a long English explanation that should never be spoken.あ'])
    assert.throws(()=>parseReply(JSON.stringify({text,emotion:'neutral',pose:'mPose0'})));
});
test('DeepSeek uses the documented thinking and effort fields',async()=>{
 const {completion}=require('../services/assistant-service');let body;
 await completion({provider:'DeepSeek',api_base:'https://api.deepseek.com',model:'deepseek-flash',reasoning_effort:'high'},[],{fetcher:async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:'接続成功'}}]}));}});
 assert.equal(body.reasoning_effort,'high');assert.deepEqual(body.thinking,{type:'enabled'});
});
test('persona prompt fixes Japanese speech and separates screen evidence', () => {
  const prompt=buildPrompt('画面摘要');assert.ok(prompt.includes('ボク'));assert.ok(prompt.includes('マスター'));
  assert.ok(prompt.includes('日本語'));assert.ok(prompt.includes('画面摘要'));
});
test('screen conversation prioritizes companionship while preserving explicit questions and exact evidence',async()=>{
 let body;
 await requestReply({api_base:'https://example.test/v1',model:'Exact_Main'},[],'画面を見て、ボクと少し話してほしい。','frame',{fetcher:async(_url,init)=>{const input=JSON.parse(init.body);if(!body)body=input;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(input.messages[0].content.startsWith('公開本文の言語を検査します。')?{japanese:true}:{text:'マスター、ちょっと休むのです。',emotion:'gentle',pose:'mPose0'})}}]}));}});
 assert.ok(body.messages[0].content.includes('画面を見ながらの会話も、マスターとの交流と付き添いが目的'));
 assert.ok(body.messages.at(-1).content[0].text.includes('一覧の読み上げ'));
 assert.ok(body.messages.at(-1).content[0].text.includes('具体的な質問'));
});
test('vision reads the current question and preserves exact visible wording',async()=>{
 const {describeScreen}=require('../services/assistant-service');let sent;
 await describeScreen({api_base:'https://example.test/v1',model:'Exact_Vision'},'frame',{question:'现在屏幕中的薄荷说了什么',fetcher:async(_url,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'Mint: It is sunny today.',speak:false})}}]}));}});
 const prompt=sent.messages[0].content[0].text;
 assert.ok(prompt.includes('现在屏幕中的薄荷说了什么'));
 assert.ok(prompt.includes('原文'));
 assert.equal(sent.messages[0].content[1].image_url.url,'data:image/jpeg;base64,frame');
});
test('current observation travels with the current question after stale history',async()=>{
 const seen=[];const fresh='Mint: It is sunny today.';
 await requestReply({api_base:'https://example.test/v1',model:'Exact_Chat'},[{role:'assistant',content:'画面を直接見ることはできないのです。'}],'何と言っていますか？',null,{screenSummary:fresh,fetcher:async(_url,init)=>{const body=JSON.parse(init.body);seen.push(body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(seen.length===1?{text:'今日は晴れだと言っているのです。',emotion:'neutral',pose:'mPose0'}:{japanese:true})}}]}));}});
 assert.ok(seen[0].messages.at(-1).content.includes(fresh));
 assert.ok(seen[0].messages[0].content.includes('今回の観測'));
});
test('Japanese prose rejects a Chinese sentence despite a Japanese greeting and permits quoted user text',()=>{
 assert.throws(()=>parseReply(JSON.stringify({text:'こんにちは。今天心情很好呢あ。',emotion:'neutral',pose:'mPose0'})));
 assert.equal(parseReply(JSON.stringify({text:'マスターの「你好」は、中国語のあいさつなのです。',emotion:'neutral',pose:'mPose0'})).text,'マスターの「你好」は、中国語のあいさつなのです。');
});
test('invalid model language is repaired once with exact schema', async () => {
  let calls=0;const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);assert.equal(body.model,'exact-test-model');
    assert.equal(url,'http://localhost:9011/v1/chat/completions');calls++;
    const check=body.messages[0].content.startsWith('公開本文の言語を検査します。');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(check?{japanese:true}:{text:calls===1?'你好':'はい、マスター。',emotion:'neutral',pose:'mPose0'})}}]}),{status:200});
  };
  const result=await requestReply({api_base:'http://localhost:9011/v1',api_key:'test',model:'exact-test-model'},[], '测试',null,{fetcher});
  assert.equal(calls,3);assert.equal(result.text,'はい、マスター。');
});
test('Chinese prose with a Japanese character suffix is independently checked and repaired before publication',async()=>{
 let requests=0,replies=0;
 const fetcher=async(_url,init)=>{requests++;const body=JSON.parse(init.body);const check=body.messages[0].content.startsWith('公開本文の言語を検査します。');
  const result=check?{japanese:!JSON.parse(body.messages.at(-1).content).text.startsWith('今天')}:{text:++replies===1?'今天心情很好なのです。':'今日はいい気分なのです。',emotion:'happy',pose:'mPose3'};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));};
 const result=await requestReply({api_base:'http://localhost:9011/v1',model:'Exact'},[],'你好',null,{fetcher});
 assert.equal(result.text,'今日はいい気分なのです。');assert.equal(requests,4);
});
test('cancelled reply does not retry or complete', async () => {
  const control=new AbortController();control.abort();let calls=0;
  await assert.rejects(requestReply({api_base:'http://localhost',api_key:'test',model:'test'},[],'测试',null,{signal:control.signal,fetcher:async()=>{calls++;throw new DOMException('Aborted','AbortError');}}));
  assert.equal(calls,0);
});
test('observation applies a 120 second cooldown and rechecks unchanged screens afterwards', () => {
  const gate=new ObservationGate(120000);const a=Buffer.from('frame-a');const b=Buffer.from('frame-b');
  assert.equal(gate.check(a,200000,false),true);gate.markSpoken(200000);
  assert.equal(gate.check(b,319999,false),false);assert.equal(gate.check(b,320000,false),true);
  gate.markSpoken(320000);assert.equal(gate.check(b,400000,false),false);assert.equal(gate.check(b,500000,false),true);
  assert.equal(gate.check(Buffer.from('frame-c'),600000,true),false);
});
test('an unchanged screen is eligible again after two minutes without permanently suppressing conversation',()=>{
 const gate=new ObservationGate(120000),frame=Buffer.from('unchanged-screen');
 assert.equal(gate.check(frame,200000,false),true);
 assert.equal(gate.check(frame,200001,false),false);
 assert.equal(gate.check(frame,320000,false),true);
 gate.markSpoken(320000);
 assert.equal(gate.check(frame,439999,false),false);
 assert.equal(gate.check(frame,440000,false),true);
});
