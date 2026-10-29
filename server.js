"use strict";
/* Сервер вікторини «Ніч кіношного жаху».
   /host  – екран ведучої (лише з цього ноутбука)
   /play  – телефони гравців
   /check – попередня перевірка YouTube-фрагментів */

const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");
const express = require("express");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { isCorrect } = require("./lib/check");
const Q = require("./lib/questions");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const QUESTIONS_FILE = process.env.QUESTIONS_FILE || path.join(ROOT, "questions.json");
const STATE_DIR = process.env.STATE_DIR || path.join(ROOT, "data");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const HOST_ANYWHERE = process.env.HOST_ANYWHERE === "1";
// Стікери, з яких гравець обирає собі аватар
const STICKERS = ["🎃", "👻", "💀", "🦇", "🕷️", "🕸️", "🧛", "🧟", "🧙", "🔮", "🪦", "🍬", "🌕", "🤡", "👹", "🐺"];
const stickerOf = p => p.sticker || STICKERS[0];

/* ---------- питання ---------- */
function fail(msg) {
  console.error("\n  " + msg + "\n");
  process.exit(1);
}
const TEST_FILE = path.join(ROOT, "test-questions.json");
const EASY_FILE = process.env.QUESTIONS_EASY_FILE || path.join(ROOT, "questions-easy.json");
const GRACE_MS = 700; // запас на затримку мережі, щоб відповідь в останню мить не губилась

// Читає файл питань і готує все, що потрібно для гри. Повертає {error} замість падіння.
function loadQuiz(file) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) return { error: `Не знайдено файл ${name} поруч із server.js.` };
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  let quiz;
  try {
    quiz = Q.decodeQuiz(JSON.parse(raw));
  } catch (e) {
    return { error: `Файл ${name} зіпсований (помилка JSON): ${e.message}` };
  }
  const { errors, warnings } = Q.validate(quiz);
  warnings.forEach(w => console.log(`  Увага (${name}): ${w}`));
  if (errors.length) return { error: `У ${name} є помилки:\n  - ${errors.join("\n  - ")}` };
  Q.prepare(quiz);
  const settings = Object.assign({ speedBonus: 0 }, quiz.settings || {});
  const steps = [{ t: "title" }, { t: "lobby" }];
  quiz.blocks.forEach((b, bi) => {
    steps.push({ t: "intro", bi });
    b.questions.forEach((q, qi) => steps.push({ t: "q", bi, qi, key: bi + "-" + qi }));
    if (bi < quiz.blocks.length - 1) steps.push({ t: "scores", bi });
  });
  steps.push({ t: "final" });
  return {
    quiz, steps, settings,
    // Час на відповідь у секундах; можна змінити в settings.timer або полем "time" в окремому питанні
    // review — питання-відгуки (блок «Поганий відгук»): їх довше читати
    times: Object.assign({ normal: 30, review: 40, blitz: 15 }, settings.timer || {}),
    hash: crypto.createHash("sha1").update(raw).digest("hex")
  };
}

// Набори питань: складний рівень (questions.json), легкий (questions-easy.json, необов'язковий)
// і тестові заглушки (кнопка «Тест» на титульному екрані)
const QUIZZES = { hard: loadQuiz(QUESTIONS_FILE), easy: null, test: loadQuiz(TEST_FILE) };
if (QUIZZES.hard.error) fail(QUIZZES.hard.error);
if (fs.existsSync(EASY_FILE)) {
  QUIZZES.easy = loadQuiz(EASY_FILE);
  if (QUIZZES.easy.error) {
    console.log("\n  Легкий рівень вимкнено, гра працює з одним рівнем.\n  " + QUIZZES.easy.error + "\n");
    QUIZZES.easy = null;
  }
}
if (!QUIZZES.easy) delete QUIZZES.easy;
if (QUIZZES.test.error) {
  console.log("  Тестовий режим вимкнено: " + QUIZZES.test.error);
  delete QUIZZES.test;
}
const HAS_LEVELS = !!QUIZZES.easy;   // без легкого файлу — один рівень і без вибору
const LEVEL_NAMES = { hard: "Складний рівень", easy: "Легкий рівень", test: "Тестова гра" };
const isLevel = m => m === "hard" || m === "easy";
const otherLevel = m => (HAS_LEVELS && isLevel(m) ? (m === "hard" ? "easy" : "hard") : null);

