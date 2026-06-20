import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "..", "习近平新时代中国特色社会主义思想概论_章节测验题库.md");
const outputPath = path.resolve(here, "question-bank.js");
const source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
const lines = source.split("\n");

const questions = [];
let chapter = "";
let chapterTitle = "";

for (let i = 0; i < lines.length; i += 1) {
  const chapterMatch = lines[i].match(/^## ch(\d+)\s+(.+)$/);
  if (chapterMatch) {
    chapter = `ch${chapterMatch[1]}`;
    chapterTitle = chapterMatch[2].trim();
    continue;
  }

  const questionMatch = lines[i].match(/^###\s+(\d+)\.\s+(单选题|多选题|判断题)$/);
  if (!questionMatch || !chapter) continue;

  const number = Number(questionMatch[1]);
  const type = questionMatch[2];
  const body = [];
  i += 1;
  while (i < lines.length && !lines[i].match(/^\*\*正确答案：(.+)\*\*$/)) {
    if (lines[i].match(/^###\s+\d+\./) || lines[i].match(/^## ch\d+/)) {
      throw new Error(`题目缺少答案：${chapter} 第 ${number} 题`);
    }
    body.push(lines[i]);
    i += 1;
  }

  const answerMatch = lines[i]?.match(/^\*\*正确答案：(.+)\*\*$/);
  if (!answerMatch) throw new Error(`题目缺少答案：${chapter} 第 ${number} 题`);

  const options = [];
  const stemLines = [];
  for (const rawLine of body) {
    const optionMatch = rawLine.match(/^-\s+\*\*([A-Z])\.\*\*\s*(.+)$/);
    if (optionMatch) {
      options.push({ key: optionMatch[1], text: optionMatch[2].trim() });
    } else if (rawLine.trim()) {
      stemLines.push(rawLine.trim());
    }
  }

  const rawAnswer = answerMatch[1].trim();
  const answer =
    type === "判断题"
      ? rawAnswer === "对"
        ? ["T"]
        : ["F"]
      : [...rawAnswer.replace(/[^A-Z]/g, "")];

  questions.push({
    id: `${chapter}-${number}`,
    chapter,
    chapterTitle,
    number,
    type,
    stem: stemLines.join("\n"),
    options,
    answer,
  });
}

const counts = questions.reduce(
  (result, question) => {
    result[question.type] += 1;
    return result;
  },
  { 单选题: 0, 多选题: 0, 判断题: 0 },
);

if (
  questions.length !== 969 ||
  counts.单选题 !== 398 ||
  counts.多选题 !== 292 ||
  counts.判断题 !== 279
) {
  throw new Error(`题库数量校验失败：${JSON.stringify(counts)}，总数 ${questions.length}`);
}

for (const question of questions) {
  if (!question.stem || !question.answer.length) {
    throw new Error(`题目解析不完整：${question.id}`);
  }
  if (question.type !== "判断题" && question.options.length < 2) {
    throw new Error(`选项解析不完整：${question.id}`);
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: path.basename(sourcePath),
  counts: { total: questions.length, ...counts },
  questions,
};

fs.writeFileSync(
  outputPath,
  `window.QUESTION_BANK = ${JSON.stringify(payload)};\n`,
  "utf8",
);

console.log(`已生成 ${outputPath}`);
console.log(`总题数 ${questions.length}：单选 ${counts.单选题}，多选 ${counts.多选题}，判断 ${counts.判断题}`);
