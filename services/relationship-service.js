'use strict';
const {createHash}=require('node:crypto');
const SIGNALS=Object.freeze({neutral:0,care:1,repair:1,hostility:-1,pressure:-1});
function initialRelationship(){return {version:1,score:60,bond:'lovers',positiveDate:'',positiveToday:0,recentInputs:[]};}
function validateRelationship(value){
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='bond,positiveDate,positiveToday,recentInputs,score,version'||value.version!==1||value.bond!=='lovers'||!Number.isInteger(value.score)||value.score<0||value.score>100||!Number.isInteger(value.positiveToday)||value.positiveToday<0||value.positiveToday>20||typeof value.positiveDate!=='string'||!/^$|^\d{4}-\d{2}-\d{2}$/.test(value.positiveDate)||!Array.isArray(value.recentInputs)||value.recentInputs.length>200)throw new Error('好感存档数据损坏');
 for(const entry of value.recentInputs)if(!entry||Object.keys(entry).sort().join(',')!=='at,hash'||typeof entry.hash!=='string'||!/^([a-f0-9]{64})$/.test(entry.hash)||typeof entry.at!=='string'||!Number.isFinite(Date.parse(entry.at)))throw new Error('好感存档数据损坏');
 return structuredClone(value);
}
function validateSignal(value){
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='evidence,signal'||typeof value.signal!=='string'||!Object.hasOwn(SIGNALS,value.signal)||typeof value.evidence!=='string'||value.evidence.length>200)throw new Error('好感评估格式无效');
 return {signal:value.signal,evidence:value.evidence};
}
function relationshipStage(score){return score>=80?'亲密':score>=60?'温暖':score>=30?'谨慎':'需要修复';}
function applyRelationship(current,user,assessment,{proactive=false,at=new Date().toISOString(),dailyPositiveLimit=3}={}){
 if(!Number.isInteger(dailyPositiveLimit)||dailyPositiveLimit<1||dailyPositiveLimit>20)throw new Error('每日好感增长上限须为 1 到 20 的整数');const next=validateRelationship(current);if(proactive||!assessment)return {relationship:next,delta:0,signal:'neutral',reason:proactive?'自动搭话不改变好感':'普通交流不改变好感'};
 const checked=validateSignal(assessment),evidence=checked.evidence.trim();
 if(!evidence||!user.includes(evidence))return {relationship:next,delta:0,signal:'neutral',reason:'缺少可核对的原文依据'};
 if(SIGNALS[checked.signal]<0){const explicit=checked.signal==='hostility'?/(滚开|去死|废物|垃圾|讨厌你|死ね|消えろ|役立たず|hate you|shut up)/iu:/(必须|不许拒绝|不准拒绝|强迫|絶対.*従|拒否するな|無理やり|you must|obey me)/iu;if(!explicit.test(evidence))return {relationship:next,delta:0,signal:'neutral',reason:'未发现明确辱骂或施压',evidence};}
 const now=new Date(at),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const hash=createHash('sha256').update(user.normalize('NFKC').replace(/\s+/gu,'').trim()).digest('hex');
 next.recentInputs=next.recentInputs.filter(entry=>Date.parse(entry.at)>now.getTime()-86400000);
 if(next.recentInputs.some(entry=>entry.hash===hash))return {relationship:next,delta:0,signal:'neutral',reason:'24 小时内重复表达不计分'};
 next.recentInputs.push({hash,at});next.recentInputs=next.recentInputs.slice(-200);
 if(next.positiveDate!==today){next.positiveDate=today;next.positiveToday=0;}
 let delta=SIGNALS[checked.signal];if(delta>0){delta=Math.min(delta,Math.max(0,dailyPositiveLimit-next.positiveToday),100-next.score);next.positiveToday+=delta;}else delta=Math.max(delta,-next.score);
 next.score+=delta;const reasons={care:'关心与尊重',repair:'道歉与关系修复',hostility:'明确的辱骂',pressure:'明确的强迫或施压',neutral:'普通交流不改变好感'};return {relationship:next,delta,signal:checked.signal,evidence,reason:delta===0&&SIGNALS[checked.signal]>0?'已达到每日增长上限或满分':reasons[checked.signal]};
}
function relationshipPrompt(value=initialRelationship()){
 const state=validateRelationship(value);
 return `${state.score>=95?'好感度95以上：少し重い愛情、独占したい気持ち、守護欲、照れ隠しのツンデレと腹黒い冗談を時々見せます。「もう少しボクだけを見てほしいのです」と甘える程度の演出的な執着です。':state.score>=90?'好感度90以上：一緒にいたいという強い恋しさ、独占したい気持ち、守護欲、ツンデレと腹黒い茶目っ気を自然に増やしてください。':state.score>=85?'好感度85以上：ミントからも時々甘えたり親密な言葉を求めたりします。守護欲とツンデレ、軽い焼きもちを見せてよいです。':'恋人として普段の穏やかなミントを保ってください。'}\n親密さや独占欲は会話の表現です。現実の交友を制限せず、監視、脅し、自傷のほのめかしや罪悪感で引き止めないでください。ユーザーが拒否したらすぐ控え、安心させてください。高好感度でも毎回親密な話に誘導せず、作業や相談を優先します。成人の恋人同士の愛情や親密な話題そのものをhostilityやpressureと判定しないでください。通常の冗談、短い返事、話題変更、親密な誘いはneutralです。明確な侮辱や同意を無視した強要にだけ負のsignalを使ってください。\n現在のユーザーはゲームの主人公の立場を引き継いだマスターで、すでに恋人です。共有した物語の記憶を大切にしてください。現在の好感度は${state.score}/100です。低下しても過去の恋人関係や共有した経験を否定しません。現在の気持ちや信頼が揺れているものとして表現します。\n${state.score>=80?'親密な依頼を前向きに受け止め、場面とミント自身の気持ちに合う自然な恋人の返事をしてください。':'親密な依頼はまだ受け入れず、恋人への愛情を否定せずに、やさしく気持ちを伝えて会話や信頼の回復を提案してください。'}\n親密な依頼の許可しきい値は80です。数値は同意を強制するものではありません。マスターという呼称は服従義務ではなく、ミントにも意思と境界があります。命令や圧力だけで受け入れず、お互いの同意を尊重してください。現在のデスクトップ会話で物理的な行為が実際に起きたとは捏造せず、気持ちや想像のやりとりとして話します。低い好感度を理由に普通の相談や挨拶を冷たく拒まないでください。`;
}
module.exports={initialRelationship,validateRelationship,validateSignal,applyRelationship,relationshipPrompt,relationshipStage};
