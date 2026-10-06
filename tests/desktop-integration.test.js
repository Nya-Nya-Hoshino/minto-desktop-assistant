'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const vm=require('node:vm');const http=require('node:http');const {EventEmitter}=require('node:events');const {createRequire}=require('node:module');const {pathToFileURL}=require('node:url');
async function desktop(t,{lockGranted=true}={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-integration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const handlers=new Map(),windows=[],messages=[],openedPaths=[],popups=[],lockState={paths:[],attempts:0,quits:0};class Window extends EventEmitter{constructor(options){super();this.bounds={x:options.x||0,y:options.y||0,width:options.width,height:options.height};this.visible=options.show!==false;this.focusCount=0;this.webContents=new EventEmitter();this.webContents.send=(channel,value)=>messages.push({channel,value});this.webContents.isLoading=()=>false;this.webContents.setWindowOpenHandler=()=>{};this.webContents.session={setPermissionRequestHandler(){}};windows.push(this);}static fromWebContents(contents){return windows.find(window=>window.webContents===contents);}isDestroyed(){return false;}loadFile(){}setContentProtection(){}show(){this.visible=true;}hide(){this.visible=false;}showInactive(){this.visible=true;}focus(){this.focusCount++;}isVisible(){return this.visible;}getBounds(){return {...this.bounds};}getPosition(){return [this.bounds.x,this.bounds.y];}setPosition(x,y){Object.assign(this.bounds,{x,y});}setSize(width,height){Object.assign(this.bounds,{width,height});}setResizable(){}}
const electron={app:Object.assign(new EventEmitter(),{isPackaged:false,whenReady:()=>Promise.resolve(),setPath(name,file){lockState.paths.push([name,file]);},requestSingleInstanceLock:()=>{lockState.attempts++;return lockGranted;},quit(){lockState.quits++;}}),net:{fetch},BrowserWindow:Window,ipcMain:Object.assign(new EventEmitter(),{handle:(channel,handler)=>handlers.set(channel,handler)}),Tray:class extends EventEmitter{setToolTip(){}setContextMenu(){}destroy(){}},Menu:{buildFromTemplate:items=>({items,popup:options=>popups.push({items,options})})},dialog:{},shell:{openPath:async file=>{openedPaths.push(file);return '';}},screen:{getPrimaryDisplay:()=>({id:41,label:'Actual primary display',workArea:{x:0,y:0,width:1920,height:1080}}),getAllDisplays:()=>[{id:41,label:'Actual primary display',bounds:{x:0,y:0,width:1920,height:1080},scaleFactor:1,workArea:{x:0,y:0,width:1920,height:1080}}],getDisplayMatching:()=>({bounds:{x:0,y:0,width:1920,height:1080},scaleFactor:1,workArea:{x:0,y:0,width:1920,height:1080}})},desktopCapturer:{getSources:async()=>[]},powerMonitor:new EventEmitter(),safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from([...s].reverse().join('')),decryptString:b=>[...b.toString()].reverse().join('')}};
const filename=path.join(__dirname,'../main.js'),realRequire=createRequire(filename);const context=vm.createContext({require:name=>name==='electron'?electron:name==='./services/voice-runtime'?{VoiceRuntime:class{start(){return Promise.resolve('http://127.0.0.1:5000');}config(value){return value;}stop(){}}}:realRequire(name),__dirname:path.dirname(filename),process:{argv:[],env:{MINTO_DATA_DIR:root}},console,Buffer,URL,AbortController,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){}});vm.runInContext(fs.readFileSync(filename,'utf8'),context);await new Promise(resolve=>setImmediate(resolve));const event={sender:windows[0]?.webContents,senderFrame:{url:pathToFileURL(path.join(path.dirname(filename),'renderer/index.html')).href}};return {call:(channel,data,sender=event)=>handlers.get('minto:'+channel)(sender,data),send:(channel,data)=>electron.ipcMain.emit('minto:'+channel,event,data),messages,context,electron,root,openedPaths,popups,windows,lockState};}
test('every settings entry reopens hidden and minimized settings without creating duplicates',async t=>{
 const app=await desktop(t);await app.call('open-settings');const settings=app.windows[1];
 let minimized=false;settings.isMinimized=()=>minimized;settings.restore=()=>{minimized=false;settings.show();};
 for(const open of [()=>app.call('open-settings'),()=>vm.runInContext('menu().items[1].click()',app.context),()=>vm.runInContext("tray.emit('double-click')",app.context)]){
  settings.hide();minimized=true;await open();
  assert.equal(minimized,false,'Opening settings must restore a minimized window');
  assert.equal(settings.isVisible(),true,'Opening settings must show an existing hidden window');
  assert.equal(app.windows.length,2,'Opening settings must reuse the existing window');
 }
 settings.emit('closed');await app.call('open-settings');assert.equal(app.windows.length,3);
});

