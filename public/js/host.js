/* Екран ведучої. Стан приходить із сервера; відповіді до розкриття сюди не надходять. */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const plural = (n,one,few,many) => { const a=n%10,b=n%100; if(a===1&&b!==11)return one; if(a>=2&&a<=4&&(b<12||b>14))return few; return many; };

// Стікер + ім'я гравця
const who = p => `<span class="stk">${esc(p.sticker || "🎃")}</span>${esc(p.name)}`;

const socket = io();
let G = null;            // останній стан від сервера
let viewKey = "";        // що зараз намальовано в <main>
let prevScores = {};
let timerEnd = null;     // коли закінчиться час на поточне питання (за локальним годинником)

let menuChecked = false;  // меню «Продовжити / Нова гра» показуємо один раз при відкритті сторінки
let gameOver = false;

socket.on("connect", () => { $("#banner").hidden = true; socket.emit("host:hello"); });
socket.on("disconnect", () => { if (!gameOver) $("#banner").hidden = false; });
socket.on("game:over", showGameOver);
socket.on("host:denied", () => {
  $("#main").innerHTML = `<div class="stage"><h2>Тут лише гравці</h2>
    <p class="lead">Екран ведучої відкривається тільки на ноутбуці, де запущено гру. Щоб грати, відкрийте <a href="/play" style="color:var(--pumpkin)">сторінку гравця</a>.</p></div>`;
});
socket.on("host:state", st => {
  G = st;
  // Сервер надсилає залишок часу; кінець рахуємо за годинником цього браузера
  timerEnd = G.timer && G.timer.state === "running" ? Date.now() + G.timer.remaining : null;
  update();
  // Сторінку відкрили, а гра вже йде (наприклад, вкладку випадково закрили): питаємо, що робити
  if (!menuChecked) {
    menuChecked = true;
    if (G.players.length || G.i > 0) openMenu(false);
  }
});

const send = (ev, data) => socket.emit(ev, data);

/* ---------- render ---------- */
let lastStepT = null;    // попередній екран: щоб фанфари грали лише при переході до фіналу
function update() {
  const st = G.step;
  if (lastStepT && lastStepT !== "final" && st.t === "final") Sound.fanfare();
  lastStepT = st.t;
  const key = [G.gameId, G.i, G.revealed ? 1 : 0].join("|");
  if (key !== viewKey) {
    viewKey = key;
    stopClip();
    const m = $("#main");
    if (st.t === "title") m.innerHTML = viewTitle();
    else if (st.t === "lobby") m.innerHTML = viewLobby();
    else if (st.t === "intro") m.innerHTML = viewIntro(st.bi);
    else if (st.t === "q") m.innerHTML = viewQ(st.bi, st.qi);
    else if (st.t === "scores") m.innerHTML = viewScores(st.bi);
    else m.innerHTML = viewFinal();
    m.scrollTop = 0;
    wireMain(st);
  }
  renderHeader(st);
  fillDynamic(st);
  renderFooter(st);
  if (!$("#overlay").hidden) showOverlay();
}

function renderHeader(st) {
  const cur = st.bi != null ? st.bi : (st.t === "final" ? G.blocks.length : -1);
  $("#progress").innerHTML = G.blocks.map((b,k)=>`<i class="${k<cur?'done':k===cur?'now':''}" title="${esc(b.name)}"></i>`).join("");
  const where = st.bi != null ? `Блок ${st.bi+1} · ${esc(G.blocks[st.bi].name)}` : "";
  // Непомітна позначка рівня (лише коли рівнів два); у тестовій грі — помітна плашка «Тест»
  const lvl = G.hasLevels && G.mode !== "test" && st.t !== "title" ? `<span class="levelmark">${esc(G.levelName)}</span>` : "";
  $("#where").innerHTML = (G.mode === "test" && st.t !== "title" ? `<span class="testbadge">Тест</span>` : "") + lvl + (lvl && where ? " · " : "") + where;
}

