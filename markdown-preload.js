'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mintoMarkdown',Object.freeze({state:()=>ipcRenderer.invoke('minto:markdown-state'),onState:callback=>{if(typeof callback!=='function')return()=>{};const listener=(_event,state)=>callback(state);ipcRenderer.on('minto:markdown-updated',listener);return()=>ipcRenderer.removeListener('minto:markdown-updated',listener);}}));
