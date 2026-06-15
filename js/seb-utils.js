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

// Check if the current browser environment enforces SEB (macOS and iPad)
export const enforceSEB = isMacOSOrIPad();
