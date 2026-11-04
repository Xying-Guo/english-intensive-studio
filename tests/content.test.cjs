'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../core.js');
const code = fs.readFileSync(require.resolve('../content.js'), 'utf8');
function harness() {
  const callbacks = [], connections = []; let tick, ad = false;
  const video = { currentTime: 0, duration: 100, paused: true, seeking: false, ended: false, playbackRate: 1,
    play: async function () { this.paused = false; }, pause: function () { this.paused = true; } };
  const context = vm.createContext({ StudioCore: C,
    document: { title: 'Source - YouTube', hidden: false,
      querySelector: selector => selector.includes('ad-showing') ? (ad ? {} : null) : selector.includes('video') ? video : null,
      querySelectorAll: () => [] },
    location: { pathname: '/watch', href: 'https://www.youtube.com/watch?v=one' }, URL,
    requestAnimationFrame: callback => { tick = callback; return 1; }, setInterval: () => 1, setTimeout,
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener: fn => callbacks.push(fn) }, onConnect: { addListener: fn => connections.push(fn) } } }
  });
  vm.runInContext(code, context);
  const send = message => new Promise(resolve => callbacks[0](message, { id: 'test-extension' }, resolve));
  return { context, video, send, runTick: () => tick(), setAd: value => { ad = value; }, connections, callbacks };
}
test('single playback stops at B; looping seeks to A; cancel clears the loop', async () => {
  const h = harness();
  assert.ok((await h.send({ type: 'STUDIO_COMMAND', videoId: 'one', action: 'playRange', start: 3, end: 5 })).ok);
  h.video.currentTime = 5.01; h.runTick(); assert.equal(h.video.paused, true);
  await h.send({ type: 'STUDIO_COMMAND', videoId: 'one', action: 'playRange', start: 3, end: 5, loop: true });
  h.video.currentTime = 5.01; h.runTick(); assert.equal(h.video.currentTime, 3);
  await h.send({ type: 'STUDIO_COMMAND', videoId: 'one', action: 'cancel' });
  assert.equal((await h.send({ type: 'STUDIO_STATE' })).data.range, null);
});
test('navigation and advertisements cannot receive stale sentence controls', async () => {
  const h = harness();
  await h.send({ type: 'STUDIO_STATE' });
  h.context.location.href = 'https://www.youtube.com/watch?v=two';
  const result = await h.send({ type: 'STUDIO_COMMAND', videoId: 'one', action: 'playRange', start: 1, end: 2 });
  assert.equal(result.ok, false); assert.equal(h.video.paused, true);
  h.setAd(true);
  const state = await h.send({ type: 'STUDIO_STATE' }); assert.equal(state.data.duration, 0);
  const adResult = await h.send({ type: 'STUDIO_COMMAND', videoId: 'two', action: 'playRange', start: 1, end: 2 });
  assert.equal(adResult.ok, false);
});
test('closing the panel cancels invisible loops, and reinjection registers only once', async () => {
  const h = harness();
  vm.runInContext(code, h.context); assert.equal(h.callbacks.length, 1);
  let disconnect;
  h.connections[0]({ name: 'studio-panel', sender: { id: 'test-extension' }, onDisconnect: { addListener: fn => { disconnect = fn; } } });
  await h.send({ type: 'STUDIO_COMMAND', videoId: 'one', action: 'playRange', start: 1, end: 2, loop: true });
  disconnect();
  assert.equal(h.video.paused, true); assert.equal((await h.send({ type: 'STUDIO_STATE' })).data.range, null);
});
