import { STORAGE_KEYS } from "./app-config.js";

const buildAttemptKey = (userId, examId) =>
  `${STORAGE_KEYS.examAttempt}:${userId}:${examId}`;
const buildTimerKey = (userId, examId) =>
  `${STORAGE_KEYS.timer}:${userId}:${examId}`;
const buildEndTimeKey = (userId, examId) =>
  `simpleUjian:endTime:${userId}:${examId}`;

export const createExamEngine = ({
  exam,
  questions,
  userId,
  initialAnswers,
  endTimeOverride,
  onTimerTick,
  onTimeUp,
}) => {
  const attemptKey = buildAttemptKey(userId, exam.id);
  const timerKey = buildTimerKey(userId, exam.id);
  const endTimeKey = buildEndTimeKey(userId, exam.id);

  const savedAttempt = JSON.parse(localStorage.getItem(attemptKey) || "{}");
  const savedTimer = Number(localStorage.getItem(timerKey) || "0");
  let savedEndTime = endTimeOverride || Number(localStorage.getItem(endTimeKey) || "0");

  if (!savedEndTime) {
    const durationSeconds = savedTimer || Number(exam.durationMinutes || 30) * 60;
    savedEndTime = Date.now() + durationSeconds * 1000;
    localStorage.setItem(endTimeKey, String(savedEndTime));
  } else if (endTimeOverride) {
    localStorage.setItem(endTimeKey, String(savedEndTime));
  }

  // Merge Firestore-synced answers with local storage answers (local storage has priority)
  const mergedAnswers = {
    ...(initialAnswers || {}),
    ...(savedAttempt.answersByQuestionId || {})
  };

  const state = {
    currentIndex: Number(savedAttempt.currentIndex || 0),
    answersByQuestionId: mergedAnswers,
    remainingSeconds: Math.max(0, Math.round((savedEndTime - Date.now()) / 1000)),
    flaggedQuestions: new Set(savedAttempt.flaggedQuestions || []),
  };

  const persist = () => {
    localStorage.setItem(
      attemptKey,
      JSON.stringify({
        currentIndex: state.currentIndex,
        answersByQuestionId: state.answersByQuestionId,
        flaggedQuestions: Array.from(state.flaggedQuestions),
      }),
    );
    localStorage.setItem(timerKey, String(state.remainingSeconds));
  };

  const timerRef = setInterval(() => {
    state.remainingSeconds = Math.max(0, Math.round((savedEndTime - Date.now()) / 1000));

    persist();
    onTimerTick(state.remainingSeconds);

    if (state.remainingSeconds === 0) {
      clearInterval(timerRef);
      onTimeUp();
    }
  }, 1000);

  const api = {
    get currentQuestion() {
      return questions[state.currentIndex];
    },
    get index() {
      return state.currentIndex;
    },
    get total() {
      return questions.length;
    },
    get answers() {
      return state.answersByQuestionId;
    },
    get remainingSeconds() {
      return state.remainingSeconds;
    },
    setAnswer(questionId, answerValue) {
      state.answersByQuestionId[questionId] = answerValue;
      persist();
    },
    next() {
      if (state.currentIndex < questions.length - 1) {
        state.currentIndex += 1;
        persist();
      }
    },
    prev() {
      if (state.currentIndex > 0) {
        state.currentIndex -= 1;
        persist();
      }
    },
    goTo(index) {
      if (index >= 0 && index < questions.length) {
        state.currentIndex = index;
        persist();
      }
    },
    unansweredCount() {
      return questions.filter((q) => {
        const ans = state.answersByQuestionId[q.id];
        if (q.type === "essay") {
          return !String(ans || "").trim();
        }
        if (q.type === "pgk") {
          return !Array.isArray(ans) || ans.length === 0;
        }
        if (q.type === "tf_matrix") {
          return (q.statements || []).some((stmt) => !ans?.[stmt.id]);
        }
        if (q.type === "match") {
          return (q.matchPairs || []).some((pair) => !ans?.[pair.left]);
        }
        return !ans;
      }).length;
    },
    toggleFlag(questionId) {
      if (state.flaggedQuestions.has(questionId)) {
        state.flaggedQuestions.delete(questionId);
      } else {
        state.flaggedQuestions.add(questionId);
      }
      persist();
    },
    isFlagged(questionId) {
      return state.flaggedQuestions.has(questionId);
    },
    flaggedCount() {
      return state.flaggedQuestions.size;
    },
    get flaggedQuestions() {
      return state.flaggedQuestions;
    },
    stop() {
      clearInterval(timerRef);
    },
    clearStorage() {
      localStorage.removeItem(attemptKey);
      localStorage.removeItem(timerKey);
      localStorage.removeItem(endTimeKey);
    },
    updateEndTime(newEndTime) {
      savedEndTime = newEndTime;
      localStorage.setItem(endTimeKey, String(savedEndTime));
      state.remainingSeconds = Math.max(0, Math.round((savedEndTime - Date.now()) / 1000));
      onTimerTick(state.remainingSeconds);
      persist();
    },
  };

  onTimerTick(state.remainingSeconds);
  persist();

  return api;
};
