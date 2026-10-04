'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SettingsStore}=require('../services/settings-store');
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
function create(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-settings-020-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,store:new SettingsStore(root,secure)};}
test('old version 1 settings acquire appearance, startup and full-screen defaults',t=>{
 const {root}=create(t);fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({version:1,ui:{language:'ja'},voice:{length:1.2},observation:{display_id:'41'}}));
 const state=new SettingsStore(root,secure).public();assert.equal(state.ui.language,'ja');assert.equal(state.ui.launch_at_login,false);assert.equal(state.ui.font_family,'Microsoft YaHei');assert.equal(state.ui.font_size,14);assert.equal(state.observation.capture_mode,'screen');assert.equal(state.voice.length,1.2);
});
test('appearance and startup settings survive restart and invalid values leave disk intact',t=>{
 const {root,store}=create(t);store.update({ui:{launch_at_login:true,font_family:'Yu Gothic',font_size:20}});assert.equal(new SettingsStore(root,secure).public().ui.font_size,20);
 const before=fs.readFileSync(path.join(root,'settings.json'),'utf8');for(const ui of [{font_size:9},{font_size:29},{font_size:NaN},{font_family:''},{font_family:'bad; color:red'},{font_family:'a\nfont'}])assert.throws(()=>store.update({ui}));assert.equal(fs.readFileSync(path.join(root,'settings.json'),'utf8'),before);
});
test('region must fit its selected screen and be nonempty before enabling region capture',t=>{
 const {store}=create(t);for(const observation of [{capture_mode:'region'},{capture_mode:'region',region_x:.9,region_y:0,region_width:.2,region_height:.3},{capture_mode:'other'},{region_width:Infinity}])assert.throws(()=>store.update({observation}));
 const value=store.update({observation:{display_id:'41',capture_mode:'region',region_x:.1,region_y:.2,region_width:.5,region_height:.4}});assert.equal(value.observation.region_width,.5);
});
test('region pixel crop uses thumbnail dimensions, preserves full-screen mode and rejects overflow',()=>{
 let module;try{module=require('../services/screen-region');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;module={};}assert.equal(typeof module.pixelRegion,'function');
 const state={display_id:'41',capture_mode:'region',region_x:.1,region_y:.2,region_width:.5,region_height:.4};assert.deepEqual(module.pixelRegion(state,{width:1600,height:900}),{x:160,y:180,width:800,height:360});assert.equal(module.pixelRegion({...state,capture_mode:'screen'},{width:800,height:450}),null);assert.throws(()=>module.pixelRegion({...state,region_x:.8},{width:1600,height:900}));
 const tiny=module.pixelRegion({...state,region_x:.99,region_y:.99,region_width:.01,region_height:.01},{width:101,height:101});assert.ok(tiny.width>0&&tiny.height>0);assert.ok(tiny.x+tiny.width<=101&&tiny.y+tiny.height<=101);
});
