'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { transcriptScrollTop: follow } = require('../core');
const area = { scrollTop: 200, viewportHeight: 300, contentHeight: 2000 };
test('follow leaves a comfortably visible sentence in place', () => {
  assert.equal(follow({ ...area, itemTop: 250, itemHeight: 90 }), 200);
});
test('follow centers an offscreen sentence using only the transcript scroll position', () => {
  assert.equal(follow({ ...area, itemTop: 800, itemHeight: 100 }), 700);
  assert.equal(follow({ ...area, itemTop: 50, itemHeight: 100 }), 0);
});
test('follow clamps at first and last rows and handles a sentence taller than the viewport', () => {
  assert.equal(follow({ ...area, itemTop: 1950, itemHeight: 50 }), 1700);
  assert.equal(follow({ ...area, itemTop: 600, itemHeight: 500 }), 580);
  assert.equal(follow({ scrollTop: 0, viewportHeight: 300, contentHeight: 120, itemTop: 0, itemHeight: 100 }), 0);
});
test('hidden or invalid layout measurements do not produce a scrolling jump', () => {
  assert.equal(follow({ ...area, viewportHeight: 0, itemTop: 800, itemHeight: 100 }), 200);
  assert.equal(follow({ ...area, itemTop: NaN, itemHeight: 100 }), 200);
});
