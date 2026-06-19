import { logout } from "../auth.js";
import { listActiveExams, findSubmission, getExamAttempt, getSubmissionsForUser, getExamAttemptsForUser, getUserProfile } from "../db.js";
import { requireRole } from "../rbac.js";
import { isLockdown } from "../lockdown.js";

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

const listEl = document.querySelector("#student-exam-list");
const paginationEl = document.querySelector("#student-pagination");
const feedbackEl = document.querySelector("#student-feedback");

let allExams = [];
let studentUid = null;
let currentPage = 0;
const ITEMS_PER_PAGE = 3;

const submissionCache = new Map();
const attemptCache = new Map();

const getCachedSubmission = async (examId) => {
  if (submissionCache.has(examId)) {
    return submissionCache.get(examId);
  }
  const sub = await findSubmission(examId, studentUid);
  submissionCache.set(examId, sub);
  return sub;
};

const getCachedAttempt = async (examId) => {
  if (attemptCache.has(examId)) {
    return attemptCache.get(examId);
  }
  const attempt = await getExamAttempt(examId, studentUid);
  attemptCache.set(examId, attempt);
  return attempt;
};

const renderList = async () => {
  if (!allExams.length) {
    listEl.innerHTML = "<li>Belum ada ujian aktif.</li>";
    paginationEl.innerHTML = "";
    return;
  }

  // Pre-filter exams based on timeframe and student progress/submission in parallel
  const promises = allExams.map(async (exam) => {
    const sub = await getCachedSubmission(exam.id);
    const locked = Boolean(sub);

    const attempt = await getCachedAttempt(exam.id);
    const hasOngoingAttempt = attempt && attempt.status === "ongoing" && Date.now() < attempt.endTime;
    const hasExpiredOngoingAttempt = attempt && attempt.status === "ongoing" && Date.now() >= attempt.endTime;
    const isSubmitPending = localStorage.getItem(`simpleUjian:submitPending:${studentUid}:${exam.id}`) === "true";
    const isBlocked = attempt && attempt.status === "blocked";

    const now = Date.now();
    const latestStartTime = parseDate(exam.latestStartTime);

    // Expired if latestStartTime is missing/null, OR if the deadline has passed.
    const isExpired = !latestStartTime || now > latestStartTime.getTime();

    return { exam, sub, locked, hasOngoingAttempt, hasExpiredOngoingAttempt, isSubmitPending, isBlocked, isExpired };
  });

  const results = await Promise.all(promises);
  const filteredExams = results.filter(({ locked, hasOngoingAttempt, hasExpiredOngoingAttempt, isSubmitPending, isBlocked, isExpired }) => {
    // Only show the exam if:
    // 1. It is not expired yet, OR
    // 2. The student has already completed it (locked = true), OR
    // 3. The student has an ongoing attempt (hasOngoingAttempt = true), OR
    // 4. The student has an expired ongoing attempt (hasExpiredOngoingAttempt = true), OR
    // 5. The student has a pending submission locally (isSubmitPending = true), OR
    // 6. The student is blocked (isBlocked = true)
    return !isExpired || locked || hasOngoingAttempt || hasExpiredOngoingAttempt || isSubmitPending || isBlocked;
  });

  if (!filteredExams.length) {
    listEl.innerHTML = "<li>Belum ada ujian aktif.</li>";
    paginationEl.innerHTML = "";
    return;
  }

  // Calculate slice
  const start = currentPage * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, filteredExams.length);
  const pageExams = filteredExams.slice(start, end);

  // Render items
  const itemPromises = pageExams.map(async ({ exam, sub, locked, hasOngoingAttempt, hasExpiredOngoingAttempt, isSubmitPending, isBlocked }) => {
    const now = Date.now();
    const startTime = parseDate(exam.startTime);
    const latestStartTime = parseDate(exam.latestStartTime);

    let timeBadge = "";
    let canStart = true;

    if (isBlocked) {
      canStart = false;
      timeBadge = `<span class="badge badge-danger" style="cursor: default; background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.15); margin: 0;">🛡️ Akses Diblokir</span>`;
    } else if (isSubmitPending) {
      canStart = true;
      timeBadge = `<span class="badge badge-warning" style="cursor: default; background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.15); margin: 0;">⏳ Kirim Tertunda</span>`;
    } else if (hasExpiredOngoingAttempt) {
      canStart = true;
      timeBadge = `<span class="badge badge-warning" style="cursor: default; background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.15); margin: 0;">⌛ Waktu Habis</span>`;
    } else if (startTime && now < startTime.getTime()) {
      canStart = false;
      const startTimeStr = startTime.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
      timeBadge = `<span class="badge badge-warning" style="cursor: default; background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.15); margin: 0;">⏳ Mulai: ${startTimeStr}</span>`;
    } else if (latestStartTime && now > latestStartTime.getTime()) {
      // If they have an ongoing attempt, they can still enter!
      if (hasOngoingAttempt) {
        timeBadge = `<span class="badge badge-success" style="cursor: default; background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.15); margin: 0;">⏳ Sesi Sedang Berjalan</span>`;
        canStart = true;
      } else {
        canStart = false;
        timeBadge = `<span class="badge badge-danger" style="cursor: default; background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.15); margin: 0;">⌛ Batas Waktu Terlewati</span>`;
      }
    } else if (latestStartTime) {
      const latestTimeStr = latestStartTime.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
      timeBadge = `<span class="badge badge-success" style="cursor: default; background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.15); margin: 0;">✅ Batas Mulai: ${latestTimeStr}</span>`;
    } else {
      // Old exams with no timeframe defined
      canStart = false;
      timeBadge = `<span class="badge badge-danger" style="cursor: default; background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.15); margin: 0;">⌛ Batas Waktu Terlewati</span>`;
    }

    let actionButton = "";
    if (isBlocked) {
      actionButton = `<button class="link-btn danger" disabled style="opacity: 0.6; cursor: not-allowed; background: var(--danger); border-color: var(--danger);">Ujian Diblokir</button>`;
    } else if (isSubmitPending || hasExpiredOngoingAttempt) {
      const btnText = isSubmitPending ? "Kirim Jawaban (Pending)" : "Kirim Jawaban (Waktu Habis)";
      actionButton = `<a class="link-btn" href="/pages/exam.html?examId=${exam.id}" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-color: #d97706; box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.1);">${btnText}</a>`;
    } else if (hasOngoingAttempt) {
      actionButton = `<a class="link-btn" href="/pages/exam.html?examId=${exam.id}">Lanjutkan Ujian</a>`;
    } else if (locked) {
      const allowMultiple = exam.allowMultipleAttempts ?? true;
      if (allowMultiple) {
        if (canStart) {
          actionButton = `<a class="link-btn" href="/pages/exam.html?examId=${exam.id}">Mulai Ulang Ujian</a>`;
        } else {
          actionButton = `<button class="link-btn" disabled style="opacity: 0.5; cursor: not-allowed;">Mulai Ulang Ujian</button>`;
        }
      } else {
        actionButton = `<button class="link-btn" disabled style="opacity: 0.5; cursor: not-allowed;">Selesai Mengerjakan</button>`;
      }
    } else if (canStart) {
      actionButton = `<a class="link-btn" href="/pages/exam.html?examId=${exam.id}">Mulai Ujian</a>`;
    } else {
      actionButton = `<button class="link-btn" disabled style="opacity: 0.5; cursor: not-allowed;">Mulai Ujian</button>`;
    }

    return `
      <li>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
          <strong>${exam.title}</strong>
          ${timeBadge}
        </div>
        <div style="margin-top: 0.5rem;">${exam.description || "-"}</div>
        <small>Durasi: ${exam.durationMinutes || 0} menit</small>
        <div class="actions">
          ${actionButton}
          ${
            locked && (exam.showResultsImmediately ?? true)
              ? `<a class="link-btn secondary" href="/pages/result.html?submissionId=${sub.id}">Lihat Hasil Terakhir</a>`
              : ""
          }
        </div>
      </li>
    `;
  });

  const items = await Promise.all(itemPromises);
  listEl.innerHTML = items.join("");
  renderPagination(filteredExams.length);
};

