import "dotenv/config";
import fs from "node:fs";
import { initializeApp, cert } from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

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

const inspect = async () => {
  const targetTitle = process.argv[2] || "[Uji Sistem] E2E Automated Test";
  const examsRef = db.collection("exams");
  const querySnap = await examsRef.where("title", "==", targetTitle).get();
  
  if (querySnap.empty) {
    console.log(`Exam '${targetTitle}' not found.`);
    return;
  }
  
  const doc = querySnap.docs[0];
  console.log("Exam Document ID:", doc.id);
  console.log("Exam Data:", JSON.stringify(doc.data(), null, 2));
};

inspect().catch(console.error).finally(() => process.exit(0));
