(function () {
  'use strict';
  const C = globalThis.StudioCore, $ = id => document.getElementById(id);
  const preview = new URLSearchParams(location.search).has('preview') && !globalThis.chrome?.runtime?.id;
  const params = new URLSearchParams(location.search);
  const embedded = params.has('embedded'), embeddedPreview = preview && params.has('embeddedPreview');
  const hostTabId = /^\d+$/.test(params.get('hostTabId') || '') ? Number(params.get('hostTabId')) : null;
  const pageContext = embedded || embeddedPreview || hostTabId !== null;
  const workspaceId = params.get('workspaceId') || '';
  const producerId = crypto.randomUUID();
  let contextSeq = 0, contextMode = 'understand', contextChapter = false;
  if (embedded || embeddedPreview) document.body.classList.add('embedded');
  const audio = $('my-audio');
  const sessions = new Map(), attempts = [];
  let tabId = null, port = null, video = null, session = null, connectionEpoch = 0;
  let selected = [], range = { start: 0, end: 0 }, currentChapter = '', activeIndex = -1;
  let selectionAnchor = null, readStatus = '尚未读取字幕';
  let pollBusy = false, readBusy = false, revision = 0, loop = false, sequence = null, extensionExpired = false;
  let chosenAttempt = '', recorder = null, stream = null, recordingTarget = null;
  let recordingPending = false, recordingStarted = 0, recordTimer = null, discarded = false;
  let previewClock = null, previewStarted = 0, playbackResolver = null;

  function notice(message, error = false) {
    $('notice').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`;
    $('notice').hidden = !message;
  }
  const guarded = fn => async (...args) => { try { await fn(...args); } catch (error) { if (error.name !== 'AbortError') notice(error.message || String(error), true); } };
  function safeName(value) { return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70); }
  function ensureVideo() { if (!video?.videoId || tabId === null) throw new Error('请先连接一个 YouTube 视频。'); }
  function ensureSelection() { ensureVideo(); if (!selected.length) throw new Error('请先从字幕中选择一句。'); }
  function isRecording() { return recordingPending || !!recorder && recorder.state !== 'inactive'; }
  function ensureNotRecording() { if (isRecording()) throw new Error('请先停止录音，再切换句子或控制原声。'); }
  function currentSnapshot() { ensureSelection(); return C.snapshot(video, session.cues, selected, range); }
  function getSession(id) {
    if (!sessions.has(id)) sessions.set(id, { cues: [], baseCues: [], segments: [], source: '', offset: 0 });
    return sessions.get(id);
  }
  function disconnectPort() {
    try { port?.disconnect(); } catch { /* Chrome invalidates existing ports when an extension is reloaded. */ }
    port = null;
  }
  async function send(type, data = {}, targetTab = tabId) {
    if (preview) return previewSend(type, data);
    let active = false;
    try { active = !!chrome.runtime.id; } catch { /* Invalidated extension context. */ }
    if (!active) throw new Error('Extension context invalidated. 请刷新 YouTube 页面后重新打开精学插件。');
    if (targetTab === null) throw new Error('请先连接视频。');
    const response = await chrome.tabs.sendMessage(targetTab, { type, ...data });
    if (!response?.ok) throw new Error(response?.error || '视频页面未响应，请刷新 YouTube 后重新连接。');
    return response.data;
  }
  async function control(action, data = {}, targetVideo = video, targetTab = tabId) {
    if (!targetVideo?.videoId) throw new Error('尚未连接视频。');
    revision++;
    return send('STUDIO_COMMAND', { videoId: targetVideo.videoId, action, ...data }, targetTab);
  }
  async function connect() {
    ensureNotRecording();
    await stopPlayback();
    const epoch = ++connectionEpoch;
    if (preview) {
      tabId = 0; adoptVideo(previewVideo); installCues(C.parseTranscript(previewTranscript, previewVideo.duration), '演示字幕（非视频原文）');
      notice(params.has('testRecorder') ? '界面演示使用模拟视频时钟；录音测试使用合成音，不访问物理麦克风。' : '界面演示：播放时钟为模拟，不连接 YouTube；录音按钮仍需真实麦克风授权。');
      return;
    }
    const bound = embedded ? await chrome.runtime.sendMessage({ type: 'STUDIO_HOST' }) : null;
    const forcedId = bound?.tabId ?? hostTabId;
    const tab = forcedId !== null && forcedId !== undefined
      ? await chrome.tabs.get(forcedId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.url?.startsWith('https://www.youtube.com/watch?')) throw new Error('请切回 Chrome 的 YouTube 视频标签页，再点“连接当前视频”。');
    let state;
    try { state = await send('STUDIO_STATE', {}, tab.id); }
    catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['core.js', 'content.js'] });
      state = await send('STUDIO_STATE', {}, tab.id);
    }
    if (epoch !== connectionEpoch) return;
    disconnectPort();
    tabId = tab.id;
    port = chrome.tabs.connect(tabId, { name: 'studio-panel' });
    port.onDisconnect.addListener(() => {});
    adoptVideo(state);
    notice(session.cues.length ? '已连接。已恢复当前练习会话中的字幕。' : '已连接当前视频。可以读取页面文字稿了。');
  }
  function adoptVideo(state) {
    const changed = video?.videoId !== state.videoId;
    video = state;
    if (changed) {
      cancelAudio(); sequence = null; loop = false;
      selected = []; selectionAnchor = null; activeIndex = -1; chosenAttempt = '';
      readStatus = '尚未读取字幕'; $('question').value = ''; resetStudyScope();
      session = getSession(state.videoId);
      $('offset').value = session.offset;
      renderChapters(); renderTranscript(); renderTarget(); renderAttempts();
    }
    renderVideo();
  }
  function renderVideo() {
    const connected = !!video?.videoId;
    $('connection-label').textContent = connected ? preview ? '演示会话 · 非真实视频' : '已连接 YouTube · 当前会话' : '等待连接 YouTube';
    $('connection-dot').classList.toggle('connected', connected);
    $('video-title').textContent = video?.title || '打开一个你想认真听懂的视频';
    $('video-time').textContent = connected ? `${C.formatTime(video.currentTime)} / ${C.formatTime(video.duration)}` : '— / —';
    $('playback-state').textContent = !connected ? '尚未连接' : video.ad ? '广告中 · 学习控制暂停' : `${video.paused ? '已暂停' : '播放中'} · ${video.rate}×${video.muted ? ' · 已静音' : ''}`;
    $('video-progress').style.width = `${video?.duration ? Math.min(100, video.currentTime / video.duration * 100) : 0}%`;
    $('extract').disabled = readBusy || !connected || isRecording();
    $('extract').textContent = readBusy ? '正在读取文字稿…' : '读取页面文字稿';
    $('read-status').textContent = readStatus;
    $('toggle-play').disabled = !connected || isRecording();
    if (connected && document.activeElement !== $('speed')) {
      const value = String(video.rate);
      let option = [...$('speed').options].find(item => item.value === value);
      if (!option) { option = document.createElement('option'); option.value = value; option.textContent = `${value}×（当前）`; $('speed').append(option); }
      $('speed').value = value;
    }
    if (session?.source) $('source-info').textContent = `${session.source} · ${session.cues.length} 条 · ${session.segments.length} 个学习章节。${session.offset ? `偏移 ${session.offset} 秒。` : ''}`;
    else $('source-info').textContent = '先打开 YouTube 的“转写文稿”，再读取。也可以在下方粘贴字幕。';
  }
  async function poll() {
    if (tabId === null || pollBusy || extensionExpired) return;
    pollBusy = true;
    const epoch = connectionEpoch, rev = revision;
    try {
      const state = await send('STUDIO_STATE');
      if (epoch !== connectionEpoch || rev !== revision) return;
      if (video?.videoId !== state.videoId) {
        if (isRecording()) stopRecording();
        adoptVideo(state);
        notice('视频已切换。页面学习卡片和练习目标已更新；旧录音仍绑定原视频。');
      } else { video = state; renderVideo(); }
      if (recorder?.state === 'recording' && recordingTarget?.videoId === video.videoId && !video.paused && !video.ad) {
        await control('pause');
      }
      if (!video.videoId) return;
      const index = C.activeCueIndex(session.cues, video.currentTime);
      if (index !== activeIndex) {
        activeIndex = index;
        if ($('follow').checked && index >= 0) {
          const segment = session.cues[index].segmentId;
          if (segment !== currentChapter) { currentChapter = segment; $('chapter').value = segment; renderTranscript(); }
        }
        document.querySelectorAll('.cue.playing').forEach(el => el.classList.remove('playing'));
        const row = document.querySelector(`[data-cue-index="${index}"]`);
        if (row) {
          row.classList.add('playing');
          if ($('follow').checked && !$('transcript-view').hidden && !isRecording()) {
            const rect = row.getBoundingClientRect();
            if (rect.top < 60 || rect.bottom > innerHeight - 60) row.scrollIntoView({ block: 'center', behavior: 'auto' });
          }
        }
      }
      if (sequence?.phase === 'original') {
        if (video.ad) { await stopPlayback(); notice('遇到广告，已停止 A/B 比较。广告结束后可重试。'); }
        else if (video.paused && !video.range) {
          if (video.currentTime >= sequence.end - 0.3) {
            const item = sequence.attempt;
            sequence.phase = 'recording';
            $('comparison-status').textContent = 'B · 正在播放你的录音';
            playAttempt(item, true).then(() => finishSequence(), error => { if (error.name !== 'AbortError') { finishSequence(); notice(error.message, true); } });
          } else { finishSequence(); notice('原声播放中途停止，A/B 比较已取消。'); }
        } else if (video.range && video.range.token !== sequence.token) finishSequence();
      }
    } catch (error) {
      cancelAudio(); sequence = null;
      if (isRecording()) stopRecording();
      $('connection-label').textContent = '连接已断开 · 请刷新视频后重连';
      $('connection-dot').classList.remove('connected');
      $('playback-state').textContent = '无法读取视频状态';
      if (/context invalidated|extension.*(?:reloaded|invalidated)/i.test(error.message || '')) {
        extensionExpired = true;
        disconnectPort();
        notice('插件已重新加载，这个页面仍是旧会话。请先保存需要的录音，再刷新 YouTube，重新打开精学插件。', true);
      }
    } finally { pollBusy = false; }
  }
  function installCues(cues, source) {
    ensureVideo(); ensureNotRecording();
    if (!cues.length) throw new Error('未读取到字幕。');
    session.baseCues = cues.map(c => ({ ...c })); session.offset = 0; $('offset').value = 0;
    const built = C.makeSegments(cues);
    session.cues = built.cues; session.segments = built.segments; session.source = source;
    selected = []; selectionAnchor = null; chosenAttempt = ''; loop = false; resetStudyScope();
    readStatus = `已导入 ${built.cues.length} 条字幕 · ${built.segments.length} 个章节`;
    currentChapter = session.segments[0]?.id || '';
    renderChapters(); renderTranscript(); renderTarget(); renderAttempts(); renderVideo();
  }
  async function extract() {
    ensureVideo(); ensureNotRecording();
    if (readBusy) return;
    await stopPlayback();
    readBusy = true; readStatus = '正在打开并读取文字稿，请稍候…'; renderVideo();
    const expectedId = video.videoId, expectedEpoch = connectionEpoch;
    notice('正在读取当前页面文字稿；若尚未打开，插件会尝试展开。');
    try {
      const result = await send('STUDIO_EXTRACT');
      if (expectedEpoch !== connectionEpoch || result.videoId !== expectedId) throw new Error('视频发生变化，请重新连接后读取。');
      // Recheck navigation before attaching the asynchronous transcript response.
      const latest = await send('STUDIO_STATE');
      if (latest.videoId !== expectedId) throw new Error('读取期间视频已切换，未采用旧字幕。');
      installCues(result.cues, result.source);
      notice(`已读取 ${result.cues.length} 条字幕。\n${result.warnings.join('\n')}`);
    } catch (error) {
      readStatus = `读取未完成：${error.message}`;
      throw error;
    } finally { readBusy = false; renderVideo(); }
  }
  function renderChapters() {
    $('chapter').replaceChildren();
    for (const [i, segment] of (session?.segments || []).entries()) {
      const option = document.createElement('option'); option.value = segment.id;
      option.textContent = `${String(i + 1).padStart(2, '0')} / ${C.formatTime(segment.startTime)}–${C.formatTime(segment.endTime)} · ${segment.count} 条`;
      $('chapter').append(option);
    }
    if (!session?.segments.length) {
      const option = document.createElement('option'); option.textContent = '读取字幕后生成章节'; option.value = ''; $('chapter').append(option);
    }
    if (!session?.segments.some(s => s.id === currentChapter)) currentChapter = session?.segments[0]?.id || '';
    $('chapter').value = currentChapter;
    $('cue-count').textContent = session?.cues.length || 0;
  }
  function renderTranscript() {
    const list = $('transcript-list'), query = $('search').value.trim().toLowerCase();
    list.replaceChildren();
    const cues = session?.cues || [];
    $('transcript-empty').hidden = cues.length > 0;
    $('transcript-footnote').hidden = !cues.length;
    const fragment = document.createDocumentFragment();
    cues.forEach((cue, index) => {
      if (cue.segmentId !== currentChapter || query && !cue.text.toLowerCase().includes(query)) return;
      const row = document.createElement('article');
      row.className = `cue${selected.includes(index) ? ' selected' : ''}${activeIndex === index ? ' playing' : ''}`;
      row.dataset.cueIndex = index;
      const top = document.createElement('div'); top.className = 'cue-top';
      const stamp = document.createElement('button'); stamp.className = 'timestamp'; stamp.textContent = C.formatTime(cue.startTime);
      stamp.title = `定位到 ${C.formatTime(cue.startTime, true)}`;
      stamp.addEventListener('click', guarded(() => choose(index, 'seek')));
      const ordinal = document.createElement('span'); ordinal.className = 'cue-index'; ordinal.textContent = `#${String(index + 1).padStart(3, '0')}${selected.includes(index) ? ' · 已选中' : ''}`;
      top.append(stamp, ordinal);
      const text = document.createElement('button'); text.className = 'cue-text'; text.textContent = cue.text;
      text.addEventListener('click', guarded(event => event.shiftKey && selected.length ? choosePassage(index) : choose(index, 'seek')));
      const actions = document.createElement('div'); actions.className = 'cue-actions';
      const extend = document.createElement('button'); extend.textContent = selected.length ? '选到这里' : '从这里选';
      extend.setAttribute('aria-label', `${selected.length ? '将片段终点设为' : '从此处开始选择片段'} ${C.formatTime(cue.startTime)}`);
      extend.addEventListener('click', guarded(() => choosePassage(index))); actions.append(extend);
      for (const [title, mode] of [['↺ 单句循环', 'loop'], ['● 录音跟练', 'practice'], ['问 GPT ↗', 'tutor']]) {
        const button = document.createElement('button'); button.textContent = title;
        button.addEventListener('click', guarded(() => choose(index, mode))); actions.append(button);
      }
      row.append(top, text, actions); fragment.append(row);
    });
    list.append(fragment);
    if (cues.length && !list.children.length) { const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = '本章没有匹配的字幕。'; list.append(empty); }
    renderTutorTarget();
  }
  async function choose(index, mode = 'practice') {
    ensureNotRecording();
    const cue = session?.cues[index]; if (!cue) return;
    await stopPlayback();
    selected = [index]; selectionAnchor = index; range = { start: cue.startTime, end: cue.endTime }; chosenAttempt = ''; resetStudyScope();
    $('follow').checked = false;
    currentChapter = cue.segmentId; $('chapter').value = currentChapter;
    renderTarget(); renderTranscript(); renderAttempts();
    if (mode === 'seek') await control('seek', { time: cue.startTime, play: false });
    if (mode === 'loop') { showTab('practice'); loop = true; renderLoop(); await playOriginal(); }
    if (mode === 'practice') { showTab('practice'); await control('pause'); }
    if (mode === 'tutor') { showTab('tutor'); await prepareContext('understand'); }
  }
  async function choosePassage(index) {
    ensureNotRecording();
    if (!selected.length || selectionAnchor === null) return choose(index, 'select');
    const passage = C.selectPassage(session.cues, selectionAnchor, index);
    await stopPlayback();
    selected = passage.indices; range = passage.range; chosenAttempt = ''; resetStudyScope();
    $('follow').checked = false;
    currentChapter = session.cues[index].segmentId; $('chapter').value = currentChapter;
    renderTarget(); renderTranscript(); renderAttempts();
  }
  function resetStudyScope() {
    contextChapter = false; contextMode = 'understand';
    $('learning-scope').value = 'selection'; $('task-status').textContent = '选好范围，再选择一个任务。';
  }
  function learningMaterial(chapter = $('learning-scope').value === 'chapter') {
    if (!chapter) return { selection: selected, bounds: range, scope: 'selection' };
    const segment = session?.segments.find(s => s.id === currentChapter);
    if (!segment) return { selection: [], bounds: { start: 0, end: 0 }, scope: 'chapter' };
    return { selection: Array.from({ length: segment.count }, (_, i) => segment.firstIndex + i),
      bounds: { start: segment.startTime, end: segment.endTime }, scope: 'chapter' };
  }
  function materialLabel(selection, bounds, scope) {
    return `${scope === 'chapter' ? '当前章节' : selection.length === 1 ? '单句' : '连续片段'} · ${C.formatTime(bounds.start)}–${C.formatTime(bounds.end)} · ${selection.length} 条字幕`;
  }
  function renderTutorTarget() {
    const { selection, bounds, scope } = learningMaterial();
    const exists = !!selection.length;
    const text = selection.map(i => session.cues[i].text).join(' ');
    $('tutor-range').textContent = exists ? materialLabel(selection, bounds, scope) : '尚未选择学习范围';
    $('tutor-target').textContent = exists ? text : scope === 'chapter' ? '请先读取字幕。' : '请先在字幕中选择一句或连续片段，也可以切换到当前章节。';
    for (const button of document.querySelectorAll('[data-prompt]')) button.disabled = !exists || isRecording();
    $('copy-backup').disabled = !exists;
  }
  function showTab(name) {
    for (const item of document.querySelectorAll('[data-tab]')) {
      const active = item.dataset.tab === name; item.classList.toggle('active', active); item.setAttribute('aria-pressed', active);
    }
    for (const view of ['transcript', 'practice', 'tutor']) $(`${view}-view`).hidden = view !== name;
  }
  function renderTarget() {
    contextChapter = $('learning-scope').value === 'chapter';
    const exists = selected.length > 0 && !!session?.cues.length;
    $('practice-empty').hidden = exists; $('practice-content').hidden = !exists;
    const text = exists ? selected.map(i => session.cues[i].text).join(' ') : '';
    $('target-text').textContent = text;
    $('selection-summary').hidden = !exists;
    $('selection-label').textContent = exists ? materialLabel(selected, range, 'selection') : '';
    $('selection-preview').textContent = text.length > 240 ? `${text.slice(0, 240)}…` : text;
    for (const id of ['selection-clear', 'selection-play', 'selection-discuss']) $(id).disabled = !exists || isRecording();
    renderTutorTarget();
    $('range-start').value = range.start.toFixed(3); $('range-end').value = range.end.toFixed(3);
    $('range-display').textContent = `${C.formatTime(range.start, true)} → ${C.formatTime(range.end, true)}`;
    $('a-duration').textContent = exists ? `范围 ${(range.end - range.start).toFixed(1)} 秒` : '';
    $('previous').disabled = !exists || selected[0] === 0 || isRecording();
    $('next').disabled = $('merge-next').disabled = !exists || selected.at(-1) >= session.cues.length - 1 || isRecording();
    renderLoop();
    publishContext().catch(() => {});
  }
  async function publishContext(mode = contextMode, select = false, chapter = contextChapter) {
    if (!pageContext || !video?.videoId) return;
    contextMode = mode;
    contextChapter = chapter;
    const { selection, bounds, scope } = learningMaterial(chapter);
    const context = selection.length ? {
      prompt: C.buildPrompt({ video, cues: session.cues, selected: selection, range: bounds, mode, scope, question: $('question').value.trim() }),
      text: selection.map(i => session.cues[i].text).join(' '),
      start: C.formatTime(bounds.start, true), end: C.formatTime(bounds.end, true)
    } : null;
    const message = { workspaceId, producerId, videoId: video.videoId, seq: ++contextSeq, context, select, recording: isRecording() };
    if (embeddedPreview) window.parent.postMessage({ type: 'STUDIO_CONTEXT_PREVIEW', ...message }, location.origin);
    else {
      const result = await send('STUDIO_CONTEXT', message);
      if (select && !result?.updated) throw new Error('页面学习卡片没有更新。请刷新 YouTube 后重新打开本插件。');
    }
  }
  async function prepareContext(mode, chapter = $('learning-scope').value === 'chapter') {
    ensureVideo();
    const material = learningMaterial(chapter);
    if (!material.selection.length) throw new Error(chapter ? '请先读取字幕。' : '请先选择一句或连续片段。');
    contextMode = mode; contextChapter = chapter;
    const names = { understand: '理解与讨论', expressions: '学习表达', respond: '我来说', pronunciation: '录音反馈请求' };
    $('task-status').textContent = `准备：${names[mode] || names.understand} · ${materialLabel(material.selection, material.bounds, material.scope)}`;
    if (chapter) $('follow').checked = false;
    if (!pageContext) { await copyPrompt(mode, chapter); return; }
    if (!chapter) ensureSelection();
    await publishContext(mode, true, chapter);
    notice('任务与上下文已在 YouTube 页面卡片中选中。回到视频页，在选中文字上右键 → Ask ChatGPT。也可使用备用复制；没有自动发送或附加录音。');
  }
  function renderLoop() { $('loop').setAttribute('aria-pressed', loop); $('loop').textContent = loop ? '↺ 循环开启' : '↺ 循环关闭'; }
  function cancelAudio() {
    audio.pause(); audio.currentTime = 0;
    if (playbackResolver) { const reject = playbackResolver.reject; playbackResolver = null; reject(new DOMException('播放已停止。', 'AbortError')); }
  }
  function finishSequence() { sequence = null; $('comparison-status').textContent = '对比结束。可以再听、再录，或只练一个改进点。'; }
  async function stopPlayback() {
    sequence = null; loop = false; renderLoop(); cancelAudio();
    if (video?.videoId && tabId !== null) { try { await control('cancel'); } catch { /* A replaced/closed video must not block local cleanup. */ } }
    $('comparison-status').textContent = '播放已停止。';
  }
  async function playOriginal() {
    ensureSelection(); ensureNotRecording();
    sequence = null; cancelAudio();
    C.validateRange(range.start, range.end, video.duration);
    await control('playRange', { ...range, loop, token: `original-${Date.now()}` });
    $('comparison-status').textContent = loop ? 'A · 原句循环中，再点循环可关闭。' : 'A · 原句播放中';
  }
  function matchingAttempts() {
    if (!selected.length || !video?.videoId) return [];
    const key = currentSnapshot().practiceKey;
    return attempts.filter(a => a.target.practiceKey === key);
  }
  function currentAttempt() { const rows = matchingAttempts(); return rows.find(a => a.id === chosenAttempt) || rows.at(-1); }
  function renderAttempts() {
    const rows = selected.length ? matchingAttempts() : [];
    const container = $('attempts'); container.replaceChildren();
    if (!rows.some(a => a.id === chosenAttempt)) chosenAttempt = rows.at(-1)?.id || '';
    $('no-attempts').hidden = rows.length > 0;
    for (const item of rows) {
      const row = document.createElement('div'); row.className = `attempt${item.pinned ? ' pinned' : ''}`;
      const label = document.createElement('label');
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'attempt'; radio.value = item.id; radio.checked = item.id === chosenAttempt;
      radio.addEventListener('change', () => { chosenAttempt = item.id; });
      const text = document.createElement('span'); text.textContent = `第 ${item.number} 次 · ${item.duration.toFixed(1)} 秒`;
      label.append(radio, text); row.append(label);
      const actions = [
        ['▶', '播放这次录音', guarded(async () => { await stopPlayback(); chosenAttempt = item.id; renderAttempts(); await playAttempt(item); })],
        [item.pinned ? '★' : '☆', item.pinned ? '取消固定' : '固定保留这次录音', guarded(() => { if (!item.pinned && attempts.filter(a => a.pinned).length >= 10) throw new Error('最多固定 10 次尝试，请先取消一个固定。'); item.pinned = !item.pinned; renderAttempts(); })],
        ['↓', '下载这次录音', () => downloadAttempt(item)],
        ['×', '删除这次录音', guarded(async () => { await stopPlayback(); removeAttempt(item); renderAttempts(); })]
      ];
      for (const [text, title, click] of actions) { const button = document.createElement('button'); button.textContent = text; button.title = title; button.setAttribute('aria-label', title); button.addEventListener('click', click); button.disabled = isRecording(); row.append(button); }
      container.append(row);
    }
    $('compare').disabled = !rows.length || isRecording();
    $('compare-progress').disabled = rows.length < 2 || isRecording();
  }
  function removeAttempt(item) {
    const index = attempts.indexOf(item);
    if (index >= 0) attempts.splice(index, 1);
    if (audio.src === item.url) { audio.pause(); audio.removeAttribute('src'); audio.hidden = true; }
    URL.revokeObjectURL(item.url);
  }
  function downloadAttempt(item) {
    const ext = item.blob.type.includes('mp4') ? 'm4a' : item.blob.type.includes('ogg') ? 'ogg' : 'webm';
    const link = document.createElement('a'); link.href = item.url;
    link.download = `${safeName(item.target.videoTitle)}_${C.formatTime(item.target.startTime).replaceAll(':', '-')}_attempt-${item.number}.${ext}`;
    link.hidden = true; document.body.append(link); link.click(); link.remove();
    notice('已请求下载。若 GPT 不支持该音频格式，需要另行转换或使用支持音频的入口；字幕文本无法替代发音证据。');
  }
  function playAttempt(item, withinSequence = false) {
    ensureNotRecording();
    if (!withinSequence) sequence = null;
    cancelAudio();
    audio.hidden = false; audio.src = item.url; audio.playbackRate = 1;
    return new Promise((resolve, reject) => {
      playbackResolver = { resolve, reject };
      audio.play().catch(() => { playbackResolver = null; reject(new Error('录音自动播放被阻止，请在音频控件中点播放。')); });
    });
  }
  audio.addEventListener('ended', () => { if (playbackResolver) { const resolve = playbackResolver.resolve; playbackResolver = null; resolve(); } });
  audio.addEventListener('error', () => { if (playbackResolver) { const reject = playbackResolver.reject; playbackResolver = null; reject(new Error('这次录音无法播放，请重录或检查音频设备。')); } });
  audio.addEventListener('play', () => {
    if (isRecording()) { audio.pause(); return; }
    if (!sequence && video?.videoId) control('pause').catch(() => {});
  });
  async function compare() {
    ensureSelection(); ensureNotRecording();
    const item = currentAttempt(); if (!item) throw new Error('请先录一遍。');
    await stopPlayback();
    const token = `compare-${Date.now()}`;
    sequence = { phase: 'starting', end: item.target.endTime, attempt: item, token };
    const current = sequence;
    try {
      await control('playRange', { start: item.target.startTime, end: item.target.endTime, loop: false, token });
      if (sequence !== current) return;
      sequence.phase = 'original';
      $('comparison-status').textContent = `A · 原声播放后接第 ${item.number} 次录音。A 使用该次录音绑定的范围；B 按 1× 播放。`;
    } catch (error) { sequence = null; throw error; }
  }
  async function compareProgress() {
    ensureNotRecording();
    const rows = matchingAttempts(); if (rows.length < 2) return;
    await stopPlayback();
    const current = { phase: 'attempts' }; sequence = current;
    try {
      $('comparison-status').textContent = `正在播放最早保留的第 ${rows[0].number} 次录音`;
      await playAttempt(rows[0], true);
      if (sequence !== current) return;
      $('comparison-status').textContent = `正在播放最新的第 ${rows.at(-1).number} 次录音`;
      await playAttempt(rows.at(-1), true);
      if (sequence === current) finishSequence();
    } catch (error) { if (sequence === current) { finishSequence(); throw error; } }
  }
  function recordingUI() {
    const busy = isRecording();
    audio.controls = !busy;
    $('record').disabled = busy || !selected.length;
    $('stop-record').disabled = !busy;
    $('record-indicator').textContent = recordingPending ? '等待麦克风授权' : busy ? '正在录音' : '准备就绪';
    $('record-indicator').classList.toggle('live', busy && !recordingPending);
    for (const id of ['play-original', 'loop', 'speed', 'apply-range', 'set-a', 'set-b', 'merge-next', 'next', 'previous', 'apply-offset', 'import-text', 'subtitle-file', 'connect', 'learning-scope', 'selection-clear', 'selection-play', 'selection-discuss', 'chapter-copy']) $(id).disabled = busy;
    renderVideo(); renderAttempts(); renderTarget();
    publishContext().catch(() => {});
  }
  async function startRecording() {
    ensureSelection(); ensureNotRecording();
    const target = currentSnapshot(), expectedTab = tabId, expectedEpoch = connectionEpoch;
    recordingPending = true; discarded = false; recordingUI();
    let captured;
    try {
      await stopPlayback();
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('当前页面不支持录音，请使用 Chrome 插件侧栏或 localhost 预览。');
      captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const latest = await send('STUDIO_STATE', {}, expectedTab);
      if (latest.videoId !== target.videoId || expectedEpoch !== connectionEpoch || discarded) throw new Error('等待授权期间视频发生变化，未开始录音，请重新选句。');
      await control('pause', {}, latest, expectedTab);
      stream = captured; recordingTarget = target;
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      const currentRecorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      recorder = currentRecorder;
      const chunks = []; let size = 0, failed = false;
      currentRecorder.addEventListener('dataavailable', event => {
        if (event.data.size) { chunks.push(event.data); size += event.data.size; }
        if (size > 12 * 1024 * 1024 && currentRecorder.state !== 'inactive') { notice('本次录音已较长，已停止以控制内存。可继续重录下一次。'); currentRecorder.stop(); }
      });
      currentRecorder.addEventListener('error', () => { failed = true; notice('录音设备发生错误，请检查麦克风后重录。', true); });
      currentRecorder.addEventListener('stop', () => {
        const duration = (performance.now() - recordingStarted) / 1000;
        captured.getTracks().forEach(track => track.stop());
        clearInterval(recordTimer); recordTimer = null; stream = null; recorder = null; recordingTarget = null;
        if (!discarded && !failed && chunks.length && duration > 0.1) {
          const blob = new Blob(chunks, { type: currentRecorder.mimeType || chunks[0].type || 'audio/webm' });
          const existing = attempts.filter(a => a.target.practiceKey === target.practiceKey);
          const number = (sessionCounters.get(target.practiceKey) || 0) + 1; sessionCounters.set(target.practiceKey, number);
          // Unlimited retries, bounded retained memory. Never delete pinned attempts automatically.
          const unpinned = existing.filter(a => !a.pinned);
          while (unpinned.length >= 5) removeAttempt(unpinned.shift());
          while (attempts.reduce((sum, a) => sum + a.blob.size, 0) + blob.size > 80 * 1024 * 1024) {
            const oldest = attempts.find(a => !a.pinned);
            if (!oldest) break;
            removeAttempt(oldest);
          }
          if (attempts.reduce((sum, a) => sum + a.blob.size, 0) + blob.size <= 80 * 1024 * 1024) {
            const item = { id: crypto.randomUUID(), target, blob, url: URL.createObjectURL(blob), duration, number, pinned: false };
            attempts.push(item); chosenAttempt = item.id;
            notice(`第 ${number} 次录音已保留在当前练习会话。可以回听、对比或下载。`);
          } else notice('会话录音内存已满。请下载并删除部分固定录音后重录。', true);
        } else if (!discarded && !failed) notice('没有采集到有效音频，请检查麦克风后重新录制。', true);
        recordingPending = false; recordingUI(); renderTarget();
      });
      recordingStarted = performance.now();
      currentRecorder.start(500);
      recordingPending = false; recordingUI();
      recordTimer = setInterval(() => { $('record-time').textContent = C.formatTime((performance.now() - recordingStarted) / 1000); }, 200);
      notice('正在录音。目标句已固定，点击“停止录音”完成这一遍。');
    } catch (error) {
      captured?.getTracks().forEach(track => track.stop());
      stream = null; recordingPending = false; recorder = null; recordingTarget = null; recordingUI();
      const errors = { NotAllowedError: '麦克风权限未允许。请点击下方“打开授权页”，允许插件访问麦克风后重试。', NotFoundError: '没有找到麦克风，请连接设备后重试。', NotReadableError: '麦克风无法使用，可能被其他程序占用。请检查设备后重试。' };
      throw new Error(errors[error.name] || error.message);
    }
  }
  const sessionCounters = new Map();
  function stopRecording() {
    if (recordingPending && !recorder) { discarded = true; notice('已取消本次录音请求；如授权提示仍在，请关闭提示。'); return; }
    if (recorder && recorder.state !== 'inactive') { $('stop-record').disabled = true; recorder.stop(); }
  }
  async function copyPrompt(mode, chapter = false) {
    ensureVideo();
    const { selection, bounds, scope } = learningMaterial(chapter);
    const text = C.buildPrompt({ video, cues: session.cues, selected: selection, range: bounds, mode, scope, question: $('question').value.trim() });
    try { await navigator.clipboard.writeText(text); notice('已复制原文、时间戳、前后文与任务。请自行粘贴到 GPT；应用没有发送任何内容。'); }
    catch { $('copy-fallback').hidden = false; $('copy-fallback').open = true; $('copy-text').value = text; showTab('tutor'); $('copy-text').focus(); $('copy-text').select(); notice('浏览器未允许直接复制，已展开可手动复制的内容。'); }
  }

  $('connect').addEventListener('click', guarded(connect));
  $('extract').addEventListener('click', guarded(extract));
  $('toggle-play').addEventListener('click', guarded(async () => {
    ensureNotRecording(); ensureVideo();
    const state = await send('STUDIO_STATE');
    if (!state.paused) await stopPlayback();
    else { await stopPlayback(); await control('seek', { time: state.currentTime, play: true }); }
  }));
  for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => showTab(button.dataset.tab));
  $('chapter').addEventListener('change', () => { currentChapter = $('chapter').value; $('follow').checked = false; renderTranscript(); if (contextChapter) publishContext().catch(() => {}); });
  $('learning-scope').addEventListener('change', () => { contextChapter = $('learning-scope').value === 'chapter'; $('follow').checked = false; renderTutorTarget(); publishContext().catch(() => {}); });
  $('search').addEventListener('input', () => { $('follow').checked = false; renderTranscript(); });
  $('import-text').addEventListener('click', guarded(async () => { ensureNotRecording(); await stopPlayback(); installCues(C.parseTranscript($('transcript-input').value, video?.duration || 0), '手工粘贴文字稿'); $('import-details').open = false; notice('文字稿已导入。请点击一条字幕核对时间是否与视频一致。'); }));
  $('subtitle-file').addEventListener('change', guarded(async () => {
    ensureNotRecording(); ensureVideo(); const file = $('subtitle-file').files[0]; if (!file) return;
    const expectedId = video.videoId, expectedEpoch = connectionEpoch;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('字幕文件大于 5 MB，请先缩小文件。');
      const text = await file.text();
      const latest = await send('STUDIO_STATE');
      if (latest.videoId !== expectedId || expectedEpoch !== connectionEpoch) throw new Error('读取文件时视频已切换，请重新连接后导入。');
      await stopPlayback(); installCues(C.parseTranscript(text, video?.duration || 0), `字幕文件 · ${file.name}`);
      $('import-details').open = false; notice('字幕已导入。请先核对视频版本与时间定位。');
    } finally { $('subtitle-file').value = ''; }
  }));
  $('apply-offset').addEventListener('click', guarded(async () => {
    ensureNotRecording(); ensureVideo();
    if (!session.baseCues.length) throw new Error('请先导入字幕。');
    const offset = Number($('offset').value); if (!Number.isFinite(offset)) throw new Error('请输入有效的偏移秒数。');
    if (session.baseCues.some(c => c.startTime + offset < 0 || video.duration && c.endTime + offset > video.duration + .05)) throw new Error('偏移会使部分字幕超出视频范围，请减小偏移量。');
    await stopPlayback();
    const built = C.makeSegments(session.baseCues.map(c => ({ ...c, startTime: c.startTime + offset, endTime: c.endTime + offset })));
    session.cues = built.cues; session.segments = built.segments; session.offset = offset;
    selected = []; selectionAnchor = null; resetStudyScope(); renderChapters(); renderTranscript(); renderTarget(); renderAttempts(); renderVideo(); notice('字幕偏移已应用。请重新选句核对。');
  }));
  $('back-to-transcript').addEventListener('click', () => showTab('transcript'));
  $('previous').addEventListener('click', guarded(() => choose(selected[0] - 1)));
  $('next').addEventListener('click', guarded(() => choose(selected.at(-1) + 1)));
  $('merge-next').addEventListener('click', guarded(async () => {
    ensureNotRecording(); ensureSelection();
    const index = selected.at(-1) + 1; if (!session.cues[index]) return;
    selectionAnchor = selected[0]; await choosePassage(index);
  }));
  $('apply-range').addEventListener('click', guarded(async () => {
    ensureNotRecording(); ensureSelection();
    const next = C.validateRange(Number($('range-start').value), Number($('range-end').value), video.duration);
    await stopPlayback(); range = next; renderTarget();
  }));
  for (const [id, boundary] of [['set-a', 'start'], ['set-b', 'end']]) $(id).addEventListener('click', guarded(async () => {
    ensureNotRecording(); ensureSelection();
    const state = await send('STUDIO_STATE');
    const next = C.validateRange(boundary === 'start' ? state.currentTime : range.start, boundary === 'end' ? state.currentTime : range.end, video.duration);
    await stopPlayback(); range = next; renderTarget();
  }));
  $('play-original').addEventListener('click', guarded(playOriginal));
  $('loop').addEventListener('click', guarded(async () => { ensureNotRecording(); loop = !loop; renderLoop(); if (loop) await playOriginal(); else await stopPlayback(); }));
  $('stop-all').addEventListener('click', guarded(stopPlayback));
  $('speed').addEventListener('change', guarded(async () => { ensureNotRecording(); await control('rate', { rate: Number($('speed').value) }); }));
  $('record').addEventListener('click', guarded(startRecording));
  $('stop-record').addEventListener('click', stopRecording);
  $('compare').addEventListener('click', guarded(compare));
  $('compare-progress').addEventListener('click', guarded(compareProgress));
  $('selection-play').addEventListener('click', guarded(playOriginal));
  $('selection-discuss').addEventListener('click', guarded(() => { $('learning-scope').value = 'selection'; contextChapter = false; showTab('tutor'); renderTutorTarget(); }));
  $('selection-clear').addEventListener('click', guarded(async () => {
    ensureNotRecording(); await stopPlayback(); selected = []; selectionAnchor = null; chosenAttempt = ''; range = { start: 0, end: 0 }; resetStudyScope();
    renderTarget(); renderTranscript(); renderAttempts();
  }));
  $('practice-copy').addEventListener('click', guarded(() => { $('learning-scope').value = 'selection'; renderTutorTarget(); return prepareContext('pronunciation', false); }));
  $('chapter-copy').addEventListener('click', guarded(() => { $('learning-scope').value = 'chapter'; contextChapter = true; showTab('tutor'); renderTutorTarget(); return prepareContext('understand', true); }));
  for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', guarded(() => prepareContext(button.dataset.prompt)));
  $('question').addEventListener('input', () => publishContext().catch(() => {}));
  $('copy-backup').addEventListener('click', guarded(() => copyPrompt(contextMode, contextChapter)));
  $('independent-workspace').addEventListener('click', guarded(async () => {
    ensureNotRecording(); ensureVideo();
    if (preview) { notice('独立练习窗口只在安装后的插件中可用。'); return; }
    await stopPlayback();
    await chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?hostTabId=${tabId}&workspaceId=${encodeURIComponent(workspaceId)}`) });
    notice('已打开独立练习页；它有独立录音会话，不会搬移本页录音。先回到原视频，再读取或导入字幕。');
  }));
  $('mic-setup').addEventListener('click', guarded(async () => { if (preview) { notice('预览页请使用浏览器地址栏的麦克风权限设置。'); return; } await chrome.tabs.create({ url: chrome.runtime.getURL('microphone.html') }); }));
  $('clear-recordings').addEventListener('click', guarded(async () => {
    if (!attempts.length && !isRecording()) { notice('当前会话没有录音。'); return; }
    // Audio deletion is irreversible within this ephemeral session; the human confirms it.
    if (!confirm('删除当前练习会话的全部临时录音？已下载的文件不会被删除。此操作不能撤销。')) return;
    discarded = true; stopRecording(); await stopPlayback();
    for (const item of [...attempts]) removeAttempt(item); renderAttempts(); notice('本次会话的临时录音已删除。');
  }));
  addEventListener('beforeunload', () => {
    discarded = true;
    stream?.getTracks().forEach(track => track.stop());
    disconnectPort();
    for (const item of attempts) URL.revokeObjectURL(item.url);
  });
  // Preview is explicit and isolated from extension builds: synthetic captions, no fake AI scores.
  const previewTranscript = '0:00\nLearning a little at a time helps me stay focused.\n0:06\nI want to understand the idea before I try to explain it.\n0:12\nCould you walk me through one small example?\n0:18\nLet me put that into my own words.\n0:24\nWhen I work with data, I start by checking my assumptions.\n0:31\nThe point is to make steady progress, one sentence at a time.\n0:39\nI would rather practise a useful phrase than memorize a long list.\n0:47\nWhat matters most is being clear enough to keep the conversation going.\n0:56\nNow I can try again with a different example.';
  const previewVideo = { videoId: 'preview-only', title: 'A little at a time · 界面演示（创作示例）', url: 'https://www.youtube.com/', duration: 66, currentTime: 0, paused: true, rate: 1, ad: false, muted: false, range: null };
  async function previewSend(type, data) {
    if (type === 'STUDIO_STATE') return { ...previewVideo, range: previewVideo.range ? { ...previewVideo.range } : null };
    if (type === 'STUDIO_EXTRACT') return { videoId: previewVideo.videoId, cues: C.parseTranscript(previewTranscript, 66), source: '创作演示字幕', warnings: ['演示文字不是视频原文。'] };
    if (type === 'STUDIO_COMMAND') {
      if (data.action === 'rate') previewVideo.rate = data.rate;
      if (data.action === 'cancel' || data.action === 'pause') { previewVideo.range = null; previewVideo.paused = true; }
      if (data.action === 'seek') { previewVideo.range = null; previewVideo.currentTime = data.time; if (data.play) previewVideo.paused = false; }
      if (data.action === 'playRange') { previewVideo.currentTime = data.start; previewVideo.range = { start: data.start, end: data.end, loop: data.loop, token: data.token }; previewVideo.paused = false; }
      return { ...previewVideo };
    }
  }
  if (preview) {
    previewStarted = performance.now();
    previewClock = setInterval(() => {
      const now = performance.now(), elapsed = (now - previewStarted) / 1000; previewStarted = now;
      if (!previewVideo.paused) {
        previewVideo.currentTime += elapsed * previewVideo.rate;
        if (previewVideo.range && previewVideo.currentTime >= previewVideo.range.end) {
          if (previewVideo.range.loop) previewVideo.currentTime = previewVideo.range.start;
          else { previewVideo.currentTime = previewVideo.range.end; previewVideo.range = null; previewVideo.paused = true; }
        } else if (previewVideo.currentTime >= previewVideo.duration) { previewVideo.currentTime = previewVideo.duration; previewVideo.paused = true; }
      }
    }, 100);
  }
  setInterval(poll, 350);
  if (embedded) chrome.runtime.sendMessage({ type: 'STUDIO_WORKSPACE_READY', workspaceId }).catch(() => {});
  guarded(connect)();
})();
