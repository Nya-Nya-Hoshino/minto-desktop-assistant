'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('all local renderer script and stylesheet dependencies are included in the release allowlist',()=>{
 const root=path.resolve(__dirname,'..'),files=require('../package.json').build.files;
 for(const file of files.filter(file=>file.endsWith('.html'))){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)){
   const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
   assert.ok(files.includes(dependency),file+' requires excluded resource '+dependency);
   assert.ok(fs.statSync(path.join(root,dependency)).isFile(),dependency);
  }
 }
});
