/* Перевірка всіх YouTube-фрагментів: по черзі пробуємо програти кожен (без звуку). */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

let items = [];
let ytPromise = null;

function loadYT() {
  if (window.YT && YT.Player) return Promise.resolve();
  if (!ytPromise) ytPromise = new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = () => res();
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { ytPromise = null; rej(new Error("load")); };
    document.head.appendChild(s);
    setTimeout(() => rej(new Error("timeout")), 15000);
  });
  return ytPromise;
}

function reason(c) {
  if (c === 101 || c === 150) return "Власник ролика заборонив вбудовування. Потрібен інший ролик з цим фрагментом.";
  if (c === 100) return "Ролик видалено або зроблено приватним.";
  if (c === 2) return "Неправильний YouTube ID у файлі питань.";
  if (c === 5) return "Браузер не може програти цей ролик.";
  if (c === 153) return "YouTube не дозволяє програвати з цієї сторінки. Відкрийте її через http://localhost:3000/check.";
  return "YouTube повернув помилку " + c + ".";
}

function rowHTML(it, k) {
  const kind = it.type === "audio" ? "аудіо" : "відео";
  const cls = it.status === "ok" ? "ok" : it.status === "bad" ? "bad" : it.status === "wait" ? "wait" : "";
  const s = it.status === "ok" ? "✅ Грає" : it.status === "bad" ? "❌ Не грає" : it.status === "wait" ? "Перевіряємо…" : "—";
  return `<div class="row ${cls}">
    <span class="w">${it.level ? esc(it.level) + " · " : ""}Блок ${it.bi} · Питання ${it.qi}</span>
    <span class="s">${s}</span>
    <span class="k">${kind} · ${it.end - it.start} с</span>
    ${it.why ? `<span class="why">${esc(it.why)}</span>` : ""}
  </div>`;
}
function draw() {
  $("#rows").innerHTML = items.map(rowHTML).join("") || `<p class="lead">У файлі питань немає відео чи аудіо.</p>`;
  const done = items.filter(i => i.status === "ok" || i.status === "bad");
  const bad = items.filter(i => i.status === "bad").length;
  $("#summary").textContent = !items.length || done.length < items.length ? ""
    : bad ? `Не грає: ${bad} з ${items.length}. Ці питання треба замінити або просто пропустити під час гри.`
    : `Усі ${items.length} фрагментів грають 🎃`;
}

function probe(it) {
  return new Promise(resolve => {
    const box = $("#probe");
    box.hidden = false;
    box.querySelector("#probeTarget")?.remove();
    const t = document.createElement("div"); t.id = "probeTarget"; box.prepend(t);
    let finished = false, player = null;
    const finish = (ok, why) => {
      if (finished) return; finished = true;
      clearTimeout(timer);
      try { player && player.destroy(); } catch (e) {}
      resolve({ ok, why });
    };
    const timer = setTimeout(() => finish(false, "Не вдалося запустити за 20 секунд. Перевірте інтернет і спробуйте ще раз."), 20000);
    player = new YT.Player("probeTarget", {
      width: "320", height: "180", videoId: it.yt,
      playerVars: { start: it.start, controls: 0, rel: 0, iv_load_policy: 3, playsinline: 1, mute: 1, autoplay: 1, origin: location.origin },
      events: {
        onReady: e => { try { e.target.mute(); e.target.seekTo(it.start, true); e.target.playVideo(); } catch (er) {} },
        onStateChange: e => {
          if (e.data === YT.PlayerState.PLAYING) {
            let dur = 0; try { dur = e.target.getDuration(); } catch (er) {}
            if (dur && it.end > dur + 1) finish(false, `Ролик коротший (${Math.floor(dur)} с), ніж кінець фрагмента (${it.end} с).`);
            else finish(true);
          }
        },
        onError: e => finish(false, reason(e.data))
      }
    });
  });
}

async function run() {
  const btn = $("#run");
  btn.disabled = true;
  try {
    items = (await (await fetch("/api/videos")).json()).map(i => ({ ...i, status: "", why: "" }));
  } catch (e) {
    $("#summary").textContent = "Не вдалося отримати список роликів із сервера.";
    btn.disabled = false; return;
  }
  draw();
  try { await loadYT(); }
  catch (e) {
    $("#summary").textContent = "Не вдалося завантажити YouTube. Перевірте інтернет.";
    btn.disabled = false; return;
  }
  for (const it of items) {
    it.status = "wait"; draw();
    const r = await probe(it);
    it.status = r.ok ? "ok" : "bad"; it.why = r.why || ""; draw();
  }
  $("#probe").hidden = true;
  btn.disabled = false; btn.textContent = "Перевірити ще раз";
}
$("#run").onclick = run;
