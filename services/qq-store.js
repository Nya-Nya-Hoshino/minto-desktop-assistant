'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const DEFAULT_POLICY = Object.freeze({enabled:false,voice:false,meme_probability:0.08,cooldown_seconds:15,followup_seconds:60,keywords:['薄荷','ミント']});
function checkedPolicy(input, previous=DEFAULT_POLICY) {
  if (!input || Array.isArray(input) || typeof input!=='object') throw new Error('QQ 会话设置无效');
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_POLICY,key)) throw new Error('未知 QQ 会话设置');
  const next={...previous,...input};
  if (typeof next.enabled!=='boolean'||typeof next.voice!=='boolean'||!Number.isFinite(next.meme_probability)||next.meme_probability<0||next.meme_probability>1||!Number.isInteger(next.cooldown_seconds)||next.cooldown_seconds<0||next.cooldown_seconds>3600||!Number.isInteger(next.followup_seconds)||next.followup_seconds<0||next.followup_seconds>600||!Array.isArray(next.keywords)||next.keywords.length>20||next.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>40)) throw new Error('QQ 会话设置超出范围');
  return structuredClone(next);
}
class QQStore {
  constructor(root) {
    const {DatabaseSync}=require('node:sqlite');
    fs.mkdirSync(root,{recursive:true});
    this.db=new DatabaseSync(path.join(root,'qq-memory.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,persona TEXT NOT NULL,bot_id TEXT NOT NULL,kind TEXT NOT NULL,peer_id TEXT NOT NULL,name TEXT NOT NULL,
        policy TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',cursor INTEGER NOT NULL DEFAULT 0,
        memory_floor INTEGER NOT NULL DEFAULT 0,memory_cutoff_at INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,summary_at INTEGER NOT NULL DEFAULT 0,
        last_spoken INTEGER NOT NULL DEFAULT 0,last_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE(persona,bot_id,kind,peer_id));
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES sessions(id),remote_id TEXT,user_id TEXT NOT NULL,
        text TEXT NOT NULL,segments TEXT NOT NULL DEFAULT '[]',is_control INTEGER NOT NULL DEFAULT 0,direction TEXT NOT NULL,at INTEGER NOT NULL,status TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT '',reply_to TEXT,error TEXT NOT NULL DEFAULT '',
        UNIQUE(session_id,remote_id,direction));
      CREATE INDEX IF NOT EXISTS message_scope ON messages(session_id,id);
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),message_row INTEGER NOT NULL,payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',lease_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS catalog (bot_id TEXT PRIMARY KEY,nickname TEXT NOT NULL,last_seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),bytes BLOB NOT NULL,created_at INTEGER NOT NULL);`);
    if(!this.db.prepare('PRAGMA table_info(messages)').all().some(column=>column.name==='is_control'))this.db.exec('ALTER TABLE messages ADD COLUMN is_control INTEGER NOT NULL DEFAULT 0');
    if(!this.db.prepare('PRAGMA table_info(sessions)').all().some(column=>column.name==='memory_cutoff_at')){
      this.transaction(()=>{
        this.db.exec('ALTER TABLE sessions ADD COLUMN memory_cutoff_at INTEGER NOT NULL DEFAULT 0');
        // Older files only recorded a row cutoff. Preserve its known source-time boundary.
        this.db.exec('UPDATE sessions SET memory_cutoff_at=COALESCE((SELECT MAX(at) FROM messages WHERE session_id=sessions.id AND id<=sessions.memory_floor),0) WHERE memory_floor>0');
      });
    }
    // Crash recovery never repeats an LLM request blindly. Its received message remains available in history.
    this.db.prepare("UPDATE messages SET status='cancelled',error='上次处理被中断' WHERE status='generating'").run();
  }
  close(){this.db.close();}
  transaction(callback){this.db.exec('BEGIN IMMEDIATE');try{const value=callback();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  session(persona,bot,kind,peer,name) {
    if(!['group','private'].includes(kind))throw new Error('QQ 会话类型无效');
    persona=String(persona);bot=String(bot);peer=String(peer);
    const id=createHash('sha256').update(JSON.stringify([persona,bot,kind,peer])).digest('hex');
    this.db.prepare('INSERT INTO sessions(id,persona,bot_id,kind,peer_id,name,policy) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.name=excluded.peer_id THEN sessions.name ELSE excluded.name END').run(id,persona,bot,kind,peer,String(name||peer).slice(0,120),JSON.stringify({...DEFAULT_POLICY,enabled:kind==='private'}));
    return this.get(id);
  }
  get(id){const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);if(!row)throw new Error('QQ 会话不存在');return {...row,policy:JSON.parse(row.policy)};}
  list(persona,bot){return this.db.prepare('SELECT * FROM sessions WHERE persona=? AND bot_id=? ORDER BY last_at DESC,name').all(persona,bot).map(row=>({id:row.id,kind:row.kind,peer_id:row.peer_id,name:row.name,...JSON.parse(row.policy),last_at:row.last_at,last_text:this.db.prepare("SELECT text FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 1").get(row.id)?.text.slice(0,100)||''}));}
  policy(id,input){const policy=checkedPolicy(input,this.get(id).policy);this.db.prepare('UPDATE sessions SET policy=? WHERE id=?').run(JSON.stringify(policy),id);return policy;}
  snapshot(persona,body,now=Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {this.db.prepare('INSERT INTO catalog VALUES(?,?,?) ON CONFLICT(bot_id) DO UPDATE SET nickname=excluded.nickname,last_seen=excluded.last_seen').run(body.bot_id,body.nickname,now);
      for(const group of body.groups)this.session(persona,body.bot_id,'group',group.group_id,group.group_name);
      for(const friend of body.friends)this.session(persona,body.bot_id,'private',friend.user_id,friend.remark||friend.nickname);
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  heartbeat(bot,now=Date.now()){return this.db.prepare('SELECT * FROM catalog WHERE bot_id=?').get(bot)||{last_seen:0};}
  receive(id,message){return this._receive(id,message,false);}
  receiveHistory(id,message){return this._receive(id,message,true);}
  _receive(id,message,history) {
    if(history&&(!Number.isSafeInteger(message.at)||message.at<0))throw new Error('QQ 历史消息时间无效');
    return this.transaction(()=>{const s=this.get(id);
      if(history&&s.memory_cutoff_at&&message.at<=s.memory_cutoff_at)return {duplicate:false,id:null,ignored:true,reason:'memory_cutoff'};
      const result=this.db.prepare("INSERT OR IGNORE INTO messages(session_id,remote_id,user_id,text,segments,direction,at,status,reply_to) VALUES(?,?,?,?,?,'in',?,'received',?)").run(id,message.remote_id,message.user_id,message.text,JSON.stringify(message.segments||[]),message.at,message.reply_to||null);
      if(result.changes)this.db.prepare('UPDATE sessions SET last_at=MAX(last_at,?) WHERE id=?').run(message.at,id);
      const row=result.changes?Number(result.lastInsertRowid):Number(this.db.prepare("SELECT id FROM messages WHERE session_id=? AND remote_id=? AND direction='in'").get(id,message.remote_id).id);
      return {duplicate:!result.changes,id:row};});
  }
  mark(row,status,trigger='',error=''){this.db.prepare('UPDATE messages SET status=?,trigger=?,error=? WHERE id=?').run(status,trigger,String(error).slice(0,1000),row);}
  lastMessageId(id){return Number(this.db.prepare('SELECT MAX(id) AS last FROM messages WHERE session_id=?').get(id)?.last||0);}
  pendingSummary(id,limit=160){const s=this.get(id);return this.db.prepare("SELECT * FROM messages WHERE session_id=? AND id>? AND id>? AND (?=0 OR at>?) AND (direction='in' OR status='sent') AND status!='cancelled' AND is_control=0 ORDER BY id LIMIT ?").all(id,s.cursor,s.memory_floor,s.memory_cutoff_at,s.memory_cutoff_at,limit).map(row=>({...row,segments:JSON.parse(row.segments)}));}
  commitSummary(id,{cursor,summary,revision},now=Date.now()) {if(typeof summary==='string'&&!summary.trim())return false;if(typeof summary!=='string'||summary.length>6000)throw new Error('QQ 记忆摘要过长');return this.db.prepare('UPDATE sessions SET summary=?,cursor=?,summary_at=? WHERE id=? AND revision=? AND cursor<? AND memory_floor<?').run(summary,cursor,now,id,revision,cursor,cursor).changes>0;}
  advanceSummaryCursor(id,{cursor,revision},now=Date.now()) {
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(revision)||revision<0)throw new Error('QQ 记忆游标无效');
    return this.db.prepare('UPDATE sessions SET cursor=?,summary_at=? WHERE id=? AND revision=? AND cursor<? AND memory_floor<?').run(cursor,now,id,revision,cursor,cursor).changes>0;
  }
  editMemory(id,text,forget=false,now=Date.now()) {
    if(typeof text!=='string'||text.length>6000)throw new Error('QQ 记忆修正须在 6000 字以内');this.get(id);
    if(forget){if(!Number.isSafeInteger(now)||now<=0)throw new Error('QQ 记忆截止时间无效');this.transaction(()=>{const floor=this.lastMessageId(id);this.db.prepare("UPDATE sessions SET notes=?,summary='',memory_floor=?,memory_cutoff_at=MAX(memory_cutoff_at,?),cursor=?,summary_at=0,revision=revision+1 WHERE id=?").run(text,floor,now,floor,id);});}
    else this.db.prepare('UPDATE sessions SET notes=?,revision=revision+1 WHERE id=?').run(text,id);
    return this.conversation(id);
  }
  context(id,query='',maxChars=16000) {
    const s=this.get(id);maxChars=Math.max(200,Math.min(24000,maxChars));
    const recent=this.db.prepare("SELECT * FROM messages WHERE session_id=? AND id>? AND (?=0 OR at>?) AND (direction='in' OR status='sent') AND status!='cancelled' AND is_control=0 ORDER BY id DESC LIMIT 60").all(id,s.memory_floor,s.memory_cutoff_at,s.memory_cutoff_at).reverse();
    const notes=s.notes.slice(0,Math.min(6000,Math.floor(maxChars*.5))),summary=s.summary.slice(0,Math.min(6000,Math.floor(maxChars*.25)));
    let output='主人明确修正（优先）：\n'+notes+'\n本会话记忆摘要：\n'+summary+'\n近期真实消息：\n';
    const budget=Math.floor((maxChars-output.length)*.75);let chosen=[],size=0;
    for(const row of [...recent].reverse()){const line=`[${row.remote_id||row.id}] ${new Date(row.at).toISOString()} ${row.direction==='out'?'ミント':row.user_id}${row.reply_to?' 回复 '+row.reply_to:''}: ${row.text}`;const remaining=budget-size;if(remaining<=0)break;chosen.unshift(line.slice(0,remaining));size+=Math.min(line.length,remaining)+1;}
    output+=chosen.join('\n')+'\n本会话相关原文：\n';
    const terms=[...new Set(String(query).match(/[\p{Script=Han}]{2,8}|[A-Za-z0-9_]{3,}/gu)||[])].slice(0,5);
    const older=terms.length?this.db.prepare("SELECT remote_id,user_id,text FROM messages WHERE session_id=? AND id>? AND (?=0 OR at>?) AND (direction='in' OR status='sent') AND status!='cancelled' AND is_control=0 AND ("+terms.map(()=> 'instr(text,?)>0').join(' OR ')+') ORDER BY id DESC LIMIT 4').all(id,s.memory_floor,s.memory_cutoff_at,s.memory_cutoff_at,...terms):[];
    for(const row of older){const remaining=maxChars-output.length;if(remaining<=0)break;output+=`[${row.remote_id}] ${row.user_id}: ${row.text}\n`.slice(0,remaining);}
    return output;
  }
  desktopIndex(persona,bot,maxChars=5000){const rows=this.db.prepare("SELECT name,kind,peer_id,summary,notes,summary_at FROM sessions WHERE persona=? AND bot_id=? AND kind='group' AND (summary!='' OR notes!='') ORDER BY summary_at DESC LIMIT 12").all(persona,bot);return rows.map(row=>`[QQ ${row.kind} ${row.name} (${row.peer_id})]\n${row.notes}\n${row.summary}`).join('\n\n').slice(0,maxChars);}
  queue(id,action,now=Date.now()) {
    const s=this.get(id),key=randomUUID(),text=action.text|| (action.media_id?'[日语语音]':action.kind==='delete'?'[撤回请求]':'[刷新账号]');
    return this.transaction(()=>{const row=this.db.prepare("INSERT INTO messages(session_id,user_id,text,direction,at,status,trigger,reply_to,is_control) VALUES(?,?,?,'out',?,'queued',?,?,?)").run(id,s.bot_id,text,now,action.trigger||'',action.reply_to||null,action.kind==='send'&&action.text?0:1);
      const payload={id:key,kind:action.kind,message_type:s.kind,peer_id:s.peer_id,...(action.text?{text:action.text}:{}),...(action.reply_to?{reply_to:action.reply_to}:{}),...(action.media_id?{media_id:action.media_id}:{}),...(action.message_id?{message_id:action.message_id}:{})};
      this.db.prepare('INSERT INTO outbox(id,session_id,message_row,payload,created_at) VALUES(?,?,?,?,?)').run(key,id,Number(row.lastInsertRowid),JSON.stringify(payload),now);return payload;});
  }
  claim(persona,bot,now=Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');try{const rows=this.db.prepare("SELECT o.* FROM outbox o JOIN sessions s ON s.id=o.session_id WHERE s.persona=? AND s.bot_id=? AND (o.status='queued' OR (o.status='leased' AND o.lease_until<?)) ORDER BY o.created_at LIMIT 10").all(persona,bot,now);for(const row of rows)this.db.prepare("UPDATE outbox SET status='leased',lease_until=? WHERE id=?").run(now+120000,row.id);this.db.exec('COMMIT');return rows.map(row=>JSON.parse(row.payload));}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  ack(id,ok,remote,error='',now=Date.now(),scope) {
    return this.transaction(()=>{const row=this.db.prepare('SELECT o.*,s.persona AS scope_persona,s.bot_id AS scope_bot_id FROM outbox o JOIN sessions s ON s.id=o.session_id WHERE o.id=?').get(id);if(!row)throw new Error('QQ 发送记录不存在');
      if(scope!==undefined&&(!scope||scope.persona!==row.scope_persona||scope.bot_id!==row.scope_bot_id))throw new Error('QQ 回执不属于当前绑定');
      if(!['queued','leased'].includes(row.status))return {changed:false};
      const status=ok?'sent':'failed';this.db.prepare('UPDATE outbox SET status=? WHERE id=?').run(status,id);this.db.prepare('UPDATE messages SET status=?,remote_id=?,error=? WHERE id=?').run(status,remote||null,String(error||'').slice(0,1000),row.message_row);
      if(ok){const action=JSON.parse(row.payload);if(action.kind==='send'&&action.text)this.db.prepare('UPDATE sessions SET last_spoken=? WHERE id=?').run(now,row.session_id);if(action.kind==='delete')this.recall(row.session_id,action.message_id);}return {changed:true,session_id:row.session_id};});
  }
  recall(id,remote){this.db.prepare("UPDATE messages SET status='cancelled',text='[消息已撤回]',segments='[]' WHERE session_id=? AND remote_id=?").run(id,remote);this.db.prepare("UPDATE sessions SET summary='',cursor=memory_floor,summary_at=0,revision=revision+1 WHERE id=?").run(id);}
  cancelSessionPending(id){this.transaction(()=>{this.db.prepare("UPDATE messages SET status='cancelled' WHERE session_id=? AND status IN ('queued','generating')").run(id);this.db.prepare("UPDATE outbox SET status='cancelled' WHERE session_id=? AND status IN ('queued','leased')").run(id);});}
  cancelPending(persona,bot){this.transaction(()=>{this.db.prepare("UPDATE messages SET status='cancelled' WHERE id IN (SELECT o.message_row FROM outbox o JOIN sessions s ON s.id=o.session_id WHERE s.persona=? AND s.bot_id=? AND o.status IN ('queued','leased'))").run(persona,bot);this.db.prepare("UPDATE outbox SET status='cancelled' WHERE session_id IN (SELECT id FROM sessions WHERE persona=? AND bot_id=?) AND status IN ('queued','leased')").run(persona,bot);});}
  putMedia(id,bytes){if(!Buffer.isBuffer(bytes)||bytes.length>10*1024*1024)throw new Error('QQ 语音文件过大');const media=randomUUID();this.db.prepare('INSERT INTO media VALUES(?,?,?,?)').run(media,id,bytes,Date.now());return media;}
  media(id,persona,bot){return this.db.prepare('SELECT m.bytes FROM media m JOIN sessions s ON s.id=m.session_id WHERE m.id=? AND s.persona=? AND s.bot_id=?').get(id,persona,bot)?.bytes;}
  expireMedia(now=Date.now()){this.db.prepare('DELETE FROM media WHERE created_at<?').run(now-86400000);}
  conversation(id){const s=this.get(id);return {session:s,messages:this.db.prepare('SELECT id,remote_id,user_id,text,direction,at,status,trigger,reply_to,error FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 150').all(id).reverse(),memory:{summary:s.summary,notes:s.notes,updated_at:s.summary_at,cursor:s.cursor}};}
}
module.exports={QQStore,DEFAULT_POLICY,checkedPolicy};
