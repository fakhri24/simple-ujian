import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import { requireRole } from "../rbac.js";
import { createExamEngine } from "../examEngine.js";
import {
  getExamWithQuestions,
  findSubmission,
  createSubmission,
  createSubmissionWithId,
  initializeExamAttempt,
  streamExamAttempt,
  updateExamAttemptStatus,
  logCheatingAttempt,
  getExamAttempt,
  updateExamAttemptAnswers,
  getExamKeys,
} from "../db.js";
import { renderQuestion } from "../questionRenderer.js";
import { calculateScore } from "../scoring.js";
import { ensureSEBClearance } from "../seb-validate.js";

const parseDate = (val) => {
  if (!val) return null;
  if (typeof val.toDate === "function") {
    return val.toDate();
  }
  if (typeof val.seconds === "number") {
    return new Date(val.seconds * 1000);
  }
  return new Date(val);
};

const titleEl = document.querySelector("#exam-title");
const progressEl = document.querySelector("#question-progress");
const containerEl = document.querySelector("#question-container");
const feedbackEl = document.querySelector("#exam-feedback");
const timerEl = document.querySelector("#exam-timer");
const prevBtn = document.querySelector("#prev-btn");
const nextBtn = document.querySelector("#next-btn");
const submitBtn = document.querySelector("#submit-btn");
const flagBtn = document.querySelector("#flag-btn");
const mapContainerEl = document.querySelector("#question-map");
const examLayoutEl = document.querySelector(".exam-layout");
const toggleMapBtn = document.querySelector("#toggle-map-btn");
const sidebarMapBody = document.querySelector("#sidebar-map-body");

let unsubscribeAttemptFn = null;
let hasSubmitted = false;
let isSystemPopupOpen = false;

// Tombol "Selesai" baru aktif saat sisa waktu <= ambang ini (anti-submit terlalu dini).
const MIN_REMAINING_TO_SUBMIT_SECONDS = 15 * 60;

const hideGlobalLoading = () => {
  const globalLoading = document.querySelector("#global-loading-screen");
  if (globalLoading) {
    globalLoading.style.opacity = "0";
    globalLoading.style.visibility = "hidden";
    setTimeout(() => {
      globalLoading.remove();
    }, 400);
  }
};

const showFatalError = (title, message) => {
  try {
    // Hide top bar
    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.style.display = "none";
    
    // Hide sidebar
    const sidebar = document.querySelector(".exam-sidebar");
    if (sidebar) sidebar.style.display = "none";
    
    // Hide feedback/footnote
    if (feedbackEl) feedbackEl.style.display = "none";

    // Hide q-meta (Soal 0/0)
    const qMeta = document.querySelector(".q-meta");
    if (qMeta) qMeta.style.display = "none";

    // Adjust card and exam-main height so it doesn't stretch
    const examMain = document.querySelector(".exam-main");
    if (examMain) {
      examMain.style.height = "auto";
      examMain.style.flex = "none";
      examMain.style.width = "100%";
    }

    if (containerEl) {
      const card = containerEl.closest(".card");
      if (card) {
        card.style.flex = "none";
        card.style.height = "auto";
      }
      
      // Update containerEl to show a nice premium card
      containerEl.innerHTML = `
        <div style="text-align: center; padding: 3rem 2rem; color: #64748b; font-family: 'Outfit', sans-serif;">
          <div style="font-size: 4rem; margin-bottom: 1.5rem;">⚠️</div>
          <div style="font-weight: 800; font-size: 1.8rem; color: var(--danger); margin-bottom: 1rem;">${title}</div>
          <p style="font-size: 1.05rem; color: #64748b; max-width: 460px; margin: 0 auto 2.5rem auto; line-height: 1.7;">
            ${message}
          </p>
          <a href="/pages/student.html" class="link-btn" style="text-decoration: none; padding: 0.85rem 2rem; font-size: 1rem; border-radius: 12px;">Kembali ke Dashboard</a>
        </div>
      `;
    }

    // Change layout of main container to be a single centered column
    const examLayout = document.querySelector(".exam-layout");
    if (examLayout) {
      examLayout.style.gridTemplateColumns = "1fr";
      examLayout.style.maxWidth = "600px";
      examLayout.style.margin = "0 auto";
      examLayout.style.display = "flex";
      examLayout.style.justifyContent = "center";
      examLayout.style.alignItems = "center";
      examLayout.style.height = "100vh";
    }

    // Hide action buttons
    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
    if (submitBtn) submitBtn.style.display = "none";
    if (flagBtn) flagBtn.style.display = "none";
  } catch (err) {
    console.error("Kesalahan saat merender fatal error:", err);
  } finally {
    hideGlobalLoading();
  }
};

