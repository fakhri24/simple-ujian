import {
  streamAllSubmissions,
  deleteSubmission,
  getExamWithQuestions,
  getExamKeys,
  updateSubmission,
  getUserProfile
} from "../../db.js";
import { renderQuestion } from "../../questionRenderer.js";
import renderMathInElement from "katex/contrib/auto-render";

let allSubmissions = [];
let currentDetailSubmissionId = null;
let currentDetailQuestions = [];
let currentDetailQuestionsExamId = null;

let recapCurrentPage = 0;
const RECAP_ITEMS_PER_PAGE = 5;

// DOM Element references
let recapListEl = null;
let recapPaginationEl = null;
let submissionDetailModalEl = null;
let detailStudentEmailEl = null;
let detailExamTitleEl = null;
let detailSubmitTimeEl = null;
let detailTotalScoreEl = null;
let detailQuestionsContainer = null;
let detailGradingActions = null;
let saveGradingBtn = null;
let feedbackEl = null;

// Shared references
let sharedUserProfileCache = null;
let sharedUserProfileInFlight = null;
let getExamsCacheFn = () => [];

const fetchProfilesForSubmissions = async (submissions) => {
  if (!sharedUserProfileCache || !sharedUserProfileInFlight) return;
  const uidsToFetch = [...new Set(submissions.map(s => s.userId).filter(uid => uid && !sharedUserProfileCache.has(uid) && !sharedUserProfileInFlight.has(uid)))];
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

const renderRecapList = () => {
  if (!recapListEl) return;

  const filterExamId = document.querySelector("#recap-filter-exam")?.value || "all";
  const filteredSubmissions = filterExamId === "all"
    ? allSubmissions
    : allSubmissions.filter((sub) => sub.examId === filterExamId);

  if (filteredSubmissions.length === 0) {
    recapListEl.innerHTML = `
      <tr>
        <td colspan="7" class="muted" style="text-align: center; padding: 1.5rem;">Belum ada hasil pengerjaan (submission) untuk filter ujian ini.</td>
      </tr>
    `;
    if (recapPaginationEl) recapPaginationEl.innerHTML = "";
    return;
  }

  // Adjust current page if total pages decreased
  const totalPages = Math.ceil(filteredSubmissions.length / RECAP_ITEMS_PER_PAGE);
  if (recapCurrentPage >= totalPages) {
    recapCurrentPage = Math.max(0, totalPages - 1);
  }

  const start = recapCurrentPage * RECAP_ITEMS_PER_PAGE;
  const end = Math.min(start + RECAP_ITEMS_PER_PAGE, filteredSubmissions.length);
  const pageSubmissions = filteredSubmissions.slice(start, end);

  const examsCache = getExamsCacheFn();

  let htmlContent = pageSubmissions.map((sub) => {
    const exam = examsCache.find((e) => e.id === sub.examId);
    const examTitle = exam ? exam.title : (sub.examTitle || sub.examId);

    const profile = sharedUserProfileCache ? sharedUserProfileCache.get(sub.userId) : null;
    const studentName = profile ? (profile.namaLengkap || profile.fullName || profile.name || sub.email) : (sub.email || "Siswa");
    const studentClass = profile ? (profile.kelas || profile.class || "-") : "-";

    const submitTime = sub.submittedAt?.toDate
      ? sub.submittedAt.toDate().toLocaleString("id-ID", {
          dateStyle: "short",
          timeStyle: "short"
        })
      : "-";

    const isBlocked = sub.isBlocked === true;
    const badgeMarkup = isBlocked 
      ? `<span class="badge badge-danger" style="font-weight:700;">DIBLOKIR</span>` 
      : `<span class="badge badge-success">Selesai</span>`;

    const hasEssay = (sub.breakdown || []).some((item) => item.status === "manual" || item.status === "graded");
    const needsGrading = (sub.breakdown || []).some((item) => item.status === "manual");

    let gradingActionBtn = "";
    if (hasEssay) {
      if (needsGrading) {
        gradingActionBtn = `
          <button type="button" class="view-submission-btn warning" data-id="${sub.id}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; cursor: pointer;">
            📝 Koreksi
          </button>
        `;
      } else {
        gradingActionBtn = `
          <button type="button" class="view-submission-btn success" data-id="${sub.id}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; cursor: pointer;">
            🔍 Detail
          </button>
        `;
      }
    } else {
      gradingActionBtn = `
        <button type="button" class="view-submission-btn secondary" data-id="${sub.id}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; cursor: pointer;">
          🔍 Detail
        </button>
      `;
    }

    return `
      <tr>
        <td style="font-weight: 500;" title="${studentName}">${studentName}</td>
        <td>${studentClass}</td>
        <td title="${examTitle}">${examTitle}</td>
        <td style="text-align: center;">${submitTime}</td>
        <td style="font-weight: 600; color: var(--brand); text-align: center;">
          ${sub.totalScore !== undefined ? sub.totalScore : "-"}
        </td>
        <td style="text-align: center;">${badgeMarkup}</td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 0.5rem; justify-content: center; align-items: center;">
            ${gradingActionBtn}
            <button type="button" class="delete-submission-btn danger" data-id="${sub.id}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; font-weight: 600; cursor: pointer;" title="Hapus pengerjaan & reset status siswa">
              🗑️ Hapus
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Fill in dummy rows to keep container height stable and avoid page shifts
  const dummyRowsNeeded = RECAP_ITEMS_PER_PAGE - pageSubmissions.length;
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
      </tr>
    `;
  }

  recapListEl.innerHTML = htmlContent;

  recapListEl.querySelectorAll(".view-submission-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const subId = btn.dataset.id;
      await openSubmissionDetail(subId);
    });
  });

  recapListEl.querySelectorAll(".delete-submission-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const subId = btn.dataset.id;
      const sub = allSubmissions.find((s) => s.id === subId);
      if (!sub) return;

      const profile = sharedUserProfileCache ? sharedUserProfileCache.get(sub.userId) : null;
      const studentName = profile ? (profile.namaLengkap || sub.email) : sub.email;
      const examTitle = sub.examTitle || sub.examId;

      const confirmMsg = `Apakah Anda yakin ingin menghapus hasil ujian "${examTitle}" untuk siswa "${studentName}"?\n\n` +
        `Tindakan ini akan:\n` +
        `1. MENGHAPUS hasil pengerjaan (submission) secara permanen.\n` +
        `2. MERESET status pengerjaan siswa sehingga mereka dapat mengerjakan kembali (jika waktu ujian masih aktif).\n\n` +
        `Tindakan ini TIDAK dapat dibatalkan. Apakah Anda ingin melanjutkan?`;

      const ok = window.confirm(confirmMsg);
      if (!ok) return;

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "Menghapus...";
      try {
        await deleteSubmission(subId);
        if (feedbackEl) {
          feedbackEl.textContent = `Berhasil menghapus hasil pengerjaan siswa "${studentName}"`;
        }
      } catch (err) {
        alert(err.message || "Gagal menghapus hasil pengerjaan.");
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });

  renderRecapPagination(filteredSubmissions.length);
};

