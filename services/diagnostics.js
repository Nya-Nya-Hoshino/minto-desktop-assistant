'use strict';
const fs=require('node:fs'),path=require('node:path');
class Failure extends Error{constructor(category,message,details={}){super(message);this.name='Failure';this.category=category;Object.assign(this,details);}}
function redact(value,secrets=[]){if(typeof value==='string'){let text=value;for(const secret of secrets.filter(s=>typeof s==='string'&&s.length))text=text.split(secret).join('[redacted]');return text.replace(/Bearer\s+[^\s"',}]+/gi,'Bearer [redacted]').replace(/("(?:api_key|Authorization|token|password)"\s*:\s*")[^"]*/gi,'$1[redacted]').replace(/\b(?:sk-|ghp_)[A-Za-z0-9_-]+/g,'[redacted]');}if(Array.isArray(value))return value.map(v=>redact(v,secrets));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['api_key','Authorization','token','password'].includes(key)?'[redacted]':redact(item,secrets)]));return value;}
class Diagnostics{
 constructor(root,secrets=()=>[]){this.file=path.join(root,'diagnostics','errors.json');this.secrets=secrets;this.records=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];}
 record(error,context={}){const entry=redact({at:new Date().toISOString(),category:error.category|| (error.name==='AbortError'?'cancelled':error.name==='TimeoutError'?'api':'internal'),message:String(error.message).slice(0,1500),...(error.status?{status:error.status}:{}),...(error.body?{body:String(error.body).slice(0,3000)}:{}),...context},this.secrets());this.records.push(entry);this.records=this.records.slice(-100);fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.records,null,2));fs.renameSync(tmp,this.file);return entry;}
 list(){return redact(this.records,this.secrets()).slice().reverse();}
}
module.exports={Failure,Diagnostics,redact};
