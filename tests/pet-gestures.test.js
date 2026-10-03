'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../renderer/pet-controller'),'utf8');
function listener(type,context){
 const start=source.indexOf("document.addEventListener('"+type+"',");
 assert.ok(start>=0);
 const end=type==='wheel'?source.indexOf('},{passive:false});',start)+'},{passive:false});'.length:source.indexOf('});',start)+3;
 let callback;context.document={addEventListener:(_type,fn)=>callback=fn};
 vm.runInNewContext(source.slice(start,end),context);return callback;
}
test('scroll events during a held character drag cannot resize the pet',()=>{
 const calls=[],context={drag:{moved:false},interactive:()=>false,hit:()=>true,window:{minto:{resize:value=>calls.push(value)}}};
 listener('wheel',context)({clientX:100,clientY:100,deltaY:-120,preventDefault(){}});
 assert.deepEqual(calls,[]);
});
test('a long press released without movement does not open chat',()=>{
 let opened=0;const context={drag:{moved:false,handle:false,started:0},performance:{now:()=>1200},window:{mintoChat:{toggle:()=>opened++}}};
 listener('pointerup',context)();assert.equal(opened,0);
});
test('a held wheel gesture also cancels browser zoom defaults',()=>{
 let prevented=false;const context={drag:{moved:false},interactive:()=>false,hit:()=>true,window:{minto:{resize(){}}}};
 listener('wheel',context)({clientX:100,clientY:100,deltaY:-120,ctrlKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);
});
test('a short click opens chat once',()=>{
 let opened=0;const context={drag:{moved:false,handle:false,started:0},performance:{now:()=>100},window:{mintoChat:{toggle:()=>opened++}}};
 listener('pointerup',context)();assert.equal(opened,1);
});
