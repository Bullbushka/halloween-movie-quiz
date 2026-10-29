"use strict";
/* Швидка самоперевірка: автоперевірка відповідей, кодування і файли рівнів.
   node tools/selftest.js  (тексту питань не виводить — лише «OK» чи кількість помилок) */

const fs = require("fs");
const path = require("path");
const { isCorrect } = require("../lib/check");
const Q = require("../lib/questions");

const cases = [
  // регістр, розділові знаки, лапки, артиклі
  ["воно", ["Воно", "It"], true],
  ["ВОНО", ["Воно", "It"], true],
  ["It", ["Воно", "It"], true],
  ["Воно!", ["Воно", "It"], true],
  ["«Воно»", ["Воно", "It"], true],
  ["the it", ["Воно", "It"], true],
  // номери частин не враховуються
  ["Пила", ["Пила", "Saw"], true],
  ["Пила 3", ["Пила", "Saw"], true],
  ["Saw II", ["Пила", "Saw"], true],
  ["Пила частина 2", ["Пила", "Saw"], true],
  ["Saw Part 3", ["Пила", "Saw"], true],
  ["Saw: Chapter X", ["Пила", "Saw"], true],
  ["Пила, розділ 4", ["Пила", "Saw"], true],
  ["Пила", ["Пила 2", "Saw II"], true],
  ["пила 2", ["Пила 2", "Saw II"], true],
  ["Saw 2", ["Пила 2", "Saw II"], true],
  // числа всередині слова
  ["M3GAN", ["M3GAN", "Меган"], true],
  ["Меган", ["M3GAN", "Меган"], true],
  ["MGAN", ["M3GAN", "Меган"], true],
  // назва лише з чисел
  ["1408", ["1408"], true],
  ["1409", ["1408"], false],
  // схожі літери й опечатки
  ["Сяйво", ["Сяйво", "The Shining"], true],
  ["сяиво", ["Сяйво", "The Shining"], true],
  ["shinning", ["Сяйво", "The Shining"], true],
  ["Шайнінг", ["Сяйво", "The Shining"], false],
  ["Екзорцист", ["Екзорцист", "The Exorcist"], true],
  ["Ексорцист", ["Екзорцист", "The Exorcist"], true],
  ["Пятниця 13", ["П'ятниця, 13-те", "Friday the 13th"], true],
  ["Friday the 13th Part 2", ["П'ятниця, 13-те", "Friday the 13th"], true],
  // неправильні відповіді
  ["", ["Воно"], false],
  ["Крик", ["Крик", "Scream"], true],
  ["Крок", ["Крик", "Scream"], false],
  ["Пила", ["Крик", "Scream"], false]
];

let fail = 0;
for (const [ans, accept, want] of cases) {
  const got = isCorrect(ans, accept);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"} "${ans}" vs [${accept.join(", ")}] → ${got ? "зараховано" : "не зараховано"}`);
}

/* --- кодування відповідей: закодоване має розкодовуватися в те саме --- */
console.log("\nКодування відповідей:");
const sample = { title: "т", blocks: [{ name: "б", questions: [
  { type: "emoji", emoji: "🎃", a: "Гарбуз 2", accept: ["Гарбуз", "Pumpkin"], fact: "факт" },
  { type: "blitz", q: "?", options: ["А", "Б"], correct: 1, a: "Б", fact: "" }
] }] };
const enc = Q.encodeQuiz(sample);
const encOk = JSON.stringify(enc).includes("Гарбуз") === false &&
  JSON.stringify(Q.decodeQuiz(enc)) === JSON.stringify(sample) &&
  JSON.stringify(Q.encodeQuiz(enc)) === JSON.stringify(enc); // повторне кодування нічого не псує
if (!encOk) fail++;
console.log(`${encOk ? "OK  " : "FAIL"} відповіді сховані й розкодовуються без змін`);

/* --- файли рівнів: обидва мають читатися і проходити перевірку формату --- */
console.log("\nФайли питань:");
const ROOT = path.join(__dirname, "..");
const files = [
  ["questions.json", "складний рівень", true],
  ["questions-easy.json", "легкий рівень", false],   // необов'язковий: без нього гра з одним рівнем
  ["test-questions.json", "тестова гра", false]
];
for (const [file, label, required] of files) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    if (required) fail++;
    console.log(`${required ? "FAIL" : "--  "} ${file} (${label}): файлу немає${required ? "" : ", це нормально"}`);
    continue;
  }
  try {
    const quiz = Q.decodeQuiz(JSON.parse(fs.readFileSync(full, "utf8").replace(/^﻿/, "")));
    const { errors } = Q.validate(quiz);
    const n = quiz.blocks.reduce((s, b) => s + b.questions.length, 0);
    if (errors.length) fail++;
    console.log(`${errors.length ? "FAIL" : "OK  "} ${file} (${label}): ${quiz.blocks.length} блоків, ${n} питань${errors.length ? `, помилок: ${errors.length}` : ""}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${file} (${label}): не читається (${e.message})`);
  }
}

console.log(fail ? `\n${fail} перевірок не пройдено` : "\nУсі перевірки пройдено");
process.exit(fail ? 1 : 0);