test('switching saves cancels a live request and prevents stale reply/history/audio',async t=>{let entered;const entry=new Promise(resolve=>entered=resolve);let finish;const server=http.createServer((request,response)=>{request.resume();entered();finish=()=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'こんにちはなのです。',emotion:'happy',pose:'mPose3'})}}]}));};});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const app=await desktop(t);await app.call('settings-save',{llm:{api_base:'http://127.0.0.1:'+server.address().port+'/v1',model:'Exact_Model'},voice:{enabled:false}});const initial=await app.call('state');await app.call('chat',{text:'你好',observe:false});await entry;const created=await app.call('save-action',{action:'create',name:'第二存档'});finish();await new Promise(resolve=>setTimeout(resolve,60));const state=await app.call('state');assert.notEqual(state.save.id,initial.save.id);assert.equal(state.save.id,created.save.id);assert.equal(state.save.messages.length,0);assert.equal(state.busy,false);assert.equal(app.messages.some(item=>item.channel==='minto:reply'&&item.value.status==='done'),false);assert.equal(app.messages.some(item=>item.channel==='minto:audio'),false);assert.ok(app.messages.some(item=>item.channel==='minto:audio-stop'));});
test('bridge rejects unexpected sender frames and malformed chat without starting work',async t=>{const app=await desktop(t);await assert.rejects(()=>app.call('chat',{text:'你好',observe:false,image:'untrusted'}));const state=await app.call('state');assert.equal(state.busy,false);assert.equal(state.save.messages.length,0);});
test('audio playback blocks proactive capture and cancel resets playback state',async t=>{const app=await desktop(t);let captures=0;app.electron.desktopCapturer.getSources=async()=>{captures++;return [];};vm.runInContext("settings.update({llm:{api_base:'http://127.0.0.1:1',model:'Exact'},vision:{api_base:'http://127.0.0.1:1',model:'Exact'}})",app.context);app.send('playback-status',true);assert.equal((await app.call('state')).busyAudio,true);await vm.runInContext('observe()',app.context);assert.equal(captures,0);app.send('playback-status','true');assert.equal((await app.call('state')).busyAudio,true);await app.call('cancel');assert.equal((await app.call('state')).busyAudio,false);});
test('data directory bridge opens only its configured directory and rejects payload paths',async t=>{const app=await desktop(t);const state=await app.call('state');assert.equal(state.dataRoot,app.root);await app.call('open-data-directory');assert.deepEqual(app.openedPaths,[app.root]);await assert.rejects(()=>app.call('open-data-directory','C:\\Windows'));assert.deepEqual(app.openedPaths,[app.root]);});
test('new settings observe the actual primary display and character context menu uses tray actions',async t=>{const app=await desktop(t);const state=await app.call('state');assert.equal(state.settings.observation.enabled,true);assert.equal(state.settings.observation.display_id,'41');app.windows[0].webContents.emit('context-menu',{});assert.equal(app.popups.length,1);assert.deepEqual(Array.from(app.popups[0].items,item=>item.label).filter(Boolean),['观察状态：等待配置','打开设置','暂停主动观察','退出 Minto Assistant']);});
test('manual screen observation works without chat text and persists only evidenced summary',async t=>{const seen=[];const server=http.createServer((request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{const input=JSON.parse(body);seen.push(input);const content=typeof input.messages[0].content==='string'&&input.messages[0].content.startsWith('公開本文の言語を検査します。')?JSON.stringify({japanese:true}):Array.isArray(input.messages[0].content)?JSON.stringify({summary:'画面には文書が表示されています。',speak:false}):JSON.stringify({text:'文書を読んでいるのですね。',emotion:'gentle',pose:'mPose0'});response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content}}]}));});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const app=await desktop(t);const endpoint='http://127.0.0.1:'+server.address().port+'/v1';await app.call('settings-save',{llm:{api_base:endpoint,model:'Exact_Chat'},vision:{api_base:endpoint,model:'Exact_Vision'},voice:{enabled:false}});app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('private-screen-frame')}}];await app.call('observe-now');for(let i=0;i<100;i++){if((await app.call('state')).save.messages.length===2)break;await new Promise(resolve=>setTimeout(resolve,10));}const state=await app.call('state');assert.equal(state.save.messages.length,2);const metadata=state.save.messages[1].metadata;assert.equal(metadata.screenSummary,'画面には文書が表示されています。');assert.match(metadata.observedAt,/^\d{4}-\d{2}-\d{2}T/);assert.equal(metadata.display_id,'41');assert.equal(JSON.stringify(state.save).includes(Buffer.from('private-screen-frame').toString('base64')),false);assert.ok(seen[1].messages[0].content.includes(metadata.screenSummary));});

