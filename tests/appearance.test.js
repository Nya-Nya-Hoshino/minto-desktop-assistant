'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('changing interface typography applies to the document without zooming the Live2D model',()=>{
 let api;try{api=require('../renderer/appearance');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;api={};}assert.equal(typeof api.apply,'function');const values=new Map(),document={documentElement:{setAttribute(){},style:{setProperty:(key,value)=>values.set(key,value)}}};api.apply(document,{font_family:'Yu Gothic',font_size:21});assert.equal(values.get('--minto-ui-scale'),'1.5');assert.ok(values.get('--minto-font-family').startsWith('"Yu Gothic"'));assert.equal(values.has('zoom'),false);assert.equal(values.has('transform'),false);
});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SettingsStore}=require('../services/settings-store');
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
test('legacy UI settings acquire system theme without changing saved typography',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-renewal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({version:1,ui:{language:'ja',font_family:'Yu Gothic',font_size:20}}));
 const store=new SettingsStore(root,secure);assert.deepEqual(store.public().ui,{language:'ja',theme:'system',launch_at_login:false,font_family:'Yu Gothic',font_size:20});
 for(const theme of ['light','dark','system']){store.update({ui:{theme}});assert.equal(new SettingsStore(root,secure).public().ui.theme,theme);}
 const before=fs.readFileSync(store.file,'utf8');for(const theme of ['Dark','auto','',false])assert.throws(()=>store.update({ui:{theme}}));assert.equal(fs.readFileSync(store.file,'utf8'),before);
});
test('theme application declares an explicit theme while preserving Live2D scale',()=>{
 const appearance=require('../renderer/appearance'),attributes=new Map(),styles=new Map(),document={documentElement:{setAttribute:(name,value)=>attributes.set(name,value),style:{setProperty:(name,value)=>styles.set(name,value)}}};
 for(const theme of ['light','dark','system']){appearance.apply(document,{font_family:'Yu Gothic',font_size:14,theme});assert.equal(attributes.get('data-theme'),theme);assert.equal(styles.get('--minto-ui-scale'),'1');}
 appearance.apply(document,{font_family:'Yu Gothic',font_size:14});assert.equal(attributes.get('data-theme'),'system');assert.equal(styles.has('transform'),false);
});
