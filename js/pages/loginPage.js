import {
  login,
  getCurrentUser,
  waitForAuthReady,
  resolveUserRole,
} from "../auth.js";
import { roles } from "../app-config.js";

import { isLockdown, lockdownSatisfied } from "../lockdown.js";

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

    // Sembunyikan banner "browser ujian aktif" jika bukan di lockdown browser
    // (mis. Chrome biasa saat policy mati).
    if (activeBannerEl && !isLockdown) {
      activeBannerEl.style.display = "none";
    }

    checkSessionErrors();
    ensureAlreadyLoggedIn();
  } else {
    // Policy aktif & platform mewajibkan lockdown browser, tapi tidak terpenuhi:
    if (warningEl) warningEl.style.display = "flex";
    if (loginContainerEl) loginContainerEl.style.display = "none";
  }
};

// Start the check after a slight delay to ensure user-agent / window properties are populated
setTimeout(init, 500);
