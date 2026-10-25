'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQStore}=require('../services/qq-store');
function store(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-qq-'));const db=new QQStore(root);t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});return db;}
function session(db,peer='10001',persona='SaveOne'){return db.session(persona,'20000','group',peer,'测试群');}
function message(db,s,id,text='喜欢红茶'){return db.receive(s.id,{remote_id:id,user_id:'2992576898',text,segments:[],at:Date.now(),reply_to:null});}
test('memory and exact-user search never cross groups, bots or bound saves',t=>{const db=store(t),a=session(db),b=session(db,'10002'),c=session(db,'10001','SaveTwo');message(db,a,'1','A群的暗号是红茶');message(db,b,'1','B群的暗号是咖啡');message(db,c,'1','另一存档的暗号');db.commitSummary(a.id,{cursor:db.lastMessageId(a.id),summary:'红茶',revision:0});assert.equal(db.conversation(b.id).memory.summary,'');assert.ok(!db.context(b.id,'暗号').includes('红茶'));assert.ok(!db.context(a.id,'暗号').includes('咖啡'));assert.ok(!db.context(c.id,'暗号').includes('红茶'));});
test('incoming replay is idempotent and new groups remain disabled',t=>{const db=store(t),s=session(db);assert.equal(s.policy.enabled,false);assert.equal(message(db,s,'Exact').duplicate,false);assert.equal(message(db,s,'Exact').duplicate,true);assert.equal(db.conversation(s.id).messages.length,1);});
test('forget establishes a scope-local cutoff and rejects stale summary commits',t=>{const db=store(t),a=session(db),b=session(db,'10002');message(db,a,'1','过去的秘密');message(db,b,'1','另一个群');const cursor=db.lastMessageId(a.id);db.editMemory(a.id,'新的纠正',true);assert.equal(db.commitSummary(a.id,{cursor,summary:'过去的秘密',revision:0}),false);assert.ok(!db.context(a.id,'秘密').includes('过去的秘密'));assert.ok(db.context(b.id,'另一个群').includes('另一个群'));db.receive(a.id,{remote_id:'2',user_id:'2992576898',text:'新消息',segments:[],at:db.get(a.id).memory_cutoff_at+1});assert.ok(db.context(a.id,'新消息').includes('新消息'));});
test('outbox leases, ACKs and failures do not silently resend delivered messages',t=>{const db=store(t),s=session(db);const action=db.queue(s.id,{kind:'send',text:'你好',trigger:'manual'});assert.equal(db.claim('SaveOne','20000',1000).length,1);assert.equal(db.claim('SaveOne','20000',1001).length,0);assert.equal(db.ack(action.id,true,'SentExact',undefined,2000).changed,true);assert.equal(db.ack(action.id,true,'SentExact').changed,false);assert.equal(db.claim('SaveOne','20000',999999).length,0);const failed=db.queue(s.id,{kind:'send',text:'失败',trigger:'manual'});db.claim('SaveOne','20000',10000);db.ack(failed.id,false,undefined,'Exact failure');assert.equal(db.claim('SaveOne','20000',9999999).length,0);assert.equal(db.conversation(s.id).messages.at(-1).status,'failed');});
test('context reserves pinned notes and retains delivered commitments across compression',t=>{const db=store(t),s=session(db);db.editMemory(s.id,'PINNED_CORRECTION');message(db,s,'x','KEYWORD '.repeat(1000));assert.ok(db.context(s.id,'KEYWORD',1000).includes('PINNED_CORRECTION'));const action=db.queue(s.id,{kind:'send',text:'PROMISE_EXACT',trigger:'mention'});db.ack(action.id,true,'promise');for(let i=0;i<70;i++)message(db,s,String(i),'普通消息');assert.ok(db.pendingSummary(s.id).some(m=>m.text==='PROMISE_EXACT'));assert.ok(db.context(s.id,'PROMISE_EXACT').includes('PROMISE_EXACT'));});
test('queue and cancellation roll back all writes on injected database faults',t=>{const db=store(t),s=session(db);db.db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'fault'); END;");assert.throws(()=>db.queue(s.id,{kind:'send',text:'never'}));assert.equal(db.conversation(s.id).messages.length,0);db.db.exec('DROP TRIGGER fail_queue');const a=db.queue(s.id,{kind:'send',text:'pending'});db.db.exec("CREATE TRIGGER fail_cancel BEFORE UPDATE ON outbox WHEN NEW.status='cancelled' BEGIN SELECT RAISE(ABORT,'fault'); END;");assert.throws(()=>db.cancelPending('SaveOne','20000'));assert.equal(db.conversation(s.id).messages.at(-1).status,'queued');assert.equal(db.claim('SaveOne','20000')[0].id,a.id);});
test('replay identifies the original row and blank summaries preserve previous state',t=>{const db=store(t),a=session(db),b=session(db,'10002');const original=message(db,a,'1');message(db,b,'2');assert.equal(message(db,a,'1').id,original.id);db.commitSummary(a.id,{cursor:original.id,summary:'非空摘要',revision:0});message(db,a,'3');assert.equal(db.commitSummary(a.id,{cursor:db.lastMessageId(a.id),summary:'',revision:0}),false);assert.equal(db.conversation(a.id).memory.summary,'非空摘要');});

test('empty-session forget persists a timestamp cutoff and rejects older imported history after reopening',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-qq-cutoff-'));let db=new QQStore(root);t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const s=session(db);assert.equal(db.get(s.id).memory_cutoff_at,0);db.editMemory(s.id,'Pinned',true,10000);assert.equal(db.lastMessageId(s.id),0);db.close();db=new QQStore(root);assert.equal(db.get(s.id).memory_cutoff_at,10000);
 const history=at=>({remote_id:String(at),user_id:'2992576898',text:'HISTORY_'+at,segments:[],at,reply_to:null});
 for(const at of [9999,10000])assert.deepEqual(db.receiveHistory(s.id,history(at)),{duplicate:false,id:null,ignored:true,reason:'memory_cutoff'});
 assert.equal(db.conversation(s.id).messages.length,0);assert.equal(db.receiveHistory(s.id,history(10001)).duplicate,false);assert.ok(db.context(s.id,'HISTORY').includes('HISTORY_10001'));assert.deepEqual(db.pendingSummary(s.id).map(row=>row.text),['HISTORY_10001']);assert.equal(db.get(s.id).notes,'Pinned');
});
test('timestamp cutoff excludes delayed originals from memory without crossing bots',t=>{
 const db=store(t),a=session(db),b=db.session('SaveOne','30000','group','10001','Other bot');
 const receive=(s,remote,text,at)=>db.receive(s.id,{remote_id:remote,user_id:'2992576898',text,segments:[],at});
 receive(a,'1','OLD_A',1);receive(b,'1','ONLY_B',1);db.editMemory(a.id,'',true,10000);receive(a,'2','DELAYED_OLD',2);receive(a,'3','FRESH_A',10001);
 assert.ok(!db.context(a.id,'DELAYED_OLD').includes('DELAYED_OLD'));assert.deepEqual(db.pendingSummary(a.id).map(row=>row.text),['FRESH_A']);assert.ok(!db.context(a.id,'ONLY_B').includes('ONLY_B'));assert.ok(db.context(b.id,'ONLY_B').includes('ONLY_B'));assert.equal(db.get(b.id).memory_cutoff_at,0);
 const media=db.putMedia(a.id,Buffer.from('scope-only'));assert.equal(db.media(media,'SaveOne','30000'),undefined);assert.equal(Buffer.from(db.media(media,'SaveOne','20000')).toString(),'scope-only');const action=db.queue(a.id,{kind:'send',text:'Only A'});assert.equal(db.claim('SaveOne','30000').length,0);assert.equal(db.claim('SaveOne','20000')[0].id,action.id);
});
test('empty-fact checkpoints advance the cursor while retaining summary and pinned notes',t=>{
 const db=store(t),s=session(db);const first=message(db,s,'1');assert.equal(db.commitSummary(s.id,{cursor:first.id,summary:'Existing summary',revision:0}),true);db.editMemory(s.id,'Pinned');const second=message(db,s,'2','No new facts');const revision=db.get(s.id).revision;
 assert.equal(db.advanceSummaryCursor(s.id,{cursor:second.id,revision},20000),true);assert.equal(db.get(s.id).summary,'Existing summary');assert.equal(db.get(s.id).notes,'Pinned');assert.equal(db.get(s.id).cursor,second.id);assert.equal(db.get(s.id).summary_at,20000);assert.deepEqual(db.pendingSummary(s.id),[]);assert.equal(db.advanceSummaryCursor(s.id,{cursor:second.id,revision},21000),false);
 message(db,s,'3');const third=db.lastMessageId(s.id);db.editMemory(s.id,'Pinned',true,30000);assert.equal(db.advanceSummaryCursor(s.id,{cursor:third,revision},31000),false);assert.equal(db.get(s.id).summary,'');
});
test('new private sessions start enabled and explicit disabling survives catalog refresh',t=>{
 const db=store(t),privateSession=db.session('SaveOne','20000','private','2992576898','Owner');assert.equal(privateSession.policy.enabled,true);assert.equal(session(db).policy.enabled,false);db.policy(privateSession.id,{enabled:false});db.snapshot('SaveOne',{bot_id:'20000',nickname:'Bot',groups:[],friends:[{user_id:'2992576898',nickname:'Owner',remark:''}]});assert.equal(db.get(privateSession.id).policy.enabled,false);
});

test('desktop index contains only current bot group memory and excludes all private sessions',t=>{
 const db=store(t),group=session(db),otherBot=db.session('SaveOne','30000','group','10001','Other bot'),friend=db.session('SaveOne','20000','private','70000','Friend'),otherSave=db.session('SaveTwo','20000','group','10001','Other save');
 for(const [s,text]of [[group,'CURRENT_GROUP'],[otherBot,'OTHER_BOT'],[friend,'PRIVATE_SECRET'],[otherSave,'OTHER_SAVE']])db.editMemory(s.id,text);
 const index=db.desktopIndex('SaveOne','20000');assert.ok(index.includes('CURRENT_GROUP'));for(const text of ['OTHER_BOT','PRIVATE_SECRET','OTHER_SAVE'])assert.ok(!index.includes(text));assert.equal(db.desktopIndex('SaveOne','40000'),'');
});
test('scoped ACK rejects a different bot or persona without modifying delivery state',t=>{
 const db=store(t),s=session(db),action=db.queue(s.id,{kind:'send',text:'Pending'});
 for(const scope of [{persona:'SaveOne',bot_id:'30000'},{persona:'SaveTwo',bot_id:'20000'}])assert.throws(()=>db.ack(action.id,true,'900','',10000,scope),/QQ/);
 assert.equal(db.conversation(s.id).messages.at(-1).status,'queued');assert.equal(db.ack(action.id,true,'900','',10000,{persona:'SaveOne',bot_id:'20000'}).changed,true);assert.equal(db.conversation(s.id).messages.at(-1).status,'sent');assert.equal(db.ack(action.id,false,undefined,'Replay',10001,{persona:'SaveOne',bot_id:'20000'}).changed,false);
});

test('cutoff schema migration preserves existing data and known earlier row boundaries',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minto-qq-migration-'));let db=new QQStore(root);t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const s=session(db);db.receive(s.id,{remote_id:'1',user_id:'2992576898',text:'Earlier',segments:[],at:5000});db.editMemory(s.id,'Pinned migration',true,10000);db.db.exec('ALTER TABLE sessions DROP COLUMN memory_cutoff_at');db.close();db=new QQStore(root);
 assert.equal(db.get(s.id).memory_cutoff_at,5000);assert.equal(db.get(s.id).notes,'Pinned migration');assert.equal(db.conversation(s.id).messages[0].text,'Earlier');assert.equal(db.receiveHistory(s.id,{remote_id:'2',user_id:'2992576898',text:'Old unseen',segments:[],at:4000}).ignored,true);
});
test('old checkpoint revisions cannot advance past a later forget and cutoff never moves backward',t=>{
 const db=store(t),s=session(db);message(db,s,'1');const revision=db.get(s.id).revision;db.editMemory(s.id,'',true,10000);const fresh=db.receive(s.id,{remote_id:'2',user_id:'2992576898',text:'After forget',segments:[],at:10001});assert.equal(db.advanceSummaryCursor(s.id,{cursor:fresh.id,revision},11000),false);db.editMemory(s.id,'',true,9000);assert.equal(db.get(s.id).memory_cutoff_at,10000);
});
