// Timing uses AudioContext timestamps from the capture thread. Repeated notes
// require real silence, while a different next note can be played legato.
export class PracticeSession {
  constructor(steps, holdMs) {
    this.steps = steps;
    this.holdMs = holdMs;
    this.index = 0;
    this.needsRelease = false;
    this.interrupt();
  }

  get target() {
    return this.steps[this.index];
  }

  interrupt(requireRelease = false) {
    this.since = null;
    this.lastTime = null;
    if (requireRelease) this.needsRelease = true;
  }

  observe({ time, quiet, matches }) {
    if (!this.target) return { phase: "complete", progress: 1 };
    if (this.lastTime !== null && (time <= this.lastTime || time - this.lastTime > 150)) {
      this.since = null;
    }
    this.lastTime = time;

    if (this.needsRelease) {
      this.since = quiet ? (this.since ?? time) : null;
      if (this.since !== null && time - this.since >= 120) {
        this.needsRelease = false;
        this.since = null;
        return { phase: "ready", progress: 0 };
      }
      return { phase: "release", progress: 0 };
    }

    this.since = matches ? (this.since ?? time) : null;
    const progress = this.since === null ? 0 : Math.min(1, (time - this.since) / this.holdMs);
    if (progress < 1) return { phase: "hold", progress };

    const previous = this.target;
    this.index++;
    this.since = null;
    this.needsRelease = this.target?.midi === previous.midi;
    return { phase: this.target ? "advance" : "complete", progress: 1 };
  }
}
