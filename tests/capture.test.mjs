import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { centsBetween, makePitchDetector } from "../src/pitch.mjs";

const source = readFileSync(new URL("../src/capture.js", import.meta.url), "utf8");

function captureHarness(rate) {
  const messages = [];
  let Processor;
  const scope = {
    sampleRate: rate,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = { postMessage: (data) => messages.push(data) };
    },
    registerProcessor: (_name, implementation) => { Processor = implementation; },
  };
  runInNewContext(source, scope);
  const worklet = new Processor();
  function feed(seconds, channels) {
    const end = scope.currentFrame + seconds * rate;
    while (scope.currentFrame < end) {
      const inputs = channels.map((channel) => Float32Array.from({ length: 128 }, (_, index) => {
        return channel(scope.currentFrame + index);
      }));
      worklet.process([inputs]);
      scope.currentFrame += 128;
    }
  }
  return { messages, worklet, feed };
}

test("audio worklet reports real channel count and analyzes only the selected channel", () => {
  const rate = 48000;
  const { messages, worklet, feed } = captureHarness(rate);
  const channels = [293.6648, 261.6256].map((hz) => (index) => 0.3 * Math.sin(2 * Math.PI * hz * index / rate));
  feed(0.2, channels);
  assert.equal(messages[0].channelCount, 2);
  const first = messages.at(-1);
  assert.equal(first.channel, 0);
  assert.equal(first.rate, 12000);
  const detect = makePitchDetector(first.rate, first.samples.length);
  assert.ok(Math.abs(centsBetween(detect(first.samples, -45).hz, 293.6648)) < 8);
  worklet.port.onmessage({ data: { channel: 1 } });
  feed(0.2, channels);
  const second = messages.at(-1);
  assert.equal(second.channel, 1);
  assert.ok(second.time > first.time);
  assert.ok(Math.abs(centsBetween(detect(second.samples, -45).hz, 261.6256)) < 8);
  feed(0.2, channels.slice(0, 1));
  assert.equal(messages.at(-1).channelCount, 1);
});

test("audio worklet flags clipping even when averaging reduces the peak", () => {
  const { messages, feed } = captureHarness(48000);
  feed(0.2, [(index) => index === 0 ? 1 : 0]);
  const [first, next] = messages.filter(({ samples }) => samples);
  assert.equal(first.clipped, true);
  assert.ok(first.samples.every((sample) => Math.abs(sample) < 0.98));
  assert.equal(next.clipped, true);
  assert.equal(messages.at(-1).clipped, false);
});
