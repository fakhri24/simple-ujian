import "dotenv/config";
import fs from "node:fs";
import admin from "firebase-admin";

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH belum diisi pada .env");
}

const rawServiceAccount = fs.readFileSync(serviceAccountPath, "utf-8");
const serviceAccount = JSON.parse(rawServiceAccount);

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const testUserEmail = "siswa@example.com";

async function clean() {
  console.log("Memulai pembersihan data pengujian...");
  
  // 1. Dapatkan UID dari siswa@example.com
  const userRecord = await admin.auth().getUserByEmail(testUserEmail);
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

  // 4. Reset session
  batch.update(db.collection("users").doc(uid), {
    sessionId: null,
    lastActiveAt: null
  });

  // 5. Update target test exam timeframe to ensure it is not expired
  batch.update(db.collection("exams").doc("FBmjZeEIhJOcXokiNEYS"), {
    startTime: admin.firestore.Timestamp.fromDate(new Date("2020-01-01")),
    latestStartTime: admin.firestore.Timestamp.fromDate(new Date("2030-01-01")),
    active: true
  });

  await batch.commit();
  console.log("Pembersihan selesai.");
}

clean().catch(console.error);
