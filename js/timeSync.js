/**
 * Modul Sinkronisasi Waktu Otoritatif Server.
 *
 * Mengukur selisih (offset) antara jam laptop/HP siswa dengan jam server
 * menggunakan header HTTP 'Date' standar secara ringan tanpa membebani server.
 * Digunakan di seluruh aplikasi agar siswa tidak terblokir atau terpengaruh
 * oleh jam perangkat yang tidak akurat (clock skew).
 */

let globalServerOffsetMs = 0;
let hasSynced = false;
let syncPromise = null;

export const syncServerTime = async (force = false) => {
  if (hasSynced && !force) return globalServerOffsetMs;
  if (syncPromise && !force) return syncPromise;

  syncPromise = (async () => {
    try {
      const t0 = Date.now();
      const res = await fetch("/", { method: "HEAD", cache: "no-store" });
      const t1 = Date.now();
      const dateHeader = res.headers.get("date");
      if (dateHeader) {
        const serverTime = new Date(dateHeader).getTime();
        if (!isNaN(serverTime)) {
          // Koreksi setengah waktu bolak-balik (RTT/latency)
          const latency = Math.max(0, Math.round((t1 - t0) / 2));
          globalServerOffsetMs = (serverTime + latency) - t1;
          hasSynced = true;
          return globalServerOffsetMs;
        }
      }
    } catch (_) {
      // Fallback: biarkan offset 0 bila offline atau gagal jaringan
    }
    return globalServerOffsetMs;
  })();

  return syncPromise;
};

export const getServerNow = () => {
  return Date.now() + globalServerOffsetMs;
};

export const getServerOffsetMs = () => {
  return globalServerOffsetMs;
};

export const setServerOffsetMs = (offset) => {
  globalServerOffsetMs = Number(offset) || 0;
  hasSynced = true;
};

/**
 * Memeriksa status sinkronisasi jam perangkat siswa dengan jam server.
 * @param {number} thresholdMinutes Ambang batas selisih waktu dalam menit (default: 5).
 * @returns {{ isDesynced: boolean, diffMinutes: number, direction: 'behind'|'ahead'|'synced', offsetMs: number }}
 */
export const checkClockSyncStatus = (thresholdMinutes = 5) => {
  const offsetMs = globalServerOffsetMs;
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const absOffsetMs = Math.abs(offsetMs);
  const isDesynced = absOffsetMs >= thresholdMs;
  const diffMinutes = Math.round(absOffsetMs / 60000);
  const direction = offsetMs > 0 ? "behind" : (offsetMs < 0 ? "ahead" : "synced");

  return {
    isDesynced,
    diffMinutes,
    direction,
    offsetMs
  };
};

/**
 * Merender Soft Warning Banner jika jam perangkat melenceng dari jam server.
 * @param {HTMLElement} containerElement Elemen DOM target tempat banner disisipkan di posisi paling atas.
 * @param {number} thresholdMinutes Ambang batas selisih menit untuk menampilkan peringatan (default: 5).
 * @returns {HTMLElement|null} Elemen banner yang dirender atau null jika jam normal.
 */
export const renderClockWarningBanner = (containerElement, thresholdMinutes = 5) => {
  if (!containerElement) return null;

  const status = checkClockSyncStatus(thresholdMinutes);
  if (!status.isDesynced) {
    const existing = document.getElementById("clock-warning-banner");
    if (existing) existing.remove();
    return null;
  }

  const dismissKey = "simpleUjian:dismissClockWarning";
  if (sessionStorage.getItem(dismissKey)) {
    return null;
  }

  const existing = document.getElementById("clock-warning-banner");
  if (existing) existing.remove();

  const directionText = status.direction === "behind"
    ? `lebih lambat sekitar ${status.diffMinutes} menit`
    : `lebih cepat sekitar ${status.diffMinutes} menit`;

  const banner = document.createElement("div");
  banner.id = "clock-warning-banner";
  banner.className = "clock-warning-banner";
  banner.setAttribute("role", "alert");
  banner.innerHTML = `
    <div class="clock-warning-content">
      <span class="clock-warning-icon" aria-hidden="true">⚠️</span>
      <div class="clock-warning-text">
        <strong>Perhatian Jam Perangkat:</strong> Jam di perangkat Anda terdeteksi <em>${directionText}</em> dari waktu server. 
        Sistem otomatis mengoreksi waktu ini, namun kami menyarankan untuk mengaktifkan opsi <strong>"Set time automatically" (Atur waktu otomatis)</strong> di pengaturan jam perangkat Anda agar ujian berjalan lancar.
      </div>
      <button type="button" class="clock-warning-dismiss" aria-label="Tutup pemberitahuan" title="Tutup">✕</button>
    </div>
  `;

  const dismissBtn = banner.querySelector(".clock-warning-dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      sessionStorage.setItem(dismissKey, "true");
      banner.remove();
    });
  }

  containerElement.prepend(banner);
  return banner;
};

