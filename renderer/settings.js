'use strict';
const api=window.minto,i18n=window.MintoI18n;let state,dirty=false,language='zh-CN',editRevision=0,saving=null;const clearKeys=new Set(),statusRecords=new Map();
const groups={agent:['enabled','working_directory','max_steps','command_timeout_seconds','mcp_servers_json','skill_directories_json'],relationship:['daily_positive_limit'],ui:['language','theme','launch_at_login','font_family','font_size'],llm:['provider','api_base','model','reasoning_effort','multimodal'],vision:['provider','api_base','model','reasoning_effort'],voice:['enabled','engine','api_base','model_id','speaker_name','style','length','style_weight'],observation:['enabled','display_id','interval_seconds','cooldown_seconds','capture_mode','region_x','region_y','region_width','region_height']};
const element=id=>document.getElementById(id),t=(source,values)=>i18n.translate(language,source,values);
function status(id,source,values,details=[]){statusRecords.set(id,{source,values,details});element(id).textContent=[i18n.localizeError(language,t(source,values)),...details.map(detail=>i18n.localizeError(language,detail))].join('\n');}
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
 i18n.apply(document,language);for(const [id,{source,values,details}]of statusRecords)status(id,source,values,details);
 if(state){const voice=collect().voice;voiceOptions(voice);element('pause-observation').textContent=t(state.paused?'恢复主动观察':'暂停主动观察');}
 const empty=[...element('observation-display_id').options].find(option=>option.value==='');if(empty)empty.textContent=t('请选择屏幕');
}
function settingsRender(data){window.MintoAppearance.apply(document,data.ui);language=data.ui.language;localize();voiceOptions(data.voice);for(const [group,keys]of Object.entries(groups))for(const key of keys){const node=element(group+'-'+key);if(typeof data[group][key]==='boolean')node.checked=data[group][key];else node.value=data[group][key];}element('voice-api_base').disabled=data.voice.engine==='bundled';for(const group of ['llm','vision'])status(group+'-key-status',data[group].key_configured?'已保存 · 留空保留':'尚未保存');}
function stateRender(value){
 window.MintoAppearance.apply(document,dirty&&state?{...value.settings.ui,theme:element('ui-theme').value}:value.settings.ui);element('ui-launch_at_login').disabled=!value.startupAvailable;element('startup-hint').textContent=t(value.startupAvailable?'免安装版启用自启后，请保持程序目录位置不变。':'开机自启仅支持打包后的应用');
 if(!dirty)for(const key of groups.ui){const node=element('ui-'+key);if(node.type==='checkbox')node.checked=value.settings.ui[key];else node.value=value.settings.ui[key];}
 const previous=state,changed=language!==value.settings.ui.language;state=value;language=value.settings.ui.language;element('ui-language').value=language;if(changed)localize();
 if(!previous||JSON.stringify(previous.settings.observation)!==JSON.stringify(value.settings.observation))regionRender(value.settings.observation);element('data-directory-path').textContent=value.dataRoot;const selected=element('save-list').value||value.save.id;
 element('save-list').replaceChildren(...value.saves.map(save=>{const option=document.createElement('option');option.value=save.id;option.textContent=save.name+(save.active?t(' · 当前'):'');return option;}));element('save-list').value=value.saves.some(save=>save.id===selected)?selected:value.save.id;
 saveDetail(!previous||previous.save.id!==value.save.id||previous.save.updatedAt!==value.save.updatedAt);
 element('skin-list').replaceChildren(...value.skins.map(skin=>{const option=document.createElement('option');option.value=skin.id;option.textContent=t(skin.label);return option;}));element('skin-list').value=value.save.skin;
 status('relationship-status','好感 {score}/100 · {stage}',{score:value.save.relationship.score,stage:t(value.relationshipStage)});
 element('observation-status').textContent=t('观察状态：')+value.observation.status;
 const time=date=>date?new Date(date).toLocaleTimeString(language):t('尚无记录');
 status('observation-times','上次观察 {attempt} · 上次主动搭话 {spoken}',{attempt:time(value.observation.lastAttemptAt),spoken:time(value.observation.lastSpokenAt)});
 element('observation-error').textContent=value.observation.detail||'';
 status('voice-runtime-status','运行状态：{status}',{status:value.voiceStatus});element('pause-observation').textContent=t(value.paused?'恢复主动观察':'暂停主动观察');
}
function saveDetail(refreshFields=true){if(!state)return;const selected=state.saves.find(save=>save.id===element('save-list').value);if(refreshFields)element('save-name').value=selected?.name||'';if(selected?.id===state.save.id){if(refreshFields)element('save-summary').value=state.save.summary;status('save-info','完整对话 {count} 条 · 更新于 {date}',{count:state.save.messages.length,date:state.save.updatedAt});}else{if(refreshFields)element('save-summary').value='';status('save-info','切换后查看此存档的对话数量和摘要。');}}
function regionRender(observation){for(const key of ['capture_mode','region_x','region_y','region_width','region_height'])element('observation-'+key).value=observation[key];element('observation-display_id').value=observation.display_id;status('region-summary',observation.region_width&&observation.region_height?'已选区域：宽 {width}% · 高 {height}%':'尚未选择区域',{width:Math.round(observation.region_width*100),height:Math.round(observation.region_height*100)});}
element('region-select').onclick=async()=>{try{const display_id=element('observation-display_id').value;if(!display_id)throw new Error(t('请在设置中选择要观察的屏幕'));const result=await api.regionSelect({display_id});if(!result.cancelled){regionRender(result.observation);state.settings.observation=result.observation;status('settings-status','观察区域已保存。');}}catch(error){status('settings-status',error.message);}};
async function refreshDisplays(selected=element('observation-display_id').value){const displays=await api.displays();const empty=document.createElement('option');empty.value='';empty.textContent=t('请选择屏幕');element('observation-display_id').replaceChildren(empty,...displays.map(display=>{const option=document.createElement('option');option.value=display.display_id;option.textContent=display.name+' · '+display.display_id;return option;}));element('observation-display_id').value=selected;}
function collect(){const data={};for(const [group,keys]of Object.entries(groups)){data[group]={};for(const key of keys){const node=element(group+'-'+key);data[group][key]=node.type==='checkbox'?node.checked:node.type==='number'?Number(node.value):node.value.trim();}}for(const group of ['llm','vision']){const key=element(group+'-api_key').value;if(key||clearKeys.has(group))data[group].api_key=key;}return data;}
function markDirty(){dirty=true;editRevision++;status('settings-status','有未保存的设置。');}
async function save(){
 if(saving)return saving;if(!state)throw new Error(t('设置仍在加载，请稍后再试。'));
 const revision=editRevision,data=collect();element('settings-save').disabled=true;status('settings-status','正在保存…');
 saving=(async()=>{const config=await api.settingsSave(data);state.settings=config;
  if(revision===editRevision){dirty=false;settingsRender(config);for(const group of ['llm','vision'])element(group+'-api_key').value='';clearKeys.clear();status('settings-status','设置已保存。');}
  else status('settings-status','已保存提交的设置，后续修改尚未保存。');return config;
 })();try{return await saving;}finally{saving=null;element('settings-save').disabled=false;}
}
localize();document.addEventListener('input',event=>{if(event.target.id==='ui-language')return;if(Object.entries(groups).some(([group,keys])=>keys.some(key=>event.target.id===group+'-'+key))||['llm-api_key','vision-api_key'].includes(event.target.id))markDirty();});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save().catch(error=>status('settings-status',error.message));}});
element('ui-language').onchange=async()=>{const previous=language;language=element('ui-language').value;localize();try{await api.language(language);}catch(error){language=previous;element('ui-language').value=previous;localize();status('settings-status',error.message);}};
element('settings-save').onclick=()=>save().catch(error=>status('settings-status',error.message));
element('agent-test').onclick=async()=>{const button=element('agent-test');button.disabled=true;status('agent-test-status','正在测试…');try{await save();const result=await api.agentTest();status('agent-test-status',result.ok?'已连接工具 {tools} 个 · 已读取技能 {skills} 个':'工具与技能检查未通过 · 工具 {tools} 个 · 技能 {skills} 个',{tools:result.tools.length,skills:result.skills.length},result.errors);}catch(error){status('agent-test-status',error.message);}finally{button.disabled=false;}};
element('agent-skill-import').onclick=async()=>{const button=element('agent-skill-import');button.disabled=true;try{await save();const result=await api.skillImport();if(result.cancelled){status('agent-test-status','已取消。');return;}const value=await api.state();settingsRender(value.settings);stateRender(value);status('agent-test-status','技能已导入：{name}',{name:result.name});}catch(error){status('agent-test-status',error.message);}finally{button.disabled=false;}};
for(const button of document.querySelectorAll('[data-test]'))button.onclick=async()=>{const group=button.dataset.test;button.disabled=true;status(group+'-test-status','正在测试…');try{await save();const result=await api.connectionTest(group);status(group+'-test-status',result.message);if(group==='voice'&&result.ok)status('voice-test-status',result.message+'\n'+t('实际模型：')+Object.keys(result.models).join(', '));}catch(error){status(group+'-test-status',error.message);}finally{button.disabled=false;}};
for(const button of document.querySelectorAll('[data-clear-key]'))button.onclick=()=>{clearKeys.add(button.dataset.clearKey);element(button.dataset.clearKey+'-api_key').value='';status(button.dataset.clearKey+'-key-status','保存后清除');markDirty();};
element('refresh-displays').onclick=()=>refreshDisplays().catch(error=>status('settings-status',error.message));element('pause-observation').onclick=()=>api.pause();element('skin-list').onchange=()=>api.skin(element('skin-list').value).catch(error=>status('settings-status',error.message));element('save-list').onchange=()=>saveDetail();
for(const action of ['create','rename','switch','delete','export','import'])element('save-'+action).onclick=async()=>{const button=element('save-'+action);button.disabled=true;try{const data={action};if(['rename','switch','delete','export'].includes(action))data.id=element('save-list').value;if(['create','rename'].includes(action)){data.name=element('save-name').value.trim();if(!data.name)throw new Error(t('请输入存档名称'));}const result=await api.saveAction(data);if(result.cancelled){status('save-status','已取消。');return;}if(result.save){element('save-list').value=result.save.id;stateRender(result);saveDetail();}status('save-status',action==='export'?'存档已导出，不包含 API 密钥。':'存档操作已完成。');}catch(error){status('save-status',error.message);}finally{button.disabled=false;}};
api.onState(stateRender);(async()=>{
 const value=await api.state();settingsRender(value.settings);stateRender(value);
 refreshDisplays(value.settings.observation.display_id).catch(error=>status('observation-error','屏幕列表读取失败：{detail}',{detail:error.message}));
 if(value.settings.voice.engine==='external'&&!value.settings.voice.api_base){status('voice-test-status','填写语音服务地址后，再读取模型。');return;}
 try{voiceModels=await api.voiceModels();if(!dirty)voiceOptions(state.settings.voice);}catch(error){status('voice-test-status',error.message);}
})().catch(error=>status('settings-status',error.message));
element('open-data-directory').onclick=()=>api.openDataDirectory().catch(error=>status('settings-status',error.message));
element('voice-model_id').onchange=()=>{voiceOptions({...collect().voice,speaker_name:'',style:''});markDirty();};element('voice-engine').onchange=()=>{element('voice-api_base').disabled=element('voice-engine').value==='bundled';markDirty();};
element('voice-refresh').onclick=async()=>{try{await save();voiceModels=await api.voiceModels();voiceOptions(state.settings.voice);status('voice-test-status','已读取实际说话人和发声风格。');}catch(error){status('voice-test-status',error.message);}};
element('voice-import').onclick=async()=>{try{const result=await api.voiceImport();if(result.cancelled)return;voiceModels=result.models;const value=await api.state();settingsRender(value.settings);stateRender(value);status('voice-test-status','模型已导入并选中。');}catch(error){status('voice-test-status',error.message);}};

for(const button of document.querySelectorAll('[data-settings-page]'))button.onclick=()=>{
 for(const page of document.querySelectorAll('.settings-page'))page.hidden=page.id!==button.dataset.settingsPage;
 for(const item of document.querySelectorAll('[data-settings-page]')){if(item===button)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');}
 window.scrollTo({top:0});
 try{window.localStorage.setItem('minto.settings.page',button.dataset.settingsPage);}catch{}
};
try{const page=window.localStorage.getItem('minto.settings.page');for(const button of document.querySelectorAll('[data-settings-page]'))if(button.dataset.settingsPage===page)button.onclick();}catch{}
element('ui-theme').onchange=()=>{markDirty();if(state)window.MintoAppearance.apply(document,{...state.settings.ui,theme:element('ui-theme').value});};
