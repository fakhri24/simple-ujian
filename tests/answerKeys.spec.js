import { test, expect } from '@playwright/test';
import {
  buildKeyPayload,
  mergeQuestionWithKey,
  mergeQuestionsWithKeys,
  publicAnswerFormat,
} from '../js/answerKeys.js';
import { calculateScore } from '../js/scoring.js';

/**
 * Kunci disimpan terpisah dari soal publik. Test ini menjaga agar perjalanan
 * editor → exam_keys → penilaian tidak kehilangan kunci untuk tipe apa pun.
 */
const roundTrip = (question) => mergeQuestionWithKey(
  stripKeys(question),
  buildKeyPayload(question)
);

/** Tiruan dokumen soal publik: tanpa jejak kunci jawaban apa pun. */
const stripKeys = (question) => {
  const publicQuestion = { id: question.id, type: question.type, scoreWeight: question.scoreWeight };
  if (question.options) {
    publicQuestion.options = question.options.map(({ id, text }) => ({ id, text }));
  }
  if (question.statements) {
    publicQuestion.statements = question.statements.map(({ id, text }) => ({ id, text }));
  }
  if (question.matchPairs) {
    publicQuestion.matchPairs = question.matchPairs.map(({ left }) => ({ left, right: 'diacak' }));
  }
  return publicQuestion;
};

test.describe('answerKeys — perjalanan kunci editor → exam_keys → penilaian', () => {
  test('pg / pgk / tf', () => {
    const question = {
      id: 'q1',
      type: 'pgk',
      scoreWeight: 10,
      options: [
        { id: 'opt_1', text: 'A', isCorrect: true },
        { id: 'opt_2', text: 'B', isCorrect: false },
        { id: 'opt_3', text: 'C', isCorrect: true },
      ],
    };
    expect(roundTrip(question).options).toEqual(question.options);
  });

  test('tf_matrix', () => {
    const question = {
      id: 'q2',
      type: 'tf_matrix',
      scoreWeight: 10,
      statements: [
        { id: 'stmt_1', text: 'S1', isCorrect: 'true' },
        { id: 'stmt_2', text: 'S2', isCorrect: 'false' },
      ],
    };
    expect(roundTrip(question).statements).toEqual(question.statements);
  });

  test('match — pasangan benar dipulihkan meski soal publik diacak', () => {
    const question = {
      id: 'q3',
      type: 'match',
      scoreWeight: 10,
      matchPairs: [
        { left: 'Indonesia', right: 'Jakarta' },
        { left: 'Jepang', right: 'Tokyo' },
      ],
    };
    expect(roundTrip(question).matchPairs).toEqual(question.matchPairs);
  });

  test('essay auto-grade', () => {
    const question = {
      id: 'q4',
      type: 'essay',
      scoreWeight: 10,
      autoGrade: true,
      onMismatch: 'wrong',
      answerKey: { mode: 'numeric', accepted: ['3/4'], tolerance: 0 },
    };
    const restored = roundTrip(question);
    expect(restored).toMatchObject({
      autoGrade: true,
      onMismatch: 'wrong',
      answerKey: { mode: 'numeric', accepted: ['3/4'] },
    });
    expect(calculateScore([restored], { q4: '75%' }).total).toBe(100);
  });

  test('essay tanpa auto-grade tidak menyimpan kunci sama sekali', () => {
    const question = {
      id: 'q5',
      type: 'essay',
      scoreWeight: 10,
      autoGrade: false,
      answerKey: { mode: 'numeric', accepted: ['3/4'] },
    };
    const key = buildKeyPayload(question);
    expect(key.answerKey).toBeNull();
    expect(mergeQuestionWithKey(stripKeys(question), key).autoGrade).toBe(false);
  });

  test('soal tanpa kunci di exam_keys dibiarkan apa adanya', () => {
    const questions = [{ id: 'q6', type: 'pg', options: [{ id: 'opt_1', text: 'A' }] }];
    expect(mergeQuestionsWithKeys(questions, {})).toEqual(questions);
  });

  test('kunci essay tidak pernah bocor ke dokumen soal publik', () => {
    const question = {
      id: 'q7',
      type: 'essay',
      scoreWeight: 10,
      autoGrade: true,
      answerKey: { mode: 'text', accepted: ['Soekarno'] },
    };
    // Dokumen publik dibentuk terpisah di adminPage; di sini kita pastikan
    // buildKeyPayload memang menampung kuncinya (bukan payload publik).
    expect(buildKeyPayload(question).answerKey.accepted).toEqual(['Soekarno']);
    expect(stripKeys(question)).not.toHaveProperty('answerKey');
  });
});

test.describe('publicAnswerFormat — petunjuk format untuk layar siswa', () => {
  const essay = (extra) => ({ id: 'q', type: 'essay', autoGrade: true, ...extra });

  test('mode auto ditebak dari bentuk kuncinya', () => {
    expect(publicAnswerFormat(essay({ answerKey: { accepted: ['3/4'] } }))).toBe('numeric');
    expect(publicAnswerFormat(essay({ answerKey: { accepted: ['Soekarno'] } }))).toBe('text');
    expect(publicAnswerFormat(essay({ answerKey: { mode: 'auto', accepted: ['12 cm'] } }))).toBe('numeric');
  });

  test('mode yang dipilih guru dipakai apa adanya', () => {
    expect(publicAnswerFormat(essay({ answerKey: { mode: 'numeric', accepted: ['3/4'] } }))).toBe('numeric');
    // Kunci berupa angka tapi guru memilih teks: jangan paksa layar angka.
    expect(publicAnswerFormat(essay({ answerKey: { mode: 'text', accepted: ['3/4'] } }))).toBe('text');
    expect(publicAnswerFormat(essay({ answerKey: { mode: 'keywords', accepted: ['ekonomi'] } }))).toBe('text');
  });

  test('tanpa auto-grade atau tanpa kunci, tidak ada petunjuk sama sekali', () => {
    expect(publicAnswerFormat(essay({ autoGrade: false, answerKey: { accepted: ['3/4'] } }))).toBe('');
    expect(publicAnswerFormat(essay({ answerKey: { accepted: [] } }))).toBe('');
    expect(publicAnswerFormat(essay({ answerKey: null }))).toBe('');
    expect(publicAnswerFormat({ id: 'q', type: 'pg' })).toBe('');
    expect(publicAnswerFormat(null)).toBe('');
  });

  test('petunjuknya bukan kunci: hanya "numeric" atau "text"', () => {
    const format = publicAnswerFormat(essay({ answerKey: { accepted: ['3/4', '0,75'] } }));
    expect(['numeric', 'text', '']).toContain(format);
    expect(format).not.toContain('3/4');
  });
});
