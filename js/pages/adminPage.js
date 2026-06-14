import { logout } from "../auth.js";
import { requireRole } from "../rbac.js";
import {
  createExam,
  createQuestion,
  listAllExams,
  updateExamQuestionIds,
  deleteExam,
  getExamWithQuestions,
  streamActiveExamAttempts,
  addExtraTime,
  blockStudentAttempt,
  unblockStudentAttempt,
  streamAllSubmissions,
  updateSubmission,
  updateQuestion,
  deleteQuestion,
  updateExamQuestionList,
  getUserProfile,
  listStudents,
  deleteUserProfile,
  upsertUserProfile,
  createSubmission,
  updateExamAttemptStatus,
  updateExamDetails,
  resetUserSession,
  deleteSubmission,
  getExamKeys,
  saveExamKeys,
} from "../db.js";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { firebaseConfig } from "../app-config.js";
import { renderQuestion } from "../questionRenderer.js";
import renderMathInElement from "katex/contrib/auto-render";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase-config.js";
import { dataURItoBlob } from "../imageHelper.js";
import { exportQuestionsToDocx } from "./admin/docxExporter.js";
import { initStudentPicker } from "./admin/studentPicker.js";
import { initRealTimeMonitoring } from "./admin/monitoringManager.js";
import { initRealTimeRecap } from "./admin/recapManager.js";
import { initStudentManagement } from "./admin/studentManagement.js";
import "katex/dist/katex.min.css";
import { calculateScore } from "../scoring.js";

// Global caching variables
const userProfileCache = new Map();
const userProfileInFlight = new Set();
let examsCache = [];
let createStudentPickerInstance = null;
let editStudentPickerInstance = null;

const MIN_ROWS = 2;

const syncRemoveButtons = (container) => {
  if (!container) return;
  const rows = container.querySelectorAll(".option-row, .match-pair-row, .matrix-statement-row");
  const showRemove = rows.length > 2;
  rows.forEach((row) => {
    const btn = row.querySelector(".remove-row-btn");
    if (btn) {
      btn.style.display = showRemove ? "inline-block" : "none";
    }
  });
};

const feedbackEl = document.querySelector("#admin-feedback");
const examListEl = document.querySelector("#exam-list");

const previewModalEl = document.querySelector("#preview-modal");
const closeModalBtn = document.querySelector("#close-modal-btn");
const modalTitleEl = document.querySelector("#modal-exam-title");
const modalQuestionsContainer = document.querySelector("#modal-questions-container");
const decorateSelect = (selectEl) => {
  if (!selectEl || selectEl.dataset.modernSelectDecorated) return;
  selectEl.dataset.modernSelectDecorated = "true";

  // Sembunyikan select native asli
  selectEl.style.display = "none";

  // Buat kontainer pembungkus kustom
  const wrapper = document.createElement("div");
  wrapper.className = "modern-select-wrapper";
  
  // Jika select asli punya inline style width/display, salin ke pembungkus kustom
  if (selectEl.style.width) wrapper.style.width = selectEl.style.width;
  if (selectEl.style.marginTop) wrapper.style.marginTop = selectEl.style.marginTop;

  // Sisipkan pembungkus tepat setelah select native, lalu masukkan select native ke dalamnya
  selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
  wrapper.appendChild(selectEl);

  // Buat tombol pemicu kustom (Trigger Button)
  const trigger = document.createElement("div");
  trigger.className = "modern-select-trigger";
  trigger.innerHTML = `
    <span class="modern-select-current">Pilih...</span>
    <svg class="modern-select-chevron" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `;
  wrapper.appendChild(trigger);

  // Buat kontainer melayang daftar opsi kustom (Floating Options Panel)
  const optionsContainer = document.createElement("div");
  optionsContainer.className = "modern-select-options";
  wrapper.appendChild(optionsContainer);

  // Perbarui teks trigger sesuai item terpilih
  const updateTrigger = () => {
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const currentSpan = trigger.querySelector(".modern-select-current");
    if (selectedOption) {
      currentSpan.textContent = selectedOption.textContent;
    } else {
      currentSpan.textContent = "Pilih...";
    }
  };

  // Re-build/render ulang list opsi kustom secara visual
  const rebuildOptions = () => {
    optionsContainer.innerHTML = "";
    Array.from(selectEl.options).forEach((opt, idx) => {
      const optDiv = document.createElement("div");
      optDiv.className = "modern-select-option";
      if (opt.selected || idx === selectEl.selectedIndex) {
        optDiv.classList.add("selected");
      }
      optDiv.dataset.value = opt.value;
      optDiv.dataset.index = idx;

      // Ambil metadata kaya (jika ada)
      const qCount = opt.getAttribute("data-questions");
      const duration = opt.getAttribute("data-duration");
      
      if (qCount !== null || duration !== null) {
        // Layout kaya untuk daftar ujian
        optDiv.innerHTML = `
          <div class="option-title" dir="auto">${opt.textContent}</div>
          <div class="option-meta">
            ${qCount !== null ? `<span>Soal: ${qCount}</span>` : ""}
            ${duration !== null ? `<span>Durasi: ${duration} mnt</span>` : ""}
          </div>
        `;
      } else {
        // Layout standard biasa
        optDiv.textContent = opt.textContent;
        optDiv.setAttribute("dir", "auto");
      }

      // Handler klik pada pilihan
      optDiv.addEventListener("click", (e) => {
        e.stopPropagation();
        selectEl.selectedIndex = idx;
        
        // Picu event native agar penangan perubahan di adminPage.js berjalan otomatis
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
        
        closeDropdown();
      });

      optionsContainer.appendChild(optDiv);
    });
    updateTrigger();
  };

  const openDropdown = () => {
    // Tutup dropdown lain yang terbuka terlebih dahulu
    document.querySelectorAll(".modern-select-wrapper.open").forEach(w => {
      if (w !== wrapper) {
        w.classList.remove("open");
        w.querySelector(".modern-select-options").classList.remove("active");
      }
    });
    wrapper.classList.add("open");
    optionsContainer.classList.add("active");
  };

  const closeDropdown = () => {
    wrapper.classList.remove("open");
    optionsContainer.classList.remove("active");
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrapper.classList.contains("open")) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  // Sinkronkan styling terpilih ketika state select native berubah (misal dari script)
  selectEl.addEventListener("change", () => {
    updateTrigger();
    Array.from(optionsContainer.children).forEach((child, i) => {
      if (i === selectEl.selectedIndex) {
        child.classList.add("selected");
      } else {
        child.classList.remove("selected");
      }
    });
  });

  // Pasang MutationObserver agar ketika opsi native select diubah secara dinamis (seperti fetch ujian),
  // dropdown kustom akan otomatis merender ulang pilihannya dengan instan.
  const observer = new MutationObserver(() => {
    rebuildOptions();
  });
  observer.observe(selectEl, { childList: true, subtree: true, characterData: true });

  // Render awal
  rebuildOptions();
};

// Global click listener untuk menutup dropdown yang sedang terbuka saat mengklik luar area
document.addEventListener("click", () => {
  document.querySelectorAll(".modern-select-wrapper.open").forEach(w => {
    w.classList.remove("open");
    w.querySelector(".modern-select-options").classList.remove("active");
  });
});



const updateDashboardStats = async (exams) => {
  try {
    const totalExams = exams.length;
    const students = await listStudents();
    const totalStudents = students.length;
    
    let totalQuestions = 0;
    exams.forEach(exam => {
      totalQuestions += (exam.questionIds || []).length;
    });

    const totalExamsEl = document.querySelector("#stat-total-exams");
    const totalStudentsEl = document.querySelector("#stat-total-students");
    const totalQuestionsEl = document.querySelector("#stat-total-questions");

    if (totalExamsEl) totalExamsEl.textContent = totalExams;
    if (totalStudentsEl) totalStudentsEl.textContent = totalStudents;
    if (totalQuestionsEl) totalQuestionsEl.textContent = totalQuestions;
  } catch (error) {
    console.error("Gagal memperbarui dashboard stats:", error);
  }
};

document.addEventListener("studentsChanged", (e) => {
  const totalStudentsEl = document.querySelector("#stat-total-students");
  if (totalStudentsEl) {
    totalStudentsEl.textContent = e.detail.count;
  }
});


