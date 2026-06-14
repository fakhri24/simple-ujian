import { listStudents } from "../../db.js";

/**
 * Initializes a student picker with search filter capability and custom display count.
 * @param {string} containerId - The container wrapper ID.
 * @param {string} searchId - The search input element ID.
 * @param {string} listId - The list container element ID.
 * @param {string} countId - The selected count display element ID.
 * @returns {Promise<{getSelectedUids: () => string[], setSelectedUids: (uids: string[]) => void, reset: () => void}>}
 */
export const initStudentPicker = async (containerId, searchId, listId, countId) => {
  const container = document.getElementById(containerId);
  const searchInput = document.getElementById(searchId);
  const listEl = document.getElementById(listId);
  const countEl = document.getElementById(countId);
  
  if (!container || !listEl) {
    return {
      getSelectedUids: () => [],
      setSelectedUids: () => {},
      reset: () => {}
    };
  }

  let students = [];
  let selectedUids = new Set();

  try {
    students = await listStudents();
    students.sort((a, b) => {
      const nameA = (a.namaLengkap || "").toLowerCase();
      const nameB = (b.namaLengkap || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } catch (err) {
    console.error("Gagal memuat daftar siswa untuk picker", err);
    listEl.innerHTML = `<div class="muted" style="padding: 0.5rem; color: var(--danger);">Gagal memuat siswa</div>`;
    return {
      getSelectedUids: () => [],
      setSelectedUids: () => {},
      reset: () => {}
    };
  }

  const renderPickerList = () => {
    const query = (searchInput.value || "").toLowerCase().trim();
    const filtered = students.filter(student => {
      const name = (student.namaLengkap || "").toLowerCase();
      const nis = (student.nis || "").toLowerCase();
      const kelas = (student.kelas || "").toLowerCase();
      return name.includes(query) || nis.includes(query) || kelas.includes(query);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="muted" style="padding: 0.5rem; text-align: center; font-size: 0.9rem;">Siswa tidak ditemukan</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(student => {
      const uid = student.uid || student.id;
      const isChecked = selectedUids.has(uid);
      return `
        <div class="student-picker-item" data-uid="${uid}">
          <input type="checkbox" id="pick-${containerId}-${uid}" ${isChecked ? 'checked' : ''} style="width: auto; height: auto; margin: 0; cursor: pointer;" />
          <label for="pick-${containerId}-${uid}">
            <strong>${student.namaLengkap}</strong> <span class="muted">— ${student.kelas || '-'} (NIS: ${student.nis || '-'})</span>
          </label>
        </div>
      `;
    }).join("");

    // Bind event listeners to items
    listEl.querySelectorAll(".student-picker-item").forEach(item => {
      const uid = item.dataset.uid;
      const checkbox = item.querySelector("input[type='checkbox']");

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedUids.add(uid);
        } else {
          selectedUids.delete(uid);
        }
        updateCount();
      });

      item.addEventListener("click", (e) => {
        if (e.target !== checkbox && e.target.tagName !== "LABEL") {
          checkbox.click();
        }
      });
    });
  };

  const updateCount = () => {
    if (countEl) {
      countEl.textContent = selectedUids.size;
    }
  };

  // Bind search listener
  searchInput?.addEventListener("input", renderPickerList);

  // Initial render
  renderPickerList();

  return {
    getSelectedUids: () => Array.from(selectedUids),
    setSelectedUids: (uids) => {
      selectedUids = new Set(uids || []);
      renderPickerList();
      updateCount();
    },
    reset: () => {
      selectedUids.clear();
      if (searchInput) searchInput.value = "";
      renderPickerList();
      updateCount();
    }
  };
};
