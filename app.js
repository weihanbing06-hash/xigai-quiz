(() => {
  "use strict";

  const BANK = window.QUESTION_BANK;
  if (!BANK?.questions?.length) {
    document.body.innerHTML = "<h1 style='padding:40px'>题库载入失败，请确认 question-bank.js 与本页面位于同一文件夹。</h1>";
    return;
  }

  const STORAGE_KEY = "xigai-quiz-progress-v1";
  const SESSION_KEY = "xigai-quiz-active-session-v1";
  const SETTINGS_KEY = "xigai-quiz-settings-v1";
  const DEFAULT_KEY_BINDINGS = {
    option1: "1",
    option2: "2",
    option3: "3",
    option4: "4",
    judgeTrue: "1",
    judgeFalse: "0",
    submit: "Enter",
    next: " ",
    previous: "ArrowLeft",
  };
  const questions = BANK.questions;
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const chapters = [...new Map(questions.map((q) => [q.chapter, q.chapterTitle])).entries()];

  const defaultState = () => ({
    version: 1,
    streaks: {},
    attempts: 0,
    correct: 0,
    studyPositions: {},
    questionStats: {},
    mistakes: {},
    updatedAt: new Date().toISOString(),
  });

  let progress = loadProgress();
  let settings = loadSettings();
  let setupMode = null;
  let session = null;
  let toastTimer = null;
  let examTimerInterval = null;
  let autoNextTimer = null;
  let settingsDraft = null;
  let recordingBinding = null;

  const $ = (id) => document.getElementById(id);
  const screens = [...document.querySelectorAll(".screen")];

  function loadProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return parsed?.version === 1 ? normalizeProgress(parsed) : defaultState();
    } catch {
      return defaultState();
    }
  }

  function normalizeProgress(parsed) {
    const normalized = { ...defaultState(), ...parsed };
    normalized.streaks = { ...(parsed.streaks || {}) };
    normalized.questionStats = { ...(parsed.questionStats || {}) };
    normalized.mistakes = { ...(parsed.mistakes || {}) };
    if (!parsed.mistakes) {
      for (const question of questions) {
        const hasStreak = Object.prototype.hasOwnProperty.call(normalized.streaks, question.id);
        const stats = normalized.questionStats[question.id];
        if (
          streakForFrom(normalized, question.id) < 2 &&
          ((hasStreak && Number(normalized.streaks[question.id]) === 0) || Number(stats?.wrong || 0) > 0)
        ) {
          normalized.mistakes[question.id] = true;
        }
      }
    }
    for (const id of Object.keys(normalized.mistakes)) {
      if (streakForFrom(normalized, id) >= 2) delete normalized.mistakes[id];
    }
    return normalized;
  }

  function streakForFrom(state, id) {
    return Number(state.streaks?.[id] || 0);
  }

  function saveProgress() {
    progress.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return {
        autoSubmit: parsed?.autoSubmit !== false,
        autoNextCorrect: Boolean(parsed?.autoNextCorrect),
        keyBindings: { ...DEFAULT_KEY_BINDINGS, ...(parsed?.keyBindings || {}) },
      };
    } catch {
      return { autoSubmit: true, autoNextCorrect: false, keyBindings: { ...DEFAULT_KEY_BINDINGS } };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function cancelAutoNext() {
    if (autoNextTimer) {
      window.clearTimeout(autoNextTimer);
      autoNextTimer = null;
    }
  }

  function keyLabel(key) {
    return {
      " ": "空格",
      Enter: "回车",
      ArrowLeft: "←",
      ArrowRight: "→",
      ArrowUp: "↑",
      ArrowDown: "↓",
      Escape: "Esc",
    }[key] || (key.length === 1 ? key.toUpperCase() : key);
  }

  function saveActiveSession() {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const payload = {
      version: 1,
      mode: session.mode,
      listIds: session.list.map((question) => question.id),
      index: session.index,
      scopeKey: session.scopeKey || "",
      responses: session.responses || {},
      optionOrders: session.optionOrders || {},
      initialTotal: session.initialTotal || session.list.length,
      learningState: session.learningState || null,
      examEndsAt: session.examEndsAt || null,
      savedAt: Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }

  function loadActiveSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (saved?.version !== 1 || !Array.isArray(saved.listIds) || !saved.listIds.length) return null;
      const list = saved.listIds.map((id) => questionMap.get(id)).filter(Boolean);
      if (list.length !== saved.listIds.length) return null;
      return {
        mode: saved.mode === "practice" ? "learning" : saved.mode,
        list: saved.mode === "practice" ? list.slice(0, Math.min((Number(saved.index) || 0) + 1, list.length)) : list,
        index: Math.min(Math.max(0, Number(saved.index) || 0), list.length - 1),
        scopeKey: saved.scopeKey || "",
        selected: [],
        submitted: false,
        responses: saved.responses || {},
        optionOrders: saved.optionOrders || {},
        initialTotal: saved.initialTotal || list.length,
        learningState:
          saved.learningState ||
          (saved.mode === "practice"
            ? {
                sourceIds: saved.listIds,
                nextNewIndex: Math.min((Number(saved.index) || 0) + 1, saved.listIds.length),
                generated: Math.min((Number(saved.index) || 0) + 1, 30),
                recentIds: saved.listIds.slice(Math.max(0, (Number(saved.index) || 0) - 5), (Number(saved.index) || 0) + 1),
                itemMeta: saved.listIds
                  .slice(0, Math.min((Number(saved.index) || 0) + 1, saved.listIds.length))
                  .map((id) => ({ questionId: id, kind: "new", wasWeak: true })),
                startMastered: questions.filter((question) => isMastered(question.id)).length,
              }
            : null),
        examEndsAt: saved.examEndsAt || null,
        savedAt: saved.savedAt || Date.now(),
      };
    } catch {
      return null;
    }
  }

  function clearActiveSession() {
    cancelAutoNext();
    session = null;
    localStorage.removeItem(SESSION_KEY);
    stopExamTimer();
  }

  function showScreen(id) {
    cancelAutoNext();
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

  function isMistake(id) {
    return Boolean(progress.mistakes[id]);
  }

  function hasLearned(id) {
    return (
      Object.prototype.hasOwnProperty.call(progress.streaks, id) ||
      Number(progress.questionStats[id]?.attempts || 0) > 0
    );
  }

  function learningStatus(id) {
    if (isMastered(id)) return "mastered";
    if (isMistake(id)) return "mistake";
    if (hasLearned(id)) return "learning";
    return "unseen";
  }

  function recordAnswer(question, isCorrect) {
    progress.attempts += 1;
    const stats = progress.questionStats[question.id] || {
      attempts: 0,
      correct: 0,
      wrong: 0,
      lastAnsweredAt: 0,
    };
    stats.attempts += 1;
    stats.lastAnsweredAt = Date.now();
    if (session?.mode === "learning") {
      stats.learningAttempts = Number(stats.learningAttempts || 0) + 1;
    }
    if (isCorrect) {
      progress.correct += 1;
      stats.correct += 1;
      progress.streaks[question.id] = Math.min(2, streakFor(question.id) + 1);
      if (progress.streaks[question.id] >= 2) delete progress.mistakes[question.id];
    } else {
      stats.wrong += 1;
      progress.streaks[question.id] = 0;
      progress.mistakes[question.id] = true;
    }
    progress.questionStats[question.id] = stats;
    saveProgress();
  }

  function responseKey(index = session.index) {
    const question = session.list[index];
    return session.mode === "learning" ? `${index}:${question.id}` : question.id;
  }

  function responseFor(index = session.index) {
    return session.responses[responseKey(index)];
  }

  function optionOrderKey(question, index = session.index) {
    return session.mode === "learning" ? `${index}:${question.id}` : question.id;
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
    const mistakes = questions.filter((q) => isMistake(q.id)).length;
    const learning = questions.filter((q) => hasLearned(q.id) && !isMastered(q.id)).length;
    const unseen = questions.length - mastered - learning;
    const percent = Math.round((mastered / questions.length) * 100);
    $("mastered-count").textContent = mastered;
    $("wrong-count").textContent = mistakes;
    $("learning-count").textContent = learning;
    $("unseen-count").textContent = unseen;
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
    renderResumePanel();
    showScreen("dashboard-screen");
  }

  function renderResumePanel() {
    const saved = loadActiveSession();
    const panel = $("resume-panel");
    if (!saved) {
      panel.hidden = true;
      return;
    }
    const labels = { study: "背题模式", learning: "学习模式", review: "错题复习", exam: "模拟考试" };
    const answered = Object.values(saved.responses).filter((response) => response?.submitted).length;
    const timeText =
      saved.mode === "exam"
        ? saved.examEndsAt > Date.now()
          ? `，剩余约 ${Math.ceil((saved.examEndsAt - Date.now()) / 60000)} 分钟`
          : "，考试时间已结束"
        : "";
    $("resume-title").textContent = `继续${labels[saved.mode] || "上次学习"}`;
    $("resume-summary").textContent = `上次停在第 ${saved.index + 1} / ${saved.list.length} 题，已作答 ${answered} 题${timeText}`;
    panel.hidden = false;
  }

  function resumeActiveSession() {
    const saved = loadActiveSession();
    if (!saved) {
      showToast("没有可恢复的学习记录");
      dashboard();
      return;
    }
    session = saved;
    if (session.mode === "exam" && session.examEndsAt <= Date.now()) {
      showToast("考试时间已结束，正在自动交卷");
      finishExam();
      return;
    }
    if (session.mode === "exam") startExamTimer();
    renderQuestion();
    showScreen("question-screen");
  }

  function discardActiveSession() {
    if (!window.confirm("确定放弃当前未完成的学习记录吗？已计入的掌握进度不会撤销。")) return;
    clearActiveSession();
    dashboard();
    showToast("已放弃本次学习");
  }

  function openSetup(mode) {
    setupMode = mode;
    const config = {
      study: {
        eyebrow: "顺序记忆",
        title: "背题模式",
        description: "题目与正确答案同时显示，可使用设置中的上一题、下一题快捷键翻页；背题不改变掌握状态。",
        start: "开始背题",
      },
      learning: {
        eyebrow: "自适应巩固",
        title: "学习模式",
        description: "新题按章节顺序推进，系统会间隔穿插错题、未掌握题和少量已掌握题，避免只记住答案位置。",
        start: "开始学习",
      },
      review: {
        eyebrow: "循环强化",
        title: "错题复习",
        description: "只练实际答错并进入错题本的题。连续答对两次后移出，之后若再次答错会重新加入。",
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
      if (mode === "review" && !isMistake(q.id)) return false;
      return true;
    });
  }

  function updateSetupSummary() {
    if (setupMode === "exam") {
      $("setup-summary").innerHTML = "限时 <strong>20 分钟</strong> · 20 单选 × 3 分 + 10 多选 × 3 分 + 10 判断 × 1 分 = <strong>100 分</strong>";
      $("start-button").disabled = false;
      return;
    }
    const list = filteredQuestions();
    const scope = $("chapter-select").value === "全部" ? "全题库" : $("chapter-select").selectedOptions[0].textContent;
    if (setupMode === "learning") {
      $("setup-summary").innerHTML = `<strong>${scope}</strong> · ${$("type-select").value} · 新题按章节顺序推进，并间隔穿插旧题复习`;
      $("start-button").disabled = list.length === 0;
      return;
    }
    const suffix = setupMode === "review" ? " 道当前错题" : " 道题";
    $("setup-summary").innerHTML = `<strong>${scope}</strong> · ${$("type-select").value} · 共 <strong>${list.length}</strong>${suffix}`;
    $("start-button").disabled = list.length === 0;
  }

  function createLearningState(source) {
    let nextNewIndex = source.findIndex((question) => {
      const stats = progress.questionStats[question.id];
      const seenInLegacyProgress = Object.prototype.hasOwnProperty.call(progress.streaks, question.id);
      return !stats?.learningAttempts && !seenInLegacyProgress;
    });
    if (nextNewIndex < 0) nextNewIndex = source.length;
    return {
      sourceIds: source.map((question) => question.id),
      nextNewIndex,
      generated: 0,
      recentIds: [],
      itemMeta: [],
    };
  }

  function takeNextLearningQuestion(state, source) {
    const recent = new Set(state.recentIds.slice(-2));
    const introduced = source.slice(0, state.nextNewIndex);
    const dueMistakes = introduced.filter((question) => isMistake(question.id) && !recent.has(question.id));
    const dueLearning = introduced.filter(
      (question) => !isMastered(question.id) && !isMistake(question.id) && hasLearned(question.id) && !recent.has(question.id),
    );
    const dueMastered = introduced.filter((question) => isMastered(question.id) && !recent.has(question.id));
    const reviewTurn = state.generated > 0 && state.generated % 4 === 3;
    const masteredCheckTurn = state.generated > 0 && state.generated % 12 === 11;
    let selected = null;

    let kind = "new";
    if (masteredCheckTurn && dueMastered.length) {
      selected = weightedLearningPick(dueMastered, true);
      kind = "mastered-check";
    } else if (reviewTurn && (dueMistakes.length || dueLearning.length)) {
      selected = weightedLearningPick(dueMistakes.length ? dueMistakes : dueLearning, false);
      kind = "weak-review";
    } else if (state.nextNewIndex < source.length) {
      selected = source[state.nextNewIndex];
      state.nextNewIndex += 1;
    } else if (dueMistakes.length || dueLearning.length) {
      selected = weightedLearningPick(dueMistakes.length ? dueMistakes : dueLearning, false);
      kind = "weak-review";
    } else if (dueMastered.length) {
      selected = weightedLearningPick(dueMastered, true);
      kind = "mastered-check";
    } else {
      selected = source[Math.floor(Math.random() * source.length)];
      kind = isMastered(selected.id) ? "mastered-check" : "weak-review";
    }

    state.generated += 1;
    state.recentIds.push(selected.id);
    state.recentIds = state.recentIds.slice(-6);
    state.itemMeta.push({
      questionId: selected.id,
      kind,
      wasWeak: !isMastered(selected.id),
    });
    return selected;
  }

  function weightedLearningPick(candidates, masteredPool) {
    const weighted = candidates.map((question) => {
      const stats = progress.questionStats[question.id] || {};
      const wrong = Number(stats.wrong || 0);
      const attempts = Number(stats.attempts || 0);
      const ageHours = stats.lastAnsweredAt ? (Date.now() - stats.lastAnsweredAt) / 3600000 : 24;
      const weight = masteredPool
        ? 1 + Math.min(2, ageHours / 24)
        : 3 + wrong * 2 + (streakFor(question.id) === 0 ? 3 : 1) + Math.min(2, ageHours / 12) - Math.min(1, attempts / 20);
      return { question, weight: Math.max(0.5, weight) };
    });
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of weighted) {
      roll -= item.weight;
      if (roll <= 0) return item.question;
    }
    return weighted[weighted.length - 1].question;
  }

  function startSession() {
    if (setupMode === "exam") return startExam();
    const source = filteredQuestions();
    if (!source.length) return;
    const scopeKey = `${$("chapter-select").value}|${$("type-select").value}`;
    let index = 0;
    if (setupMode === "study") {
      index = Math.min(progress.studyPositions[scopeKey] || 0, Math.max(0, source.length - 1));
    }
    const learningState =
      setupMode === "learning"
        ? createLearningState(source)
        : null;
    const list =
      setupMode === "learning"
        ? [takeNextLearningQuestion(learningState, source)]
        : setupMode === "review"
          ? [...source]
          : source;
    session = {
      mode: setupMode,
      list,
      index,
      scopeKey,
      selected: [],
      submitted: false,
      responses: {},
      optionOrders: {},
      initialTotal: source.length,
      learningState,
    };
    saveActiveSession();
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
    saveActiveSession();
    startExamTimer();
    renderQuestion();
    showScreen("question-screen");
  }

  function renderQuestion() {
    cancelAutoNext();
    const question = session.list[session.index];
    const questionCard = document.querySelector(".question-card");
    questionCard.classList.remove("question-enter");
    questionCard.classList.remove("result-correct", "result-wrong");
    const response = responseFor();
    session.selected = response ? [...response.selected] : [];
    session.submitted = Boolean(response?.submitted);
    $("mode-label").textContent = {
      study: "背题模式",
      learning: "学习模式",
      review: "错题复习",
      exam: "模拟考试",
    }[session.mode];
    $("exam-timer").hidden = session.mode !== "exam";
    $("exam-actions").hidden = session.mode !== "exam";
    if (session.mode === "exam") updateExamTimer();

    let counter;
    let progressValue;
    if (session.mode === "learning") {
      const learned = session.learningState.nextNewIndex;
      const total = session.learningState.sourceIds.length;
      counter =
        learned < total
          ? `主线 ${learned} / ${total} · 已学习 ${session.index + 1}`
          : `主线已完成 · 持续巩固 ${session.index + 1}`;
      progressValue = total ? (learned / total) * 100 : 100;
    } else if (session.mode === "review") {
      const remaining = session.list.filter((q) => isMistake(q.id)).length;
      counter = `待掌握 ${remaining} 题`;
      progressValue = ((session.initialTotal - remaining) / session.initialTotal) * 100;
    } else {
      counter = `${session.index + 1} / ${session.list.length}`;
      progressValue = ((session.index + 1) / session.list.length) * 100;
    }
    $("question-counter").textContent = counter;
    $("question-progress-bar").style.width = `${Math.max(0, progressValue)}%`;
    $("question-type").textContent = question.type;
    updateLearningStatusBadge(question.id);
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
      $("keyboard-hint").textContent = `${keyLabel(settings.keyBindings.next)}：下一题　　${keyLabel(settings.keyBindings.previous)}：上一题`;
    } else {
      renderAnswerModeHint(question);
      renderOptions(question);
      syncSelection();
      if (session.submitted) {
        showSubmittedAnswer(question, response);
      } else {
        $("keyboard-hint").textContent =
          question.type === "多选题"
            ? `点击选项或按 ${optionKeysLabel()} 选择，按 ${keyLabel(settings.keyBindings.submit)} 提交`
            : question.type === "判断题"
              ? settings.autoSubmit
                ? `点击选项，或按 ${keyLabel(settings.keyBindings.judgeTrue)} 选择“对”、按 ${keyLabel(settings.keyBindings.judgeFalse)} 选择“错”，自动提交`
                : "选择“对”或“错”，确认后点击提交答案"
              : settings.autoSubmit
                ? `点击选项，或按 ${optionKeysLabel()} 直接作答并自动提交`
                : "选择一个选项，确认后点击提交答案";
        if (question.type === "多选题" || !settings.autoSubmit) {
          $("submit-answer-button").classList.add("visible");
          $("submit-answer-button").disabled = session.selected.length === 0;
        }
      }
    }
    updateQuestionNavigation();

    // 强制浏览器确认初始状态，使每次切题都能重新播放入场动画。
    void questionCard.offsetWidth;
    questionCard.classList.add("question-enter");
    saveActiveSession();
  }

  function renderAnswerModeHint(question) {
    const hint = $("answer-mode-hint");
    hint.hidden = false;
    if (question.type === "多选题") {
      hint.innerHTML = `
        <span class="answer-mode-icon" aria-hidden="true">✓✓</span>
        <span><strong>多项选择</strong><small>可选择多个选项，确认无误后提交答案</small></span>`;
    } else {
      const submitDescription = settings.autoSubmit ? "选择一个答案后将立即提交" : "选择答案后，确认无误再提交";
      hint.innerHTML = `
        <span class="answer-mode-icon" aria-hidden="true">→</span>
        <span><strong>${question.type === "判断题" ? "判断选择" : "单项选择"}</strong><small>${submitDescription}</small></span>`;
    }
  }

  function updateLearningStatusBadge(questionId) {
    const status = learningStatus(questionId);
    const badge = $("question-learning-status");
    badge.className = `learning-status-badge ${status}`;
    badge.textContent = {
      unseen: "未学",
      learning: "学习中",
      mastered: "已掌握",
      mistake: "错题",
    }[status];
  }

  function optionKeysLabel() {
    return [
      settings.keyBindings.option1,
      settings.keyBindings.option2,
      settings.keyBindings.option3,
      settings.keyBindings.option4,
    ]
      .map(keyLabel)
      .join("、");
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
      session.responses[responseKey()] = { selected: [...session.selected], submitted: false };
      syncSelection();
      $("submit-answer-button").disabled = session.selected.length === 0;
      saveActiveSession();
      return;
    }
    session.selected = [key];
    session.responses[responseKey()] = { selected: [...session.selected], submitted: false };
    syncSelection();
    saveActiveSession();
    if (settings.autoSubmit) {
      submitAnswer();
    } else {
      $("submit-answer-button").classList.add("visible");
      $("submit-answer-button").disabled = false;
    }
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
    const wasMistake = isMistake(question.id);
    session.submitted = true;
    const response = {
      questionId: question.id,
      selected: [...session.selected],
      submitted: true,
      correct: isCorrect,
      wasMistake,
    };
    session.responses[responseKey()] = response;
    recordAnswer(question, isCorrect);
    saveActiveSession();
    updateLearningStatusBadge(question.id);
    $("submit-answer-button").classList.remove("visible");

    if (session.mode === "exam") {
      showSubmittedAnswer(question, response);
      updateQuestionNavigation();
      return;
    }

    showSubmittedAnswer(question, response);
    updateQuestionNavigation();
    if (response.correct && settings.autoNextCorrect && session.mode !== "exam") {
      autoNextTimer = window.setTimeout(() => {
        autoNextTimer = null;
        nextQuestion();
      }, 900);
    }
  }

  function showSubmittedAnswer(question, response) {
    const questionCard = document.querySelector(".question-card");
    questionCard.classList.remove("result-correct", "result-wrong");
    if (session.mode !== "exam") {
      questionCard.classList.add(response.correct ? "result-correct" : "result-wrong");
    }
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
    if (response.correct) {
      const message = isMastered(question.id)
        ? response.wasMistake
          ? "该题已连续答对两次，标记为已掌握并移出错题本。"
          : "该题已连续答对两次，标记为已掌握。"
        : isMistake(question.id)
          ? "再连续答对一次，即可掌握并移出错题本。"
          : "再连续答对一次即可掌握。";
      feedback.innerHTML = `✅ 正确！${message}`;
    } else {
      feedback.innerHTML = `❌ 错误！已加入错题本。正确答案：${displayAnswerLabel(question)}　${escapeHtml(displayDetailedAnswer(question))}`;
    }
    $("keyboard-hint").textContent = `点击“下一题”，或按 ${keyLabel(settings.keyBindings.next)} 继续`;
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
      if (session.list.every((question) => !isMistake(question.id))) {
        clearActiveSession();
        dashboard();
        showToast("🎉 本轮错题已经全部清零");
        return;
      }
      prepareReviewQuestionForRevisit();
      const nextIndex = findReviewIndex(1);
      goToQuestion(nextIndex);
      return;
    }

    if (session.mode === "learning") {
      const isAtTail = session.index === session.list.length - 1;
      if (!isAtTail) {
        goToQuestion(session.index + 1);
        return;
      }
      const source = session.learningState.sourceIds.map((id) => questionMap.get(id)).filter(Boolean);
      session.list.push(takeNextLearningQuestion(session.learningState, source));
      goToQuestion(session.index + 1);
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
      clearActiveSession();
      dashboard();
      showToast("当前学习内容已完成");
    } else {
      goToQuestion(session.index + 1);
    }
  }

  function previousQuestion() {
    cancelAutoNext();
    if (!session || session.index <= 0) return;
    if (session.mode === "review") prepareReviewQuestionForRevisit();
    goToQuestion(session.index - 1);
  }

  function goToQuestion(index) {
    cancelAutoNext();
    if (!session || index < 0 || index >= session.list.length) return;
    session.index = index;
    if (session.mode === "study") {
      progress.studyPositions[session.scopeKey] = session.index;
      saveProgress();
    }
    saveActiveSession();
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
    if (session.responses[current.id]?.submitted && isMistake(current.id)) {
      delete session.responses[current.id];
    }
  }

  function findReviewIndex(direction) {
    for (let offset = 1; offset <= session.list.length; offset += 1) {
      const index = (session.index + direction * offset + session.list.length) % session.list.length;
      if (isMistake(session.list[index].id)) return index;
    }
    return session.index;
  }

  function answeredExamCount() {
    return session.list.filter((question) => session.responses[question.id]?.submitted).length;
  }

  function openAnswerSheet() {
    if (!session || session.mode !== "exam") return;
    renderAnswerSheet();
    $("answer-sheet-overlay").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeAnswerSheet() {
    $("answer-sheet-overlay").hidden = true;
    document.body.style.overflow = "";
  }

  function openSettings() {
    cancelAutoNext();
    settingsDraft = {
      autoSubmit: settings.autoSubmit,
      autoNextCorrect: settings.autoNextCorrect,
      keyBindings: { ...settings.keyBindings },
    };
    $("auto-submit-setting").checked = settings.autoSubmit;
    $("auto-next-setting").checked = settings.autoNextCorrect;
    renderKeybindingButtons();
    $("settings-overlay").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSettings() {
    stopKeyCapture();
    $("settings-overlay").hidden = true;
    document.body.style.overflow = "";
  }

  function applySettings() {
    settings = {
      autoSubmit: $("auto-submit-setting").checked,
      autoNextCorrect: $("auto-next-setting").checked,
      keyBindings: { ...(settingsDraft?.keyBindings || settings.keyBindings) },
    };
    saveSettings();
    closeSettings();
    if (session && $("question-screen").classList.contains("active")) renderQuestion();
    showToast("答题设置已保存");
  }

  function toggleKeybindings() {
    const panel = $("keybinding-panel");
    panel.hidden = !panel.hidden;
    $("keybinding-toggle-icon").textContent = panel.hidden ? "＋" : "−";
  }

  function renderKeybindingButtons() {
    document.querySelectorAll("[data-keybinding]").forEach((button) => {
      const name = button.dataset.keybinding;
      button.textContent = keyLabel(settingsDraft.keyBindings[name]);
      button.classList.remove("recording");
    });
  }

  function beginKeyCapture(bindingName, button) {
    stopKeyCapture();
    recordingBinding = { bindingName, button };
    button.textContent = "请按键…";
    button.classList.add("recording");
    window.addEventListener("keydown", captureKeybinding, true);
  }

  function captureKeybinding(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!recordingBinding) return;
    if (["Tab", "Escape"].includes(event.key)) {
      showToast("Tab 和 Esc 保留给页面与系统操作");
      stopKeyCapture();
      renderKeybindingButtons();
      return;
    }
    const conflict = findKeybindingConflict(recordingBinding.bindingName, event.key);
    if (conflict) {
      showToast(`该按键与“${conflict}”冲突，请换一个按键`);
      stopKeyCapture();
      renderKeybindingButtons();
      return;
    }
    settingsDraft.keyBindings[recordingBinding.bindingName] = event.key;
    stopKeyCapture();
    renderKeybindingButtons();
  }

  function stopKeyCapture() {
    if (recordingBinding) recordingBinding.button.classList.remove("recording");
    recordingBinding = null;
    window.removeEventListener("keydown", captureKeybinding, true);
  }

  function resetKeybindings() {
    settingsDraft.keyBindings = { ...DEFAULT_KEY_BINDINGS };
    renderKeybindingButtons();
    showToast("已恢复默认按键，点击保存后生效");
  }

  function findKeybindingConflict(bindingName, key) {
    const labels = {
      option1: "选项 1",
      option2: "选项 2",
      option3: "选项 3",
      option4: "选项 4",
      judgeTrue: "判断：对",
      judgeFalse: "判断：错",
      submit: "提交答案",
      next: "下一题",
      previous: "上一题",
    };
    const optionNames = ["option1", "option2", "option3", "option4"];
    const conflictNames =
      bindingName === "previous"
        ? Object.keys(labels).filter((name) => name !== bindingName)
        : bindingName === "next"
          ? ["previous"]
          : optionNames.includes(bindingName)
            ? [...optionNames.filter((name) => name !== bindingName), "submit", "previous"]
            : ["judgeTrue", "judgeFalse"].includes(bindingName)
              ? ["judgeTrue", "judgeFalse", "submit", "previous"].filter((name) => name !== bindingName)
              : bindingName === "submit"
                ? [...optionNames, "judgeTrue", "judgeFalse", "previous"]
                : [];
    const match = conflictNames.find((name) => settingsDraft.keyBindings[name] === key);
    return match ? labels[match] : "";
  }

  function renderAnswerSheet() {
    const answered = answeredExamCount();
    $("answer-sheet-summary").textContent = `已答 ${answered} 题，未答 ${session.list.length - answered} 题`;
    const sections = [
      { title: "单选题 · 1—20", start: 0, end: 20 },
      { title: "多选题 · 21—30", start: 20, end: 30 },
      { title: "判断题 · 31—40", start: 30, end: 40 },
    ];
    $("answer-sheet-content").innerHTML = sections
      .map(
        ({ title, start, end }) => `
          <section class="answer-sheet-section">
            <h3>${title}</h3>
            <div class="answer-sheet-grid">
              ${session.list
                .slice(start, end)
                .map((question, offset) => {
                  const index = start + offset;
                  const answeredClass = session.responses[question.id]?.submitted ? "answered" : "";
                  const currentClass = index === session.index ? "current" : "";
                  return `<button class="sheet-number ${answeredClass} ${currentClass}" data-sheet-index="${index}" type="button">${index + 1}</button>`;
                })
                .join("")}
            </div>
          </section>`,
      )
      .join("");
    document.querySelectorAll("[data-sheet-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.sheetIndex);
        closeAnswerSheet();
        goToQuestion(index);
      });
    });
  }

  function requestExamSubmission() {
    if (!session || session.mode !== "exam") return;
    const unanswered = session.list.length - answeredExamCount();
    const message =
      unanswered > 0
        ? `还有 ${unanswered} 题未作答，交卷后这些题将按错误计入。确定交卷吗？`
        : "所有题目均已作答，确定交卷吗？";
    if (!window.confirm(message)) return;
    finishExam();
  }

  function updateQuestionNavigation() {
    $("previous-question-button").disabled = session.index <= 0;
    $("jump-input").value = session.index + 1;
    $("jump-input").max = session.list.length;
    $("jump-total").textContent = `/ ${session.list.length}`;

    const nextButton = $("next-question-button");
    nextButton.disabled =
      (session.mode === "study" && session.index >= session.list.length - 1) ||
      (session.mode === "learning" && !session.submitted);
    if (session.mode === "exam" && session.index >= session.list.length - 1) {
      nextButton.textContent = answeredExamCount() === session.list.length ? "交卷 ✓" : "查找未答题 →";
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
            <div class="review-item-heading">
              <span class="${answer.correct ? "good" : "bad"}">${answer.correct ? "✅ 正确" : "❌ 错误"} · 第 ${index + 1} 题 · ${question.type}</span>
              <span class="review-answer-summary">你的答案：${answer.selected.length ? escapeHtml(displayAnswerLabel(question, answer.selected)) : "未作答"}　|　正确答案：${escapeHtml(displayAnswerLabel(question))}</span>
            </div>
            <h3>${escapeHtml(question.stem)}</h3>
            <div class="review-options">${renderExamReviewOptions(question, answer)}</div>
          </article>`;
      })
      .join("");
    clearActiveSession();
    closeAnswerSheet();
    showScreen("result-screen");
  }

  function renderExamReviewOptions(question, answer) {
    const options =
      question.type === "判断题"
        ? [
            { key: "T", text: "对", digit: "1" },
            { key: "F", text: "错", digit: "0" },
          ]
        : displayOptionsFor(question).map((option, index) => ({
            ...option,
            digit: String(index + 1),
          }));

    return options
      .map((option) => {
        const isCorrect = question.answer.includes(option.key);
        const isSelected = answer.selected.includes(option.key);
        const classes = [
          "review-option",
          isCorrect ? "correct-choice" : "",
          isSelected && !isCorrect ? "wrong-choice" : "",
          isSelected ? "user-choice" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const state =
          isCorrect && isSelected
            ? "你的选择 · 正确"
            : isCorrect
              ? "正确答案"
              : isSelected
                ? "你的选择 · 错误"
                : "";
        return `
          <div class="${classes}">
            <span class="review-option-key">${option.digit}</span>
            <span class="review-option-text">${escapeHtml(option.text)}</span>
            ${state ? `<span class="review-option-state">${state}</span>` : ""}
          </div>`;
      })
      .join("");
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
      progress = normalizeProgress(parsed);
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
    clearActiveSession();
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

  async function removeLegacyPwa() {
    if ("serviceWorker" in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch {
        // 不阻塞题库启动。
      }
    }
    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith("xigai-quiz-")).map((key) => caches.delete(key)));
      } catch {
        // 不阻塞题库启动。
      }
    }
  }

  function displayOptionsFor(question) {
    if (question.type === "判断题") return [];
    const key = optionOrderKey(question);
    if (!session.optionOrders[key]) {
      session.optionOrders[key] = shuffle(question.options.map((option) => option.key));
    }
    const order = session.optionOrders[key];
    return order.map((key) => question.options.find((option) => option.key === key));
  }

  function displayAnswerLabel(question, answer = question.answer) {
    if (question.type === "判断题") return answerLabel(question, answer);
    const order = session.optionOrders[optionOrderKey(question)] || question.options.map((option) => option.key);
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
    if (!$("settings-overlay").hidden) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key;
    if (session.mode === "study") {
      if (key === settings.keyBindings.next) {
        event.preventDefault();
        nextQuestion();
      } else if (key === settings.keyBindings.previous) {
        event.preventDefault();
        previousQuestion();
      }
      return;
    }

    if (session.submitted) {
      if (key === settings.keyBindings.next) {
        event.preventDefault();
        nextQuestion();
      }
      return;
    }

    const question = session.list[session.index];
    if (key === settings.keyBindings.previous) {
      event.preventDefault();
      previousQuestion();
    } else if (
      question.type === "判断题" &&
      (key === settings.keyBindings.judgeTrue || key === settings.keyBindings.judgeFalse)
    ) {
      selectAnswer(key === settings.keyBindings.judgeTrue ? "T" : "F");
    } else if (question.type !== "判断题") {
      const optionIndex = [
        settings.keyBindings.option1,
        settings.keyBindings.option2,
        settings.keyBindings.option3,
        settings.keyBindings.option4,
      ].indexOf(key);
      const option = optionIndex >= 0 ? displayOptionsFor(question)[optionIndex] : null;
      if (option) selectAnswer(option.key);
      else if (
        key === settings.keyBindings.submit &&
        (question.type === "多选题" || (!settings.autoSubmit && session.selected.length))
      ) {
        event.preventDefault();
        submitAnswer();
      }
    } else if (
      key === settings.keyBindings.submit &&
      (question.type === "多选题" || (!settings.autoSubmit && session.selected.length))
    ) {
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
  $("settings-button").addEventListener("click", openSettings);
  $("close-settings-button").addEventListener("click", closeSettings);
  $("settings-overlay").addEventListener("click", (event) => {
    if (event.target === $("settings-overlay")) closeSettings();
  });
  $("save-settings-button").addEventListener("click", applySettings);
  $("toggle-keybindings-button").addEventListener("click", toggleKeybindings);
  $("reset-keybindings-button").addEventListener("click", resetKeybindings);
  document.querySelectorAll("[data-keybinding]").forEach((button) => {
    button.addEventListener("click", () => beginKeyCapture(button.dataset.keybinding, button));
  });
  $("import-input").addEventListener("change", importProgress);
  $("reset-button").addEventListener("click", resetProgress);
  $("resume-session-button").addEventListener("click", resumeActiveSession);
  $("discard-session-button").addEventListener("click", discardActiveSession);
  $("previous-question-button").addEventListener("click", previousQuestion);
  $("next-question-button").addEventListener("click", nextQuestion);
  $("submit-answer-button").addEventListener("click", submitAnswer);
  $("jump-form").addEventListener("submit", jumpToQuestion);
  $("answer-sheet-button").addEventListener("click", openAnswerSheet);
  $("close-answer-sheet-button").addEventListener("click", closeAnswerSheet);
  $("answer-sheet-overlay").addEventListener("click", (event) => {
    if (event.target === $("answer-sheet-overlay")) closeAnswerSheet();
  });
  $("submit-exam-button").addEventListener("click", requestExamSubmission);
  $("sheet-submit-exam-button").addEventListener("click", requestExamSubmission);
  document.addEventListener("keydown", handleKeydown);

  removeLegacyPwa();
  dashboard();
})();
