'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('invalidating a live extension stops its range loop without an uncaught error',async()=>{
  let callback,tick,alive=true;
  const video={duration:30,currentTime:0,paused:true,seeking:false,play:async function(){this.paused=false},pause:function(){this.paused=true}};
  const runtime={onMessage:{addListener:fn=>callback=fn},onConnect:{addListener:()=>{}}};
  Object.defineProperty(runtime,'id',{get(){if(!alive)throw new Error('Extension context invalidated.');return'test';}});
  const context=vm.createContext({StudioCore:require('../core'),location:{pathname:'/watch',href:'https://www.youtube.com/watch?v=one'},URL,
    document:{title:'Source',hidden:false,querySelector:s=>s.includes('ad-showing')?null:s.includes('video')?video:null,querySelectorAll:()=>[]},
    chrome:{runtime},setTimeout,setInterval:()=>1,requestAnimationFrame:fn=>{tick=fn;return 1;}});
  vm.runInContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),context);
  await new Promise(resolve=>callback({type:'STUDIO_COMMAND',videoId:'one',action:'playRange',start:1,end:3,loop:true},{id:'test'},resolve));
  assert.equal(video.paused,false);
  alive=false;
  assert.doesNotThrow(()=>tick());
  assert.equal(video.paused,true);
  assert.doesNotThrow(()=>callback({type:'STUDIO_STATE'},{id:'test'},()=>{}));
});
