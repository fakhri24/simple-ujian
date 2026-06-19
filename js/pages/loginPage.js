import {
  login,
  getCurrentUser,
  waitForAuthReady,
  resolveUserRole,
} from "../auth.js";
import { roles } from "../app-config.js";

import {
  Lockdown,
  activeLockdown,
  isLockdown,
  lockdownSatisfied,
  lockdownGuidance,
} from "../lockdown.js";

const feedbackEl = document.querySelector("#login-feedback");
const loginForm = document.querySelector("#login-form");

const redirectByRole = (role) => {
  if (role === roles.admin) {
    window.location.replace("/pages/admin.html");
    return;
  }
  window.location.replace("/pages/student.html");
};

const ensureAlreadyLoggedIn = async () => {
  const currentUser = getCurrentUser() || (await waitForAuthReady());
  if (!currentUser) {
    return;
  }

  const role = await resolveUserRole(currentUser.uid);
  if (role) {
    redirectByRole(role);
  }
};

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();

  feedbackEl.textContent = "Memproses login...";

  try {
    const user = await login(email, password);
    const role = await resolveUserRole(user.uid);
    if (!role) {
      throw new Error("Role user tidak ditemukan");
    }
    redirectByRole(role);
  } catch (error) {
    let message = error.message || "Login gagal";
    if (error.code === "auth/invalid-credential" || message.includes("auth/invalid-credential")) {
      message = "email atau password salah.";
    }
    feedbackEl.textContent = message;
  }
});

const checkSessionErrors = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const errorParam = urlParams.get("error");
  if (errorParam === "duplicate") {
    feedbackEl.textContent = "Akun ini sedang aktif di perangkat lain. Silakan tunggu sesi berakhir (maksimal 3 menit) atau keluar dari perangkat lama.";
    feedbackEl.style.color = "var(--danger)";
  } else if (errorParam === "expired") {
    feedbackEl.textContent = "Sesi Anda telah berakhir karena akun ini login di perangkat baru.";
    feedbackEl.style.color = "var(--danger)";
  } else if (errorParam === "reset") {
    feedbackEl.textContent = "Sesi Anda telah di-reset oleh Administrator. Silakan login kembali.";
    feedbackEl.style.color = "var(--danger)";
  }
};

// Render isi #seb-warning-container sesuai platform (SEB/SUB) saat gate tak
// terpenuhi. Lihat lockdownGuidance() di js/lockdown.js.
const renderLockdownWarning = (container) => {
  const g = lockdownGuidance();

  const actionsHtml = g.actions
    .map((a) => {
      const downloadAttr = a.download ? ` download="${a.download}"` : "";
      if (a.disabled) {
        return `<span class="link-btn" aria-disabled="true" style="width: 100%; margin-bottom: 1rem; opacity: 0.5; cursor: not-allowed; pointer-events: none;">${a.label} — segera hadir</span>`;
      }
      return `<a href="${a.href}"${downloadAttr} class="link-btn" style="width: 100%; margin-bottom: 1rem;">${a.label}</a>`;
    })
    .join("");

  const hintHtml = g.hint
    ? `<div style="border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 0.5rem; font-size: 0.85rem; color: var(--muted);">
        ${g.hint.text} <br>
        <a href="${g.hint.href}" target="_blank" rel="noopener" style="color: var(--brand); text-decoration: none; font-weight: 600;">${g.hint.linkLabel}</a>
      </div>`
    : "";

  container.innerHTML = `
    <div style="font-size: 3.5rem; margin-bottom: 0.5rem;">🔒</div>
    <h2 style="margin: 0; font-size: 1.4rem; color: var(--text);">${g.title}</h2>
    <p style="color: var(--muted); font-size: 0.95rem; line-height: 1.6; margin: 0.75rem 0 1.5rem 0;">${g.description}</p>
    ${actionsHtml}
    ${hintHtml}
  `;
};

// Initialize page based on lockdown browser presence/policy
const init = () => {
  const loadingEl = document.querySelector("#seb-loading");
  const warningEl = document.querySelector("#seb-warning-container");
  const loginContainerEl = document.querySelector("#login-container");
  const activeBannerEl = document.querySelector("#seb-active-banner");

  if (loadingEl) {
    loadingEl.style.display = "none";
  }

  // Lockdown terpenuhi: policy mati, ATAU dibuka di browser ujian yang sesuai
  // platform (SEB di macOS/iPad, SUB di Windows). Lihat js/lockdown.js.
  // Catatan: saat lockdownPolicyOn diaktifkan, teks #seb-warning-container
  // sebaiknya dibuat per-platform (SEB vs SUB) lewat expectedLockdown().
  if (lockdownSatisfied()) {
    if (warningEl) warningEl.style.display = "none";
    if (loginContainerEl) loginContainerEl.style.display = "block";

    // Banner "browser ujian aktif": tampil dgn label sesuai lockdown browser
    // (SEB / SUB); sembunyikan di browser biasa.
    if (activeBannerEl) {
      if (isLockdown) {
        const name =
          activeLockdown === Lockdown.SEB
            ? "Safe Exam Browser"
            : "Simple Ujian Browser";
        activeBannerEl.textContent = `✓ ${name} Aktif & Aman`;
      } else {
        activeBannerEl.style.display = "none";
      }
    }

    checkSessionErrors();
    ensureAlreadyLoggedIn();
  } else {
    // Policy aktif & platform mewajibkan lockdown browser, tapi tidak terpenuhi:
    if (warningEl) {
      renderLockdownWarning(warningEl);
      warningEl.style.display = "flex";
    }
    if (loginContainerEl) loginContainerEl.style.display = "none";
  }
};

// Start the check after a slight delay to ensure user-agent / window properties are populated
setTimeout(init, 500);
