import "dotenv/config";
import fs from "node:fs";
import { initializeApp, cert } from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH belum diisi pada .env");
}

const rawServiceAccount = fs.readFileSync(serviceAccountPath, "utf-8");
const serviceAccount = JSON.parse(rawServiceAccount);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const clean = async () => {
  // 1. Clean exam_attempts
  const attemptsRef = db.collection("exam_attempts");
  const attemptsSnap = await attemptsRef.get();
  
  if (!attemptsSnap.empty) {
    const batch = db.batch();
    attemptsSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`Berhasil menghapus ${attemptsSnap.size} sesi ujian (exam_attempts) dari database.`);
  } else {
    console.log("Koleksi exam_attempts sudah kosong.");
  }

  // 2. Clean submissions
  const submissionsRef = db.collection("submissions");
  const submissionsSnap = await submissionsRef.get();

  if (!submissionsSnap.empty) {
    const batch = db.batch();
    submissionsSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`Berhasil menghapus ${submissionsSnap.size} hasil ujian (submissions) dari database.`);
  } else {
    console.log("Koleksi submissions sudah kosong.");
  }

  // 3. Reset login session for all users to bypass concurrent session protection in tests
  const usersRef = db.collection("users");
  const usersSnap = await usersRef.get();
  if (!usersSnap.empty) {
    const batch = db.batch();
    usersSnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        sessionId: FieldValue.delete(),
        lastActiveAt: FieldValue.delete()
      });
    });
    await batch.commit();
    console.log(`Berhasil me-reset sesi login untuk semua ${usersSnap.size} pengguna.`);
  }
};

clean()
  .catch((error) => {
    console.error("Gagal membersihkan database:", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
