(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else value.attach(root);})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
function normalizedSelection(start,end,width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('框选参数无效');
 const clamp=(value,max)=>Math.max(0,Math.min(max,value));
 const x1=clamp(Math.min(start.x,end.x),width),x2=clamp(Math.max(start.x,end.x),width),y1=clamp(Math.min(start.y,end.y),height),y2=clamp(Math.max(start.y,end.y),height);
 if(![x1,x2,y1,y2].every(Number.isFinite)||x2-x1<2||y2-y1<2)throw new Error('观察区域太小，请重新框选');
 return {region_x:x1/width,region_y:y1/height,region_width:(x2-x1)/width,region_height:(y2-y1)/height};
}
function attach(window){
 const document=window.document,api=window.minto,box=document.getElementById('selection'),hint=document.getElementById('hint');let start=null,language='zh-CN';
 const error=message=>{hint.textContent=window.MintoI18n.localizeError(language,message);};
 api.regionState().then(ui=>{language=ui.language;window.MintoI18n.apply(document,language);window.MintoAppearance.apply(document,ui);}).catch(failure=>error(failure.message));
 document.addEventListener('pointerdown',event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY};box.hidden=true;document.body.setPointerCapture(event.pointerId);event.preventDefault();});
 document.addEventListener('pointermove',event=>{if(!start)return;const left=Math.max(0,Math.min(start.x,event.clientX)),top=Math.max(0,Math.min(start.y,event.clientY));box.hidden=false;Object.assign(box.style,{left:left+'px',top:top+'px',width:Math.abs(event.clientX-start.x)+'px',height:Math.abs(event.clientY-start.y)+'px'});});
 document.addEventListener('pointerup',event=>{if(!start)return;const origin=start;start=null;try{const region=normalizedSelection(origin,{x:event.clientX,y:event.clientY},window.innerWidth,window.innerHeight);api.regionComplete(region).catch(failure=>error(failure.message));}catch(failure){box.hidden=true;error(failure.message);}});
 document.addEventListener('pointercancel',()=>{start=null;box.hidden=true;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')api.regionCancel();});
 document.addEventListener('contextmenu',event=>{event.preventDefault();api.regionCancel();});
}
return Object.freeze({normalizedSelection,attach});
});
