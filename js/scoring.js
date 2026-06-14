const normalizeArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...value].map(String).sort();
};

const exactMatchArray = (a, b) => {
  const left = normalizeArray(a);
  const right = normalizeArray(b);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
};

export const scoreQuestion = (question, answer, weight = 100) => {
  if (question.type === "essay") {
    return { score: 0, status: "manual" };
  }

  if (question.type === "match") {
    const expected = question.matchPairs || [];
    const submitted = answer || {};
    if (expected.length === 0) {
      return { score: 0, status: "wrong" };
    }
    const correctCount = expected.filter(
      (pair) => submitted[pair.left] === pair.right
    ).length;
    const isPerfect = correctCount === expected.length;
    const rawScore = (correctCount / expected.length) * weight;
    const score = Number(rawScore.toFixed(2));
    
    let status = "wrong";
    if (isPerfect) {
      status = "correct";
    } else if (correctCount > 0) {
      status = "partial";
    }
    
    return { score, status };
  }

  if (question.type === "pgk") {
    const options = question.options || [];
    const correctKeys = options.filter((opt) => opt.isCorrect).map((opt) => opt.id);
    const submitted = Array.isArray(answer) ? answer : [];
    
    if (correctKeys.length === 0) {
      return { score: 0, status: "wrong" };
    }
    
    const c = submitted.filter((id) => correctKeys.includes(id)).length;
    const w = submitted.filter((id) => !correctKeys.includes(id)).length;
    
    const correctRatio = (c - w) / correctKeys.length;
    const rawScore = Math.max(0, correctRatio) * weight;
    const score = Number(rawScore.toFixed(2));
    
    let status = "wrong";
    if (score >= weight - 0.01 && submitted.length === correctKeys.length) {
      status = "correct";
    } else if (score > 0) {
      status = "partial";
    }
    
    return { score, status };
  }

  if (question.type === "tf_matrix") {
    const expected = question.statements || [];
    const submitted = answer || {};
    if (expected.length === 0) {
      return { score: 0, status: "wrong" };
    }
    const correctCount = expected.filter(
      (stmt) => submitted[stmt.id] === stmt.isCorrect
    ).length;
    const isPerfect = correctCount === expected.length;
    const rawScore = (correctCount / expected.length) * weight;
    const score = Number(rawScore.toFixed(2));
    
    let status = "wrong";
    if (isPerfect) {
      status = "correct";
    } else if (correctCount > 0) {
      status = "partial";
    }
    
    return { score, status };
  }

  if (question.type === "pg" || question.type === "tf") {
    const key = (question.options || []).find((opt) => opt.isCorrect)?.id;
    const isCorrect = Boolean(key) && answer === key;
    return {
      score: isCorrect ? weight : 0,
      status: isCorrect ? "correct" : "wrong",
    };
  }

  return { score: 0, status: "wrong" };
};

export const calculateScore = (questions, answersByQuestionId) => {
  let totalRawPoints = 0;
  let totalMaxPoints = 0;

  const breakdown = questions.map((question) => {
    const weight = Number(question.scoreWeight) || 10;
    totalMaxPoints += weight;

    const result = scoreQuestion(question, answersByQuestionId[question.id], weight);
    totalRawPoints += result.score;

    return {
      questionId: question.id,
      type: question.type,
      status: result.status,
      score: result.score,
      scoreWeight: weight,
    };
  });

  let total = totalMaxPoints > 0 ? (totalRawPoints / totalMaxPoints) * 100 : 0;
  total = Number(total.toFixed(2));

  // Koreksi pembulatan jika total mendekati 100 (misalnya 100.02 atau 99.98)
  if (Math.abs(total - 100) < 0.05) {
    const perfectCount = breakdown.filter(
      (b) =>
        b.status === "correct" ||
        b.status === "graded" ||
        (b.type === "essay" && b.score >= b.scoreWeight)
    ).length;
    if (perfectCount === questions.length) {
      total = 100;
    }
  }

  // Batasi agar tidak pernah melebihi 100
  total = Math.min(100, total);

  return { total, breakdown };
};
