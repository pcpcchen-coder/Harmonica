const respeakerName = /respeaker|xvf.?3800/i;

export async function listInputs() {
  return (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === "audioinput" && device.deviceId !== "default" && device.deviceId !== "communications");
}

function openInput(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: { ideal: 6 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function connectMic(context, deviceId, onData) {
  let stream;
  try {
    const devices = await listInputs();
    const preferred = deviceId || devices.find((device) => respeakerName.test(device.label))?.deviceId;
    stream = await openInput(preferred);
    if (!preferred && !respeakerName.test(stream.getAudioTracks()[0].label)) {
      // Device labels may only be available once permission has been granted.
      const found = (await listInputs()).find((device) => respeakerName.test(device.label));
      if (found) {
        stopTracks(stream);
        stream = await openInput(found.deviceId);
      }
    }
    await context.audioWorklet.addModule(new URL("./capture.js", import.meta.url));
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "practice-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCountMode: "max",
      channelInterpretation: "discrete",
    });
    capture.port.onmessage = ({ data }) => onData(data);
    // The worklet only writes analysis data to its message port. Its audio
    // output is silence, so connecting it keeps it running without monitoring.
    source.connect(capture).connect(context.destination);

    return {
      track: stream.getAudioTracks()[0],
      capture,
      close() {
        capture.port.close();
        source.disconnect();
        capture.disconnect();
        stopTracks(stream);
      },
    };
  } catch (error) {
    stopTracks(stream);
    throw error;
  }
}

export function playReference(context, hz) {
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  const start = context.currentTime;
  oscillator.frequency.value = hz;
  volume.gain.setValueAtTime(0, start);
  volume.gain.linearRampToValueAtTime(0.12, start + 0.035);
  volume.gain.setValueAtTime(0.12, start + 0.42);
  volume.gain.linearRampToValueAtTime(0, start + 0.55);
  oscillator.connect(volume).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.55);
  oscillator.onended = () => {
    oscillator.disconnect();
    volume.disconnect();
  };
  return (start + 0.95) * 1000;
}
