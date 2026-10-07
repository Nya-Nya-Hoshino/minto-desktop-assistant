'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
class MarkdownReader {
 constructor({BrowserWindow,root,ui,translate}){this.BrowserWindow=BrowserWindow;this.root=root;this.ui=ui;this.translate=translate;this.window=null;this.markdown='';this.url=pathToFileURL(path.join(root,'renderer/markdown.html')).href;}
 state(){return {markdown:this.markdown,ui:structuredClone(this.ui())};}
 owns(event){return Boolean(this.window&&!this.window.isDestroyed()&&event.sender===this.window.webContents&&event.senderFrame?.url===this.url);}
 refresh(){if(!this.window||this.window.isDestroyed())return;this.window.setTitle?.(this.translate('Markdown 阅读'));this.window.webContents.send('minto:markdown-updated',this.state());}
 async open(markdown){
  if(typeof markdown!=='string'||!markdown.trim()||markdown.length>100000)throw new Error('消息格式无效');this.markdown=markdown;
  if(!this.window||this.window.isDestroyed()){
   const window=new this.BrowserWindow({width:600,height:620,minWidth:360,minHeight:300,show:false,title:this.translate('Markdown 阅读'),autoHideMenuBar:true,alwaysOnTop:true,backgroundColor:'#f7f2fb',webPreferences:{preload:path.join(this.root,'markdown-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});this.window=window;
   window.setContentProtection(true);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));window.on('closed',()=>{if(this.window===window)this.window=null;});
   await window.loadFile(path.join(this.root,'renderer/markdown.html'));
  }
  this.refresh();if(this.window.isMinimized?.())this.window.restore();this.window.show();this.window.focus();return {ok:true};
 }
 close(){if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=null;}
}
module.exports={MarkdownReader};
