/* Телефон гравця. Сервер надсилає лише те, що гравцю можна бачити. */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const plural = (n,one,few,many) => { const a=n%10,b=n%100; if(a===1&&b!==11)return one; if(a>=2&&a<=4&&(b<12||b>14))return few; return many; };
const LETTERS = "АБВГ";
const KEY = "halloween-quiz-player-id";

const store = {
  get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} },
  clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
};

const socket = io();
let myId = store.get();
let P = null;              // стан від сервера
let editing = false;       // гравець натиснув «Змінити»
let draft = "";            // недописана відповідь
let draftKey = "";
let viewKey = "";
let joinNote = "";
let timerEnd = null;       // кінець часу на питання за годинником телефона

// Чи вийшов час (за даними сервера або за локальним відліком)
function timeOver() {
  const t = P && P.q && P.q.timer;
  if (!t) return false;
  return t.state === "over" || (t.state === "running" && timerEnd != null && Date.now() >= timerEnd);
}

// Підказка, якщо телефон не може достукатися до сервера
let failCount = 0;
function bootMsg(html) { const b = $("#bootMsg"); if (b) b.innerHTML = html; }
socket.on("connect_error", () => {
  failCount++;
  if (failCount >= 3) bootMsg(`Не вдається з'єднатися з грою.<br><br>Перевірте, що телефон у <b>тій самій Wi-Fi мережі</b>, що й ноутбук, і що гру запущено. Потім оновіть сторінку.`);
});
setTimeout(() => {
  if (!window.quizStarted) bootMsg(`Підключення триває задовго.<br><br>Спробуйте оновити сторінку або відкрити адресу в <b>Chrome</b> чи <b>Safari</b>.`);
}, 10000);

socket.on("connect", () => {
  failCount = 0;
  window.quizStarted = true;
  $("#banner").hidden = true;
  if (myId) socket.emit("player:hello", { id: myId });
  else showJoin();
});
let gameOver = false;
socket.on("disconnect", () => { if (!gameOver) $("#banner").hidden = false; });
// Ведуча вийшла з гри: прогрес видалено, тож і «пам'ять» телефона очищаємо
socket.on("game:over", () => {
  gameOver = true;
  myId = null; store.clear(); P = null;
  socket.disconnect();
  $("#banner").hidden = true; $("#top").hidden = true; $("#ptimer").hidden = true;
  viewKey = "over";
  $("#main").innerHTML = `<div class="card">
    <div class="big">🎃</div>
    <h2>Гру завершено</h2>
    <p class="muted">Дякуємо, що грали! Сторінку можна закрити.</p>
  </div>`;
});
socket.on("player:unknown", () => { myId = null; store.clear(); showJoin(); });
socket.on("player:kicked", () => {
  myId = null; store.clear(); P = null;
  joinNote = "Ведуча прибрала тебе зі списку. Можна увійти знову.";
  showJoin();
});
socket.on("player:state", st => {
  if (!st) return;
  if (P && P.gameId !== st.gameId) { editing = false; draft = ""; }
  P = st;
  const t = P.q && P.q.timer;
  timerEnd = t && t.state === "running" ? Date.now() + t.remaining : null;
  // Окремий будильник на автонадсилання: точніший за щосекундну перевірку у «пригальмованій» вкладці
  clearTimeout(autoTimer);
  if (timerEnd) autoTimer = setTimeout(autoSubmit, Math.max(0, timerEnd - Date.now() - 400));
  render();
  renderTimer();
});

/* ---------- вхід ---------- */
// Список стікерів приходить із сервера; цей — запасний, якщо запит не вдався
let STICKERS = ["🎃", "👻", "💀", "🦇", "🕷️", "🕸️", "🧛", "🧟", "🧙", "🔮", "🪦", "🍬", "🌕", "🤡", "👹", "🐺"];
let sticker = STICKERS[Math.floor(Math.random() * STICKERS.length)];
fetch("/api/stickers").then(r => r.json()).then(list => {
  if (!Array.isArray(list) || !list.length) return;
  STICKERS = list;
  if (STICKERS.indexOf(sticker) < 0) sticker = STICKERS[0];
  if (viewKey === "join") drawStickers();
}).catch(() => {});

function drawStickers() {
  const box = $("#stickers");
  if (!box) return;
  box.innerHTML = STICKERS.map(s => `<button type="button" class="${s === sticker ? "on" : ""}" data-stk="${esc(s)}" aria-label="Стікер ${esc(s)}">${esc(s)}</button>`).join("");
  box.querySelectorAll("[data-stk]").forEach(b => b.onclick = () => { sticker = b.dataset.stk; drawStickers(); });
}

