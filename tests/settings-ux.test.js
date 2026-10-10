'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../renderer/settings.js'),'utf8');
function savingUI(settingsSave){
 const nodes=new Map(['settings-save','llm-api_key','vision-api_key'].map(id=>[id,{value:'',disabled:false}])),messages=[],renders=[];
 const context={api:{settingsSave},state:{settings:{}},saving:null,dirty:true,editRevision:1,clearKeys:new Set(),element:id=>nodes.get(id),collect:()=>({llm:{model:'Exact_Model'}}),status:(_id,text)=>messages.push(text),settingsRender:value=>renders.push(value),t:text=>text};
 const start=source.indexOf('function markDirty()'),end=source.indexOf('\nlocalize();document.addEventListener',start);assert.ok(start>=0&&end>start);
 vm.runInNewContext(source.slice(start,end),context);return {context,nodes,messages,renders};
}
test('saving settings coalesces concurrent clicks and keeps edits made during the save',async()=>{
 let finish,calls=0;const app=savingUI(()=>{calls++;return new Promise(resolve=>finish=resolve);});
 const pending=app.context.save(),duplicate=app.context.save();assert.equal(app.nodes.get('settings-save').disabled,true);app.context.markDirty();
 finish({llm:{model:'Exact_Model'}});await Promise.all([pending,duplicate]);assert.equal(calls,1);assert.equal(app.context.dirty,true);assert.equal(app.renders.length,0);assert.equal(app.messages.at(-1),'已保存提交的设置，后续修改尚未保存。');assert.equal(app.nodes.get('settings-save').disabled,false);
});
test('failed settings saves keep the form dirty and allow retry',async()=>{
 let calls=0;const app=savingUI(async()=>{if(++calls===1)throw new Error('Exact failure');return {llm:{model:'Exact_Model'}};});
 await assert.rejects(app.context.save(),/Exact failure/);assert.equal(app.context.dirty,true);assert.equal(app.nodes.get('settings-save').disabled,false);assert.equal(app.context.saving,null);
 await app.context.save();assert.equal(app.context.dirty,false);assert.equal(app.messages.at(-1),'设置已保存。');assert.equal(app.renders.length,1);
});
