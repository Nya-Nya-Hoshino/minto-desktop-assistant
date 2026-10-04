'use strict';
const fields=Object.freeze(['region_x','region_y','region_width','region_height']);
function validateRegion(observation){
 if(!['screen','region'].includes(observation.capture_mode)||fields.some(key=>!Number.isFinite(observation[key])||observation[key]<0||observation[key]>1))throw new Error('观察区域无效，请重新框选');
 if(observation.capture_mode==='region'&&(!observation.display_id||observation.region_width<=0||observation.region_height<=0||observation.region_x+observation.region_width>1+1e-9||observation.region_y+observation.region_height>1+1e-9))throw new Error('观察区域无效，请重新框选');
}
function pixelRegion(observation,size){
 validateRegion(observation);if(observation.capture_mode==='screen')return null;
 if(!Number.isInteger(size.width)||!Number.isInteger(size.height)||size.width<1||size.height<1)throw new Error('屏幕截图为空');
 const x=Math.min(size.width-1,Math.round(observation.region_x*size.width)),y=Math.min(size.height-1,Math.round(observation.region_y*size.height));
 const right=Math.max(x+1,Math.min(size.width,Math.round((observation.region_x+observation.region_width)*size.width))),bottom=Math.max(y+1,Math.min(size.height,Math.round((observation.region_y+observation.region_height)*size.height)));
 return {x,y,width:right-x,height:bottom-y};
}
module.exports={fields,validateRegion,pixelRegion};
