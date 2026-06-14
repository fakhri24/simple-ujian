import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  Timestamp,
  onSnapshot,
  increment,
  documentId,
  or,
} from "firebase/firestore";
import { db, storage } from "./firebase-config.js";
import { ref, deleteObject } from "firebase/storage";

const usersCol = collection(db, "users");
const examsCol = collection(db, "exams");
const questionsCol = collection(db, "questions");
const submissionsCol = collection(db, "submissions");
const examAttemptsCol = collection(db, "exam_attempts");

export const getUserProfile = async (uid) => {
  const cacheKey = `user_profile_${uid}`;
  if (typeof sessionStorage !== "undefined") {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_) {
        sessionStorage.removeItem(cacheKey);
      }
    }
  }
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : null;
    if (data && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    }
    return data;
  } catch (error) {
    throw new Error(`Gagal mengambil profile user: ${error.message}`);
  }
};

export const upsertUserProfile = async (uid, data) => {
  try {
    await setDoc(doc(db, "users", uid), data, { merge: true });
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(`user_profile_${uid}`);
    }
  } catch (error) {
    throw new Error(`Gagal menyimpan profile user: ${error.message}`);
  }
};

export const listActiveExams = async (studentUid) => {
  try {
    if (!studentUid) {
      const q = query(examsCol, where("active", "==", true));
      const snap = await getDocs(q);
      return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    }
    const publicQuery = query(
      examsCol,
      where("active", "==", true),
      where("visibility", "==", "public")
    );
    const privateQuery = query(
      examsCol,
      where("active", "==", true),
      where("visibility", "==", "private"),
      where("assignedTo", "array-contains", studentUid)
    );
    const [publicSnap, privateSnap] = await Promise.all([
      getDocs(publicQuery),
      getDocs(privateQuery),
    ]);
    const examMap = new Map();
    publicSnap.docs.forEach((doc) =>
      examMap.set(doc.id, { id: doc.id, ...doc.data() })
    );
    privateSnap.docs.forEach((doc) =>
      examMap.set(doc.id, { id: doc.id, ...doc.data() })
    );
    return Array.from(examMap.values());
  } catch (error) {
    throw new Error(`Gagal memuat ujian aktif: ${error.message}`);
  }
};

export const listAllExams = async () => {
  try {
    const snap = await getDocs(examsCol);
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    throw new Error(`Gagal memuat daftar ujian: ${error.message}`);
  }
};