const renderExams = async () => {
  const exams = await listAllExams();
  examsCache = exams;

  const optionsHtml = exams
    .map((exam) => `<option value="${exam.id}" data-questions="${(exam.questionIds || []).length}" data-duration="${exam.durationMinutes || 0}">${exam.title}</option>`)
    .join("");


  
  const editorLoadExamSelectEl = document.querySelector("#editor-load-exam");
  const editorSaveExamSelectEl = document.querySelector("#editor-save-target-exam");
  if (editorLoadExamSelectEl) {
    editorLoadExamSelectEl.innerHTML = optionsHtml;
  }
  if (editorSaveExamSelectEl) {
    editorSaveExamSelectEl.innerHTML = optionsHtml;
  }

  const recapFilterExamEl = document.querySelector("#recap-filter-exam");
  if (recapFilterExamEl) {
    recapFilterExamEl.innerHTML = `<option value="all">Semua Ujian</option>` + optionsHtml;
  }

  examListEl.innerHTML = exams
    .map((exam) => {
      const startText = exam.startTime
        ? (exam.startTime.toDate ? exam.startTime.toDate() : new Date(exam.startTime)).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
        : "-";
      const latestText = exam.latestStartTime
        ? (exam.latestStartTime.toDate ? exam.latestStartTime.toDate() : new Date(exam.latestStartTime)).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
        : "-";
      
      const isPrivate = exam.visibility === "private";
      const badgeHtml = isPrivate 
        ? `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: var(--danger); padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; border: 1.5px solid rgba(239, 68, 68, 0.15);">🔒 Privat (${(exam.assignedTo || []).length} Siswa)</span>`
        : `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: var(--success); padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; border: 1.5px solid rgba(16, 185, 129, 0.15);">🌐 Publik</span>`;

      const isActive = exam.active ?? true;
      const activeBadgeHtml = isActive
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: var(--success); padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; border: 1.5px solid rgba(16, 185, 129, 0.15);">🟢 Aktif</span>`
        : `<span class="badge" style="background: rgba(100, 116, 139, 0.1); color: #64748b; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; border: 1.5px solid rgba(100, 116, 139, 0.15);">⚪ Nonaktif</span>`;

      return `
        <li class="exam-item">
          <div class="exam-card-header">
            <h3 class="exam-card-title" dir="auto">${exam.title}</h3>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              ${badgeHtml}
              ${activeBadgeHtml}
            </div>
          </div>
          
          <div class="exam-card-body">
            <p class="exam-card-desc" dir="auto">${exam.description || "Tidak ada deskripsi."}</p>
            
            <div class="exam-card-meta">
              <span class="meta-badge" title="Jumlah Soal">
                <span class="meta-icon">📝</span>
                <span class="meta-text">${(exam.questionIds || []).length} Soal</span>
              </span>
              <span class="meta-badge" title="Durasi Ujian">
                <span class="meta-icon">⏱️</span>
                <span class="meta-text">${exam.durationMinutes || 0} Menit</span>
              </span>
            </div>
            
            <div class="exam-card-dates">
              <div class="date-row">
                <span class="date-label">📅 Mulai</span>
                <span class="date-val">${startText}</span>
              </div>
              <div class="date-row">
                <span class="date-label">⏳ Batas</span>
                <span class="date-val">${latestText}</span>
              </div>
            </div>
          </div>
          
          <div class="exam-card-actions">
            <button type="button" class="action-btn action-btn-edit edit-exam-btn" data-id="${exam.id}">
              ✏️ Edit
            </button>
            <button type="button" class="action-btn action-btn-preview preview-exam-btn" data-id="${exam.id}" aria-label="Pratinjau ujian">
              👁️ Preview
            </button>
            <button type="button" class="action-btn action-btn-print print-exam-btn" data-id="${exam.id}" aria-label="Cetak PDF">
              🖨️ PDF
            </button>
            <button type="button" class="action-btn action-btn-danger remove-exam-btn" data-id="${exam.id}" aria-label="Hapus ujian">
              🗑️ Hapus
            </button>
          </div>
        </li>
      `;
    })
    .join("");

  updateDashboardStats(exams);

  examListEl.querySelectorAll(".edit-exam-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const examId = btn.dataset.id;
      const exam = examsCache.find((e) => e.id === examId);
      if (exam) {
        openEditExamModal(exam);
      }
    });
  });

  examListEl.querySelectorAll(".remove-exam-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = btn.dataset.id;
      const ok = window.confirm("Apakah Anda yakin ingin menghapus ujian ini?");
      if (!ok) return;

      try {
        feedbackEl.textContent = "Menghapus ujian...";
        await deleteExam(examId);
        feedbackEl.textContent = "Ujian berhasil dihapus.";
        await renderExams();
      } catch (error) {
        feedbackEl.textContent = error.message || "Gagal menghapus ujian.";
      }
    });
  });

  examListEl.querySelectorAll(".preview-exam-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = btn.dataset.id;
      try {
        feedbackEl.textContent = "Memuat pratinjau soal...";
        const loaded = await getExamWithQuestions(examId);
        if (!loaded) {
          throw new Error("Gagal memuat pratinjau.");
        }

        const keysData = await getExamKeys(examId);
        const keysMap = keysData?.keys || {};

        const { exam, questions } = loaded;

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

        modalTitleEl.textContent = `Pratinjau: ${exam.title}`;
        modalQuestionsContainer.innerHTML = "";

        if (mergedQuestions.length === 0) {
          modalQuestionsContainer.innerHTML = "<p class='muted' style='padding: 1rem 0; text-align: center; font-style: italic;'>Ujian ini belum memiliki soal.</p>";
        } else {
          mergedQuestions.forEach((q, idx) => {
            const qWrapper = document.createElement("div");
            qWrapper.className = "card";
            qWrapper.style.background = "rgba(255, 255, 255, 0.4)";
            qWrapper.style.marginBottom = "1rem";
            qWrapper.style.border = "1px solid var(--border)";
            qWrapper.style.padding = "1.25rem";
            
            const header = document.createElement("div");
            header.style.fontWeight = "bold";
            header.style.marginBottom = "0.75rem";
            header.style.color = "var(--brand)";
            header.style.borderBottom = "1px dashed var(--border)";
            header.style.paddingBottom = "0.5rem";
            header.style.display = "flex";
            header.style.justifyContent = "space-between";
            header.innerHTML = `<span>Soal ${idx + 1} (${q.type.toUpperCase()})</span> <small class='muted'>Bobot: ${q.scoreWeight}</small>`;
            qWrapper.appendChild(header);

            const qBody = document.createElement("div");
            qWrapper.appendChild(qBody);
            
            let correctAnswer = undefined;
            if (q.type === "pg" || q.type === "tf") {
              correctAnswer = (q.options || []).find((opt) => opt.isCorrect)?.id;
            } else if (q.type === "pgk") {
              correctAnswer = (q.options || []).filter((opt) => opt.isCorrect).map((opt) => opt.id);
            } else if (q.type === "match") {
              correctAnswer = {};
              (q.matchPairs || []).forEach((pair) => {
                correctAnswer[pair.left] = pair.right;
              });
            } else if (q.type === "tf_matrix") {
              correctAnswer = {};
              (q.statements || []).forEach((stmt) => {
                correctAnswer[stmt.id] = stmt.isCorrect;
              });
            }

            renderQuestion({
              container: qBody,
              question: q,
              currentAnswer: correctAnswer,
              onAnswerChange: () => {},
              readOnly: true,
            });

            modalQuestionsContainer.appendChild(qWrapper);
          });

          renderMathInElement(modalQuestionsContainer, {
            delimiters: [
              { left: "$$", right: "$$", display: true },
              { left: "$", right: "$", display: false },
            ],
            throwOnError: false,
          });
        }

        const modalPrintBtn = document.querySelector("#modal-print-btn");
        if (modalPrintBtn) {
          modalPrintBtn.dataset.id = examId;
        }

        previewModalEl.classList.remove("hidden");
        previewModalEl.setAttribute("aria-hidden", "false");
        feedbackEl.textContent = "";
      } catch (error) {
        feedbackEl.textContent = error.message || "Gagal memuat pratinjau.";
      }
    });
  });

  examListEl.querySelectorAll(".print-exam-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const examId = btn.dataset.id;
      printExamPDF(examId);
    });
  });
};

document
  .querySelector("#create-exam-form")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      feedbackEl.textContent = "Menyimpan ujian...";
      
      const startTimeVal = data.get("startTime");
      const latestStartTimeVal = data.get("latestStartTime");
      
      if (!startTimeVal || !latestStartTimeVal) {
        throw new Error("Waktu Mulai dan Batas Terakhir Mulai harus diisi.");
      }
      
      const startTime = new Date(startTimeVal);
      const latestStartTime = new Date(latestStartTimeVal);
      
      if (latestStartTime <= startTime) {
        throw new Error("Batas Terakhir Mulai harus setelah Waktu Mulai.");
      }

      const visibility = data.get("visibility") || "public";
      const assignedTo = visibility === "private" ? (createStudentPickerInstance ? createStudentPickerInstance.getSelectedUids() : []) : [];

      await createExam({
        title: String(data.get("title") || "").trim(),
        description: String(data.get("description") || "").trim(),
        durationMinutes: Number(data.get("durationMinutes") || 30),
        startTime,
        latestStartTime,
        allowMultipleAttempts: data.get("allowMultipleAttempts") === "true",
        showResultsImmediately: data.get("showResultsImmediately") === "true",
        randomizeQuestions: data.get("randomizeQuestions") === "true",
        active: data.get("active") === "true",
        questionIds: [],
        visibility,
        assignedTo,
      });
      form.reset();
      createStudentPickerInstance?.reset();
      const examVisibilitySelect = document.querySelector("#exam-visibility");
      if (examVisibilitySelect) {
        examVisibilitySelect.value = "public";
        examVisibilitySelect.dispatchEvent(new Event("change"));
      }
      const examRandomizeSelect = document.querySelector("#exam-randomize-questions");
      if (examRandomizeSelect) {
        examRandomizeSelect.value = "false";
        examRandomizeSelect.dispatchEvent(new Event("change"));
      }
      const examActiveSelect = document.querySelector("#exam-active");
      if (examActiveSelect) {
        examActiveSelect.value = "true";
        examActiveSelect.dispatchEvent(new Event("change"));
      }
      feedbackEl.textContent = "Ujian berhasil dibuat.";
      await renderExams();
    } catch (error) {
      feedbackEl.textContent = error.message || "Gagal menyimpan ujian.";
    }
  });



const splitHorizontalOptions = (text) => {
  const regex = /(?:^|\s+)([A-Z])[\.\)]\s+/gi;
  const matches = [];
  let match;
  let expectedCharCode = 97; // charCode of 'a'
  
  while ((match = regex.exec(text)) !== null) {
    const letter = match[1].toLowerCase();
    const charCode = letter.charCodeAt(0);
    
    if (charCode === expectedCharCode) {
      matches.push({
        letter: letter,
        index: match.index,
        fullLength: match[0].length
      });
      expectedCharCode++;
    }
  }

  if (matches.length <= 1) {
    return null;
  }

  const parts = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const startIndex = current.index + current.fullLength;
    const endIndex = next ? next.index : text.length;
    const optionText = text.substring(startIndex, endIndex).trim();
    parts.push({
      letter: current.letter,
      text: optionText
    });
  }
  return parts;
};

const splitOuterEqual = (str, preferLast = false) => {
  const indices = [];
  let inMathSingle = false;
  let inMathDouble = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '$') {
      if (str[i + 1] === '$') {
        inMathDouble = !inMathDouble;
        i++; // skip next $
      } else if (!inMathDouble) {
        inMathSingle = !inMathSingle;
      }
    } else if (char === '=' && !inMathSingle && !inMathDouble) {
      indices.push(i);
    }
  }
  if (indices.length === 0) {
    const fallbackIdx = preferLast ? str.lastIndexOf("=") : str.indexOf("=");
    if (fallbackIdx === -1) return null;
    return [str.substring(0, fallbackIdx).trim(), str.substring(fallbackIdx + 1).trim()];
  }
  const splitIdx = preferLast ? indices[indices.length - 1] : indices[0];
  return [str.substring(0, splitIdx).trim(), str.substring(splitIdx + 1).trim()];
};

