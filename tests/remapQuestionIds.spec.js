import { test, expect } from '@playwright/test';
import {
  analyzeSubmission,
  buildRepairedSubmission,
} from '../scripts/lib/remapQuestionIds.mjs';

/**
 * Skrip pemulihan menulis langsung ke koleksi submissions, jadi keputusan
 * "aman dipetakan" vs "jangan disentuh" harus terkunci oleh test.
 */

const makeSub = (overrides = {}) => ({
  id: 'sub1',
  examId: 'exam1',
  email: 'siswa@sekolah.id',
  totalScore: 80,
  answersByQuestionId: { qLamaA: 'opt_1', qLamaB: 'Soekarno' },
  breakdown: [
    { questionId: 'qLamaA', type: 'pg', status: 'correct', score: 10, scoreWeight: 10 },
    { questionId: 'qLamaB', type: 'essay', status: 'graded', score: 8, scoreWeight: 10 },
  ],
  ...overrides,
});

const examWith = (questionIds) => ({ id: 'exam1', title: 'Ujian', questionIds });

test('submission yang masih tertaut dibiarkan apa adanya', () => {
  const sub = makeSub();
  const result = analyzeSubmission(sub, examWith(['qLamaA', 'qLamaB']));
  expect(result.status).toBe('OK');
});

test('jawaban yatim dipetakan ke ID baru berdasarkan posisi', () => {
  const sub = makeSub();
  const result = analyzeSubmission(sub, examWith(['qBaruA', 'qBaruB']));

  expect(result.status).toBe('REPAIRABLE');
  expect(result.orphanKeys).toEqual(['qLamaA', 'qLamaB']);

  const repaired = buildRepairedSubmission(sub, result);
  expect(repaired.answersByQuestionId).toEqual({
    qBaruA: 'opt_1',
    qBaruB: 'Soekarno',
  });
  expect(repaired.breakdown.map((b) => b.questionId)).toEqual(['qBaruA', 'qBaruB']);
});

test('nilai dan status penilaian tidak ikut berubah saat dipetakan', () => {
  const sub = makeSub();
  const result = analyzeSubmission(sub, examWith(['qBaruA', 'qBaruB']));
  const repaired = buildRepairedSubmission(sub, result);

  expect(repaired.breakdown[1]).toMatchObject({
    type: 'essay',
    status: 'graded',
    score: 8,
    scoreWeight: 10,
  });
});

test('jumlah soal yang berubah menghentikan pemetaan', () => {
  const sub = makeSub();
  const result = analyzeSubmission(sub, examWith(['qBaruA', 'qBaruB', 'qBaruC']));

  expect(result.status).toBe('BLOCKED');
  expect(result.reason).toContain('jumlah soal berubah');
});

test('breakdown yang sudah tertimpa ID baru dianggap tak bisa dipetakan', () => {
  // Kondisi setelah tombol "Nilai Ulang Otomatis" ditekan: breakdown memakai
  // ID baru sementara jawaban masih berkunci ID lama.
  const sub = makeSub({
    breakdown: [
      { questionId: 'qBaruA', type: 'pg', status: 'wrong', score: 0, scoreWeight: 10 },
      { questionId: 'qBaruB', type: 'essay', status: 'wrong', score: 0, scoreWeight: 10 },
    ],
  });
  const result = analyzeSubmission(sub, examWith(['qBaruA', 'qBaruB']));

  expect(result.status).toBe('BLOCKED');
  expect(result.reason).toContain('pemetaan urutan lama hilang');
});

test('submission tanpa breakdown tidak dipetakan secara menebak', () => {
  const sub = makeSub({ breakdown: [] });
  const result = analyzeSubmission(sub, examWith(['qBaruA', 'qBaruB']));

  expect(result.status).toBe('BLOCKED');
  expect(result.reason).toContain('tidak ada breakdown');
});

test('kunci jawaban di luar breakdown tetap dipertahankan', () => {
  const sub = makeSub({
    answersByQuestionId: { qLamaA: 'opt_1', qLamaB: 'Soekarno', qAsing: 'jawaban' },
  });
  const result = analyzeSubmission(sub, examWith(['qBaruA', 'qBaruB']));

  expect(result.status).toBe('REPAIRABLE');
  expect(result.unmapped).toEqual(['qAsing']);

  const repaired = buildRepairedSubmission(sub, result);
  expect(repaired.answersByQuestionId.qAsing).toBe('jawaban');
});

test('submission tanpa jawaban dilewati', () => {
  const sub = makeSub({ answersByQuestionId: {} });
  expect(analyzeSubmission(sub, examWith(['qBaruA'])).status).toBe('SKIP');
});

test('submission milik ujian yang sudah dihapus dilewati', () => {
  expect(analyzeSubmission(makeSub(), null).status).toBe('SKIP');
});
