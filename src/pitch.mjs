// YIN-style cumulative mean normalized difference, with a fixed comparison
// length for every lag. A first strong minimum favors the fundamental period.
export function makePitchDetector(sampleRate, frameSize) {
  const firstLag = Math.max(2, Math.floor(sampleRate / 2300));
  const lastLag = Math.ceil(sampleRate / 115);
  const difference = new Float64Array(lastLag + 2);
  const comparisonLength = frameSize - lastLag - 1;
  const empty = { hz: null, rms: 0, clipped: false };

  return function detect(samples, minimumDb) {
    let sum = 0;
    let squares = 0;
    let clipped = false;
    for (const sample of samples) {
      sum += sample;
      squares += sample * sample;
      if (Math.abs(sample) >= 0.98) clipped = true;
    }
    const mean = sum / samples.length;
    const rms = Math.sqrt(Math.max(0, squares / samples.length - mean * mean));
    if (20 * Math.log10(rms) < minimumDb || rms === 0 || clipped) {
      return { ...empty, rms, clipped };
    }

    difference[0] = 1;
    let cumulative = 0;
    for (let lag = 1; lag <= lastLag + 1; lag++) {
      let total = 0;
      for (let index = 0; index < comparisonLength; index++) {
        const delta = samples[index] - samples[index + lag];
        total += delta * delta;
      }
      cumulative += total;
      difference[lag] = cumulative ? total * lag / cumulative : 1;
    }

    for (let lag = firstLag; lag <= lastLag; lag++) {
      if (difference[lag] >= 0.14) continue;
      while (lag < lastLag && difference[lag + 1] < difference[lag]) lag++;
      const left = difference[lag - 1];
      const center = difference[lag];
      const right = difference[lag + 1];
      if (right < center || left < center) break;
      const denominator = 2 * (left + right - 2 * center);
      const offset = denominator ? (left - right) / denominator : 0;
      return { hz: sampleRate / (lag + offset), rms, clipped };
    }
    return { ...empty, rms };
  };
}

export function centsBetween(hz, targetHz) {
  return 1200 * Math.log2(hz / targetHz);
}
