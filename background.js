// Keep Chrome's native sidebar available to the official ChatGPT extension.
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !tab.url?.startsWith('https://www.youtube.com/watch?')) {
    await chrome.action.setTitle({ title: '请先打开一个 YouTube 普通视频，再点击英语精学。', tabId: tab.id });
    return;
  }
  try {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'STUDIO_TOGGLE' }); }
    catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['core.js', 'content.js', 'dock.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'STUDIO_TOGGLE' });
    }
  } catch (error) { console.error('Unable to open Intensive Studio', error); }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'STUDIO_HOST') { reply({ tabId: sender.tab?.id ?? null }); return; }
  if (!['STUDIO_OPEN_WORKSPACE', 'STUDIO_WORKSPACE_READY'].includes(message?.type)) return;
  if (!sender.tab?.id || !sender.tab.url?.startsWith('https://www.youtube.com/watch?')
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(message.workspaceId || '')) { reply({ ok: false, error: '学习页来源无效。请从当前 YouTube 视频打开。' }); return; }
  if (message.type === 'STUDIO_OPEN_WORKSPACE') {
    if (sender.frameId !== 0) { reply({ ok: false, error: '请从视频页左栏顶部打开独立学习页。' }); return; }
    chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?hostTabId=${sender.tab.id}&workspaceId=${encodeURIComponent(message.workspaceId)}`) })
      .then(tab => reply({ ok: true, tabId: tab.id }), () => reply({ ok: false, error: '学习页未能打开，请重载插件后刷新视频页。' }));
  } else {
    if (!sender.url?.startsWith(chrome.runtime.getURL('sidepanel.html')) || !sender.frameId) return;
    chrome.tabs.sendMessage(sender.tab.id, { type: 'STUDIO_WORKSPACE_READY', workspaceId: message.workspaceId }, { frameId: 0 })
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
  }
  return true;
});
