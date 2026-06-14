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

const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin123!";
const studentEmail = process.env.SEED_STUDENT_EMAIL || "siswa@example.com";
const studentPassword = process.env.SEED_STUDENT_PASSWORD || "Siswa123!";

const ensureUser = async ({ email, password, role, namaLengkap, kelas, nis }) => {
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch {
    userRecord = await admin.auth().createUser({ email, password });
  }

  const payload = {
    uid: userRecord.uid,
    email,
    role,
    sessionId: null,
    lastActiveAt: null,
  };

  if (namaLengkap) payload.namaLengkap = namaLengkap;
  if (kelas) payload.kelas = kelas;
  if (nis) payload.nis = nis;

  await db.collection("users").doc(userRecord.uid).set(
    payload,
    { merge: true },
  );

  return userRecord;
};

const keys = {};

const splitQuestionPublicAndKey = (q) => {
  const publicPayload = {
    type: q.type,
    content: q.content,
    scoreWeight: q.scoreWeight || 100,
  };
  const keyPayload = {
    type: q.type,
  };

  if (q.type === "pg" || q.type === "pgk" || q.type === "tf") {
    publicPayload.options = (q.options || []).map(opt => ({
      id: opt.id,
      text: opt.text
    }));
    keyPayload.correctOptionIds = (q.options || [])
      .filter(opt => opt.isCorrect)
      .map(opt => opt.id);
  } else if (q.type === "tf_matrix") {
    publicPayload.statements = (q.statements || []).map(stmt => ({
      id: stmt.id,
      text: stmt.text
    }));
    keyPayload.correctStatements = {};
    (q.statements || []).forEach(stmt => {
      keyPayload.correctStatements[stmt.id] = String(stmt.isCorrect);
    });
  } else if (q.type === "match") {
    const lefts = (q.matchPairs || []).map(p => p.left);
    const rights = (q.matchPairs || []).map(p => p.right);
    
    const shuffledRights = [...rights];
    for (let i = shuffledRights.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledRights[i], shuffledRights[j]] = [shuffledRights[j], shuffledRights[i]];
    }
    
    publicPayload.matchPairs = lefts.map((left, idx) => ({
      left: left,
      right: shuffledRights[idx]
    }));
    
    keyPayload.matchPairs = q.matchPairs || [];
  }

  return { publicPayload, keyPayload };
};

const createQuestion = async (question) => {
  const { publicPayload, keyPayload } = splitQuestionPublicAndKey(question);
  const ref = await db.collection("questions").add({
    ...publicPayload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  keys[ref.id] = keyPayload;
  return ref.id;
};

const seed = async () => {
  const adminUser = await ensureUser({
    email: adminEmail,
    password: adminPassword,
    role: "admin",
  });
  const studentUser = await ensureUser({
    email: studentEmail,
    password: studentPassword,
    role: "siswa",
    namaLengkap: "Siswa Dummy Utama",
    kelas: "XII-IPA-1",
    nis: "1234567890",
  });

  const questionIds = [];

  questionIds.push(
    await createQuestion({
      type: "pg",
      content: "<p>Nilai dari $2^3$ adalah ...</p>",
      scoreWeight: 10,
      options: [
        { id: "opt_a", text: "6", isCorrect: false },
        { id: "opt_b", text: "8", isCorrect: true },
        { id: "opt_c", text: "9", isCorrect: false },
      ],
    }),
  );

  questionIds.push(
    await createQuestion({
      type: "pgk",
      content: "<p>Pilih bilangan prima di bawah ini.</p>",
      scoreWeight: 30,
      options: [
        { id: "opt_a", text: "2", isCorrect: true },
        { id: "opt_b", text: "3", isCorrect: true },
        { id: "opt_c", text: "4", isCorrect: false },
      ],
    }),
  );

  questionIds.push(
    await createQuestion({
      type: "tf",
      content: "<p>Bahasa Arab ditulis dari kanan ke kiri.</p>",
      scoreWeight: 5,
      options: [
        { id: "true", text: "Benar", isCorrect: true },
        { id: "false", text: "Salah", isCorrect: false },
      ],
    }),
  );

  questionIds.push(
    await createQuestion({
      type: "essay",
      content: "<p>Jelaskan arti dari teks berikut: السلام عليكم</p>",
      scoreWeight: 30,
    }),
  );

  questionIds.push(
    await createQuestion({
      type: "tf_matrix",
      content: "<p>Tentukan Benar (True) atau Salah (False) untuk masing-masing pernyataan berikut:</p>",
      scoreWeight: 30,
      statements: [
        { id: "stmt_1", text: "2 adalah satu-satunya bilangan prima genap.", isCorrect: "true" },
        { id: "stmt_2", text: "Hasil perkalian dari $5 \\times 5$ adalah 30.", isCorrect: "false" },
        { id: "stmt_3", text: "Bahasa Arab ditulis dari kiri ke kanan.", isCorrect: "false" },
      ],
    }),
  );

  questionIds.push(
    await createQuestion({
      type: "match",
      content: "<p>Jodohkan negara dengan ibu kotanya.</p>",
      scoreWeight: 10,
      matchPairs: [
        { left: "Indonesia", right: "Jakarta" },
        { left: "Jepang", right: "Tokyo" },
        { left: "Prancis", right: "Paris" },
      ],
    }),
  );

  const examRef = await db.collection("exams").add({
    title: "Paket MVP Contoh",
    description: "Soal campuran PG, PGK, TF, Essay, Match",
    durationMinutes: 20,
    active: true,
    visibility: "public",
    questionIds,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection("exam_keys").doc(examRef.id).set({
    keys
  });

  console.log("Seed selesai.");
  console.log(`Admin: ${adminUser.email} / ${adminPassword}`);
  console.log(`Siswa: ${studentUser.email} / ${studentPassword}`);
};

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
