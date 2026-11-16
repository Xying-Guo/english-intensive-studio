'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const workspaceId = '11111111-2222-4333-8444-555555555555';
function harness() {
  let listener; const opened = [], sent = [];
  const runtime = { id: 'own', getURL: p => `chrome-extension://own/${p}`, onMessage: { addListener: fn => { listener = fn; } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), { chrome: { runtime,
    action: { onClicked: { addListener: () => {} } },
    tabs: { create: async options => { opened.push(options); return { id: 99 }; }, sendMessage: async (...args) => { sent.push(args); return {}; } }
  } });
  const sender = { id: 'own', frameId: 0, tab: { id: 42, url: 'https://www.youtube.com/watch?v=source' } };
  return { opened, sent, sender, listener, send: (message, source = sender) => new Promise(resolve => listener(message, source, resolve)) };
}
test('fallback workspace remains bound to the video tab rather than the active tab', async () => {
  const h = harness();
  const response = await h.send({ type: 'STUDIO_OPEN_WORKSPACE', workspaceId });
  assert.equal(response.ok, true);
  assert.equal(h.opened[0].url, `chrome-extension://own/sidepanel.html?hostTabId=42&workspaceId=${workspaceId}`);
});
test('untrusted sources cannot open workspaces or spoof readiness', async () => {
  const h = harness();
  h.listener({ type: 'STUDIO_OPEN_WORKSPACE', workspaceId }, { ...h.sender, id: 'other' }, () => assert.fail('foreign extension accepted'));
  assert.equal((await h.send({ type: 'STUDIO_OPEN_WORKSPACE', workspaceId }, { ...h.sender, tab: { id: 42, url: 'https://example.com/' } })).ok, false);
  assert.equal((await h.send({ type: 'STUDIO_OPEN_WORKSPACE', workspaceId: '../../evil' })).ok, false);
  assert.equal((await h.send({ type: 'STUDIO_OPEN_WORKSPACE', workspaceId }, { ...h.sender, frameId: 2 })).ok, false);
  h.listener({ type: 'STUDIO_WORKSPACE_READY', workspaceId }, { ...h.sender, frameId: 2, url: 'https://www.youtube.com/' }, () => assert.fail('webpage readiness accepted'));
  assert.equal(h.opened.length, 0); assert.equal(h.sent.length, 0);
});
test('readiness from the extension iframe is routed only to its own parent video', async () => {
  const h = harness();
  const response = await h.send({ type: 'STUDIO_WORKSPACE_READY', workspaceId }, { ...h.sender, frameId: 2, url: 'chrome-extension://own/sidepanel.html?embedded=1' });
  assert.equal(response.ok, true); assert.equal(h.sent[0][0], 42);
  assert.equal(h.sent[0][1].workspaceId, workspaceId); assert.equal(h.sent[0][2].frameId, 0);
});
