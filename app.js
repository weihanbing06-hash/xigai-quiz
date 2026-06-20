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
  let examTimerInterval = null;

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
    stopExamTimer();
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
      responses: {},
      optionOrders: {},
      initialTotal: list.length,
    };
    renderQuestion();
    showScreen("question-screen");
  }

  function startExam() {
    const pick = (type, count) => shuffle(questions.filter((q) => q.type === type)).slice(0, count);
    const list = [...pick("单选题", 20), ...pick("多选题", 10), ...pick("判断题", 10)];
    session = {
      mode: "exam",
      list,
      index: 0,
      selected: [],
      submitted: false,
      responses: {},
      optionOrders: {},
      examEndsAt: Date.now() + 20 * 60 * 1000,
    };
    startExamTimer();
    renderQuestion();
    showScreen("question-screen");
  }

  function renderQuestion() {
    const question = session.list[session.index];
    const questionCard = document.querySelector(".question-card");
    questionCard.classList.remove("question-enter");
    const response = session.responses[question.id];
    session.selected = response ? [...response.selected] : [];
    session.submitted = Boolean(response?.submitted);
    $("mode-label").textContent = {
      study: "背题模式",
      practice: "刷题模式",
      review: "错题复习",
      exam: "模拟考试",
    }[session.mode];
    $("exam-timer").hidden = session.mode !== "exam";
    if (session.mode === "exam") updateExamTimer();

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
    questionCard.classList.remove("question-single", "question-multiple", "question-judge");
    questionCard.classList.add(
      question.type === "多选题"
        ? "question-multiple"
        : question.type === "判断题"
          ? "question-judge"
          : "question-single",
    );
    $("feedback").className = "feedback";
    $("feedback").textContent = "";
    $("submit-answer-button").classList.remove("visible");
    $("submit-answer-button").disabled = true;

    if (session.mode === "study") {
      $("answer-mode-hint").hidden = true;
      renderStudyAnswer(question);
      $("keyboard-hint").textContent = "空格 / 回车 / →：下一题　　←：上一题";
    } else {
      renderAnswerModeHint(question);
      renderOptions(question);
      syncSelection();
      if (session.submitted) {
        showSubmittedAnswer(question, response);
      } else {
        $("keyboard-hint").textContent =
          question.type === "多选题"
            ? "点击选项或按 1—4 选择，按回车提交"
            : question.type === "判断题"
              ? "点击选项，或按 1 选择“对”、按 0 选择“错”"
              : "点击选项，或按 1—4 直接作答";
        if (question.type === "多选题") {
          $("submit-answer-button").classList.add("visible");
          $("submit-answer-button").disabled = session.selected.length === 0;
        }
      }
    }
    updateQuestionNavigation();

    // 强制浏览器确认初始状态，使每次切题都能重新播放入场动画。
    void questionCard.offsetWidth;
    questionCard.classList.add("question-enter");
  }

  function renderAnswerModeHint(question) {
    const hint = $("answer-mode-hint");
    hint.hidden = false;
    if (question.type === "多选题") {
      hint.innerHTML = `
        <span class="answer-mode-icon" aria-hidden="true">✓✓</span>
        <span><strong>多项选择</strong><small>可选择多个选项，确认无误后提交答案</small></span>`;
    } else {
      hint.innerHTML = `
        <span class="answer-mode-icon" aria-hidden="true">→</span>
        <span><strong>${question.type === "判断题" ? "判断选择" : "单项选择"}</strong><small>选择一个答案后将立即提交</small></span>`;
    }
  }

  function renderStudyAnswer(question) {
    const displayOptions = displayOptionsFor(question);
    const optionsHtml =
      question.type === "判断题"
        ? ""
        : displayOptions
            .map(
              (option, index) => `
                <div class="option ${question.answer.includes(option.key) ? "correct" : ""}" style="--option-index:${index}">
                  <span class="option-key">${index + 1}</span><span>${escapeHtml(option.text)}</span>
                </div>`,
            )
            .join("");
    $("answer-area").innerHTML = `
      ${optionsHtml}
      <div class="answer-reveal" style="--option-index:${question.options.length || 0}"><strong>✓ 正确答案：${displayAnswerLabel(question)}</strong><br>${escapeHtml(displayDetailedAnswer(question))}</div>`;
  }

  function renderOptions(question) {
    const options =
      question.type === "判断题"
        ? [
            { key: "T", text: "对", digit: "1" },
            { key: "F", text: "错", digit: "0" },
          ]
        : displayOptionsFor(question).map((option, index) => ({ ...option, digit: String(index + 1) }));

    $("answer-area").innerHTML = options
      .map(
        (option, index) => `
          <button class="option" data-answer="${option.key}" type="button" style="--option-index:${index}">
            <span class="option-key">
              <span class="option-number">${option.digit}</span>
              <span class="option-check" aria-hidden="true">✓</span>
            </span>
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
      session.responses[question.id] = { selected: [...session.selected], submitted: false };
      syncSelection();
      $("submit-answer-button").disabled = session.selected.length === 0;
      return;
    }
    session.selected = [key];
    session.responses[question.id] = { selected: [...session.selected], submitted: false };
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
    const response = {
      questionId: question.id,
      selected: [...session.selected],
      submitted: true,
      correct: isCorrect,
    };
    session.responses[question.id] = response;
    recordAnswer(question, isCorrect);
    $("submit-answer-button").classList.remove("visible");

    if (session.mode === "exam") {
      showSubmittedAnswer(question, response);
      updateQuestionNavigation();
      return;
    }

    showSubmittedAnswer(question, response);
    updateQuestionNavigation();
  }

  function showSubmittedAnswer(question, response) {
    document.querySelectorAll("[data-answer]").forEach((button) => {
      const key = button.dataset.answer;
      button.disabled = true;
      button.classList.toggle("selected", response.selected.includes(key));
      if (session.mode !== "exam") {
        if (question.answer.includes(key)) button.classList.add("correct");
        if (response.selected.includes(key) && !question.answer.includes(key)) button.classList.add("wrong");
      }
    });

    if (session.mode === "exam") {
      $("keyboard-hint").textContent = "已作答，可使用下方按钮检查其他题目；交卷前不显示答案";
      return;
    }

    const feedback = $("feedback");
    feedback.className = `feedback visible ${response.correct ? "correct" : "wrong"}`;
    feedback.innerHTML = response.correct
      ? `✅ 正确！${isMastered(question.id) ? "该题已连续答对两次，移出错题本。" : "再连续答对一次即可掌握。"}`
      : `❌ 错误！正确答案：${displayAnswerLabel(question)}　${escapeHtml(displayDetailedAnswer(question))}`;
    $("keyboard-hint").textContent = "点击“下一题”，或按回车 / 空格继续";
  }

  function nextQuestion() {
    if (!session) return;
    if (session.mode === "study") {
      if (session.index >= session.list.length - 1) {
        showToast("这一范围已经背到最后一题");
        return;
      }
      goToQuestion(session.index + 1);
      return;
    }

    if (session.mode === "review") {
      if (session.list.every((question) => isMastered(question.id))) {
        dashboard();
        showToast("🎉 本轮错题已经全部清零");
        return;
      }
      prepareReviewQuestionForRevisit();
      const nextIndex = findReviewIndex(1);
      goToQuestion(nextIndex);
      return;
    }

    if (session.mode === "exam") {
      const answered = answeredExamCount();
      if (session.index >= session.list.length - 1) {
        if (answered === session.list.length) {
          finishExam();
        } else {
          const firstUnanswered = session.list.findIndex((question) => !session.responses[question.id]?.submitted);
          showToast(`还有 ${session.list.length - answered} 题未作答，已跳至第一道未答题`);
          goToQuestion(firstUnanswered);
        }
      } else {
        goToQuestion(session.index + 1);
      }
      return;
    }

    if (session.index >= session.list.length - 1) {
      dashboard();
      showToast("本轮刷题已完成");
    } else {
      goToQuestion(session.index + 1);
    }
  }

  function previousQuestion() {
    if (!session || session.index <= 0) return;
    if (session.mode === "review") prepareReviewQuestionForRevisit();
    goToQuestion(session.index - 1);
  }

  function goToQuestion(index) {
    if (!session || index < 0 || index >= session.list.length) return;
    session.index = index;
    if (session.mode === "study") {
      progress.studyPositions[session.scopeKey] = session.index;
      saveProgress();
    }
    renderQuestion();
  }

  function jumpToQuestion(event) {
    event.preventDefault();
    if (!session) return;
    const target = Number($("jump-input").value);
    if (!Number.isInteger(target) || target < 1 || target > session.list.length) {
      showToast(`请输入 1—${session.list.length} 之间的题号`);
      return;
    }
    if (session.mode === "review") prepareReviewQuestionForRevisit();
    goToQuestion(target - 1);
  }

  function prepareReviewQuestionForRevisit() {
    const current = session.list[session.index];
    if (session.responses[current.id]?.submitted && !isMastered(current.id)) {
      delete session.responses[current.id];
    }
  }

  function findReviewIndex(direction) {
    for (let offset = 1; offset <= session.list.length; offset += 1) {
      const index = (session.index + direction * offset + session.list.length) % session.list.length;
      if (!isMastered(session.list[index].id)) return index;
    }
    return session.index;
  }

  function answeredExamCount() {
    return session.list.filter((question) => session.responses[question.id]?.submitted).length;
  }

  function updateQuestionNavigation() {
    $("previous-question-button").disabled = session.index <= 0;
    $("jump-input").value = session.index + 1;
    $("jump-input").max = session.list.length;
    $("jump-total").textContent = `/ ${session.list.length}`;

    const nextButton = $("next-question-button");
    nextButton.disabled = session.mode === "study" && session.index >= session.list.length - 1;
    if (session.mode === "exam" && session.index >= session.list.length - 1) {
      nextButton.textContent = answeredExamCount() === session.list.length ? "交卷 ✓" : "查找未答题 →";
    } else if (session.mode === "practice" && session.index >= session.list.length - 1) {
      nextButton.textContent = "完成本轮 ✓";
    } else {
      nextButton.textContent = "下一题 →";
    }
  }

  function finishExam() {
    stopExamTimer();
    const answers = session.list.map((question) =>
      session.responses[question.id] || {
        questionId: question.id,
        selected: [],
        submitted: false,
        correct: false,
      },
    );
    const points = { 单选题: 3, 多选题: 3, 判断题: 1 };
    let score = 0;
    for (const answer of answers) {
      if (answer.correct) score += points[questionMap.get(answer.questionId).type];
    }
    const correctCount = answers.filter((a) => a.correct).length;
    $("exam-score").textContent = score;
    $("score-circle").style.setProperty("--progress", `${score}%`);
    $("result-title").textContent = score >= 85 ? "状态很好，继续稳住。" : score >= 60 ? "已经及格，错题还值得再磨一轮。" : "先别慌，错题本正好告诉你该往哪用力。";
    $("result-summary").textContent = `共答对 ${correctCount} / 40 题，错 ${40 - correctCount} 题。`;

    $("exam-breakdown").innerHTML = ["单选题", "多选题", "判断题"]
      .map((type) => {
        const typeAnswers = answers.filter((answer) => questionMap.get(answer.questionId).type === type);
        const right = typeAnswers.filter((answer) => answer.correct).length;
        return `<article class="stat-card"><span>${type}</span><strong>${right}/${typeAnswers.length}</strong><small>本题型答对</small></article>`;
      })
      .join("") + `<article class="stat-card ${score < 60 ? "danger" : ""}"><span>总分</span><strong>${score}</strong><small>满分 100</small></article>`;

    $("exam-review-list").innerHTML = answers
      .map((answer, index) => {
        const question = questionMap.get(answer.questionId);
        return `
          <article class="review-item ${answer.correct ? "" : "wrong"}">
            <span class="${answer.correct ? "good" : "bad"}">${answer.correct ? "✅ 正确" : "❌ 错误"} · 第 ${index + 1} 题 · ${question.type}</span>
            <h3>${escapeHtml(question.stem)}</h3>
            <p>你的答案：${answer.selected.length ? escapeHtml(displayAnswerLabel(question, answer.selected)) : "未作答"}</p>
            <p>正确答案：<strong>${escapeHtml(displayAnswerLabel(question))}</strong>　${escapeHtml(displayDetailedAnswer(question))}</p>
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

  function startExamTimer() {
    stopExamTimer();
    updateExamTimer();
    examTimerInterval = window.setInterval(updateExamTimer, 1000);
  }

  function stopExamTimer() {
    if (examTimerInterval) {
      window.clearInterval(examTimerInterval);
      examTimerInterval = null;
    }
    $("exam-timer").hidden = true;
  }

  function updateExamTimer() {
    if (!session || session.mode !== "exam" || !session.examEndsAt) return;
    const remaining = Math.max(0, session.examEndsAt - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timer = $("exam-timer");
    timer.hidden = false;
    timer.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    timer.classList.toggle("warning", totalSeconds <= 5 * 60 && totalSeconds > 60);
    timer.classList.toggle("urgent", totalSeconds <= 60);
    if (remaining <= 0) {
      showToast("考试时间已到，系统已自动交卷");
      finishExam();
    }
  }

  function displayOptionsFor(question) {
    if (question.type === "判断题") return [];
    if (!session.optionOrders[question.id]) {
      session.optionOrders[question.id] = shuffle(question.options.map((option) => option.key));
    }
    const order = session.optionOrders[question.id];
    return order.map((key) => question.options.find((option) => option.key === key));
  }

  function displayAnswerLabel(question, answer = question.answer) {
    if (question.type === "判断题") return answerLabel(question, answer);
    const order = session.optionOrders[question.id] || question.options.map((option) => option.key);
    return answer
      .map((key) => order.indexOf(key) + 1)
      .filter((position) => position > 0)
      .sort((a, b) => a - b)
      .join("、");
  }

  function displayDetailedAnswer(question, answer = question.answer) {
    if (question.type === "判断题") return answerLabel(question, answer);
    const displayOptions = displayOptionsFor(question);
    return displayOptions
      .map((option, index) => ({ option, position: index + 1 }))
      .filter(({ option }) => answer.includes(option.key))
      .map(({ option, position }) => `${position}. ${option.text}`)
      .join("；");
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
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key;
    if (session.mode === "study") {
      if ([" ", "Enter", "ArrowRight"].includes(key)) {
        event.preventDefault();
        nextQuestion();
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        previousQuestion();
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
      const option = displayOptionsFor(question)[Number(key) - 1];
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
  $("previous-question-button").addEventListener("click", previousQuestion);
  $("next-question-button").addEventListener("click", nextQuestion);
  $("submit-answer-button").addEventListener("click", submitAnswer);
  $("jump-form").addEventListener("submit", jumpToQuestion);
  document.addEventListener("keydown", handleKeydown);

  dashboard();
})();