function viewTitle() {
  return `<div class="stage">
    <div class="eyebrow">Геловін · вікторина</div>
    <h1 class="flicker">${esc(G.title)}</h1>
    <p class="lead">${esc(G.subtitle)}</p>
    <div style="display:flex;gap:.6em;flex-wrap:wrap;justify-content:center">
      <button class="btn" data-start="level">Почати гру</button>
      ${G.hasTest ? `<button class="btn ghost" data-start="test" title="Гра з питаннями-заглушками, щоб усе перевірити">Тест</button>` : ""}
      ${G.hasProgress ? `<button class="btn ghost" data-newgame>Нова гра</button>` : ""}
    </div>
    <div class="keys"><kbd>→</kbd> далі · <kbd>←</kbd> назад · <kbd>Пробіл</kbd> показати відповідь · <kbd>P</kbd> програти фрагмент · <kbd>S</kbd> бали · <kbd>F</kbd> на весь екран · <kbd>M</kbd> звук · <kbd>Esc</kbd> меню</div>
  </div>`;
}

function viewLobby() {
  const warn = G.join.noLan ? `<p class="hint">Ноутбук не підключений до Wi-Fi. Підключіться і перезапустіть гру.</p>` : "";
  return `<div class="stage">
    <div class="eyebrow">Скануйте QR-код телефоном</div>
    <h2>Хто грає?</h2>
    <div class="lobby-grid">
      <div class="qr"><img src="/qr.svg?${Date.now()}" alt="QR-код для входу в гру"></div>
      <div class="lobby-side">
        <div class="small">Телефон має бути в <b>тій самій Wi-Fi мережі</b>, що й ноутбук.</div>
        ${warn}
        <div class="count" id="lobbyCount"></div>
        <div class="plist" id="lobbyList"></div>
        <p class="hint" id="hint"></p>
      </div>
    </div>
    ${levelPicker()}
    <button class="btn" data-go="next">Почати гру</button>
  </div>`;
}
// Вибір рівня в лобі (лише якщо є обидва файли питань і це не тестова гра)
function levelPicker() {
  if (!G.hasLevels || G.mode === "test") return "";
  const b = (m, label) => `<button class="${G.mode === m ? "on" : ""}" data-level="${m}"${G.mode === m ? ' aria-pressed="true"' : ""}>${label}</button>`;
  return `<div class="levels"><span class="levels-label">Рівень</span>${b("easy", "Легкий")}${b("hard", "Складний")}</div>`;
}

function viewIntro(bi) {
  const b = G.blocks[bi];
  // Сітка з трьох рядів: назва блоку рівно посередині, цифра над нею, правила під нею
  return `<div class="stage intro">
    <div class="intro-top">
      <div class="blocknum">${bi+1}</div>
      <div class="eyebrow">${esc(b.tagline)} · ${b.count} ${plural(b.count,"питання","питання","питань")}</div>
    </div>
    <h2>${esc(b.name)}</h2>
    <div class="intro-bottom"><div class="rules">${esc(b.rules)}</div></div>
  </div>`;
}

// Варіанти А/Б/В/Г (бліц, а також відео й аудіо, якщо в них є options); після розкриття підсвічуємо правильний
function optsHTML(q, rev) {
  if (!Array.isArray(q.options) || !q.options.length) return "";
  const correct = rev ? G.reveal.correct : null;
  const dist = rev && G.reveal.dist;
  const total = dist ? dist.reduce((s, n) => s + n, 0) : 0;
  // Після розкриття: біля варіанта кількість гравців, а фон заповнюється пропорційно
  return `<div class="opts${dist ? " with-dist" : ""}">${q.options.map((o,k)=>{
    const n = dist ? dist[k] : 0;
    const p = total ? Math.round(n / total * 100) : 0;
    return `<div class="${rev ? (k===correct?'right':'dim') : ''}"${dist ? ` style="--p:${p}%"` : ""}><b>${"АБВГ"[k]}</b><span class="ot">${esc(o)}</span>${dist ? `<span class="cnt">${n}</span>` : ""}</div>`;
  }).join("")}</div>`;
}