const renderPagination = (totalItems) => {
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  if (totalPages <= 1) {
    paginationEl.innerHTML = "";
    return;
  }

  paginationEl.innerHTML = `
    <span class="pagination-info">Halaman ${currentPage + 1} dari ${totalPages}</span>
    <div class="pagination-buttons">
      <button class="pagination-btn" id="prev-page-btn" ${currentPage === 0 ? "disabled" : ""} title="Sebelumnya">
        ‹
      </button>
      <button class="pagination-btn" id="next-page-btn" ${currentPage === totalPages - 1 ? "disabled" : ""} title="Selanjutnya">
        ›
      </button>
    </div>
  `;

  document.querySelector("#prev-page-btn")?.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderList();
    }
  });

  document.querySelector("#next-page-btn")?.addEventListener("click", () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderList();
    }
  });
};

document.querySelector("#logout-btn")?.addEventListener("click", async () => {
  await logout();
  if (isLockdown) {
    // SEB & SUB sama-sama diarahkan ke exit page (yang dispatch cara keluar per browser)
    window.location.replace("/pages/exit-seb.html");
  } else {
    window.location.replace("/");
  }
});

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

const bootstrap = async () => {
  try {
    const access = await requireRole("siswa");
    if (!access) {
      return;
    }

    studentUid = access.user.uid;

    try {
      const profile = await getUserProfile(studentUid);
      const fullName = profile?.namaLengkap || "";
      if (fullName) {
        const rawFirstName = fullName.trim().split(/\s+/)[0];
        const firstName = rawFirstName.charAt(0).toUpperCase() + rawFirstName.slice(1).toLowerCase();
        const welcomeEl = document.querySelector("#student-welcome");
        if (welcomeEl) {
          welcomeEl.textContent = `Selamat datang, ${firstName}!`;
        }
      }
    } catch (err) {
      console.error("Gagal memuat profil untuk kata sambutan:", err);
    }
    
    let exams = [];
    let submissions = [];
    let attempts = [];

    if (navigator.onLine) {
      try {
        const [fetchedExams, fetchedSubmissions, fetchedAttempts] = await Promise.all([
          listActiveExams(studentUid),
          getSubmissionsForUser(studentUid),
          getExamAttemptsForUser(studentUid)
        ]);
        
        exams = fetchedExams;
        submissions = fetchedSubmissions;
        attempts = fetchedAttempts;

        localStorage.setItem(`simpleUjian:cache:exams:${studentUid}`, JSON.stringify(exams));
        localStorage.setItem(`simpleUjian:cache:submissions:${studentUid}`, JSON.stringify(submissions));
        localStorage.setItem(`simpleUjian:cache:attempts:${studentUid}`, JSON.stringify(attempts));
      } catch (err) {
        console.error("Gagal mengambil data dari server, mencoba membaca cache lokal:", err);
        exams = JSON.parse(localStorage.getItem(`simpleUjian:cache:exams:${studentUid}`) || "[]");
        submissions = JSON.parse(localStorage.getItem(`simpleUjian:cache:submissions:${studentUid}`) || "[]");
        attempts = JSON.parse(localStorage.getItem(`simpleUjian:cache:attempts:${studentUid}`) || "[]");
        
        if (!exams.length) {
          throw err;
        }
      }
    } else {
      console.log("Offline. Membaca data dari cache lokal.");
      exams = JSON.parse(localStorage.getItem(`simpleUjian:cache:exams:${studentUid}`) || "[]");
      submissions = JSON.parse(localStorage.getItem(`simpleUjian:cache:submissions:${studentUid}`) || "[]");
      attempts = JSON.parse(localStorage.getItem(`simpleUjian:cache:attempts:${studentUid}`) || "[]");
      
      if (!exams.length) {
        throw new Error("Koneksi internet terputus dan tidak ada cache lokal tersedia.");
      }
    }
    
    allExams = exams;

    // Initialize caches with null for all fetched exams to avoid N+1 queries on cache miss
    exams.forEach(exam => {
      submissionCache.set(exam.id, null);
      attemptCache.set(exam.id, null);
    });

    // Cache the latest submission per exam
    const sortedSubs = [...submissions].sort((a, b) => {
      const timeA = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : (a.submittedAt ? new Date(a.submittedAt).getTime() : 0);
      const timeB = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : (b.submittedAt ? new Date(b.submittedAt).getTime() : 0);
      return timeB - timeA;
    });

    sortedSubs.forEach(sub => {
      if (!submissionCache.has(sub.examId) || submissionCache.get(sub.examId) === null) {
        submissionCache.set(sub.examId, sub);
      }
    });

    // Cache attempts
    attempts.forEach(attempt => {
      attemptCache.set(attempt.examId, attempt);
    });

    await renderList();
  } catch (error) {
    feedbackEl.textContent = error.message || "Gagal memuat daftar ujian.";
  } finally {
    hideGlobalLoading();
  }
};

bootstrap();
