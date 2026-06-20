(() => {
  "use strict";

  const BANK = window.QUESTION_BANK;
  if (!BANK?.questions?.length) {
    document.body.innerHTML = "<h1 style='padding:40px'>题库载入失败，请确认 question-bank.js 与本页面位于同一文件夹。</h1>";
    return;
  }

  const STORAGE_KEY = "xigai-quiz-progress-v1";
  const questions = BANK.questions;
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const chapters = [...new Map(questions.map((q) => [q.chapter, q.chapterTitle])).entries()];

  const defaultState = () => ({
    version: 1,
    streaks: {},
    attempts: 0,
    correct: 0,
    studyPositions: {},
    updatedAt: new Date().toISOString(),
  });

  let progress = loadProgress();
  let setupMode = null;
  let session = null;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const screens = [...document.querySelectorAll(".screen")];

  function loadProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return parsed?.version === 1 ? { ...defaultState(), ...parsed } : defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveProgress() {
    progress.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function showScreen(id) {
    screens.forEach((screen) => screen.classList.toggle("active", screen.id === id));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function streakFor(id) {
    return Number(progress.streaks[id] || 0);
  }

  function isMastered(id) {
    return streakFor(id) >= 2;
  }

  function recordAnswer(question, isCorrect) {
    progress.attempts += 1;
    if (isCorrect) {
      progress.correct += 1;
      progress.streaks[question.id] = Math.min(2, streakFor(question.id) + 1);
    } else {
      progress.streaks[question.id] = 0;
    }
    saveProgress();
  }

  function answerLabel(question, answer = question.answer) {
    if (question.type === "判断题") return answer[0] === "T" ? "对" : "错";
    return answer.join("");
  }

  function detailedAnswer(question, answer = question.answer) {
    if (question.type === "判断题") return answerLabel(question, answer);
    return answer
      .map((key) => {
        const option = question.options.find((item) => item.key === key);
        return `${key}. ${option?.text || ""}`;
      })
      .join("；");
  }

  function sameAnswer(a, b) {
    return [...a].sort().join("") === [...b].sort().join("");
  }

  function dashboard() {
    const mastered = questions.filter((q) => isMastered(q.id)).length;
    const percent = Math.round((mastered / questions.length) * 100);
    $("mastered-count").textContent = mastered;
    $("wrong-count").textContent = questions.length - mastered;
    $("attempt-count").textContent = progress.attempts;
    $("accuracy-label").textContent = `正确率 ${progress.attempts ? Math.round((progress.correct / progress.attempts) * 100) : 0}%`;
    $("mastery-percent").textContent = `${percent}%`;
    $("mastery-ring").style.setProperty("--progress", `${percent}%`);

    $("chapter-progress-list").innerHTML = chapters
      .map(([chapter, title]) => {
        const chapterQuestions = questions.filter((q) => q.chapter === chapter);
        const count = chapterQuestions.filter((q) => isMastered(q.id)).length;
        const value = Math.round((count / chapterQuestions.length) * 100);
        return `
          <div class="chapter-row" title="${escapeHtml(title)}">
            <strong>${chapter.toUpperCase()}</strong>
            <div class="mini-track"><div style="width:${value}%"></div></div>
            <span class="chapter-percent">${count}/${chapterQuestions.length}</span>
          </div>`;
      })
      .join("");
    showScreen("dashboard-screen");
  }

  function openSetup(mode) {
    setupMode = mode;
    const config = {
      study: {
        eyebrow: "顺序记忆",
        title: "背题模式",
        description: "题目与正确答案同时显示。按空格、回车或方向右键进入下一题；背题不改变掌握状态。",
        start: "开始背题",
      },
      practice: {
        eyebrow: "顺序作答",
        title: "刷题模式",
        description: "即时判定对错。单选与判断按数字自动提交，多选选择完毕后按回车提交。",
        start: "开始刷题",
      },
      review: {
        eyebrow: "循环强化",
        title: "错题复习",
        description: "只练尚未连续答对两次的题。未掌握题会循环回到队尾，直至本轮范围全部清零。",
        start: "开始清错题",
      },
      exam: {
        eyebrow: "40 题 · 100 分",
        title: "模拟考试",
        description: "随机抽取 20 道单选、10 道多选和 10 道判断。作答时不显示答案，全部答完后统一结算。",
        start: "开始模拟考试",
      },
    }[mode];

    $("setup-eyebrow").textContent = config.eyebrow;
    $("setup-title").textContent = config.title;
    $("setup-description").textContent = config.description;
    $("start-button").textContent = config.start;
    $("scope-fields").style.display = mode === "exam" ? "none" : "grid";
    updateSetupSummary();
    showScreen("setup-screen");
  }

  function filteredQuestions(mode = setupMode) {
    const chapter = $("chapter-select").value;
    const type = $("type-select").value;
    return questions.filter((q) => {
      if (chapter !== "全部" && q.chapter !== chapter) return false;
      if (type !== "全部" && q.type !== type) return false;
      if (mode === "review" && isMastered(q.id)) return false;
      return true;
    });
  }

  function updateSetupSummary() {
    if (setupMode === "exam") {
      $("setup-summary").innerHTML = "20 单选 × 3 分 + 10 多选 × 3 分 + 10 判断 × 1 分 = <strong>100 分</strong>";
      $("start-button").disabled = false;
      return;
    }
    const list = filteredQuestions();
    const scope = $("chapter-select").value === "全部" ? "全题库" : $("chapter-select").selectedOptions[0].textContent;
    const suffix = setupMode === "review" ? " 道当前错题" : " 道题";
    $("setup-summary").innerHTML = `<strong>${scope}</strong> · ${$("type-select").value} · 共 <strong>${list.length}</strong>${suffix}`;
    $("start-button").disabled = list.length === 0;
  }

  function startSession() {
    if (setupMode === "exam") return startExam();
    const list = filteredQuestions();
    if (!list.length) return;
    const scopeKey = `${$("chapter-select").value}|${$("type-select").value}`;
    let index = 0;
    if (setupMode === "study") {
      index = Math.min(progress.studyPositions[scopeKey] || 0, Math.max(0, list.length - 1));
    }
    session = {
      mode: setupMode,
      list: setupMode === "review" ? [...list] : list,
      index,
      scopeKey,
      selected: [],
      submitted: false,
      initialTotal: list.length,
      completed: 0,
    };
    renderQuestion();
    showScreen("question-screen");
  }

  function startExam() {
    const pick = (type, count) => shuffle(questions.filter((q) => q.type === type)).slice(0, count);
    const list = shuffle([...pick("单选题", 20), ...pick("多选题", 10), ...pick("判断题", 10)]);
    session = {
      mode: "exam",
      list,
      index: 0,
      selected: [],
      submitted: false,
      answers: [],
    };
    renderQuestion();
    showScreen("question-screen");
  }

  function renderQuestion() {
    const question = session.list[session.index];
    const questionCard = document.querySelector(".question-card");
    questionCard.classList.remove("question-enter");
    session.selected = [];
    session.submitted = false;
    $("mode-label").textContent = {
      study: "背题模式",
      practice: "刷题模式",
      review: "错题复习",
      exam: "模拟考试",
    }[session.mode];

    let counter;
    let progressValue;
    if (session.mode === "review") {
      const remaining = session.list.filter((q) => !isMastered(q.id)).length;
      counter = `待掌握 ${remaining} 题`;
      progressValue = ((session.initialTotal - remaining) / session.initialTotal) * 100;
    } else {
      counter = `${session.index + 1} / ${session.list.length}`;
      progressValue = ((session.index + 1) / session.list.length) * 100;
    }
    $("question-counter").textContent = counter;
    $("question-progress-bar").style.width = `${Math.max(0, progressValue)}%`;
    $("question-type").textContent = question.type;
    $("question-chapter").textContent = `${question.chapter.toUpperCase()} · ${question.chapterTitle}`;
    $("question-stem").textContent = question.stem;
    $("feedback").className = "feedback";
    $("feedback").textContent = "";

    if (session.mode === "study") {
      renderStudyAnswer(question);
      $("keyboard-hint").textContent = "空格 / 回车 / →：下一题　　←：上一题";
    } else {
      renderOptions(question);
      $("keyboard-hint").textContent =
        question.type === "多选题"
          ? "按 1—4 选择或取消，按回车提交"
          : question.type === "判断题"
            ? "按 1 选择“对”，按 0 选择“错”并自动提交"
            : "按 1—4 选择并自动提交";
    }

    // 强制浏览器确认初始状态，使每次切题都能重新播放入场动画。
    void questionCard.offsetWidth;
    questionCard.classList.add("question-enter");
  }

  function renderStudyAnswer(question) {
    const optionsHtml =
      question.type === "判断题"
        ? ""
        : question.options
            .map(
              (option, index) => `
                <div class="option ${question.answer.includes(option.key) ? "correct" : ""}" style="--option-index:${index}">
                  <span class="option-key">${option.key}</span><span>${escapeHtml(option.text)}</span>
                </div>`,
            )
            .join("");
    $("answer-area").innerHTML = `
      ${optionsHtml}
      <div class="answer-reveal" style="--option-index:${question.options.length || 0}"><strong>✓ 正确答案：${answerLabel(question)}</strong><br>${escapeHtml(detailedAnswer(question))}</div>`;
  }

  function renderOptions(question) {
    const options =
      question.type === "判断题"
        ? [
            { key: "T", text: "对", digit: "1" },
            { key: "F", text: "错", digit: "0" },
          ]
        : question.options.map((option, index) => ({ ...option, digit: String(index + 1) }));

    $("answer-area").innerHTML = options
      .map(
        (option, index) => `
          <button class="option" data-answer="${option.key}" type="button" style="--option-index:${index}">
            <span class="option-key">${option.digit}</span>
            <span>${escapeHtml(option.text)}</span>
          </button>`,
      )
      .join("");

    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.addEventListener("click", () => selectAnswer(button.dataset.answer));
    });
  }

  function selectAnswer(key) {
    if (!session || session.submitted || session.mode === "study") return;
    const question = session.list[session.index];
    if (question.type === "多选题") {
      session.selected = session.selected.includes(key)
        ? session.selected.filter((item) => item !== key)
        : [...session.selected, key];
      syncSelection();
      return;
    }
    session.selected = [key];
    syncSelection();
    submitAnswer();
  }

  function syncSelection() {
    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.classList.toggle("selected", session.selected.includes(button.dataset.answer));
    });
  }

  function submitAnswer() {
    if (!session.selected.length || session.submitted) return;
    const question = session.list[session.index];
    const isCorrect = sameAnswer(session.selected, question.answer);
    session.submitted = true;

    if (session.mode === "exam") {
      recordAnswer(question, isCorrect);
      session.answers.push({
        questionId: question.id,
        selected: [...session.selected],
        correct: isCorrect,
      });
      if (session.index >= session.list.length - 1) finishExam();
      else {
        session.index += 1;
        renderQuestion();
      }
      return;
    }

    recordAnswer(question, isCorrect);
    document.querySelectorAll("[data-answer]").forEach((button) => {
      const key = button.dataset.answer;
      button.disabled = true;
      if (question.answer.includes(key)) button.classList.add("correct");
      if (session.selected.includes(key) && !question.answer.includes(key)) button.classList.add("wrong");
    });

    const feedback = $("feedback");
    feedback.className = `feedback visible ${isCorrect ? "correct" : "wrong"}`;
    feedback.innerHTML = isCorrect
      ? `✅ 正确！${isMastered(question.id) ? "该题已连续答对两次，移出错题本。" : "再连续答对一次即可掌握。"}`
      : `❌ 错误！正确答案：${answerLabel(question)}　${escapeHtml(detailedAnswer(question))}`;
    $("keyboard-hint").textContent = "按回车 / 空格进入下一题";
  }

  function nextQuestion() {
    if (!session) return;
    if (session.mode === "study") {
      if (session.index >= session.list.length - 1) {
        showToast("这一范围已经背到最后一题");
        return;
      }
      session.index += 1;
      progress.studyPositions[session.scopeKey] = session.index;
      saveProgress();
      renderQuestion();
      return;
    }
    if (!session.submitted || session.mode === "exam") return;

    if (session.mode === "review") {
      const current = session.list[session.index];
      session.list.splice(session.index, 1);
      if (!isMastered(current.id)) session.list.push(current);
      if (!session.list.length) {
        dashboard();
        showToast("🎉 本轮错题已经全部清零");
        return;
      }
      if (session.index >= session.list.length) session.index = 0;
    } else if (session.index >= session.list.length - 1) {
      dashboard();
      showToast("本轮刷题已完成");
      return;
    } else {
      session.index += 1;
    }
    renderQuestion();
  }

  function previousStudyQuestion() {
    if (session?.mode !== "study" || session.index <= 0) return;
    session.index -= 1;
    progress.studyPositions[session.scopeKey] = session.index;
    saveProgress();
    renderQuestion();
  }

  function finishExam() {
    const points = { 单选题: 3, 多选题: 3, 判断题: 1 };
    let score = 0;
    for (const answer of session.answers) {
      if (answer.correct) score += points[questionMap.get(answer.questionId).type];
    }
    const correctCount = session.answers.filter((a) => a.correct).length;
    $("exam-score").textContent = score;
    $("score-circle").style.setProperty("--progress", `${score}%`);
    $("result-title").textContent = score >= 85 ? "状态很好，继续稳住。" : score >= 60 ? "已经及格，错题还值得再磨一轮。" : "先别慌，错题本正好告诉你该往哪用力。";
    $("result-summary").textContent = `共答对 ${correctCount} / 40 题，错 ${40 - correctCount} 题。`;

    $("exam-breakdown").innerHTML = ["单选题", "多选题", "判断题"]
      .map((type) => {
        const typeAnswers = session.answers.filter((answer) => questionMap.get(answer.questionId).type === type);
        const right = typeAnswers.filter((answer) => answer.correct).length;
        return `<article class="stat-card"><span>${type}</span><strong>${right}/${typeAnswers.length}</strong><small>本题型答对</small></article>`;
      })
      .join("") + `<article class="stat-card ${score < 60 ? "danger" : ""}"><span>总分</span><strong>${score}</strong><small>满分 100</small></article>`;

    $("exam-review-list").innerHTML = session.answers
      .map((answer, index) => {
        const question = questionMap.get(answer.questionId);
        return `
          <article class="review-item ${answer.correct ? "" : "wrong"}">
            <span class="${answer.correct ? "good" : "bad"}">${answer.correct ? "✅ 正确" : "❌ 错误"} · 第 ${index + 1} 题 · ${question.type}</span>
            <h3>${escapeHtml(question.stem)}</h3>
            <p>你的答案：${escapeHtml(answerLabel(question, answer.selected))}</p>
            <p>正确答案：<strong>${escapeHtml(answerLabel(question))}</strong>　${escapeHtml(detailedAnswer(question))}</p>
          </article>`;
      })
      .join("");
    showScreen("result-screen");
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `习概刷题进度_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("进度文件已导出");
  }

  async function importProgress(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.version !== 1 || typeof parsed.streaks !== "object") throw new Error();
      progress = { ...defaultState(), ...parsed };
      saveProgress();
      dashboard();
      showToast("进度导入成功");
    } catch {
      showToast("进度文件无效，未进行修改");
    } finally {
      event.target.value = "";
    }
  }

  function resetProgress() {
    if (!window.confirm("确定清空全部学习记录吗？此操作无法撤销，建议先导出进度。")) return;
    if (!window.confirm("再次确认：969 道题将全部恢复为未掌握。")) return;
    progress = defaultState();
    saveProgress();
    dashboard();
    showToast("学习进度已重置");
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function handleKeydown(event) {
    if (!session || !$("question-screen").classList.contains("active")) return;
    const key = event.key;
    if (session.mode === "study") {
      if ([" ", "Enter", "ArrowRight"].includes(key)) {
        event.preventDefault();
        nextQuestion();
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        previousStudyQuestion();
      }
      return;
    }

    if (session.submitted) {
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        nextQuestion();
      }
      return;
    }

    const question = session.list[session.index];
    if (question.type === "判断题" && (key === "1" || key === "0")) {
      selectAnswer(key === "1" ? "T" : "F");
    } else if (question.type !== "判断题" && /^[1-9]$/.test(key)) {
      const option = question.options[Number(key) - 1];
      if (option) selectAnswer(option.key);
    } else if (question.type === "多选题" && key === "Enter") {
      event.preventDefault();
      submitAnswer();
    }
  }

  $("chapter-select").innerHTML =
    '<option value="全部">全部章节</option>' +
    chapters.map(([chapter, title]) => `<option value="${chapter}">${chapter.toUpperCase()} · ${escapeHtml(title)}</option>`).join("");

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => openSetup(button.dataset.mode));
  });
  document.querySelectorAll('[data-action="home"]').forEach((button) => button.addEventListener("click", dashboard));
  $("home-button").addEventListener("click", dashboard);
  $("chapter-select").addEventListener("change", updateSetupSummary);
  $("type-select").addEventListener("change", updateSetupSummary);
  $("start-button").addEventListener("click", startSession);
  $("retry-exam-button").addEventListener("click", () => openSetup("exam"));
  $("export-button").addEventListener("click", exportProgress);
  $("import-input").addEventListener("change", importProgress);
  $("reset-button").addEventListener("click", resetProgress);
  document.addEventListener("keydown", handleKeydown);

  dashboard();
})();