const showToastNotification = (message, type = "info") => {
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.style.position = "fixed";
  toast.style.bottom = "24px";
  toast.style.right = "24px";
  
  if (type === "warning") {
    toast.style.background = "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)";
    toast.style.boxShadow = "0 10px 25px rgba(225, 29, 72, 0.3)";
  } else {
    toast.style.background = "linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)";
    toast.style.boxShadow = "0 10px 25px rgba(79, 70, 229, 0.3)";
  }

  toast.style.color = "white";
  toast.style.padding = "1rem 1.5rem";
  toast.style.borderRadius = "12px";
  toast.style.zIndex = "9999";
  toast.style.fontFamily = "'Outfit', sans-serif";
  toast.style.fontWeight = "600";
  toast.style.fontSize = "0.95rem";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.gap = "0.75rem";
  toast.style.animation = "slideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)";
  
  const icon = type === "warning" ? "⚠️" : "🔔";
  toast.innerHTML = `
    <span style="font-size: 1.2rem;">${icon}</span>
    <span>${message}</span>
  `;

  if (!document.querySelector("#toast-keyframes")) {
    const style = document.createElement("style");
    style.id = "toast-keyframes";
    style.innerHTML = `
      @keyframes slideIn {
        from { transform: translateY(100px) scale(0.9); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }
      @keyframes fadeOut {
        from { transform: translateY(0) scale(1); opacity: 1; }
        to { transform: translateY(20px) scale(0.9); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "fadeOut 0.3s forwards";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 6000);
};

const isQuestionAnswered = (question, answers) => {
  const ans = answers[question.id];
  if (ans === undefined || ans === null) {
    return false;
  }
  if (question.type === "essay") {
    return String(ans || "").trim().length > 0;
  }
  if (question.type === "pgk") {
    return Array.isArray(ans) && ans.length > 0;
  }
  if (question.type === "tf_matrix") {
    return (question.statements || []).every((stmt) => ans[stmt.id]);
  }
  if (question.type === "match") {
    return (question.matchPairs || []).every((pair) => ans[pair.left]);
  }
  return String(ans).trim().length > 0;
};

const params = new URLSearchParams(window.location.search);
const examId = params.get("examId");

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const preloadImages = async (questions, feedbackElement) => {
  const imageUrls = new Set();
  const srcRegex = /src=["'](https?:\/\/[^"']+)["']/gi;

  questions.forEach((q) => {
    if (q.content) {
      const matches = [...q.content.matchAll(srcRegex)];
      matches.forEach((match) => imageUrls.add(match[1]));
    }
    if (q.options && Array.isArray(q.options)) {
      q.options.forEach((opt) => {
        if (opt.text) {
          const matches = [...opt.text.matchAll(srcRegex)];
          matches.forEach((match) => imageUrls.add(match[1]));
        }
      });
    }
  });

  const urls = Array.from(imageUrls);
  if (urls.length === 0) {
    return;
  }

  if (feedbackElement) {
    feedbackElement.textContent = `Mengunduh gambar soal (0/${urls.length})...`;
  }

  let loadedCount = 0;
  const promises = urls.map((url) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        loadedCount++;
        if (feedbackElement) {
          feedbackElement.textContent = `Mengunduh gambar soal (${loadedCount}/${urls.length})...`;
        }
        resolve();
      };
      img.onerror = () => {
        loadedCount++;
        if (feedbackElement) {
          feedbackElement.textContent = `Mengunduh gambar soal (${loadedCount}/${urls.length})...`;
        }
        resolve();
      };
      img.src = url;
    });
  });

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(resolve, 10000); // 10 seconds limit
  });

  await Promise.race([Promise.all(promises), timeoutPromise]);
};

const reorderQuestions = (questionsList, questionIdsOrder) => {
  if (!questionIdsOrder || !questionIdsOrder.length) return questionsList;
  const questionMap = new Map(questionsList.map((q) => [q.id, q]));
  const ordered = [];
  questionIdsOrder.forEach((id) => {
    if (questionMap.has(id)) {
      ordered.push(questionMap.get(id));
      questionMap.delete(id);
    }
  });
  // Append any questions that might not be in the order list (just in case)
  questionMap.forEach((q) => {
    ordered.push(q);
  });
  return ordered;
};

const bootstrap = async () => {
  try {
    const access = await requireRole("siswa");
    if (!access) {
      return;
    }

    if (!examId) {
      showFatalError("Parameter Tidak Valid", "ID Ujian tidak ditemukan di URL.");
      return;
    }

    const userId = access.user.uid;
    let loaded = null;

    if (navigator.onLine) {
      try {
        loaded = await getExamWithQuestions(examId);
        if (loaded) {
          localStorage.setItem(`simpleUjian:cache:examData:${examId}`, JSON.stringify(loaded));
        }
      } catch (err) {
        console.error("Gagal memuat ujian dari server, mencoba membaca dari cache lokal:", err);
        loaded = JSON.parse(localStorage.getItem(`simpleUjian:cache:examData:${examId}`) || "null");
        if (!loaded) {
          showFatalError("Gagal Memulai Ujian", `Koneksi internet terputus dan tidak ada cache lokal data ujian: ${err.message}`);
          return;
        }
      }
    } else {
      console.log("Offline. Membaca data ujian dari cache lokal.");
      loaded = JSON.parse(localStorage.getItem(`simpleUjian:cache:examData:${examId}`) || "null");
      if (!loaded) {
        showFatalError("Ujian Tidak Dapat Diakses", "Koneksi internet terputus dan data ujian tidak ditemukan di cache lokal.");
        return;
      }
    }

    if (!loaded || !loaded.questions.length) {
      showFatalError("Ujian Tidak Dapat Diakses", "Ujian ini belum memiliki soal atau tidak ditemukan di sistem. Silakan hubungi guru atau administrator Anda.");
      return;
    }

    const { exam, questions } = loaded;
    titleEl.textContent = exam.title;

    // Direct access check for private exams
    if (exam.visibility === "private" && !(exam.assignedTo || []).includes(userId)) {
      showFatalError("Akses Ditolak", "Anda tidak memiliki akses ke ujian ini.");
      return;
    }

    // Periksa apakah pengerjaan hanya sekali dan sudah dikerjakan sebelumnya
    const allowMultipleAttempts = exam.allowMultipleAttempts ?? true;
    if (!allowMultipleAttempts) {
      const existingSubmission = await findSubmission(examId, userId);
      if (existingSubmission) {
        showFatalError("Akses Ujian Ditutup", "Anda sudah menyelesaikan ujian ini dan batas pengerjaan adalah satu kali.");
        return;
      }
    }

    feedbackEl.textContent = "Memverifikasi sesi ujian...";
    const attempt = await getExamAttempt(examId, userId);

    if (attempt && attempt.status === "blocked") {
      showFatalError("Akses Ujian Diblokir", "Akses ujian Anda telah diblokir oleh Guru/Admin karena terdeteksi melakukan kecurangan.");
      return;
    }

    // Bersihkan residu penyimpanan lokal dari pengerjaan sebelumnya jika status di server sudah dikumpulkan
    if (attempt && attempt.status === "submitted") {
      localStorage.removeItem(`simpleUjian:attempt:${userId}:${examId}`);
      localStorage.removeItem(`simpleUjian:timer:${userId}:${examId}`);
      localStorage.removeItem(`simpleUjian:endTime:${userId}:${examId}`);
      localStorage.removeItem(`simpleUjian:submitPending:${userId}:${examId}`);
      localStorage.removeItem(`simpleUjian:voluntarySubmit:${userId}:${examId}`);
    }

    const isSubmitPending = localStorage.getItem(`simpleUjian:submitPending:${userId}:${examId}`) === "true";
    const hasOngoingAttempt = attempt && attempt.status === "ongoing" && Date.now() < attempt.endTime;
    const hasExpiredOngoingAttempt = attempt && attempt.status === "ongoing" && Date.now() >= attempt.endTime;

    const now = Date.now();
    const startTime = parseDate(exam.startTime);
    const latestStartTime = parseDate(exam.latestStartTime);

    if (!hasOngoingAttempt && !hasExpiredOngoingAttempt && !isSubmitPending) {
      if (startTime && now < startTime.getTime()) {
        const startTimeStr = startTime.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
        showFatalError("Akses Ujian Ditutup", `Ujian ini belum dibuka. Anda baru dapat mengaksesnya pada ${startTimeStr}.`);
        return;
      }
      if (latestStartTime && now > latestStartTime.getTime()) {
        showFatalError("Akses Ujian Ditutup", "Batas akhir waktu pengerjaan untuk mulai masuk ujian ini telah berakhir.");
        return;
      }

      // Gerbang Config Key SEB: hanya untuk skenario mulai-baru (bukan resume).
      // Untuk ujian yang requireSEB, ini me-reload sekali (menaruh nonce di URL)
      // lalu memverifikasi config; tiket exam_clearance dibutuhkan oleh rules
      // saat membuat exam_attempts.
      feedbackEl.textContent = "Memeriksa keamanan Safe Exam Browser...";
      const clearance = await ensureSEBClearance(examId, exam);
      if (!clearance.ok) {
        showFatalError("Konfigurasi SEB Tidak Sah", clearance.reason || "Tidak dapat memverifikasi Safe Exam Browser.");
        return;
      }
      feedbackEl.textContent = "";
    }

    let attemptData = hasOngoingAttempt ? attempt : null;
    let activeQuestions = [...questions];
    if (attemptData && attemptData.questionIds) {
      activeQuestions = reorderQuestions(questions, attemptData.questionIds);
    } else if ((hasExpiredOngoingAttempt || isSubmitPending) && attempt && attempt.questionIds) {
      activeQuestions = reorderQuestions(questions, attempt.questionIds);
    }

    // Preload all question images in the background (non-blocking)
    preloadImages(activeQuestions, null).catch(err => console.error("Gagal melakukan preloading gambar:", err));

    feedbackEl.textContent = "";

    if (hasExpiredOngoingAttempt || isSubmitPending) {
      hideGlobalLoading();

      const submittingOverlay = document.querySelector("#submitting-overlay");
      const submittingStatus = document.querySelector("#submitting-status");
      if (submittingOverlay) {
        submittingOverlay.classList.remove("hidden");
        submittingOverlay.setAttribute("aria-hidden", "false");
        if (submittingStatus) {
          submittingStatus.innerHTML = isSubmitPending
            ? "Mengirimkan seluruh jawaban Anda yang tertunda..."
            : "Waktu ujian telah berakhir. Mengirimkan seluruh jawaban Anda...";
        }
      }

      const attemptKey = `simpleUjian:attempt:${userId}:${exam.id}`;
      const savedAttempt = JSON.parse(localStorage.getItem(attemptKey) || "{}");
      const mergedAnswers = {
        ...(attempt ? (attempt.answersByQuestionId || {}) : {}),
        ...(savedAttempt.answersByQuestionId || {})
      };

      const mockEngine = {
        answers: mergedAnswers,
        unansweredCount: () => 0,
        stop: () => {},
        clearStorage: () => {
          localStorage.removeItem(attemptKey);
          localStorage.removeItem(`simpleUjian:timer:${userId}:${exam.id}`);
          localStorage.removeItem(`simpleUjian:endTime:${userId}:${exam.id}`);
          localStorage.removeItem(`simpleUjian:submitPending:${userId}:${exam.id}`);
          localStorage.removeItem(`simpleUjian:voluntarySubmit:${userId}:${exam.id}`);
        }
      };

      try {
        await submitExam({
          engine: mockEngine,
          questions: activeQuestions,
          exam,
          userId,
          email: access.user.email || "siswa@simple.ujian",
          force: true
        });
      } catch (err) {
        showFatalError("Gagal Mengirim Jawaban", `Sistem gagal mengirimkan jawaban Anda: ${err.message || "Kesalahan tidak dikenal."}`);
      }
      return;
    }

    let currentEndTime = attemptData ? attemptData.endTime : null;
    hasSubmitted = false;

    // ── INISIALISASI ELEMEN ANTI-CHEAT ────────────────────────
    const startOverlay = document.createElement("div");
    startOverlay.className = "anti-cheat-overlay";
    startOverlay.innerHTML = `
      <div class="anti-cheat-card">
        <div class="anti-cheat-icon">🛡️</div>
        <h2 class="anti-cheat-title">Keamanan Ujian Aktif</h2>
        <p class="anti-cheat-desc">Ujian ini menerapkan sistem pengawasan terintegrasi. Anda wajib berada dalam <strong>Mode Layar Penuh (Fullscreen)</strong>. Jika Anda mencoba keluar, tab dipindahkan, atau fokus layar hilang, pelanggaran akan dicatat.</p>
        <button type="button" class="anti-cheat-btn" id="start-fs-btn">Mulai & Aktifkan Layar Penuh</button>
      </div>
    `;
    document.body.appendChild(startOverlay);

    const lockOverlay = document.createElement("div");
    lockOverlay.className = "anti-cheat-overlay hidden";
    lockOverlay.innerHTML = `
      <div class="anti-cheat-card">
        <div class="anti-cheat-icon">🚨</div>
        <h2 class="anti-cheat-title">Layar Ujian Terkunci</h2>
        <p class="anti-cheat-desc">Anda terdeteksi keluar dari Mode Layar Penuh! Hal ini dicatat sebagai pelanggaran. Silakan klik tombol di bawah untuk kembali ke ujian.</p>
        <button type="button" class="anti-cheat-btn" id="resume-fs-btn">Kembali ke Layar Penuh</button>
      </div>
    `;
    document.body.appendChild(lockOverlay);

    // Kunci konten agar tidak bisa seleksi teks
    containerEl.classList.add("user-select-none");

    const enterFullscreen = async () => {
      try {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
      } catch (err) {
        console.error("Gagal masuk mode fullscreen:", err);
      }
    };

    let lastCheatingLogTime = 0;
    const CHEATING_COOLDOWN_MS = 1500; // Cooldown 1.5 detik agar tindakan keluar tunggal tidak terhitung ganda

    const triggerCheatingViolation = async (eventName) => {
      const now = Date.now();
      if (now - lastCheatingLogTime < CHEATING_COOLDOWN_MS) {
        console.log(`Pelanggaran "${eventName}" diabaikan karena masuk masa cooldown.`);
        return;
      }
      lastCheatingLogTime = now;

      try {
        await logCheatingAttempt(examId, userId, eventName);
        
        let displayMessage = "Pelanggaran dicatat!";
        if (eventName === "Keluar dari Mode Layar Penuh") {
          displayMessage = "Pelanggaran dicatat: Keluar dari Layar Penuh!";
        } else if (eventName === "Membuka Tab Baru / Pindah Aplikasi") {
          displayMessage = "Pelanggaran dicatat: Meninggalkan tab ujian!";
        } else if (eventName === "Kehilangan Fokus Browser") {
          displayMessage = "Pelanggaran dicatat: Browser kehilangan fokus!";
        }
        
        showToastNotification(displayMessage, "warning");
      } catch (err) {
        console.error("Gagal mencatat pelanggaran:", err);
      }
    };

    let isMonitoringActive = false;

    const startAntiCheatMonitoring = () => {
      if (isMonitoringActive) return;
      isMonitoringActive = true;

      // 1. Deteksi Layar Penuh
      const onFullscreenChange = async () => {
        if (!startOverlay.classList.contains("hidden")) return;
        
        const isFS = document.fullscreenElement || document.webkitFullscreenElement;
        if (!isFS && !hasSubmitted) {
          lockOverlay.classList.remove("hidden");
          await triggerCheatingViolation("Keluar dari Mode Layar Penuh");
        }
      };
      document.addEventListener("fullscreenchange", onFullscreenChange);
      document.addEventListener("webkitfullscreenchange", onFullscreenChange);

      // 2. Deteksi Perpindahan Tab
      const onVisibilityChange = async () => {
        if (document.visibilityState === "hidden" && !hasSubmitted) {
          await triggerCheatingViolation("Membuka Tab Baru / Pindah Aplikasi");
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);

      // 3. Deteksi Kehilangan Fokus Window
      const onWindowBlur = async () => {
        if (!hasSubmitted && !isSystemPopupOpen) {
          await triggerCheatingViolation("Kehilangan Fokus Browser");
        }
      };
      window.addEventListener("blur", onWindowBlur);

      // 4. Pembatasan Klik Kanan & Seleksi
      document.addEventListener("contextmenu", (e) => e.preventDefault());
      document.addEventListener("selectstart", (e) => e.preventDefault());
      document.addEventListener("copy", (e) => e.preventDefault());
      document.addEventListener("paste", (e) => e.preventDefault());

      // 5. Pembatasan Shortcut Keyboard
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "c") {
          e.preventDefault();
          showToastNotification("Menyalin teks dinonaktifkan demi keamanan!", "warning");
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "v") {
          e.preventDefault();
          showToastNotification("Menempel jawaban luar dinonaktifkan!", "warning");
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "a") {
          e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "u") {
          e.preventDefault();
        }
        if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "I") || ((e.ctrlKey || e.metaKey) && e.altKey && e.key === "i")) {
          e.preventDefault();
          showToastNotification("Akses Developer Tools dinonaktifkan!", "warning");
        }
      });
    };

    let engine = null;

    const startExamEngine = (sessionAttemptData) => {
      currentEndTime = sessionAttemptData.endTime;

      engine = createExamEngine({
        exam,
        questions: activeQuestions,
        userId,
        initialAnswers: sessionAttemptData.answersByQuestionId,
        endTimeOverride: currentEndTime,
        onTimerTick: (seconds) => {
          timerEl.textContent = formatTime(seconds);
          if (submitBtn && !hasSubmitted) {
            const locked = seconds > MIN_REMAINING_TO_SUBMIT_SECONDS;
            submitBtn.disabled = locked;
            submitBtn.classList.toggle("is-locked", locked);
            submitBtn.title = locked
              ? "Tombol Selesai aktif saat sisa waktu ≤ 15 menit"
              : "";
          }
        },
        onTimeUp: async () => {
          if (hasSubmitted) {
            return;
          }
          feedbackEl.textContent =
            "Waktu habis, sistem mengirim jawaban otomatis...";
          
          // Setel bendera kirim tertunda di localStorage
          localStorage.setItem(`simpleUjian:submitPending:${userId}:${exam.id}`, "true");
          localStorage.removeItem(`simpleUjian:voluntarySubmit:${userId}:${exam.id}`);

          try {
            await submitExam({ engine, questions: activeQuestions, exam, userId, email: access.user.email || "siswa@simple.ujian", force: true });
            hasSubmitted = true;
          } catch (err) {
            feedbackEl.textContent = err.message || "Gagal mengirim jawaban otomatis.";
          }
        },
      });

      unsubscribeAttemptFn = streamExamAttempt(examId, userId, async (updatedAttempt) => {
        if (updatedAttempt.status === "blocked") {
          hasSubmitted = true; // Tandai submit = true agar event listener fullscreen/tabchange tidak memicu popup/pelanggaran baru!
          if (unsubscribeAttemptFn) {
            unsubscribeAttemptFn();
          } else {
            setTimeout(() => {
              if (unsubscribeAttemptFn) unsubscribeAttemptFn();
            }, 0);
          }
          engine.stop();

          // Simpan pengerjaan otomatis saat terblokir
          try {
            const examKeys = await getExamKeys(exam.id);
            let mergedQuestions = activeQuestions;
            if (examKeys) {
              const keysMap = examKeys.keys || {};
              mergedQuestions = activeQuestions.map(q => {
                const key = keysMap[q.id];
                if (!key) return q;
                if (q.type === "pg" || q.type === "tf" || q.type === "pgk") {
                  return {
                    ...q,
                    options: q.options.map(opt => ({
                      ...opt,
                      isCorrect: (key.correctOptionIds || []).includes(opt.id)
                    }))
                  };
                } else if (q.type === "tf_matrix") {
                  return {
                    ...q,
                    statements: q.statements.map(stmt => ({
                      ...stmt,
                      isCorrect: key.correctStatements?.[stmt.id] || "false"
                    }))
                  };
                } else if (q.type === "match") {
                  return {
                    ...q,
                    matchPairs: key.matchPairs || []
                  };
                }
                return q;
              });
            }
            const scoreResult = calculateScore(mergedQuestions, engine.answers);
            await createSubmission({
              examId: exam.id,
              userId,
              email: access.user.email || "siswa@simple.ujian",
              examTitle: exam.title,
              answersByQuestionId: engine.answers,
              totalScore: scoreResult.total,
              breakdown: scoreResult.breakdown,
              durationMinutes: Number(exam.durationMinutes || 30),
              isBlocked: true,
            });
          } catch (err) {
            console.error("Gagal menyimpan pengerjaan saat terblokir:", err);
          }

          engine.clearStorage();
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            try {
              if (document.exitFullscreen) document.exitFullscreen();
              else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            } catch (e) {}
          }
          alert("Akses ujian Anda telah diblokir oleh Guru/Admin karena terdeteksi melakukan kecurangan. Jawaban Anda yang sudah terisi telah disimpan otomatis.");
          window.location.replace("/pages/student.html");
          return;
        }

        if (updatedAttempt.endTime && updatedAttempt.endTime !== currentEndTime) {
          const diffMs = updatedAttempt.endTime - currentEndTime;
          const addedMinutes = Math.round(diffMs / 60000);
          
          currentEndTime = updatedAttempt.endTime;
          engine.updateEndTime(updatedAttempt.endTime);

          if (addedMinutes > 0) {
            showToastNotification(`Guru memberikan tambahan waktu kompensasi +${addedMinutes} menit!`);
          } else if (addedMinutes < 0) {
            showToastNotification(`Guru menyesuaikan waktu ujian Anda (${addedMinutes} menit).`);
          }
        }
      });

      draw();
    };

    document.querySelector("#start-fs-btn").addEventListener("click", async () => {
      await enterFullscreen();
      
      if (!attemptData) {
        const startBtn = document.querySelector("#start-fs-btn");
        const originalText = startBtn.textContent;
        startBtn.disabled = true;
        startBtn.textContent = "Menghubungkan...";
        
        try {
          // Shuffle questionIds if randomizeQuestions is true
          let targetQuestionIds = [...exam.questionIds];
          if (exam.randomizeQuestions) {
            for (let i = targetQuestionIds.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [targetQuestionIds[i], targetQuestionIds[j]] = [targetQuestionIds[j], targetQuestionIds[i]];
            }
          }

          attemptData = await initializeExamAttempt(
            examId,
            userId,
            access.user.email || "siswa@simple.ujian",
            Number(exam.durationMinutes || 30),
            targetQuestionIds
          );

          activeQuestions = reorderQuestions(questions, targetQuestionIds);
        } catch (err) {
          startBtn.disabled = false;
          startBtn.textContent = originalText;
          alert(`Gagal memulai ujian: ${err.message}`);
          return;
        }
      }
      
      startOverlay.classList.add("hidden");
      startAntiCheatMonitoring();
      startExamEngine(attemptData);
    });

    document.querySelector("#resume-fs-btn").addEventListener("click", async () => {
      await enterFullscreen();
      lockOverlay.classList.add("hidden");
    });

    const drawQuestionMap = () => {
      if (!mapContainerEl || !engine) return;
      mapContainerEl.innerHTML = activeQuestions
        .map((q, idx) => {
          const isCurrent = idx === engine.index;
          const isAnswered = isQuestionAnswered(q, engine.answers);
          const isFlagged = engine.isFlagged(q.id);
          let stateClass = "";
          if (isCurrent) {
            stateClass = isFlagged ? "active flagged" : "active";
          } else if (isFlagged) {
            stateClass = isAnswered ? "flagged answered" : "flagged";
          } else if (isAnswered) {
            stateClass = "answered";
          }
          return `<button type="button" class="map-btn ${stateClass}" data-index="${idx}">${idx + 1}</button>`;
        })
        .join("");

      mapContainerEl.querySelectorAll(".map-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!engine) return;
          const idx = Number(btn.dataset.index);
          engine.goTo(idx);
          draw();
        });
      });
    };

    let syncTimeout = null;
    const debounceSyncAnswers = (answers) => {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }
      syncTimeout = setTimeout(async () => {
        try {
          await updateExamAttemptAnswers(examId, userId, answers);
        } catch (err) {
          console.error("Gagal sinkronisasi jawaban ke Firestore:", err);
        }
      }, 1000);
    };

    const draw = () => {
      if (!engine) return;
      const current = engine.currentQuestion;
      progressEl.textContent = `Soal ${engine.index + 1}/${engine.total}`;
      prevBtn.disabled = engine.index === 0;
      nextBtn.style.display = engine.index === engine.total - 1 ? "none" : "";

      // Update flag button appearance
      const isFlagged = engine.isFlagged(current.id);
      if (flagBtn) {
        flagBtn.classList.toggle("flagged", isFlagged);
        flagBtn.textContent = isFlagged ? "🚩 Ragu ✓" : "🚩 Ragu";
      }

      renderQuestion({
        container: containerEl,
        question: current,
        currentAnswer: engine.answers[current.id],
        onAnswerChange: (value) => {
          if (!engine) return;
          engine.setAnswer(current.id, value);
          drawQuestionMap();
          debounceSyncAnswers(engine.answers);
        },
      });

      renderMathInElement(containerEl, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ],
        throwOnError: false,
      });

      drawQuestionMap();
    };

    prevBtn.addEventListener("click", () => {
      if (!engine) return;
      engine.prev();
      draw();
    });

    nextBtn.addEventListener("click", () => {
      if (!engine) return;
      engine.next();
      draw();
    });

    if (flagBtn) {
      flagBtn.addEventListener("click", () => {
        if (!engine) return;
        engine.toggleFlag(engine.currentQuestion.id);
        draw();
      });
    }

    const confirmModalEl = document.querySelector("#confirm-modal");
    const confirmModalDesc = document.querySelector("#confirm-modal-desc");
    const confirmCancelBtn = document.querySelector("#confirm-cancel-btn");
    const confirmSubmitBtn = document.querySelector("#confirm-submit-btn");

    submitBtn.addEventListener("click", () => {
      if (!engine || hasSubmitted) return;

      // Cegah submit terlalu dini: tetap blokir meski semua soal sudah dijawab.
      if (engine.remainingSeconds > MIN_REMAINING_TO_SUBMIT_SECONDS) {
        const menitLagi = Math.ceil(
          (engine.remainingSeconds - MIN_REMAINING_TO_SUBMIT_SECONDS) / 60
        );
        feedbackEl.textContent =
          `Belum bisa mengirim. Tombol Selesai aktif saat sisa waktu ≤ 15 menit (sekitar ${menitLagi} menit lagi).`;
        return;
      }

      const unanswered = engine.unansweredCount();
      const flaggedCount = engine.flaggedCount();

      // Build flagged question numbers list
      const flaggedNumbers = [];
      activeQuestions.forEach((q, idx) => {
        if (engine.isFlagged(q.id)) flaggedNumbers.push(idx + 1);
      });

      let descHtml = "";

      if (unanswered > 0) {
        descHtml += `Masih ada <strong>${unanswered}</strong> soal yang belum dijawab. `;
      } else {
        descHtml += `Semua soal telah dijawab. `;
      }

      if (flaggedCount > 0) {
        descHtml += `<br><br><div class="flag-warning-box">⚠️ <strong>${flaggedCount}</strong> soal masih ditandai <strong>Ragu</strong>: Soal nomor ${flaggedNumbers.join(", ")}. Pastikan Anda sudah yakin sebelum mengirim.</div>`;
      }

      descHtml += `<br>Apakah Anda yakin ingin menyelesaikan ujian dan mengirim seluruh jawaban sekarang?`;

      confirmModalDesc.innerHTML = descHtml;

      confirmModalEl.classList.remove("hidden");
      confirmModalEl.setAttribute("aria-hidden", "false");
    });

    confirmCancelBtn.addEventListener("click", () => {
      confirmModalEl.classList.add("hidden");
      confirmModalEl.setAttribute("aria-hidden", "true");
    });

    confirmSubmitBtn.addEventListener("click", async () => {
      confirmModalEl.classList.add("hidden");
      confirmModalEl.setAttribute("aria-hidden", "true");
      
      if (!engine || hasSubmitted) return;
      hasSubmitted = true;

      // Setel bendera kirim tertunda di localStorage
      localStorage.setItem(`simpleUjian:submitPending:${userId}:${exam.id}`, "true");
      localStorage.setItem(`simpleUjian:voluntarySubmit:${userId}:${exam.id}`, "true");

      try {
        await submitExam({ engine, questions: activeQuestions, exam, userId, email: access.user.email || "siswa@simple.ujian", force: true });
      } catch (err) {
        hasSubmitted = false;
        feedbackEl.textContent = err.message || "Gagal mengirim jawaban. Coba lagi.";
      }
    });

    // Sembunyikan global loading screen setelah semua data siap digambar
    hideGlobalLoading();
  } catch (error) {
    showFatalError("Gagal Memulai Ujian", `Terjadi kesalahan saat memuat data ujian: ${error.message || "Kesalahan tidak dikenal."}`);
  }
};

const waitForOnline = () => {
  if (navigator.onLine) {
    console.log("waitForOnline: already online");
    return Promise.resolve();
  }
  console.log("waitForOnline: waiting for online event...");
  return new Promise((resolve) => {
    const onOnline = () => {
      console.log("waitForOnline: online event received, resolving...");
      window.removeEventListener("online", onOnline);
      resolve();
    };
    window.addEventListener("online", onOnline);
  });
};

const submitExam = async ({ engine, questions, exam, userId, email, force }) => {
  const unanswered = engine.unansweredCount();

  if (!force && unanswered > 0) {
    return false;
  }

  hasSubmitted = true; // Tandai submit = true secara instan sebelum membersihkan fullscreen agar tidak terhitung kecurangan!

  // 1. Tampilkan Submitting Overlay
  const submittingOverlay = document.querySelector("#submitting-overlay");
  const submittingStatus = document.querySelector("#submitting-status");
  const offlineWarning = document.querySelector("#offline-submit-warning");
  if (submittingOverlay) {
    submittingOverlay.classList.remove("hidden");
    submittingOverlay.setAttribute("aria-hidden", "false");
  }

  // 2. Setup Status Jaringan
  const updateSubmitStatus = () => {
    if (!navigator.onLine) {
      if (offlineWarning) offlineWarning.style.display = "block";
      if (submittingStatus) {
        submittingStatus.innerHTML = "Koneksi internet terputus. Sistem akan mengirim jawaban otomatis begitu internet kembali terhubung. Mohon jangan menutup halaman ini.";
      }
    } else {
      if (offlineWarning) offlineWarning.style.display = "none";
      if (submittingStatus) {
        submittingStatus.innerHTML = "Sedang menyimpan dan memproses seluruh jawaban Anda ke server...";
      }
    }
  };
  updateSubmitStatus();
  window.addEventListener("online", updateSubmitStatus);
  window.addEventListener("offline", updateSubmitStatus);

  // 3. Setup Beforeunload Peringatan
  const handleBeforeUnloadSubmit = (e) => {
    e.preventDefault();
    e.returnValue = "Jawaban Anda sedang dikirim ke server. Mohon tunggu hingga proses selesai agar nilai Anda tercatat.";
    return e.returnValue;
  };
  window.addEventListener("beforeunload", handleBeforeUnloadSubmit);

  // Bersihkan fullscreen jika sedang aktif saat submit
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } catch (e) {}
  }

  // JIKA OFFLINE, TUNGGU SAMPAI ONLINE SEBELUM MULAI MENGIRIM!
  if (!navigator.onLine) {
    console.warn("Sedang offline. Menunggu koneksi internet...");
    await waitForOnline();
    updateSubmitStatus();
  }

  try {
    // 1. Update status to 'submitted' first so security rules allow reading keys!
    await updateExamAttemptStatus(exam.id, userId, "submitted");

    // Periksa apakah guru menambahkan waktu ujian di server saat siswa offline (hanya jika force timeout)
    const latestAttempt = await getExamAttempt(exam.id, userId);
    const isVoluntary = localStorage.getItem(`simpleUjian:voluntarySubmit:${userId}:${exam.id}`) === "true";
    if (force && !isVoluntary && latestAttempt && Date.now() < latestAttempt.endTime) {
      // Batalkan submit! Kembalikan status menjadi ongoing
      await updateExamAttemptStatus(exam.id, userId, "ongoing");

      // Bersihkan bendera submit pending di localStorage
      localStorage.removeItem(`simpleUjian:submitPending:${userId}:${exam.id}`);
      localStorage.removeItem(`simpleUjian:voluntarySubmit:${userId}:${exam.id}`);

      // Bersihkan listener
      window.removeEventListener("beforeunload", handleBeforeUnloadSubmit);
      window.removeEventListener("online", updateSubmitStatus);
      window.removeEventListener("offline", updateSubmitStatus);

      alert("Guru telah memberikan tambahan waktu! Anda dapat melanjutkan pengerjaan ujian.");
      window.location.reload();
      return false;
    }

    // 2. Fetch correct keys
    const examKeys = await getExamKeys(exam.id);
    let mergedQuestions = questions;
    if (examKeys) {
      const keysMap = examKeys.keys || {};
      mergedQuestions = questions.map(q => {
        const key = keysMap[q.id];
        if (!key) return q;
        if (q.type === "pg" || q.type === "tf" || q.type === "pgk") {
          return {
            ...q,
            options: q.options.map(opt => ({
              ...opt,
              isCorrect: (key.correctOptionIds || []).includes(opt.id)
            }))
          };
        } else if (q.type === "tf_matrix") {
          return {
            ...q,
            statements: q.statements.map(stmt => ({
              ...stmt,
              isCorrect: key.correctStatements?.[stmt.id] || "false"
            }))
          };
        } else if (q.type === "match") {
          return {
            ...q,
            matchPairs: key.matchPairs || []
          };
        }
        return q;
      });
    }

    const scoreResult = calculateScore(mergedQuestions, engine.answers);
    
    // Generate deterministic submission ID based on startedAt of latestAttempt
    const startedAt = latestAttempt?.startedAt || new Date().toISOString();
    const sanitizedStartedAt = startedAt.replace(/[^a-zA-Z0-9]/g, "_");
    const submissionDocId = `sub_${exam.id}_${userId}_${sanitizedStartedAt}`;

    const submissionId = await createSubmissionWithId(submissionDocId, {
      examId: exam.id,
      userId,
      email: email || "siswa@simple.ujian",
      examTitle: exam.title,
      answersByQuestionId: engine.answers,
      totalScore: scoreResult.total,
      breakdown: scoreResult.breakdown,
      durationMinutes: Number(exam.durationMinutes || 30),
    });

    if (unsubscribeAttemptFn) {
      unsubscribeAttemptFn();
    }

    engine.stop();
    engine.clearStorage();

    // Bersihkan bendera submit pending di localStorage
    localStorage.removeItem(`simpleUjian:submitPending:${userId}:${exam.id}`);
    localStorage.removeItem(`simpleUjian:voluntarySubmit:${userId}:${exam.id}`);

    // Sembunyikan Submitting Overlay sebelum lanjut
    if (submittingOverlay) {
      submittingOverlay.classList.remove("hidden");
      submittingOverlay.classList.add("hidden");
      submittingOverlay.setAttribute("aria-hidden", "true");
    }
    // Bersihkan listener
    window.removeEventListener("beforeunload", handleBeforeUnloadSubmit);
    window.removeEventListener("online", updateSubmitStatus);
    window.removeEventListener("offline", updateSubmitStatus);

    const showResults = exam.showResultsImmediately ?? true;
    if (showResults) {
      window.location.replace(`/pages/result.html?submissionId=${submissionId}`);
    } else {
      const congratsModal = document.querySelector("#congrats-modal");
      const congratsOkBtn = document.querySelector("#congrats-ok-btn");
      if (congratsModal && congratsOkBtn) {
        congratsModal.classList.remove("hidden");
        congratsModal.setAttribute("aria-hidden", "false");
        congratsOkBtn.addEventListener("click", () => {
          window.location.replace("/pages/student.html");
        });
      } else {
        window.location.replace("/pages/student.html");
      }
    }
  } catch (err) {
    console.error("Gagal melakukan submit ujian:", err);
    
    // Periksa apakah ini adalah network error (offline, unavailable, dsb)
    const isNetworkError = !navigator.onLine || err.code === "unavailable" || err.code === "unknown" || err.message?.includes("offline") || err.message?.includes("network");
    
    if (isNetworkError) {
      console.warn("Terjadi masalah jaringan saat submit. Menunggu koneksi internet untuk mengulangi pengiriman...");
      // Bersihkan listener sebelumnya agar tidak berlipat ganda
      window.removeEventListener("beforeunload", handleBeforeUnloadSubmit);
      window.removeEventListener("online", updateSubmitStatus);
      window.removeEventListener("offline", updateSubmitStatus);
      
      // Tunggu sampai online dan ulangi submit secara otomatis
      await waitForOnline();
      return submitExam({ engine, questions, exam, userId, email, force });
    }

    // Jika ini adalah error logika fatal (bukan koneksi), bersihkan status agar siswa tidak terkunci selamanya
    feedbackEl.textContent = err.message || "Gagal mengirim jawaban. Coba lagi.";
    hasSubmitted = false;

    localStorage.removeItem(`simpleUjian:submitPending:${userId}:${exam.id}`);
    localStorage.removeItem(`simpleUjian:voluntarySubmit:${userId}:${exam.id}`);

    if (submittingOverlay) {
      submittingOverlay.classList.add("hidden");
      submittingOverlay.setAttribute("aria-hidden", "true");
    }
    window.removeEventListener("beforeunload", handleBeforeUnloadSubmit);
    window.removeEventListener("online", updateSubmitStatus);
    window.removeEventListener("offline", updateSubmitStatus);
    throw err;
  }
  return true;
};

// ── Sidebar Peta Soal: Toggle Collapse / Expand ────────────────────────────

const SIDEBAR_STORAGE_KEY = "exam_sidebar_collapsed";

const initSidebarToggle = () => {
  if (!examLayoutEl || !toggleMapBtn) return;

  const collapsedTab = document.querySelector("#sidebar-collapsed-tab");
  const expandMapBtn = document.querySelector("#expand-map-btn");

  // Fungsi terpusat untuk set state
  const setCollapsed = (collapsed) => {
    examLayoutEl.classList.toggle("sidebar-collapsed", collapsed);

    // Update toggle button ARIA
    toggleMapBtn.setAttribute("aria-expanded", String(!collapsed));
    toggleMapBtn.setAttribute(
      "aria-label",
      collapsed ? "Tampilkan peta soal" : "Sembunyikan peta soal"
    );
    toggleMapBtn.setAttribute(
      "title",
      collapsed ? "Tampilkan peta soal" : "Sembunyikan peta soal"
    );

    // Update collapsed tab ARIA
    if (collapsedTab) {
      collapsedTab.setAttribute("aria-hidden", String(!collapsed));
    }

    // Persist
    sessionStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  };

  // Terapkan state tersimpan (default: expanded)
  const isCollapsed = sessionStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  setCollapsed(isCollapsed);

  // Collapse button (di header expanded)
  toggleMapBtn.addEventListener("click", () => {
    const willCollapse = !examLayoutEl.classList.contains("sidebar-collapsed");
    setCollapsed(willCollapse);
  });

  // Expand via klik pada collapsed tab (area keseluruhan)
  if (collapsedTab) {
    collapsedTab.addEventListener("click", (e) => {
      // Hindari double-fire jika klik pada expand button
      if (e.target.closest("#expand-map-btn")) return;
      setCollapsed(false);
    });
  }

  // Expand via tombol ▶ di dalam collapsed tab
  if (expandMapBtn) {
    expandMapBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setCollapsed(false);
    });
  }
};

initSidebarToggle();
bootstrap();
