/* Звуки екрана ведучої, синтезовані через Web Audio (без файлів).
   Браузер дозволяє звук лише після першого кліку чи клавіші, тому контекст «будимо» на них. */
const Sound = (() => {
  const KEY = "halloween-quiz-sound";
  let on = true;
  try { on = localStorage.getItem(KEY) !== "off"; } catch (e) {}
  let ctx = null, master = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35; // загальна гучність: тихо, щоб не перекрикувати компанію
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  const wake = () => { if (on) ensure(); };
  window.addEventListener("keydown", wake);
  window.addEventListener("pointerdown", wake);

  // Один тон з обвідною гучності
  function tone(freq, start, dur, { type = "sine", gain = 0.3, attack = 0.005, to = null, filter = null } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (to) o.frequency.exponentialRampToValueAtTime(to, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = filter;
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.05);
  }

  function play(fn) {
    if (!on || !ensure() || ctx.state !== "running") return;
    fn(ctx.currentTime + 0.02);
  }

  return {
    get on() { return on; },
    toggle() {
      on = !on;
      try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
      if (on) ensure();
      return on;
    },
    // Цокання годинника (останні 5 секунд); останнє — трохи вище
    tick(last) {
      play(t => {
        tone(last ? 1500 : 1150, t, 0.06, { type: "triangle", gain: 0.35 });
        tone(last ? 750 : 575, t, 0.04, { type: "square", gain: 0.05, filter: 1800 });
      });
    },
    // Низький гонг «Час вийшов»: кілька негармонійних обертонів з довгим згасанням
    gong() {
      play(t => {
        [[98, 0.45, 3.2], [196.8, 0.22, 2.6], [263, 0.16, 2.2], [393, 0.1, 1.6], [527, 0.06, 1.1]]
          .forEach(([f, g, d]) => tone(f, t, d, { gain: g, attack: 0.01 }));
        tone(70, t, 0.4, { gain: 0.3, to: 50 }); // удар
      });
    },
    // Фанфари у фіналі: арпеджіо і довгий акорд «мідних»
    fanfare() {
      play(t => {
        const brass = (f, s, d, g = 0.18) => {
          tone(f, s, d, { type: "sawtooth", gain: g, attack: 0.03, filter: 2200 });
          tone(f * 2, s, d, { type: "triangle", gain: g * 0.3, attack: 0.03 });
        };
        [392, 523.3, 659.3, 784].forEach((f, i) => brass(f, t + i * 0.16, 0.22));
        [523.3, 659.3, 784, 1046.5].forEach(f => brass(f, t + 0.7, 1.6, 0.12));
      });
    }
  };
})();
