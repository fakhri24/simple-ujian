import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { firebaseConfig } from "../../app-config.js";
import {
  listStudents,
  resetUserSession,
  deleteUserProfile,
  upsertUserProfile
} from "../../db.js";

/**
 * Initializes student management page logic: manual registration, session resets, CSV imports.
 */
export const initStudentManagement = () => {
  let allStudents = [];
  let studentCurrentPage = 0;
  const STUDENT_ITEMS_PER_PAGE = 10;

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/);
    if (lines.length <= 1) return [];
    
    // Headers: Nama Lengkap,Email,Password,Kelas,NIS
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIdx = headers.indexOf("nama lengkap");
    const emailIdx = headers.indexOf("email");
    const passwordIdx = headers.indexOf("password");
    const classIdx = headers.indexOf("kelas");
    const nisIdx = headers.indexOf("nis");

    if (emailIdx === -1 || passwordIdx === -1) {
      throw new Error("File CSV tidak valid. Harus memiliki header 'Email' dan 'Password'.");
    }

    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cells = [];
      let currentCell = '';
      let inQuotes = false;
      for (let charIdx = 0; charIdx < line.length; charIdx++) {
        const char = line[charIdx];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cells.push(currentCell.trim());
          currentCell = '';
        } else {
          currentCell += char;
        }
      }
      cells.push(currentCell.trim());

      if (cells.length < headers.length) continue;

      results.push({
        namaLengkap: nameIdx !== -1 ? cells[nameIdx] : "",
        email: cells[emailIdx],
        password: cells[passwordIdx],
        kelas: classIdx !== -1 ? cells[classIdx] : "",
        nis: nisIdx !== -1 ? cells[nisIdx] : ""
      });
    }
    return results;
  };

  const registerNewStudent = async (namaLengkap, email, password, kelas, nis) => {
    const appName = `TempRegApp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tempApp = initializeApp(firebaseConfig, appName);
    const tempAuth = getAuth(tempApp);

    try {
      const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
      const uid = cred.user.uid;

      await upsertUserProfile(uid, {
        uid,
        email,
        role: "siswa",
        namaLengkap,
        kelas,
        nis
      });

      await signOut(tempAuth);
      await deleteApp(tempApp);

      return { success: true, uid };
    } catch (error) {
      try {
        await deleteApp(tempApp);
      } catch (_) {}
      return { success: false, error: error.message };
    }
  };

  const renderStudentPagination = (totalItems) => {
    const paginationEl = document.querySelector("#students-pagination");
    if (!paginationEl) return;

    const totalPages = Math.ceil(totalItems / STUDENT_ITEMS_PER_PAGE);
    if (totalPages <= 1) {
      paginationEl.innerHTML = "";
      return;
    }

    paginationEl.innerHTML = `
      <span class="pagination-info">Halaman ${studentCurrentPage + 1} dari ${totalPages}</span>
      <div class="pagination-buttons">
        <button class="pagination-btn" id="student-prev-page-btn" ${studentCurrentPage === 0 ? "disabled" : ""} title="Sebelumnya">
          ‹
        </button>
        <button class="pagination-btn" id="student-next-page-btn" ${studentCurrentPage === totalPages - 1 ? "disabled" : ""} title="Selanjutnya">
          ›
        </button>
      </div>
    `;

    document.querySelector("#student-prev-page-btn")?.addEventListener("click", () => {
      if (studentCurrentPage > 0) {
        studentCurrentPage--;
        renderStudentList();
      }
    });

    document.querySelector("#student-next-page-btn")?.addEventListener("click", () => {
      if (studentCurrentPage < totalPages - 1) {
        studentCurrentPage++;
        renderStudentList();
      }
    });
  };

  const renderStudentList = () => {
    const tableBody = document.querySelector("#students-table-body");
    const paginationEl = document.querySelector("#students-pagination");
    if (!tableBody) return;

    if (allStudents.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" class="muted" style="text-align: center; padding: 1.5rem;">Belum ada siswa yang terdaftar.</td>
        </tr>
      `;
      if (paginationEl) paginationEl.innerHTML = "";
      return;
    }

    const totalPages = Math.ceil(allStudents.length / STUDENT_ITEMS_PER_PAGE);
    if (studentCurrentPage >= totalPages) {
      studentCurrentPage = Math.max(0, totalPages - 1);
    }

    const start = studentCurrentPage * STUDENT_ITEMS_PER_PAGE;
    const end = Math.min(start + STUDENT_ITEMS_PER_PAGE, allStudents.length);
    const pageStudents = allStudents.slice(start, end);

    let htmlContent = pageStudents.map((siswa) => {
      return `
        <tr>
          <td style="font-family: monospace; font-weight: 600;">${siswa.nis || "-"}</td>
          <td style="font-weight: 500;">${siswa.namaLengkap || "-"}</td>
          <td>${siswa.kelas || "-"}</td>
          <td>${siswa.email || "-"}</td>
          <td style="text-align: center;">
            <button type="button" class="reset-session-btn secondary" data-uid="${siswa.uid}" data-name="${siswa.namaLengkap || siswa.email}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px; margin-right: 0.5rem;">
              Reset Sesi
            </button>
            <button type="button" class="delete-student-btn danger" data-uid="${siswa.uid}" data-name="${siswa.namaLengkap || siswa.email}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 8px;">
              Hapus
            </button>
          </td>
        </tr>
      `;
    }).join("");

    const dummyRowsNeeded = STUDENT_ITEMS_PER_PAGE - pageStudents.length;
    for (let i = 0; i < dummyRowsNeeded; i++) {
      htmlContent += `
        <tr class="dummy-row" style="pointer-events: none; background: transparent;">
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
        </tr>
      `;
    }

    tableBody.innerHTML = htmlContent;

    tableBody.querySelectorAll(".reset-session-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        const confirmReset = window.confirm(`Apakah Anda yakin ingin me-reset sesi login siswa "${name}"? Sesi mereka di perangkat lain akan dinonaktifkan secara paksa.`);
        if (!confirmReset) return;

        btn.disabled = true;
        btn.textContent = "Mereset...";
        try {
          await resetUserSession(uid);
          alert(`Sesi siswa "${name}" berhasil di-reset.`);
          await fetchAndRenderStudents();
        } catch (err) {
          alert(err.message || "Gagal me-reset sesi siswa.");
          btn.disabled = false;
          btn.textContent = "Reset Sesi";
        }
      });
    });

    tableBody.querySelectorAll(".delete-student-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        const confirmDelete = window.confirm(`Apakah Anda yakin ingin menghapus profil siswa "${name}" dari Firestore? Akses mereka ke ujian akan langsung dicabut.`);
        if (!confirmDelete) return;

        btn.disabled = true;
        btn.textContent = "Menghapus...";
        try {
          await deleteUserProfile(uid);
          alert(`Siswa "${name}" berhasil dihapus.`);
          await fetchAndRenderStudents();
        } catch (err) {
          alert(err.message || "Gagal menghapus siswa.");
          btn.disabled = false;
          btn.textContent = "Hapus";
        }
      });
    });

    renderStudentPagination(allStudents.length);
  };

  const fetchAndRenderStudents = async () => {
    const tableBody = document.querySelector("#students-table-body");
    if (!tableBody) return;

    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="muted" style="text-align: center; padding: 1.5rem;">Memuat daftar siswa...</td>
      </tr>
    `;

    try {
      allStudents = await listStudents();
      document.dispatchEvent(new CustomEvent("studentsChanged", { detail: { count: allStudents.length } }));
      allStudents.sort((a, b) => {
        const nameA = (a.namaLengkap || "").toLowerCase();
        const nameB = (b.namaLengkap || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });
      renderStudentList();
    } catch (error) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" class="muted" style="text-align: center; padding: 1.5rem; color: var(--danger);">
            Gagal memuat siswa: ${error.message}
          </td>
        </tr>
      `;
    }
  };

  // 1. Tab Navigation Listener
  document.querySelectorAll(".nav-item[data-tab='tab-students']").forEach((btn) => {
    btn.addEventListener("click", () => {
      studentCurrentPage = 0;
      fetchAndRenderStudents();
    });
  });

  // 2. Manual Student Registration Form
  const createForm = document.querySelector("#create-student-form");
  createForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(createForm);
    const namaLengkap = formData.get("namaLengkap").trim();
    const email = formData.get("email").trim();
    const password = formData.get("password");
    const kelas = formData.get("kelas").trim();
    const nis = formData.get("nis").trim();

    const submitBtn = createForm.querySelector("button[type='submit']");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Mendaftarkan...";
    }

    const res = await registerNewStudent(namaLengkap, email, password, kelas, nis);
    
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Daftarkan Siswa";
    }

    if (res.success) {
      alert(`Siswa "${namaLengkap}" berhasil didaftarkan!`);
      createForm.reset();
      await fetchAndRenderStudents();
    } else {
      alert(`Gagal mendaftarkan siswa: ${res.error}`);
    }
  });

  // 3. Download CSV Template
  const templateBtn = document.querySelector("#download-student-template-btn");
  templateBtn?.addEventListener("click", () => {
    const csvContent = "Nama Lengkap,Email,Password,Kelas,NIS\r\nSiswa Contoh,siswa.contoh@example.com,Siswa123!,XII-IPA-1,1234567890\r\n";
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-siswa-baru.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  // 4. Import CSV
  const fileInput = document.querySelector("#student-csv-file");
  const importBtn = document.querySelector("#import-student-csv-btn");
  const loggerCard = document.querySelector("#student-import-logger-card");
  const progressFill = document.querySelector("#student-import-progress-fill");
  const progressText = document.querySelector("#student-import-progress-text");
  const logList = document.querySelector("#student-import-log-list");

  importBtn?.addEventListener("click", async () => {
    const file = fileInput?.files?.[0];
    if (!file) {
      alert("Silakan pilih file CSV terlebih dahulu.");
      return;
    }

    importBtn.disabled = true;
    importBtn.textContent = "Mengimpor...";
    loggerCard.classList.remove("hidden");
    logList.innerHTML = "";
    progressFill.style.width = "0%";
    progressText.textContent = "Membaca file CSV...";

    const addLog = (message, type = "info") => {
      const logItem = document.createElement("div");
      logItem.style.padding = "0.2rem 0";
      if (type === "success") {
        logItem.style.color = "#10b981";
        logItem.textContent = `✅ ${message}`;
      } else if (type === "danger") {
        logItem.style.color = "#f43f5e";
        logItem.textContent = `❌ ${message}`;
      } else {
        logItem.textContent = `⏳ ${message}`;
      }
      logList.appendChild(logItem);
      logList.scrollTop = logList.scrollHeight;
    };

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target.result;
        let studentsToRegister = [];
        try {
          studentsToRegister = parseCSV(text);
        } catch (parseErr) {
          addLog(parseErr.message, "danger");
          importBtn.disabled = false;
          importBtn.textContent = "Mulai Impor Siswa";
          return;
        }

        if (studentsToRegister.length === 0) {
          addLog("Tidak ada data siswa yang ditemukan di file CSV.", "danger");
          importBtn.disabled = false;
          importBtn.textContent = "Mulai Impor Siswa";
          return;
        }

        addLog(`Ditemukan ${studentsToRegister.length} data siswa untuk diimpor.`, "info");

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < studentsToRegister.length; i++) {
          const student = studentsToRegister[i];
          const num = i + 1;
          const total = studentsToRegister.length;

          progressText.textContent = `Memproses ${num} dari ${total} siswa...`;
          progressFill.style.width = `${(num / total) * 100}%`;

          addLog(`Mendaftarkan [${num}/${total}]: ${student.namaLengkap || student.email}...`, "info");

          const res = await registerNewStudent(
            student.namaLengkap,
            student.email,
            student.password,
            student.kelas,
            student.nis
          );

          if (res.success) {
            successCount++;
            addLog(`${student.namaLengkap || student.email} -> SUKSES`, "success");
          } else {
            failCount++;
            addLog(`${student.namaLengkap || student.email} -> GAGAL (${res.error})`, "danger");
          }
        }

        progressText.textContent = `Selesai! Sukses: ${successCount}, Gagal: ${failCount}`;
        addLog(`Impor selesai! Sukses: ${successCount}, Gagal: ${failCount}`, "info");

        fileInput.value = "";
        importBtn.disabled = false;
        importBtn.textContent = "Mulai Impor Siswa";

        await fetchAndRenderStudents();
      };

      reader.readAsText(file);
    } catch (err) {
      addLog(`Gagal membaca file: ${err.message}`, "danger");
      importBtn.disabled = false;
      importBtn.textContent = "Mulai Impor Siswa";
    }
  });

  // Initial load if target tab is active
  if (localStorage.getItem("admin_active_tab") === "tab-students") {
    fetchAndRenderStudents();
  }
};
