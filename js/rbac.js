import { getCurrentUser, resolveUserRole, waitForAuthReady } from "./auth.js";
import { verifyAndStartSession, handleAutomaticLogout } from "./session.js";
import { isSEB, isMacOSOrIPad } from "./seb-utils.js";

export const requireRole = async (role, redirectPath = "/") => {
  // Check if running inside Safe Exam Browser for student role
  if (role === "siswa") {
    if (isMacOSOrIPad()) {
      if (!isSEB) {
        window.location.replace(redirectPath);
        return null;
      }
    }
  }

  const user = getCurrentUser() || (await waitForAuthReady());
  if (!user) {
    window.location.replace(redirectPath);
    return null;
  }

  const currentRole = await resolveUserRole(user.uid);
  if (currentRole !== role) {
    window.location.replace(redirectPath);
    return null;
  }

  // Verifikasi sesi login ganda saat memuat halaman
  const isSessionValid = await verifyAndStartSession(user.uid);
  if (!isSessionValid) {
    await handleAutomaticLogout(user.uid, "duplicate");
    return null;
  }

  return { user, role: currentRole };
};
