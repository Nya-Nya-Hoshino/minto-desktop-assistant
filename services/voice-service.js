'use strict';
function validModelInfo(info){
 if(!info||Array.isArray(info)||typeof info!=='object'||typeof info.model_path!=='string'||!info.model_path)return false;
 return ['spk2id','style2id'].every(key=>info[key]&&typeof info[key]==='object'&&!Array.isArray(info[key])&&Object.entries(info[key]).length>0&&Object.entries(info[key]).every(([name,id])=>name&&Number.isInteger(id)&&id>=0));
}
class VoiceService {
 constructor(config,{fetcher=fetch}={}){this.config=config;this.fetcher=fetcher;this.models=null;}
 headers(){return this.config.runtime_token?{'X-Minto-Token':this.config.runtime_token}:{};}
 async info(signal){const resp=await this.fetcher(this.config.api_base.replace(/\/+$/,'')+'/models/info',{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),headers:this.headers()});if(!resp.ok)throw new Error('语音模型列表 HTTP '+resp.status);const models=await resp.json();if(!models||typeof models!=='object'||Array.isArray(models)||!Object.values(models).every(validModelInfo))throw new Error('语音模型列表格式无效');this.models=models;return models;}
 async synthesize(text,signal){signal?.throwIfAborted();if(typeof text!=='string'||!text.trim())throw new Error('语音文本为空');const models=this.models||await this.info(signal);const model=models[String(this.config.model_id)];if(!model||!model.spk2id||!model.style2id)throw new Error('所选语音模型未加载');
 const speaker=this.config.speaker_name||Object.keys(model.spk2id)[0];const style=this.config.style||Object.keys(model.style2id)[0];if(!Object.hasOwn(model.spk2id,speaker)||!Object.hasOwn(model.style2id,style))throw new Error('所选说话人或发声风格不存在');
 const url=new URL(this.config.api_base.replace(/\/+$/,'')+'/voice');for(const [k,v]of Object.entries({text,model_id:String(this.config.model_id),speaker_name:speaker,style,language:'JP',length:this.config.length||1,style_weight:this.config.style_weight||1,auto_split:false}))url.searchParams.set(k,String(v));
 const response=await this.fetcher(url.toString(),{method:'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000),headers:this.headers()});if(!response.ok)throw new Error('语音合成 HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('语音服务未返回 WAV 音频');return bytes;
 }
}
module.exports={VoiceService};
