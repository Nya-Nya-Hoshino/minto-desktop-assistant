'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');const {SkillCatalog}=require('./skill-service');
const LIMIT=24000;
function clipped(text){return text.length>LIMIT?text.slice(0,LIMIT)+'\n[output truncated]':text;}
function schema(properties,required=[]){return {type:'object',properties,required,additionalProperties:false};}
const string={type:'string'},integer={type:'integer',minimum:1};
const BUILTINS=[
 ['list_directory','List exact file and directory names.',schema({path:string},['path'])],
 ['read_file','Read a UTF-8 text file with line numbers. Paths and identifiers are exact.',schema({path:string,start_line:integer,line_count:integer},['path'])],
 ['search_files','Search text literally in files; return exact paths and line numbers.',schema({path:string,text:string},['path','text'])],
 ['run_command','Run a PowerShell command with full current-user permissions. Return stdout, stderr and exit code.',schema({command:string,cwd:string},['command'])],
 ['list_skills','List installed skill names and descriptions.',schema({})],
 ['load_skill','Load the instructions of an exact skill name before following its workflow.',schema({name:string},['name'])],
 ['read_skill_resource','Read a referenced text resource from a loaded skill directory.',schema({name:string,path:string},['name','path'])]
];
function checkArgs(def,value){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!Object.hasOwn(def.properties,k))||def.required.some(k=>!Object.hasOwn(value,k)))throw new Error('Tool arguments do not match schema');for(const [key,item]of Object.entries(value)){const spec=def.properties[key];if(spec.type==='string'&&(typeof item!=='string'||item.length>12000)||spec.type==='integer'&&(!Number.isInteger(item)||item<1))throw new Error('Tool argument type is invalid: '+key);}}
function command(command,cwd,seconds,signal){return new Promise((resolve,reject)=>{
 signal?.throwIfAborted();const executable=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[Console]::OutputEncoding; "+command;
 const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',settled=false,pendingError=null;
 const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
 const kill=()=>{if(child.pid)spawn(path.join(process.env.SystemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});};
 const abort=()=>{pendingError=new DOMException('Cancelled','AbortError');kill();};
 const timer=setTimeout(()=>{pendingError=new Error('Command timed out');kill();},seconds*1000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 child.stdout.on('data',data=>{stdout=clipped(stdout+data.toString('utf8'));});child.stderr.on('data',data=>{stderr=clipped(stderr+data.toString('utf8'));});child.on('error',error=>finish(error));child.on('close',exit_code=>finish(pendingError,JSON.stringify({stdout,stderr,exit_code,cwd})));
});}
class AgentTools{
 constructor({workingDirectory,skillRoots,commandTimeout,mcp=null}){this.workingDirectory=workingDirectory;this.skills=new SkillCatalog(skillRoots);this.commandTimeout=commandTimeout;this.mcp=mcp;}
 definitions(){return [...BUILTINS.map(([name,description,parameters])=>({type:'function',function:{name,description,parameters}})),...(this.mcp?.definitions()||[])];}
 async execute(name,args,{signal}={}){signal?.throwIfAborted();const def=BUILTINS.find(x=>x[0]===name);if(!def){if(this.mcp)return this.mcp.execute(name,args,{signal});throw new Error('Unknown tool: '+name);}checkArgs(def[2],args);const full=relative=>path.resolve(this.workingDirectory,relative);
  if(name==='list_skills')return JSON.stringify(this.skills.list());if(name==='load_skill')return this.skills.load(args.name);if(name==='read_skill_resource')return this.skills.resource(args.name,args.path);
  if(name==='run_command')return command(args.command,args.cwd?full(args.cwd):this.workingDirectory,this.commandTimeout,signal);
  if(name==='list_directory')return clipped(JSON.stringify(fs.readdirSync(full(args.path),{withFileTypes:true}).map(x=>({name:x.name,type:x.isDirectory()?'directory':'file'}))));
  if(name==='read_file'){const file=full(args.path);if(fs.statSync(file).size>2*1024*1024)throw new Error('Text file exceeds 2 MiB; use a command for larger files');const data=fs.readFileSync(file,'utf8');if(data.includes('\0'))throw new Error('File is binary; use a suitable skill');const start=(args.start_line||1)-1;return clipped(data.split(/\r?\n/).slice(start,start+(args.line_count||200)).map((line,i)=>`${start+i+1}: ${line}`).join('\n'));}
  const matches=[],target=full(args.path);let scanned=0,truncated=false;function walk(folder){signal?.throwIfAborted();if(scanned>=2000||matches.length>=200){truncated=true;return;}for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else{if(++scanned>2000){truncated=true;return;}if(fs.statSync(file).size>512*1024)continue;const data=fs.readFileSync(file,'utf8');if(data.includes('\0'))continue;data.split(/\r?\n/).forEach((line,i)=>{if(line.includes(args.text)&&matches.length<200)matches.push({path:file,line:i+1,text:line});});}if(matches.length>=200){truncated=true;return;}}}
  if(fs.statSync(target).isDirectory())walk(target);else{if(fs.statSync(target).size>512*1024)throw new Error('Search file exceeds 512 KiB; use a command for larger files');const data=fs.readFileSync(target,'utf8');if(data.includes('\0'))throw new Error('File is binary; use a suitable skill');scanned=1;data.split(/\r?\n/).forEach((line,i)=>{if(line.includes(args.text)){if(matches.length<200)matches.push({path:target,line:i+1,text:line});else truncated=true;}});}let output=JSON.stringify({matches,scanned,truncated});while(output.length>LIMIT&&matches.length){matches.pop();truncated=true;output=JSON.stringify({matches,scanned,truncated});}return output;
 }
}
module.exports={AgentTools,clipped};
