'use strict';
if(new URLSearchParams(location.search).get('layout')==='normal'){
  document.getElementById('player-full-bleed-container').style.display='none';
  document.getElementById('player').style.display='block';
  document.getElementById('player-container-inner').append(document.getElementById('movie_player'));
  document.getElementById('fixture-mode').textContent='普通播放器结构测试';
}else document.getElementById('fixture-mode').textContent='宽屏播放器结构测试';
