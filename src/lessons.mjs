export const profiles = [
  {
    id: "richter", name: "十孔全音階（Richter）",
    tabs: ["4 孔吹", "4 孔吸", "5 孔吹", "5 孔吸", "6 孔吹", "6 孔吸", "7 孔吸", "7 孔吹"],
  },
  {
    id: "solo", name: "十二孔半音階（Solo tuning）",
    tabs: ["1 孔吹", "1 孔吸", "2 孔吹", "2 孔吸", "3 孔吹", "3 孔吸", "4 孔吸", "4 孔吹"],
  },
  { id: "notes", name: "只看音名（複音琴／其他琴型）" },
];

const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const majorScale = [0, 2, 4, 5, 7, 9, 11, 12];
const letters = "CDEFGAB";
const naturalSteps = [0, 2, 4, 5, 7, 9, 11];

function scaleNoteName(tonic, degree, midi) {
  const tonicLetter = letters.indexOf(noteName(tonic)[0]);
  const letter = (tonicLetter + degree - 1) % letters.length;
  const pitchClass = naturalSteps[letter];
  const accidental = (midi - pitchClass + 6) % 12 - 6;
  const octave = Math.floor((midi - accidental) / 12) - 1;
  return letters[letter] + (accidental === 1 ? "♯" : accidental === -1 ? "♭" : "") + octave;
}

export function noteName(midi) {
  return noteNames[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function frequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

// Explicit octaves also cover low-tuned instruments and higher registers.
export const tonics = Array.from({ length: 36 }, (_, index) => 48 + index);

export const lessons = [
  {
    id: "long", title: "找回單音", holdMs: 750,
    hint: "輕吹或輕吸，讓聲音穩穩延續。若帶到隔壁孔，先停一下再找回單孔。",
    degrees: [1, 2, 3, 2, 1],
  },
  {
    id: "breath", title: "同孔吹吸與移孔", holdMs: 400,
    hint: "先練同一孔吹、吸。換孔時，把嘴維持原來的形狀，沿琴身滑到下一孔。",
    degrees: [1, 2, 1, 2, 3, 4, 3, 4, 5, 6, 5, 6],
  },
  {
    id: "scale", title: "大調音階上下行", holdMs: 350,
    hint: "上行到高音 Do，再往回。十孔 Richter 的 7 孔是先吸（Si）再吹（高音 Do）。",
    degrees: [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1],
  },
  {
    id: "mary", title: "《瑪莉有隻小綿羊》第一段", holdMs: 250,
    hint: "相同音之間要短暫停氣再起音。先把每個音吹對，再跟文件裡的拍子練。",
    degrees: [3, 2, 1, 2, 3, 3, 3, 2, 2, 2, 3, 5, 5, 3, 2, 1, 2, 3, 3, 3, 3, 2, 2, 3, 2, 1],
  },
];

export function lessonSteps(lesson, profile, tonic) {
  return lesson.degrees.map((degree) => {
    const midi = tonic + majorScale[degree - 1];
    return { degree, midi, label: scaleNoteName(tonic, degree, midi), tab: profile.tabs?.[degree - 1], hz: frequency(midi) };
  });
}