// Поточний набір; перемикається функцією useMode()
let MODE, QUIZ, STEPS, SETTINGS, TIMES, QHASH;
function useMode(mode) {
  if (mode === "real") mode = "hard"; // назва зі старих збережень
  MODE = QUIZZES[mode] ? mode : "hard";
  ({ quiz: QUIZ, steps: STEPS, settings: SETTINGS, times: TIMES, hash: QHASH } = QUIZZES[MODE]);
}
useMode("hard");

const qOf = st => QUIZ.blocks[st.bi].questions[st.qi];
function publicQuestion(q) {
  const out = {};
  for (const [k, v] of Object.entries(q)) if (!Q.SECRET.includes(k)) out[k] = v;
  return out;
}

/* ---------- стан гри (зберігається у data/state.json) ---------- */
// Кожен рівень — окрема гра: новий рівень = нові бали й відповіді, гравці ті самі
function freshGame(players, played = {}) {
  return {
    mode: MODE,              // "hard", "easy" або "test"
    qHash: QHASH,
    gameId: crypto.randomUUID(),
    step: players.length ? 1 : 0,
    players,                 // [{id, name, sticker, adj}]
    answers: {},             // key -> pid -> {v, t, auto, ov}
    revealed: {},            // key -> true
    timers: {},              // key -> час завершення (мс)
    played                   // рівень -> хеш файлу: які рівні вже дограли до фіналу
  };
}
const keepPlayers = players => players.map(p => ({ id: p.id, name: p.name, sticker: p.sticker, adj: 0 }));

let S = freshGame([]);
try {
  if (fs.existsSync(STATE_FILE)) {
    const d = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (d && Array.isArray(d.players)) {
      const mode = d.mode === "real" ? "hard" : (d.mode || "hard");
      // «Зіграні» рівні рахуються лише поки їхній файл не змінився
      const played = {};
      for (const [m, h] of Object.entries(d.played || {})) if (QUIZZES[m] && QUIZZES[m].hash === h) played[m] = h;
      if (QUIZZES[mode] && d.qHash === QUIZZES[mode].hash) {
        useMode(mode);
        S = Object.assign(S, d, { mode, played });
        console.log(`  Відновлено гру (${LEVEL_NAMES[MODE].toLowerCase()}): ${S.players.length} гравців, крок ${S.step + 1} з ${STEPS.length}.`);
      } else {
        // Змінився (або зник) файл саме цього рівня: скидаємо лише його бали
        useMode(mode);
        S = freshGame(keepPlayers(d.players), played);
        S.step = 0;
        console.log(`  Файл питань (${LEVEL_NAMES[MODE].toLowerCase()}) змінився, тому бали скинуто. Гравців збережено.`);
      }
    }
  }
} catch (e) {
  console.log("  Не вдалося прочитати збережену гру, починаємо нову.");
}
S.step = Math.max(0, Math.min(S.step, STEPS.length - 1));
if (!S.timers) S.timers = {};
if (!S.played) S.played = {};

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(S));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error("  Не вдалося зберегти стан гри:", e.message);
  }
}

/* ---------- бали ---------- */
const answerOk = a => (a.ov != null ? a.ov : !!a.auto);

function computeScores() {
  const sc = {};
  for (const p of S.players) sc[p.id] = p.adj || 0;
  for (const key of Object.keys(S.revealed)) {
    const list = S.answers[key] || {};
    let first = null;
    for (const [pid, a] of Object.entries(list)) {
      if (!(pid in sc) || !answerOk(a)) continue;
      sc[pid] += 1;
      if (!first || a.t < list[first].t) first = pid;
    }
    if (SETTINGS.speedBonus > 0 && first) sc[first] += SETTINGS.speedBonus;
  }
  return sc;
}
function rankedPlayers(sc) {
  return S.players
    .map(p => ({ id: p.id, name: p.name, sticker: stickerOf(p), score: sc[p.id] || 0 }))
    .sort((a, b) => b.score - a.score);
}
const placeOf = (sc, pid) => 1 + S.players.filter(p => (sc[p.id] || 0) > (sc[pid] || 0)).length;

function checkAnswer(q, v) {
  if (Q.isChoice(q)) return v === q.correct;
  return isCorrect(v, q.accept);
}
function displayAnswer(q, v) {
  if (v == null) return null;
  if (Q.isChoice(q)) return `${"АБВГ"[v]} · ${q.options[v]}`;
  return String(v);
}

