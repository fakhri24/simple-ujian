import { getCurrentUser, resolveUserRole, waitForAuthReady } from "./auth.js";
import { verifyAndStartSession, handleAutomaticLogout } from "./session.js";

export const requireRole = async (role, redirectPath = "/") => {
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
