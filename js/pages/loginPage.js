import {
  login,
  getCurrentUser,
  waitForAuthReady,
  resolveUserRole,
} from "../auth.js";
import { roles } from "../app-config.js";

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

checkSessionErrors();
ensureAlreadyLoggedIn();