/* ---------- таймер ---------- */
const isClip = q => q.type === "video" || q.type === "audio";
// Час на питання: поле "time" у самому питанні, інакше за типом (review, blitz…), інакше звичайний
const qTime = q => Number(q.time) > 0 ? Number(q.time) : (Number(TIMES[q.type]) > 0 ? Number(TIMES[q.type]) : TIMES.normal);

function startTimer(st) {
  if (!st || S.timers[st.key] || S.revealed[st.key]) return false;
  S.timers[st.key] = Date.now() + qTime(qOf(st)) * 1000;
  return true;
}
// Щойно час вийде, розсилаємо новий стан, щоб усі побачили «Час вийшов»
let expiryTimer = null;
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const st = currentQ();
  if (!st || S.revealed[st.key] || !S.timers[st.key] || S.pause) return;
  const ms = S.timers[st.key] - Date.now();
  if (ms > 0) expiryTimer = setTimeout(broadcast, ms + 50);
}
// Звичайні питання стартують одразу; відео й аудіо — після першого програвання фрагмента
function onEnterStep() {
  const st = currentQ();
  if (st && !isClip(qOf(st))) startTimer(st);
  scheduleExpiry();
}
// Залишок передаємо в мілісекундах, а не як час: годинники телефонів можуть відставати
function timerView(st) {
  const total = qTime(qOf(st));
  const end = S.timers[st.key];
  if (!end) return { state: "pending", total, clip: isClip(qOf(st)) };
  if (S.pause && S.pause.key === st.key) return { state: "paused", total, remaining: S.pause.remaining };
  const remaining = end - Date.now();
  return remaining > 0 ? { state: "running", total, remaining } : { state: "over", total, remaining: 0 };
}
const timeIsUp = key => !(S.pause && S.pause.key === key) && S.timers[key] && Date.now() > S.timers[key] + GRACE_MS;

// Пауза (меню ведучої): запам'ятовуємо залишок і «заморожуємо» відлік
function pauseTimer() {
  const st = currentQ();
  if (S.pause || !st || S.revealed[st.key] || !S.timers[st.key]) return false;
  const remaining = S.timers[st.key] - Date.now();
  if (remaining <= 0) return false;
  S.pause = { key: st.key, remaining };
  clearTimeout(expiryTimer);
  return true;
}
function resumeTimer() {
  if (!S.pause) return false;
  S.timers[S.pause.key] = Date.now() + S.pause.remaining;
  S.pause = null;
  scheduleExpiry();
  return true;
}

/* ---------- що бачить ведуча ---------- */
function hostView() {
  const st = STEPS[S.step];
  const sc = computeScores();
  const online = onlinePlayers();
  const view = {
    gameId: S.gameId,
    i: S.step,
    total: STEPS.length,
    step: { t: st.t, bi: st.bi, qi: st.qi },
    // Назва з титульного екрана завжди справжня: вибір «Почати гру» / «Тест» робиться саме там
    title: QUIZZES.hard.quiz.title,
    subtitle: QUIZZES.hard.quiz.subtitle,
    mode: MODE,
    hasTest: !!QUIZZES.test,
    hasLevels: HAS_LEVELS,
    levelName: LEVEL_NAMES[MODE],
    otherLevel: otherLevel(MODE),
    played: Object.keys(S.played),
    blocks: QUIZ.blocks.map(b => ({ name: b.name, tagline: b.tagline, rules: b.rules, count: b.questions.length })),
    players: S.players.map(p => ({ id: p.id, name: p.name, sticker: stickerOf(p), score: sc[p.id] || 0, online: online.has(p.id) })),
    ranked: rankedPlayers(sc),
    join: JOIN,
    hasProgress: Object.keys(S.revealed).length > 0 || S.step > 1
  };
  if (st.t === "q") {
    const q = qOf(st);
    const list = S.answers[st.key] || {};
    view.q = publicQuestion(q);
    view.revealed = !!S.revealed[st.key];
    view.timer = timerView(st);
    view.answered = S.players.filter(p => list[p.id]).map(p => ({ name: p.name, sticker: stickerOf(p) }));
    // Відповіли всі, хто зараз на зв'язку (заблокований телефон не заважає підказці)
    const live = S.players.filter(p => online.has(p.id));
    view.allAnswered = live.length > 0 && live.every(p => list[p.id]);
    if (view.revealed) {
      view.reveal = { a: q.a, fact: q.fact || "", correct: Q.isChoice(q) ? q.correct : null };
      // Скільки гравців обрали кожен варіант (лише після розкриття)
      if (Q.isChoice(q)) {
        view.reveal.dist = q.options.map(() => 0);
        for (const p of S.players) if (list[p.id]) view.reveal.dist[list[p.id].v]++;
      }
      view.results = S.players.map(p => {
        const a = list[p.id];
        const base = { pid: p.id, name: p.name, sticker: stickerOf(p) };
        return a
          ? { ...base, text: displayAnswer(q, a.v), ok: answerOk(a), manual: a.ov != null }
          : { ...base, text: null, ok: false, manual: false };
      });
    }
  }
  return view;
}

