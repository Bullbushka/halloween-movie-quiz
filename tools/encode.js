"use strict";
/* Кодує відповіді (a, accept, correct, fact) у base64.
   Використання: node tools/encode.js questions.plain.json questions.json */

const fs = require("fs");
const path = require("path");
const { encodeQuiz, decodeQuiz, validate } = require("../lib/questions");

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.log("Використання: node tools/encode.js <відкритий файл> <закодований файл>");
  console.log("Наприклад:    node tools/encode.js questions.plain.json questions.json");
  process.exit(1);
}

let quiz;
try {
  quiz = JSON.parse(fs.readFileSync(path.resolve(src), "utf8").replace(/^﻿/, ""));
} catch (e) {
  console.error(`Не вдалося прочитати ${src}: ${e.message}`);
  process.exit(1);
}

const { errors, warnings } = validate(decodeQuiz(quiz));
warnings.forEach(w => console.log("Увага: " + w));
if (errors.length) {
  errors.forEach(e => console.error("Помилка: " + e));
  console.error("Файл не збережено. Виправте помилки і запустіть ще раз.");
  process.exit(1);
}

fs.writeFileSync(path.resolve(dst), JSON.stringify(encodeQuiz(quiz), null, 2) + "\n", "utf8");
const n = quiz.blocks.reduce((s, b) => s + b.questions.length, 0);
console.log(`Готово: ${dst} (${quiz.blocks.length} блоків, ${n} питань). Відповіді закодовано.`);
