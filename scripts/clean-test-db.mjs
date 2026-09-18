import "dotenv/config";
import fs from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH belum diisi pada .env");
}

const rawServiceAccount = fs.readFileSync(serviceAccountPath, "utf-8");
const serviceAccount = JSON.parse(rawServiceAccount);

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();
const testUserEmail = "siswa@example.com";

async function clean() {
  console.log("Memulai pembersihan data pengujian...");
  
  // 1. Dapatkan UID dari siswa@example.com
  const userRecord = await getAuth().getUserByEmail(testUserEmail);
  const uid = userRecord.uid;
  console.log(`UID Siswa Uji: ${uid}`);

  // 2. Hapus semua dokumen di exam_attempts milik siswa tersebut
  const attemptsSnap = await db.collection("exam_attempts").where("userId", "==", uid).get();
  console.log(`Menghapus ${attemptsSnap.size} attempts...`);
  const batch = db.batch();
  attemptsSnap.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  // 3. Hapus semua dokumen di submissions milik siswa tersebut
  const submissionsSnap = await db.collection("submissions").where("userId", "==", uid).get();
  console.log(`Menghapus ${submissionsSnap.size} submissions...`);
  submissionsSnap.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  // 4. Reset sessions for all users to bypass concurrent session protection in tests
  const usersSnap = await db.collection("users").get();
  usersSnap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      sessionId: null,
      lastActiveAt: null
    });
  });

  // 5. Setup dedicated private test exam for automated E2E tests (only visible to test student)
  const origKeysSnap = await db.collection("exam_keys").doc("FBmjZeEIhJOcXokiNEYS").get();
  if (origKeysSnap.exists) {
    batch.set(db.collection("exam_keys").doc("test_e2e_exam"), origKeysSnap.data(), { merge: true });
  }

  const testExamRef = db.collection("exams").doc("test_e2e_exam");
  batch.set(testExamRef, {
    title: "[Uji Sistem] E2E Automated Test",
    description: "Ujian khusus pengujian otomatis Playwright",
    visibility: "private",
    assignedTo: [uid],
    active: true,
    startTime: Timestamp.fromDate(new Date("2020-01-01")),
    latestStartTime: Timestamp.fromDate(new Date("2030-01-01")),
    durationMinutes: 120,
    minSubmitBeforeEndMinutes: 15,
    allowMultipleAttempts: false,
    requireSEB: false,
    randomizeQuestions: false,
    showResultsImmediately: true,
    passages: [],
    questionIds: [
      "e2mA7TzWSq52Yzlj4gXL",
      "jQJ9mxHpqtrAWjBbJKzA",
      "wIxhwXzhQMc34IfRypux",
      "nGcYaR5SFVB4AcRW5ZF8",
      "eM2wtSd5oeyn2lcskvO9"
    ],
    updatedAt: Timestamp.now()
  }, { merge: true });

  const testQuestionIds = [
    "e2mA7TzWSq52Yzlj4gXL",
    "jQJ9mxHpqtrAWjBbJKzA",
    "wIxhwXzhQMc34IfRypux",
    "nGcYaR5SFVB4AcRW5ZF8",
    "eM2wtSd5oeyn2lcskvO9"
  ];
  for (const qid of testQuestionIds) {
    batch.update(db.collection("questions").doc(qid), { passageId: "" });
  }

  await batch.commit();
  console.log("Pembersihan selesai.");
}

clean().catch(console.error);
