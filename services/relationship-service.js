'use strict';
const {createHash}=require('node:crypto');
const SIGNALS=Object.freeze({neutral:0,care:1,repair:1,hostility:-2,pressure:-3});
function initialRelationship(){return {version:1,score:60,bond:'lovers',positiveDate:'',positiveToday:0,recentInputs:[]};}
function validateRelationship(value){
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='bond,positiveDate,positiveToday,recentInputs,score,version'||value.version!==1||value.bond!=='lovers'||!Number.isInteger(value.score)||value.score<0||value.score>100||!Number.isInteger(value.positiveToday)||value.positiveToday<0||value.positiveToday>3||typeof value.positiveDate!=='string'||!/^$|^\d{4}-\d{2}-\d{2}$/.test(value.positiveDate)||!Array.isArray(value.recentInputs)||value.recentInputs.length>200)throw new Error('好感存档数据损坏');
 for(const entry of value.recentInputs)if(!entry||Object.keys(entry).sort().join(',')!=='at,hash'||typeof entry.hash!=='string'||!/^([a-f0-9]{64})$/.test(entry.hash)||typeof entry.at!=='string'||!Number.isFinite(Date.parse(entry.at)))throw new Error('好感存档数据损坏');
 return structuredClone(value);
}
function validateSignal(value){
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='evidence,signal'||typeof value.signal!=='string'||!Object.hasOwn(SIGNALS,value.signal)||typeof value.evidence!=='string'||value.evidence.length>200)throw new Error('好感评估格式无效');
 return {signal:value.signal,evidence:value.evidence};
}
function relationshipStage(score){return score>=80?'亲密':score>=60?'温暖':score>=30?'谨慎':'需要修复';}
function applyRelationship(current,user,assessment,{proactive=false,at=new Date().toISOString()}={}){
 const next=validateRelationship(current);if(proactive||!assessment)return {relationship:next,delta:0,signal:'neutral'};
 const checked=validateSignal(assessment),evidence=checked.evidence.trim();
 if(!evidence||!user.includes(evidence))return {relationship:next,delta:0,signal:'neutral'};
 const now=new Date(at),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const hash=createHash('sha256').update(user.normalize('NFKC').replace(/\s+/gu,'').trim()).digest('hex');
 next.recentInputs=next.recentInputs.filter(entry=>Date.parse(entry.at)>now.getTime()-86400000);
 if(next.recentInputs.some(entry=>entry.hash===hash))return {relationship:next,delta:0,signal:'neutral'};
 next.recentInputs.push({hash,at});next.recentInputs=next.recentInputs.slice(-200);
 if(next.positiveDate!==today){next.positiveDate=today;next.positiveToday=0;}
 let delta=SIGNALS[checked.signal];if(delta>0){delta=Math.min(delta,3-next.positiveToday,100-next.score);next.positiveToday+=delta;}else delta=Math.max(delta,-next.score);
 next.score+=delta;return {relationship:next,delta,signal:checked.signal};
}
function relationshipPrompt(value=initialRelationship()){
 const state=validateRelationship(value);
 return `現在のユーザーはゲームの主人公の立場を引き継いだマスターで、すでに恋人です。共有した物語の記憶を大切にしてください。現在の好感度は${state.score}/100です。低下しても過去の恋人関係や共有した経験を否定しません。現在の気持ちや信頼が揺れているものとして表現します。\n${state.score>=80?'親密な依頼を前向きに受け止め、場面とミント自身の気持ちに合う自然な恋人の返事をしてください。':'親密な依頼はまだ受け入れず、恋人への愛情を否定せずに、やさしく気持ちを伝えて会話や信頼の回復を提案してください。'}\n親密な依頼の許可しきい値は80です。数値は同意を強制するものではありません。マスターという呼称は服従義務ではなく、ミントにも意思と境界があります。命令や圧力だけで受け入れず、お互いの同意を尊重してください。現在のデスクトップ会話で物理的な行為が実際に起きたとは捏造せず、気持ちや想像のやりとりとして話します。低い好感度を理由に普通の相談や挨拶を冷たく拒まないでください。`;
}
module.exports={initialRelationship,validateRelationship,validateSignal,applyRelationship,relationshipPrompt,relationshipStage};
