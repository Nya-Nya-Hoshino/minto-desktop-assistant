'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {fields,validateRegion}=require('./screen-region');
class RegionSelector{
 constructor({BrowserWindow,ipcMain,root}){
  this.BrowserWindow=BrowserWindow;this.root=root;this.window=null;this.resolve=null;
  const handle=(channel,callback)=>ipcMain.handle(channel,async(event,data)=>{this.authorize(event);return callback(data);});
  handle('minto:region-state',data=>{if(data!==undefined)throw new Error('框选参数无效');return structuredClone(this.ui);});
  handle('minto:region-complete',data=>{if(!data||Array.isArray(data)||Object.keys(data).length!==fields.length||Object.keys(data).some(key=>!fields.includes(key)))throw new Error('框选参数无效');const observation={display_id:String(this.display.id),capture_mode:'region',...data};validateRegion(observation);if(data.region_width*this.display.bounds.width<2||data.region_height*this.display.bounds.height<2)throw new Error('观察区域太小，请重新框选');this.finish({cancelled:false,observation});return {ok:true};});
  handle('minto:region-cancel',data=>{if(data!==undefined)throw new Error('框选参数无效');this.cancel();return {ok:true};});
 }
 get active(){return Boolean(this.window);}
 authorize(event){if(!this.window||event.sender!==this.window.webContents||event.senderFrame.url!==pathToFileURL(path.join(this.root,'renderer/region.html')).href)throw new Error('来源窗口无效');}
 select(display,ui){
  if(this.active)throw new Error('正在选择观察区域');this.display=display;this.ui=structuredClone(ui);
  const pending=new Promise(resolve=>{this.resolve=resolve;});
  const window=this.window=new this.BrowserWindow({...display.bounds,transparent:true,frame:false,alwaysOnTop:true,resizable:false,movable:false,skipTaskbar:true,backgroundColor:'#00000000',webPreferences:{preload:path.join(this.root,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.setContentProtection(true);window.setAlwaysOnTop(true,'screen-saver');window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));window.on('closed',()=>{if(this.window===window)this.finish({cancelled:true},false);});
  this.timer=setTimeout(()=>this.cancel(),180000);this.timer.unref?.();
  Promise.resolve(window.loadFile(path.join(this.root,'renderer/region.html'))).catch(()=>this.finish({cancelled:true,error:'框选窗口无法打开'}));
  return pending;
 }
 finish(result,destroy=true){const window=this.window,resolve=this.resolve;this.window=null;this.resolve=null;clearTimeout(this.timer);if(destroy)window?.destroy();resolve?.(result);}
 cancel(){this.finish({cancelled:true});}
}
module.exports={RegionSelector};