const parseImportedHtml = (htmlString) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const paragraphs = [...doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, td")].filter((el) => {
    return !el.parentElement || !el.parentElement.closest("p, h1, h2, h3, h4, h5, h6, li, td");
  });

  const questions = [];
  let currentQuestion = null;

  paragraphs.forEach((p) => {
    const text = p.textContent.trim();
    const htmlContent = p.innerHTML.trim();

    if (!text && !p.querySelector("img")) return;

    const questionMatch = text.match(/^(\d+)[\.\)]\s*(.*)/);
    if (questionMatch) {
      if (currentQuestion) {
        questions.push(currentQuestion);
      }
      currentQuestion = {
        type: "pg",
        scoreWeight: 10,
        contentParts: [],
        options: [],
        matchPairs: [],
        statements: [],
        keyString: "",
      };
      
      const restText = questionMatch[2].trim();
      if (restText) {
        const cleanHtml = htmlContent.replace(/^(\s*(?:<[^>]+>)*\s*)\d+[\.\)]\s*/, "$1");
        currentQuestion.contentParts.push(cleanHtml);
      }
      return;
    }

    if (!currentQuestion) return;

    if (text.toLowerCase().startsWith("tipe:")) {
      currentQuestion.type = text.split(":")[1].trim().toLowerCase();
      return;
    }

    if (text.toLowerCase().startsWith("bobot:")) {
      currentQuestion.scoreWeight = Number(text.split(":")[1].trim()) || 10;
      return;
    }

    if (text.toLowerCase().startsWith("kunci:")) {
      currentQuestion.keyString = text.split(":")[1].trim();
      return;
    }

    if (text.toLowerCase().startsWith("pasangan:")) {
      const contentPart = text.substring(text.indexOf(":") + 1);
      const parts = splitOuterEqual(contentPart, false); // split by first '=' outside math
      if (parts) {
        currentQuestion.matchPairs.push({
          left: parts[0],
          right: parts[1],
        });
      }
      return;
    }

    if (text.toLowerCase().startsWith("pernyataan:")) {
      const contentPart = text.substring(text.indexOf(":") + 1);
      const parts = splitOuterEqual(contentPart, true); // split by last '=' outside math
      if (parts) {
        const stmtText = parts[0];
        const isCorrectVal = parts[1].toLowerCase() === "benar" ? "true" : "false";
        const stmtIndex = currentQuestion.statements.length + 1;
        currentQuestion.statements.push({
          id: `stmt_${stmtIndex}`,
          text: stmtText,
          isCorrect: isCorrectVal,
        });
      }
      return;
    }

    // Check if it's multiple options on one line
    const horizontalOptions = splitHorizontalOptions(text);
    if (horizontalOptions) {
      horizontalOptions.forEach((opt) => {
        currentQuestion.options.push({
          id: `opt_${currentQuestion.options.length + 1}`,
          _importLetter: opt.letter,
          text: opt.text,
          isCorrect: false,
        });
      });
      return;
    }

    // Check if it's a single option on a line
    const optionMatch = text.match(/^([A-Z])[\.\)]\s*(.*)/i);
    if (optionMatch) {
      const letter = optionMatch[1].toLowerCase();
      const optionText = optionMatch[2].trim();
      currentQuestion.options.push({
        id: `opt_${currentQuestion.options.length + 1}`,
        _importLetter: letter,
        text: optionText,
        isCorrect: false,
      });
      return;
    }

    // Default: this is part of the question content
    currentQuestion.contentParts.push(htmlContent);
  });

  if (currentQuestion) {
    questions.push(currentQuestion);
  }

  return questions.map((q) => {
    const content = q.contentParts.map((part) => `<p>${part}</p>`).join("");

    if (q.type === "pg" || q.type === "tf") {
      const keyLetter = q.keyString.trim().toLowerCase();
      if (q.type === "tf") {
        const isTrue = keyLetter === "benar" || keyLetter === "true";
        q.options = [
          { id: "true", text: "Benar", isCorrect: isTrue },
          { id: "false", text: "Salah", isCorrect: !isTrue },
        ];
      } else {
        q.options.forEach((opt) => {
          if (opt._importLetter === keyLetter) {
            opt.isCorrect = true;
          }
        });
      }
    } else if (q.type === "pgk") {
      const correctLetters = q.keyString.split(",").map((s) => s.trim().toLowerCase());
      q.options.forEach((opt) => {
        if (correctLetters.includes(opt._importLetter)) {
          opt.isCorrect = true;
        }
      });
    }

    // Clean up temporary _importLetter properties
    if (q.options) {
      q.options.forEach((opt) => {
        delete opt._importLetter;
      });
    }

    const finalQuestion = {
      type: q.type,
      content: content || "<p>Soal tanpa teks.</p>",
      scoreWeight: q.scoreWeight,
    };

    if (q.type === "pg" || q.type === "pgk" || q.type === "tf") {
      finalQuestion.options = q.options;
    } else if (q.type === "match") {
      finalQuestion.matchPairs = q.matchPairs;
    } else if (q.type === "tf_matrix") {
      finalQuestion.statements = q.statements;
    }

    return finalQuestion;
  });
};



const editExamModalEl = document.querySelector("#edit-exam-modal");
const closeEditExamBtn = document.querySelector("#close-edit-exam-btn");
const cancelEditExamBtn = document.querySelector("#cancel-edit-exam-btn");
const editExamForm = document.querySelector("#edit-exam-form");

const formatDateTimeLocal = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toJsDate = (val) => {
  if (!val) return null;
  return val.toDate ? val.toDate() : new Date(val);
};

const openEditExamModal = (exam) => {
  document.querySelector("#edit-exam-id").value = exam.id;
  document.querySelector("#edit-exam-title").value = exam.title;
  document.querySelector("#edit-exam-description").value = exam.description || "";
  document.querySelector("#edit-exam-duration").value = exam.durationMinutes || 30;
  
  const startTime = toJsDate(exam.startTime);
  const latestStartTime = toJsDate(exam.latestStartTime);
  
  document.querySelector("#edit-exam-start-time").value = formatDateTimeLocal(startTime);
  document.querySelector("#edit-exam-latest-start-time").value = formatDateTimeLocal(latestStartTime);
  
  const allowMultipleAttempts = exam.allowMultipleAttempts ?? true;
  const showResultsImmediately = exam.showResultsImmediately ?? true;
  const randomizeQuestions = exam.randomizeQuestions ?? false;
  
  const attemptsEl = document.querySelector("#edit-exam-attempts-policy");
  const resultsEl = document.querySelector("#edit-exam-results-policy");
  const randomizeQuestionsEl = document.querySelector("#edit-exam-randomize-questions");
  
  if (attemptsEl) {
    attemptsEl.value = String(allowMultipleAttempts);
    attemptsEl.dispatchEvent(new Event("change"));
  }
  if (resultsEl) {
    resultsEl.value = String(showResultsImmediately);
    resultsEl.dispatchEvent(new Event("change"));
  }
  if (randomizeQuestionsEl) {
    randomizeQuestionsEl.value = String(randomizeQuestions);
    randomizeQuestionsEl.dispatchEvent(new Event("change"));
  }

  const visibility = exam.visibility || "public";
  const assignedTo = exam.assignedTo || [];
  const visibilityEl = document.querySelector("#edit-exam-visibility");
  if (visibilityEl) {
    visibilityEl.value = visibility;
    visibilityEl.dispatchEvent(new Event("change"));
  }

  const active = exam.active ?? true;
  const activeEl = document.querySelector("#edit-exam-active");
  if (activeEl) {
    activeEl.value = String(active);
    activeEl.dispatchEvent(new Event("change"));
  }

  editStudentPickerInstance?.setSelectedUids(assignedTo);

  editExamModalEl.classList.remove("hidden");
  editExamModalEl.setAttribute("aria-hidden", "false");
};

closeEditExamBtn?.addEventListener("click", () => {
  editExamModalEl.classList.add("hidden");
  editExamModalEl.setAttribute("aria-hidden", "true");
});

cancelEditExamBtn?.addEventListener("click", () => {
  editExamModalEl.classList.add("hidden");
  editExamModalEl.setAttribute("aria-hidden", "true");
});

editExamModalEl?.addEventListener("click", (e) => {
  if (e.target === editExamModalEl) {
    editExamModalEl.classList.add("hidden");
    editExamModalEl.setAttribute("aria-hidden", "true");
  }
});

editExamForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const examId = document.querySelector("#edit-exam-id").value;
  const title = document.querySelector("#edit-exam-title").value.trim();
  const description = document.querySelector("#edit-exam-description").value.trim();
  const durationMinutes = Number(document.querySelector("#edit-exam-duration").value);
  const startTimeVal = document.querySelector("#edit-exam-start-time").value;
  const latestStartTimeVal = document.querySelector("#edit-exam-latest-start-time").value;

  const allowMultipleAttempts = document.querySelector("#edit-exam-attempts-policy")?.value === "true";
  const showResultsImmediately = document.querySelector("#edit-exam-results-policy")?.value === "true";
  const randomizeQuestions = document.querySelector("#edit-exam-randomize-questions")?.value === "true";
  const active = document.querySelector("#edit-exam-active")?.value === "true";
  const visibility = document.querySelector("#edit-exam-visibility")?.value || "public";
  const assignedTo = visibility === "private" ? (editStudentPickerInstance ? editStudentPickerInstance.getSelectedUids() : []) : [];
 
  try {
    feedbackEl.textContent = "Menyimpan perubahan...";
    
    if (!startTimeVal || !latestStartTimeVal) {
      throw new Error("Waktu Mulai dan Batas Terakhir Mulai harus diisi.");
    }
    
    const startTime = new Date(startTimeVal);
    const latestStartTime = new Date(latestStartTimeVal);
    
    if (latestStartTime <= startTime) {
      throw new Error("Batas Terakhir Mulai harus setelah Waktu Mulai.");
    }

    await updateExamDetails(examId, {
      title,
      description,
      durationMinutes,
      startTime,
      latestStartTime,
      allowMultipleAttempts,
      showResultsImmediately,
      randomizeQuestions,
      active,
      visibility,
      assignedTo
    });

    editExamModalEl.classList.add("hidden");
    editExamModalEl.setAttribute("aria-hidden", "true");
    feedbackEl.textContent = "Data ujian berhasil diperbarui.";
    await renderExams();
  } catch (error) {
    feedbackEl.textContent = error.message || "Gagal memperbarui ujian.";
    alert(error.message || "Gagal memperbarui ujian.");
  }
});

closeModalBtn?.addEventListener("click", () => {
  previewModalEl.classList.add("hidden");
  previewModalEl.setAttribute("aria-hidden", "true");
});

previewModalEl?.addEventListener("click", (e) => {
  if (e.target === previewModalEl) {
    previewModalEl.classList.add("hidden");
    previewModalEl.setAttribute("aria-hidden", "true");
  }
});

document.querySelector("#logout-btn")?.addEventListener("click", async () => {
  await logout();
  window.location.replace("/");
});


// ── Rekapitulasi & Koreksi Essay Manual ─────────────────────────────────



/* ── Editor Soal Interaktif (Word Import & Export) ─────────────────────── */

let editorQuestions = [];
let selectedEditorQIndex = null;
let editorTempImages = {}; // Map of placeholder -> base64 data URL
window.editQuill = null;

const initQuillEditor = () => {
  if (window.editQuill) return;
  
  const container = document.querySelector("#edit-q-quill-editor");
  if (!container) return;
  
  window.editQuill = new Quill("#edit-q-quill-editor", {
    theme: "snow",
    placeholder: "Ketik teks soal atau masukkan LaTeX / gambar...",
    modules: {
      toolbar: [
        ["bold", "italic", "underline", "strike"],
        [{ "list": "ordered"}, { "list": "bullet" }],
        [{ "direction": "rtl" }],
        ["clean"]
      ]
    }
  });

  window.editQuill.on("text-change", () => {
    const rawHtml = window.editQuill.root.innerHTML;
    const cleanHtml = extractBase64ImagesToPlaceholders(rawHtml);
    const textarea = document.querySelector("#edit-q-content");
    if (textarea && textarea.value !== cleanHtml) {
      textarea.value = cleanHtml;
      textarea.dispatchEvent(new Event("input"));
    }
  });
};

const editDynamicFieldsEl = document.querySelector("#edit-dynamic-fields");
const editAddRowBtn = document.querySelector("#edit-add-row-btn");