const renderRecapPagination = (totalItems) => {
  if (!recapPaginationEl) return;

  const totalPages = Math.ceil(totalItems / RECAP_ITEMS_PER_PAGE);
  if (totalPages <= 1) {
    recapPaginationEl.innerHTML = "";
    return;
  }

  recapPaginationEl.innerHTML = `
    <span class="pagination-info">Halaman ${recapCurrentPage + 1} dari ${totalPages}</span>
    <div class="pagination-buttons">
      <button class="pagination-btn" id="recap-prev-page-btn" ${recapCurrentPage === 0 ? "disabled" : ""} title="Sebelumnya">
        ‹
      </button>
      <button class="pagination-btn" id="recap-next-page-btn" ${recapCurrentPage === totalPages - 1 ? "disabled" : ""} title="Selanjutnya">
        ›
      </button>
    </div>
  `;

  document.querySelector("#recap-prev-page-btn")?.addEventListener("click", () => {
    if (recapCurrentPage > 0) {
      recapCurrentPage--;
      renderRecapList();
    }
  });

  document.querySelector("#recap-next-page-btn")?.addEventListener("click", () => {
    if (recapCurrentPage < totalPages - 1) {
      recapCurrentPage++;
      renderRecapList();
    }
  });
};

const escapeCSV = (str, separator = ";") => {
  if (str === null || str === undefined) return "";
  let stringVal = String(str);
  if (stringVal.includes(separator) || stringVal.includes("\"") || stringVal.includes("\n") || stringVal.includes("\r")) {
    return `"${stringVal.replace(/"/g, '""')}"`;
  }
  return stringVal;
};