/* ---------- що бачить гравець (без відповідей до розкриття) ---------- */
function playerView(pid) {
  const p = S.players.find(x => x.id === pid);
  if (!p) return null;
  const st = STEPS[S.step];
  const sc = computeScores();
  const view = {
    gameId: S.gameId,
    me: { name: p.name, sticker: stickerOf(p), score: sc[pid] || 0, place: placeOf(sc, pid), of: S.players.length },
    phase: st.t,
    title: QUIZ.title,
    test: MODE === "test",
    // Підпис унизу телефона: «Тестова гра» або рівень (якщо рівнів два)
    levelName: MODE === "test" || HAS_LEVELS ? LEVEL_NAMES[MODE] : null
  };
  if (st.bi != null) view.block = { num: st.bi + 1, name: QUIZ.blocks[st.bi].name };
  if (st.t === "q") {
    const q = qOf(st);
    const a = (S.answers[st.key] || {})[pid];
    const revealed = !!S.revealed[st.key];
    view.q = {
      key: st.key,
      num: st.qi + 1,
      total: QUIZ.blocks[st.bi].questions.length,
      choice: Q.isChoice(q),
      options: Q.isChoice(q) ? q.options : null,
      revealed,
      mine: a ? a.v : null,
      timer: timerView(st)
    };
    if (revealed) view.result = { ok: a ? answerOk(a) : false, answered: !!a, a: q.a, gain: a && answerOk(a) ? 1 : 0 };
  }
  return view;
}

