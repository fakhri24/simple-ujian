import {
  streamActiveExamAttempts,
  blockStudentAttempt,
  unblockStudentAttempt,
  getExamWithQuestions,
  getExamKeys,
  createSubmission,
  updateExamAttemptStatus,
  addExtraTime,
  getUserProfile
} from "../../db.js";
import { calculateScore } from "../../scoring.js";

let activeAttempts = [];
let monitoringIntervalRef = null;
let monitoringCurrentPage = 0;
const MONITORING_ITEMS_PER_PAGE = 7;

// DOM element references
let monitoringListEl = null;
let monitoringPaginationEl = null;
let cheatingModalEl = null;
let cheatingLogsList = null;
let cheatingModalStudentInfo = null;

// Shared state references passed during initialization
let sharedUserProfileCache = null;
let sharedUserProfileInFlight = null;
let getExamsCacheFn = () => [];

const formatCountdown = (endTimeMs) => {
  const diff = endTimeMs - Date.now();
  if (diff <= 0) return "<span style='color: var(--danger); font-weight: 700;'>WAKTU HABIS</span>";
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `<span style="font-family: monospace; font-weight: 600;">${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}</span>`;
};

const fetchProfilesForAttempts = async (attempts) => {
  if (!sharedUserProfileCache || !sharedUserProfileInFlight) return;
  const uidsToFetch = [...new Set(attempts.map(a => a.userId).filter(uid => uid && !sharedUserProfileCache.has(uid) && !sharedUserProfileInFlight.has(uid)))];
  if (uidsToFetch.length === 0) return;
  
  uidsToFetch.forEach(uid => sharedUserProfileInFlight.add(uid));
  
  await Promise.all(
    uidsToFetch.map(async (uid) => {
      try {
        const profile = await getUserProfile(uid);
        if (profile) {
          sharedUserProfileCache.set(uid, profile);
        }
      } catch (err) {
        console.error(`Gagal memuat profil untuk UID: ${uid}`, err);
      } finally {
        sharedUserProfileInFlight.delete(uid);
      }
    })
  );
};

