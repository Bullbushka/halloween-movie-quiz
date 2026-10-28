"use strict";
/* Автоперевірка текстових відповідей.
   Порівнюємо «нормалізовані» рядки: без регістру, пробілів, розділових знаків,
   лапок, артиклів, з урахуванням схожих літер і 1–2 опечаток.
   Номери частин не враховуємо: «Пила», «Пила 3», «Saw II», «Пила частина 2» — це все «Пила». */

const LETTERS = {
  "ё": "е", "є": "е", "э": "е",
  "і": "и", "ї": "и", "ы": "и",
  "ґ": "г",
  "ь": "", "ъ": "",
  "'": "", "’": "", "ʼ": "", "‘": "", "`": "", "´": ""
};
const mapLetters = s => s.replace(/[ёєэіїыґьъ'’ʼ‘`´]/g, c => LETTERS[c]);

const ARTICLES = new Set(["the", "a", "an"]);
const ROMAN = new Set(["ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);
// Слова, що позначають частину; пропускаємо через ту саму заміну літер, що й відповіді
const PART_WORDS = new Set(["частина", "part", "chapter", "розділ"].map(mapLetters));

function normalize(s) {
  let t = mapLetters(String(s == null ? "" : s).normalize("NFC").toLowerCase());
  t = t.replace(/&/g, " and ");
  const tokens = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .filter(w => !ARTICLES.has(w) && !ROMAN.has(w) && !PART_WORDS.has(w));
  const withDigits = tokens.join("");
  // Числа прибираємо скрізь, навіть усередині слова (M3GAN → mgan).
  // Якщо назва складається лише з чисел (наприклад, «1408»), залишаємо їх.
  const text = withDigits.replace(/\p{N}+/gu, "");
  return { text: text || withDigits };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

// Скільки опечаток прощаємо залежно від довжини правильного варіанта
function tolerance(len) {
  if (len <= 4) return 0;
  if (len <= 8) return 1;
  return 2;
}

function isCorrect(answer, accept) {
  const a = normalize(answer);
  if (!a.text) return false;
  for (const variant of accept || []) {
    const v = normalize(variant);
    if (!v.text) continue;
    const len = [...v.text].length;
    if (levenshtein(a.text, v.text) <= tolerance(len)) return true;
  }
  return false;
}

module.exports = { isCorrect, normalize, levenshtein };
