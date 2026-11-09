import { connectMic, listInputs, playReference } from "./audio.mjs";
import { lessonSteps, lessons, noteName, profiles, tonics } from "./lessons.mjs";
import { centsBetween, makePitchDetector } from "./pitch.mjs";
import { PracticeSession } from "./session.mjs";

const ui = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), (node) => [node.id, node]));
const MIN_DB = -70;
const MAX_DB = -20;
const TOLERANCE = 40;
const REFERENCE_MS = 950;
let lesson;
let session;
let context;
let mic;
let connecting = false;
let channelCount = 0;
let calibration;
let detector;
let detectorRate;
let frameSize;
let acceptAfter = 0;
let referenceUntil = 0;
let referenceBusy = false;
let marks = [];
const storageKey = "harmonica.completed.v1";
const completed = new Set(loadCompleted());

function loadCompleted() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function selectOptions(select, options, value) {
  select.replaceChildren(...options.map(([key, label]) => new Option(label, key)));
  if (options.some(([key]) => String(key) === String(value))) select.value = value;
}

function completionKey(id) {
  return [ui.profile.value, ui.tonic.value, id].join("/");
}

function listLessons(id) {
  selectOptions(ui.lesson, lessons.map(({ id, title }, index) => {
    const done = completed.has(completionKey(id)) ? " · 已完成" : "";
    return [id, `${index + 1}. ${title}${done}`];
  }), id);
}

function showFeedback(message) {
  if (ui.feedback.textContent !== message) ui.feedback.textContent = message;
}

function renderTarget() {
  const target = session.target;
  const { index, steps } = session;
  ui.target.textContent = target ? `${target.degree} · ${target.label}` : "本課完成";
  ui.step.textContent = target
    ? `第 ${index + 1}／${steps.length} 音${target.tab ? ` · ${target.tab}` : ""}`
    : `完成 ${steps.length}／${steps.length} 音`;
  ui.reference.disabled = !target || referenceBusy;
  ui.next.hidden = Boolean(target) || lesson === lessons.at(-1);
  ui.hold.value = target ? 0 : 1;
  if (index > 0) {
    marks[index - 1].removeAttribute("aria-current");
    marks[index - 1].classList.add("done");
  }
  marks[index]?.setAttribute("aria-current", "step");
}

function resetMeasurement({ release = false, flush = false } = {}) {
  session.interrupt(release);
  ui.hold.value = session.target ? 0 : 1;
  ui.heard.textContent = "—";
  ui.intonation.textContent = mic ? "等待單音" : "等待收音";
  if (flush && context) acceptAfter = context.currentTime * 1000 + 90;
}

function resetLesson() {
  const profile = profiles.find(({ id }) => id === ui.profile.value);
  lesson = lessons.find(({ id }) => id === ui.lesson.value);
  session = new PracticeSession(lessonSteps(lesson, profile, Number(ui.tonic.value)), lesson.holdMs);
  marks = session.steps.map(({ degree, label, tab }) => {
    const item = document.createElement("li");
    item.textContent = `${degree} ${label}`;
    if (tab) item.title = tab;
    return item;
  });
  ui.sequence.replaceChildren(...marks);
  ui["lesson-hint"].textContent = lesson.hint;
  ui["hold-label"].textContent = `${lesson.holdMs / 1000} 秒 · ±${TOLERANCE} cents`;
  resetMeasurement({ flush: true });
  renderTarget();
  showFeedback(mic ? "對照目標，吹或吸一個音。" : "先啟用麥克風，也可以先聽目標音。");
}

function saveLesson() {
  completed.add(completionKey(lesson.id));
  try {
    localStorage.setItem(storageKey, JSON.stringify([...completed]));
  } catch {
    // Completion still appears until the page is closed if storage is blocked.
  }
  listLessons(lesson.id);
}

function renderMicInfo() {
  if (!mic) {
    ui["mic-info"].textContent = "啟用後顯示裝置、取樣率、聲道及瀏覽器處理狀態。";
    return;
  }
  const settings = mic.track.getSettings();
  const settingText = (value) => value === undefined ? "未知" : value ? "開" : "關";
  ui["mic-info"].textContent = [
    mic.track.label || "未命名裝置",
    `瀏覽器收到 ${channelCount} 聲道`,
    `音軌 ${settings.sampleRate ?? "未知"} Hz／分析前 ${context.sampleRate} Hz`,
    `瀏覽器 AEC ${settingText(settings.echoCancellation)}`,
    `降噪 ${settingText(settings.noiseSuppression)}`,
    `自動增益 ${settingText(settings.autoGainControl)}`,
  ].join(" · ");
}

