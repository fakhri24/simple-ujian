import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const outputDir = path.resolve("./screenshots");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // 1. Tampilan Hasil Ujian (result.html) mode "score_only"
  const resultHtml = `
  <!doctype html>
  <html lang="id">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Hasil Ujian: Try Out Penalaran Matematika</title>
      <link rel="stylesheet" href="file://${path.resolve("./dist/assets/lockdown-C3vgbKZj.css")}" />
      <link rel="stylesheet" href="file://${path.resolve("./css/main.css")}" />
      <style>
        body { font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
        .topbar { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 2rem; background: white; border-bottom: 1px solid #e2e8f0; }
        .container { max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        .card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .link-btn { display: inline-block; background: #4f46e5; color: white; padding: 0.75rem 1.5rem; border-radius: 10px; text-decoration: none; font-weight: 600; }
      </style>
    </head>
    <body>
      <header class="topbar">
        <h1 style="font-size: 1.3rem; margin: 0; color: #1e293b;">Hasil Ujian: Try Out Penalaran Matematika</h1>
        <a id="result-back-btn" class="link-btn" href="#" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;">Kembali ke Daftar</a>
      </header>

      <main class="container">
        <section class="card" style="text-align: center; margin-bottom: 2rem; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);">
          <p id="result-score-subtitle" style="margin: 0; font-size: 1.1rem; color: #64748b; font-weight: 600;">Total Skor (Skala 1000)</p>
          <h2 id="result-score" style="margin: 0.5rem 0 0 0; font-size: 3.5rem; color: #4f46e5; font-weight: 800;">780</h2>
        </section>

        <!-- Ringkasan Statistik Pengerjaan -->
        <div id="result-summary-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
          <div class="card" style="text-align: center; padding: 1rem; border-radius: 12px; background: rgba(255,255,255,0.9);">
            <div style="font-size: 0.85rem; color: #64748b; font-weight: 600;">Total Soal</div>
            <div id="stat-total-questions" style="font-size: 1.5rem; font-weight: 800; color: #4f46e5; margin-top: 0.25rem;">20</div>
          </div>
          <div class="card" style="text-align: center; padding: 1rem; border-radius: 12px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2);">
            <div style="font-size: 0.85rem; color: #059669; font-weight: 600;">Benar</div>
            <div id="stat-correct" style="font-size: 1.5rem; font-weight: 800; color: #059669; margin-top: 0.25rem;">15</div>
          </div>
          <div class="card" style="text-align: center; padding: 1rem; border-radius: 12px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2);">
            <div style="font-size: 0.85rem; color: #d97706; font-weight: 600;">Sebagian</div>
            <div id="stat-partial" style="font-size: 1.5rem; font-weight: 800; color: #d97706; margin-top: 0.25rem;">2</div>
          </div>
          <div class="card" style="text-align: center; padding: 1rem; border-radius: 12px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);">
            <div style="font-size: 0.85rem; color: #dc2626; font-weight: 600;">Salah</div>
            <div id="stat-wrong" style="font-size: 1.5rem; font-weight: 800; color: #dc2626; margin-top: 0.25rem;">3</div>
          </div>
        </div>

        <div id="result-breakdown" class="stack">
          <div class="card" style="text-align: center; padding: 3.5rem 2rem; color: #64748b; font-family: 'Outfit', sans-serif; border-radius: 16px;">
            <div style="font-size: 3.5rem; margin-bottom: 1rem;">🔒</div>
            <div style="font-weight: 800; font-size: 1.5rem; color: #4f46e5; margin-bottom: 0.75rem;">Pembahasan Soal Dirahasiakan</div>
            <p style="font-size: 0.95rem; color: #64748b; max-width: 480px; margin: 0 auto 2rem auto; line-height: 1.6;">
              Kunci jawaban dan pembahasan belum dibuka oleh Guru/Pengawas ujian untuk menjaga kerahasiaan soal selama periode Try Out atau ujian berlangsung.
            </p>
            <a id="dashboard-back-btn" href="#" class="link-btn" style="text-decoration: none; padding: 0.85rem 2rem; font-size: 1rem; border-radius: 12px;">Kembali ke Dashboard</a>
          </div>
        </div>
      </main>
    </body>
  </html>
  `;

  await page.setContent(resultHtml);
  await page.screenshot({ path: path.join(outputDir, "tampilan-hasil-nilai-saja.png"), fullPage: true });
  console.log("Screenshot 1 tersimpan: screenshots/tampilan-hasil-nilai-saja.png");

  // 2. Tampilan Pop-up Selamat Selesai Ujian (Modal congrats saat submit selesai)
  const modalHtml = `
  <!doctype html>
  <html lang="id">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Ujian Selesai</title>
      <link rel="stylesheet" href="file://${path.resolve("./css/main.css")}" />
      <style>
        body { font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: rgba(15, 23, 42, 0.6); margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .card { background: white; border-radius: 20px; padding: 2.5rem; max-width: 450px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); }
        .link-btn { display: block; background: #4f46e5; color: white; padding: 0.75rem 2rem; border-radius: 12px; text-decoration: none; font-weight: 700; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div style="font-size: 3.5rem; margin-bottom: 1rem;">🎉</div>
        <h2 style="color: #10b981; margin-top: 0; font-weight: 800; font-size: 1.6rem;">Try Out PM selesai!</h2>
        <p style="color: #64748b; line-height: 1.6; font-size: 0.95rem; margin-bottom: 1.5rem;">
          Selamat! Kamu sudah menyelesaikan Try Out PM dengan baik.
        </p>

        <!-- Box Nilai (Hanya muncul jika mode score_only) -->
        <div style="background: rgba(79, 70, 229, 0.05); border: 1.5px dashed #4f46e5; border-radius: 16px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <div style="font-size: 0.85rem; font-weight: 700; color: #4f46e5; text-transform: uppercase; letter-spacing: 0.5px;">Nilai Kamu</div>
          <div style="font-size: 3rem; font-weight: 800; color: #4f46e5; line-height: 1.1; margin: 0.25rem 0;">780</div>
          <div style="font-size: 0.85rem; color: #64748b; font-weight: 500;">Skala 1000</div>
          <p style="font-size: 0.8rem; color: #94a3b8; margin: 0.5rem 0 0 0; line-height: 1.4;">
            *Pembahasan soal dirahasiakan selama periode ujian berlangsung.
          </p>
        </div>

        <div style="display: flex; gap: 0.75rem; justify-content: center; flex-direction: column;">
          <a href="#" class="link-btn">Lihat Rincian Nilai</a>
          <button type="button" style="padding: 0.75rem 2rem; font-weight: 700; border-radius: 12px; cursor: pointer; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; box-shadow: 0 8px 16px rgba(16, 185, 129, 0.2); width: 100%;">Kembali ke Dashboard</button>
        </div>
      </div>
    </body>
  </html>
  `;

  await page.setContent(modalHtml);
  await page.screenshot({ path: path.join(outputDir, "tampilan-popup-selesai-nilai-saja.png") });
  console.log("Screenshot 2 tersimpan: screenshots/tampilan-popup-selesai-nilai-saja.png");

  await browser.close();
}

run().catch(console.error);