const addEditorOptionRow = (container, type, text = "", isCorrect = false, index) => {
  const inputType = type === "pgk" ? "checkbox" : "radio";
  const row = document.createElement("div");
  row.className = "option-row";
  row.innerHTML = `
    <input
      type="${inputType}"
      name="edit-correct-option"
      value="opt_${index}"
      ${isCorrect ? "checked" : ""}
      title="Tandai sebagai jawaban benar"
      aria-label="Jawaban benar pilihan ${index}"
    />
    <input
      type="text"
      class="option-text"
      placeholder="Teks pilihan"
      value="${text.replace(/"/g, '&quot;')}"
      dir="auto"
      required
    />
    <button type="button" class="remove-row-btn" aria-label="Hapus baris">✕</button>
  `;
  row.querySelector(".remove-row-btn").addEventListener("click", () => {
    row.remove();
    syncRemoveButtons(container);
    reindexEditorRadioValues(container);
    updateEditFormPreview();
  });
  container.appendChild(row);
  syncRemoveButtons(container);
};

const reindexEditorRadioValues = (container) => {
  container.querySelectorAll(".option-row").forEach((row, i) => {
    const input = row.querySelector("input[type='radio'], input[type='checkbox']");
    if (input) {
      input.value = `opt_${i + 1}`;
    }
  });
};

const addEditorMatchRow = (container, left = "", right = "", index) => {
  const row = document.createElement("div");
  row.className = "match-pair-row";
  row.innerHTML = `
    <input
      type="text"
      class="match-left"
      placeholder="Item kiri ${index}"
      value="${left.replace(/"/g, '&quot;')}"
      dir="auto"
      required
    />
    <span class="match-pair-sep">→</span>
    <input
      type="text"
      class="match-right"
      placeholder="Pasangan kanan ${index}"
      value="${right.replace(/"/g, '&quot;')}"
      dir="auto"
      required
    />
    <button type="button" class="remove-row-btn" aria-label="Hapus pasangan">✕</button>
  `;
  row.querySelector(".remove-row-btn").addEventListener("click", () => {
    row.remove();
    syncRemoveButtons(container);
    updateEditFormPreview();
  });
  container.appendChild(row);
  syncRemoveButtons(container);
};

const reindexEditorMatrixNames = (container) => {
  container.querySelectorAll(".matrix-statement-row").forEach((row, i) => {
    const inputs = row.querySelectorAll("input[type='radio']");
    inputs.forEach((input) => {
      input.name = `edit_correct_stmt_${i + 1}`;
    });
  });
};

const addEditorMatrixRow = (container, text = "", isCorrect = "true", index) => {
  const isTrue = isCorrect === "true" || isCorrect === true;
  const row = document.createElement("div");
  row.className = "matrix-statement-row option-row";
  row.innerHTML = `
    <input
      type="text"
      class="statement-text"
      placeholder="Pernyataan ${index}"
      value="${text.replace(/"/g, '&quot;')}"
      dir="auto"
      required
      style="flex: 1;"
    />
    <div class="tf-toggle" style="display: flex; gap: 0.5rem; flex-shrink: 0; align-items: center;">
      <label style="margin: 0; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: normal; cursor: pointer;">
        <input type="radio" name="edit_correct_stmt_${index}" value="true" ${isTrue ? "checked" : ""} /> B
      </label>
      <label style="margin: 0; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: normal; cursor: pointer;">
        <input type="radio" name="edit_correct_stmt_${index}" value="false" ${!isTrue ? "checked" : ""} /> S
      </label>
    </div>
    <button type="button" class="remove-row-btn" aria-label="Hapus pernyataan">✕</button>
  `;
  row.querySelector(".remove-row-btn").addEventListener("click", () => {
    row.remove();
    syncRemoveButtons(container);
    reindexEditorMatrixNames(container);
    updateEditFormPreview();
  });
  container.appendChild(row);
  syncRemoveButtons(container);
};

const scrollEditorAndPreviewToBottom = () => {
  setTimeout(() => {
    const formScroll = document.querySelector(".editor-form-scroll");
    const previewScroll = document.querySelector(".preview-scroll-wrapper");
    if (formScroll) {
      formScroll.scrollTo({
        top: formScroll.scrollHeight,
        behavior: "smooth"
      });
    }
    if (previewScroll) {
      previewScroll.scrollTo({
        top: previewScroll.scrollHeight,
        behavior: "smooth"
      });
    }
  }, 80);
};

const buildEditorDynamicFields = (type, data = null) => {
  editDynamicFieldsEl.innerHTML = "";
  editAddRowBtn.classList.remove("hidden");

  if (type === "pg" || type === "pgk") {
    editAddRowBtn.textContent = "+ Tambah Pilihan";
    
    const options = data?.options || [];
    if (options.length > 0) {
      options.forEach((opt, i) => {
        addEditorOptionRow(editDynamicFieldsEl, type, opt.text, opt.isCorrect, i + 1);
      });
    } else {
      for (let i = 1; i <= MIN_ROWS; i += 1) {
        addEditorOptionRow(editDynamicFieldsEl, type, "", false, i);
      }
    }
    
    editAddRowBtn.onclick = () => {
      const nextIndex = editDynamicFieldsEl.querySelectorAll(".option-row").length + 1;
      addEditorOptionRow(editDynamicFieldsEl, type, "", false, nextIndex);
      updateEditFormPreview();
      scrollEditorAndPreviewToBottom();
    };
    return;
  }

  if (type === "tf") {
    editAddRowBtn.classList.add("hidden");
    const isTrue = (data?.options || []).find(o => o.id === "true")?.isCorrect ?? true;
    editDynamicFieldsEl.innerHTML = `
      <div class="tf-options">
        <label>
          <input type="radio" name="edit-tf-correct" value="true" ${isTrue ? "checked" : ""} />
          Benar (True) — jadikan jawaban benar
        </label>
        <label>
          <input type="radio" name="edit-tf-correct" value="false" ${!isTrue ? "checked" : ""} />
          Salah (False) — jadikan jawaban benar
        </label>
      </div>
    `;
    return;
  }

  if (type === "essay") {
    editAddRowBtn.classList.add("hidden");
    editDynamicFieldsEl.innerHTML = `
      <p class="field-hint">Soal Essay tidak memiliki opsi atau kunci pilihan. Siswa akan mengisinya secara bebas.</p>
    `;
    return;
  }

  if (type === "match") {
    editAddRowBtn.textContent = "+ Tambah Pasangan";
    
    const pairs = data?.matchPairs || [];
    if (pairs.length > 0) {
      pairs.forEach((pair, i) => {
        addEditorMatchRow(editDynamicFieldsEl, pair.left, pair.right, i + 1);
      });
    } else {
      for (let i = 1; i <= MIN_ROWS; i += 1) {
        addEditorMatchRow(editDynamicFieldsEl, "", "", i);
      }
    }
    
    editAddRowBtn.onclick = () => {
      const nextIndex = editDynamicFieldsEl.querySelectorAll(".match-pair-row").length + 1;
      addEditorMatchRow(editDynamicFieldsEl, "", "", nextIndex);
      updateEditFormPreview();
      scrollEditorAndPreviewToBottom();
    };
    return;
  }

  if (type === "tf_matrix") {
    editAddRowBtn.textContent = "+ Tambah Pernyataan";
    
    const statements = data?.statements || [];
    if (statements.length > 0) {
      statements.forEach((stmt, i) => {
        addEditorMatrixRow(editDynamicFieldsEl, stmt.text, stmt.isCorrect, i + 1);
      });
    } else {
      for (let i = 1; i <= MIN_ROWS; i += 1) {
        addEditorMatrixRow(editDynamicFieldsEl, "", "true", i);
      }
    }
    
    editAddRowBtn.onclick = () => {
      const nextIndex = editDynamicFieldsEl.querySelectorAll(".matrix-statement-row").length + 1;
      addEditorMatrixRow(editDynamicFieldsEl, "", "true", nextIndex);
      updateEditFormPreview();
      scrollEditorAndPreviewToBottom();
    };
  }
};

const collectPayloadFromEditorFields = (type) => {
  if (type === "pg" || type === "pgk") {
    const rows = [...editDynamicFieldsEl.querySelectorAll(".option-row")];
    const options = rows.map((row, index) => {
      const textEl = row.querySelector(".option-text");
      const correctEl = row.querySelector("input[name='edit-correct-option']");
      const text = textEl?.value.trim() || "";
      if (!text) {
        throw new Error(`Teks pilihan baris ${index + 1} tidak boleh kosong.`);
      }
      return {
        id: correctEl?.value || `opt_${index + 1}`,
        text,
        isCorrect: Boolean(correctEl?.checked),
      };
    });

    const correctCount = options.filter((opt) => opt.isCorrect).length;
    if (type === "pg" && correctCount !== 1) {
      throw new Error("PG wajib tepat satu jawaban benar.");
    }
    if (type === "pgk" && correctCount < 1) {
      throw new Error("PGK wajib minimal satu jawaban benar.");
    }

    return { options };
  }

  if (type === "tf") {
    const selected = editDynamicFieldsEl.querySelector("input[name='edit-tf-correct']:checked")?.value;
    const trueCorrect = selected === "true";
    return {
      options: [
        { id: "true", text: "Benar", isCorrect: trueCorrect },
        { id: "false", text: "Salah", isCorrect: !trueCorrect },
      ],
    };
  }

  if (type === "essay") {
    return {};
  }

  if (type === "match") {
    const rows = [...editDynamicFieldsEl.querySelectorAll(".match-pair-row")];
    const matchPairs = rows.map((row, index) => {
      const left = row.querySelector(".match-left")?.value.trim() || "";
      const right = row.querySelector(".match-right")?.value.trim() || "";
      if (!left || !right) {
        throw new Error(`Pasangan baris ${index + 1} harus diisi lengkap (kiri dan kanan).`);
      }
      return { left, right };
    });
    return { matchPairs };
  }

  if (type === "tf_matrix") {
    const rows = [...editDynamicFieldsEl.querySelectorAll(".matrix-statement-row")];
    const statements = rows.map((row, index) => {
      const textEl = row.querySelector(".statement-text");
      const selectedRadio = row.querySelector("input[type='radio']:checked");
      const text = textEl?.value.trim() || "";
      if (!text) {
        throw new Error(`Teks pernyataan baris ${index + 1} tidak boleh kosong.`);
      }
      return {
        id: `stmt_${index + 1}`,
        text,
        isCorrect: selectedRadio?.value || "true",
      };
    });
    return { statements };
  }

  return {};
};