test('a failed periodic vision request retries the same screen on the next observation',async t=>{
 let requests=0;const server=http.createServer((request,response)=>{request.resume();requests++;response.writeHead(503);response.end('temporary failure');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const app=await desktop(t),endpoint='http://127.0.0.1:'+server.address().port+'/v1';
 await app.call('settings-save',{llm:{api_base:endpoint,model:'Exact_Chat'},vision:{api_base:endpoint,model:'Exact_Vision'},voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('same-screen-frame')}}];
 await vm.runInContext('observe()',app.context);await vm.runInContext('observe()',app.context);
 assert.equal(requests,2);assert.equal((await app.call('state')).busy,false);
});
test('same-data-root second instance quits before constructing windows or opening saves',async t=>{
 const app=await desktop(t,{lockGranted:false});assert.equal(app.windows.length,0);assert.equal(app.lockState.quits,1);assert.equal(app.lockState.attempts,1);
 assert.deepEqual(app.lockState.paths,[['userData',app.root]]);assert.equal(fs.existsSync(path.join(app.root,'saves','index.json')),false);
});
test('changing UI language persists only UI settings and localizes the native menu without cancelling work',async t=>{
 const app=await desktop(t);await app.call('settings-save',{llm:{model:'Exact_Model'},voice:{enabled:false}});app.send('playback-status',true);
 await app.call('language','en');let state=await app.call('state');assert.equal(state.settings.ui.language,'en');assert.equal(state.settings.llm.model,'Exact_Model');assert.equal(state.busyAudio,true);
 app.windows[0].webContents.emit('context-menu',{});assert.deepEqual(Array.from(app.popups.at(-1).items,item=>item.label).filter(Boolean),['Observation: Waiting for configuration','Open settings','Pause proactive observation','Quit Minto Assistant']);
 await app.call('language','ja');app.windows[0].webContents.emit('context-menu',{});assert.deepEqual(Array.from(app.popups.at(-1).items,item=>item.label).filter(Boolean),['観察状態：設定待ち','設定を開く','自動観察を一時停止','Minto Assistant を終了']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(app.root,'settings.json'),'utf8')).ui.language,'ja');await assert.rejects(()=>app.call('language','EN'));
});
test('voice model service errors use the selected interface language',async t=>{
 const server=http.createServer((request,response)=>{request.resume();response.writeHead(200,{'Content-Type':'application/json'});response.end('[]');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const app=await desktop(t);await app.call('settings-save',{voice:{engine:'external',api_base:'http://127.0.0.1:'+server.address().port}});
 for(const [language,message]of [['en','Invalid voice model list format'],['ja','音声モデル一覧の形式が無効です']]){await app.call('language',language);await assert.rejects(()=>app.call('voice-models'),error=>error.message===message);}
});
test('chat opens in a separate window and resizing it preserves the pet bounds',async t=>{
 const app=await desktop(t);const pet=app.windows[0];
 await app.call('chat-toggle',true);
 assert.equal(app.windows.length,2);
 const chat=app.windows[1],before=pet.getBounds();
 const event={sender:chat.webContents,senderFrame:{url:pathToFileURL(path.join(__dirname,'../renderer/chat.html')).href}};
 await app.call('resize',1.08,event);
 assert.deepEqual(pet.getBounds(),before);
 assert.ok(chat.getBounds().width>360);
});
test('automatic chat reveal does not steal keyboard focus',async t=>{
 const app=await desktop(t);await app.call('chat-reveal');
 assert.equal(app.windows[1].isVisible(),true);assert.equal(app.windows[1].focusCount,0);
 await app.call('chat-toggle',true);assert.equal(app.windows[1].focusCount,1);
});
test('pet errors reach the separate chat with only declared messages allowed',async t=>{
 const app=await desktop(t);await app.call('pet-status','音声を再生できませんでした。');
 assert.ok(app.messages.some(item=>item.channel==='minto:reply'&&item.value.status==='error'&&item.value.message==='无法播放语音。'));
 await assert.rejects(()=>app.call('pet-status','untrusted status'));
});
test('a loading chat receives pet errors after its page is ready',async t=>{
 const app=await desktop(t);await app.call('chat-toggle',false);app.windows[1].webContents.isLoading=()=>true;
 await app.call('pet-status','音声を再生できませんでした。');
 assert.equal(app.messages.some(item=>item.channel==='minto:reply'),false);
 app.windows[1].webContents.emit('did-finish-load');assert.ok(app.messages.some(item=>item.channel==='minto:reply'));
});

test('region capture sends only mapped pixels and full-screen mode does not crop',async t=>{
 const app=await desktop(t),crops=[];app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,getSize:()=>({width:1600,height:900}),crop:rect=>{crops.push(rect);return {toJPEG:()=>Buffer.from('cropped-frame')};},toJPEG:()=>Buffer.from('whole-frame')}}];
 await app.call('settings-save',{observation:{capture_mode:'region',region_x:.1,region_y:.2,region_width:.5,region_height:.4}});assert.equal((await vm.runInContext('capture()',app.context)).toString(),'cropped-frame');assert.equal(JSON.stringify(crops[0]),JSON.stringify({x:160,y:180,width:800,height:360}));
 await app.call('settings-save',{observation:{capture_mode:'screen'}});assert.equal((await vm.runInContext('capture()',app.context)).toString(),'whole-frame');assert.equal(crops.length,1);
});
test('capture requests physical display resolution before region cropping',async t=>{
 const app=await desktop(t);let options,quality;
 app.electron.screen.getAllDisplays=()=>[{id:41,bounds:{x:0,y:0,width:2560,height:1440},scaleFactor:1.25}];
 app.electron.desktopCapturer.getSources=async input=>{options=input;return [{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:value=>{quality=value;return Buffer.from('frame');}}}];};
 await vm.runInContext('capture()',app.context);
 assert.equal(JSON.stringify(options.thumbnailSize),JSON.stringify({width:3200,height:1800}));assert.equal(quality,90);
});
test('screen-enabled chat sends the user question to vision and current evidence to chat',async t=>{
 const app=await desktop(t),seen=[];app.electron.net.fetch=async(_url,init)=>{
  const body=JSON.parse(init.body);seen.push(body);const value=body.model==='Exact_Vision'?{summary:'Mint: It is sunny today.',speak:false}:body.messages[0].content.startsWith('公開本文の言語を検査します。')?{japanese:true}:{text:'今日は晴れだと言っているのです。',emotion:'neutral',pose:'mPose0'};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})};
 };
 await app.call('settings-save',{llm:{api_base:'https://example.test/v1',model:'Exact_Chat'},vision:{api_base:'https://example.test/v1',model:'Exact_Vision'},voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('frame')}}];
 await vm.runInContext("reply('现在屏幕中的薄荷说了什么',{observe:true})",app.context);
 assert.ok(seen[0].messages[0].content[0].text.includes('现在屏幕中的薄荷说了什么'));
 assert.ok(seen[1].messages.at(-1).content.includes('Mint: It is sunny today.'));
 assert.equal((await app.call('state')).save.messages.length,2);
});
test('multimodal primary sends screenshot and history without requiring backup vision',async t=>{
 const app=await desktop(t),seen=[];
 app.electron.net.fetch=async(_url,init)=>{const body=JSON.parse(init.body);seen.push(body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(seen.length===1?{text:'表示は七百三十一なのです。',emotion:'neutral',pose:'mPose0'}:{japanese:true})}}]})};};
 const config={provider:'DeepSeek',api_base:'https://example.test/v1',model:'deepseek-flash',api_key:'test',reasoning_effort:'high',multimodal:true};
 await app.call('settings-save',{llm:config,voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('cropped-frame')}}];
 await vm.runInContext("saves.append('前の質問','ボクには画面が見えないのです。',{});reply('画面の数値は？',{observe:true})",app.context);
 assert.equal(seen.length,2,'One multimodal reply plus Japanese validation, no separate vision summary');
 const messages=seen[0].messages,content=messages.at(-1).content;
 assert.ok(Array.isArray(content));assert.equal(content[1].image_url.url,'data:image/jpeg;base64,'+Buffer.from('cropped-frame').toString('base64'));
 assert.ok(content[0].text.includes('画面の数値は？'));assert.equal(messages[2].content,'ボクには画面が見えないのです。');
 assert.equal(messages[0].content.includes('今回は画面を観測していません。'),false);
 assert.equal(JSON.stringify((await app.call('state')).save).includes(Buffer.from('cropped-frame').toString('base64')),false);
});
test('rejected primary image input uses backup vision then the primary for dialogue',async t=>{
 const app=await desktop(t),seen=[];
 app.electron.net.fetch=async(_url,init)=>{const body=JSON.parse(init.body),image=body.messages.some(message=>Array.isArray(message.content));seen.push({model:body.model,image,body});
  if(body.model==='Primary'&&image)return {ok:false,status:400};
  const value=body.model==='Backup'?{summary:'確認番号：731',speak:false}:body.messages[0].content.startsWith('公開本文の言語を検査します。')?{japanese:true}:{text:'番号は七百三十一なのです。',emotion:'neutral',pose:'mPose0'};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})};
 };
 await app.call('settings-save',{llm:{api_base:'https://example.test/v1',model:'Primary',multimodal:true},vision:{api_base:'https://example.test/v1',model:'Backup'},voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('frame')}}];
 await vm.runInContext("reply('画面の番号は？',{observe:true})",app.context);
 assert.deepEqual(seen.map(value=>[value.model,value.image]),[['Primary',true],['Backup',true],['Primary',false],['Primary',false]]);
 assert.ok(seen[1].body.messages[0].content[0].text.includes('画面の番号は？'));
 assert.equal((await app.call('state')).save.messages.length,2);
});
test('authentication failure on primary image input does not fall back to vision',async t=>{
 const app=await desktop(t),seen=[];app.electron.net.fetch=async(_url,init)=>{seen.push(JSON.parse(init.body).model);return {ok:false,status:401};};
 await app.call('settings-save',{llm:{api_base:'https://example.test/v1',model:'Primary',multimodal:true},vision:{api_base:'https://example.test/v1',model:'Backup'},voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('frame')}}];
 await vm.runInContext("reply('今の画面は？',{observe:true})",app.context);
 assert.deepEqual(seen,['Primary']);assert.equal((await app.call('state')).save.messages.length,0);
 assert.ok(app.messages.some(item=>item.channel==='minto:reply'&&item.value.detail==='LLM HTTP 401'));
});
test('periodic observation uses the multimodal primary without backup configuration',async t=>{
 const app=await desktop(t),seen=[];app.electron.net.fetch=async(_url,init)=>{const body=JSON.parse(init.body);seen.push(body.model);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(body.messages[0].content.startsWith('公開本文の言語を検査します。')?{japanese:true}:{text:'マスター、ひと息ついてほしいのです。',emotion:'gentle',pose:'mPose0'})}}]})};};
 await app.call('settings-save',{llm:{api_base:'https://example.test/v1',model:'Primary',multimodal:true},voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('frame')}}];
 await vm.runInContext('observe()',app.context);assert.deepEqual(seen,['Primary','Primary']);assert.equal((await app.call('state')).busy,false);
});
test('startup preference controls the packaged executable and rejects enabling a development launch',async t=>{
 const app=await desktop(t),calls=[];app.electron.app.setLoginItemSettings=value=>calls.push(value);
 await assert.rejects(()=>app.call('settings-save',{ui:{launch_at_login:true}}));assert.equal((await app.call('state')).settings.ui.launch_at_login,false);
 app.electron.app.isPackaged=true;await app.call('settings-save',{ui:{launch_at_login:true}});assert.equal(calls.at(-1).openAtLogin,true);assert.equal(calls.at(-1).args.length,0);
 await app.call('settings-save',{ui:{launch_at_login:false}});assert.equal(calls.at(-1).openAtLogin,false);
});
test('automatic observation pauses while region selection is active',async t=>{
 const app=await desktop(t);let captures=0;app.electron.desktopCapturer.getSources=async()=>{captures++;return [];};vm.runInContext("settings.update({llm:{api_base:'http://127.0.0.1:1',model:'Exact'},vision:{api_base:'http://127.0.0.1:1',model:'Exact'}});regionSelector={active:true}",app.context);await vm.runInContext('observe()',app.context);assert.equal(captures,0);
});
test('selecting another display commits its region only after successful selection',async t=>{
 const app=await desktop(t),before=(await app.call('state')).settings.observation;
 app.electron.screen.getAllDisplays=()=>[{id:41},{id:82}];app.context.selectedDisplays=[];
 vm.runInContext("regionSelector={select:async display=>{selectedDisplays.push(display.id);return {cancelled:true}}}",app.context);
 assert.equal((await app.call('region-select',{display_id:'82'})).cancelled,true);
 assert.equal(JSON.stringify((await app.call('state')).settings.observation),JSON.stringify(before));assert.deepEqual(app.context.selectedDisplays,[82]);
 vm.runInContext("regionSelector={select:async display=>({cancelled:false,observation:{display_id:String(display.id),capture_mode:'region',region_x:.1,region_y:.2,region_width:.3,region_height:.4}})}",app.context);
 const result=await app.call('region-select',{display_id:'82'});assert.equal(result.observation.display_id,'82');assert.equal(result.observation.region_width,.3);
 for(const payload of [{display_id:82},{display_id:'82',extra:true},null])await assert.rejects(()=>app.call('region-select',payload));
});
test('desktop synthesis sends separate kana reading while retaining original chat text',async t=>{
 const app=await desktop(t);app.electron.net.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({speech_text:'オープンエーアイを使うのです。'})}}]})});await app.call('settings-save',{llm:{api_base:'https://example.test/v1',model:'Exact_Model'}});app.context.spoken=[];
 await vm.runInContext("active={controller:new AbortController()};voiceService={synthesize:async text=>{spoken.push(text);return Buffer.from('audio')}};synthesize('OpenAIを使うのです。',active)",app.context);assert.deepEqual(app.context.spoken,['オープンエーアイを使うのです。']);assert.equal((await app.call('state')).save.messages.length,0);
});
test('proactive replies use the primary image pipeline on an ordinary unchanged screen',async t=>{
 const app=await desktop(t),seen=[];
 app.electron.net.fetch=async(_url,init)=>{const body=JSON.parse(init.body);seen.push(body);const checking=body.messages[0].content.startsWith('公開本文の言語を検査します。');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(checking?{japanese:true}:{text:'マスター、ひと息ついてほしいのです。',emotion:'gentle',pose:'mPose0'})}}]}));};
 await app.call('settings-save',{llm:{api_base:'https://example.test/v1',model:'Exact_Main',multimodal:true},voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('ordinary-static-screen')}}];
 await vm.runInContext('observe()',app.context);
 const state=await app.call('state');assert.equal(state.save.messages.length,2);assert.equal(state.save.messages[1].metadata.proactive,true);
 assert.equal(seen.length,2);assert.equal(seen[0].messages.at(-1).content[1].type,'image_url');assert.equal(state.busy,false);
 assert.equal(state.save.relationship.score,60,'Automatic prompts must not gain affection');
});
test('a disappeared single display is reconciled without expanding a selected region',async t=>{
 const app=await desktop(t);
 await app.call('settings-save',{observation:{display_id:'missing-display',capture_mode:'region',region_x:.1,region_y:.2,region_width:.3,region_height:.4}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,getSize:()=>({width:1920,height:1080}),crop:()=>({toJPEG:()=>Buffer.from('region')}),toJPEG:()=>Buffer.from('full-screen')}}];
 await vm.runInContext('capture()',app.context);
 const settings=(await app.call('state')).settings;assert.equal(settings.observation.display_id,'41');assert.equal(settings.observation.capture_mode,'region');assert.equal(settings.observation.region_width,.3);
 app.electron.screen.getAllDisplays=()=>[{id:41},{id:82}];await app.call('settings-save',{observation:{display_id:'missing-again'}});
 await assert.rejects(()=>vm.runInContext('capture()',app.context));assert.equal((await app.call('state')).settings.observation.display_id,'missing-again');
});
test('a human message interrupts a pending proactive request without committing a stale reply',async t=>{
 const app=await desktop(t);let entered;const started=new Promise(resolve=>entered=resolve);
 app.electron.net.fetch=async(_url,init)=>{const body=JSON.parse(init.body);const current=body.messages.at(-1).content;
  if(Array.isArray(current)){entered();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}
  const checking=body.messages[0].content.startsWith('公開本文の言語を検査します。');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(checking?{japanese:true}:{text:'ありがとうなのです。',emotion:'happy',pose:'mPose3',relationshipSignal:{signal:'care',evidence:'谢谢你'}})}}]}));};
 await app.call('settings-save',{llm:{api_base:'https://example.test/v1',model:'Exact_Main',multimodal:true},voice:{enabled:false}});
 app.electron.desktopCapturer.getSources=async()=>[{display_id:'41',thumbnail:{isEmpty:()=>false,toJPEG:()=>Buffer.from('frame')}}];
 const observing=vm.runInContext('observe()',app.context);await started;assert.equal((await app.call('state')).busyProactive,true);
 await app.call('chat',{text:'谢谢你',observe:false});await observing;
 for(let i=0;i<100;i++){if(!(await app.call('state')).busy)break;await new Promise(resolve=>setTimeout(resolve,10));}
 const state=await app.call('state');assert.equal(state.save.messages.length,2);assert.equal(state.save.messages[0].content,'谢谢你');assert.equal(state.save.relationship.score,61);assert.equal(state.save.messages[1].metadata.proactive,false);
});
