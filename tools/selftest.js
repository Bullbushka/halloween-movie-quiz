"use strict";
/* Швидка самоперевірка автоперевірки відповідей: node tools/selftest.js */

const { isCorrect } = require("../lib/check");

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
console.log(fail ? `\n${fail} перевірок не пройдено` : "\nУсі перевірки пройдено");
process.exit(fail ? 1 : 0);
