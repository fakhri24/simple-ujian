import { requireRole } from "../rbac.js";
import { streamSubmission, getQuestionsByIds, getExamById, getExamKeys } from "../db.js";
import { renderQuestion } from "../questionRenderer.js";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";

const scoreEl = document.querySelector("#result-score");
const breakdownEl = document.querySelector("#result-breakdown");

const params = new URLSearchParams(window.location.search);
const submissionId = params.get("submissionId");

const translateStatus = (status) => {
  switch (status) {
    case "correct":
      return '<span style="color: var(--success); font-weight: 600;">Benar</span>';
    case "wrong":
      return '<span style="color: var(--danger); font-weight: 600;">Salah</span>';
    case "manual":
      return '<span style="color: #f59e0b; font-weight: 600;">Perlu Diperiksa</span>';
    case "partial":
      return '<span style="color: #f59e0b; font-weight: 600;">Benar Sebagian</span>';
    case "graded":
      return '<span style="color: var(--success); font-weight: 600;">Selesai Dinilai</span>';
    default:
      return status;
  }
};

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

    if (!submissionId) {
      scoreEl.textContent = "Submission tidak ditemukan";
      hideGlobalLoading();
      return;
    }

    streamSubmission(
      submissionId,
      async (submission) => {
        try {
          hideGlobalLoading();
          if (!submission) {
            scoreEl.textContent = "Data hasil tidak tersedia";
            return;
          }

          if (submission.userId !== access.user.uid) {
            scoreEl.textContent = "Anda tidak punya akses ke hasil ini";
            return;
          }

          // Periksa kebijakan tampilan hasil ujian
          const exam = await getExamById(submission.examId);
          const showResults = exam ? (exam.showResultsImmediately ?? true) : true;
          if (!showResults) {
            const scoreCard = scoreEl.closest(".card");
            if (scoreCard) {
              scoreCard.style.display = "none";
            }
            
            const detailHeader = document.querySelector("h3");
            if (detailHeader) {
              detailHeader.style.display = "none";
            }
            
            breakdownEl.innerHTML = `
              <div class="card" style="text-align: center; padding: 4rem 2rem; color: #64748b; font-family: 'Outfit', sans-serif;">
                <div style="font-size: 4rem; margin-bottom: 1.5rem;">🔒</div>
                <div style="font-weight: 800; font-size: 1.8rem; color: var(--brand); margin-bottom: 1rem;">Hasil Ujian Disembunyikan</div>
                <p style="font-size: 1.05rem; color: #64748b; max-width: 480px; margin: 0 auto 2.5rem auto; line-height: 1.7;">
                  Nilai dan detail lembar jawaban untuk ujian ini disembunyikan oleh Guru/Administrator Anda sesuai dengan kebijakan pelaksanaan ujian.
                </p>
                <a href="/pages/student.html" class="link-btn" style="text-decoration: none; padding: 0.85rem 2rem; font-size: 1rem; border-radius: 12px;">Kembali ke Dashboard</a>
              </div>
            `;
            return;
          }

          // Update page title dynamically
          document.title = `Hasil Ujian: ${submission.examTitle || "Detail Ujian"}`;
          const topbarTitle = document.querySelector(".topbar h1");
          if (topbarTitle) {
            topbarTitle.textContent = `Hasil Ujian: ${submission.examTitle || "Detail Ujian"}`;
          }

          scoreEl.textContent = String(submission.totalScore || 0);

          // Get question IDs from breakdown
          const questionIds = (submission.breakdown || []).map((item) => item.questionId);
          if (questionIds.length === 0) {
            breakdownEl.innerHTML = `<div class="muted" style="text-align: center; padding: 1.5rem;">Tidak ada detail soal untuk hasil ini.</div>`;
            return;
          }

          const questions = await getQuestionsByIds(questionIds);
          if (!questions || questions.length === 0) {
            breakdownEl.innerHTML = `<div class="muted" style="text-align: center; padding: 1.5rem;">Gagal memuat detail soal dari database.</div>`;
            return;
          }

          // Fetch correct answer keys for this exam
          const examKeys = await getExamKeys(submission.examId);
          const keysMap = examKeys?.keys || {};

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

          breakdownEl.innerHTML = "";

          mergedQuestions.forEach((q, idx) => {
            const qWrapper = document.createElement("div");
            qWrapper.className = "card";
            qWrapper.style.background = "rgba(255, 255, 255, 0.45)";
            qWrapper.style.border = "1px solid var(--border)";
            qWrapper.style.padding = "1.25rem";
            qWrapper.style.borderRadius = "12px";
            qWrapper.style.boxShadow = "var(--shadow)";
            qWrapper.style.marginBottom = "1rem";

            const bItem = (submission.breakdown || []).find((item) => item.questionId === q.id) || {
              status: "wrong",
              score: 0,
              scoreWeight: 0
            };

            const studentAns = submission.answersByQuestionId?.[q.id];

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
              keyInfo.innerHTML = `<strong>Status Nilai Essay:</strong> ${bItem.status === "manual" ? "Menunggu koreksi guru" : `Sudah dinilai guru: <strong>${bItem.score}</strong> dari <strong>${bItem.scoreWeight}</strong>`}`;
              qWrapper.appendChild(keyInfo);
            }

            breakdownEl.appendChild(qWrapper);
          });

          // Process KaTeX math rendering
          renderMathInElement(breakdownEl, {
            delimiters: [
              { left: "$$", right: "$$", display: true },
              { left: "$", right: "$", display: false },
            ],
            throwOnError: false,
          });

        } catch (err) {
          console.error("Gagal merender data submission:", err);
          scoreEl.textContent = "Gagal memproses tampilan hasil.";
          hideGlobalLoading();
        }
      },
      (error) => {
        console.error("Gagal streaming submission:", error);
        scoreEl.textContent = "Gagal mengambil data dari server.";
        hideGlobalLoading();
      }
    );
  } catch (error) {
    console.error("Gagal memuat hasil ujian:", error);
    hideGlobalLoading();
  }
};

bootstrap();

