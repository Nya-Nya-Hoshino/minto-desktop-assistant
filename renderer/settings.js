'use strict';
const api=window.minto,i18n=window.MintoI18n;let state,dirty=false,language='zh-CN';const clearKeys=new Set(),statusRecords=new Map();
const groups={ui:['language'],llm:['provider','api_base','model','reasoning_effort'],vision:['provider','api_base','model','reasoning_effort'],voice:['enabled','engine','api_base','model_id','speaker_name','style','length','style_weight'],observation:['enabled','display_id','interval_seconds','cooldown_seconds']};
const element=id=>document.getElementById(id),t=(source,values)=>i18n.translate(language,source,values);
function status(id,source,values){statusRecords.set(id,{source,values});element(id).textContent=i18n.localizeError(language,t(source,values));}
let voiceModels={};
function voiceOptions(config){
 const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
 const modelOptions=Object.entries(voiceModels).map(([id,info])=>option(id,id+' · '+info.model_path.split(/[\\/]/).at(-1)));
 if(!Object.hasOwn(voiceModels,config.model_id))modelOptions.push(option(config.model_id,t('当前配置 {id} · 待读取模型',{id:config.model_id})));
 element('voice-model_id').replaceChildren(...modelOptions);element('voice-model_id').value=config.model_id;
 const model=voiceModels[config.model_id];
 for(const [field,key]of [['speaker_name','spk2id'],['style','style2id']]){
  const values=Object.keys(model?.[key]||{}),options=[option('',t('自动选择服务首个可用项')),...values.map(value=>option(value,value))];
  if(config[field]&&!values.includes(config[field]))options.push(option(config[field],t('{value} · 未确认',{value:config[field]})));
  element('voice-'+field).replaceChildren(...options);element('voice-'+field).value=config[field];
 }
}
function localize(){
 i18n.apply(document,language);for(const [id,{source,values}]of statusRecords)status(id,source,values);
 if(state){const voice=collect().voice;voiceOptions(voice);element('pause-observation').textContent=t(state.paused?'恢复主动观察':'暂停主动观察');}
 const empty=[...element('observation-display_id').options].find(option=>option.value==='');if(empty)empty.textContent=t('请选择屏幕');
}
function settingsRender(data){language=data.ui.language;localize();voiceOptions(data.voice);for(const [group,keys]of Object.entries(groups))for(const key of keys){const node=element(group+'-'+key);if(typeof data[group][key]==='boolean')node.checked=data[group][key];else node.value=data[group][key];}element('voice-api_base').disabled=data.voice.engine==='bundled';for(const group of ['llm','vision'])status(group+'-key-status',data[group].key_configured?'已保存 · 留空保留':'尚未保存');}
function stateRender(value){
 const previous=state,changed=language!==value.settings.ui.language;state=value;language=value.settings.ui.language;element('ui-language').value=language;if(changed)localize();
 element('data-directory-path').textContent=value.dataRoot;const selected=element('save-list').value||value.save.id;
 element('save-list').replaceChildren(...value.saves.map(save=>{const option=document.createElement('option');option.value=save.id;option.textContent=save.name+(save.active?t(' · 当前'):'');return option;}));element('save-list').value=value.saves.some(save=>save.id===selected)?selected:value.save.id;
 saveDetail(!previous||previous.save.id!==value.save.id||previous.save.updatedAt!==value.save.updatedAt);
 element('skin-list').replaceChildren(...value.skins.map(skin=>{const option=document.createElement('option');option.value=skin.id;option.textContent=t(skin.label);return option;}));element('skin-list').value=value.save.skin;
 status('voice-runtime-status','运行状态：{status}',{status:value.voiceStatus});element('pause-observation').textContent=t(value.paused?'恢复主动观察':'暂停主动观察');
}
function saveDetail(refreshFields=true){if(!state)return;const selected=state.saves.find(save=>save.id===element('save-list').value);if(refreshFields)element('save-name').value=selected?.name||'';if(selected?.id===state.save.id){if(refreshFields)element('save-summary').value=state.save.summary;status('save-info','完整对话 {count} 条 · 更新于 {date}',{count:state.save.messages.length,date:state.save.updatedAt});}else{if(refreshFields)element('save-summary').value='';status('save-info','切换后查看此存档的对话数量和摘要。');}}
async function refreshDisplays(){const selected=element('observation-display_id').value;const displays=await api.displays();const empty=document.createElement('option');empty.value='';empty.textContent=t('请选择屏幕');element('observation-display_id').replaceChildren(empty,...displays.map(display=>{const option=document.createElement('option');option.value=display.display_id;option.textContent=display.name+' · '+display.display_id;return option;}));element('observation-display_id').value=selected;}
function collect(){const data={};for(const [group,keys]of Object.entries(groups)){data[group]={};for(const key of keys){const node=element(group+'-'+key);data[group][key]=node.type==='checkbox'?node.checked:node.type==='number'?Number(node.value):node.value.trim();}}for(const group of ['llm','vision']){const key=element(group+'-api_key').value;if(key||clearKeys.has(group))data[group].api_key=key;}return data;}
async function save(){const config=await api.settingsSave(collect());if(state)state.settings=config;settingsRender(config);for(const group of ['llm','vision'])element(group+'-api_key').value='';clearKeys.clear();dirty=false;status('settings-status','设置已保存。');return config;}
localize();document.addEventListener('input',event=>{if(event.target.id==='ui-language')return;dirty=true;status('settings-status','有未保存的设置。');});
element('ui-language').onchange=async()=>{const previous=language;language=element('ui-language').value;localize();try{await api.language(language);}catch(error){language=previous;element('ui-language').value=previous;localize();status('settings-status',error.message);}};
element('settings-save').onclick=()=>save().catch(error=>status('settings-status',error.message));
for(const button of document.querySelectorAll('[data-test]'))button.onclick=async()=>{const group=button.dataset.test;button.disabled=true;status(group+'-test-status','正在测试…');try{await save();const result=await api.connectionTest(group);status(group+'-test-status',result.message);if(group==='voice'&&result.ok)status('voice-test-status',result.message+'\n'+t('实际模型：')+Object.keys(result.models).join(', '));}catch(error){status(group+'-test-status',error.message);}finally{button.disabled=false;}};
for(const button of document.querySelectorAll('[data-clear-key]'))button.onclick=()=>{clearKeys.add(button.dataset.clearKey);element(button.dataset.clearKey+'-api_key').value='';status(button.dataset.clearKey+'-key-status','保存后清除');dirty=true;};
element('refresh-displays').onclick=()=>refreshDisplays().catch(error=>status('settings-status',error.message));element('pause-observation').onclick=()=>api.pause();element('skin-list').onchange=()=>api.skin(element('skin-list').value).catch(error=>status('settings-status',error.message));element('save-list').onchange=()=>saveDetail();
for(const action of ['create','rename','switch','delete','export','import'])element('save-'+action).onclick=async()=>{const button=element('save-'+action);button.disabled=true;try{const data={action};if(['rename','switch','delete','export'].includes(action))data.id=element('save-list').value;if(['create','rename'].includes(action)){data.name=element('save-name').value.trim();if(!data.name)throw new Error(t('请输入存档名称'));}const result=await api.saveAction(data);if(result.cancelled){status('save-status','已取消。');return;}if(result.save){element('save-list').value=result.save.id;stateRender(result);saveDetail();}status('save-status',action==='export'?'存档已导出，不包含 API 密钥。':'存档操作已完成。');}catch(error){status('save-status',error.message);}finally{button.disabled=false;}};
api.onState(stateRender);(async()=>{await refreshDisplays();const value=await api.state();settingsRender(value.settings);stateRender(value);})().catch(error=>status('settings-status',error.message));
element('open-data-directory').onclick=()=>api.openDataDirectory().catch(error=>status('settings-status',error.message));
element('voice-model_id').onchange=()=>{voiceOptions({...collect().voice,speaker_name:'',style:''});dirty=true;};element('voice-engine').onchange=()=>{element('voice-api_base').disabled=element('voice-engine').value==='bundled';dirty=true;};
element('voice-refresh').onclick=async()=>{try{await save();voiceModels=await api.voiceModels();voiceOptions(state.settings.voice);status('voice-test-status','已读取实际说话人和发声风格。');}catch(error){status('voice-test-status',error.message);}};
element('voice-import').onclick=async()=>{try{const result=await api.voiceImport();if(result.cancelled)return;voiceModels=result.models;const value=await api.state();settingsRender(value.settings);stateRender(value);status('voice-test-status','模型已导入并选中。');}catch(error){status('voice-test-status',error.message);}};
api.voiceModels().then(models=>{voiceModels=models;if(state&&!dirty)voiceOptions(state.settings.voice);}).catch(error=>status('voice-test-status',error.message));
