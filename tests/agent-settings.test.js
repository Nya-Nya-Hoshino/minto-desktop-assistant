'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SettingsStore}=require('../services/settings-store');
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
function store(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-agent-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return new SettingsStore(root,secure);}
test('old settings gain agent defaults and invalid bounds are rejected',t=>{
 const s=store(t);assert.equal(s.public().agent.enabled,true);s.update({agent:{working_directory:'D:/Exact',max_steps:20}});assert.equal(new SettingsStore(path.dirname(s.file),secure).value.agent.max_steps,20);
 for(const agent of [{max_steps:0},{max_steps:51},{command_timeout_seconds:4},{mcp_servers_json:'{}'},{skill_directories_json:'[1]'}])assert.throws(()=>s.update({agent}));
});
test('MCP credentials are encrypted on disk and masked values preserve exact secrets',t=>{
 const s=store(t),servers=[{id:'ExactID',transport:'http',url:'https://example.com/mcp',headers:{Authorization:'Bearer private-test-value'}}];
 s.update({agent:{mcp_servers_json:JSON.stringify(servers)}});assert.doesNotMatch(fs.readFileSync(s.file,'utf8'),/private-test-value/);
 const publicValue=s.public().agent.mcp_servers_json;assert.doesNotMatch(publicValue,/private-test-value/);s.update({agent:{mcp_servers_json:publicValue}});
 assert.equal(JSON.parse(new SettingsStore(path.dirname(s.file),secure).value.agent.mcp_servers_json)[0].headers.Authorization,'Bearer private-test-value');
});