function setChannelCount(count) {
  const previous = Number(ui.channel.value);
  const selected = previous < count ? previous : 0;
  channelCount = count;
  const channels = Array.from({ length: Math.max(1, count) }, (_, index) => [index, `CH ${index + 1}`]);
  selectOptions(ui.channel, channels, selected);
  ui.channel.disabled = count < 2;
  ui.calibrate.disabled = !mic || count === 0;
  if (selected !== previous) changeChannel();
  renderMicInfo();
}

function changeChannel() {
  mic.capture.port.postMessage({ channel: Number(ui.channel.value) });
  calibration = null;
  ui.calibrate.textContent = "量測環境底噪";
  setThreshold(-45);
  resetMeasurement({ flush: true });
  ui["mic-status"].textContent = `使用 ${mic.track.label || "目前裝置"} · CH ${Number(ui.channel.value) + 1}。`;
}

function setThreshold(value) {
  ui.threshold.value = value;
  ui["threshold-value"].textContent = `${ui.threshold.value} dBFS`;
}

function calibrate(time, rms) {
  if (!calibration) return false;
  calibration.since ??= time;
  calibration.levels.push(20 * Math.log10(Math.max(rms, 1e-6)));
  if (time - calibration.since < 1600) return true;

  const levels = calibration.levels.sort((left, right) => left - right);
  const noiseFloor = levels[Math.floor(levels.length * 0.9)];
  const gate = Math.max(MIN_DB, Math.min(MAX_DB, Math.round(noiseFloor + 12)));
  setThreshold(gate);
  calibration = null;
  ui.calibrate.textContent = "量測環境底噪";
  ui["mic-status"].textContent = noiseFloor > -32
    ? `背景聲偏高（約 ${Math.round(noiseFloor)} dBFS）。保持安靜後再量一次。`
    : `底噪約 ${Math.round(noiseFloor)} dBFS，門檻設為 ${gate} dBFS。可以開始吹。`;
  showFeedback("對照目標，吹或吸一個音。");
  return true;
}

function onAudio(data) {
  if (!mic) return;
  if ("channelCount" in data) {
    setChannelCount(data.channelCount);
    return;
  }
  const { samples, rate, channel, time } = data;
  if (document.hidden || channel !== Number(ui.channel.value)
      || time < Math.max(acceptAfter, referenceUntil) || context.currentTime * 1000 - time > 300) return;
  if (rate !== detectorRate || samples.length !== frameSize) {
    detector = makePitchDetector(rate, samples.length);
    detectorRate = rate;
    frameSize = samples.length;
  }

  const gate = Number(ui.threshold.value);
  const { hz, rms, clipped } = detector(samples, calibration ? Infinity : gate);
  const level = 20 * Math.log10(Math.max(rms, 1e-6));
  ui["input-level"].textContent = `目前音量 ${Math.round(level)} dBFS`;
  if (calibrate(time, rms)) return;
  const quiet = level < gate && !clipped && !data.clipped;
  const reliable = hz && !data.clipped;
  const detected = reliable ? Math.round(69 + 12 * Math.log2(hz / 440)) : null;
  const target = session.target;
  const cents = reliable && target ? centsBetween(hz, target.hz) : null;
  const matches = cents !== null && Math.abs(cents) <= TOLERANCE;
  const heardName = detected === target?.midi ? target.label : detected === null ? "" : noteName(detected);
  ui.heard.textContent = detected === null ? "—" : `${heardName} · ${hz.toFixed(1)} Hz`;
  ui.intonation.textContent = clipped || data.clipped ? "音量過大，請離麥克風遠一點"
    : quiet ? "聲音低於收音門檻"
    : detected === null ? "音高不明，試著只吹一個音"
    : cents === null ? "已辨識音高"
    : `相對目標 ${cents >= 0 ? "+" : ""}${Math.round(cents)} cents`;

  if (!target) return;
  const { phase, progress } = session.observe({ time, quiet, matches });
  ui.hold.value = progress;
  if (phase === "advance" || phase === "complete") {
    renderTarget();
    if (phase === "complete") {
      saveLesson();
      showFeedback("本課完成。可以重練，或接著練下一課。");
    } else {
      showFeedback(session.needsRelease ? "下一個是同音。先停氣，再吹一次。" : "通過，換下一個音。");
    }
  } else if (phase === "release") {
    showFeedback("先停氣一下，等聲音落下再起音。");
  } else if (matches) {
    showFeedback("音對了，維持一下。");
  } else if (detected !== null) {
    showFeedback(detected === target.midi ? (cents > 0 ? "音偏高，試著放鬆、放輕氣流。" : "音偏低，試著放鬆嘴型，減少壓音。")
      : `現在是 ${heardName}，請找 ${target.label}。`);
  } else {
    showFeedback("對照目標，吹或吸一個音。");
  }
}

async function refreshInputs() {
  const value = ui.device.value;
  const devices = await listInputs();
  selectOptions(ui.device, [
    ["", "自動（優先 ReSpeaker）"],
    ...devices.map(({ deviceId, label }, index) => [deviceId, label || `麥克風 ${index + 1}`]),
  ], value);
}