const extractBase64ImagesToPlaceholders = (htmlString) => {
  if (!htmlString) return "";
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlString;
  const imgs = tempDiv.querySelectorAll("img");
  imgs.forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (src.startsWith("data:image")) {
      const placeholderId = `temp_img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      editorTempImages[placeholderId] = src;
      img.setAttribute("src", placeholderId);
    }
  });
  return tempDiv.innerHTML;
};

const collectPayloadForPreview = (type) => {
  if (type === "pg" || type === "pgk") {
    const rows = [...editDynamicFieldsEl.querySelectorAll(".option-row")];
    const options = rows.map((row, index) => {
      const textEl = row.querySelector(".option-text");
      const correctEl = row.querySelector("input[name='edit-correct-option']");
      const text = textEl?.value || "";
      return {
        id: correctEl?.value || `opt_${index + 1}`,
        text: text || `Pilihan ${index + 1}`,
        isCorrect: Boolean(correctEl?.checked),
      };
    });
    return { options };
  }

  if (type === "tf") {
    const selected = editDynamicFieldsEl.querySelector("input[name='edit-tf-correct']:checked")?.value;
    const trueCorrect = selected === "true";
    return {
      options: [
        { id: "true", text: "Benar", isCorrect: trueCorrect },
        { id: "false", text: "Salah", isCorrect: !trueCorrect },
      ],
    };
  }

  if (type === "essay") {
    return {};
  }

  if (type === "match") {
    const rows = [...editDynamicFieldsEl.querySelectorAll(".match-pair-row")];
    const matchPairs = rows.map((row, index) => {
      const left = row.querySelector(".match-left")?.value || "";
      const right = row.querySelector(".match-right")?.value || "";
      return {
        left: left || `Item Kiri ${index + 1}`,
        right: right || `Pasangan Kanan ${index + 1}`
      };
    });
    return { matchPairs };
  }

  if (type === "tf_matrix") {
    const rows = [...editDynamicFieldsEl.querySelectorAll(".matrix-statement-row")];
    const statements = rows.map((row, index) => {
      const textEl = row.querySelector(".statement-text");
      const selectedRadio = row.querySelector("input[type='radio']:checked");
      const text = textEl?.value || "";
      return {
        id: `stmt_${index + 1}`,
        text: text || `Pernyataan ${index + 1}`,
        isCorrect: selectedRadio?.value || "true",
      };
    });
    return { statements };
  }

  return {};
};

const getCorrectAnswersAsCurrentAnswer = (type, payload) => {
  if (type === "pg") {
    const correctOpt = (payload.options || []).find(o => o.isCorrect);
    return correctOpt ? correctOpt.id : "";
  }
  if (type === "tf") {
    const correctOpt = (payload.options || []).find(o => o.isCorrect);
    return correctOpt ? correctOpt.id : "";
  }
  if (type === "pgk") {
    return (payload.options || []).filter(o => o.isCorrect).map(o => o.id);
  }
  if (type === "match") {
    const answers = {};
    (payload.matchPairs || []).forEach(pair => {
      if (pair.left) {
        answers[pair.left] = pair.right;
      }
    });
    return answers;
  }
  if (type === "tf_matrix") {
    const answers = {};
    (payload.statements || []).forEach(stmt => {
      answers[stmt.id] = String(stmt.isCorrect);
    });
    return answers;
  }
  return "";
};

const updateEditFormPreview = () => {
  const previewScroll = document.querySelector(".preview-scroll-wrapper");
  const currentScrollTop = previewScroll ? previewScroll.scrollTop : 0;

  const previewBox = document.querySelector("#edit-q-preview-box");
  const textarea = document.querySelector("#edit-q-content");
  const qTypeSelect = document.querySelector("#edit-q-type");
  const scoreInput = document.querySelector("#edit-q-score");
  if (!previewBox || !textarea || !qTypeSelect) return;

  const type = qTypeSelect.value;
  const scoreWeight = parseInt(scoreInput?.value || "10", 10);
  const rawContent = textarea.value.trim();

  // 1. Resolve memory placeholders
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = rawContent || "<p class='muted' style='font-style: italic; margin: 0;'>Belum ada konten teks soal.</p>";
  const imgs = tempDiv.querySelectorAll("img");
  imgs.forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (editorTempImages[src]) {
      img.setAttribute("src", editorTempImages[src]);
    }
  });
  const resolvedContent = tempDiv.innerHTML;

  // 2. Gather active inputs for the options/statements/pairs
  const payload = collectPayloadForPreview(type);

  // 3. Assemble the mock question
  const tempQuestion = {
    id: "preview_q",
    type: type,
    content: resolvedContent,
    scoreWeight: scoreWeight,
    ...payload
  };

  // 4. Gather the mock correct answers
  const correctAnswer = getCorrectAnswersAsCurrentAnswer(type, payload);

  // 5. Render using questionRenderer
  renderQuestion({
    container: previewBox,
    question: tempQuestion,
    currentAnswer: correctAnswer,
    onAnswerChange: () => {}, // Read-only preview
    readOnly: true,
  });

  // 6. Run KaTeX auto-render on the previewBox
  renderMathInElement(previewBox, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
  });

  // Restore the scroll position so it doesn't jump back to the top
  if (previewScroll) {
    previewScroll.scrollTop = currentScrollTop;
  }
};

const selectEditorQuestion = (idx) => {
  selectedEditorQIndex = idx;
  const q = editorQuestions[idx];
  
  const formCard = document.querySelector("#editor-active-form-card");
  const previewCard = document.querySelector("#editor-preview-card");
  
  formCard.classList.remove("hidden");
  previewCard.classList.remove("hidden");
  
  document.querySelector("#editor-form-title").textContent = `Penyuntingan Detail Soal #${idx + 1}`;
  
  document.querySelector("#edit-q-type").value = q.type;
  document.querySelector("#edit-q-content").value = q.content;
  document.querySelector("#edit-q-score").value = q.scoreWeight || 10;
  
  if (window.editQuill) {
    // Resolve memory placeholders to base64 so they render nicely inside the editor as well!
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = q.content;
    const imgs = tempDiv.querySelectorAll("img");
    imgs.forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (editorTempImages[src]) {
        img.setAttribute("src", editorTempImages[src]);
      }
    });
    window.editQuill.clipboard.dangerouslyPasteHTML(tempDiv.innerHTML);
  }
  
  buildEditorDynamicFields(q.type, q);
  updateEditFormPreview();
  renderEditorList();
  
  // Rerun KaTeX rendering on the preview elements to format LaTeX nicely in editor list
  const container = document.querySelector("#editor-questions-list");
  if (container) {
    renderMathInElement(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }

  // Auto-scroll active card into view inside the bottom dock
  const activeCard = document.querySelector(`#mini-q-card-${idx}`);
  if (activeCard) {
    activeCard.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
};

const deleteEditorQuestion = (idx) => {
  const ok = window.confirm(`Apakah Anda yakin ingin menghapus soal #${idx + 1} dari editor?`);
  if (!ok) return;

  editorQuestions.splice(idx, 1);

  if (selectedEditorQIndex === idx) {
    selectedEditorQIndex = null;
    document.querySelector("#editor-active-form-card").classList.add("hidden");
    document.querySelector("#editor-preview-card").classList.add("hidden");
  } else if (selectedEditorQIndex > idx) {
    selectedEditorQIndex--;
  }

  renderEditorList();
  if (selectedEditorQIndex !== null) {
    selectEditorQuestion(selectedEditorQIndex);
  }
};

const moveEditorQuestion = (idx, dir) => {
  if (dir === "up" && idx > 0) {
    const temp = editorQuestions[idx];
    editorQuestions[idx] = editorQuestions[idx - 1];
    editorQuestions[idx - 1] = temp;
    
    if (selectedEditorQIndex === idx) {
      selectedEditorQIndex = idx - 1;
    } else if (selectedEditorQIndex === idx - 1) {
      selectedEditorQIndex = idx;
    }
  } else if (dir === "down" && idx < editorQuestions.length - 1) {
    const temp = editorQuestions[idx];
    editorQuestions[idx] = editorQuestions[idx + 1];
    editorQuestions[idx + 1] = temp;
    
    if (selectedEditorQIndex === idx) {
      selectedEditorQIndex = idx + 1;
    } else if (selectedEditorQIndex === idx + 1) {
      selectedEditorQIndex = idx;
    }
  }
  
  renderEditorList();
  if (selectedEditorQIndex !== null) {
    selectEditorQuestion(selectedEditorQIndex);
  }
};

const renderEditorList = () => {
  const container = document.querySelector("#editor-questions-list");
  const countEl = document.querySelector("#editor-questions-count");
  if (!container || !countEl) return;

  countEl.textContent = editorQuestions.length;

  if (editorQuestions.length === 0) {
    container.innerHTML = `
      <div class="muted" style="text-align: center; width: 100%; padding: 2rem 1rem; font-style: italic; background: rgba(255,255,255,0.3); border: 1.5px dashed var(--border); border-radius: 12px; font-size: 0.9rem;">
        Belum ada soal. Silakan muat soal dari ujian aktif, impor dari Word, atau tambah soal baru.
      </div>
    `;
    document.querySelector("#editor-active-form-card").classList.add("hidden");
    document.querySelector("#editor-preview-card").classList.add("hidden");
    return;
  }

  container.innerHTML = editorQuestions.map((q, idx) => {
    // Strip HTML for simple text preview, but keep math symbols
    const temp = document.createElement("div");
    temp.innerHTML = q.content;
    const plainText = temp.textContent.trim() || "(Soal bergambar/tanpa teks)";
    
    const isSelected = selectedEditorQIndex === idx;
    const activeClass = isSelected ? "active" : "";

    return `
      <div class="mini-q-card ${activeClass}" data-index="${idx}" id="mini-q-card-${idx}">
        <div class="mini-q-card-header">
          <div>
            <strong style="color: var(--brand); font-size: 0.9rem;">#${idx + 1}</strong>
            <span class="badge" style="background: var(--brand-light); color: var(--brand); font-size: 0.7rem; font-weight: 700; margin-left: 0.25rem; padding: 0.05rem 0.35rem; border-radius: 4px;">
              ${q.type.toUpperCase()}
            </span>
          </div>
          <small class="muted" style="font-size: 0.75rem;">Skor: ${q.scoreWeight || 100}</small>
        </div>
        
        <div class="mini-q-card-body" dir="auto">
          ${plainText}
        </div>
        
        <div class="mini-q-card-actions">
          <div style="display: flex; gap: 0.25rem;">
            <button type="button" class="editor-left-btn secondary mini" data-index="${idx}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;" ${idx === 0 ? "disabled" : ""}>
              ←
            </button>
            <button type="button" class="editor-right-btn secondary mini" data-index="${idx}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;" ${idx === editorQuestions.length - 1 ? "disabled" : ""}>
              →
            </button>
          </div>
          <button type="button" class="editor-delete-btn danger mini" data-index="${idx}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem; background: #fee2e2; color: #ef4444; border: none; border-radius: 4px;">
            Hapus
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Attach click listeners to cards for selecting
  container.querySelectorAll(".mini-q-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      // Prevent selecting when clicking inner buttons
      if (e.target.closest("button")) return;
      const idx = parseInt(card.dataset.index, 10);
      selectEditorQuestion(idx);
    });
  });

  // Attach event listeners to Left shifts
  container.querySelectorAll(".editor-left-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      moveEditorQuestion(idx, "up"); // Internally shifts question left
    });
  });

  // Attach event listeners to Right shifts
  container.querySelectorAll(".editor-right-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      moveEditorQuestion(idx, "down"); // Internally shifts question right
    });
  });

  // Attach event listeners to Deletes
  container.querySelectorAll(".editor-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      deleteEditorQuestion(idx);
    });
  });
};



const printExamPDF = async (examId) => {
  if (!examId) {
    alert("ID Ujian tidak valid.");
    return;
  }

  try {
    feedbackEl.textContent = "Menyiapkan cetakan PDF...";
    const loaded = await getExamWithQuestions(examId);
    if (!loaded) {
      alert("Ujian tidak ditemukan.");
      return;
    }

    const { exam, questions } = loaded;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Gagal membuka jendela cetak. Pastikan pop-up blocker Anda dinonaktifkan.");
      return;
    }

    let html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Cetak Soal: ${exam.title}</title>
  
  <!-- CSS KaTeX -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
  
  <!-- CSS Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
  
  <!-- JS KaTeX -->
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"></script>

  <style>
    body {
      font-family: 'Inter', sans-serif;
      margin: 0;
      padding: 20px;
      color: #1e293b;
      line-height: 1.5;
      font-size: 12px;
      background: #f1f5f9;
    }
    
    @page {
      size: A4;
      margin: 0;
    }
    
    .print-page {
      background: #fff;
      width: 210mm;
      height: 297mm;
      padding: 15mm;
      margin: 0 auto 20px auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    
    .questions-container-page {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
      height: 100%;
    }
    
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: none !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      
      .print-page {
        width: 210mm !important;
        height: 296mm !important; /* 1mm safety margin to prevent decimal rounding overflow blank pages */
        margin: 0 !important;
        padding: 15mm !important;
        box-shadow: none !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      
      .print-page:not(:last-child) {
        page-break-after: always !important;
        break-after: always !important;
      }
      
      .questions-container-page {
        height: 100% !important;
      }
      
      .question-row {
        flex: 1 1 auto !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        overflow: visible !important;
      }
      
      .no-print {
        display: none !important;
      }
    }
    
    .print-header {
      display: flex;
      justify-content: space-between;
      align-items: stretch;
      margin-bottom: 10px;
    }
    
    .header-left {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    
    .exam-title {
      font-family: 'Outfit', sans-serif;
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 10px 0;
      color: #0f172a;
      line-height: 1.25;
    }
    
    .student-info-table {
      border-collapse: collapse;
      width: 100%;
      max-width: 480px;
    }
    
    .student-info-table td {
      padding: 4px 0;
      font-size: 11px;
    }
    
    .student-info-table td.label {
      width: 130px;
      white-space: nowrap;
      font-weight: 600;
      color: #475569;
    }
    
    .student-info-table td.dots {
      color: #94a3b8;
    }
    
    .header-right {
      width: 120px;
      margin-left: 20px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
    
    .score-box {
      border: 1.5px solid #0f172a;
      border-radius: 8px;
      width: 100px;
      height: 100px;
      display: flex;
      flex-direction: column;
      text-align: center;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    
    .score-title {
      background: #f8fafc;
      border-bottom: 1.5px solid #0f172a;
      font-family: 'Outfit', sans-serif;
      font-size: 9.5px;
      font-weight: 700;
      padding: 5px 0;
      letter-spacing: 0.05em;
      color: #334155;
    }
    
    .score-area {
      flex: 1;
      background: #fff;
    }
    
    .header-divider {
      border-top: 3px double #0f172a;
      margin: 0 0 12px 0;
    }
    
    .questions-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .question-row {
      display: flex;
      border: 1.5px solid #0f172a;
      border-radius: 6px;
      background: #fff;
      overflow: hidden;
      flex: 1 1 auto;
      min-height: 160px;
    }
    
    .question-cell {
      padding: 10px 14px;
      box-sizing: border-box;
    }
    
    .question-left {
      width: 50%;
      border-right: 1.5px solid #0f172a;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .question-right {
      width: 50%;
      background: #fff;
      min-height: 160px;
    }
    
    .question-badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid #1e293b;
      border-radius: 9999px;
      padding: 2px 8px;
      font-size: 8.5px;
      font-weight: 700;
      width: fit-content;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #1e293b;
      margin-bottom: 4px;
    }
    
    .question-number {
      font-weight: 700;
      color: #0f172a;
      margin-right: 4px;
      flex-shrink: 0;
    }
    
    .question-content {
      font-size: 12px;
      color: #1e293b;
      line-height: 1.5;
      flex: 1;
    }
    
    .question-content p {
      margin: 0 0 8px 0;
    }
    
    .question-content p:last-child {
      margin-bottom: 0;
    }
    
    .question-content img {
      max-width: 100%;
      height: auto;
      margin: 8px 0;
      border-radius: 4px;
    }
    
    /* Option layout */
    .print-options-list {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .print-option-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 11.5px;
    }
    
    .option-indicator {
      display: inline-block;
      width: 13px;
      height: 13px;
      border: 1px solid #334155;
      margin-top: 1.5px;
      flex-shrink: 0;
    }
    
    .option-indicator.radio {
      border-radius: 50%;
    }
    
    .option-indicator.checkbox {
      border-radius: 2px;
    }
    
    .option-letter {
      font-weight: 600;
      color: #334155;
      flex-shrink: 0;
    }
    
    .option-text {
      flex: 1;
    }
    
    /* Matrix Table Style */
    .print-matrix-table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 10px;
      font-size: 11px;
    }
    
    .print-matrix-table th, .print-matrix-table td {
      border: 1px solid #94a3b8;
      padding: 4px 6px;
      text-align: left;
    }
    
    .print-matrix-table th {
      background: #f8fafc;
      font-weight: 600;
      color: #334155;
    }
    
    .print-matrix-table td.center {
      text-align: center;
      width: 45px;
    }
    
    .matrix-box {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 1.2px solid #334155;
      border-radius: 2px;
      vertical-align: middle;
    }
    
    /* Matching Pairs Style */
    .print-match-container {
      display: flex;
      gap: 15px;
      margin-top: 10px;
      font-size: 11px;
    }
    
    .print-match-left {
      flex: 1.1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .print-match-right {
      flex: 0.9;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-left: 1px dashed #cbd5e1;
      padding-left: 15px;
    }
    
    .print-match-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    
    .match-slot {
      border-bottom: 1px solid #1e293b;
      width: 30px;
      height: 18px;
      margin: 0 4px;
      display: inline-block;
      vertical-align: bottom;
      text-align: center;
    }
    
    /* Utilities */
    [dir="auto"] {
      text-align: left;
    }
    
    [dir="auto"]:lang(ar) {
      text-align: right;
      direction: rtl;
    }
  </style>
</head>
<body>

  <!-- Floating Print Controls (Only visible in browser preview, hidden in print) -->
  <div class="no-print" style="position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; gap: 10px;">
    <button onclick="window.print()" style="background: #1e293b; color: white; border: none; padding: 10px 20px; font-weight: 600; font-family: inherit; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      🖨️ Cetak Lembar Kerja
    </button>
    <button onclick="window.close()" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 10px 20px; font-weight: 600; font-family: inherit; border-radius: 8px; cursor: pointer;">
      Tutup
    </button>
  </div>

  <div id="temp-render-container" style="width: 210mm; padding: 15mm; box-sizing: border-box; background: #fff; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
    <div class="print-header">
      <div class="header-left">
        <h1 class="exam-title">${exam.title}</h1>
        
        <table class="student-info-table">
          <tr>
            <td class="label">NAMA SISWA</td>
            <td style="width: 10px;">:</td>
            <td class="dots">....................................................................................</td>
          </tr>
          <tr>
            <td class="label">KELAS</td>
            <td>:</td>
            <td class="dots">....................................................................................</td>
          </tr>
          <tr>
            <td class="label">HARI, TANGGAL</td>
            <td>:</td>
            <td class="dots">....................................................................................</td>
          </tr>
        </table>
      </div>
      
      <div class="header-right">
        <div class="score-box">
          <div class="score-title">NILAI</div>
          <div class="score-area"></div>
        </div>
      </div>
    </div>

    <div class="header-divider"></div>

    <div class="questions-container" style="display: flex; flex-direction: column; gap: 10px;">
`;

    questions.forEach((q, idx) => {
      let badgeText = "";
      switch (q.type) {
        case "pg": badgeText = "Pilihan Ganda"; break;
        case "pgk": badgeText = "Pilihan Ganda Kompleks"; break;
        case "tf": badgeText = "Benar / Salah"; break;
        case "tf_matrix": badgeText = "Pernyataan"; break;
        case "match": badgeText = "Menjodohkan"; break;
        case "essay": badgeText = "Essay"; break;
        default: badgeText = "Soal";
      }
      
      let badgeHtml = `<div class="question-badge">${badgeText}</div>`;
      let qBodyHtml = "";
      
      if (q.type === "pg" || q.type === "tf" || q.type === "pgk") {
        const isCheckbox = q.type === "pgk";
        const indicatorClass = isCheckbox ? "checkbox" : "radio";
        qBodyHtml = `
          <div class="print-options-list">
            ${(q.options || []).map((opt, oIdx) => `
              <div class="print-option-item">
                <span class="option-indicator ${indicatorClass}"></span>
                <span class="option-letter">${String.fromCharCode(65 + oIdx)}.</span>
                <span class="option-text" dir="auto">${opt.text}</span>
              </div>
            `).join("")}
          </div>
        `;
      } else if (q.type === "tf_matrix") {
        qBodyHtml = `
          <table class="print-matrix-table">
            <thead>
              <tr>
                <th>Pernyataan</th>
                <th style="width: 50px; text-align: center;">B</th>
                <th style="width: 50px; text-align: center;">S</th>
              </tr>
            </thead>
            <tbody>
              ${(q.statements || []).map(stmt => `
                <tr>
                  <td dir="auto">${stmt.text}</td>
                  <td class="center"><span class="matrix-box"></span></td>
                  <td class="center"><span class="matrix-box"></span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;
      } else if (q.type === "match") {
        const leftPairs = q.matchPairs || [];
        const rightTexts = leftPairs.map(p => p.right);
        
        const shuffledRight = [...rightTexts];
        for (let i = shuffledRight.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledRight[i], shuffledRight[j]] = [shuffledRight[j], shuffledRight[i]];
        }
        
        qBodyHtml = `
          <div class="print-match-container" style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px; font-size: 11.5px; width: 100%;">
            <div class="print-match-questions" style="display: flex; flex-direction: column; gap: 8px;">
              ${leftPairs.map((pair, pIdx) => `
                <div class="print-match-item" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;">
                  <span dir="auto" style="flex: 1; line-height: 1.4;">
                    <strong>${pIdx + 1}.</strong> ${pair.left}
                  </span>
                  <span style="white-space: nowrap; flex-shrink: 0;">
                    ( &nbsp;<span class="match-slot" style="display: inline-block; border-bottom: 1.5px solid #000; width: 35px; height: 15px; margin: 0 4px; vertical-align: middle;"></span>&nbsp; )
                  </span>
                </div>
              `).join("")}
            </div>
            
            <div class="print-match-choices" style="margin-top: 12px; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
              <div style="font-weight: 600; font-size: 10px; color: #475569; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.03em;">Pilihan Jawaban:</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px;">
                ${shuffledRight.map((rText, rIdx) => `
                  <div dir="auto" style="display: flex; align-items: flex-start; gap: 4px; line-height: 1.4;">
                    <strong style="color: #334155; flex-shrink: 0;">${String.fromCharCode(65 + rIdx)}.</strong>
                    <span style="flex: 1;">${rText}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          </div>
        `;
      }
      
      html += `
    <div class="question-row">
      <div class="question-cell question-left">
        ${badgeHtml}
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 6px; align-items: start;">
          <span class="question-number">${idx + 1}.</span>
          <div class="question-content" dir="auto">
            ${q.content}
          </div>
        </div>
        ${qBodyHtml}
      </div>
      <div class="question-cell question-right"></div>
    </div>
      `;
    });

    html += `
  </div>
</div>

  <script>
    window.addEventListener('DOMContentLoaded', () => {
      const runKatex = () => {
        if (typeof renderMathInElement === 'function') {
          renderMathInElement(document.body, {
            delimiters: [
              { left: "$$", right: "$$", display: true },
              { left: "$", right: "$", display: false },
            ],
            throwOnError: false
          });
          
          const images = document.querySelectorAll('img');
          if (images.length === 0) {
            paginateAndPrint();
          } else {
            let loadedCount = 0;
            images.forEach(img => {
              if (img.complete) {
                loadedCount++;
                if (loadedCount === images.length) paginateAndPrint();
              } else {
                img.addEventListener('load', () => {
                  loadedCount++;
                  if (loadedCount === images.length) paginateAndPrint();
                });
                img.addEventListener('error', () => {
                  loadedCount++;
                  if (loadedCount === images.length) paginateAndPrint();
                });
              }
            });
          }
        } else {
          setTimeout(runKatex, 100);
        }
      };
      
      const paginateAndPrint = () => {
        const headerEl = document.querySelector('.print-header');
        const dividerEl = document.querySelector('.header-divider');
        const headerHeight = (headerEl ? headerEl.offsetHeight : 0) + (dividerEl ? dividerEl.offsetHeight : 0) + 30;
        
        const rows = Array.from(document.querySelectorAll('.question-row'));
        if (rows.length === 0) {
          triggerPrint();
          return;
        }
        
        // Printable page inner height boundary (approx 254mm or 960px at 96 dpi)
        const PAGE_HEIGHT = 960;
        const GAP = 10;
        
        const pages = [];
        let currentPage = [];
        let currentHeight = headerHeight;
        
        rows.forEach((row) => {
          const rowHeight = row.offsetHeight;
          const addition = rowHeight + (currentPage.length > 0 ? GAP : 0);
          
          if (currentPage.length > 0 && currentHeight + addition > PAGE_HEIGHT) {
            pages.push(currentPage);
            currentPage = [row];
            currentHeight = rowHeight;
          } else {
            currentPage.push(row);
            currentHeight += addition;
          }
        });
        
        if (currentPage.length > 0) {
          pages.push(currentPage);
        }
        
        const controls = document.querySelector('.no-print');
        
        // Reconstruct DOM layout
        document.body.innerHTML = '';
        if (controls) {
          document.body.appendChild(controls);
        }
        
        pages.forEach((pageRows, pageIdx) => {
          const pageDiv = document.createElement('div');
          pageDiv.className = 'print-page';
          
          if (pageIdx === 0) {
            if (headerEl) pageDiv.appendChild(headerEl.cloneNode(true));
            if (dividerEl) pageDiv.appendChild(dividerEl.cloneNode(true));
          }
          
          const containerDiv = document.createElement('div');
          containerDiv.className = 'questions-container-page';
          
          pageRows.forEach(row => {
            containerDiv.appendChild(row.cloneNode(true));
          });
          
          pageDiv.appendChild(containerDiv);
          document.body.appendChild(pageDiv);
        });
        
        triggerPrint();
      };
      
      const triggerPrint = () => {
        setTimeout(() => {
          window.print();
        }, 500);
      };
      
      runKatex();
    });
  </script>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    feedbackEl.textContent = "";
  } catch (err) {
    feedbackEl.textContent = err.message || "Gagal mencetak PDF.";
    alert("Gagal mencetak: " + err.message);
  }
};

const downloadDocxFromEditor = async () => {
  if (editorQuestions.length === 0) {
    alert("Daftar soal di editor kosong.");
    return;
  }

  feedbackEl.textContent = "Memulai ekspor Word...";
  await exportQuestionsToDocx(editorQuestions, `bank-soal-editor-${Date.now()}.docx`, editorTempImages, feedbackEl);
};

const downloadBlankTemplate = async () => {
  const dummyQuestions = [
    {
      type: "pg",
      content: "<p>Perhatikan gambar grafik fungsi kuadrat di bawah ini.</p><p><img src=\"/templates/sample-graph.jpg\" /></p><p>Fungsi kuadrat manakah yang sesuai dengan grafik tersebut?</p>",
      scoreWeight: 10,
      options: [
        { id: "opt_a", text: "$y = x^2$", isCorrect: true },
        { id: "opt_b", text: "$y = 2x^2$", isCorrect: false },
        { id: "opt_c", text: "$y = x^2 + 2$", isCorrect: false }
      ]
    },
    {
      type: "pgk",
      content: "<p>Pilih bilangan prima di bawah ini.</p>",
      scoreWeight: 30,
      options: [
        { id: "opt_a", text: "2", isCorrect: true },
        { id: "opt_b", text: "3", isCorrect: true },
        { id: "opt_c", text: "4", isCorrect: false }
      ]
    },
    {
      type: "tf",
      content: "<p>Bahasa Arab ditulis dari kanan ke kiri.</p>",
      scoreWeight: 5,
      options: [
        { id: "true", text: "Benar", isCorrect: true },
        { id: "false", text: "Salah", isCorrect: false }
      ]
    },
    {
      type: "tf_matrix",
      content: "<p>Tentukan Benar (True) atau Salah (False) untuk masing-masing pernyataan berikut:</p>",
      scoreWeight: 30,
      statements: [
        { id: "stmt_1", text: "2 adalah satu-satunya bilangan prima genap.", isCorrect: "true" },
        { id: "stmt_2", text: "Hasil perkalian dari $5 \\times 5$ adalah 30.", isCorrect: "false" },
        { id: "stmt_3", text: "Bahasa Arab ditulis dari kiri ke kanan.", isCorrect: "false" }
      ]
    },
    {
      type: "essay",
      content: "<p>Jelaskan arti dari teks berikut: <span dir=\"auto\">السلام عليكم</span></p>",
      scoreWeight: 30
    },
    {
      type: "match",
      content: "<p>Jodohkan negara dengan ibu kotanya.</p>",
      scoreWeight: 10,
      matchPairs: [
        { left: "Indonesia", right: "Jakarta" },
        { left: "Jepang", right: "Tokyo" },
        { left: "Prancis", right: "Paris" }
      ]
    }
  ];

  feedbackEl.textContent = "Membuat template soal...";
  await exportQuestionsToDocx(dummyQuestions, `template-import-soal-${Date.now()}.docx`, {}, feedbackEl);
};

const saveEditorQuestionsToFirestore = async () => {
  const targetExamId = document.querySelector("#editor-save-target-exam").value;
  if (!targetExamId) {
    alert("Pilih ujian tujuan terlebih dahulu.");
    return;
  }

  if (editorQuestions.length === 0) {
    alert("Daftar soal di editor kosong. Tidak ada yang bisa disimpan.");
    return;
  }

  const ok = window.confirm("Apakah Anda yakin ingin menyimpan dan menimpa semua soal ujian ini? Semua soal lama pada ujian tersebut akan digantikan dengan soal dari editor.");
  if (!ok) return;

  feedbackEl.textContent = "Menyimpan perubahan soal ke Firestore...";
  
  try {
    const finalQuestionIds = [];
    const keysMap = {};

    const shuffleArray = (arr) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };
    
    for (let i = 0; i < editorQuestions.length; i++) {
      const q = editorQuestions[i];
      feedbackEl.textContent = `Menyimpan soal ${i + 1} dari ${editorQuestions.length}...`;

      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = q.content;
      
      const images = tempDiv.querySelectorAll("img");
      let imgIndex = 0;
      for (const img of images) {
        let src = img.getAttribute("src") || "";
        if (editorTempImages[src]) {
          src = editorTempImages[src];
        }
        if (src.startsWith("data:image")) {
          try {
            const blob = dataURItoBlob(src);
            const fileExtension = blob.type.split("/")[1] || "png";
            const fileName = `exams/images/img_${Date.now()}_editor_${i}_${imgIndex}.${fileExtension}`;
            
            const storageRef = ref(storage, fileName);
            await uploadBytes(storageRef, blob);
            const downloadURL = await getDownloadURL(storageRef);
            
            img.setAttribute("src", downloadURL);
            img.setAttribute("style", "max-width: 100%; height: auto; display: block; margin: 0.5rem 0; border-radius: 4px;");
            imgIndex++;
          } catch (imgErr) {
            console.error("Gagal upload gambar saat simpan editor:", imgErr);
          }
        }
      }
      
      const cleanContent = tempDiv.innerHTML;
      
      const publicPayload = {
        type: q.type,
        content: cleanContent,
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
        
        const shuffledRights = shuffleArray(rights);
        publicPayload.matchPairs = lefts.map((left, idx) => ({
          left: left,
          right: shuffledRights[idx]
        }));
        
        keyPayload.matchPairs = q.matchPairs || [];
      }

      let questionId = q.id;
      if (questionId && !questionId.startsWith("temp_")) {
        await updateQuestion(questionId, publicPayload);
      } else {
        questionId = await createQuestion(publicPayload);
      }
      
      keysMap[questionId] = keyPayload;
      finalQuestionIds.push(questionId);
    }

    await saveExamKeys(targetExamId, { keys: keysMap });
    await updateExamQuestionList(targetExamId, finalQuestionIds);

    feedbackEl.textContent = `Sukses menyimpan ${finalQuestionIds.length} soal langsung ke ujian tujuan.`;
    alert(`Sukses menyimpan ${finalQuestionIds.length} soal langsung ke ujian!`);
    await renderExams();
  } catch (err) {
    feedbackEl.textContent = `Gagal menyimpan: ${err.message}`;
    alert(`Gagal menyimpan ke Firestore: ${err.message}`);
  }
};

const initQuestionEditor = () => {
  // Initialize Quill Rich Text Editor
  initQuillEditor();

  // Live Preview Event Listener
  document.querySelector("#edit-q-content")?.addEventListener("input", updateEditFormPreview);
  document.querySelector("#edit-q-score")?.addEventListener("input", updateEditFormPreview);
  
  // Delegate change/input listeners from the dynamic fields element so any change triggers real-time preview
  const editDynamicFieldsEl = document.querySelector("#edit-dynamic-fields");
  if (editDynamicFieldsEl) {
    editDynamicFieldsEl.addEventListener("input", updateEditFormPreview);
    editDynamicFieldsEl.addEventListener("change", updateEditFormPreview);
  }

  // Insert Image Event Listeners
  document.querySelector("#edit-insert-img-btn")?.addEventListener("click", () => {
    document.querySelector("#edit-image-file-input")?.click();
  });

  document.querySelector("#edit-image-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Src = event.target.result;
      
      if (window.editQuill) {
        // Insert image visually into Quill editor at the current selection cursor!
        const range = window.editQuill.getSelection();
        const index = range ? range.index : window.editQuill.getLength();
        window.editQuill.insertEmbed(index, "image", base64Src);
        
        // Focus back to Quill editor
        window.editQuill.focus();
      } else {
        // Fallback to hidden textarea if Quill is somehow not initialized
        const textarea = document.querySelector("#edit-q-content");
        if (!textarea) return;
        const startPos = textarea.selectionStart;
        const endPos = textarea.selectionEnd;
        const placeholderId = `temp_img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        editorTempImages[placeholderId] = base64Src;
        const imgHtml = `\n<img src="${placeholderId}" style="max-width: 100%; height: auto; display: block; margin: 0.5rem 0; border-radius: 4px;" />\n`;
        const originalText = textarea.value;
        textarea.value = originalText.substring(0, startPos) + imgHtml + originalText.substring(endPos);
        textarea.dispatchEvent(new Event("input"));
      }
      
      e.target.value = ""; // Reset file input
    };
    reader.readAsDataURL(file);
  });

  // Source 1: Muat dari Ujian
  document.querySelector("#editor-load-exam-btn")?.addEventListener("click", async () => {
    const examId = document.querySelector("#editor-load-exam").value;
    if (!examId) {
      alert("Pilih ujian terlebih dahulu.");
      return;
    }

    feedbackEl.textContent = "Memuat soal dari ujian...";
    try {
      const loaded = await getExamWithQuestions(examId);
      if (!loaded) {
        throw new Error("Gagal memuat detail ujian.");
      }

      const keysData = await getExamKeys(examId);
      const keysMap = keysData?.keys || {};

      const { questions } = loaded;
      editorQuestions = questions.map((q) => {
        const key = keysMap[q.id];
        let options = q.options || [];
        let statements = q.statements || [];
        let matchPairs = q.matchPairs || [];

        if (key) {
          if (q.type === "pg" || q.type === "tf" || q.type === "pgk") {
            options = options.map(opt => ({
              ...opt,
              isCorrect: (key.correctOptionIds || []).includes(opt.id)
            }));
          } else if (q.type === "tf_matrix") {
            statements = statements.map(stmt => ({
              ...stmt,
              isCorrect: key.correctStatements?.[stmt.id] || "false"
            }));
          } else if (q.type === "match") {
            matchPairs = key.matchPairs || [];
          }
        }

        return {
          id: q.id,
          type: q.type,
          content: q.content,
          scoreWeight: q.scoreWeight || 100,
          options,
          statements,
          matchPairs
        };
      });

      selectedEditorQIndex = null;
      feedbackEl.textContent = `Berhasil memuat ${editorQuestions.length} soal ke editor.`;
      document.querySelector("#editor-workspace").classList.remove("hidden");
      renderEditorList();
    } catch (err) {
      feedbackEl.textContent = err.message || "Gagal memuat soal.";
      alert("Gagal memuat soal: " + err.message);
    }
  });

  // Source 2: Impor dari Word
  document.querySelector("#editor-import-file-btn")?.addEventListener("click", () => {
    const fileInput = document.querySelector("#editor-import-file");
    const file = fileInput?.files?.[0];

    if (!file) {
      alert("Silakan pilih file Word (.docx) terlebih dahulu.");
      return;
    }

    feedbackEl.textContent = "Membaca file Word...";
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      try {
        const result = await window.mammoth.convertToHtml({ arrayBuffer });
        const html = result.value;

        feedbackEl.textContent = "Memproses struktur soal...";
        const parsedQuestions = parseImportedHtml(html);

        if (parsedQuestions.length === 0) {
          throw new Error("Tidak ada soal yang berhasil dibaca. Pastikan format template sesuai.");
        }

        const mapped = parsedQuestions.map((q, idx) => ({
          id: `temp_${Date.now()}_${idx}`,
          type: q.type,
          content: extractBase64ImagesToPlaceholders(q.content),
          scoreWeight: q.scoreWeight || 100,
          options: q.options || [],
          statements: q.statements || [],
          matchPairs: q.matchPairs || []
        }));

        editorQuestions = mapped;
        selectedEditorQIndex = null;
        feedbackEl.textContent = `Berhasil mengimpor ${editorQuestions.length} soal ke editor.`;
        document.querySelector("#editor-workspace").classList.remove("hidden");
        renderEditorList();
        fileInput.value = "";
      } catch (err) {
        feedbackEl.textContent = `Gagal mengimpor: ${err.message}`;
        alert(`Gagal mengimpor: ${err.message}`);
      }
    };

    reader.onerror = () => {
      feedbackEl.textContent = "Gagal membaca file.";
    };

    reader.readAsArrayBuffer(file);
  });

  // Edit form type change listener
  document.querySelector("#edit-q-type")?.addEventListener("change", (e) => {
    buildEditorDynamicFields(e.target.value);
    updateEditFormPreview();
  });

  // Edit Cancel button
  document.querySelector("#edit-cancel-btn")?.addEventListener("click", () => {
    selectedEditorQIndex = null;
    document.querySelector("#editor-active-form-card").classList.add("hidden");
    document.querySelector("#editor-preview-card").classList.add("hidden");
    renderEditorList();
  });

  // Edit Save to List button
  document.querySelector("#edit-save-btn")?.addEventListener("click", () => {
    if (selectedEditorQIndex === null) return;
    
    const type = document.querySelector("#edit-q-type").value;
    const content = document.querySelector("#edit-q-content").value.trim();
    const scoreWeight = Number(document.querySelector("#edit-q-score").value) || 100;
    
    if (!content) {
      alert("Konten soal tidak boleh kosong.");
      return;
    }
    
    try {
      const payload = collectPayloadFromEditorFields(type);
      
      editorQuestions[selectedEditorQIndex] = {
        ...editorQuestions[selectedEditorQIndex],
        type,
        content,
        scoreWeight,
        ...payload
      };
      
      alert("Soal berhasil diperbarui di daftar editor.");
      renderEditorList();
      selectEditorQuestion(selectedEditorQIndex);
    } catch (err) {
      alert("Kesalahan penginputan: " + err.message);
    }
  });

  // Global: Tambah Soal
  document.querySelector("#editor-add-q-btn")?.addEventListener("click", () => {
    const newQ = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: "pg",
      content: "<p>Teks soal baru...</p>",
      scoreWeight: 10,
      options: [
        { id: "opt_1", text: "Pilihan A", isCorrect: true },
        { id: "opt_2", text: "Pilihan B", isCorrect: false }
      ]
    };
    
    editorQuestions.push(newQ);
    document.querySelector("#editor-workspace").classList.remove("hidden");
    renderEditorList();
    selectEditorQuestion(editorQuestions.length - 1);
  });

  // Global: Reset / Kosongkan
  document.querySelector("#editor-clear-btn")?.addEventListener("click", () => {
    const ok = window.confirm("Apakah Anda yakin ingin mengosongkan semua soal di editor saat ini?");
    if (!ok) return;
    
    editorQuestions = [];
    selectedEditorQIndex = null;
    renderEditorList();
    document.querySelector("#editor-workspace").classList.add("hidden");
  });

  // Global: Unduh Soal (.docx)
  document.querySelector("#editor-download-docx-btn")?.addEventListener("click", async () => {
    await downloadDocxFromEditor();
  });

  // Global: Unduh Template Word Soal
  document.querySelector("#editor-download-template-btn")?.addEventListener("click", async () => {
    await downloadBlankTemplate();
  });

  // Global: Simpan ke Ujian
  document.querySelector("#editor-save-exam-btn")?.addEventListener("click", async () => {
    await saveEditorQuestionsToFirestore();
  });
};



const bootstrap = async () => {
  const access = await requireRole("admin");
  if (!access) {
    return;
  }



  try {
    // Initialize student pickers first before rendering exams/forms so they are ready
    createStudentPickerInstance = await initStudentPicker(
      "student-picker-container",
      "student-picker-search",
      "student-picker-list",
      "student-picker-count"
    );
    editStudentPickerInstance = await initStudentPicker(
      "edit-student-picker-container",
      "edit-student-picker-search",
      "edit-student-picker-list",
      "edit-student-picker-count"
    );

    // Visibility toggle handlers
    const examVisibilitySelect = document.querySelector("#exam-visibility");
    const studentPickerContainer = document.querySelector("#student-picker-container");
    examVisibilitySelect?.addEventListener("change", () => {
      if (examVisibilitySelect.value === "private") {
        studentPickerContainer?.classList.remove("hidden");
      } else {
        studentPickerContainer?.classList.add("hidden");
      }
    });

    const editExamVisibilitySelect = document.querySelector("#edit-exam-visibility");
    const editStudentPickerContainer = document.querySelector("#edit-student-picker-container");
    editExamVisibilitySelect?.addEventListener("change", () => {
      if (editExamVisibilitySelect.value === "private") {
        editStudentPickerContainer?.classList.remove("hidden");
      } else {
        editStudentPickerContainer?.classList.add("hidden");
      }
    });

    await renderExams();
    initRealTimeMonitoring({ userProfileCache, userProfileInFlight, getExamsCache: () => examsCache });
    initRealTimeRecap({ userProfileCache, userProfileInFlight, getExamsCache: () => examsCache, feedbackEl });
    initQuestionEditor();
    initStudentManagement();

    // Hias select dropdown native menjadi custom glassmorphic dropdown
    document.querySelectorAll("#editor-load-exam, #editor-save-target-exam, #recap-filter-exam, #edit-q-type, #exam-attempts-policy, #exam-results-policy, #edit-exam-attempts-policy, #edit-exam-results-policy, #exam-visibility, #edit-exam-visibility, #exam-randomize-questions, #edit-exam-randomize-questions").forEach(select => {
      decorateSelect(select);
    });

    // Register static close listeners for cheating modal
    const cheatingModalEl = document.querySelector("#cheating-modal");
    const closeCheatingModalBtn = document.querySelector("#close-cheating-modal-btn");
    
    closeCheatingModalBtn?.addEventListener("click", () => {
      cheatingModalEl.classList.add("hidden");
      cheatingModalEl.setAttribute("aria-hidden", "true");
    });

    cheatingModalEl?.addEventListener("click", (e) => {
      if (e.target === cheatingModalEl) {
        cheatingModalEl.classList.add("hidden");
        cheatingModalEl.setAttribute("aria-hidden", "true");
      }
    });

    // Register modal print button listener
    document.querySelector("#modal-print-btn")?.addEventListener("click", () => {
      const printBtn = document.querySelector("#modal-print-btn");
      const examId = printBtn ? printBtn.dataset.id : null;
      if (examId) {
        printExamPDF(examId);
      }
    });

  } catch (error) {
    feedbackEl.textContent = error.message || "Gagal memuat data admin.";
  }
};

bootstrap();
