'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),{pathToFileURL}=require('node:url'),{desktop}=require('./agent-desktop-harness');
test('Markdown context menu retrieves the exact saved assistant reply and rejects stale or unrelated messages',async t=>{
 const app=await desktop(t);await vm.runInContext("saves.append('質問','# 日本語の見出し\\n\\n| 項目 | 値 |\\n| --- | --- |\\n| 名前 | ミント |\\n\\n```js\\nconst Exact_Name = 1;\\n```'); toggleChat(true);",app.context);
 const state=await app.call('state'),chat=app.windows[1],event={sender:chat.webContents,senderFrame:{url:pathToFileURL(path.join(__dirname,'../renderer/chat.html')).href}};
 const raw=state.save.messages[1].content;await app.call('markdown-menu',{save_id:state.save.id,message_index:1},event);assert.equal(app.popups.length,1);assert.equal(app.popups[0].items[0].label,'以 Markdown 阅读');await app.popups[0].items[0].click();
 const reader=app.windows[2],readerEvent={sender:reader.webContents,senderFrame:{url:pathToFileURL(path.join(__dirname,'../renderer/markdown.html')).href}};const value=await app.call('markdown-state',undefined,readerEvent);assert.equal(value.markdown,raw);assert.equal(value.ui.language,'zh-CN');
 await assert.rejects(()=>app.call('markdown-menu',{save_id:state.save.id,message_index:0},event));await assert.rejects(()=>app.call('markdown-menu',{save_id:'different-save',message_index:1},event));await assert.rejects(()=>app.call('markdown-menu',{save_id:state.save.id,message_index:1,text:'different'},event));
 await assert.rejects(async()=>app.call('markdown-state',undefined,event));await assert.rejects(()=>app.call('chat',{text:'unsafe',observe:false},readerEvent));
});
test('Markdown window uses a separate narrow bridge, blocks navigation and retains original content across UI changes',async()=>{
 let exported;const calls=[];vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname,'../markdown-preload.js'),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(key,value)=>{assert.equal(key,'mintoMarkdown');exported=value;}},ipcRenderer:{invoke:async channel=>calls.push(channel),on(){},removeListener(){}}};}});assert.deepEqual(Object.keys(exported).sort(),['onState','state']);await exported.state();assert.deepEqual(calls,['minto:markdown-state']);
});
