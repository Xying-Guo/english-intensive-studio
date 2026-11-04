'use strict';
document.getElementById('grant-mic').addEventListener('click', async event => {
  const result = document.getElementById('mic-result');
  event.target.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    result.textContent = '已获得麦克风权限，并立即释放设备。\n现在可关闭此页，回到侧边栏开始录音。';
  } catch (error) {
    result.textContent = `未能获得麦克风权限（${error.name}）。请检查 Chrome 和 Windows 的麦克风设置，再重试。`;
  } finally { event.target.disabled = false; }
});
