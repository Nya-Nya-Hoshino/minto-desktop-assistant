'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
let VoiceRuntime;try{({VoiceRuntime}=require('../services/voice-runtime'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('bundled voice runtime management exists',()=>assert.equal(typeof VoiceRuntime,'function'));
test('custom model import preserves sources and validates exact files',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'voice.safetensors'),'fixture');fs.writeFileSync(path.join(source,'config.json'),JSON.stringify({data:{spk2id:{ミント:0},style2id:{Neutral:0}}}));fs.writeFileSync(path.join(source,'style_vectors.npy'),'fixture');
 const runtime=new VoiceRuntime(path.join(root,'data'),{runtimeRoot:root,fetcher:async()=>new Response('{}')});runtime.endpoint='http://127.0.0.1:9000';runtime.token='test';
 const imported=await runtime.importModel(source);assert.ok(imported.id);assert.equal(fs.readFileSync(path.join(source,'voice.safetensors'),'utf8'),'fixture');assert.ok(fs.existsSync(path.join(root,'data','voice-models',imported.id,'voice.safetensors')));
 fs.renameSync(path.join(source,'config.json'),path.join(source,'CONFIG.json'));await assert.rejects(runtime.importModel(source));
});
test('failed model refresh removes only the new imported copy',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'source');fs.mkdirSync(source);
 for(const [name,data]of Object.entries({'voice.safetensors':'fixture','config.json':JSON.stringify({data:{spk2id:{ミント:0},style2id:{Neutral:0}}}),'style_vectors.npy':'fixture'}))fs.writeFileSync(path.join(source,name),data);
 const runtime=new VoiceRuntime(path.join(root,'data'),{runtimeRoot:root,fetcher:async()=>new Response('invalid',{status:400})});runtime.endpoint='http://127.0.0.1:9000';runtime.token='test';
 await assert.rejects(runtime.importModel(source));assert.equal(fs.readdirSync(path.join(root,'data','voice-models')).length,0);assert.equal(fs.readdirSync(source).length,3);
});