export const createExam = async (examPayload) => {
  try {
    const snap = await addDoc(examsCol, {
      ...examPayload,
      questionIds: examPayload.questionIds || [],
      visibility: examPayload.visibility || "public",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return snap.id;
  } catch (error) {
    throw new Error(`Gagal membuat ujian: ${error.message}`);
  }
};

export const updateExamQuestionIds = async (examId, questionId) => {
  try {
    await updateDoc(doc(db, "exams", examId), {
      questionIds: arrayUnion(questionId),
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    throw new Error(`Gagal menautkan soal ke ujian: ${error.message}`);
  }
};

export const createQuestion = async (questionPayload) => {
  try {
    const snap = await addDoc(questionsCol, {
      ...questionPayload,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return snap.id;
  } catch (error) {
    throw new Error(`Gagal membuat soal: ${error.message}`);
  }
};

export const getExamWithQuestions = async (examId) => {
  try {
    const examSnap = await getDoc(doc(db, "exams", examId));
    if (!examSnap.exists()) {
      return null;
    }

    const exam = { id: examSnap.id, ...examSnap.data() };
    const questions = await getQuestionsByIds(exam.questionIds || []);

    return { exam, questions };
  } catch (error) {
    throw new Error(`Gagal memuat ujian: ${error.message}`);
  }
};

export const getExamById = async (examId) => {
  try {
    const snap = await getDoc(doc(db, "exams", examId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    throw new Error(`Gagal memuat detail ujian: ${error.message}`);
  }
};


export const findSubmission = async (examId, userId) => {
  try {
    const q = query(
      submissionsCol,
      where("examId", "==", examId),
      where("userId", "==", userId),
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      return null;
    }
    const docs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    docs.sort((a, b) => {
      const timeA = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
      const timeB = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
      return timeB - timeA;
    });
    return docs[0];
  } catch (error) {
    throw new Error(`Gagal mencari submission: ${error.message}`);
  }
};

export const createSubmission = async (submissionPayload) => {
  try {
    const snap = await addDoc(submissionsCol, {
      ...submissionPayload,
      submittedAt: Timestamp.now(),
    });
    return snap.id;
  } catch (error) {
    throw new Error(`Gagal menyimpan submission: ${error.message}`);
  }
};

export const createSubmissionWithId = async (docId, submissionPayload) => {
  try {
    console.log(`createSubmissionWithId: writing submission to submissions/${docId}...`);
    const docRef = doc(db, "submissions", docId);
    await setDoc(docRef, {
      ...submissionPayload,
      submittedAt: Timestamp.now(),
    });
    console.log("createSubmissionWithId: setDoc resolved successfully!");
    return docId;
  } catch (error) {
    console.error("createSubmissionWithId failed:", error);
    throw new Error(`Gagal menyimpan submission: ${error.message}`);
  }
};

export const getSubmissionById = async (submissionId) => {
  try {
    const snap = await getDoc(doc(db, "submissions", submissionId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    throw new Error(`Gagal memuat hasil: ${error.message}`);
  }
};

export const deleteSubmission = async (submissionId) => {
  try {
    const subRef = doc(db, "submissions", submissionId);
    const subSnap = await getDoc(subRef);
    if (!subSnap.exists()) {
      throw new Error("Hasil ujian tidak ditemukan.");
    }
    const subData = subSnap.data();
    const examId = subData.examId;
    const userId = subData.userId;

    const deletePromises = [deleteDoc(subRef)];

    if (examId && userId) {
      const attemptId = `${examId}_${userId}`;
      deletePromises.push(deleteDoc(doc(db, "exam_attempts", attemptId)));
    }

    await Promise.all(deletePromises);
  } catch (error) {
    throw new Error(`Gagal menghapus hasil pengerjaan: ${error.message}`);
  }
};

export const deleteExam = async (examId) => {
  try {
    // 1. Ambil dokumen ujian untuk mendapatkan daftar questionIds
    const examDocRef = doc(db, "exams", examId);
    const examSnap = await getDoc(examDocRef);
    if (!examSnap.exists()) {
      throw new Error("Ujian tidak ditemukan.");
    }
    const examData = examSnap.data();
    const questionIds = examData.questionIds || [];

    // 2. Ambil seluruh dokumen soal secara paralel
    const qDocRefs = questionIds.map((qId) => doc(db, "questions", qId));
    const qSnaps = await Promise.all(qDocRefs.map((ref) => getDoc(ref)));

    const deletePromises = [];

    // 3. Siapkan penghapusan gambar dari storage & dokumen soal
    for (const qSnap of qSnaps) {
      if (qSnap.exists()) {
        const qData = qSnap.data();
        const content = qData.content || "";

        // Deteksi seluruh URL Firebase Storage di dalam konten HTML soal
        // Pola: https://firebasestorage.googleapis.com/v0/b/[bucket]/o/[encodedPath]?alt=media...
        const storageUrls = content.match(/https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?"]+)/g);
        if (storageUrls) {
          for (const url of storageUrls) {
            const pathMatch = url.match(/\/o\/([^?"]+)/);
            if (pathMatch) {
              const encodedPath = pathMatch[1];
              const storagePath = decodeURIComponent(encodedPath);
              const storageRef = ref(storage, storagePath);
              
              // Hapus berkas gambar dari Firebase Storage
              deletePromises.push(
                deleteObject(storageRef).catch((storageErr) => {
                  console.error("Gagal menghapus gambar saat pembersihan otomatis:", storageErr);
                })
              );
            }
          }
        }

        // Hapus dokumen soal dari Firestore
        deletePromises.push(deleteDoc(doc(db, "questions", qSnap.id)));
      }
    }

    // 4. Dapatkan & hapus data submissions dan exam_attempts terkait secara paralel
    const submissionsQuery = query(submissionsCol, where("examId", "==", examId));
    const attemptsQuery = query(examAttemptsCol, where("examId", "==", examId));

    const [submissionsSnap, attemptsSnap] = await Promise.all([
      getDocs(submissionsQuery),
      getDocs(attemptsQuery)
    ]);

    submissionsSnap.docs.forEach((d) => deletePromises.push(deleteDoc(d.ref)));
    attemptsSnap.docs.forEach((d) => deletePromises.push(deleteDoc(d.ref)));

    // 5. Tambahkan penghapusan dokumen ujian utama dan kunci jawaban
    deletePromises.push(deleteDoc(examDocRef));
    deletePromises.push(deleteDoc(doc(db, "exam_keys", examId)));

    // 6. Jalankan seluruh proses penghapusan secara paralel
    await Promise.all(deletePromises);
    console.log(`Berhasil melakukan pembersihan dan menghapus ujian: ${examId}`);
  } catch (error) {
    throw new Error(`Gagal menghapus ujian dan melakukan pembersihan: ${error.message}`);
  }
};

export const initializeExamAttempt = async (examId, userId, email, durationMinutes, questionIds = null) => {
  try {
    const attemptId = `${examId}_${userId}`;
    const attemptRef = doc(db, "exam_attempts", attemptId);
    const snap = await getDoc(attemptRef);

    if (snap.exists()) {
      const attemptData = snap.data();
      // Jika statusnya sudah selesai (submitted), buat ulang sesi ujian yang baru (fresh retake)
      if (attemptData.status !== "submitted") {
        return attemptData;
      }
    }

    const durationSeconds = durationMinutes * 60;
    const endTime = Date.now() + durationSeconds * 1000;

    const data = {
      examId,
      userId,
      email,
      startedAt: new Date().toISOString(),
      endTime,
      extraMinutes: 0,
      status: "ongoing",
      cheatingCount: 0,
      cheatingLogs: []
    };

    if (questionIds) {
      data.questionIds = questionIds;
    }

    await setDoc(attemptRef, data);
    return data;
  } catch (error) {
    throw new Error(`Gagal menginisialisasi pengerjaan ujian: ${error.message}`);
  }
};

export const getExamAttempt = async (examId, userId) => {
  try {
    console.log(`getExamAttempt: fetching attempt for ${examId}_${userId}...`);
    const attemptId = `${examId}_${userId}`;
    const snap = await getDoc(doc(db, "exam_attempts", attemptId));
    console.log(`getExamAttempt: snap.exists = ${snap.exists()}`);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.error("Gagal mengambil attempt:", error);
    return null;
  }
};

export const addExtraTime = async (examId, userId, minutes) => {
  try {
    const attemptId = `${examId}_${userId}`;
    const attemptRef = doc(db, "exam_attempts", attemptId);
    const snap = await getDoc(attemptRef);
    if (!snap.exists()) return;

    const currentEndTime = snap.data().endTime;
    const newEndTime = currentEndTime + (minutes * 60 * 1000);

    await updateDoc(attemptRef, {
      endTime: newEndTime,
      extraMinutes: increment(minutes)
    });
  } catch (error) {
    throw new Error(`Gagal menambah waktu kompensasi: ${error.message}`);
  }
};

export const updateExamAttemptStatus = async (examId, userId, status) => {
  try {
    console.log(`updateExamAttemptStatus: updating status of ${examId}_${userId} to ${status}...`);
    const attemptId = `${examId}_${userId}`;
    const attemptRef = doc(db, "exam_attempts", attemptId);
    await updateDoc(attemptRef, { status });
    console.log("updateExamAttemptStatus: updateDoc resolved successfully!");
  } catch (error) {
    console.error("Gagal memperbarui status pengerjaan:", error);
  }
};

export const updateExamAttemptAnswers = async (examId, userId, answers) => {
  try {
    const attemptId = `${examId}_${userId}`;
    const attemptRef = doc(db, "exam_attempts", attemptId);
    await updateDoc(attemptRef, { answersByQuestionId: answers });
  } catch (error) {
    console.error("Gagal memperbarui jawaban pengerjaan:", error);
    throw error;
  }
};

export const logCheatingAttempt = async (examId, userId, eventName) => {
  try {
    const attemptId = `${examId}_${userId}`;
    const attemptRef = doc(db, "exam_attempts", attemptId);
    const snap = await getDoc(attemptRef);
    if (!snap.exists()) return null;

    const currentData = snap.data();
    const newCount = (currentData.cheatingCount || 0) + 1;
    
    const newLogEntry = {
      timestamp: new Date().toISOString(),
      event: eventName
    };

    const updates = {
      cheatingCount: newCount,
      cheatingLogs: arrayUnion(newLogEntry)
    };

    if (newCount >= 3) {
      updates.status = "blocked";
    }

    await updateDoc(attemptRef, updates);
    return { cheatingCount: newCount, status: updates.status || currentData.status };
  } catch (error) {
    console.error("Gagal mencatat pelanggaran kecurangan:", error);
    throw error;
  }
};

export const blockStudentAttempt = async (examId, userId) => {
  try {
    const attemptId = `${examId}_${userId}`;
    const attemptRef = doc(db, "exam_attempts", attemptId);
    await updateDoc(attemptRef, { status: "blocked" });
  } catch (error) {
    throw new Error(`Gagal memblokir siswa secara manual: ${error.message}`);
  }
};

export const unblockStudentAttempt = async (examId, userId) => {
  try {
    const attemptId = `${examId}_${userId}`;
    const attemptRef = doc(db, "exam_attempts", attemptId);
    await updateDoc(attemptRef, {
      status: "ongoing",
      cheatingCount: 0
    });

    // Hapus submission terblokir sementara (jika ada) agar tidak terjadi duplikasi data saat dilanjutkan
    const q = query(
      submissionsCol,
      where("examId", "==", examId),
      where("userId", "==", userId),
      where("isBlocked", "==", true)
    );
    const snap = await getDocs(q);
    const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  } catch (error) {
    throw new Error(`Gagal membuka blokir siswa secara manual: ${error.message}`);
  }
};

export const streamExamAttempt = (examId, userId, callback) => {
  const attemptId = `${examId}_${userId}`;
  return onSnapshot(doc(db, "exam_attempts", attemptId), (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data());
    }
  });
};

export const streamActiveExamAttempts = (callback) => {
  const q = query(examAttemptsCol, where("status", "in", ["ongoing", "blocked"]));
  return onSnapshot(q, (querySnap) => {
    const attempts = [];
    querySnap.forEach((doc) => {
      attempts.push({ id: doc.id, ...doc.data() });
    });
    callback(attempts);
  });
};

export const streamAllSubmissions = (callback) => {
  return onSnapshot(submissionsCol, (querySnap) => {
    const submissions = [];
    querySnap.forEach((doc) => {
      submissions.push({ id: doc.id, ...doc.data() });
    });
    // Urutkan berdasarkan waktu diserahkan (submittedAt) terbaru
    submissions.sort((a, b) => {
      const timeA = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
      const timeB = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
      return timeB - timeA;
    });
    callback(submissions);
  });
};

export const updateSubmission = async (submissionId, data) => {
  try {
    await updateDoc(doc(db, "submissions", submissionId), data);
  } catch (error) {
    throw new Error(`Gagal memperbarui data hasil ujian: ${error.message}`);
  }
};

export const streamSubmission = (submissionId, callback, errorCallback) => {
  return onSnapshot(
    doc(db, "submissions", submissionId),
    (docSnap) => {
      if (docSnap.exists()) {
        callback({ id: docSnap.id, ...docSnap.data() });
      } else {
        callback(null);
      }
    },
    (error) => {
      if (errorCallback) {
        errorCallback(error);
      } else {
        console.error("Error streaming submission:", error);
      }
    }
  );
};

export const updateQuestion = async (qId, questionPayload) => {
  try {
    await setDoc(doc(db, "questions", qId), {
      ...questionPayload,
      updatedAt: Timestamp.now()
    }, { merge: true });
  } catch (error) {
    throw new Error(`Gagal memperbarui soal: ${error.message}`);
  }
};

export const deleteQuestion = async (qId) => {
  try {
    await deleteDoc(doc(db, "questions", qId));
  } catch (error) {
    throw new Error(`Gagal menghapus soal: ${error.message}`);
  }
};

export const updateExamQuestionList = async (examId, questionIds) => {
  try {
    await updateDoc(doc(db, "exams", examId), {
      questionIds: questionIds,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    throw new Error(`Gagal memperbarui daftar soal ujian: ${error.message}`);
  }
};

export const updateExamDetails = async (examId, examData) => {
  try {
    await updateDoc(doc(db, "exams", examId), {
      ...examData,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    throw new Error(`Gagal memperbarui detail ujian: ${error.message}`);
  }
};

export const listStudents = async () => {
  try {
    const q = query(usersCol, where("role", "==", "siswa"));
    const snap = await getDocs(q);
    return snap.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  } catch (error) {
    throw new Error(`Gagal memuat daftar siswa: ${error.message}`);
  }
};

export const deleteUserProfile = async (uid) => {
  try {
    await deleteDoc(doc(db, "users", uid));
  } catch (error) {
    throw new Error(`Gagal menghapus profil user: ${error.message}`);
  }
};

export const getQuestionsByIds = async (questionIds) => {
  if (!questionIds || questionIds.length === 0) return [];
  try {
    const chunks = [];
    for (let i = 0; i < questionIds.length; i += 30) {
      chunks.push(questionIds.slice(i, i + 30));
    }
    const promises = chunks.map(async (chunk) => {
      const q = query(questionsCol, where(documentId(), "in", chunk));
      const snap = await getDocs(q);
      return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    });
    const results = await Promise.all(promises);
    const questionsList = results.flat();
    const questionsMap = new Map();
    questionsList.forEach((q) => questionsMap.set(q.id, q));
    return questionIds
      .map((qId) => questionsMap.get(qId))
      .filter((q) => q !== undefined);
  } catch (error) {
    throw new Error(`Gagal memuat soal: ${error.message}`);
  }
};

export const resetUserSession = async (uid) => {
  try {
    await updateDoc(doc(db, "users", uid), {
      sessionId: null,
      lastActiveAt: null,
    });
  } catch (error) {
    throw new Error(`Gagal me-reset sesi user: ${error.message}`);
  }
};

export const getSubmissionsForUser = async (userId) => {
  try {
    const q = query(submissionsCol, where("userId", "==", userId));
    const snap = await getDocs(q);
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    throw new Error(`Gagal memuat riwayat pengumpulan siswa: ${error.message}`);
  }
};

export const getExamAttemptsForUser = async (userId) => {
  try {
    const q = query(examAttemptsCol, where("userId", "==", userId));
    const snap = await getDocs(q);
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    throw new Error(`Gagal memuat status pengerjaan siswa: ${error.message}`);
  }
};

export const getExamKeys = async (examId) => {
  try {
    console.log(`getExamKeys: fetching keys for ${examId}...`);
    const snap = await getDoc(doc(db, "exam_keys", examId));
    console.log(`getExamKeys: snap.exists = ${snap.exists()}`);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.error("getExamKeys failed:", error);
    throw new Error(`Gagal memuat kunci jawaban: ${error.message}`);
  }
};

export const saveExamKeys = async (examId, keysPayload) => {
  try {
    await setDoc(doc(db, "exam_keys", examId), keysPayload);
  } catch (error) {
    throw new Error(`Gagal menyimpan kunci jawaban: ${error.message}`);
  }
};





