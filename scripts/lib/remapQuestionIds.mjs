/**
 * Logika murni pemetaan ulang ID soal pada submission — dipisah dari skrip
 * agar bisa diuji tanpa menyentuh Firestore.
 *
 * `submissions.answersByQuestionId` berkunci ID soal dan
 * `submissions.breakdown[].questionId` menunjuk ID yang sama. Ketika soal
 * diimpor ulang dan mendapat ID Firestore baru, kunci-kunci itu jadi menunjuk
 * soal yang sudah tidak terdaftar di `exams.questionIds`, sehingga jawaban
 * siswa tidak lagi ditemukan halaman hasil.
 *
 * Urutan `breakdown` mengikuti urutan soal ujian saat siswa mengumpulkan
 * (calculateScore di js/scoring.js memetakan array questions apa adanya), jadi
 * ID lama dapat dipasangkan ke ID baru berdasarkan posisi.
 */

/**
 * Tentukan status sebuah submission terhadap daftar soal ujian saat ini.
 *
 * Status yang mungkin:
 *  - OK         : semua kunci jawaban masih terdaftar, tidak perlu diapa-apakan
 *  - REPAIRABLE : ada kunci yatim dan pemetaan posisi aman dilakukan
 *  - BLOCKED    : ada kunci yatim tapi pemetaan tidak bisa dipastikan
 *  - SKIP       : tidak ada yang bisa dinilai (tanpa ujian / tanpa jawaban)
 */
export const analyzeSubmission = (sub, exam) => {
  const answers = sub.answersByQuestionId || {};
  const answerKeys = Object.keys(answers);
  const breakdown = Array.isArray(sub.breakdown) ? sub.breakdown : [];
  const newIds = Array.isArray(exam?.questionIds) ? exam.questionIds : [];

  if (!exam) {
    return { status: "SKIP", reason: "ujian sudah tidak ada" };
  }
  if (answerKeys.length === 0) {
    return { status: "SKIP", reason: "siswa tidak mengisi jawaban apa pun" };
  }

  const orphanKeys = answerKeys.filter((k) => !newIds.includes(k));
  if (orphanKeys.length === 0) {
    return { status: "OK", reason: "semua jawaban masih tertaut" };
  }

  if (breakdown.length === 0) {
    return {
      status: "BLOCKED",
      reason: "tidak ada breakdown, urutan soal lama tak bisa direkonstruksi",
      orphanKeys,
    };
  }

  const oldIds = breakdown.map((b) => b.questionId);

  // Breakdown sudah memakai ID baru sementara jawaban masih ID lama: jejak
  // urutan lama sudah tertimpa, kemungkinan tombol "Nilai Ulang Otomatis"
  // sempat ditekan pada submission ini.
  if (oldIds.every((id) => newIds.includes(id))) {
    return {
      status: "BLOCKED",
      reason: "breakdown sudah tertimpa ID baru, pemetaan urutan lama hilang",
      orphanKeys,
    };
  }

  if (oldIds.length !== newIds.length) {
    return {
      status: "BLOCKED",
      reason: `jumlah soal berubah (${oldIds.length} lama vs ${newIds.length} baru), pemetaan posisi tidak aman`,
      orphanKeys,
    };
  }

  const idMap = new Map();
  oldIds.forEach((oldId, idx) => idMap.set(oldId, newIds[idx]));

  return {
    status: "REPAIRABLE",
    reason: `${orphanKeys.length} jawaban dipetakan ulang ke ID soal baru`,
    orphanKeys,
    unmapped: orphanKeys.filter((k) => !idMap.has(k)),
    idMap,
    oldIds,
  };
};

/**
 * Susun field pengganti untuk sebuah submission. Nilai dan status penilaian
 * tidak disentuh sama sekali — yang berubah hanya ID soal yang ditunjuk.
 */
export const buildRepairedSubmission = (sub, result) => {
  const { idMap } = result;
  const answers = sub.answersByQuestionId || {};
  const breakdown = Array.isArray(sub.breakdown) ? sub.breakdown : [];

  const newAnswers = {};
  for (const [qid, value] of Object.entries(answers)) {
    // Kunci tak dikenal dibiarkan apa adanya; jangan sampai ada jawaban yang
    // justru terbuang oleh proses perbaikan ini.
    newAnswers[idMap.get(qid) || qid] = value;
  }

  const newBreakdown = breakdown.map((item) => ({
    ...item,
    questionId: idMap.get(item.questionId) || item.questionId,
  }));

  return { answersByQuestionId: newAnswers, breakdown: newBreakdown };
};
