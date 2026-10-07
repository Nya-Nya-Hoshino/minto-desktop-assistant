'use strict';
const fs=require('node:fs'),path=require('node:path'),yaml=require('yaml');
function inside(root,file){const relative=path.relative(root,file);return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
class SkillCatalog{
 constructor(roots){this.roots=roots;this.entries=[];this.errors=[];this.refresh();}
 refresh(){this.entries=[];this.errors=[];for(const root of this.roots){if(!fs.existsSync(root))continue;for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(!entry.isDirectory())continue;const folder=path.join(root,entry.name),file=path.join(folder,'SKILL.md');if(!fs.existsSync(file))continue;try{const skill=SkillCatalog.inspect(folder);if(this.entries.some(x=>x.name===skill.name))throw new Error('Duplicate skill name: '+skill.name);this.entries.push(skill);}catch(error){this.errors.push(file+': '+error.message);}}}return this.list();}
 static inspect(folder){const file=path.join(folder,'SKILL.md'),size=fs.statSync(file).size;if(size>128*1024)throw new Error('SKILL.md exceeds 128 KiB');const raw=fs.readFileSync(file,'utf8'),match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);if(!match)throw new Error('SKILL.md YAML frontmatter is missing');const metadata=yaml.parse(match[1]);if(!metadata||typeof metadata.name!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)||metadata.name.length>64||metadata.name!==path.basename(folder)||typeof metadata.description!=='string'||!metadata.description.trim()||metadata.description.length>1024)throw new Error('Skill name or description is invalid');return {name:metadata.name,description:metadata.description,folder};}
 list(){return this.entries.map(({name,description})=>({name,description}));}
 get(name){const skill=this.entries.find(x=>x.name===name);if(!skill)throw new Error('Skill not found: '+name);return skill;}
 load(name){const skill=this.get(name);return JSON.stringify({name,folder:skill.folder,instructions:fs.readFileSync(path.join(skill.folder,'SKILL.md'),'utf8')});}
 resource(name,relative){const skill=this.get(name),root=fs.realpathSync(skill.folder),file=fs.realpathSync(path.resolve(root,relative));if(!inside(root,file))throw new Error('Skill resource is outside its directory');if(fs.statSync(file).size>512*1024)throw new Error('Skill resource exceeds 512 KiB');return fs.readFileSync(file,'utf8');}
}
module.exports={SkillCatalog};
