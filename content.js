(function () {
  'use strict';
  if (globalThis.__englishStudioInstalled) return;
  globalThis.__englishStudioInstalled = true;
  const C = globalThis.StudioCore;
  let videoId = '', range = null, lastCommand = 0, extracting = false, extractionEpoch = 0;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function extensionActive() { try { return !!chrome.runtime.id; } catch { return false; } }
  function getVideo() { return document.querySelector('#movie_player video.html5-main-video') || document.querySelector('video'); }
  function currentId() { return location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') || '' : ''; }
  function isAd() { return !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'); }
  function resetIfNeeded() {
    const next = currentId();
    if (next !== videoId) { videoId = next; range = null; lastCommand++; extractionEpoch++; globalThis.StudioDock?.clear(); }
  }
  function state() {
    resetIfNeeded();
    const v = getVideo();
    return { videoId, title: originalText(document.querySelector('h1.ytd-watch-metadata yt-formatted-string'))
      || originalText(document.querySelector('h1')) || document.title.replace(/ - YouTube$/, ''),
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
      duration: !isAd() && Number.isFinite(v?.duration) ? v.duration : 0, currentTime: v?.currentTime || 0,
      paused: v?.paused ?? true, rate: v?.playbackRate || 1, muted: v?.muted ?? false,
      ad: isAd(), range: range ? { ...range } : null, extracting };
  }
  // We read rendered transcript DOM, not undocumented caption URLs or page-internal tokens.
  const rowSelector = 'ytd-transcript-segment-renderer, transcript-segment-view-model';
  function transcriptScope() {
    const populated = [...document.querySelectorAll('ytd-engagement-panel-section-list-renderer')]
      .filter(el => el.querySelector(rowSelector));
    const visible = populated.find(el => el.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED')
      || populated.find(el => el.getBoundingClientRect().height > 0);
    return visible || populated[0] || document;
  }
  function originalText(node) {
    if (!node) return '';
    const copy = node.cloneNode(true);
    // Third-party translations are annotations, not the spoken source caption.
    copy.querySelectorAll('.immersive-translate-target-wrapper, [data-immersive-translate-translation-element-mark], .immersive-translate-target-translation-block-wrapper').forEach(el => el.remove());
    return copy.textContent.trim();
  }
  function transcriptRows() {
    const rows = [...transcriptScope().querySelectorAll(rowSelector)];
    return rows.map(el => ({
      startTime: el.querySelector('.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp')?.textContent?.trim(),
      text: originalText(el.querySelector('.segment-text, span.ytAttributedStringHost[role="text"]'))
    })).filter(row => Number.isFinite(C.parseTime(row.startTime)) && row.text);
  }
  function transcriptButton() {
    const label = /^(show transcript|内容转文字|轉寫文稿|转写文稿|顯示轉錄稿|显示文字稿|顯示文字稿|显示转写文稿)$/i;
    return [...document.querySelectorAll('button, ytd-button-renderer, [role="tab"]')].find(el => {
      if (el.closest('#english-intensive-studio') || el.disabled || !el.getBoundingClientRect().width) return false;
      return [el.getAttribute('aria-label') || '', originalText(el)].some(text => label.test(text.trim()));
    });
  }
  async function extract() {
    resetIfNeeded();
    if (!videoId) throw new Error('请打开 YouTube 的普通视频页面（/watch），暂不支持 Shorts 和直播。');
    if (isAd()) throw new Error('请等广告结束后再读取文字稿，避免使用广告时长推算字幕。');
    if (extracting) throw new Error('正在读取文字稿，请稍候。');
    extracting = true;
    const original = videoId, epoch = extractionEpoch;
    const pagePosition = { left: window.scrollX, top: window.scrollY };
    let opened = false;
    try {
      let rows = transcriptRows();
      if (!rows.length) {
        const open = transcriptButton();
        if (open) { open.click(); opened = true; }
        else {
          document.querySelector('#description-inline-expander #expand, #description #expand')?.click();
        }
      }
      for (let i = 0; i < 24; i++) {
        if (currentId() !== original || extractionEpoch !== epoch) throw new Error('视频已切换，请重新读取新视频文字稿。');
        rows = transcriptRows();
        if (rows.length) break;
        if (!opened) {
          const open = transcriptButton();
          if (open) { open.click(); opened = true; }
        }
        await sleep(300);
      }
      if (!rows.length) throw new Error('未读到文字稿。请在 YouTube 手动打开“转写文稿”，清空字幕搜索，再重试；也可以粘贴或导入字幕。');
      const video = getVideo();
      const duration = Number.isFinite(video?.duration) && !isAd() ? video.duration : 0;
      const cues = C.makeSegments(C.normalizeCues(rows, duration)).cues;
      const panel = transcriptScope();
      const language = panel?.querySelector('#footer')?.textContent?.trim() || '';
      const search = panel?.querySelector('input');
      const warnings = ['来自页面文字稿；终点按下一条字幕推算，可微调。请核对字幕语言与原声音轨。'];
      if (search?.value) warnings.push('文字稿搜索框非空，可能只读到搜索结果。请清空后重新读取。');
      if (cues[0]?.startTime > 15) warnings.push('首条字幕不在视频开头，可能是部分文字稿。');
      if (duration && cues.at(-1)?.startTime < duration * 0.85) warnings.push('字幕末尾距离视频结束较远，请检查是否完整。');
      return { videoId: original, cues, language, source: 'YouTube 页面文字稿', warnings };
    } finally {
      extracting = false;
      // Opening YouTube's panel can scroll to metadata/comments. Keep the study position.
      if (currentId() === original && extractionEpoch === epoch) window.scrollTo(pagePosition);
    }
  }
  async function command(message) {
    resetIfNeeded();
    if (message.videoId !== videoId || !videoId) throw new Error('视频已变化，已阻止向其他视频发送播放指令。');
    const v = getVideo();
    if (!v) throw new Error('未找到视频播放器，请等视频加载完成。');
    if (isAd() && message.action !== 'cancel') throw new Error('广告播放期间暂停学习控制，请等广告结束。');
    lastCommand++;
    if (message.action === 'cancel') { range = null; v.pause(); return state(); }
    if (message.action === 'pause') { range = null; v.pause(); return state(); }
    if (message.action === 'rate') {
      if (![0.5, 0.65, 0.75, 0.85, 1, 1.25, 1.5, 2].includes(message.rate)) throw new Error('不支持的倍速。');
      v.playbackRate = message.rate; return state();
    }
    if (message.action === 'seek') {
      range = null;
      v.currentTime = Math.max(0, Math.min(Number.isFinite(v.duration) ? v.duration : Infinity, message.time));
      if (message.play) await v.play();
      return state();
    }
    if (message.action === 'playRange') {
      const valid = C.validateRange(message.start, message.end, Number.isFinite(v.duration) ? v.duration : 0);
      const token = lastCommand;
      range = { ...valid, loop: !!message.loop, token: message.token || '' };
      v.currentTime = valid.start;
      try { await v.play(); } catch (error) { if (token === lastCommand) range = null; throw new Error('播放被浏览器阻止，请先在 YouTube 点一次播放后重试。'); }
      return state();
    }
    throw new Error('未知播放指令。');
  }
  // No service-worker timer: range handling follows the actual media clock in the page.
  let frame;
  function tick() {
    if (!extensionActive()) { if (range) getVideo()?.pause(); range = null; return; }
    resetIfNeeded();
    const v = getVideo();
    if (range && v && !isAd() && !v.seeking) {
      if (v.currentTime >= range.end || v.ended) {
        if (range.loop) { v.currentTime = range.start; v.play().catch(() => { range = null; }); }
        else { v.pause(); range = null; }
      } else if (v.currentTime < range.start - 0.4 || v.currentTime > range.end + 1) range = null;
    }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  // Background tabs throttle rAF; timeupdate also enforces the boundary.
  setInterval(() => {
    if (!extensionActive()) return;
    const v = getVideo();
    if (document.hidden && range && v && !isAd() && !v.seeking && v.currentTime >= range.end) {
      if (range.loop) { v.currentTime = range.start; v.play().catch(() => { range = null; }); }
      else { v.pause(); range = null; }
    }
  }, 200);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!extensionActive() || sender.id !== chrome.runtime.id || !message?.type?.startsWith('STUDIO_')) return;
    if (message.type === 'STUDIO_STATE') { reply({ ok: true, data: state() }); return; }
    if (!['STUDIO_EXTRACT', 'STUDIO_COMMAND'].includes(message.type)) return;
    const work = message.type === 'STUDIO_EXTRACT' ? extract() : message.type === 'STUDIO_COMMAND' ? command(message) : Promise.reject(new Error('未知请求。'));
    Promise.resolve(work).then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message }));
    return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (!extensionActive() || port.name !== 'studio-panel' || port.sender?.id !== chrome.runtime.id) return;
    port.onDisconnect.addListener(() => {
      // Closing the panel releases its range playback rather than leaving an invisible loop.
      if (range) { range = null; getVideo()?.pause(); }
    });
  });
})();
