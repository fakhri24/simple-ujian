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

  // 5. Update target test exam timeframe to ensure it is not expired
  batch.update(db.collection("exams").doc("FBmjZeEIhJOcXokiNEYS"), {
    startTime: Timestamp.fromDate(new Date("2020-01-01")),
    latestStartTime: Timestamp.fromDate(new Date("2030-01-01")),
    active: true
  });

  await batch.commit();
  console.log("Pembersihan selesai.");
}

clean().catch(console.error);