const forceSubmitStudentAttempt = async (examId, userId) => {
  const attempt = activeAttempts.find(a => a.examId === examId && a.userId === userId);
  if (!attempt) {
    throw new Error("Data pengerjaan siswa tidak ditemukan.");
  }

  const loaded = await getExamWithQuestions(examId);
  if (!loaded) {
    throw new Error("Gagal memuat soal ujian.");
  }
  const { exam, questions } = loaded;

  const keysData = await getExamKeys(examId);
  const keysMap = keysData?.keys || {};

  const mergedQuestions = questions.map(q => {
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

  const answers = attempt.answersByQuestionId || {};
  const scoreResult = calculateScore(mergedQuestions, answers);

  const isAttemptBlocked = attempt.status === "blocked";

  await Promise.all([
    createSubmission({
      examId,
      userId,
      email: attempt.email || "siswa@simple.ujian",
      examTitle: exam.title,
      answersByQuestionId: answers,
      totalScore: scoreResult.total,
      breakdown: scoreResult.breakdown,
      durationMinutes: Number(exam.durationMinutes || 30),
      isBlocked: isAttemptBlocked,
    }),
    updateExamAttemptStatus(examId, userId, "submitted")
  ]);
};

const renderActiveAttempts = () => {
  if (!monitoringListEl) return;

  if (activeAttempts.length === 0) {
    monitoringListEl.innerHTML = `
      <tr>
        <td colspan="8" class="muted" style="text-align: center; padding: 1.5rem;">Tidak ada siswa yang sedang aktif ujian saat ini.</td>
      </tr>
    `;
    monitoringCurrentPage = 0;
    if (monitoringPaginationEl) monitoringPaginationEl.innerHTML = "";
    return;
  }

  // Adjust page index if out of bounds due to updates
  const totalPages = Math.ceil(activeAttempts.length / MONITORING_ITEMS_PER_PAGE);
  if (monitoringCurrentPage >= totalPages) {
    monitoringCurrentPage = Math.max(0, totalPages - 1);
  }

  // Slice attempts for the current page
  const start = monitoringCurrentPage * MONITORING_ITEMS_PER_PAGE;
  const end = Math.min(start + MONITORING_ITEMS_PER_PAGE, activeAttempts.length);
  const pageAttempts = activeAttempts.slice(start, end);

  const examsCache = getExamsCacheFn();

  let htmlContent = pageAttempts.map((attempt) => {
    const exam = examsCache.find((e) => e.id === attempt.examId);
    const examTitle = exam ? exam.title : attempt.examId;

    const profile = sharedUserProfileCache ? sharedUserProfileCache.get(attempt.userId) : null;
    const studentName = profile ? (profile.namaLengkap || profile.fullName || profile.name || attempt.email) : (attempt.email || "Siswa (Tanpa Email)");
    const studentClass = profile ? (profile.kelas || profile.class || "-") : "-";

    // Pelanggaran badge
    let violationBadge = `<span class="badge badge-success">✅ Aman</span>`;
    if (attempt.status === "blocked" || (attempt.cheatingCount || 0) >= 3) {
      violationBadge = `<span class="badge badge-danger show-logs-btn" data-id="${attempt.examId}_${attempt.userId}" style="font-weight: 800; cursor: pointer;" title="Klik untuk lihat detail kecurangan">🛡️ DIBLOKIR (${attempt.cheatingCount || 0}x)</span>`;
    } else if ((attempt.cheatingCount || 0) > 0) {
      violationBadge = `<span class="badge badge-warning show-logs-btn" data-id="${attempt.examId}_${attempt.userId}" title="Klik untuk lihat detail kecurangan">⚠️ ${attempt.cheatingCount} Pelanggaran</span>`;
    }

    // Action buttons based on status
    let controlButton = "";
    if (attempt.status === "blocked") {
      controlButton = `
        <div style="display: flex; gap: 0.5rem; justify-content: center; align-items: center;">
          <button type="button" class="force-submit-btn" data-exam="${attempt.examId}" data-user="${attempt.userId}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; background: #3b82f6; color: white; border: none; cursor: pointer; transition: all 0.2s;">Kumpulkan</button>
          <button type="button" class="unblock-btn" data-exam="${attempt.examId}" data-user="${attempt.userId}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; background: #10b981; color: white; border: none; cursor: pointer; transition: all 0.2s;">Buka Blokir</button>
        </div>
      `;
    } else {
      controlButton = `
        <div style="display: flex; gap: 0.5rem; justify-content: center; align-items: center;">
          <button type="button" class="force-submit-btn" data-exam="${attempt.examId}" data-user="${attempt.userId}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; background: #3b82f6; color: white; border: none; cursor: pointer; transition: all 0.2s;">Kumpulkan</button>
          <button type="button" class="block-btn danger" data-exam="${attempt.examId}" data-user="${attempt.userId}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; cursor: pointer;">Blokir</button>
        </div>
      `;
    }

    return `
      <tr>
        <td style="font-weight: 500;">${studentName}</td>
        <td>${studentClass}</td>
        <td>${examTitle}</td>
        <td class="timer-countdown" data-endtime="${attempt.endTime}">
          ${formatCountdown(attempt.endTime)}
        </td>
        <td style="text-align: center; font-weight: 600; color: var(--brand);">
          +${attempt.extraMinutes || 0} Menit
        </td>
        <td style="text-align: center;">
          ${violationBadge}
        </td>
        <td style="text-align: center; display: flex; gap: 0.5rem; justify-content: center; border-bottom: 0;">
          <button type="button" class="compensate-btn secondary" data-exam="${attempt.examId}" data-user="${attempt.userId}" data-minutes="5" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px;">
            +5 Min
          </button>
          <button type="button" class="compensate-btn secondary" data-exam="${attempt.examId}" data-user="${attempt.userId}" data-minutes="10" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px;">
            +10 Min
          </button>
        </td>
        <td style="text-align: center;">
          ${controlButton}
        </td>
      </tr>
    `;
  }).join("");

  // Fill in dummy rows to keep container height stable and avoid page shifts
  const dummyRowsNeeded = MONITORING_ITEMS_PER_PAGE - pageAttempts.length;
  for (let i = 0; i < dummyRowsNeeded; i++) {
    htmlContent += `
      <tr class="dummy-row" style="pointer-events: none; background: transparent;">
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
      </tr>
    `;
  }

  monitoringListEl.innerHTML = htmlContent;
  renderMonitoringPagination(activeAttempts.length);

  // Attach compensate listeners
  monitoringListEl.querySelectorAll(".compensate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = btn.dataset.exam;
      const userId = btn.dataset.user;
      const minutes = Number(btn.dataset.minutes);
      
      btn.disabled = true;
      btn.textContent = "Updating...";
      try {
        await addExtraTime(examId, userId, minutes);
      } catch (err) {
        alert(err.message || "Gagal menambah waktu kompensasi.");
      }
    });
  });

  // Attach force submit listeners
  monitoringListEl.querySelectorAll(".force-submit-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = btn.dataset.exam;
      const userId = btn.dataset.user;
      
      const attempt = activeAttempts.find(a => a.examId === examId && a.userId === userId);
      const profile = sharedUserProfileCache ? sharedUserProfileCache.get(userId) : null;
      const name = profile ? (profile.namaLengkap || attempt.email) : attempt.email;
      
      const ok = window.confirm(`Apakah Anda yakin ingin menyelesaikan pengerjaan untuk siswa "${name}" secara paksa? Jawaban yang sudah tersimpan di database akan dikumpulkan dan dinilai.`);
      if (!ok) return;

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "Mengumpulkan...";
      try {
        await forceSubmitStudentAttempt(examId, userId);
      } catch (err) {
        alert(err.message || "Gagal mengumpulkan pengerjaan siswa secara paksa.");
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });

  // Attach manual block listeners
  monitoringListEl.querySelectorAll(".block-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = btn.dataset.exam;
      const userId = btn.dataset.user;
      const ok = window.confirm("Apakah Anda yakin ingin memblokir pengerjaan siswa ini secara manual?");
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = "Blocking...";
      try {
        await blockStudentAttempt(examId, userId);
      } catch (err) {
        alert(err.message || "Gagal memblokir siswa.");
      }
    });
  });

  // Attach unblock listeners
  monitoringListEl.querySelectorAll(".unblock-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = btn.dataset.exam;
      const userId = btn.dataset.user;
      const ok = window.confirm("Apakah Anda yakin ingin membuka kembali blokir pengerjaan siswa ini?");
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = "Unblocking...";
      try {
        await unblockStudentAttempt(examId, userId);
      } catch (err) {
        alert(err.message || "Gagal membuka blokir siswa.");
      }
    });
  });

  // Attach cheating log modal detail listener
  monitoringListEl.querySelectorAll(".show-logs-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const attemptId = btn.dataset.id;
      const attempt = activeAttempts.find(a => `${a.examId}_${a.userId}` === attemptId);
      if (!attempt) return;

      const profile = sharedUserProfileCache ? sharedUserProfileCache.get(attempt.userId) : null;
      const studentName = profile ? (profile.namaLengkap || attempt.email) : attempt.email;
      const studentClass = profile ? ` (${profile.kelas})` : "";
      if (cheatingModalStudentInfo) {
        cheatingModalStudentInfo.textContent = `Siswa: ${studentName}${studentClass}`;
      }

      if (cheatingLogsList) {
        cheatingLogsList.innerHTML = (attempt.cheatingLogs || [])
          .map((log) => {
            const time = new Date(log.timestamp).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            });
            return `
              <li class="card" style="padding: 0.75rem 1rem; margin: 0; background: rgba(244, 63, 94, 0.05); border-color: rgba(244, 63, 94, 0.15); display: flex; justify-content: space-between; align-items: center; border-radius: 12px;">
                <span style="font-weight: 600; color: #e11d48; font-size: 0.9rem;">⚠️ ${log.event}</span>
                <span class="muted" style="font-size: 0.8rem; font-family: monospace;">${time}</span>
              </li>
            `;
          })
          .join("");

        if ((attempt.cheatingLogs || []).length === 0) {
          cheatingLogsList.innerHTML = `<li class="muted" style="text-align: center; font-style: italic;">Tidak ada catatan log pelanggaran.</li>`;
        }
      }

      if (cheatingModalEl) {
        cheatingModalEl.classList.remove("hidden");
        cheatingModalEl.setAttribute("aria-hidden", "false");
      }
    });
  });
};