const downloadRecapCSV = async () => {
  const filterExamId = document.querySelector("#recap-filter-exam")?.value || "all";
  const filteredSubmissions = filterExamId === "all"
    ? allSubmissions
    : allSubmissions.filter(sub => sub.examId === filterExamId);

  if (filteredSubmissions.length === 0) {
    alert("Tidak ada data hasil pengerjaan (submission) untuk diekspor.");
    return;
  }

  const btn = document.querySelector("#download-recap-csv-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="animate-spin" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" style="margin-right: 0.5rem; display: inline-block; vertical-align: middle;">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      Mengekspor...
    `;
  }

  try {
    const separator = ";";
    const headers = [
      "Nama Siswa",
      "Kelas",
      "Email",
      "Judul Ujian",
      "Total Nilai",
      "Waktu Selesai",
      "Status Ujian",
      "Detail Jawaban (JSON)"
    ];

    const examsCache = getExamsCacheFn();

    const rows = filteredSubmissions.map(sub => {
      const exam = examsCache.find((e) => e.id === sub.examId);
      const examTitle = exam ? exam.title : (sub.examTitle || sub.examId);

      const profile = sharedUserProfileCache ? sharedUserProfileCache.get(sub.userId) : null;
      const studentName = profile ? (profile.namaLengkap || profile.fullName || profile.name || sub.email) : (sub.email || "Siswa");
      const studentClass = profile ? (profile.kelas || profile.class || "-") : "-";

      const submitTime = sub.submittedAt?.toDate
        ? sub.submittedAt.toDate().toLocaleString("id-ID")
        : "-";

      const status = sub.isBlocked ? "Blocked" : "Submitted";
      const answersJSON = JSON.stringify(sub.answersByQuestionId || {});

      return [
        escapeCSV(studentName, separator),
        escapeCSV(studentClass, separator),
        escapeCSV(sub.email || "-", separator),
        escapeCSV(examTitle, separator),
        escapeCSV(sub.totalScore !== undefined ? sub.totalScore : "0", separator),
        escapeCSV(submitTime, separator),
        escapeCSV(status, separator),
        escapeCSV(answersJSON, separator)
      ].join(separator);
    });

    const csvContent = "\uFEFF" + [headers.join(separator), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    
    const examCode = filterExamId === "all" ? "semua-ujian" : filterExamId;
    link.setAttribute("download", `rekap-nilai-${examCode}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    if (feedbackEl) {
      feedbackEl.textContent = "Rekapitulasi nilai berhasil diekspor ke CSV!";
    }
  } catch (err) {
    console.error("Gagal mengekspor CSV rekapitulasi:", err);
    alert("Gagal mengekspor CSV rekapitulasi: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "📥 Unduh Rekap CSV";
    }
  }
};

const openSubmissionDetail = async (submissionId) => {
  currentDetailSubmissionId = submissionId;
  await renderSubmissionDetail();
};

