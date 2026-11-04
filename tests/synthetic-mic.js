// Local test harness ONLY. Loaded by the loopback preview server with ?testRecorder=1.
// Uses a real MediaRecorder and a generated tone; never opens the physical microphone.
(function () {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) return;
  let denied = false;
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async () => {
    if (denied) throw new DOMException('Synthetic denied permission', 'NotAllowedError');
    const context = new AudioContext();
    const source = context.createOscillator(); source.frequency.value = 220;
    const destination = context.createMediaStreamDestination();
    const gain = context.createGain(); gain.gain.value = 0.03;
    source.connect(gain); gain.connect(destination); source.start();
    await context.resume();
    const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
    track.stop = () => { stop(); source.stop(); context.close(); };
    return destination.stream;
  };
  const bar = document.createElement('div');
  bar.style.cssText = 'position:sticky;top:0;z-index:20;padding:10px;background:#fff0d6;font:12px sans-serif';
  const label = document.createElement('strong'); label.textContent = '测试音源：220 Hz 合成音，不是麦克风或人声。';
  const button = document.createElement('button'); button.textContent = '模拟麦克风拒绝';
  button.addEventListener('click', () => { denied = !denied; button.textContent = denied ? '恢复合成音源' : '模拟麦克风拒绝'; });
  bar.append(label, button); document.body.prepend(bar);
})();
