const test=require('node:test');const assert=require('node:assert/strict');
let VoiceService;try{({VoiceService}=require('../services/voice-service'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('voice service exposes a synthesis contract',()=>assert.equal(typeof VoiceService,'function'));
test('uses exact model and style returned by server',async()=>{
 const requests=[];const fetcher=async(url,options={})=>{requests.push([url,options]);if(url.endsWith('/models/info'))return new Response(JSON.stringify({'0':{model_path:'C:/models/Minto/voice.safetensors',spk2id:{ミント:0},style2id:{Neutral:0}}}));
 return new Response(new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69]),{headers:{'Content-Type':'audio/wav'}});};
 const service=new VoiceService({api_base:'http://127.0.0.1:5000',model_id:'0',speaker_name:'ミント',style:'Neutral'},{fetcher});
 const audio=await service.synthesize('こんにちはなのです。');assert.equal(audio.length,12);
 const url=new URL(requests[1][0]);assert.equal(url.pathname,'/voice');assert.equal(url.searchParams.get('language'),'JP');assert.equal(url.searchParams.get('speaker_name'),'ミント');assert.equal(url.searchParams.get('style'),'Neutral');assert.equal(requests[1][1].method,'POST');
});
test('unknown style fails before audio request',async()=>{
 let calls=0;const service=new VoiceService({api_base:'http://localhost:5000',model_id:'0',style:'invented'},{fetcher:async()=>{calls++;return new Response(JSON.stringify({'0':{model_path:'Minto.safetensors',spk2id:{ミント:0},style2id:{Neutral:0}}}));}});
 await assert.rejects(service.synthesize('こんにちは。'));assert.equal(calls,1);
});
test('malformed voice model info is rejected without poisoning the verified cache',async()=>{
 let listing={'0':{model_path:'Minto.safetensors',spk2id:{ミント:0},style2id:{Neutral:0}}};
 const service=new VoiceService({api_base:'http://localhost:5000'},{fetcher:async()=>new Response(JSON.stringify(listing))});
 const valid=await service.info();listing={'0':{spk2id:{ミント:0},style2id:{Neutral:0}}};
 await assert.rejects(service.info());assert.equal(service.models,valid);
});