const renderSubmissionDetail = async () => {
  if (!currentDetailSubmissionId) return;

  try {
    const sub = allSubmissions.find(s => s.id === currentDetailSubmissionId);
    if (!sub) return;

    let questions = currentDetailQuestions;
    if (!currentDetailQuestions || currentDetailQuestions.length === 0 || currentDetailQuestionsExamId !== sub.examId) {
      if (feedbackEl) {
        feedbackEl.textContent = "Memuat detail hasil ujian...";
      }
      const loaded = await getExamWithQuestions(sub.examId);
      if (!loaded) throw new Error("Gagal memuat detail soal ujian.");

      const keysData = await getExamKeys(sub.examId);
      const keysMap = keysData?.keys || {};

      questions = loaded.questions.map(q => {
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

      currentDetailQuestions = questions;
      currentDetailQuestionsExamId = sub.examId;
    }

    if (detailStudentEmailEl) detailStudentEmailEl.textContent = sub.email || "Siswa";
    if (detailExamTitleEl) detailExamTitleEl.textContent = sub.examTitle || sub.examId;
    if (detailSubmitTimeEl) {
      detailSubmitTimeEl.textContent = sub.submittedAt?.toDate
        ? sub.submittedAt.toDate().toLocaleString("id-ID", {
            dateStyle: "medium",
            timeStyle: "short"
          })
        : "-";
    }
    if (detailTotalScoreEl) detailTotalScoreEl.textContent = `${sub.totalScore || 0} / 100`;

    if (detailQuestionsContainer) {
      detailQuestionsContainer.innerHTML = "";
      
      questions.forEach((q, idx) => {
        const qWrapper = document.createElement("div");
        qWrapper.className = "card";
        qWrapper.style.background = "rgba(255, 255, 255, 0.45)";
        qWrapper.style.border = "1px solid var(--border)";
        qWrapper.style.padding = "1.25rem";
        qWrapper.style.borderRadius = "12px";

        const bItem = (sub.breakdown || []).find((item) => item.questionId === q.id) || {
          status: "wrong",
          score: 0,
          scoreWeight: 0
        };

        const studentAns = sub.answersByQuestionId?.[q.id];

        const qHeader = document.createElement("div");
        qHeader.style.fontWeight = "bold";
        qHeader.style.marginBottom = "0.75rem";
        qHeader.style.color = "var(--brand)";
        qHeader.style.borderBottom = "1px dashed var(--border)";
        qHeader.style.paddingBottom = "0.5rem";
        qHeader.style.display = "flex";
        qHeader.style.justifyContent = "space-between";
        qHeader.style.alignItems = "center";

        let statusBadge = "";
        if (q.type === "essay") {
          if (bItem.status === "manual") {
            statusBadge = `<span class="badge badge-warning">📝 Perlu Diperiksa</span>`;
          } else {
            statusBadge = `<span class="badge badge-success">✅ Dinilai (${bItem.score}/${bItem.scoreWeight})</span>`;
          }
        } else if (bItem.status === "correct") {
          statusBadge = `<span class="badge badge-success">✅ Benar (${bItem.score}/${bItem.scoreWeight})</span>`;
        } else if (bItem.status === "partial") {
          statusBadge = `<span class="badge badge-warning">⚠️ Benar Sebagian (${bItem.score}/${bItem.scoreWeight})</span>`;
        } else {
          statusBadge = `<span class="badge badge-danger">❌ Salah (${bItem.score}/${bItem.scoreWeight})</span>`;
        }

        qHeader.innerHTML = `
          <span>Soal ${idx + 1} (${q.type.toUpperCase()})</span>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            ${statusBadge}
          </div>
        `;
        qWrapper.appendChild(qHeader);

        const qBody = document.createElement("div");
        qBody.style.marginTop = "0.5rem";
        qWrapper.appendChild(qBody);

        renderQuestion({
          container: qBody,
          question: q,
          currentAnswer: studentAns,
          onAnswerChange: () => {},
          readOnly: true,
        });

        const keyInfo = document.createElement("div");
        keyInfo.style.marginTop = "1rem";
        keyInfo.style.padding = "0.75rem";
        keyInfo.style.background = "rgba(16, 185, 129, 0.05)";
        keyInfo.style.border = "1.5px solid rgba(16, 185, 129, 0.15)";
        keyInfo.style.borderRadius = "8px";
        keyInfo.style.fontSize = "0.9rem";

        if (q.type === "pg" || q.type === "tf") {
          const correctOpt = (q.options || []).find((opt) => opt.isCorrect);
          keyInfo.innerHTML = `<strong>Kunci Jawaban:</strong> Option ${correctOpt ? correctOpt.id.replace("opt_", "").toUpperCase() : "-"} (${correctOpt ? correctOpt.text : "-"})`;
          qWrapper.appendChild(keyInfo);
        } else if (q.type === "pgk") {
          const correctOpts = (q.options || []).filter((opt) => opt.isCorrect).map((opt) => `${opt.id.replace("opt_", "").toUpperCase()} (${opt.text})`);
          keyInfo.innerHTML = `<strong>Kunci Jawaban Pilihan Kompleks:</strong> <ul style="margin: 0.25rem 0 0 1.25rem; padding: 0;">${correctOpts.map(o => `<li style="margin-bottom: 0.5rem; line-height: 1.6;">${o}</li>`).join("")}</ul>`;
          qWrapper.appendChild(keyInfo);
        } else if (q.type === "tf_matrix") {
          const statements = (q.statements || []).map((stmt) => `<li style="margin-bottom: 0.5rem; line-height: 1.6;">${stmt.text} ➔ <strong>${stmt.isCorrect === "true" ? "BENAR" : "SALAH"}</strong></li>`);
          keyInfo.innerHTML = `<strong>Kunci Jawaban Tabel Pernyataan:</strong> <ul style="margin: 0.25rem 0 0 1.25rem; padding: 0;">${statements.join("")}</ul>`;
          qWrapper.appendChild(keyInfo);
        } else if (q.type === "match") {
          const pairs = (q.matchPairs || []).map((pair) => `<li style="margin-bottom: 0.5rem; line-height: 1.6;">${pair.left} ➔ <strong>${pair.right}</strong></li>`);
          keyInfo.innerHTML = `<strong>Kunci Jawaban Menjodohkan:</strong> <ul style="margin: 0.25rem 0 0 1.25rem; padding: 0;">${pairs.join("")}</ul>`;
          qWrapper.appendChild(keyInfo);
        } else if (q.type === "essay") {
          keyInfo.style.background = "rgba(79, 70, 229, 0.05)";
          keyInfo.style.border = "1.5px solid rgba(79, 70, 229, 0.15)";
          
          keyInfo.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <strong style="color: var(--brand);">Koreksi Nilai Essay Guru:</strong>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span>Nilai Soal Ini:</span>
                <input 
                  type="number" 
                  class="essay-grading-input" 
                  data-qid="${q.id}" 
                  value="${bItem.score || 0}" 
                  min="0" 
                  max="${bItem.scoreWeight || 20}" 
                  step="any"
                  style="width: 5.5rem; padding: 0.35rem 0.5rem; background: white; border-radius: 8px;"
                />
                <span>dari maks <strong>${bItem.scoreWeight || 20}</strong> poin.</span>
              </div>
            </div>
          `;
          qWrapper.appendChild(keyInfo);
        }

        detailQuestionsContainer.appendChild(qWrapper);
      });

      renderMathInElement(detailQuestionsContainer, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ],
        throwOnError: false,
      });
    }

    if (detailGradingActions) {
      const hasEssay = questions.some(q => q.type === "essay");
      if (hasEssay) {
        detailGradingActions.classList.remove("hidden");
      } else {
        detailGradingActions.classList.add("hidden");
      }
    }

    if (submissionDetailModalEl) {
      submissionDetailModalEl.classList.remove("hidden");
      submissionDetailModalEl.setAttribute("aria-hidden", "false");
    }
    if (feedbackEl) {
      feedbackEl.textContent = "";
    }
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.textContent = err.message || "Gagal memuat detail hasil ujian.";
    }
  }
};

const saveManualGrading = async () => {
  if (!currentDetailSubmissionId) return;

  try {
    const sub = allSubmissions.find(s => s.id === currentDetailSubmissionId);
    if (!sub) return;

    if (saveGradingBtn) {
      saveGradingBtn.disabled = true;
      saveGradingBtn.textContent = "Menyimpan...";
    }
    if (feedbackEl) {
      feedbackEl.textContent = "Menyimpan hasil koreksi essay...";
    }

    const inputs = detailQuestionsContainer ? detailQuestionsContainer.querySelectorAll(".essay-grading-input") : [];
    console.log("saveManualGrading: total inputs =", inputs.length);
    
    // Deep clone array breakdown to avoid mutation detection issue
    const newBreakdown = (sub.breakdown || []).map((item) => {
      const input = Array.from(inputs).find(inp => inp.getAttribute("data-qid") === item.questionId);
      if (input) {
        const scoreValue = parseFloat(String(input.value || "").replace(",", ".")) || 0;
        console.log(`Grading Soal ${item.questionId}: score = ${scoreValue}`);
        return {
          ...item,
          score: scoreValue,
          status: "graded"
        };
      }
      return { ...item };
    });

    // Recalculate total score
    const totalRawPoints = newBreakdown.reduce((sum, item) => sum + (item.score || 0), 0);
    const totalMaxPoints = newBreakdown.reduce((sum, item) => sum + (item.scoreWeight || 10), 0);

    let newTotal = totalMaxPoints > 0 ? (totalRawPoints / totalMaxPoints) * 100 : 0;
    newTotal = Number(newTotal.toFixed(2));

    // Correction for rounding if close to 100
    if (Math.abs(newTotal - 100) < 0.05) {
      const isAllPerfect = newBreakdown.every(item => {
        return item.status === "correct" || item.status === "graded" || item.score >= item.scoreWeight;
      });
      if (isAllPerfect) {
        newTotal = 100;
      }
    }

    // Cap total score to 100
    newTotal = Math.min(100, newTotal);

    await updateSubmission(currentDetailSubmissionId, {
      breakdown: newBreakdown,
      totalScore: newTotal
    });

    if (feedbackEl) {
      feedbackEl.textContent = "Berhasil menyimpan hasil koreksi essay.";
    }
    alert("Berhasil menyimpan hasil koreksi essay!");
  } catch (err) {
    console.error("Gagal menyimpan hasil koreksi essay:", err);
    if (feedbackEl) {
      feedbackEl.textContent = err.message || "Gagal menyimpan hasil koreksi.";
    }
    alert("Gagal menyimpan hasil koreksi: " + (err.message || err));
  } finally {
    if (saveGradingBtn) {
      saveGradingBtn.disabled = false;
      saveGradingBtn.textContent = "Simpan Koreksi Essay";
    }
  }
};

/**
 * Initializes recap module.
 * @param {Object} config
 * @param {Map} config.userProfileCache
 * @param {Set} config.userProfileInFlight
 * @param {Function} config.getExamsCache
 * @param {HTMLElement} config.feedbackEl
 */
export const initRealTimeRecap = (config) => {
  sharedUserProfileCache = config.userProfileCache;
  sharedUserProfileInFlight = config.userProfileInFlight;
  getExamsCacheFn = config.getExamsCache;
  feedbackEl = config.feedbackEl;

  // Cache DOM element references
  recapListEl = document.querySelector("#recap-list");
  recapPaginationEl = document.querySelector("#recap-pagination");
  submissionDetailModalEl = document.querySelector("#submission-detail-modal");
  detailStudentEmailEl = document.querySelector("#detail-student-email");
  detailExamTitleEl = document.querySelector("#detail-exam-title");
  detailSubmitTimeEl = document.querySelector("#detail-submit-time");
  detailTotalScoreEl = document.querySelector("#detail-total-score");
  detailQuestionsContainer = document.querySelector("#detail-questions-container");
  detailGradingActions = document.querySelector("#detail-grading-actions");
  saveGradingBtn = document.querySelector("#save-grading-btn");

  // Subscribe to real-time submissions streaming
  streamAllSubmissions(async (submissions) => {
    allSubmissions = submissions;
    await fetchProfilesForSubmissions(submissions);
    renderRecapList();
    if (currentDetailSubmissionId) {
      await renderSubmissionDetail();
    }
  });

  // Bind change filters
  document.querySelector("#recap-filter-exam")?.addEventListener("change", () => {
    recapCurrentPage = 0;
    renderRecapList();
  });

  // Bind download CSV
  document.querySelector("#download-recap-csv-btn")?.addEventListener("click", async () => {
    await downloadRecapCSV();
  });

  // Bind modal close buttons
  const closeSubmissionDetailModalBtn = document.querySelector("#close-submission-detail-btn");
  closeSubmissionDetailModalBtn?.addEventListener("click", () => {
    submissionDetailModalEl?.classList.add("hidden");
    submissionDetailModalEl?.setAttribute("aria-hidden", "true");
    currentDetailSubmissionId = null;
  });

  submissionDetailModalEl?.addEventListener("click", (e) => {
    if (e.target === submissionDetailModalEl) {
      submissionDetailModalEl.classList.add("hidden");
      submissionDetailModalEl.setAttribute("aria-hidden", "true");
      currentDetailSubmissionId = null;
    }
  });

  // Bind manual grading save button
  saveGradingBtn?.addEventListener("click", async () => {
    await saveManualGrading();
  });
};
