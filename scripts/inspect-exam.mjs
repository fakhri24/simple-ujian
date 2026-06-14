import "dotenv/config";
import fs from "node:fs";
import admin from "firebase-admin";

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH belum diisi pada .env");
}

const rawServiceAccount = fs.readFileSync(serviceAccountPath, "utf-8");
const serviceAccount = JSON.parse(rawServiceAccount);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const inspect = async () => {
  const examsRef = db.collection("exams");
  const querySnap = await examsRef.where("title", "==", "ASAT MTL X 2026").get();
  
  if (querySnap.empty) {
    console.log("Exam 'ASAT MTL X 2026' not found.");
    return;
  }
  
  const doc = querySnap.docs[0];
  console.log("Exam Document ID:", doc.id);
  console.log("Exam Data:", JSON.stringify(doc.data(), null, 2));
};

inspect().catch(console.error).finally(() => process.exit(0));
