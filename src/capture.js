class PracticeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.factor = Math.max(1, Math.floor(sampleRate / 12000));
    this.rate = sampleRate / this.factor;
    this.frame = new Float32Array(Math.round(this.rate * 0.09));
    this.hop = Math.round(this.rate * 0.045);
    this.channel = 0;
    this.channelCount = 0;
    this.reset();
    this.port.onmessage = ({ data }) => {
      this.channel = data.channel;
      this.reset();
    };
  }

  reset() {
    this.filled = 0;
    this.sum = 0;
    this.count = 0;
    this.clipped = false;
    this.peak = 0;
  }

  process(inputs) {
    const channels = inputs[0] ?? [];
    if (channels.length !== this.channelCount) {
      this.channelCount = channels.length;
      this.reset();
      this.port.postMessage({ channelCount: channels.length });
    }
    const samples = channels[this.channel];
    if (!samples) return true;

    for (const [index, sample] of samples.entries()) {
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.sum += sample;
      this.count++;
      if (this.count < this.factor) continue;
      this.frame[this.filled++] = this.sum / this.factor;
      this.sum = 0;
      this.count = 0;
      if (this.filled < this.frame.length) continue;

      const window = this.frame.slice();
      this.port.postMessage({
        samples: window, rate: this.rate, channel: this.channel,
        time: (currentFrame + index + 1) * 1000 / sampleRate,
        clipped: this.clipped || this.peak >= 0.98,
      }, [window.buffer]);
      this.clipped = this.peak >= 0.98;
      this.peak = 0;
      this.frame.copyWithin(0, this.hop);
      this.filled = this.frame.length - this.hop;
    }
    return true;
  }
}

registerProcessor("practice-capture", PracticeCapture);