function viewQ(bi, qi) {
  const b = G.blocks[bi], q = G.q, rev = !!G.revealed;
  let body = "";
  if (q.type === "emoji") body = `<p class="prompt">Який це фільм?</p><div class="emoji">${esc(q.emoji)}</div>`;
  else if (q.type === "review") { const stars = Math.max(1, Math.min(5, q.stars || 1)); body = `<div class="review">
      <div class="who"><div class="ava">${esc((q.author||"?")[0])}</div><div>${esc(q.author)}<div class="meta">${esc(q.meta||"")}</div></div></div>
      <div class="stars">${"★".repeat(stars)}${"☆".repeat(5-stars)}</div>
      <p>${esc(q.text)}</p></div>`; }
  else if (q.type === "rule") body = `<div class="rule"><div class="label">Правило виживання №${qi+1}</div><p>${esc(q.text)}</p></div>${rev ? "" : `<p class="prompt">Який фільм нас цього навчив?</p>`}`;
  else if (q.type === "video") body = `<div class="screen" id="screen">
      <div class="yt"><div id="ytTarget"></div></div>
      <div class="mask-top"></div><div class="mask-bot"></div>
      <button class="curtain" id="curtain"><div class="play">▶</div><small>${rev ? "Переглянути ще раз" : `Натисніть, щоб побачити (${q.end-q.start} с)`}</small></button>
    </div>`;
  else if (q.type === "audio") body = `<div class="screen" id="screen">
      <div class="yt"><div id="ytTarget"></div></div>
      <button class="curtain" id="curtain"><div class="bars"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="play">▶</div><small id="audioLbl">${rev ? "Послухати ще раз" : `Слухаємо ${q.end-q.start} с`}</small></button>
    </div>`;
  else if (q.type === "blitz") body = `<p class="blitz-q">${esc(q.q)}</p>${optsHTML(q, rev)}`;
  const withOpts = (q.type === "video" || q.type === "audio") && Array.isArray(q.options) && q.options.length;
  // Відео/аудіо з варіантами: плеєр зліва повного розміру, варіанти справа сіткою 2×2
  if (withOpts) body = `<div class="clip-row">${body}${optsHTML(q, rev)}</div>`;

  const tail = rev
    ? `<div class="answer"><div class="a">${esc(G.reveal.a)}</div>${G.reveal.fact ? `<p class="fact">${esc(G.reveal.fact)}</p>` : ""}</div>
       <div class="results" id="results"></div>
       <div class="results-hint">Клацніть по відповіді гравця, щоб змінити ✅ / ❌</div>`
    : `<div class="status" id="status"></div>
       <button class="btn ghost" id="reveal">Показати відповідь</button>`;
  return `<div class="stage${rev ? " revealed" : ""}${withOpts ? " clip-opts" : ""}">
    <div class="qhead"><span class="qnum">Питання ${qi+1} / ${b.count}</span></div>
    ${body}
    ${tail}
  </div>`;
}

// Однакові бали — однакове місце (так само рахує сервер для телефонів)
const placeOf = p => 1 + G.ranked.filter(x => x.score > p.score).length;

function boardHTML(withDelete) {
  const r = G.ranked;
  if (!r.length) return `<p class="lead">Гравців немає. Вони з'являться, коли зайдуть з телефонів.</p>`;
  // Понад 8 гравців — дві колонки (місця 1…N згори вниз по лівій, далі по правій)
  const two = r.length > 8;
  return `<div class="board lead1${two ? " two" : ""}"${two ? ` style="grid-template-rows:repeat(${Math.ceil(r.length/2)},auto)"` : ""}>${r.map(p=>`<div><span class="pos">${placeOf(p)}</span><span>${who(p)}</span><span class="pts">${p.score}</span>${withDelete ? `<button class="del" data-remove="${esc(p.id)}" title="Прибрати гравця" aria-label="Прибрати ${esc(p.name)}">×</button>` : "<span></span>"}</div>`).join("")}</div>`;
}

