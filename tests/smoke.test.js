const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html must contain an inline script');

const elements = new Map();
function element(id = '') {
  if (elements.has(id)) return elements.get(id);
  const classes = new Set();
  const value = {
    id, value: '0', textContent: '', innerHTML: '', disabled: false,
    style: {}, dataset: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => force === undefined
        ? (classes.has(name) ? classes.delete(name) : classes.add(name))
        : (force ? classes.add(name) : classes.delete(name)),
      contains: name => classes.has(name),
    },
    addEventListener() {}, setAttribute() {}, querySelector() { return element(`${id}-child`); },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
  };
  elements.set(id, value);
  return value;
}

class FakeAudioContext {
  async decodeAudioData() {
    const data = new Float32Array([0, .25, .5, .75, 1, .5, 0, -.5]);
    return { sampleRate: 4, length: data.length, numberOfChannels: 1, getChannelData: () => data };
  }
  async close() {}
}

const storage = new Map();
const context = {
  console, Blob, ArrayBuffer, DataView, Float32Array, Uint8Array, Map, Math, Date, Number, String,
  performance: { now: () => 0 },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: fn => fn(),
  document: {
    body: element('body'), documentElement: element('root'),
    getElementById: id => element(id), querySelectorAll: () => [], addEventListener() {},
  },
  window: { AudioContext: FakeAudioContext, addEventListener() {}, devicePixelRatio: 1 },
  navigator: {}, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, val), removeItem: key => storage.delete(key),
  },
  getComputedStyle: () => ({ getPropertyValue: () => '#5B7B77' }),
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  Audio: function Audio() {}, confirm: () => false, location: { href: '' },
};

const instrumented = match[1].replace(
  /  \/\/ ===== 初期化 =====[\s\S]*?\}\)\(\);\s*$/,
  `  globalThis.__trimTest = {
    fmtLongTime, encodeWav, buildSelectedChunks,
    setSelection(total, start, end) {
      lastDuration = total; trimStartSec = start; trimEndSec = end;
      trimStartEl.value = String(start); trimEndEl.value = String(end);
    },
    setChunks(chunks) { chunkList = chunks; },
    getSelection() { return { start: trimStartSec, end: trimEndSec }; },
    normalizeTrimValues,
  };
})();`
);

vm.createContext(context);
vm.runInContext(instrumented, context);
const api = context.__trimTest;
assert.ok(api, 'test API should be exposed');

assert.equal(api.fmtLongTime(3661), '01:01:01');

const wav = api.encodeWav(new Float32Array([0, 1, -1]), 16000);
assert.equal(wav.type, 'audio/wav');
assert.equal(wav.size, 50);

api.setSelection(10, 9, 10);
api.normalizeTrimValues('start');
assert.deepEqual({ ...api.getSelection() }, { start: 7, end: 10 });

const sourceBlob = new Blob(['fake'], { type: 'audio/mp4' });
api.setChunks([{
  idx: 0, blob: sourceBlob, mimeType: 'audio/mp4', ext: 'mp4',
  startSec: 0, endSec: 2, durationSec: 2,
}]);
api.setSelection(2, 0, 2);

(async () => {
  const full = await api.buildSelectedChunks();
  assert.equal(full.length, 1);
  assert.equal(full[0].blob, sourceBlob);
  assert.equal(full[0].ext, 'mp4');

api.setSelection(2, .5, 1.5);
  const selected = await api.buildSelectedChunks();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].ext, 'wav');
  assert.equal(selected[0].mimeType, 'audio/wav');
  assert.equal(selected[0].durationSec, 1);
  assert.equal(selected[0].blob.size, 32044);
  console.log('trim smoke tests OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
