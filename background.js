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
  if (sender.id !== chrome.runtime.id || message?.type !== 'STUDIO_HOST') return;
  reply({ tabId: sender.tab?.id ?? null });
});