function viewScores(bi) {
  return `<div class="stage">
    <div class="eyebrow">Після блоку ${bi+1}</div>
    <h2>Проміжні результати</h2>
    <div id="board" style="width:min(640px,100%)"></div>
    <div class="eyebrow" style="color:var(--ash)">Далі: ${esc(G.blocks[bi+1].name)}</div>
  </div>`;
}

function viewFinal() {
  return `<div class="stage">
    <div class="eyebrow">Кінець гри</div>
    <div id="finalBox" style="display:contents"></div>
  </div>`;
}
function finalHTML() {
  const r = G.ranked;
  const top = [r[1], r[0], r[2]];
  const h = [12, 18, 8]; // висота стовпчиків п'єдесталу у vh (2-ге, 1-ше, 3-тє місце)
  const pod = r.length ? `<div class="podium">${top.map((p,k)=>p?`<div><div class="psticker">${esc(p.sticker || "🎃")}</div><div class="name">${esc(p.name)}</div><div class="pts">${p.score} ${plural(p.score,"бал","бали","балів")}</div><div class="col" style="height:${h[k]}vh">${placeOf(p)}</div></div>`:`<div></div>`).join("")}</div>` : "";
  const rest = r.slice(3);
  // Кнопка іншого рівня — лише якщо його ще не грали; вона веде в лобі, щоб могли приєднатися нові гравці
  const other = G.otherLevel && !G.played.includes(G.otherLevel)
    ? `<button class="btn" data-start="${G.otherLevel}">Зіграти ${G.otherLevel === "easy" ? "легкий" : "складний"} рівень</button>` : "";
  return `<h1 class="flicker" style="font-size:clamp(2.4rem,min(6vw,10vh),6rem)">${r[0] ? "Переможець: "+esc(r[0].name) : "Гру завершено"}</h1>
    ${pod}
    ${rest.length ? `<div class="board rest">${rest.map(p=>`<div><span class="pos">${placeOf(p)}</span><span>${who(p)}</span><span class="pts">${p.score}</span></div>`).join("")}</div>` : ""}
    <div class="final-actions">${other}<button class="btn${other ? " ghost" : ""}" data-newgame>Нова гра</button></div>`;
}

/* Частини, що змінюються без перемальовування всього екрана (щоб не зупиняти відео) */
function fillDynamic(st) {
  if (st.t === "lobby") {
    const n = G.players.length;
    $("#lobbyCount").innerHTML = n ? `У грі <b>${n}</b> ${plural(n,"гравець","гравці","гравців")}` : "";
    $("#lobbyList").innerHTML = G.players.map(p=>`<span class="${p.online?'':'off'}">${who(p)} <button data-remove="${esc(p.id)}" aria-label="Прибрати ${esc(p.name)}">×</button></span>`).join("")
      || `<span class="empty">Поки нікого. Чекаємо, поки хтось зайде…</span>`;
    if (n) $("#hint").textContent = "";
  }
  if (st.t === "q" && !G.revealed) {
    const n = G.answered.length, all = G.players.length;
    const over = G.timer && G.timer.state === "over";
    $("#status").innerHTML = (G.allAnswered && !over
        ? `<div class="all-in">Усі відповіли — можна відкривати</div>`
        : `<div class="count">Відповіли <b>${n}</b> з ${all}</div>`) +
      `<div class="who-list">${G.answered.map(a=>`<span>${who(a)}</span>`).join("")}</div>`;
    const rb = $("#reveal"); if (rb) rb.classList.toggle("ready", !!G.allAnswered);
  }
  if (st.t === "q" && G.revealed) {
    $("#results").innerHTML = G.results.map(r => r.text == null
      ? `<button class="none" disabled><span class="nm">${who(r)}</span><span class="tx">не відповів(-ла)</span><span class="mk">—</span></button>`
      : `<button class="${r.ok?'ok':'no'}" data-toggle="${esc(r.pid)}" title="Змінити оцінку"><span class="nm">${who(r)}</span><span class="tx">${esc(r.text)}${r.manual?` <span class="man">вручну</span>`:""}</span><span class="mk">${r.ok?"✅":"❌"}</span></button>`
    ).join("") || `<p class="lead">Гравців немає.</p>`;
  }
  renderTimer();
  if (st.t === "scores") $("#board").innerHTML = boardHTML(false);
  if (st.t === "final") $("#finalBox").innerHTML = finalHTML();
}

