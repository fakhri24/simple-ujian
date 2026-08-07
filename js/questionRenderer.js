import renderMathInElement from "katex/contrib/auto-render";
import { describeAnswer } from "./answerMatcher.js";

const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const escapeHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const renderOptions = (question, selected, multiple, readOnly = false) => {
  const type = multiple ? "checkbox" : "radio";
  const selectedValues = multiple
    ? new Set(selected || [])
    : new Set([selected]);

  return (question.options || [])
    .map(
      (option) => `
      <label class="q-option" dir="auto">
        <input
          type="${type}"
          name="question_${question.id}"
          value="${option.id}"
          ${selectedValues.has(option.id) ? "checked" : ""}
          ${readOnly ? "disabled" : ""}
        />
        <span>${escapeHtml(option.text)}</span>
      </label>
    `,
    )
    .join("");
};

const matchShuffledCache = new Map();

const renderMatch = (question, selected, readOnly = false) => {
  const sel = (selected && typeof selected === "object") ? selected : {};
  let shuffledRight = matchShuffledCache.get(question.id);
  if (!shuffledRight) {
    shuffledRight = shuffle(
      (question.matchPairs || []).map((pair) => pair.right),
    );
    matchShuffledCache.set(question.id, shuffledRight);
  }

  // Cari set nilai opsi kanan yang sudah terpilih/terpasang
  const matchedValues = new Set(Object.values(sel).filter(Boolean));

  // Render slot kiri target drop zone
  const slotsHtml = (question.matchPairs || [])
    .map((pair) => {
      const currentMatchedValue = sel[pair.left];
      const isFilled = Boolean(currentMatchedValue);
      return `
      <div class="match-slot-row" data-left="${escapeHtml(pair.left)}">
        <div class="match-slot-label" dir="auto">${escapeHtml(pair.left)}</div>
        <div class="match-slot-connector">→</div>
        <div class="match-drop-zone ${isFilled ? "filled" : ""}" data-left="${escapeHtml(pair.left)}" style="${readOnly ? "cursor: default;" : ""}">
          ${
            isFilled
              ? `<div class="match-drag-card in-slot" data-value="${escapeHtml(currentMatchedValue)}" style="${readOnly ? "cursor: default;" : ""}">
                  <span dir="auto">${escapeHtml(currentMatchedValue)}</span>
                  ${readOnly ? "" : `<button type="button" class="match-unmatch-btn" aria-label="Hapus pasangan">✕</button>`}
                 </div>`
              : `<span class="match-placeholder">${readOnly ? "Belum dijawab" : "Seret atau klik jawaban di sini"}</span>`
          }
        </div>
      </div>
    `;
    })
    .join("");

  // Render deck kartu pilihan kanan yang belum terpasang
  const unmatchedOptions = shuffledRight.filter((val) => !matchedValues.has(val));
  const deckHtml = unmatchedOptions
    .map(
      (value) => `
      <div class="match-drag-card" ${readOnly ? 'draggable="false"' : 'draggable="true"'} data-value="${escapeHtml(value)}" style="${readOnly ? "cursor: default;" : ""}">
        <span dir="auto">${escapeHtml(value)}</span>
      </div>
    `,
    )
    .join("");

  return `
    <div class="match-container ${readOnly ? "read-only" : ""}" data-question-id="${question.id}">
      <div class="match-slots">
        ${slotsHtml}
      </div>
      ${
        readOnly && unmatchedOptions.length === 0
          ? ""
          : `<div class="match-options-deck">
              ${deckHtml}
            </div>`
      }
    </div>
  `;
};

