"use strict";
/* Читання, перевірка і (роз)кодування файлу з питаннями.
   Поля-відповіді зберігаються як "b64:" + base64(JSON.stringify(значення)). */

const SECRET = ["a", "accept", "correct", "fact"];
const PREFIX = "b64:";
const TYPES = ["emoji", "review", "video", "rule", "audio", "blitz"];

function encodeValue(v) {
  if (typeof v === "string" && v.startsWith(PREFIX)) return v; // вже закодовано
  return PREFIX + Buffer.from(JSON.stringify(v), "utf8").toString("base64");
}
function decodeValue(v) {
  if (typeof v === "string" && v.startsWith(PREFIX)) {
    return JSON.parse(Buffer.from(v.slice(PREFIX.length), "base64").toString("utf8"));
  }
  return v;
}

function mapSecrets(quiz, fn) {
  const out = JSON.parse(JSON.stringify(quiz));
  for (const b of out.blocks || []) {
    for (const q of b.questions || []) {
      for (const k of SECRET) if (k in q) q[k] = fn(q[k]);
    }
  }
  return out;
}
const encodeQuiz = quiz => mapSecrets(quiz, encodeValue);
const decodeQuiz = quiz => mapSecrets(quiz, decodeValue);

// Чи є в питанні варіанти для натискання (інакше гравець вводить текст)
const isChoice = q => Array.isArray(q.options) && q.options.length > 0;

function validate(quiz) {
  const errors = [], warnings = [];
  if (!quiz || !Array.isArray(quiz.blocks) || !quiz.blocks.length) {
    errors.push("У файлі немає жодного блоку (поле \"blocks\").");
    return { errors, warnings };
  }
  quiz.blocks.forEach((b, bi) => {
    const where0 = `Блок ${bi + 1}`;
    if (!b.name) errors.push(`${where0}: немає назви (name).`);
    if (!Array.isArray(b.questions) || !b.questions.length) {
      errors.push(`${where0}: немає питань.`);
      return;
    }
    b.questions.forEach((q, qi) => {
      const where = `${where0}, питання ${qi + 1}`;
      if (!TYPES.includes(q.type)) errors.push(`${where}: невідомий тип "${q.type}".`);
      if (q.a == null || q.a === "") errors.push(`${where}: немає правильної відповіді (a).`);
      if (q.type === "video" || q.type === "audio") {
        if (!q.yt) errors.push(`${where}: немає YouTube ID (yt).`);
        if (!(Number(q.end) > Number(q.start || 0))) errors.push(`${where}: end має бути більше за start.`);
      }
      if (isChoice(q)) {
        if (q.options.length < 2 || q.options.length > 4) errors.push(`${where}: варіантів має бути від 2 до 4.`);
        if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length)
          errors.push(`${where}: "correct" має бути номером варіанта від 0 до ${q.options.length - 1}.`);
      } else if (!Array.isArray(q.accept) || !q.accept.length) {
        warnings.push(`${where}: немає списку "accept", перевірятиму тільки за полем "a".`);
      }
    });
  });
  return { errors, warnings };
}

// Готує розкодовану вікторину до гри: підставляє значення за замовчуванням
function prepare(quiz) {
  for (const b of quiz.blocks) {
    for (const q of b.questions) {
      q.start = Number(q.start) || 0;
      if (q.end != null) q.end = Number(q.end);
      if (!isChoice(q) && (!Array.isArray(q.accept) || !q.accept.length)) q.accept = [String(q.a)];
    }
  }
  return quiz;
}

module.exports = { SECRET, encodeQuiz, decodeQuiz, validate, prepare, isChoice, encodeValue, decodeValue };
