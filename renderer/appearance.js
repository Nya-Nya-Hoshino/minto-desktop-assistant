(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.MintoAppearance=value;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
function apply(document,ui){document.documentElement.style.setProperty('--minto-font-family',JSON.stringify(ui.font_family)+', "Yu Gothic", "Microsoft YaHei", sans-serif');document.documentElement.style.setProperty('--minto-ui-scale',String(ui.font_size/14));}
return Object.freeze({apply});
});
