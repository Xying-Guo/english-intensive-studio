'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContextGate } = require('../core');
const base = { workspaceId:'workspace',producerId:'frame',videoId:'video',seq:1,
  context:{text:'Original sentence.',prompt:'Original sentence + timestamps + context',start:'0:12.000',end:'0:18.000'} };
test('page context cannot attach to a different video or workspace',()=>{
  const gate=createContextGate('workspace');
  assert.equal(gate.accept({...base,videoId:'other'},'video'),null);
  assert.equal(gate.accept({...base,workspaceId:'other'},'video'),null);
  assert.equal(gate.accept(base,'other'),null);
  assert.equal(gate.accept(base,'video').context.text,'Original sentence.');
});
test('stale updates cannot resurrect cleared context or overwrite a later sentence',()=>{
  const gate=createContextGate('workspace');
  assert.ok(gate.accept(base,'video'));
  assert.ok(gate.accept({...base,seq:3,context:null},'video'));
  assert.equal(gate.accept({...base,seq:2},'video'),null);
  assert.equal(gate.accept({...base,seq:3},'video'),null);
});
test('opening a fallback workspace requires an explicit selection to replace the current card',()=>{
  const gate=createContextGate('workspace');
  assert.ok(gate.accept(base,'video'));
  assert.equal(gate.accept({...base,producerId:'new-window'},'video'),null);
  assert.ok(gate.accept({...base,producerId:'new-window',select:true},'video'));
  assert.equal(gate.accept({...base,seq:2},'video'),null);
});
test('page-visible bridge only carries approved text fields, never recordings or commands',()=>{
  const gate=createContextGate('workspace');
  const output=gate.accept({...base,audioBlob:'secret',action:'upload',context:{...base.context,audio:'secret'},recording:true},'video');
  assert.deepEqual(Object.keys(output).sort(),['context','recording','select']);
  assert.deepEqual(Object.keys(output.context).sort(),['end','prompt','start','text']);
  assert.equal(output.recording,true);
});
test('malformed or oversized context is rejected without consuming its version',()=>{
  const gate=createContextGate('workspace');
  assert.equal(gate.accept({...base,context:{...base.context,start:'bad'}},'video'),null);
  assert.equal(gate.accept({...base,context:{...base.context,prompt:'x'.repeat(60001)}},'video'),null);
  assert.ok(gate.accept(base,'video'));
});
