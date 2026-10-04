'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('changing interface typography applies to the document without zooming the Live2D model',()=>{
 let api;try{api=require('../renderer/appearance');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;api={};}assert.equal(typeof api.apply,'function');const values=new Map(),document={documentElement:{style:{setProperty:(key,value)=>values.set(key,value)}}};api.apply(document,{font_family:'Yu Gothic',font_size:21});assert.equal(values.get('--minto-ui-scale'),'1.5');assert.ok(values.get('--minto-font-family').startsWith('"Yu Gothic"'));assert.equal(values.has('zoom'),false);assert.equal(values.has('transform'),false);
});
