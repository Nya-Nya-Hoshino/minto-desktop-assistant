'use strict';
const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');const {randomBytes,randomUUID}=require('node:crypto');const readline=require('node:readline');
class VoiceRuntime{
 constructor(dataRoot,{runtimeRoot=path.join(__dirname,'..','runtime'),fetcher=fetch}={}){this.dataRoot=path.resolve(dataRoot);this.runtimeRoot=path.resolve(runtimeRoot);this.fetcher=fetcher;this.child=null;this.endpoint=null;this.token=randomBytes(32).toString('hex');this.starting=null;}
 async start(){if(this.endpoint)return this.endpoint;if(this.starting)return this.starting;
  this.starting=new Promise((resolve,reject)=>{const python=path.join(this.runtimeRoot,'python','python.exe'),script=path.join(this.runtimeRoot,'voice_server.py');if(!fs.existsSync(python)||!fs.existsSync(script)){reject(new Error('随包语音运行时缺失'));return;}
   fs.mkdirSync(this.dataRoot,{recursive:true});const log=fs.createWriteStream(path.join(this.dataRoot,'voice-runtime.log'),{flags:'a'});const child=spawn(python,[script,'--data-root',path.join(this.dataRoot,'voice-models')],{cwd:this.runtimeRoot,windowsHide:true,env:{...process.env,MINTO_VOICE_TOKEN:this.token,PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']});this.child=child;
   let ready=false;const timer=setTimeout(()=>{if(!ready){this.stop();reject(new Error('本地语音启动超时，请查看语音日志'));}},30000);
   const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{log.write(line.slice(0,16000)+'\n');if(ready)return;try{const message=JSON.parse(line);if(message.event==='ready'&&Number.isInteger(message.port)&&message.port>0&&message.port<=65535){ready=true;clearTimeout(timer);this.endpoint='http://127.0.0.1:'+message.port;resolve(this.endpoint);}}catch{}});
   child.stderr.on('data',chunk=>log.write(chunk));child.once('error',error=>{clearTimeout(timer);log.end();reject(new Error('无法启动本地语音：'+error.message));});child.once('exit',()=>{clearTimeout(timer);this.child=null;this.endpoint=null;this.starting=null;log.end();if(!ready)reject(new Error('本地语音启动失败，请查看语音日志'));});
  });try{return await this.starting;}finally{this.starting=null;}
 }
 config(value){if(value.engine==='external')return value;if(!this.endpoint)throw new Error('本地语音尚未就绪');return {...value,api_base:this.endpoint,runtime_token:this.token};}
 async refresh(){if(!this.endpoint)throw new Error('本地语音尚未就绪');const response=await this.fetcher(this.endpoint+'/models/refresh',{method:'POST',headers:{'X-Minto-Token':this.token},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('模型验证失败 HTTP '+response.status);return response.json();}
 async importModel(source){
  const entries=fs.readdirSync(source,{withFileTypes:true});const files=entries.filter(entry=>entry.isFile()&&entry.name.endsWith('.safetensors'));
  if(files.length!==1||!entries.some(entry=>entry.isFile()&&entry.name==='config.json')||!entries.some(entry=>entry.isFile()&&entry.name==='style_vectors.npy'))throw new Error('请选择包含单个 .safetensors、config.json 和 style_vectors.npy 的模型目录');
  const config=JSON.parse(fs.readFileSync(path.join(source,'config.json'),'utf8'));if(!config.data?.spk2id||!config.data?.style2id)throw new Error('模型缺少说话人或风格数据');
  const root=path.join(this.dataRoot,'voice-models');fs.mkdirSync(root,{recursive:true});const id=randomUUID(),target=path.resolve(root,id);if(path.relative(root,target)!==id)throw new Error('模型目标目录无效');fs.mkdirSync(target);
  try{for(const name of [files[0].name,'config.json','style_vectors.npy'])await fs.promises.copyFile(path.join(source,name),path.join(target,name));const models=await this.refresh();return {id,models};}catch(error){if(path.relative(root,target)===id)fs.rmSync(target,{recursive:true,force:true});throw error;}
 }
 stop(){const child=this.child;this.child=null;this.endpoint=null;if(child?.pid){if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}}
}
module.exports={VoiceRuntime};
