'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('changing the display then cancelling the settings selector performs no settings save',async()=>{
 const source=fs.readFileSync(require.resolve('../renderer/settings.js'),'utf8');
 const start=source.indexOf("element('region-select').onclick="),end=source.indexOf('\nasync function refreshDisplays',start);
 assert.ok(start>=0&&end>start);
 const button={},saved=[],selected=[];
 const context={element:id=>id==='region-select'?button:{value:'82'},api:{settingsSave:async value=>saved.push(value),regionSelect:async value=>{selected.push(value);return {cancelled:true};}},state:{settings:{observation:{display_id:'41'}}},t:value=>value,status(){},regionRender(){}};
 vm.runInNewContext(source.slice(start,end),context);await button.onclick();
 assert.deepEqual(saved,[]);assert.equal(JSON.stringify(selected),JSON.stringify([{display_id:'82'}]));assert.equal(context.state.settings.observation.display_id,'41');
});