function showJoin() {
  const typed = $("#name") ? $("#name").value : "";
  viewKey = "join";
  $("#top").hidden = true;
  $("#main").innerHTML = `<div class="card">
    <div class="eyebrow">Геловін · вікторина</div>
    <h1 class="flicker">Ніч кіношного жаху</h1>
    <form id="joinForm" autocomplete="off" style="display:flex;flex-direction:column;gap:.7em">
      <input class="field" id="name" placeholder="Твоє ім'я" maxlength="20" aria-label="Твоє ім'я" enterkeyhint="go" value="${esc(typed)}">
      <div class="qmeta" style="margin-top:.4em">Обери свій стікер</div>
      <div class="stickers" id="stickers"></div>
      <button class="btn" type="submit">Грати</button>
      <p class="hint" id="hint">${esc(joinNote)}</p>
    </form>
  </div>`;
  drawStickers();
  $("#joinForm").onsubmit = e => {
    e.preventDefault();
    const name = $("#name").value.trim();
    if (!name) { $("#hint").textContent = "Введи ім'я"; return; }
    const b = e.target.querySelector("button[type=submit]"); b.disabled = true;
    socket.emit("player:join", { name, sticker }, res => {
      b.disabled = false;
      if (res && res.id) { myId = res.id; store.set(res.id); joinNote = ""; }
      else $("#hint").textContent = (res && res.error) || "Не вдалося увійти";
    });
  };
}

/* ---------- основний екран ---------- */
function render() {
  $("#top").hidden = false;
  $("#meName").textContent = (P.me.sticker ? P.me.sticker + " " : "") + P.me.name;
  // Непомітна позначка рівня внизу телефона (або «Тестова гра»)
  $("#foot").textContent = P.levelName || "Ніч кіношного жаху";
  $("#meScore").textContent = `${P.me.score} ${plural(P.me.score,"бал","бали","балів")}`;

  const q = P.q;
  const key = JSON.stringify([P.gameId, P.phase, P.block && P.block.num, q && q.key, q && q.revealed, q && q.mine, editing, timeOver(),
    P.result && P.result.ok, (P.phase === "scores" || P.phase === "final") && [P.me.place, P.me.of, P.me.score]]);
  if (key === viewKey) return;
  viewKey = key;

  const m = $("#main");
  if (P.phase === "title" || P.phase === "lobby") m.innerHTML = vWait();
  else if (P.phase === "intro") m.innerHTML = vIntro();
  else if (P.phase === "q") m.innerHTML = q.revealed ? vResult() : (q.choice ? vChoice() : vText());
  else if (P.phase === "scores") m.innerHTML = vScores();
  else m.innerHTML = vFinal();
  wire();
}

const look = `<p class="lead" style="font-size:1.3em;color:var(--bone)">Дивись на екран 👀</p>`;

function vWait() {
  return `<div class="card">
    <div class="big">🎃</div>
    <h2>Ти в грі!</h2>
    <p class="muted">Чекаємо, поки ведуча почне. Телефон можна заблокувати, гра тебе дочекається.</p>
    ${look}
  </div>`;
}
function vIntro() {
  return `<div class="card">
    <div class="qmeta">Блок <b>${P.block.num}</b></div>
    <h2>${esc(P.block.name)}</h2>
    ${look}
  </div>`;
}
function qHead() {
  const q = P.q;
  return `<div class="qmeta">${esc(P.block.name)} · Питання <b>${q.num} / ${q.total}</b></div>`;
}
function vOver() {
  const q = P.q;
  const mine = q.mine == null ? null : (q.choice ? `${LETTERS[q.mine]} · ${q.options[q.mine]}` : q.mine);
  return `<div class="card">
    ${qHead()}
    <div class="timeup">Час вийшов</div>
    ${mine != null
      ? `<div class="sent"><span class="lbl">✓ Твоя відповідь</span><span class="val">${esc(mine)}</span></div>`
      : `<p class="muted">Ти не встиг(-ла) відповісти.</p>`}
    ${look}
  </div>`;
}

