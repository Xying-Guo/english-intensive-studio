/* Page-visible text bridge. No GPT API, external extension IDs, cookies or audio in messages. */
(function () {
  'use strict';
  if (globalThis.StudioDock) return;
  const preview = globalThis.__STUDIO_DOCK_PREVIEW__ === true && ['127.0.0.1', 'localhost'].includes(location.hostname);
  let host, body, frame, fullText, brief, stamp, status, detail, recordBadge, collapseButton, cardArea;
  let layout;
  const workspaceId = crypto.randomUUID();
  const gate = globalThis.StudioCore.createContextGate(workspaceId);
  const ownOrigin = preview ? location.origin : new URL(chrome.runtime.getURL('')).origin;
  const currentVideoId = () => preview ? 'preview-only' : location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') || '' : '';
  const el = (tag, text, className) => {
    const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function applyLayout() {
    if (!host || !layout) return;
    const maxWidth = Math.max(120, Math.min(460, innerWidth * .46, innerWidth - 336));
    layout.width = clamp(layout.width, Math.min(260, maxWidth), maxWidth);
    const masthead = document.querySelector('ytd-masthead');
    const top = preview ? 12 : clamp((masthead?.getBoundingClientRect().bottom || 56) + 8, 8, 96);
    const visible = !!currentVideoId() && !document.fullscreenElement;
    host.style.display = visible ? 'flex' : 'none';
    host.style.width = `${body.hidden ? 44 : layout.width}px`;
    host.style.height = body.hidden ? 'auto' : `${Math.max(100, innerHeight - top - 8)}px`;
    host.style.left = '8px'; host.style.top = `${top}px`; host.style.bottom = 'auto';
    document.documentElement.classList.toggle('eis-left-layout', visible);
    document.documentElement.style.setProperty('--eis-left-space', visible ? `${body.hidden ? 60 : layout.width + 24}px` : '0px');
  }
  function resetLayout() {
    layout = { width: 300 };
    applyLayout();
  }
  function clear() {
    if (!host) return;
    brief.textContent = '在下方字幕中选择一句，“问 GPT”会准备带上下文的学习卡片。';
    fullText.textContent = ''; stamp.textContent = '尚未选句'; status.textContent = '只展示学习文字，不自动发送。';
    if (recordBadge) recordBadge.textContent = '';
    const selection = window.getSelection();
    if (selection?.anchorNode && host.contains(selection.anchorNode)) selection.removeAllRanges();
    if (layout) applyLayout();
  }
  function mount() {
    if (host) return;
    host = el('section', '', 'eis-dock'); host.id = 'english-intensive-studio';
    host.setAttribute('aria-label', 'Intensive Studio 左侧英语精学栏');
    const style = el('style');
    style.textContent = `
      html.eis-left-layout ytd-watch-flexy{box-sizing:border-box!important;margin-left:var(--eis-left-space)!important;width:calc(100% - var(--eis-left-space))!important;min-width:0!important;max-width:none!important}
      html.eis-left-layout ytd-watch-flexy #columns{box-sizing:border-box!important;display:block!important;width:100%!important;min-width:0!important;max-width:1280px!important;padding:16px!important;margin:0 auto!important}
      html.eis-left-layout ytd-watch-flexy #primary{box-sizing:border-box!important;min-width:0!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important}
      html.eis-left-layout ytd-watch-flexy #primary-inner{width:100%!important;min-width:0!important;max-width:none!important}
      html.eis-left-layout ytd-watch-flexy #secondary{display:none!important}
      html.eis-left-layout ytd-watch-flexy #player,html.eis-left-layout ytd-watch-flexy #player-full-bleed-container{box-sizing:border-box!important;position:relative!important;width:100%!important;min-width:0!important;max-width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;aspect-ratio:16/9!important;margin:0 auto!important}
      html.eis-left-layout ytd-watch-flexy #player-container-outer,html.eis-left-layout ytd-watch-flexy #player-container-inner{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;padding:0!important}
      html.eis-left-layout ytd-watch-flexy #movie_player,html.eis-left-layout ytd-watch-flexy .html5-video-container{width:100%!important;height:100%!important;min-width:0!important}
      html.eis-left-layout ytd-watch-flexy video.html5-main-video{width:100%!important;height:100%!important;left:0!important;top:0!important;object-fit:contain!important}
      html.eis-left-layout ytd-watch-flexy .ytp-chrome-bottom{box-sizing:border-box!important;left:12px!important;width:calc(100% - 24px)!important}
      html.eis-left-layout ytd-watch-flexy .ytp-progress-bar-container{width:100%!important}
      html.eis-left-layout .preview-shell{margin-left:var(--eis-left-space);max-width:none;padding:26px 24px}
      html.eis-left-layout .preview-video{width:100%;margin:auto}
      #english-intensive-studio{box-sizing:border-box;position:fixed;z-index:2000;width:300px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:#f5f5ee;color:#273d32;border:1px solid #b8cbb6;border-radius:10px;box-shadow:2px 0 14px #10291b12;overflow:hidden;font:13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;isolation:isolate}
      #english-intensive-studio *{box-sizing:border-box;font-family:inherit}#english-intensive-studio [hidden]{display:none!important}
      #english-intensive-studio .eis-bar{display:flex;align-items:center;gap:7px;padding:10px;background:#276353;color:#fff;user-select:none;flex-shrink:0}
      #english-intensive-studio .eis-brand{font-size:12px;letter-spacing:.1px;font-weight:650;flex:1;min-width:0}
      #english-intensive-studio .eis-bar button{background:#ffffff20;color:#fff;border:0;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px}
      #english-intensive-studio .eis-record-badge{font-size:10px;color:#ffe9ae;white-space:nowrap}
      #english-intensive-studio .eis-body{display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:0}
      #english-intensive-studio .eis-card{padding:10px 12px;background:#fffef9;border-bottom:1px solid #dce4d4;color:#273d32;font-size:13px;line-height:1.65;max-height:36%;overflow:auto;flex-shrink:0;overscroll-behavior:contain}
      #english-intensive-studio .eis-label{display:flex;align-items:center;justify-content:space-between;color:#276353;font-size:10px;letter-spacing:.6px;margin-bottom:6px}
      #english-intensive-studio .eis-brief{margin:0 0 8px;white-space:pre-wrap;font-size:14px;line-height:1.65;max-height:100px;overflow:auto;user-select:text!important;-webkit-user-select:text!important}
      #english-intensive-studio .eis-select{background:#e8efe0;color:#245344;border:1px solid #cbd9c2;border-radius:6px;font-size:12px;padding:7px 10px;cursor:pointer}
      #english-intensive-studio .eis-status{font-size:10px;color:#6a7563;margin:6px 0 0}
      #english-intensive-studio details{margin-top:8px;font-size:11px}#english-intensive-studio summary{cursor:pointer;color:#536b4e}
      #english-intensive-studio .eis-fulltext{font-family:inherit;font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:230px;overflow:auto;margin:8px 0 0;padding:10px;background:#f1f4ea;border-radius:6px;user-select:text!important;-webkit-user-select:text!important}
      #english-intensive-studio iframe{display:block;width:100%;height:0;min-height:0;flex:1;border:0;background:#f5f5ee}
      #english-intensive-studio.eis-collapsed{width:44px!important;height:auto!important}
      #english-intensive-studio.eis-collapsed .eis-bar{flex-direction:column;padding:8px 4px}
      #english-intensive-studio.eis-collapsed .eis-brand{display:none}
      #english-intensive-studio.eis-collapsed .eis-bar button{writing-mode:vertical-rl;letter-spacing:2px;padding:9px 5px}
      #english-intensive-studio.eis-collapsed .eis-record-badge{writing-mode:vertical-rl}
      #english-intensive-studio .eis-resize-hint{flex-shrink:0;padding:3px 22px 3px 12px;font-size:10px;line-height:17px;color:#6b7d63;background:#edf1e5;border-top:1px solid #dce4d4;user-select:none}
      #english-intensive-studio .eis-resize{position:absolute;z-index:5;touch-action:none;user-select:none}
      #english-intensive-studio .eis-resize-e{top:0;bottom:0;width:7px;right:0;cursor:col-resize;border-right:2px solid #96ac86}
      #english-intensive-studio .eis-resize-e:after{content:'⋮';position:absolute;top:48%;right:0;color:#4c7045;background:#edf1e5;font-size:18px;line-height:26px}
      #english-intensive-studio .eis-resize:focus-visible{outline:2px solid #91ab65;outline-offset:-2px;background:#d3e0bd80}
      #english-intensive-studio.eis-collapsed .eis-resize,#english-intensive-studio.eis-collapsed .eis-resize-hint,#english-intensive-studio.eis-collapsed .eis-reset{display:none}
      #english-intensive-studio .eis-bar button:focus-visible,#english-intensive-studio .eis-select:focus-visible{outline:2px solid #d2e8a6;outline-offset:2px}
      @media(max-width:400px){#english-intensive-studio .eis-brand{font-size:11px}#english-intensive-studio .eis-bar{gap:5px;padding:9px 10px}}`;
    const bar = el('div', '', 'eis-bar');
    bar.append(el('span', 'Intensive Studio', 'eis-brand'));
    recordBadge = el('span', '', 'eis-record-badge'); bar.append(recordBadge);
    const reset = el('button', '重置', 'eis-reset'); reset.type = 'button'; reset.title = '恢复默认左栏宽度';
    reset.addEventListener('click', resetLayout); bar.append(reset);
    const collapse = el('button', '收起'); collapse.type = 'button'; collapse.setAttribute('aria-expanded', 'true');
    collapseButton = collapse;
    collapse.addEventListener('click', () => setCollapsed(!body.hidden)); bar.append(collapse);
    body = el('div', '', 'eis-body');
    const card = el('section', '', 'eis-card'); card.setAttribute('aria-label', '当前精学句 · 给 ChatGPT 的页面上下文');
    cardArea = card;
    const label = el('div', '', 'eis-label'); stamp = el('span', '尚未选句'); label.append(el('strong', 'CURRENT SENTENCE · 当前精学句'), stamp);
    brief = el('p', '', 'eis-brief');
    const select = el('button', '选中学习卡片 → 右键询问 ChatGPT', 'eis-select'); select.type = 'button';
    select.addEventListener('click', selectContext);
    status = el('p', '', 'eis-status'); status.setAttribute('role', 'status');
    detail = el('details'); detail.append(el('summary', '查看将带给 GPT 的原文、前后文和问题'));
    fullText = el('pre', '', 'eis-fulltext'); detail.append(fullText);
    card.append(label, brief, select, status, detail);
    frame = el('iframe'); frame.title = '英语精学练习区（插件页面）';
    // An extension-origin frame owns the audio; the host page gets text-only context.
    frame.allow = 'microphone';
    frame.src = preview
      ? `/sidepanel.html?preview=1&embeddedPreview=1&workspaceId=${workspaceId}${new URLSearchParams(location.search).has('testRecorder') ? '&testRecorder=1' : ''}`
      : chrome.runtime.getURL(`sidepanel.html?embedded=1&workspaceId=${workspaceId}`);
    body.append(card, frame); host.append(style, bar, body, el('div', '拖动右侧分隔线调整宽度 · 视频自动让位', 'eis-resize-hint'));
    for (const direction of ['e']) {
      const handle = el('div', '', `eis-resize eis-resize-${direction}`);
      handle.tabIndex = 0; handle.setAttribute('role', 'button');
      handle.setAttribute('aria-label', '调整左栏宽度，支持左右方向键');
      handle.title = '拖动分隔线调整左栏宽度；左右键微调，Shift 加速';
      let resizing;
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        resizing = { x: event.clientX, y: event.clientY, layout: { ...layout } };
        handle.setPointerCapture(event.pointerId);
      });
      const changeSize = (start, dx) => {
        layout = { width: start.width + dx };
        applyLayout();
      };
      handle.addEventListener('pointermove', event => { if (resizing) changeSize(resizing.layout, event.clientX - resizing.x); });
      handle.addEventListener('pointerup', () => { resizing = null; });
      handle.addEventListener('pointercancel', () => { resizing = null; });
      handle.addEventListener('lostpointercapture', () => { resizing = null; });
      handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); const step = event.shiftKey ? 40 : 10;
        changeSize({ ...layout }, event.key === 'ArrowLeft' ? -step : step);
      });
      host.append(handle);
    }
    document.body.append(host); clear(); resetLayout();
    addEventListener('resize', applyLayout);
    document.addEventListener('fullscreenchange', applyLayout);
    document.addEventListener('yt-navigate-finish', applyLayout);
  }
  function setCollapsed(value) {
    body.hidden = value; host.classList.toggle('eis-collapsed', value);
    const button = collapseButton;
    button.textContent = value ? '展开练习' : '收起';
    button.setAttribute('aria-expanded', String(!value));
    applyLayout();
    // Do NOT remove or navigate the iframe: hiding preserves audio and attempts.
  }
  function selectContext() {
    if (!fullText.textContent) { status.textContent = '请先从字幕中选择一句，或点击“问 GPT”。'; return; }
    detail.open = true;
    const selection = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(fullText); selection.removeAllRanges(); selection.addRange(range);
    status.textContent = '已选中完整学习上下文。现在右键选中文字 → Ask ChatGPT。尚未发送。';
    body.scrollTop = 0;
    fullText.scrollTop = 0;
    cardArea.scrollTop += fullText.getBoundingClientRect().top - cardArea.getBoundingClientRect().top - 8;
  }
  function update(message) {
    if (!host) return false;
    const accepted = gate.accept(message, currentVideoId());
    if (!accepted) return false;
    if (!accepted.context) { clear(); return true; }
    const c = accepted.context;
    fullText.textContent = c.prompt; brief.textContent = c.text;
    stamp.textContent = `${c.start}–${c.end}`;
    recordBadge.textContent = accepted.recording ? '● 录音中' : '';
    status.textContent = '文字卡片已更新。可让 GPT 使用此页面，或选中卡片右键提问；录音没有附加。';
    if (accepted.select) { setCollapsed(false); selectContext(); }
    return true;
  }
  globalThis.StudioDock = Object.freeze({ clear, update, toggle() { if (!host) mount(); else setCollapsed(!body.hidden); } });
  if (preview) {
    addEventListener('message', event => {
      if (event.source !== frame?.contentWindow || event.origin !== ownOrigin || event.data?.type !== 'STUDIO_CONTEXT_PREVIEW') return;
      update(event.data);
    });
    globalThis.StudioDock.toggle();
  } else {
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message?.type === 'STUDIO_TOGGLE') { globalThis.StudioDock.toggle(); reply({ ok: true }); }
      if (message?.type === 'STUDIO_CONTEXT') reply({ ok: true, data: { updated: update(message) } });
    });
  }
})();
