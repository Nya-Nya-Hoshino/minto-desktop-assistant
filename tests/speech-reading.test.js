'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function load(){try{return require('../services/speech-reading');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;return {};}}
const config={provider:'custom',api_base:'https://example.test/v1',model:'Exact_Model'};
test('Japanese speech bypasses reading conversion and English display text gets a separate kana reading',async()=>{
 const {prepareSpeechReading}=load();assert.equal(typeof prepareSpeechReading,'function');let calls=0;const original='OpenAI と GPT を使うのです。',fetcher=async(_url,options)=>{calls++;const input=JSON.parse(options.body);assert.equal(input.messages.at(-1).content,JSON.stringify({text:original}));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({speech_text:'オープンエーアイとジーピーティーを使うのです。'})}}]})};};
 assert.equal(await prepareSpeechReading(config,'えへへ、うれしいのです。',{fetcher}),'えへへ、うれしいのです。');assert.equal(calls,0);assert.equal(await prepareSpeechReading(config,original,{fetcher}),'オープンエーアイとジーピーティーを使うのです。');assert.equal(original,'OpenAI と GPT を使うのです。');assert.equal(calls,1);
});
test('unconverted Latin, extra fields, empty and non-Japanese reading are rejected',async()=>{
 const {prepareSpeechReading}=load();assert.equal(typeof prepareSpeechReading,'function');for(const output of [{speech_text:'OpenAIを使うのです。'},{speech_text:'',extra:true},{speech_text:'你好谢谢'},{speech_text:'オープンエーアイなのです。',extra:1}])await assert.rejects(()=>prepareSpeechReading(config,'OpenAIを使うのです。',{fetcher:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(output)}}]})})}));
});
test('reading conversion honors cancellation before sending any provider request',async()=>{const {prepareSpeechReading}=load();assert.equal(typeof prepareSpeechReading,'function');const controller=new AbortController();controller.abort();await assert.rejects(()=>prepareSpeechReading(config,'GPTなのです。',{signal:controller.signal,fetcher:()=>{throw new Error('Unexpected network');}}),error=>error.name==='AbortError');});