function vText() {
  const q = P.q;
  if (timeOver()) return vOver();
  if (q.mine != null && !editing) {
    return `<div class="card">
      ${qHead()}
      <div class="sent"><span class="lbl">✓ Відповідь прийнято</span><span class="val">${esc(q.mine)}</span></div>
      <button class="btn ghost" id="edit">Змінити</button>
      <p class="muted">Можна змінити, поки ведуча не показала відповідь.</p>
      ${look}
    </div>`;
  }
  if (draftKey !== q.key) { draftKey = q.key; draft = q.mine == null ? "" : q.mine; }
  return `<div class="card">
    ${qHead()}
    <h2 style="font-size:2em">Який це фільм?</h2>
    <form id="ansForm" autocomplete="off" style="display:flex;flex-direction:column;gap:.7em">
      <input class="field" id="ans" placeholder="Назва фільму" maxlength="80" aria-label="Твоя відповідь" enterkeyhint="send" value="${esc(draft)}">
      <button class="btn" type="submit">Відповісти</button>
      ${q.mine != null ? `<button class="btn ghost" type="button" id="cancel">Залишити «${esc(q.mine)}»</button>` : ""}
      <p class="hint" id="hint"></p>
    </form>
  </div>`;
}
function vChoice() {
  const q = P.q;
  if (timeOver()) return vOver();
  return `<div class="card">
    ${qHead()}
    <div class="choices">${q.options.map((o,k)=>`<button data-opt="${k}" class="${q.mine===k?'on':''}"><b>${LETTERS[k]}</b><span>${esc(o)}</span></button>`).join("")}</div>
    <p class="muted" id="hint">${q.mine != null ? "Вибір прийнято. Можна змінити, поки не показали відповідь." : "Обери варіант"}</p>
  </div>`;
}
function vResult() {
  const r = P.result;
  let box;
  if (r.ok) box = `<div class="res ok"><div class="head">✅ Правильно! +${r.gain}</div><div class="ans">${esc(r.a)}</div></div>`;
  else if (r.answered) box = `<div class="res no"><div class="head">❌ Ні</div><div class="ans">Це був <b>${esc(r.a)}</b></div></div>`;
  else box = `<div class="res no"><div class="head">⌛ Без відповіді</div><div class="ans">Це був <b>${esc(r.a)}</b></div></div>`;
  return `<div class="card">
    ${qHead()}
    ${box}
    <p class="muted">У тебе ${P.me.score} ${plural(P.me.score,"бал","бали","балів")}</p>
    ${look}
  </div>`;
}
function vScores() {
  return `<div class="card">
    <div class="eyebrow">Проміжні результати</div>
    <div class="place">${P.me.place}</div>
    <p class="muted">місце з ${P.me.of} · ${P.me.score} ${plural(P.me.score,"бал","бали","балів")}</p>
    ${look}
  </div>`;
}
function vFinal() {
  const medal = ["🥇","🥈","🥉"][P.me.place - 1] || "🎃";
  return `<div class="card">
    <div class="eyebrow">Кінець гри</div>
    <div class="big">${medal}</div>
    <div class="place">${P.me.place}</div>
    <p class="muted">місце з ${P.me.of} · ${P.me.score} ${plural(P.me.score,"бал","бали","балів")}</p>
    <p class="lead" style="color:var(--bone)">Дякуємо за гру! 🦇</p>
  </div>`;
}

/* ---------- таймер ---------- */
let autoSentKey = "";
let autoTimer = null;
function autoSubmit() {
  const inp = $("#ans");
  if (!inp || !P || !P.q || P.q.choice || autoSentKey === P.q.key) return;
  const v = inp.value.trim();
  if (!v || v === P.q.mine) return;
  autoSentKey = P.q.key;
  socket.emit("player:answer", { key: P.q.key, v }, () => {});
}

// Круглий годинник у куті. Коли час вийшов, його ховаємо: про це каже сама картка.
function renderTimer() {
  const el = $("#ptimer");
  if (!el) return;
  const t = P && P.phase === "q" && P.q && !P.q.revealed ? P.q.timer : null;
  if (!t) { el.hidden = true; return; }
  // Трохи раніше кінця надсилаємо написане, навіть якщо «Відповісти» не натиснули
  if (t.state === "running" && timerEnd - Date.now() <= 400) autoSubmit();
  // Час щойно вийшов: перемальовуємо екран, щоб закрити поле відповіді
  if (timeOver()) { el.hidden = true; render(); return; } // render() нічого не робить, якщо екран уже оновлено
  const total = t.total * 1000;
  const rem = t.state === "running" ? Math.max(0, timerEnd - Date.now()) : t.state === "paused" ? t.remaining : total;
  const secs = Math.ceil(rem / 1000);
  el.hidden = false;
  el.className = "ptimer " + (t.state === "pending" ? "pending" : t.state === "paused" ? "paused" : secs <= 5 ? "low" : "run");
  el.querySelector(".num").textContent = secs;
  el.querySelector(".arc").style.strokeDashoffset = 100 - rem / total * 100;
}
setInterval(renderTimer, 100);

function wire() {
  renderTimer();
  const f = $("#ansForm");
  if (f) {
    const inp = $("#ans");
    inp.oninput = () => { draft = inp.value; };
    f.onsubmit = e => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) { $("#hint").textContent = "Напиши назву фільму"; return; }
      const b = f.querySelector("button[type=submit]"); b.disabled = true;
      socket.emit("player:answer", { key: P.q.key, v }, res => {
        b.disabled = false;
        if (res && res.ok) { editing = false; inp.blur(); render(); }
        else { const h = $("#hint"); if (h) h.textContent = (res && res.error) || "Не вдалося надіслати"; }
      });
    };
    const c = $("#cancel"); if (c) c.onclick = () => { editing = false; render(); };
  }
  const ed = $("#edit");
  if (ed) ed.onclick = () => { editing = true; draft = P.q.mine == null ? "" : P.q.mine; render(); setTimeout(() => { const i = $("#ans"); if (i) { i.focus(); i.select(); } }, 30); };
  document.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => {
    const k = +b.dataset.opt;
    document.querySelectorAll("[data-opt]").forEach(x => x.classList.toggle("on", x === b));
    socket.emit("player:answer", { key: P.q.key, v: k }, res => {
      if (!(res && res.ok)) { const h = $("#hint"); if (h) h.textContent = (res && res.error) || "Не вдалося надіслати"; }
    });
  });
}