/* ---------- адреса для телефонів ---------- */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (!(a.family === "IPv4" || a.family === 4) || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth|docker|vpn|tailscale|zerotier|hamachi|radmin/i.test(name);
      let score = virtual ? 0 : 10;
      if (/^192\.168\./.test(a.address)) score += 2;
      else if (/^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 1;
      if (/wi-?fi|wlan|wireless|бездрот|беспровод/i.test(name)) score += 3;
      out.push({ name, address: a.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
const ADDRS = lanAddresses();
const JOIN_HOST = process.env.JOIN_HOST || (ADDRS[0] ? ADDRS[0].address : "localhost");
const JOIN = {
  url: `http://${JOIN_HOST}:${PORT}/play`,
  others: ADDRS.slice(1).map(a => `http://${a.address}:${PORT}/play`),
  noLan: !ADDRS.length && !process.env.JOIN_HOST
};
let QR_SVG = "";
QRCode.toString(JOIN.url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#100b13", light: "#ece3d4" } })
  .then(svg => { QR_SVG = svg; })
  .catch(e => console.error("  Не вдалося створити QR-код:", e.message));

/* ---------- HTTP ---------- */
const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: true });
const PUB = path.join(ROOT, "public");

app.disable("x-powered-by");
app.get("/", (req, res) => res.redirect(isLocalAddr(req.socket.remoteAddress) ? "/host" : "/play"));
app.get("/host", (req, res) => res.sendFile(path.join(PUB, "host.html")));
app.get("/play", (req, res) => res.sendFile(path.join(PUB, "play.html")));
app.get("/check", (req, res) => res.sendFile(path.join(PUB, "check.html")));
app.get("/qr.svg", (req, res) => res.type("image/svg+xml").set("Cache-Control", "no-store").send(QR_SVG));
// Для /check: лише технічні дані роликів, без назв і відповідей
app.get("/api/videos", (req, res) => {
  const list = [];
  for (const lv of ["easy", "hard"]) {
    if (!QUIZZES[lv]) continue;
    QUIZZES[lv].quiz.blocks.forEach((b, bi) => b.questions.forEach((q, qi) => {
      if (q.type === "video" || q.type === "audio")
        list.push({ level: HAS_LEVELS ? LEVEL_NAMES[lv] : null, bi: bi + 1, qi: qi + 1, type: q.type, yt: q.yt, start: q.start, end: q.end });
    }));
  }
  res.json(list);
});
app.get("/api/stickers", (req, res) => res.json(STICKERS));
app.use(express.static(PUB, { index: false }));

/* ---------- сокети ---------- */
function isLocalAddr(addr) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(addr);
}
function onlinePlayers() {
  const set = new Set();
  for (const s of io.sockets.sockets.values()) if (s.data.pid) set.add(s.data.pid);
  return set;
}
function broadcast() {
  io.to("host").emit("host:state", hostView());
  for (const s of io.sockets.sockets.values()) {
    if (s.data.pid) s.emit("player:state", playerView(s.data.pid));
  }
  saveSoon();
}
function currentQ() {
  const st = STEPS[S.step];
  return st.t === "q" ? st : null;
}
const cleanName = s => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 20);

io.on("connection", socket => {
  const local = HOST_ANYWHERE || isLocalAddr(socket.handshake.address);

  /* --- ведуча --- */
  socket.on("host:hello", () => {
    if (!local) return socket.emit("host:denied");
    socket.data.host = true;
    socket.join("host");
    socket.emit("host:state", hostView());
  });
  const hostOnly = fn => (...args) => { if (socket.data.host) fn(...args); };

  socket.on("host:go", hostOnly(d => {
    const n = S.step + (d > 0 ? 1 : -1);
    if (n < 0 || n >= STEPS.length) return;
    resumeTimer(); // на випадок, якщо пішли з питання на паузі
    S.step = n;
    // Дійшли до фіналу: рівень вважається зіграним (на фіналі з'явиться кнопка іншого рівня)
    if (STEPS[n].t === "final" && isLevel(MODE)) S.played[MODE] = QHASH;
    onEnterStep();
    broadcast();
  }));
  // Відео/аудіо: таймер стартує, коли фрагмент програв (або не зміг програтись)
  socket.on("host:clipDone", hostOnly(() => {
    const st = currentQ();
    if (st && isClip(qOf(st)) && startTimer(st)) {
      scheduleExpiry();
      broadcast();
    }
  }));
  socket.on("host:reveal", hostOnly(() => {
    const st = currentQ();
    if (!st || S.revealed[st.key]) return;
    const q = qOf(st);
    for (const a of Object.values(S.answers[st.key] || {})) a.auto = checkAnswer(q, a.v);
    S.revealed[st.key] = true;
    clearTimeout(expiryTimer);
    broadcast();
  }));
  socket.on("host:toggle", hostOnly(({ pid } = {}) => {
    const st = currentQ();
    if (!st || !S.revealed[st.key]) return;
    const a = (S.answers[st.key] || {})[pid];
    if (!a) return;
    const next = !answerOk(a);
    a.ov = next === !!a.auto ? null : next;
    broadcast();
  }));
  socket.on("host:adj", hostOnly(({ pid, d } = {}) => {
    const p = S.players.find(x => x.id === pid);
    if (!p) return;
    p.adj = (p.adj || 0) + (d > 0 ? 1 : -1);
    broadcast();
  }));
  socket.on("host:remove", hostOnly(({ pid } = {}) => {
    const i = S.players.findIndex(x => x.id === pid);
    if (i < 0) return;
    S.players.splice(i, 1);
    for (const list of Object.values(S.answers)) delete list[pid];
    for (const s of io.sockets.sockets.values()) {
      if (s.data.pid === pid) { s.data.pid = null; s.emit("player:kicked"); }
    }
    broadcast();
  }));
  // «Нова гра»: бали поточного рівня скидаються, гравці лишаються, «зіграні» рівні забуваються
  socket.on("host:newgame", hostOnly(() => {
    S = freshGame(keepPlayers(S.players));
    broadcast();
    saveNow();
  }));

  // Старт набору питань: «Почати гру» / «Тест» на титульному екрані, вибір рівня в лобі,
  // «Зіграти інший рівень» у фіналі. mode: "hard" | "easy" | "test" | "level" (поточний або складний).
  // Якщо набір змінюється — нова гра з тими самими гравцями, бали й відповіді з нуля. Завжди веде в лобі.
  socket.on("host:start", hostOnly(({ mode } = {}) => {
    let m = mode;
    if (m === "level" || !QUIZZES[m]) m = isLevel(MODE) ? MODE : "hard";
    if (m !== MODE) {
      clearTimeout(expiryTimer);
      useMode(m);
      S = freshGame(keepPlayers(S.players), S.played);
    }
    S.step = 1;
    onEnterStep();
    broadcast();
    saveNow();
  }));

  socket.on("host:pause", hostOnly(() => { if (pauseTimer()) broadcast(); }));
  socket.on("host:resume", hostOnly(() => { if (resumeTimer()) broadcast(); }));

  // Вихід із гри: стираємо весь прогрес (разом із гравцями) і зупиняємо сервер
  socket.on("host:quit", hostOnly(() => {
    clearTimeout(expiryTimer);
    clearTimeout(saveTimer);
    useMode("hard");
    S = freshGame([]);
    for (const f of [STATE_FILE, STATE_FILE + ".tmp"]) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
    io.emit("game:over");
    console.log("\n  Гру завершено, прогрес видалено. Сервер зупиняється…\n");
    setTimeout(() => process.exit(0), 700);
  }));

  /* --- гравці --- */
  socket.on("player:hello", ({ id } = {}) => {
    if (S.players.some(p => p.id === id)) {
      socket.data.pid = id;
      socket.emit("player:state", playerView(id));
      io.to("host").emit("host:state", hostView());
    } else {
      socket.emit("player:unknown");
    }
  });
  socket.on("player:join", ({ name, sticker } = {}, ack) => {
    if (typeof ack !== "function") return;
    const nm = cleanName(name);
    if (!nm) return ack({ error: "Введи ім'я" });
    if (S.players.some(p => p.name.toLocaleLowerCase("uk") === nm.toLocaleLowerCase("uk")))
      return ack({ error: "Таке ім'я вже є. Додай літеру чи прізвище." });
    if (S.players.length >= 40) return ack({ error: "У грі вже забагато гравців." });
    const p = { id: crypto.randomUUID(), name: nm, sticker: STICKERS.includes(sticker) ? sticker : STICKERS[0], adj: 0 };
    S.players.push(p);
    socket.data.pid = p.id;
    ack({ id: p.id });
    broadcast();
  });
  socket.on("player:answer", ({ key, v } = {}, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    const pid = socket.data.pid;
    const st = currentQ();
    if (!pid || !S.players.some(p => p.id === pid)) return done({ error: "Ти не в грі" });
    if (!st || st.key !== key) return done({ error: "Це питання вже закрито" });
    if (S.revealed[key]) return done({ error: "Відповідь уже показали" });
    if (timeIsUp(key)) return done({ error: "Час вийшов" });
    const q = qOf(st);
    let val;
    if (Q.isChoice(q)) {
      if (!Number.isInteger(v) || v < 0 || v >= q.options.length) return done({ error: "Невідомий варіант" });
      val = v;
    } else {
      val = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!val) return done({ error: "Напиши відповідь" });
    }
    (S.answers[key] ||= {})[pid] = { v: val, t: Date.now(), auto: null, ov: null };
    done({ ok: true });
    broadcast();
  });

  socket.on("disconnect", () => {
    if (socket.data.pid) io.to("host").emit("host:state", hostView());
  });
});

