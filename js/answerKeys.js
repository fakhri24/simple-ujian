/**
 * answerKeys.js — Penggabungan soal publik dengan dokumen kunci (`exam_keys`).
 *
 * Dokumen soal yang dibaca siswa sengaja tidak memuat kunci. Kunci disimpan
 * terpisah dan baru boleh dibaca setelah pengerjaan selesai (lihat
 * firestore.rules pada match /exam_keys/{examId}). Modul ini satu-satunya
 * tempat bentuk kunci diterjemahkan kembali ke bentuk soal yang dipahami
 * scoring.js, supaya tidak ada jalur penilaian yang ketinggalan tipe kunci.
 */

import { inferMode } from "./answerMatcher.js";

/**
 * Petunjuk format jawaban untuk dokumen soal *publik*.
 *
 * Ini bukan kunci: nilainya hanya "numeric"/"text", tidak membocorkan jawaban
 * apa pun. Gunanya agar layar siswa tahu kapan perlu menampilkan bantuan
 * pecahan dan pratinjau "terbaca sebagai" (lihat questionRenderer.js).
 */
export const publicAnswerFormat = (question) => {
  if (!question || question.type !== "essay" || !question.autoGrade) {
    return "";
  }
  const key = question.answerKey;
  const accepted = Array.isArray(key?.accepted) ? key.accepted.filter(Boolean) : [];
  if (accepted.length === 0) {
    return "";
  }
  const mode = !key.mode || key.mode === "auto" ? inferMode(accepted) : key.mode;
  return mode === "numeric" ? "numeric" : "text";
};

/** Bentuk kunci untuk disimpan ke `exam_keys` (dipakai admin saat menyimpan). */
export const buildKeyPayload = (question) => {
  const payload = { type: question.type };

  if (question.type === "pg" || question.type === "pgk" || question.type === "tf") {
    payload.correctOptionIds = (question.options || [])
      .filter((opt) => opt.isCorrect)
      .map((opt) => opt.id);
    return payload;
  }

  if (question.type === "tf_matrix") {
    payload.correctStatements = {};
    (question.statements || []).forEach((stmt) => {
      payload.correctStatements[stmt.id] = String(stmt.isCorrect);
    });
    return payload;
  }

  if (question.type === "match") {
    payload.matchPairs = question.matchPairs || [];
    return payload;
  }

  if (question.type === "essay") {
    payload.autoGrade = Boolean(question.autoGrade);
    payload.onMismatch = question.onMismatch === "wrong" ? "wrong" : "manual";
    payload.answerKey = question.autoGrade && question.answerKey ? question.answerKey : null;
    return payload;
  }

  return payload;
};

/** Kembalikan soal yang sudah dilengkapi kunci jawabannya. */
export const mergeQuestionWithKey = (question, key) => {
  if (!key) {
    return question;
  }

  if (question.type === "pg" || question.type === "tf" || question.type === "pgk") {
    return {
      ...question,
      options: (question.options || []).map((opt) => ({
        ...opt,
        isCorrect: (key.correctOptionIds || []).includes(opt.id),
      })),
    };
  }

  if (question.type === "tf_matrix") {
    return {
      ...question,
      statements: (question.statements || []).map((stmt) => ({
        ...stmt,
        isCorrect: key.correctStatements?.[stmt.id] || "false",
      })),
    };
  }

  if (question.type === "match") {
    return { ...question, matchPairs: key.matchPairs || [] };
  }

  if (question.type === "essay") {
    return {
      ...question,
      autoGrade: Boolean(key.autoGrade && key.answerKey),
      answerKey: key.answerKey || null,
      onMismatch: key.onMismatch === "wrong" ? "wrong" : "manual",
    };
  }

  return question;
};

export const mergeQuestionsWithKeys = (questions, keysMap = {}) =>
  (questions || []).map((question) => mergeQuestionWithKey(question, keysMap[question.id]));