function renderFooter(st) {
  const showChips = (st.t === "q" || st.t === "intro") && G.players.length;
  const chips = showChips ? `<div class="chips">${G.players.map(p=>`<span class="chip${p.online?'':' off'}" id="chip-${esc(p.id)}"><button data-minus="${esc(p.id)}" aria-label="Мінус бал ${esc(p.name)}">−</button><span class="nm">${who(p)}</span><span class="sc">${p.score}</span><button class="plus" data-plus="${esc(p.id)}" aria-label="Плюс бал ${esc(p.name)}">+</button></span>`).join("")}</div>` : "";
  const navs = st.t === "title" ? "" : `<div class="nav"><button class="btn ghost" data-go="prev">← Назад</button>${st.t!=="final" ? `<button class="btn" data-go="next">Далі →</button>` : ""}</div>`;
  $("#footer").innerHTML = chips + navs;
  for (const p of G.players) {
    if (prevScores[p.id] != null && prevScores[p.id] !== p.score) {
      const c = document.getElementById("chip-" + p.id);
      if (c) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
    }
    prevScores[p.id] = p.score;
  }
}

/* ---------- таймер ---------- */
let sndKey = "", sndSec = null, sndMode = null;
// Круглий годинник у куті: кільце «спливає», у центрі секунди
function renderTimer() {
  const el = $("#timer");
  if (!el) return;
  if (!G || G.step.t !== "q" || !G.timer || G.revealed) { el.hidden = true; return; }
  const t = G.timer, total = t.total * 1000;
  const rem = t.state === "running" ? Math.max(0, timerEnd - Date.now()) : t.state === "paused" ? t.remaining : t.state === "over" ? 0 : total;
  const secs = Math.ceil(rem / 1000);
  const mode = rem <= 0 ? "over" : t.state === "pending" ? "pending" : t.state === "paused" ? "paused" : secs <= 5 ? "low" : "run";
  // Звуки: цокання щосекунди в останні 5 с і гонг, коли час вийшов (лише «наживо», не при відкритті сторінки)
  const sk = G.gameId + "|" + G.i;
  if (sk === sndKey) {
    if (mode === "low" && secs !== sndSec) Sound.tick(secs === 1);
    if (mode === "over" && (sndMode === "low" || sndMode === "run")) Sound.gong();
  }
  sndKey = sk; sndSec = secs; sndMode = mode;
  el.hidden = false;
  el.className = "timer " + mode;
  el.querySelector(".num").textContent = mode === "over" ? "0" : secs;
  el.querySelector(".arc").style.strokeDashoffset = 100 - rem / total * 100;
  el.querySelector(".label").textContent = mode === "over" ? "Час вийшов" : mode === "paused" ? "пауза" : mode === "pending" ? (t.clip ? "після фрагмента" : "") : "";
}
setInterval(renderTimer, 100);

