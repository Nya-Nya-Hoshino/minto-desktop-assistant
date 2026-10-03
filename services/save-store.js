'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function checkedMetadata(value){
 if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('存档消息附加信息损坏');
 const rules={emotion:v=>typeof v==='string'&&v.length<=80,pose:v=>typeof v==='string'&&v.length<=80,proactive:v=>typeof v==='boolean',screenSummary:v=>typeof v==='string'&&v.length<=6000,observedAt:v=>v===null||(typeof v==='string'&&Number.isFinite(Date.parse(v))),display_id:v=>v===null||(typeof v==='string'&&v.length<=200)};
 for(const [key,item]of Object.entries(value))if(!Object.hasOwn(rules,key)||!rules[key](item))throw new Error('存档消息附加信息损坏');
 return structuredClone(value);
}
function atomicWrite(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),'utf8');fs.renameSync(tmp,file);}
class SaveStore {
  constructor(root){this.root=path.join(root,'saves');fs.mkdirSync(this.root,{recursive:true});this.indexPath=path.join(this.root,'index.json');
    this.index=fs.existsSync(this.indexPath)?JSON.parse(fs.readFileSync(this.indexPath,'utf8')):{version:1,active:null,slots:[]};
    if(this.index.version!==1||!Array.isArray(this.index.slots))throw new Error('存档索引损坏，请从备份恢复。');
    if(!this.index.slots.length)this.create('はじめのセーブ');
    if(!this.index.slots.some(x=>x.id===this.index.active))this.select(this.index.slots[0].id);
  }
  file(id){if(!this.index.slots.some(x=>x.id===id))throw new Error('存档不存在');return path.join(this.root,id+'.json');}
  list(){return this.index.slots.map(x=>({...x,active:x.id===this.index.active}));}
  persistIndex(){atomicWrite(this.indexPath,this.index);}
  create(name){const now=new Date().toISOString();const save={version:1,id:randomUUID(),name:String(name||'新存档').slice(0,80),createdAt:now,updatedAt:now,skin:'Minto_Tuujou',summary:'',messages:[]};
    atomicWrite(path.join(this.root,save.id+'.json'),save);this.index.slots.push({id:save.id,name:save.name,updatedAt:now});this.index.active=save.id;this.persistIndex();return save;
  }
  read(id){const save=JSON.parse(fs.readFileSync(this.file(id),'utf8'));this.validate(save);return save;}
  current(){return this.read(this.index.active);}
  select(id){this.read(id);this.index.active=id;this.persistIndex();return this.current();}
  write(save){atomicWrite(this.file(save.id),save);const slot=this.index.slots.find(x=>x.id===save.id);slot.name=save.name;slot.updatedAt=save.updatedAt;this.persistIndex();return save;}
  append(user,assistant,metadata={}){const s=this.current();const at=new Date().toISOString();s.messages.push({role:'user',content:String(user),at},{role:'assistant',content:String(assistant),at,metadata});s.updatedAt=at;return this.write(s);}
  updateState(data){const s=this.current();if(typeof data.skin==='string')s.skin=data.skin;if(typeof data.summary==='string')s.summary=data.summary;s.updatedAt=new Date().toISOString();return this.write(s);}
  context(rounds=10){return this.current().messages.slice(-Math.max(1,Math.min(100,rounds))*2).map(({role,content})=>({role,content}));}
  rename(id,name){const s=this.read(id);s.name=String(name).trim().slice(0,80);if(!s.name)throw new Error('名称不能为空');s.updatedAt=new Date().toISOString();return this.write(s);}
  remove(id){const file=this.file(id);this.index.slots=this.index.slots.filter(s=>s.id!==id);if(!this.index.slots.length)this.create('新しいセーブ');else if(this.index.active===id)this.index.active=this.index.slots[0].id;this.persistIndex();fs.unlinkSync(file);return this.current();}
  export(id=this.index.active){return JSON.stringify(this.read(id),null,2);}
  validate(s){if(!s||s.version!==1||typeof s.name!=='string'||!Array.isArray(s.messages)||s.messages.length>200000)throw new Error('不支持的存档格式');
    for(const m of s.messages){if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>100000)throw new Error('存档对话数据损坏');if(m.metadata!==undefined)checkedMetadata(m.metadata);}
  }
  import(data){if(typeof data!=='string'||Buffer.byteLength(data)>100*1024*1024)throw new Error('存档过大');const input=JSON.parse(data);this.validate(input);
    const s=this.create(input.name+'（导入）');s.messages=input.messages.map(m=>({role:m.role,content:m.content,at:typeof m.at==='string'?m.at:s.createdAt,...(m.metadata===undefined?{}:{metadata:checkedMetadata(m.metadata)})}));
    s.summary=typeof input.summary==='string'?input.summary:'';if(['Minto_Tuujou','minto_Pajama'].includes(input.skin))s.skin=input.skin;return this.write(s);
  }
}
module.exports={SaveStore,atomicWrite};
