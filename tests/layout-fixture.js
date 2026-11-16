'use strict';
const fixtureCallbacks = [];
// Local test harness only. Production content.js runs unchanged against real DOM.
globalThis.chrome = { runtime: { id: 'fixture-only',
  onMessage: { addListener: callback => fixtureCallbacks.push(callback) },
  onConnect: { addListener: () => {} }
} };
document.getElementById('fixture-read').addEventListener('click', () => {
  fixtureCallbacks[0]({ type: 'STUDIO_EXTRACT' }, { id: 'fixture-only' }, result => {
    document.getElementById('fixture-result').textContent = JSON.stringify(result, null, 2);
  });
});
if (new URLSearchParams(location.search).has('auto')) {
  const panel = document.querySelector('[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
  panel.remove();
  document.querySelector('[visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"]').remove();
  document.querySelector('#expand').addEventListener('click', () => setTimeout(() => {
    const button = document.createElement('button'); button.setAttribute('aria-label', 'Show transcript');
    button.append('Show transcript');
    const translation = document.createElement('font');
    translation.className = 'immersive-translate-target-wrapper'; translation.textContent = '显示文字稿';
    button.append(translation);
    button.addEventListener('click', () => {
      document.querySelector('#panels').append(panel); window.scrollTo({ top: 600 });
    });
    document.querySelector('#description').append(button);
  }, 650), { once: true });
}
if (new URLSearchParams(location.search).has('legacy')) {
  document.querySelectorAll('transcript-segment-view-model').forEach(row => {
    const legacy = document.createElement('ytd-transcript-segment-renderer');
    const time = row.querySelector('.ytwTranscriptSegmentViewModelTimestamp'); time.className = 'segment-timestamp';
    const text = row.querySelector('span[role="text"]'); text.className = 'segment-text';
    legacy.append(time, text); row.replaceWith(legacy);
  });
}
if(new URLSearchParams(location.search).get('layout')==='normal'){
  document.getElementById('player-full-bleed-container').style.display='none';
  document.getElementById('player').style.display='block';
  document.getElementById('player-container-inner').append(document.getElementById('movie_player'));
  document.getElementById('fixture-mode').textContent='普通播放器结构测试';
}else document.getElementById('fixture-mode').textContent='宽屏播放器结构测试';
