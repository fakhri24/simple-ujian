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
