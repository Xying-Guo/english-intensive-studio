'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
test('timestamps handle SRT, VTT, hour-long video and invalid seconds', () => {
  assert.equal(C.parseTime('01:02:03,045'), 3723.045);
  assert.equal(C.parseTime('56:26'), 3386);
  assert.equal(C.parseTime('0:06.5'), 6.5);
  assert.ok(Number.isNaN(C.parseTime('1:75')));
  assert.equal(C.formatTime(3599.9999, true), '1:00:00.000');
});
test('copied YouTube transcript preserves source text and estimates endpoints', () => {
  const cues = C.parseTranscript('0:00\nA short example.\n0:06 Another sentence\ncontinued here.\n0:11\nThe final line.', 20);
  assert.equal(cues.length, 3); assert.equal(cues[1].text, 'Another sentence continued here.');
  assert.equal(cues[0].endTime, 6); assert.equal(cues[2].endTime, 20);
  assert.ok(cues.every(c => c.estimatedEnd && c.segmentId));
});
test('SRT preserves exact end times, including gaps and overlaps', () => {
  const cues = C.parseTranscript('1\n00:00:01,200 --> 00:00:03,400\nA &amp; B.\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line.', 10);
  assert.equal(cues[0].endTime, 3.4); assert.equal(cues[0].text, 'A & B.');
  assert.equal(cues[0].estimatedEnd, false); assert.equal(C.activeCueIndex(cues, 3.8), -1);
  assert.equal(C.activeCueIndex(cues, 4.5), 1);
});
test('VTT handles identifiers, settings, tags, comma and decimal timestamps', () => {
  const cues = C.parseTranscript('WEBVTT\n\ncue-a\n00:01.000 --> 00:02.500 align:start\n<i>Try this.</i>\n\ncue-b\n00:03.000 --> 00:04.000\nThen that.', 8);
  assert.equal(cues.length, 2); assert.equal(cues[0].text, 'Try this.'); assert.equal(cues[0].endTime, 2.5);
});
test('invalid input and wrong-video timestamps cannot silently produce usable captions', () => {
  assert.throws(() => C.parseTranscript('ordinary text without timestamps'));
  assert.throws(() => C.parseTranscript('1:00\nToo late.', 20));
  assert.throws(() => C.validateRange(5, 4, 20));
  assert.throws(() => C.validateRange(0, 30, 20));
  assert.throws(() => C.parseTranscript('1\n00:02,000 --> 00:01,000\nBackwards.'));
});
test('five-minute chapters include every cue once and prefer nearby sentence endings', () => {
  const rows = Array.from({ length: 1100 }, (_, i) => ({ startTime: i * 3, text: i % 5 === 0 ? 'Sentence ends.' : 'Sentence continues' }));
  const { cues, segments } = C.makeSegments(C.normalizeCues(rows, 3302));
  assert.ok(segments.length >= 10); assert.equal(cues.length, 1100);
  assert.equal(segments.reduce((n, s) => n + s.count, 0), 1100);
  for (let i = 1; i < segments.length; i++) assert.equal(segments[i].firstIndex, segments[i - 1].lastIndex + 1);
  for (const cue of cues) assert.ok(segments.some(s => s.id === cue.segmentId));
});
test('recording target is immutable and includes video, text and exact range', () => {
  const video = { videoId: 'original', title: 'Source', url: 'https://www.youtube.com/watch?v=original', duration: 20 };
  const cues = C.parseTranscript('0:00\nOne.\n0:06\nTwo.', 20);
  const target = C.snapshot(video, cues, [0], { start: 0.2, end: 5.8 });
  video.videoId = 'different'; cues[0].text = 'Edited';
  assert.equal(target.videoId, 'original'); assert.equal(target.text, 'One.');
  assert.equal(target.startTime, .2); assert.equal(target.endTime, 5.8); assert.ok(Object.isFrozen(target));
});
test('GPT context labels estimated times and separates source from generated examples/audio judgments', () => {
  const cues = C.parseTranscript('0:00\nBefore.\n0:05\nTarget.\n0:10\nAfter.', 15);
  const text = C.buildPrompt({ video: { title: 'Test', url: 'source' }, cues, selected: [1], range: { start: 5, end: 10 }, mode: 'pronunciation' });
  assert.match(text, /Target/); assert.match(text, /Before/); assert.match(text, /After/);
  assert.match(text, /终点估计/); assert.match(text, /只有文本/); assert.match(text, /没有自动获得视频原声音频/);
  assert.match(text, /创作例句/);
});
