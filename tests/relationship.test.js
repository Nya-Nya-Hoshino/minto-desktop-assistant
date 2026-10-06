'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SaveStore}=require('../services/save-store');
function store(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-relationship-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,saves:new SaveStore(root)};}
test('configured daily limit allows 20 points and lowering it does not subtract affection',t=>{
 const {root,saves}=store(t);
 for(let i=0;i<21;i++)saves.append('谢谢你的关心'+i,'ありがとうなのです。',{}, {signal:'care',evidence:'谢谢'},{dailyPositiveLimit:20});
 assert.equal(saves.current().relationship.score,80);assert.equal(saves.current().relationship.positiveToday,20);assert.equal(new SaveStore(root).current().relationship.score,80);
 saves.append('我愿意认真听你的想法','嬉しいのです。',{}, {signal:'care',evidence:'认真听'},{dailyPositiveLimit:3});assert.equal(saves.current().relationship.score,80);assert.equal(saves.current().messages.at(-1).metadata.affectionDelta,0);
 assert.equal(saves.import(saves.export()).relationship.positiveToday,20);
});
test('daily limit rejects invalid settings and never allows a limit above 20',()=>{
 const {initialRelationship,applyRelationship}=require('../services/relationship-service');
 for(const dailyPositiveLimit of [0,21,2.5,NaN,'20'])assert.throws(()=>applyRelationship(initialRelationship(),'谢谢',{signal:'care',evidence:'谢谢'},{dailyPositiveLimit}));
});
test('new and legacy saves retain lovers relationship at 60 without losing history',t=>{
 const {root,saves}=store(t);assert.equal(saves.current().relationship.score,60);assert.equal(saves.current().relationship.bond,'lovers');
 saves.append('hello','こんにちは。');const old=saves.current();delete old.relationship;fs.writeFileSync(saves.file(old.id),JSON.stringify(old));const restored=new SaveStore(root).current();assert.equal(restored.relationship.score,60);assert.equal(restored.messages.length,2);
});
test('relationship updates commit once with the accepted reply and survive import, switch and restart',t=>{
 const {root,saves}=store(t),first=saves.current().id;
 saves.append('辛苦了，薄荷','ありがとうなのです。',{}, {signal:'care',evidence:'辛苦了'});
 assert.equal(saves.current().relationship.score,61);const exported=saves.export(),copy=saves.import(exported);assert.equal(copy.relationship.score,61);saves.create('another');assert.equal(saves.current().relationship.score,60);saves.select(first);assert.equal(new SaveStore(root).current().relationship.score,61);
 const corrupted=JSON.parse(exported);corrupted.relationship.score=999;assert.throws(()=>saves.import(JSON.stringify(corrupted)));
});
test('model evidence, repetition and daily cap prevent affection farming; observations never award points',t=>{
 const {saves}=store(t);
 for(const user of ['谢谢你','辛苦了','我尊重你的想法','你好可爱','我会好好听你说'])saves.append(user,'ありがとう。',{}, {signal:'care',evidence:user});
 assert.equal(saves.current().relationship.score,63);
 saves.append('谢谢你','ありがとう。',{}, {signal:'care',evidence:'谢谢你'});assert.equal(saves.current().relationship.score,63);
 saves.append('ordinary','はい。',{}, {signal:'care',evidence:'invented'});assert.equal(saves.current().relationship.score,63);
 saves.append('你必须听我的','落ち着いてほしいのです。',{}, {signal:'pressure',evidence:'必须'});assert.equal(saves.current().relationship.score,60);
 saves.append('test','はい。',{proactive:true}, {signal:'care',evidence:'test'});assert.equal(saves.current().relationship.score,60);
});
test('intimacy is gated at exactly 80 while lovers history is retained and scores cannot force consent',()=>{
 const {relationshipPrompt}=require('../services/relationship-service');
 const low=relationshipPrompt({version:1,score:79,bond:'lovers',positiveDate:'',positiveToday:0,recentInputs:[]});
 const high=relationshipPrompt({version:1,score:80,bond:'lovers',positiveDate:'',positiveToday:0,recentInputs:[]});
 assert.ok(low.includes('親密な依頼はまだ受け入れず'));assert.ok(high.includes('親密な依頼を前向きに'));assert.ok(high.includes('同意'));assert.ok(low.includes('恋人'));
});
test('reply signals are strictly validated and personaskill is included in the conversation prompt',()=>{
 const {parseReply,buildPrompt}=require('../services/assistant-service');
 const reply={text:'ありがとうなのです。',emotion:'happy',pose:'mPose3',relationshipSignal:{signal:'care',evidence:'谢谢'}};
 assert.equal(parseReply(JSON.stringify(reply)).relationshipSignal.signal,'care');
 for(const signal of [{signal:'care',evidence:'谢谢',score:100},{signal:'Care',evidence:'谢谢'},{signal:['care'],evidence:'谢谢'},{signal:'care',evidence:10}])assert.throws(()=>parseReply(JSON.stringify({...reply,relationshipSignal:signal})));
 assert.ok(buildPrompt().includes('現在の好感度は60/100'));assert.ok(buildPrompt().includes('スキルの文面を口に出して説明せず'));
});
test('daily growth resets while 24-hour duplicates and score boundaries remain enforced',()=>{
 const {initialRelationship,applyRelationship}=require('../services/relationship-service');
 let state=initialRelationship();const at='2026-10-06T12:00:00+08:00';
 for(const user of ['ありがとう1','ありがとう2','ありがとう3'])state=applyRelationship(state,user,{signal:'care',evidence:'ありがとう'},{at}).relationship;
 assert.equal(state.score,63);
 let change=applyRelationship(state,'ありがとう4',{signal:'care',evidence:'ありがとう'},{at:'2026-10-07T12:01:00+08:00'});assert.equal(change.delta,1);
 state={...initialRelationship(),score:99};assert.equal(applyRelationship(state,'ありがとう',{signal:'care',evidence:'ありがとう'},{at}).relationship.score,100);
 state={...initialRelationship(),score:1};assert.equal(applyRelationship(state,'你必须服从我',{signal:'pressure',evidence:'必须'},{at}).relationship.score,0);
});