/* ---------- дії ---------- */
function go(d) {
  if (!G) return;
  if (d > 0 && G.step.t === "lobby" && !G.players.length) {
    const h = $("#hint"); if (h) h.textContent = "Ще ніхто не приєднався. Зайдіть хоча б з одного телефона.";
    return;
  }
  send("host:go", d);
}
function reveal() {
  if (!G || G.step.t !== "q" || G.revealed) return false;
  stopClip();
  send("host:reveal");
  return true;
}
function playerName(pid) { const p = G.players.find(x => x.id === pid); return p ? p.name : ""; }

// Делегування кліків: кнопки перемальовуються, а обробник один
document.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t || !G) return;
  if (t.dataset.go) go(t.dataset.go === "next" ? 1 : -1);
  else if (t.dataset.start || t.dataset.level) {
    // «level» з титульного екрана = поточний рівень (або складний, якщо щойно грали тест)
    const mode = t.dataset.start || t.dataset.level;
    const target = mode === "level" ? (G.mode === "test" ? "hard" : G.mode) : mode;
    const names = { hard: "складний рівень", easy: "легкий рівень", test: "тестову гру" };
    // Інший набір питань = нова гра. Питаємо, лише якщо поточну гру не дограли до фіналу.
    if (target !== G.mode && G.hasProgress && G.step.t !== "final") {
      ask(`Почати ${names[target]}? Бали поточної гри скинуться, гравці залишаться.`,
        "Так, почати", () => send("host:start", { mode }));
    } else if (t.dataset.level && target === G.mode) {
      // вже обраний рівень — нічого не робимо
    } else send("host:start", { mode });
  }
  else if (t.dataset.plus) send("host:adj", { pid: t.dataset.plus, d: 1 });
  else if (t.dataset.minus) send("host:adj", { pid: t.dataset.minus, d: -1 });
  else if (t.dataset.toggle) send("host:toggle", { pid: t.dataset.toggle });
  else if (t.dataset.remove) {
    const pid = t.dataset.remove;
    ask(`Прибрати гравця «${esc(playerName(pid))}»? Його бали теж зникнуть.`, "Прибрати", () => send("host:remove", { pid }));
  }
  else if (t.hasAttribute("data-newgame")) {
    ask("Почати нову гру? Усі бали скинуться, а гравці залишаться.", "Так, нова гра", () => send("host:newgame"));
  }
  else if (t.id === "reveal") reveal();
  else if (t.id === "mContinue") closeMenu();
  else if (t.id === "mNew") {
    ask("Почати нову гру? Усі бали скинуться, а гравці залишаться.", "Так, нова гра", () => { closeMenu(); send("host:newgame"); });
  }
  else if (t.id === "mExit") {
    ask("Вийти з гри? <b>Увесь прогрес буде видалено</b>: гравці, бали, відповіді. Сервер зупиниться.", "Так, вийти", () => send("host:quit"));
  }
});

function wireMain(st) {
  // Плеєр працює і після «Показати відповідь»: фрагмент можна переглядати скільки завгодно
  if (st.t === "q" && (G.q.type === "video" || G.q.type === "audio")) mountClip(G.q);
}

/* ---------- меню: продовжити / нова гра / вихід ---------- */
function whereNow() {
  const st = G.step;
  if (st.t === "q") return `Блок ${st.bi+1} · питання ${st.qi+1} / ${G.blocks[st.bi].count}`;
  if (st.t === "intro") return `Блок ${st.bi+1} · ${G.blocks[st.bi].name}`;
  if (st.t === "scores") return `Результати після блоку ${st.bi+1}`;
  if (st.t === "final") return "Фінал";
  if (st.t === "lobby") return "Лобі";
  return "Початок";
}
// withExit: меню, відкрите клавішею Escape під час гри (з кнопкою «Вихід»)
function openMenu(withExit) {
  if (!G || gameOver) return;
  const n = G.players.length;
  const m = $("#menu");
  m.innerHTML = `<div class="eyebrow">${withExit ? "Меню" : "Знайдено незавершену гру"}</div>
    <h2>${withExit ? "Що робимо?" : "З поверненням!"}</h2>
    <p class="lead">${G.mode === "test" ? "Тестова гра · " : G.hasLevels ? esc(G.levelName) + " · " : ""}${esc(whereNow())}${n ? ` · ${n} ${plural(n,"гравець","гравці","гравців")}` : ""}</p>
    <div class="menu-actions">
      <button class="btn" id="mContinue">Продовжити</button>
      <button class="btn ghost" id="mNew">Нова гра</button>
      ${withExit ? `<button class="btn ghost danger-ghost" id="mExit">Вихід</button>` : ""}
    </div>
    ${withExit ? `<div class="keys"><kbd>Esc</kbd> повернутися до гри</div>` : ""}`;
  m.hidden = false;
  $("#mContinue").focus();
  send("host:pause"); // поки меню відкрите, таймер стоїть
}
function closeMenu() {
  if ($("#menu").hidden) return;
  $("#menu").hidden = true;
  send("host:resume");
}

