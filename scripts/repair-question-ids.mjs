/**
 * Audit & perbaikan tautan jawaban siswa yang putus setelah impor ulang soal.
 *
 * Latar: `submissions.answersByQuestionId` memakai ID soal sebagai kunci, dan
 * `submissions.breakdown[].questionId` menunjuk ID yang sama. Impor soal dari
 * Word (sebelum perbaikan ID) menerbitkan dokumen soal baru dengan ID baru,
 * lalu `exams.questionIds` ikut diganti — sehingga halaman hasil mencari
 * jawaban memakai ID baru dan tidak menemukan apa-apa. Datanya tidak hilang,
 * hanya kuncinya yang tidak lagi cocok.
 *
 * Urutan `breakdown` mengikuti urutan soal ujian saat siswa mengumpulkan
 * (lihat calculateScore di js/scoring.js), jadi ID lama bisa dipetakan ke ID
 * baru berdasarkan posisi — selama jumlah soalnya sama.
 *
 * Pemakaian:
 *   node scripts/repair-question-ids.mjs            # audit saja (read-only)
 *   node scripts/repair-question-ids.mjs --apply    # tulis perbaikan
 *   node scripts/repair-question-ids.mjs --exam=<examId>   # batasi satu ujian
 *
 * Mode --apply selalu menulis cadangan seluruh submission yang tersentuh ke
 * backup/ sebelum mengubah apa pun.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { analyzeSubmission, buildRepairedSubmission } from "./lib/remapQuestionIds.mjs";

const APPLY = process.argv.includes("--apply");
const examFilterArg = process.argv.find((a) => a.startsWith("--exam="));
const EXAM_FILTER = examFilterArg ? examFilterArg.split("=")[1] : null;

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH belum diisi pada .env");
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

/** Timestamp Firestore tidak lolos JSON.stringify apa adanya. */
const serialize = (value) => {
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") {
    return { __timestamp__: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(serialize);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Cek keberadaan dokumen soal lama, untuk memastikan soalnya belum terhapus. */
const findMissingQuestions = async (ids) => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const missing = [];
  for (const group of chunk(unique, 300)) {
    const refs = group.map((id) => db.collection("questions").doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => {
      if (!snap.exists) missing.push(snap.id);
    });
  }
  return missing;
};

const run = async () => {
  console.log(APPLY ? "MODE: APPLY (menulis perubahan)\n" : "MODE: AUDIT (read-only, tidak menulis apa pun)\n");

  const [examsSnap, subsSnap] = await Promise.all([
    db.collection("exams").get(),
    db.collection("submissions").get(),
  ]);

  const exams = new Map();
  examsSnap.forEach((d) => exams.set(d.id, { id: d.id, ...d.data() }));

  const submissions = subsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => !EXAM_FILTER || s.examId === EXAM_FILTER);

  console.log(`Ujian: ${exams.size} | Submission diperiksa: ${submissions.length}\n`);

  const buckets = { OK: [], REPAIRABLE: [], BLOCKED: [], SKIP: [] };
  const analyzed = [];

  for (const sub of submissions) {
    const exam = exams.get(sub.examId);
    const result = analyzeSubmission(sub, exam);
    buckets[result.status].push({ sub, exam, result });
    analyzed.push({ sub, exam, result });
  }

  // Ringkasan per ujian agar mudah dilihat ujian mana yang terdampak.
  const perExam = new Map();
  for (const { sub, exam, result } of analyzed) {
    const key = sub.examId;
    if (!perExam.has(key)) {
      perExam.set(key, { title: exam?.title || sub.examTitle || key, OK: 0, REPAIRABLE: 0, BLOCKED: 0, SKIP: 0 });
    }
    perExam.get(key)[result.status] += 1;
  }

  console.log("=== RINGKASAN PER UJIAN ===");
  for (const [examId, row] of perExam) {
    console.log(
      `${row.title}  [${examId}]\n` +
        `   utuh: ${row.OK} | bisa diperbaiki: ${row.REPAIRABLE} | terkunci: ${row.BLOCKED} | dilewati: ${row.SKIP}`
    );
  }

  if (buckets.BLOCKED.length > 0) {
    console.log("\n=== PERLU PERHATIAN MANUAL ===");
    for (const { sub, result } of buckets.BLOCKED) {
      console.log(`- ${sub.email || sub.userId} (${sub.id}): ${result.reason}`);
    }
  }

  if (buckets.REPAIRABLE.length > 0) {
    console.log("\n=== CONTOH PEMETAAN (3 submission pertama) ===");
    for (const { sub, result } of buckets.REPAIRABLE.slice(0, 3)) {
      console.log(`- ${sub.email || sub.userId} (${sub.id}): ${result.reason}`);
      let shown = 0;
      for (const [oldId, newId] of result.idMap) {
        if (shown >= 3) break;
        console.log(`    ${oldId}  ->  ${newId}`);
        shown += 1;
      }
      if (result.unmapped.length > 0) {
        console.log(`    ⚠️ ${result.unmapped.length} kunci jawaban tanpa pasangan, akan dibiarkan apa adanya`);
      }
    }

    const oldIdsAll = buckets.REPAIRABLE.flatMap(({ result }) => result.oldIds);
    const missing = await findMissingQuestions(oldIdsAll);
    console.log(
      `\nDokumen soal lama: ${[...new Set(oldIdsAll)].length} unik, ${missing.length} sudah terhapus dari koleksi questions.`
    );
  }

  console.log(
    `\nTOTAL — utuh: ${buckets.OK.length} | bisa diperbaiki: ${buckets.REPAIRABLE.length} | ` +
      `terkunci: ${buckets.BLOCKED.length} | dilewati: ${buckets.SKIP.length}`
  );

  if (!APPLY) {
    console.log("\nTidak ada yang diubah. Jalankan ulang dengan --apply untuk menulis perbaikan.");
    return;
  }

  if (buckets.REPAIRABLE.length === 0) {
    console.log("\nTidak ada yang perlu diperbaiki.");
    return;
  }

  const backupDir = path.resolve("backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `submissions-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      buckets.REPAIRABLE.map(({ sub }) => serialize(sub)),
      null,
      2
    )
  );
  console.log(`\nCadangan ${buckets.REPAIRABLE.length} submission ditulis ke ${backupPath}`);

  let written = 0;
  for (const group of chunk(buckets.REPAIRABLE, 400)) {
    const batch = db.batch();
    for (const { sub, result } of group) {
      batch.update(db.collection("submissions").doc(sub.id), buildRepairedSubmission(sub, result));
    }
    await batch.commit();
    written += group.length;
    console.log(`Tertulis ${written}/${buckets.REPAIRABLE.length}...`);
  }

  console.log(`\nSelesai. ${written} submission diperbaiki.`);
};

run()
  .catch((err) => {
    console.error("Gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