const renderMonitoringPagination = (totalItems) => {
  if (!monitoringPaginationEl) return;

  const totalPages = Math.ceil(totalItems / MONITORING_ITEMS_PER_PAGE);
  if (totalPages <= 1) {
    monitoringPaginationEl.innerHTML = "";
    return;
  }

  monitoringPaginationEl.innerHTML = `
    <span class="pagination-info">Halaman ${monitoringCurrentPage + 1} dari ${totalPages}</span>
    <div class="pagination-buttons">
      <button class="pagination-btn" id="monitoring-prev-page-btn" ${monitoringCurrentPage === 0 ? "disabled" : ""} title="Sebelumnya">
        ‹
      </button>
      <button class="pagination-btn" id="monitoring-next-page-btn" ${monitoringCurrentPage === totalPages - 1 ? "disabled" : ""} title="Selanjutnya">
        ›
      </button>
    </div>
  `;

  document.querySelector("#monitoring-prev-page-btn")?.addEventListener("click", () => {
    if (monitoringCurrentPage > 0) {
      monitoringCurrentPage--;
      renderActiveAttempts();
    }
  });

  document.querySelector("#monitoring-next-page-btn")?.addEventListener("click", () => {
    if (monitoringCurrentPage < totalPages - 1) {
      monitoringCurrentPage++;
      renderActiveAttempts();
    }
  });
};

/**
 * Initializes and starts real-time monitoring of exam attempts.
 * @param {Object} config
 * @param {Map} config.userProfileCache
 * @param {Set} config.userProfileInFlight
 * @param {Function} config.getExamsCache
 */
export const initRealTimeMonitoring = (config) => {
  sharedUserProfileCache = config.userProfileCache;
  sharedUserProfileInFlight = config.userProfileInFlight;
  getExamsCacheFn = config.getExamsCache;

  // Select DOM Elements
  monitoringListEl = document.querySelector("#monitoring-list");
  monitoringPaginationEl = document.querySelector("#monitoring-pagination");
  cheatingModalEl = document.querySelector("#cheating-modal");
  cheatingLogsList = document.querySelector("#cheating-logs-list");
  cheatingModalStudentInfo = document.querySelector("#cheating-modal-student-info");

  streamActiveExamAttempts(async (attempts) => {
    activeAttempts = attempts;
    await fetchProfilesForAttempts(attempts);
    renderActiveAttempts();
  });

  if (monitoringIntervalRef) {
    clearInterval(monitoringIntervalRef);
  }
  monitoringIntervalRef = setInterval(() => {
    document.querySelectorAll(".timer-countdown").forEach((el) => {
      const endTime = Number(el.dataset.endtime);
      el.innerHTML = formatCountdown(endTime);
    });
  }, 1000);
};