function audioContext() {
  context ??= new AudioContext();
  return context;
}

function stopMic(message = "麥克風已停止，可以重新選擇裝置。") {
  mic?.close();
  mic = null;
  ui["input-level"].textContent = "目前音量 —";
  calibration = null;
  setChannelCount(0);
  ui.mic.textContent = "啟用麥克風";
  ui.calibrate.textContent = "量測環境底噪";
  ui.device.disabled = false;
  resetMeasurement();
  ui["mic-status"].textContent = message;
  if (session.target) showFeedback("啟用麥克風後可以繼續。");
}

async function toggleMic() {
  if (mic) {
    stopMic();
    return;
  }
  if (connecting) return;
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) {
    ui["mic-status"].textContent = "請用 Chrome 或 Edge 開啟 http://localhost:8000/。";
    return;
  }

  connecting = true;
  ui.mic.disabled = true;
  ui.device.disabled = true;
  ui["mic-status"].textContent = "正在開啟麥克風，請允許收音。";
  try {
    const activeContext = audioContext();
    await activeContext.resume();
    mic = await connectMic(activeContext, ui.device.value, onAudio);
    const { track, capture } = mic;
    if (track.readyState === "ended") throw new DOMException("Input ended", "NotReadableError");
    track.onended = () => stopMic("麥克風已斷開。請重新接上後啟用。");
    track.onmute = () => {
      resetMeasurement();
      ui["mic-status"].textContent = "瀏覽器暫時收不到音訊，請檢查裝置或靜音鍵。";
    };
    track.onunmute = () => {
      ui["mic-status"].textContent = `使用 ${track.label || "目前裝置"}。`;
    };
    capture.onprocessorerror = () => stopMic("收音分析中斷，請重新啟用麥克風。");
    ui.mic.textContent = "停止麥克風";
    ui["mic-status"].textContent = `使用 ${track.label || "目前裝置"}。看音量與音名確認收音。`;
    renderMicInfo();
    if (session.target) showFeedback("對照目標，吹或吸一個音。");
    await refreshInputs().catch(() => {});
  } catch (error) {
    const messages = {
      NotAllowedError: "麥克風未獲授權。請檢查網址列與系統的麥克風權限。",
      NotFoundError: "找不到麥克風。請接上 XVF3800 後重試。",
      OverconstrainedError: "選擇的裝置已不可用。請重新選擇麥克風。",
      NotReadableError: "無法讀取麥克風。請檢查系統輸入裝置或重新插拔。",
    };
    stopMic(messages[error.name] ?? `無法啟用麥克風（${error.name}）。`);
  } finally {
    connecting = false;
    ui.mic.disabled = false;
  }
}

ui.mic.addEventListener("click", toggleMic);
ui.channel.addEventListener("change", changeChannel);
ui.threshold.addEventListener("input", () => {
  setThreshold(ui.threshold.value);
  resetMeasurement();
});
ui.calibrate.addEventListener("click", () => {
  calibration = { since: null, levels: [] };
  resetMeasurement({ flush: true });
  ui.calibrate.textContent = "重新量測底噪";
  ui["mic-status"].textContent = "請保持安靜約 2 秒。";
});
ui.reference.addEventListener("click", async () => {
  if (!session.target || referenceBusy) return;
  const { hz } = session.target;
  referenceBusy = true;
  ui.reference.disabled = true;
  try {
    const activeContext = audioContext();
    await activeContext.resume();
    referenceUntil = playReference(activeContext, hz);
    resetMeasurement({ release: Boolean(mic) });
    showFeedback("播放目標音。等聲音停了再吹。");
    setTimeout(() => {
      referenceBusy = false;
      ui.reference.disabled = !session.target;
    }, REFERENCE_MS);
  } catch {
    referenceBusy = false;
    ui.reference.disabled = !session.target;
    showFeedback("目前無法播放參考音。");
  }
});
for (const select of [ui.profile, ui.tonic, ui.lesson]) {
  select.addEventListener("change", () => {
    listLessons(ui.lesson.value);
    resetLesson();
  });
}
ui.restart.addEventListener("click", resetLesson);
ui.next.addEventListener("click", () => {
  ui.lesson.value = lessons[lessons.indexOf(lesson) + 1].id;
  resetLesson();
});
document.addEventListener("visibilitychange", () => resetMeasurement({ flush: true }));
window.addEventListener("pagehide", () => { if (mic) stopMic(); });
navigator.mediaDevices?.addEventListener("devicechange", () => { refreshInputs().catch(() => {}); });

selectOptions(ui.profile, profiles.map(({ id, name }) => [id, name]), "richter");
selectOptions(ui.tonic, tonics.map((midi) => [midi, noteName(midi)]), 60);
listLessons("long");
resetLesson();
refreshInputs().catch(() => {});