/* ---------- запуск ---------- */
server.on("error", e => {
  if (e.code === "EADDRINUSE") fail(`Порт ${PORT} зайнятий. Можливо, гра вже запущена в іншому вікні. Закрийте його і спробуйте ще раз.`);
  fail("Сервер не запустився: " + e.message);
});
server.listen(PORT, "0.0.0.0", () => {
  onEnterStep(); // якщо сервер перезапустили посеред питання
  const hostUrl = `http://localhost:${PORT}/host`;
  console.log("\n  🎃  Ніч кіношного жаху: сервер працює\n");
  console.log("  Рівні:           " + (HAS_LEVELS ? "легкий і складний" : "один (файлу questions-easy.json немає)"));
  console.log("  Екран ведучої:   " + hostUrl);
  console.log("  Для телефонів:   " + JOIN.url);
  JOIN.others.forEach(u => console.log("  (або)            " + u));
  console.log("  Перевірка відео: http://localhost:" + PORT + "/check");
  if (JOIN.noLan) console.log("\n  Увага: ноутбук не підключений до мережі, телефони не зможуть зайти.");
  console.log("\n  Щоб зупинити гру, просто закрийте це вікно.\n");
  if (process.argv.includes("--open")) {
    if (process.platform === "win32") exec(`start "" "${hostUrl}"`);
    else if (process.platform === "darwin") exec(`open "${hostUrl}"`);
    else exec(`xdg-open "${hostUrl}"`);
  }
});

process.on("SIGINT", () => { saveNow(); process.exit(0); });
process.on("SIGTERM", () => { saveNow(); process.exit(0); });
process.on("SIGHUP", () => { saveNow(); process.exit(0); });
