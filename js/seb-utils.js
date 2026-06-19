/**
 * Utility functions for Safe Exam Browser (SEB) detection and browser policies.
 */

// Detect if running inside Safe Exam Browser
export const isSEB = !!(
  window.SafeExamBrowser ||
  navigator.userAgent.includes("SEB") ||
  navigator.userAgent.includes("SafeExamBrowser")
);

// Check if running on macOS or iPad (iOS)
export const isMacOSOrIPad = () => {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("macintosh") ||
    ua.includes("mac os") ||
    ua.includes("ipad") ||
    (navigator.maxTouchPoints > 0 && ua.includes("mac"))
  );
};

// Check if running on Windows
export const isWindows = () => {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("windows") || ua.includes("win32") || ua.includes("win64");
};

// Check if running on Android
export const isAndroid = () => navigator.userAgent.toLowerCase().includes("android");

// Check if the current browser environment enforces SEB (macOS and iPad)
// TEMPORARILY DISABLED for testing — re-enable before production
// export const enforceSEB = isMacOSOrIPad();
export const enforceSEB = false;
