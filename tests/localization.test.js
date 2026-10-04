'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SettingsStore}=require('../services/settings-store');
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
test('primary multimodal setting is explicit, persists and has translated optional backup controls',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-multimodal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new SettingsStore(root,secure);assert.equal(store.value.llm.multimodal,false);store.update({llm:{multimodal:true}});assert.equal(new SettingsStore(root,secure).value.llm.multimodal,true);
 assert.throws(()=>store.update({llm:{multimodal:'true'}}));
 const i18n=require('../i18n');for(const source of ['主模型','主模型支持图片等多模态输入','备用视觉模型（可选）'])for(const language of ['ja','en'])assert.notEqual(i18n.translate(language,source),source);
 const html=fs.readFileSync(path.join(__dirname,'../renderer/settings.html'),'utf8');assert.ok(html.includes('id="llm-multimodal"'));assert.ok(html.includes('<details>'));
});
test('startup, typography and region controls and errors are translated into all three UI languages',()=>{
 const i18n=require('../i18n');for(const text of ['界面与启动','登录 Windows 时自动启动','字体名称','字号','观察范围','整个屏幕','框选区域','鼠标框选','拖动鼠标框选，松开保存；Esc 或右键取消','观察区域无效，请重新框选','字体名称无效','字号须在 10 到 28 之间','开机自启仅支持打包后的应用'])for(const language of ['ja','en'])assert.notEqual(i18n.translate(language,text),text,text);
});
test('UI language defaults to Chinese, persists independently, and rejects undeclared locale values',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-language-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new SettingsStore(root,secure);assert.equal(store.public().ui?.language,'zh-CN');
 store.update({llm:{model:'Exact_Model'},ui:{language:'ja'}});
 const reopened=new SettingsStore(root,secure);assert.equal(reopened.public().ui.language,'ja');assert.equal(reopened.value.llm.model,'Exact_Model');
 reopened.update({ui:{language:'en'}});assert.equal(new SettingsStore(root,secure).public().ui.language,'en');
 assert.throws(()=>reopened.update({ui:{language:'EN'}}));assert.throws(()=>reopened.update({ui:{language:'zh'}}));
});
test('existing version 1 settings without UI language retain provider fields',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-language-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({version:1,llm:{model:'Existing_Model'}}));
 const store=new SettingsStore(root,secure);assert.equal(store.public().ui?.language,'zh-CN');assert.equal(store.value.llm.model,'Existing_Model');
});
test('translation catalogs have identical keys, deterministic fallback, and preserve technical identifiers',()=>{
 let i18n={};try{i18n=require('../i18n');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
 assert.equal(typeof i18n.translate,'function');
 const keys=Object.keys(i18n.catalogs['zh-CN']).sort();assert.ok(keys.length>100);
 for(const language of ['ja','en'])assert.deepEqual(Object.keys(i18n.catalogs[language]).sort(),keys);
 assert.equal(i18n.translate('en','保存设置'),'Save settings');assert.equal(i18n.translate('ja','保存设置'),'設定を保存');
 assert.equal(i18n.translate('invalid','保存设置'),'保存设置');assert.equal(i18n.translate('en','Exact_Model'),'Exact_Model');
 for(const [source,zh]of [['中止しました。','已停止。'],['画面を観察できませんでした。','无法观察屏幕。'],['接続できませんでした。設定を確認してください。','连接失败，请检查设置。'],['会話の要約を更新できませんでした。','无法更新对话摘要。'],['音声を再生できませんでした。','无法播放语音。'],['ミントを読み込めませんでした。設定を確認してください。','无法加载ミント，请检查设置。']]){assert.equal(i18n.translate('zh-CN',source),zh);assert.equal(i18n.translate('ja',source),source);assert.notEqual(i18n.translate('en',source),source);}
 assert.equal(i18n.localizeError('en',"Error invoking remote method 'minto:chat': Error: 请先配置对话服务"),"Error invoking remote method 'minto:chat': Error: Configure the conversation service first");
 assert.equal(i18n.localizeError('ja','Selected voice model is not loaded'),'選択した音声モデルが読み込まれていません');
 assert.equal(i18n.localizeError('ja',i18n.localizeError('en','语音合成 HTTP 503')),'音声合成 HTTP 503');
 assert.equal(i18n.localizeError('ja',i18n.localizeError('en','无法启动本地语音：Example OS error')),'ローカル音声を起動できません：Example OS error');
 assert.equal(i18n.localizeError('ja','Runtime status: Speech synthesis HTTP 503'),'実行状態：音声合成 HTTP 503');
 assert.equal(i18n.localizeError('ja','Voice service connected\nLoaded models: 0'),'音声サービスに接続しました\n読み込み済みモデル：0');
 assert.equal(i18n.localizeError('ja','Runtime status: Selected voice model is not loaded'),'実行状態：選択した音声モデルが読み込まれていません');
 assert.equal(i18n.localizeError('ja','Loaded models: Custom_Speech synthesis HTTP 503'),'読み込み済みモデル：Custom_Speech synthesis HTTP 503');
 assert.equal(i18n.localizeError('ja','Could not start local voice: Speech synthesis HTTP 503'),'ローカル音声を起動できません：Speech synthesis HTTP 503');
});
