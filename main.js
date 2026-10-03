'use strict';
const {app,BrowserWindow,ipcMain,Tray,Menu,dialog,screen,desktopCapturer,powerMonitor,safeStorage,shell,net}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {SaveStore}=require('./services/save-store');const {SettingsStore}=require('./services/settings-store');const {EMOTIONS,POSES,requestReply,completion,describeScreen,summarizeHistory}=require('./services/assistant-service');const {ObservationGate}=require('./services/observation-service');const {VoiceService}=require('./services/voice-service');const {VoiceRuntime}=require('./services/voice-runtime');const {splitSpeech}=require('./renderer/pet-controller');const skins=require('./assets/skins.json');const i18n=require('./i18n');const t=(source,values)=>i18n.translate(settings?.value.ui.language||'zh-CN',source,values);
let petWindow,chatWindow,settingsWindow,tray,settings,saves,dataRoot,active=null,summaryController=null,busy=false,busyAudio=false,paused=false,locked=false,observationError='',voiceStatus='尚未连接',voiceService=null,voiceRuntime=null,observeTimer,cursorTimer;let gate=new ObservationGate(120000);
const verify=process.argv.includes('--verify');
const serviceFetch=(input,options)=>net.fetch(input,options);
function publicState(){return {settings:settings.public(),save:saves.current(),saves:saves.list(),skins,emotions:EMOTIONS,poses:POSES,busy,busyAudio,dataRoot,paused,locked,voiceStatus:i18n.localizeError(settings.value.ui.language,voiceStatus)};}
function emit(channel,value){for(const window of [petWindow,chatWindow,settingsWindow])if(window&&!window.isDestroyed())window.webContents.send(channel,value);}
function observationStatus(){if(locked)return t('锁屏暂停');if(paused)return t('已暂停');if(!settings.value.observation.enabled)return t('已关闭');if(!configured('llm')||!configured('vision')||!settings.value.observation.display_id)return t('等待配置');if(observationError)return t('连接失败，将重试');if(busy||busyAudio)return t('对话或语音中');return t('定时观察中');}
function broadcast(){settingsWindow?.setTitle?.(t('Minto Assistant · 设置'));emit('minto:state-updated',publicState());if(tray){tray.setToolTip('Minto Assistant · '+observationStatus());tray.setContextMenu(menu());}}
function cancel(){active?.controller.abort();active=null;summaryController?.abort();summaryController=null;busy=false;busyAudio=false;emit('minto:audio-stop');}
function errorText(error){return error.name==='AbortError'?t('已取消'):i18n.localizeError(settings?.value.ui.language||'zh-CN',String(error.message)).slice(0,500);}
function authorized(event,petOnly=false){const window=BrowserWindow.fromWebContents(event.sender);const allowed=petOnly==='pet'?[petWindow]:petOnly?[petWindow,chatWindow]:[petWindow,chatWindow,settingsWindow];if(!window||!allowed.includes(window))throw new Error(t('来源窗口无效'));const expected=pathToFileURL(path.join(__dirname,'renderer',window===petWindow?'index.html':window===chatWindow?'chat.html':'settings.html')).href;if(event.senderFrame.url!==expected)throw new Error(t('来源页面无效'));}
function handle(channel,handler,petOnly=false){ipcMain.handle(channel,async(event,data)=>{authorized(event,petOnly);try{return await handler(data,event);}catch(error){throw new Error(errorText(error));}});}
function secureWindow(window){window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));}
function openSettings(){if(settingsWindow&&!settingsWindow.isDestroyed()){settingsWindow.focus();return;}settingsWindow=new BrowserWindow({width:820,height:860,minWidth:660,minHeight:580,title:t('Minto Assistant · 设置'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});secureWindow(settingsWindow);settingsWindow.loadFile(path.join(__dirname,'renderer/settings.html'));settingsWindow.on('closed',()=>{settingsWindow=null;});}
function toggleChat(visible,focus=true){
 if(!chatWindow||chatWindow.isDestroyed()){
  const pet=petWindow.getBounds(),area=screen.getDisplayMatching(pet).workArea;
  const width=Math.min(360,area.width),height=Math.min(480,area.height);
  chatWindow=new BrowserWindow({width,height,minWidth:300,minHeight:300,x:Math.max(area.x,Math.min(area.x+area.width-width,pet.x-width)),y:Math.max(area.y,Math.min(area.y+area.height-height,pet.y+80)),show:false,transparent:true,frame:false,alwaysOnTop:true,resizable:true,skipTaskbar:true,backgroundColor:'#00000000',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  chatWindow.setContentProtection(true);secureWindow(chatWindow);chatWindow.loadFile(path.join(__dirname,'renderer/chat.html'));
  chatWindow.on('close',event=>{event.preventDefault();chatWindow.hide();});
 }
 if(visible===false||(visible===undefined&&chatWindow.isVisible()))chatWindow.hide();else if(focus){chatWindow.show();chatWindow.focus();}else{chatWindow.showInactive();}
}
function configured(group){return Boolean(settings.value[group].api_base&&settings.value[group].model);}
async function capture(){const displayId=settings.value.observation.display_id;if(!displayId)throw new Error(t('请在设置中选择要观察的屏幕'));const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1600,height:1000}});const source=sources.find(item=>item.display_id===displayId);if(!source)throw new Error(t('所选屏幕不可用，请重新选择'));if(source.thumbnail.isEmpty())throw new Error(t('屏幕截图为空'));return source.thumbnail.toJPEG(75);}
async function voiceConfig(){if(settings.value.voice.engine==='bundled')await voiceRuntime.start();return voiceRuntime.config(settings.value.voice);}
async function synthesize(text,request){if(!settings.value.voice.enabled)return;try{voiceService??=new VoiceService(await voiceConfig(),{fetcher:serviceFetch});for(const chunk of splitSpeech(text)){const bytes=await voiceService.synthesize(chunk,request.controller.signal);if(active!==request)return;petWindow.webContents.send('minto:audio',new Uint8Array(bytes));}voiceStatus='已连接';}catch(error){if(error.name!=='AbortError'){voiceStatus=errorText(error);broadcast();}}}
async function summarize(id){summaryController?.abort();const controller=new AbortController();summaryController=controller;try{const save=saves.read(id);const summary=await summarizeHistory(settings.value.llm,save.messages.slice(-40).map(({role,content})=>({role,content})),save.summary,{signal:controller.signal,fetcher:serviceFetch});if(!controller.signal.aborted&&saves.current().id===id){saves.updateState({summary});broadcast();}}catch(error){if(error.name!=='AbortError')emit('minto:reply',{status:'summary-error',message:t('会話の要約を更新できませんでした。')});}finally{if(summaryController===controller)summaryController=null;}}
async function reply(text,{observe=false,screenSummary='',observedAt=null,proactive=false}={}){if(busy)throw new Error(t('正在处理上一条消息'));if(!configured('llm'))throw new Error(t('请先配置对话服务'));summaryController?.abort();summaryController=null;const request={controller:new AbortController(),saveId:saves.current().id};active=request;busy=true;broadcast();emit('minto:reply',{status:'start',proactive});try{if(observe){if(!configured('vision'))throw new Error(t('请先配置视觉服务'));const image=await capture();const observation=await describeScreen(settings.value.vision,image.toString('base64'),{signal:request.controller.signal,fetcher:serviceFetch});screenSummary=observation.summary;observedAt=new Date().toISOString();}const save=saves.current();const answer=await requestReply(settings.value.llm,saves.context(12),text,null,{signal:request.controller.signal,fetcher:serviceFetch,screenSummary,summary:save.summary});if(active!==request||saves.current().id!==request.saveId)return;saves.append(text,answer.text,{emotion:answer.emotion,pose:answer.pose,proactive,screenSummary,observedAt,display_id:observedAt?settings.value.observation.display_id:null});emit('minto:reply',{status:'done',...answer});broadcast();if(proactive)gate.markSpoken(Date.now());await synthesize(answer.text,request);if(saves.current().messages.length%20===0&&!request.controller.signal.aborted)summarize(request.saveId);}catch(error){if(active===request)emit('minto:reply',{status:error.name==='AbortError'?'cancelled':'error',message:error.name==='AbortError'?t('中止しました。'):t('接続できませんでした。設定を確認してください。'),detail:errorText(error)});}finally{if(active===request){active=null;busy=false;broadcast();}}}
async function observe(){if(paused||locked||busy||busyAudio||summaryController||!settings.value.observation.enabled||!configured('llm')||!configured('vision')||!settings.value.observation.display_id)return;const request={controller:new AbortController(),saveId:saves.current().id};active=request;busy=true;broadcast();try{const image=await capture();if(!gate.check(image,Date.now(),false))return;const observation=await describeScreen(settings.value.vision,image.toString('base64'),{signal:request.controller.signal,fetcher:serviceFetch,proactive:true});if(active!==request||saves.current().id!==request.saveId)return;observationError='';if(observation.speak){active=null;busy=false;await reply('画面の状況に合う短い自然な声かけをしてください。',{screenSummary:observation.summary,observedAt:new Date().toISOString(),proactive:true});}}catch(error){gate.reset();if(error.name!=='AbortError')observationError=errorText(error);if(error.name!=='AbortError')emit('minto:reply',{status:'observation-error',message:t('画面を観察できませんでした。')});}finally{if(active===request){active=null;busy=false;broadcast();}}}
function restartObservation(){clearInterval(observeTimer);gate.cooldownMs=settings.value.observation.cooldown_seconds*1000;observeTimer=setInterval(observe,settings.value.observation.interval_seconds*1000);}
function menu(){return Menu.buildFromTemplate([{label:t('观察状态：')+observationStatus(),enabled:false},{label:t('打开设置'),click:openSettings},{label:paused?t('恢复主动观察'):t('暂停主动观察'),click:()=>{paused=!paused;if(paused)cancel();broadcast();tray.setContextMenu(menu());}},{type:'separator'},{label:t('退出 Minto Assistant'),click:()=>app.quit()}]);}
function register(){
 handle('minto:language',language=>{settings.update({ui:{language}});broadcast();return settings.public();});
 handle('minto:observe-now',data=>{if(data!==undefined)throw new Error(t('屏幕观察不接受额外参数'));if(!configured('vision'))throw new Error(t('请先配置视觉服务'));if(busy)throw new Error(t('正在处理上一条消息'));if(busyAudio)cancel();reply('今の画面について、確認できた内容だけを日本語で教えてほしいのです。',{observe:true}).catch(error=>emit('minto:reply',{status:'error',message:t('画面を観察できませんでした。設定を確認してください。'),detail:errorText(error)}));return {accepted:true};},true);
 handle('minto:open-data-directory',async data=>{if(data!==undefined)throw new Error(t('数据目录操作不接受路径参数'));const error=await shell.openPath(dataRoot);if(error)throw new Error(error);return {ok:true};});
 ipcMain.on('minto:playback-status',(event,playing)=>{try{authorized(event,'pet');if(typeof playing!=='boolean')return;busyAudio=playing;broadcast();}catch{}});
 handle('minto:state',()=>publicState());handle('minto:settings-get',()=>settings.public());handle('minto:settings-save',data=>{cancel();settings.update(data);voiceService=null;voiceStatus='尚未连接';restartObservation();broadcast();return settings.public();});
 handle('minto:connection-test',async group=>{if(!['llm','vision','voice'].includes(group))throw new Error(t('连接测试类型无效'));const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{if(group==='voice'){voiceService=new VoiceService(await voiceConfig(),{fetcher:serviceFetch});const models=await voiceService.info(controller.signal);const selected=models[String(settings.value.voice.model_id)];if(!selected)throw new Error(t('所选语音模型未加载'));voiceStatus='已连接';broadcast();return {ok:true,message:t('语音服务连接成功'),models};}if(group==='vision'){const jpeg=await capture();await describeScreen(settings.value.vision,jpeg.toString('base64'),{signal:controller.signal,fetcher:serviceFetch});}else await completion(settings.value.llm,[{role:'user',content:'日本語で「接続成功」とだけ返してください。'}],{signal:controller.signal,fetcher:serviceFetch});return {ok:true,message:t('连接成功')};}catch(error){if(group==='voice'){voiceStatus=errorText(error);broadcast();}return {ok:false,message:errorText(error)};}finally{clearTimeout(timer);}});
 handle('minto:voice-models',async()=>{const service=new VoiceService(await voiceConfig(),{fetcher:serviceFetch});return service.info();});
 handle('minto:voice-import',async(_data,event)=>{const parent=BrowserWindow.fromWebContents(event.sender);const selected=await dialog.showOpenDialog(parent,{title:t('导入 Style-Bert-VITS2 模型目录'),properties:['openDirectory']});if(selected.canceled)return {cancelled:true};cancel();await voiceRuntime.start();const imported=await voiceRuntime.importModel(selected.filePaths[0]);settings.update({voice:{engine:'bundled',model_id:imported.id,speaker_name:'',style:''}});voiceService=null;broadcast();return imported;});
 handle('minto:displays',async()=>{return screen.getAllDisplays().map(display=>({display_id:String(display.id),name:display.label||String(display.id)}));});
 handle('minto:chat',data=>{if(!data||typeof data.text!=='string'||!data.text.trim()||data.text.length>12000||typeof data.observe!=='boolean'||Object.keys(data).some(key=>!['text','observe'].includes(key)))throw new Error(t('消息格式无效'));reply(data.text.trim(),{observe:data.observe}).catch(error=>emit('minto:reply',{status:'error',message:t('接続設定を確認してください。'),detail:errorText(error)}));return {accepted:true};},true);handle('minto:cancel',()=>{cancel();broadcast();return {ok:true};},true);
 handle('minto:skin',id=>{if(typeof id!=='string'||!skins.some(skin=>skin.id===id))throw new Error(t('未知角色服装'));saves.updateState({skin:id});broadcast();return publicState();});
 handle('minto:save-action',async(data,event)=>{if(!data||typeof data.action!=='string'||Object.keys(data).some(key=>!['action','id','name'].includes(key)))throw new Error(t('存档操作格式无效'));const {action,id,name}=data;if(id!==undefined&&(typeof id!=='string'||id.length>80))throw new Error(t('存档 ID 无效'));if(name!==undefined&&(typeof name!=='string'||name.length>80))throw new Error(t('存档名称无效'));const parent=BrowserWindow.fromWebContents(event.sender);if(action==='export'){const result=await dialog.showSaveDialog(parent,{title:t('导出独立存档（不含 API 密钥）'),defaultPath:saves.read(id||saves.current().id).name+'.json',filters:[{name:t('Minto 存档'),extensions:['json']}]});if(!result.canceled)fs.writeFileSync(result.filePath,saves.export(id),{encoding:'utf8'});return {cancelled:result.canceled};}if(action==='import'){const result=await dialog.showOpenDialog(parent,{title:t('导入独立存档'),properties:['openFile'],filters:[{name:t('Minto 存档'),extensions:['json']}]});if(result.canceled)return {cancelled:true};if(fs.statSync(result.filePaths[0]).size>100*1024*1024)throw new Error(t('存档过大'));const input=fs.readFileSync(result.filePaths[0],'utf8');JSON.parse(input);cancel();saves.import(input);}else if(action==='create'){cancel();saves.create(name);}else if(action==='rename'){saves.rename(id,name);}else if(action==='switch'){saves.read(id);cancel();saves.select(id);gate.reset();}else if(action==='delete'){saves.read(id);const response=await dialog.showMessageBox(parent,{type:'warning',title:t('删除存档'),message:t('确认删除此存档的全部对话和摘要？'),buttons:[t('取消'),t('删除')],defaultId:0,cancelId:0,noLink:true});if(response.response!==1)return {cancelled:true};cancel();saves.remove(id);}else throw new Error(t('未知存档操作'));broadcast();return publicState();});
 handle('minto:chat-reveal',data=>{if(data!==undefined)throw new Error(t('消息格式无效'));toggleChat(true,false);return {ok:true};},true);
 handle('minto:pet-status',message=>{if(!['音声を再生できませんでした。','ミントを読み込めませんでした。設定を確認してください。'].includes(message))throw new Error(t('消息格式无效'));toggleChat(true,false);const deliver=()=>emit('minto:reply',{status:'error',message:t(message)});if(chatWindow.webContents.isLoading())chatWindow.webContents.once('did-finish-load',deliver);else deliver();return {ok:true};},'pet');
 handle('minto:chat-toggle',visible=>{if(visible!==undefined&&typeof visible!=='boolean')throw new Error(t('消息格式无效'));toggleChat(visible);return {visible:chatWindow.isVisible()};},true);
 handle('minto:chat-resize',(data,event)=>{if(BrowserWindow.fromWebContents(event.sender)!==chatWindow||!data||Object.keys(data).some(key=>!['dw','dh'].includes(key))||!Number.isFinite(data.dw)||!Number.isFinite(data.dh)||Math.abs(data.dw)>500||Math.abs(data.dh)>500)throw new Error(t('缩放参数无效'));const bounds=chatWindow.getBounds(),area=screen.getDisplayMatching(bounds).workArea;chatWindow.setSize(Math.max(300,Math.min(area.width,Math.round(bounds.width+data.dw))),Math.max(300,Math.min(area.height,Math.round(bounds.height+data.dh))));return {ok:true};},true);
 handle('minto:resize',(factor,event)=>{if(typeof factor!=='number'||!Number.isFinite(factor)||factor<0.8||factor>1.2)throw new Error(t('缩放参数无效'));const window=BrowserWindow.fromWebContents(event.sender),bounds=window.getBounds(),area=screen.getDisplayMatching(bounds).workArea;const min=window===petWindow?{width:128,height:230}:{width:300,height:300};const width=Math.max(min.width,Math.min(area.width,Math.round(bounds.width*factor))),height=Math.max(min.height,Math.min(area.height,Math.round(bounds.height*factor)));if(window===petWindow)window.setResizable(true);window.setSize(width,height);if(window===petWindow)window.setResizable(false);return {width,height};},true);handle('minto:open-settings',()=>{openSettings();return {ok:true};});handle('minto:pause',()=>{paused=!paused;if(paused)cancel();broadcast();tray.setContextMenu(menu());return paused;});
 ipcMain.on('minto:ignore-mouse',(event,ignore)=>{try{authorized(event,'pet');if(typeof ignore==='boolean')petWindow.setIgnoreMouseEvents(ignore,{forward:true});}catch{}});ipcMain.on('minto:drag',(event,data)=>{try{authorized(event,'pet');if(!data||!Number.isFinite(data.dx)||!Number.isFinite(data.dy)||Math.abs(data.dx)>500||Math.abs(data.dy)>500)return;const [x,y]=petWindow.getPosition();const area=screen.getDisplayMatching(petWindow.getBounds()).bounds,bounds=petWindow.getBounds();const nextX=Math.max(area.x-bounds.width+96,Math.min(area.x+area.width-96,Math.round(x+data.dx))),nextY=Math.max(area.y,Math.min(area.y+area.height-Math.min(180,bounds.height),Math.round(y+data.dy)));petWindow.setPosition(nextX,nextY);}catch{}});
}
async function verification() {
  const outputArg = process.argv.find(arg => arg.startsWith('--verify-output='));
  const root = outputArg ? path.resolve(outputArg.slice('--verify-output='.length)) : path.join(dataRoot, 'verification');
  fs.mkdirSync(root, { recursive: true });
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const read = () => petWindow.webContents.executeJavaScript('window.mintoDiagnostics');
  async function waitFor(predicate, milliseconds = 5000) {
    const deadline = Date.now() + milliseconds;
    let value;
    do { value = await read(); if (predicate(value)) return value; await delay(25); } while (Date.now() < deadline);
    return value;
  }
  const initial = await waitFor(value => value?.ready || value?.error, 30000);
  await delay(700);
  const diagnostics = await read(), results = [];
  async function captureVerified(window,label){
    let failure;
    for(let attempt=0;attempt<3;attempt++){
      window.show();window.focus();await delay(300);
      try{return await window.webContents.capturePage(undefined,{stayAwake:true});}catch(error){failure=error;}
    }
    throw new Error('Verification capture '+label+': '+failure.message);
  }
  async function snapshot(name) {
    const shot = await captureVerified(petWindow,name);
    fs.writeFileSync(path.join(root, name + '.png'), shot.toPNG());
  }
  await snapshot('desktop');
  if (initial?.ready) {
    const originalBounds = petWindow.getBounds(), actualCursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayMatching(originalBounds).workArea;
    const positions = [
      { x: display.x, y: display.y },
      { x: display.x + display.width - originalBounds.width, y: display.y },
      { x: display.x, y: display.y + display.height - originalBounds.height },
      { x: display.x + display.width - originalBounds.width, y: display.y + display.height - originalBounds.height }
    ];
    const outsidePosition = positions.find(position => actualCursor.x < position.x || actualCursor.x >= position.x + originalBounds.width || actualCursor.y < position.y || actualCursor.y >= position.y + originalBounds.height) || { x: actualCursor.x + 60, y: originalBounds.y };
    const updatesBefore = diagnostics.gazeUpdates;
    petWindow.setPosition(outsidePosition.x, outsidePosition.y);
    const natural = await waitFor(value => value.cursor?.source === 'screen' && value.gazeUpdates > updatesBefore + 2 && (value.cursor.x < 0 || value.cursor.y < 0 || value.cursor.x >= value.cursor.width || value.cursor.y >= value.cursor.height));
    results.push({ name: 'natural-global-cursor-outside', passed: natural.cursor?.source === 'screen' && natural.gazeUpdates > updatesBefore + 2 && (natural.cursor.x < 0 || natural.cursor.y < 0 || natural.cursor.x >= natural.cursor.width || natural.cursor.y >= natural.cursor.height), actualCursor, sampledCursor: natural.cursor, parameters: natural.parameters });
    petWindow.setPosition(originalBounds.x, originalBounds.y);
    clearInterval(cursorTimer);
    for (const skin of skins) {
      await petWindow.webContents.executeJavaScript('window.mintoPet.loadSkin(' + JSON.stringify(skin.id) + ')');
      petWindow.webContents.send('minto:cursor', { x: 700, y: 0, width: 700, height: 660 });
      const right = await waitFor(value => value.parameters.ParamEyeBallX > 0.9);
      petWindow.webContents.send('minto:cursor', { x: 0, y: 660, width: 700, height: 660 });
      const left = await waitFor(value => value.parameters.ParamEyeBallX < -0.9);
      results.push({ name: 'gaze', skin: skin.id, passed: right.parameters.ParamEyeBallX > 0.5 && left.parameters.ParamEyeBallX < -0.5, right: right.parameters, left: left.parameters });
      const contour = await petWindow.webContents.executeJavaScript("(()=>{const rect=document.getElementById('live2d-layer').getBoundingClientRect();let hits=0,misses=0;for(let y=0;y<rect.height;y+=30)for(let x=0;x<rect.width;x+=30){if(window.mintoPet.hit(rect.left+x,rect.top+y))hits++;else misses++;}return {hits,misses,outside:window.mintoPet.hit(1,1)};})()");
      results.push({ name: 'contour', skin: skin.id, passed: contour.hits > 0 && contour.misses > 0 && contour.outside === false, ...contour });
      await petWindow.webContents.executeJavaScript("window.mintoPet.applyReply({emotion:'surprised',pose:'mPose3'})");
      const ears = await waitFor(value => Math.abs(value.parameters.ParamLeftEar) > 0.65 && Math.abs(value.parameters.ParamRightEar) > 0.65, 1500);
      results.push({ name: 'original-ear-motion', skin: skin.id, passed: Math.abs(ears.parameters.ParamLeftEar) > 0.65 && Math.abs(ears.parameters.ParamRightEar) > 0.65, parameters: ears.parameters });
      await petWindow.webContents.executeJavaScript("window.mintoPet.applyReply({emotion:'happy',pose:'mPose3'});window.mintoChat.toggle(true)");
      const hands = await waitFor(value => value.parameters.ParamShoulderL > 0.25 && value.parameters.ParamShoulderR > 0.25 && value.parameters.ParamLeftElbow > 0.5 && value.parameters.ParamRightElbow > 0.5, 1500);
      results.push({ name: 'original-hand-pose', skin: skin.id, passed: hands.parameters.ParamShoulderL > 0.25 && hands.parameters.ParamShoulderR > 0.25 && hands.parameters.ParamLeftElbow > 0.5 && hands.parameters.ParamRightElbow > 0.5, parameters: hands.parameters });
      const emotion = await waitFor(value => value.parameters.ParamEyeMaxOpen === 0, 1500);
      results.push({ name: 'emotion-and-pose', skin: skin.id, passed: emotion.emotion === 'happy' && emotion.pose === 'mPose3' && emotion.parameters.ParamEyeMaxOpen === 0 && emotion.frames > 0 });
      const rejection = await petWindow.webContents.executeJavaScript("(()=>{const before=window.mintoDiagnostics;const accepted=window.mintoPet.applyReply({emotion:'outside-list',pose:'outside-list'});const after=window.mintoDiagnostics;return {accepted,preserved:before.emotion===after.emotion&&before.pose===after.pose};})()");
      results.push({ name: 'invalid-action-rejection', skin: skin.id, passed: rejection.accepted === false && rejection.preserved, ...rejection });
      await snapshot(skin.id);
      await petWindow.webContents.executeJavaScript("window.mintoPet.applyReply({emotion:'neutral',pose:'mPose0'});window.mintoChat.toggle(false)");
    }
    petWindow.setPosition(outsidePosition.x,outsidePosition.y);await delay(200);
    const point=await petWindow.webContents.executeJavaScript("(()=>{const r=document.getElementById('live2d-layer').getBoundingClientRect();for(let y=Math.round(r.top+r.height*0.3);y<r.top+r.height*0.65;y+=12){const x=Math.round(r.left+r.width/2);if([-8,0,8].every(dx=>[-8,0,8].every(dy=>window.mintoPet.hit(x+dx,y+dy))))return {x,y};}return null;})()");
    if(point){
      petWindow.setIgnoreMouseEvents(false);petWindow.show();petWindow.focus();
      const input=(type,extra={})=>{const bounds=petWindow.getBounds(),event={type,x:point.x,y:point.y,button:'left',...extra};event.globalX=bounds.x+event.x;event.globalY=bounds.y+event.y;petWindow.webContents.sendInputEvent(event);};
      input('mouseMove');input('mouseDown',{clickCount:1});input('mouseUp',{clickCount:1});await delay(250);
      const opened=Boolean(chatWindow?.isVisible());
      results.push({name:'native-character-click',passed:opened});
      await petWindow.webContents.executeJavaScript('window.mintoChat.toggle(false)');
      petWindow.show();petWindow.focus();await delay(150);const holdBounds=petWindow.getBounds();
      input('mouseDown',{clickCount:1});await delay(900);
      input('mouseWheel',{deltaY:-120,deltaX:0,canScroll:true,wheelTicksY:-1});await delay(150);
      input('mouseUp',{clickCount:1});await delay(150);
      const held=petWindow.getBounds();results.push({name:'native-long-press-no-zoom-or-chat',passed:held.width===holdBounds.width&&held.height===holdBounds.height&&!chatWindow.isVisible(),before:holdBounds,after:held});
      const bounds=petWindow.getBounds();
      await petWindow.webContents.executeJavaScript("window.mintoInputChecks=[];for(const type of ['pointerdown','pointermove','pointerup','wheel'])document.addEventListener(type,e=>window.mintoInputChecks.push({type:e.type,x:e.clientX,y:e.clientY,screenX:e.screenX,screenY:e.screenY,deltaY:e.deltaY,hit:window.mintoPet.hit(e.clientX,e.clientY)}))");
      input('mouseDown',{clickCount:1});await delay(100);input('mouseMove',{x:point.x+24,y:point.y+12});await delay(100);input('mouseUp',{x:point.x+24,y:point.y+12});await delay(250);
      const moved=petWindow.getBounds();results.push({name:'native-character-drag',passed:moved.x!==bounds.x||moved.y!==bounds.y,before:bounds,after:moved});
      input('mouseMove');await delay(100);input('mouseWheel',{deltaY:-120,deltaX:0,canScroll:true,wheelTicksY:-1});await delay(250);
      const scaled=petWindow.getBounds();results.push({name:'native-character-wheel',passed:scaled.width!==moved.width||scaled.height!==moved.height,before:moved,after:scaled});
      await petWindow.webContents.executeJavaScript('window.mintoChat.toggle(true)');await delay(300);
      const petBeforeChat=petWindow.getBounds(),chatBefore=chatWindow.getBounds();
      await chatWindow.webContents.executeJavaScript('window.minto.resize(1.08)');await delay(150);
      const chatAfter=chatWindow.getBounds();
      results.push({name:'independent-chat-resize',passed:chatAfter.width>chatBefore.width&&JSON.stringify(petWindow.getBounds())===JSON.stringify(petBeforeChat),before:chatBefore,after:chatAfter});
      chatWindow.setPosition(chatBefore.x-45,chatBefore.y+25);
      results.push({name:'independent-chat-position',passed:chatWindow.getBounds().x!==chatBefore.x&&JSON.stringify(petWindow.getBounds())===JSON.stringify(petBeforeChat)});
      const chatAnchor=chatWindow.getBounds();
      await petWindow.webContents.executeJavaScript('window.minto.resize(0.92)');await delay(150);
      results.push({name:'independent-pet-resize',passed:petWindow.getBounds().width<petBeforeChat.width&&JSON.stringify(chatWindow.getBounds())===JSON.stringify(chatAnchor)});
      const current=petWindow.getBounds(),edge=screen.getDisplayMatching(current).bounds;
      petWindow.setPosition(edge.x+edge.width-current.width,edge.y+edge.height-Math.round(current.height*0.52));await delay(150);
      const tucked=petWindow.getBounds();
      await snapshot('tucked-half-body');
      await petWindow.webContents.executeJavaScript('window.minto.drag({dx:0,dy:-160})');await delay(150);
      const restored=petWindow.getBounds();
      results.push({name:'half-body-tuck-and-drag-up',passed:tucked.y+tucked.height>edge.y+edge.height&&restored.y<tucked.y&&JSON.stringify(chatWindow.getBounds())===JSON.stringify(chatAnchor),tucked,restored,display:edge});
      petWindow.setPosition(originalBounds.x,originalBounds.y);
      const chatShot=await captureVerified(chatWindow,'chat');fs.writeFileSync(path.join(root,'independent-chat.png'),chatShot.toPNG());
      fs.writeFileSync(path.join(root,'interaction-results.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(root,'native-input.json'),JSON.stringify(await petWindow.webContents.executeJavaScript('window.mintoInputChecks'),null,2));
    }else results.push({name:'native-character-hit-point',passed:false});
    openSettings();
    await new Promise(resolve => settingsWindow.webContents.once('did-finish-load', resolve));
    await delay(500);
    await settingsWindow.webContents.executeJavaScript("document.getElementById('voice-refresh').onclick()");
    const voiceSelectors=await settingsWindow.webContents.executeJavaScript("(()=>({models:[...document.getElementById('voice-model_id').options].map(o=>o.value),speakers:[...document.getElementById('voice-speaker_name').options].map(o=>o.value),styles:[...document.getElementById('voice-style').options].map(o=>o.value)}))()");
    results.push({name:'actual-voice-selectors',passed:voiceSelectors.models.includes('0')&&voiceSelectors.speakers.includes('ミント')&&voiceSelectors.styles.includes('Neutral'),...voiceSelectors});
    const unsavedEngine=await settingsWindow.webContents.executeJavaScript("(()=>{const e=document.getElementById('voice-engine');e.value='external';e.onchange();document.getElementById('voice-model_id').onchange();const ok=e.value==='external'&&!document.getElementById('voice-api_base').disabled;e.value='bundled';e.onchange();return ok;})()");
    results.push({name:'unsaved-voice-engine-preserved',passed:unsavedEngine});
    const settingsResult = await settingsWindow.webContents.executeJavaScript("(()=>({skinCount:document.getElementById('skin-list').options.length,saveCount:document.getElementById('save-list').options.length,displayCount:document.getElementById('observation-display_id').options.length,language:document.documentElement.lang,saveLabel:document.getElementById('settings-save').textContent,voiceAddress:document.getElementById('voice-api_base').value,dataRoot:document.getElementById('data-directory-path').textContent,reasoning:document.getElementById('llm-reasoning_effort').value,engine:document.getElementById('voice-engine').value}))()");
    results.push({ name: 'settings', passed: settingsResult.skinCount === 2 && settingsResult.saveCount > 0 && settingsResult.displayCount > 1 && settingsResult.dataRoot === dataRoot, ...settingsResult });
    const originalLanguage=settings.value.ui.language;
    const savedModel=settings.value.llm.model,savedKey=settings.value.llm.api_key;
    const originalDraft=await settingsWindow.webContents.executeJavaScript("(()=>{const ids=['llm-model','llm-api_key','save-name','voice-engine'];const values=Object.fromEntries(ids.map(id=>[id,document.getElementById(id).value]));document.getElementById('llm-model').value='Unsaved_Exact_Model';document.getElementById('llm-api_key').value='Unsaved_Test_Key';document.getElementById('save-name').value='Unsaved_Save_Name';document.getElementById('voice-engine').value='external';document.getElementById('voice-engine').onchange();document.getElementById('llm-model').dispatchEvent(new Event('input',{bubbles:true}));return values;})()");
    for(const language of ['zh-CN','ja','en']){
      await settingsWindow.webContents.executeJavaScript("(()=>{const node=document.getElementById('ui-language');node.value="+JSON.stringify(language)+";return node.onchange();})()");await delay(100);
      const localized=await settingsWindow.webContents.executeJavaScript("(()=>({language:document.documentElement.lang,save:document.getElementById('settings-save').textContent,model:document.getElementById('llm-model').value,key:document.getElementById('llm-api_key').value,name:document.getElementById('save-name').value,engine:document.getElementById('voice-engine').value,externalAddressEnabled:!document.getElementById('voice-api_base').disabled,title:document.title,text:document.querySelector('main').innerText}))()");
      const chat=await chatWindow.webContents.executeJavaScript("(()=>({language:document.documentElement.lang,send:document.getElementById('send-button').textContent,placeholder:document.getElementById('chat-input').placeholder,close:document.getElementById('chat-close').title}))()");
      const nativeMenu=menu().items.map(item=>item.label).filter(Boolean),disk=JSON.parse(fs.readFileSync(settings.file,'utf8'));
      results.push({name:'localization-'+language,passed:localized.language===language&&chat.language===language&&localized.save===i18n.translate(language,'保存设置')&&chat.send===i18n.translate(language,'送信')&&localized.model==='Unsaved_Exact_Model'&&localized.key==='Unsaved_Test_Key'&&localized.name==='Unsaved_Save_Name'&&localized.engine==='external'&&localized.externalAddressEnabled&&disk.ui.language===language&&disk.llm.model===savedModel&&settings.value.llm.api_key===savedKey&&disk.llm.api_key!=='Unsaved_Test_Key'&&nativeMenu.includes(i18n.translate(language,'打开设置')),language,settingsLabel:localized.save,chatLabel:chat.send,settingsTitle:localized.title,nativeMenu,unsavedFieldsPreserved:localized.model==='Unsaved_Exact_Model'&&localized.name==='Unsaved_Save_Name'});
      await settingsWindow.webContents.executeJavaScript("(()=>{document.getElementById('llm-api_key').value='';})()");
      const localizedShot=await captureVerified(settingsWindow,'settings-'+language);fs.writeFileSync(path.join(root,'settings-'+language+'.png'),localizedShot.toPNG());
      await settingsWindow.webContents.executeJavaScript("document.getElementById('llm-api_key').value='Unsaved_Test_Key'");
    }
    await settingsWindow.webContents.executeJavaScript("(()=>{const values="+JSON.stringify(originalDraft)+";for(const [id,value]of Object.entries(values))document.getElementById(id).value=value;document.getElementById('voice-engine').onchange();const node=document.getElementById('ui-language');node.value="+JSON.stringify(originalLanguage)+";return node.onchange();})()");await delay(100);
    results.push({name:'localization-startup',passed:settingsResult.language===settings.value.ui.language&&settingsResult.saveLabel===t('保存设置'),language:settingsResult.language,settingsLabel:settingsResult.saveLabel});
    fs.writeFileSync(path.join(root, 'settings-dom.json'), JSON.stringify(settingsResult, null, 2));
    settingsWindow.show(); settingsWindow.focus(); await delay(300);
    const settingsShot = await captureVerified(settingsWindow,'settings-final');
    fs.writeFileSync(path.join(root, 'settings.png'), settingsShot.toPNG());
  }
  fs.writeFileSync(path.join(root, 'desktop.json'), JSON.stringify({ diagnostics, results, state: { saveId: saves.current().id, skins: skins.map(skin => skin.id) } }, null, 2));
  voiceRuntime.stop();app.exit(diagnostics?.ready && results.every(result => result.passed) ? 0 : 1);
}

dataRoot=process.env.MINTO_DATA_DIR?path.resolve(process.env.MINTO_DATA_DIR):!app.isPackaged?path.join(__dirname,'_data'):fs.existsSync(path.join(path.dirname(app.getPath('exe')),'portable.flag'))?path.join(path.dirname(app.getPath('exe')),'data'):app.getPath('userData');
fs.mkdirSync(dataRoot,{recursive:true});app.setPath('userData',dataRoot);
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(petWindow&&!petWindow.isDestroyed()){petWindow.show();petWindow.focus();}});
app.whenReady().then(()=>{const settingsExisted=fs.existsSync(path.join(dataRoot,'settings.json'));settings=new SettingsStore(dataRoot,safeStorage);if(!settingsExisted)settings.update({observation:{enabled:true,display_id:String(screen.getPrimaryDisplay().id)}});saves=new SaveStore(dataRoot);voiceRuntime=new VoiceRuntime(dataRoot,{runtimeRoot:app.isPackaged?path.join(process.resourcesPath,'runtime'):path.join(__dirname,'runtime'),fetcher:serviceFetch});if(settings.value.voice.engine==='bundled')voiceRuntime.start().then(()=>{voiceStatus='本地语音已就绪';broadcast();}).catch(error=>{voiceStatus=errorText(error);broadcast();});const area=screen.getPrimaryDisplay().workArea;petWindow=new BrowserWindow({width:Math.min(364,area.width),height:Math.min(660,area.height),x:Math.max(area.x,area.x+area.width-404),y:Math.max(area.y,area.y+area.height-700),transparent:true,frame:false,alwaysOnTop:true,resizable:false,skipTaskbar:true,backgroundColor:'#00000000',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});petWindow.setContentProtection(true);secureWindow(petWindow);petWindow.webContents.on('context-menu',()=>menu().popup({window:petWindow}));register();petWindow.loadFile(path.join(__dirname,'renderer/index.html'));tray=new Tray(path.join(__dirname,'icon/logo.png'));tray.setToolTip('Minto Assistant');tray.setContextMenu(menu());tray.on('double-click',openSettings);powerMonitor.on('lock-screen',()=>{locked=true;cancel();broadcast();});powerMonitor.on('unlock-screen',()=>{locked=false;gate.reset();broadcast();});cursorTimer=setInterval(()=>{if(!petWindow||petWindow.isDestroyed())return;const cursor=screen.getCursorScreenPoint(),bounds=petWindow.getBounds();petWindow.webContents.send('minto:cursor',{x:cursor.x-bounds.x,y:cursor.y-bounds.y,width:bounds.width,height:bounds.height,globalX:cursor.x,globalY:cursor.y,windowX:bounds.x,windowY:bounds.y,source:'screen'});},50);restartObservation();if(verify)petWindow.webContents.once('did-finish-load',()=>verification().catch(error=>{console.error(error.stack);app.exit(1);}));});
}
app.on('before-quit',()=>{chatWindow?.destroy();voiceRuntime?.stop();clearInterval(observeTimer);clearInterval(cursorTimer);cancel();tray?.destroy();});app.on('window-all-closed',()=>app.quit());











