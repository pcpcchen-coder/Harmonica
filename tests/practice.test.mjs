import test from "node:test";
import assert from "node:assert/strict";
import { frequency, lessonSteps, lessons, profiles, tonics } from "../src/lessons.mjs";
import { centsBetween, makePitchDetector } from "../src/pitch.mjs";
import { PracticeSession } from "../src/session.mjs";

function tone(rate, hz, level = 0.25) {
  return Float32Array.from({ length: Math.round(rate * 0.09) }, (_, i) => {
    const phase = 2 * Math.PI * hz * i / rate;
    return level * (Math.sin(phase) + 0.38 * Math.sin(2 * phase) + 0.18 * Math.sin(3 * phase));
  });
}

test("detects C4 through C5 with harmonics at each supported analysis rate", () => {
  for (const rate of [12000, 14700, 16000]) {
    const detector = makePitchDetector(rate, Math.round(rate * 0.09));
    for (const midi of [60, 62, 64, 65, 67, 69, 71, 72]) {
      const hz = frequency(midi);
      const detected = detector(tone(rate, hz), -45).hz;
      assert.ok(detected && Math.abs(centsBetween(detected, hz)) < 8, `${rate} Hz sample rate, MIDI ${midi}`);
    }
  }
});

test("handles the full range of selectable tonic notes and their upper octave", () => {
  const rate = 12000;
  const detector = makePitchDetector(rate, 1080);
  for (const midi of [...tonics, ...tonics.map((midi) => midi + 12)]) {
    const hz = frequency(midi);
    const wave = Float32Array.from(tone(rate, hz), (_, i) => 0.25 * Math.sin(2 * Math.PI * hz * i / rate));
    const detected = detector(wave, -45).hz;
    assert.ok(detected && Math.abs(centsBetween(detected, hz)) < 30, `MIDI ${midi}`);
  }
});

test("does not assign a pitch to silence, low signal, clipped input, or white noise", () => {
  const rate = 12000;
  const detector = makePitchDetector(rate, 1080);
  assert.equal(detector(new Float32Array(1080), -45).hz, null);
  assert.equal(detector(tone(rate, 440, 0.001), -45).hz, null);
  const clipped = Float32Array.from(tone(rate, 440, 2), (x) => Math.max(-1, Math.min(1, x)));
  assert.deepEqual([detector(clipped, -45).hz, detector(clipped, -45).clipped], [null, true]);
  let seed = 2048;
  const noise = Float32Array.from({ length: 1080 }, () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 0.2;
  });
  assert.equal(detector(noise, -45).hz, null);
});

test("uses the intended holes for both instrument layouts and can transpose pitch-only lessons", () => {
  const scale = lessons.find((lesson) => lesson.id === "scale");
  assert.deepEqual(lessonSteps(scale, profiles[0], 60).slice(0, 8).map((step) => step.tab),
    ["4 孔吹", "4 孔吸", "5 孔吹", "5 孔吸", "6 孔吹", "6 孔吸", "7 孔吸", "7 孔吹"]);
  assert.deepEqual(lessonSteps(scale, profiles[1], 60).slice(0, 8).map((step) => step.tab),
    ["1 孔吹", "1 孔吸", "2 孔吹", "2 孔吸", "3 孔吹", "3 孔吸", "4 孔吸", "4 孔吹"]);
  const steps = lessonSteps(scale, profiles[2], 57);
  assert.deepEqual(steps.slice(0, 8).map((step) => step.label), ["A3", "B3", "C♯4", "D4", "E4", "F♯4", "G♯4", "A4"]);
  assert.ok(steps.every((step) => step.tab === undefined));
});

test("a wrong frame or a gap resets the continuous hold", () => {
  const practice = new PracticeSession([{ midi: 60 }, { midi: 62 }], 100);
  const observe = (time, matches) => practice.observe({ time, matches, quiet: false });
  assert.equal(observe(0, true).progress, 0);
  assert.equal(observe(50, true).progress, 0.5);
  assert.equal(observe(70, false).progress, 0);
  assert.equal(observe(100, true).progress, 0);
  assert.equal(observe(300, true).progress, 0);
  assert.equal(observe(400, true).phase, "advance");
  assert.equal(practice.target.midi, 62);
  assert.equal(observe(450, true).progress, 0);
  assert.equal(observe(550, true).phase, "complete");
});

test("repeated notes require a continuous quiet gap before re-articulation", () => {
  const practice = new PracticeSession([{ midi: 64 }, { midi: 64 }], 100);
  const observe = (time, matches, quiet = false) => practice.observe({ time, matches, quiet });
  observe(0, true);
  assert.equal(observe(100, true).phase, "advance");
  assert.equal(observe(200, true).phase, "release");
  assert.equal(observe(250, false, true).phase, "release");
  assert.equal(observe(300, false).phase, "release");
  assert.equal(observe(400, false, true).phase, "release");
  assert.equal(observe(530, false, true).phase, "ready");
  observe(570, true);
  assert.equal(observe(670, true).phase, "complete");
});

test("interrupting for reference playback clears a partial hold and requires quiet", () => {
  const practice = new PracticeSession([{ midi: 60 }], 100);
  const observe = (time, matches, quiet = false) => practice.observe({ time, matches, quiet });
  observe(0, true);
  observe(90, true);
  practice.interrupt(true);
  assert.equal(observe(100, true).phase, "release");
  observe(180, false, true);
  assert.equal(observe(305, false, true).phase, "ready");
  assert.equal(observe(330, true).progress, 0);
  assert.equal(observe(430, true).phase, "complete");
});