const renderTFMatrix = (question, selected, readOnly = false) => {
  const sel = (selected && typeof selected === "object") ? selected : {};
  const rows = (question.statements || [])
    .map(
      (stmt) => `
      <tr>
        <td dir="auto">${escapeHtml(stmt.text)}</td>
        <td style="text-align: center;">
          <label class="matrix-label">
            <input
              type="radio"
              name="matrix_${question.id}_${stmt.id}"
              value="true"
              ${sel[stmt.id] === "true" ? "checked" : ""}
              ${readOnly ? "disabled" : ""}
              data-statement="${stmt.id}"
              data-value="true"
            />
          </label>
        </td>
        <td style="text-align: center;">
          <label class="matrix-label">
            <input
              type="radio"
              name="matrix_${question.id}_${stmt.id}"
              value="false"
              ${sel[stmt.id] === "false" ? "checked" : ""}
              ${readOnly ? "disabled" : ""}
              data-statement="${stmt.id}"
              data-value="false"
            />
          </label>
        </td>
      </tr>
    `,
    )
    .join("");

  return `
    <div class="table-responsive">
      <table class="matrix-table">
        <thead>
          <tr>
            <th>Pernyataan</th>
            <th style="width: 100px; text-align: center;">Benar</th>
            <th style="width: 100px; text-align: center;">Salah</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
};

/** Tampilkan angka dengan koma desimal seperti kebiasaan menulis di Indonesia. */
const toIdNumber = (text) => String(text || "").replace(".", ",");

/**
 * Essay biasa tetap satu kotak teks seperti sebelumnya. Soal yang kuncinya
 * berupa angka (`answerFormat === "numeric"`) mendapat bantuan tambahan:
 * penulis pecahan dan pratinjau "terbaca sebagai", supaya siswa tahu bentuk
 * tulisannya sudah terbaca mesin sebelum ujian dikumpulkan.
 */
const renderEssay = (question, currentAnswer, readOnly) => {
  const numeric = question.answerFormat === "numeric";
  const placeholder = numeric ? "Tulis jawaban, mis. 3/4 atau 0,75" : "Tulis jawaban";
  const textarea = `<textarea id="essay-answer" rows="${numeric ? 3 : 6}" placeholder="${placeholder}" dir="auto" ${readOnly ? "disabled" : ""}>${escapeHtml(currentAnswer || "")}</textarea>`;

  if (!numeric || readOnly) {
    return textarea;
  }

  return `
    <div class="essay-numeric">
      ${textarea}
      <div class="essay-numeric-tools">
        <button type="button" class="essay-frac-toggle" aria-expanded="false">Tulis pecahan</button>
        <div class="essay-frac-builder hidden">
          <div class="essay-frac-stack">
            <input type="text" class="essay-frac-num" inputmode="decimal" aria-label="Pembilang" placeholder="3" />
            <input type="text" class="essay-frac-den" inputmode="decimal" aria-label="Penyebut" placeholder="4" />
          </div>
          <button type="button" class="essay-frac-insert">Sisipkan</button>
        </div>
      </div>
      <p class="essay-read-as" aria-live="polite"></p>
      <p class="essay-numeric-hint">Bentuk apa pun yang senilai diterima: <code>3/4</code>, <code>0,75</code>, atau <code>75%</code>.</p>
    </div>
  `;
};

export const renderQuestion = ({
  container,
  question,
  currentAnswer,
  onAnswerChange,
  readOnly = false,
}) => {
  const body = (() => {
    switch (question.type) {
      case "pg":
      case "tf":
        return renderOptions(question, currentAnswer, false, readOnly);
      case "pgk":
        return renderOptions(question, currentAnswer, true, readOnly);
      case "essay":
        return renderEssay(question, currentAnswer, readOnly);
      case "match":
        return renderMatch(question, currentAnswer, readOnly);
      case "tf_matrix":
        return renderTFMatrix(question, currentAnswer, readOnly);
      default:
        return "<p>Tipe soal tidak dikenali.</p>";
    }
  })();

  if (question.passageContent) {
    container.innerHTML = `
      <div class="split-question-container" data-id="${question.id}">
        <div class="passage-panel" dir="auto">
          <div class="passage-header">${escapeHtml(question.passageTitle || "Wacana")}</div>
          <div class="passage-body">${question.passageContent}</div>
        </div>
        <div class="question-panel">
          <div class="question">
            <div class="q-content" dir="auto">${question.content}</div>
            <div class="q-body">${body}</div>
          </div>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="question" data-id="${question.id}">
        <div class="q-content" dir="auto">${question.content}</div>
        <div class="q-body">${body}</div>
      </div>
    `;
  }

  // Wrap tables to make them responsive and prevent styling mismatch
  container.querySelectorAll(".q-content table, .passage-body table").forEach((table) => {
    if (table.parentElement && !table.parentElement.classList.contains("table-wrapper")) {
      const wrapper = document.createElement("div");
      wrapper.className = "table-wrapper";
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  });

  if (readOnly) {
    return;
  }

  if (question.type === "pg" || question.type === "tf") {
    container.querySelectorAll("input[type='radio']").forEach((el) => {
      el.addEventListener("change", () => onAnswerChange(el.value));
    });
    return;
  }

  if (question.type === "tf_matrix") {
    const handler = () => {
      const result = {};
      container.querySelectorAll("input[type='radio']:checked").forEach((el) => {
        if (el.dataset.statement) {
          result[el.dataset.statement] = el.dataset.value;
        }
      });
      onAnswerChange(result);
    };

    container.querySelectorAll("input[type='radio']").forEach((el) => {
      el.addEventListener("change", handler);
    });
    return;
  }

  if (question.type === "pgk") {
    const handler = () => {
      const values = [
        ...container.querySelectorAll("input[type='checkbox']:checked"),
      ].map((el) => el.value);
      onAnswerChange(values);
    };

    container.querySelectorAll("input[type='checkbox']").forEach((el) => {
      el.addEventListener("change", handler);
    });
    return;
  }

  if (question.type === "essay") {
    const textarea = container.querySelector("#essay-answer");
    if (!textarea) {
      return;
    }

    const readAsEl = container.querySelector(".essay-read-as");

    const refreshReadAs = () => {
      if (!readAsEl) {
        return;
      }
      const raw = textarea.value.trim();
      if (!raw) {
        readAsEl.textContent = "";
        readAsEl.classList.remove("warn");
        return;
      }
      const described = describeAnswer(raw, "numeric");
      if (!described.ok) {
        readAsEl.textContent = "Belum terbaca sebagai angka — periksa lagi penulisannya.";
        readAsEl.classList.add("warn");
        return;
      }
      const value = toIdNumber(described.readAs);
      const decimal = toIdNumber(described.readAsDecimal);
      readAsEl.textContent =
        decimal && decimal !== value
          ? `Terbaca sebagai: ${value} (= ${decimal})`
          : `Terbaca sebagai: ${value}`;
      readAsEl.classList.remove("warn");
    };

    textarea.addEventListener("input", () => {
      onAnswerChange(textarea.value);
      refreshReadAs();
    });

    const builder = container.querySelector(".essay-frac-builder");
    if (builder) {
      const toggle = container.querySelector(".essay-frac-toggle");
      const numEl = builder.querySelector(".essay-frac-num");
      const denEl = builder.querySelector(".essay-frac-den");

      const insertFraction = () => {
        const num = numEl.value.trim();
        const den = denEl.value.trim();
        if (!num || !den) {
          (num ? denEl : numEl).focus();
          return;
        }
        // Sisipkan di posisi kursor supaya jawaban yang sudah diketik tidak hilang.
        const text = `${num}/${den}`;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
        numEl.value = "";
        denEl.value = "";
        onAnswerChange(textarea.value);
        refreshReadAs();
        textarea.focus();
        const caret = start + text.length;
        textarea.setSelectionRange(caret, caret);
      };

      toggle?.addEventListener("click", () => {
        const opened = builder.classList.toggle("hidden") === false;
        toggle.setAttribute("aria-expanded", String(opened));
        if (opened) {
          numEl.focus();
        }
      });

      builder.querySelector(".essay-frac-insert")?.addEventListener("click", insertFraction);

      [numEl, denEl].forEach((el) => {
        el.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") {
            return;
          }
          event.preventDefault();
          if (el === numEl && !denEl.value.trim()) {
            denEl.focus();
            return;
          }
          insertFraction();
        });
      });
    }

    refreshReadAs();
    return;
  }

  if (question.type === "match") {
    // Simpan selection state secara lokal (restorasi dari jawaban awal)
    const selection = (currentAnswer && typeof currentAnswer === "object") ? { ...currentAnswer } : {};

    const containerEl = container.querySelector(".match-container");
    const deckEl = containerEl.querySelector(".match-options-deck");

    let activeSelectedCard = null; // untuk Click-to-Pair fallback
    let lastPlacedLeft = null; // Track the slot that was just paired to trigger snap animation

    // Picu callback onAnswerChange agar jawaban tersimpan secara real-time
    const triggerChange = () => {
      onAnswerChange({ ...selection });
    };

    // Render ulang status opsi dan drop zones secara dinamis
    const refreshState = () => {
      // Cari set nilai opsi kanan yang sedang dipasangkan
      const matchedValues = new Set(Object.values(selection).filter(Boolean));

      // 1. Gambar ulang kartu opsi yang belum terpasang di deck kanan
      const shuffledRight = matchShuffledCache.get(question.id) || [];
      const unmatchedOptions = shuffledRight.filter((val) => !matchedValues.has(val));
      
      deckEl.innerHTML = unmatchedOptions
        .map(
          (value) => `
          <div class="match-drag-card" draggable="true" data-value="${escapeHtml(value)}">
            <span dir="auto">${escapeHtml(value)}</span>
          </div>
        `,
        )
        .join("");

      // Pasang event listener ke kartu opsi baru di deck
      bindDeckCards();

      // 2. Gambar ulang area drop zone target kiri berdasarkan selection state terbaru
      containerEl.querySelectorAll(".match-slot-row").forEach((slotRow) => {
        const left = slotRow.dataset.left;
        const dropZone = slotRow.querySelector(".match-drop-zone");
        const val = selection[left];
        
        if (val) {
          dropZone.classList.add("filled");
          const shouldAnimate = (left === lastPlacedLeft);
          dropZone.innerHTML = `
            <div class="match-drag-card in-slot ${shouldAnimate ? "animate" : ""}" data-value="${escapeHtml(val)}">
              <span dir="auto">${escapeHtml(val)}</span>
              <button type="button" class="match-unmatch-btn" aria-label="Hapus pasangan">✕</button>
            </div>
          `;
          
          // Handler tombol "✕" hapus koneksi
          dropZone.querySelector(".match-unmatch-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            delete selection[left];
            triggerChange();
            refreshState();
          });
        } else {
          dropZone.classList.remove("filled");
          dropZone.innerHTML = `<span class="match-placeholder">Seret atau klik jawaban di sini</span>`;
        }
      });
      
      activeSelectedCard = null;
      lastPlacedLeft = null;

      try {
        renderMathInElement(containerEl, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
          ],
          throwOnError: false,
        });
      } catch (err) {
        console.error("Gagal merender KaTeX di soal menjodohkan:", err);
      }
    };

    // Handler pemasangan item opsi kanan ke slot kiri
    const pairItem = (leftVal, rightVal) => {
      if (!rightVal) return;
      
      // Jika opsi jawaban ini sudah terpasang di slot lain, lepaskan terlebih dahulu (1 opsi 1 slot)
      for (const [key, val] of Object.entries(selection)) {
        if (val === rightVal) {
          delete selection[key];
        }
      }
      
      lastPlacedLeft = leftVal;
      selection[leftVal] = rightVal;
      triggerChange();
      refreshState();
    };

    // Pasang listeners drag & click pada kartu di deck opsi kanan
    const bindDeckCards = () => {
      deckEl.querySelectorAll(".match-drag-card").forEach((card) => {
        const value = card.dataset.value;

        // Mode A: Drag & Drop HTML5
        card.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", value);
          card.style.opacity = "0.5";
        });

        card.addEventListener("dragend", () => {
          card.style.opacity = "";
        });

        // Mode B: Click-to-Pair (Touch / Tap fallback)
        card.addEventListener("click", (e) => {
          e.stopPropagation();
          
          if (card.classList.contains("selected")) {
            card.classList.remove("selected");
            activeSelectedCard = null;
          } else {
            // Hapus outline selected dari kartu lain
            deckEl.querySelectorAll(".match-drag-card.selected").forEach((c) => {
              c.classList.remove("selected");
            });
            card.classList.add("selected");
            activeSelectedCard = value;
          }
        });
      });
    };

    // Pasang listeners drag & click pada drop zone target kiri
    containerEl.querySelectorAll(".match-drop-zone").forEach((dropZone) => {
      const left = dropZone.dataset.left;

      // Click to pair target action
      dropZone.addEventListener("click", (e) => {
        e.stopPropagation();
        
        if (activeSelectedCard) {
          pairItem(left, activeSelectedCard);
        }
      });

      // HTML5 Drag & Drop event
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault(); // Diperlukan agar event drop berjalan
        dropZone.classList.add("drag-over");
      });

      dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
      });

      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        const rightVal = e.dataTransfer.getData("text/plain");
        if (rightVal) {
          pairItem(left, rightVal);
        }
      });
    });

    // Inisiasi awal
    bindDeckCards();

    // Pastikan item yang sudah terpasang saat inisiasi (restorasi state) terikat listener hapusnya
    containerEl.querySelectorAll(".match-drop-zone.filled").forEach((dropZone) => {
      const left = dropZone.dataset.left;
      dropZone.querySelector(".match-unmatch-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        delete selection[left];
        triggerChange();
        refreshState();
      });
    });
  }
};