function showGameOver() {
  gameOver = true;
  stopClip();
  socket.disconnect();
  for (const id of ["#menu", "#modal", "#overlay", "#timer", "#banner"]) $(id).hidden = true;
  $("#progress").innerHTML = ""; $("#where").textContent = ""; $("#footer").innerHTML = "";
  $("#main").innerHTML = `<div class="stage">
    <div class="eyebrow">Ніч кіношного жаху</div>
    <h1 class="flicker" style="font-size:clamp(2.6rem,6vw,6rem)">Гру завершено</h1>
    <p class="lead">Прогрес видалено, сервер зупинено. Цю вкладку можна закрити.<br>Щоб зіграти знову, запустіть <b>start.bat</b>.</p>
  </div>`;
  try { window.close(); } catch (e) {}
}

/* ---------- підтвердження всередині сторінки ---------- */
let modalYes = null;
function ask(html, yesLabel, onYes) {
  const m = $("#modal");
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><p>${html}</p><div class="row">
    <button class="btn danger" id="mYes">${esc(yesLabel)}</button><button class="btn ghost" id="mNo">Скасувати</button></div></div>`;
  m.hidden = false;
  modalYes = onYes;
  $("#mYes").onclick = () => { closeModal(); onYes(); };
  $("#mNo").onclick = closeModal;
  $("#mNo").focus();
}
function closeModal() { $("#modal").hidden = true; modalYes = null; }

/* ---------- YouTube ---------- */
let player = null, clipTimer = null, clipQ = null, ytPromise = null;
function loadYT() {
  if (window.YT && YT.Player) return Promise.resolve();
  if (!ytPromise) ytPromise = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { ytPromise = null; rej(new Error("load")); };
    document.head.appendChild(s);
    setTimeout(() => rej(new Error("timeout")), 15000);
  });
  return ytPromise;
}
function clipError(msg) {
  const sc = $("#screen"); if (!sc) return;
  const d = document.createElement("div"); d.className = "err"; d.innerHTML = msg; sc.appendChild(d);
  send("host:clipDone"); // фрагмент не покажемо, тож запускаємо таймер одразу
}
function mountClip(q) {
  clipQ = q;
  $("#curtain").onclick = () => playClip();
  loadYT().then(() => {
    if (clipQ !== q || !$("#ytTarget")) return;
    const vars = { start: q.start, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1, origin: location.origin };
    player = new YT.Player("ytTarget", { width: "100%", height: "100%", videoId: q.yt, playerVars: vars,
      events: {
        onError: e => {
          const c = e.data;
          const why = (c===101||c===150) ? "власник ролика заборонив вбудовування на інших сайтах"
            : c===100 ? "ролик видалено або зроблено приватним"
            : c===153 ? "YouTube не дозволяє програвати з цієї сторінки"
            : c===2 ? "неправильний ID ролика" : "невідома помилка YouTube";
          clipError(`<div><b>Фрагмент не відтворюється</b> (код ${c}): ${why}.<br>Нічого страшного — просто переходьте далі.</div>`);
        }
      } });
  }).catch(() => clipError(`<div><b>Не вдалося завантажити YouTube.</b><br>Перевірте інтернет. Можна просто перейти далі.</div>`));
}
function playClip() {
  const q = clipQ; if (!q) return;
  if (!player || typeof player.seekTo !== "function") { const l = $("#curtain small"); if (l) l.textContent = "Завантажується… натисніть ще раз"; return; }
  const cur = $("#curtain");
  if (q.type === "video") cur.hidden = true;
  else { cur.classList.add("playing"); const l = $("#audioLbl"); if (l) l.textContent = "Грає…"; }
  player.unMute && player.unMute(); player.setVolume && player.setVolume(100);
  player.seekTo(q.start, true); player.playVideo();
  clearInterval(clipTimer);
  const t0 = Date.now();
  clipTimer = setInterval(() => {
    let t = 0; try { t = player.getCurrentTime(); } catch (e) {}
    if (t >= q.end || Date.now() - t0 > (q.end - q.start + 8) * 1000) endClip();
  }, 80);
}
function endClip() {
  clearInterval(clipTimer); clipTimer = null;
  try { player && player.pauseVideo(); } catch (e) {}
  send("host:clipDone"); // таймер стартує після першого перегляду (повтори його не скидають)
  const cur = $("#curtain"); if (!cur) return;
  cur.hidden = false; cur.classList.remove("playing");
  const l = cur.querySelector("small"); if (l) l.textContent = "Ще раз";
}
function stopClip() {
  clearInterval(clipTimer); clipTimer = null;
  if (player) { try { player.destroy(); } catch (e) {} player = null; }
  clipQ = null;
}

/* ---------- таблиця балів, повний екран, клавіші ---------- */
function showOverlay() {
  const o = $("#overlay");
  o.innerHTML = `<div class="eyebrow">Поточні бали</div><h2>Таблиця</h2>${G ? boardHTML(true) : ""}<button class="btn ghost" id="closeOv">Закрити</button>`;
  o.hidden = false; $("#closeOv").onclick = () => { o.hidden = true; };
}
function toggleOverlay() { const o = $("#overlay"); if (o.hidden) showOverlay(); else o.hidden = true; }
function toggleFull() {
  try { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{}); else document.exitFullscreen(); } catch (e) {}
}
function syncSoundBtn() { $("#bSound").textContent = Sound.on ? "🔊 Звук" : "🔇 Звук"; }
function toggleSound() { Sound.toggle(); syncSoundBtn(); }
syncSoundBtn();
$("#bSound").onclick = toggleSound;
$("#bScores").onclick = toggleOverlay;
$("#bFull").onclick = toggleFull;
document.addEventListener("keydown", e => {
  if (e.target.matches("input,textarea")) return;
  if (gameOver) return;
  if (!$("#modal").hidden) { if (e.key === "Escape") closeModal(); return; }
  if (!$("#menu").hidden) { if (e.key === "Escape") closeMenu(); return; }
  const k = e.key;
  if (k === "ArrowRight" || k === "PageDown") { e.preventDefault(); go(1); }
  else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); go(-1); }
  else if (k === " " || k === "Enter") {
    if (e.target.tagName === "BUTTON") e.target.blur();
    e.preventDefault();
    if (!reveal()) go(1);
  }
  else if (k === "p" || k === "P" || k === "з" || k === "З") playClip();
  else if (k === "s" || k === "S" || k === "і" || k === "І" || k === "ы" || k === "Ы") toggleOverlay();
  else if (k === "f" || k === "F" || k === "а" || k === "А") toggleFull();
  else if (k === "m" || k === "M" || k === "ь" || k === "Ь") toggleSound();
  else if (k === "Escape") {
    if (!$("#overlay").hidden) $("#overlay").hidden = true; // спершу закриваємо таблицю балів
    else openMenu(true);
  }
});
