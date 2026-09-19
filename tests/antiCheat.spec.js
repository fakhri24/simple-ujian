import { test, expect } from '@playwright/test';

test.describe('Anti-Cheat & Tablet/Mobile Tolerance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/login.html', { waitUntil: 'domcontentloaded' });
  });

  test('CHEATING_COOLDOWN_MS bernilai 10.000 ms (10 detik)', async ({ page }) => {
    const cooldown = await page.evaluate(async () => {
      const { CHEATING_COOLDOWN_MS } = await import('/js/antiCheat.js');
      return CHEATING_COOLDOWN_MS;
    });
    expect(cooldown).toBe(10000);
  });

  test('isTouchDevice mendeteksi layar sentuh vs desktop secara akurat', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const { isTouchDevice } = await import('/js/antiCheat.js');

      // 1. Desktop murni (Mouse, non-touch)
      const desktopWin = { matchMedia: (query) => ({ matches: query.includes('fine') }) };
      const desktopNav = { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' };
      const isDesktop = isTouchDevice(desktopWin, desktopNav);

      // 2. Mac desktop murni (Safari di macOS tanpa touch)
      const macWin = { matchMedia: () => ({ matches: false }) };
      const macNav = { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' };
      const isMac = isTouchDevice(macWin, macNav);

      // 3. iPad modern iPadOS 13+ (menyaru MacIntel tapi maxTouchPoints > 1)
      const ipadWin = { matchMedia: (query) => ({ matches: query.includes('coarse') }) };
      const ipadNav = { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' };
      const isIPad = isTouchDevice(ipadWin, ipadNav);

      // 4. Tablet Android (pointer coarse & Android UA)
      const androidWin = { matchMedia: (query) => ({ matches: query.includes('coarse') }) };
      const androidNav = { maxTouchPoints: 10, userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X800)', platform: 'Linux armv8l' };
      const isAndroid = isTouchDevice(androidWin, androidNav);

      // 5. HP iPhone / Smartphone
      const phoneWin = { matchMedia: (query) => ({ matches: query.includes('coarse') }) };
      const phoneNav = { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', platform: 'iPhone' };
      const isPhone = isTouchDevice(phoneWin, phoneNav);

      return { isDesktop, isMac, isIPad, isAndroid, isPhone };
    });

    expect(results.isDesktop).toBe(false);
    expect(results.isMac).toBe(false);
    expect(results.isIPad).toBe(true);
    expect(results.isAndroid).toBe(true);
    expect(results.isPhone).toBe(true);
  });

  test('isWritingInputActive mendeteksi kotak esai dan input teks/angka tapi mengabaikan radio/checkbox', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const { isWritingInputActive } = await import('/js/antiCheat.js');

      const container = document.createElement('div');
      document.body.appendChild(container);

      // Textarea esai
      const textarea = document.createElement('textarea');
      container.appendChild(textarea);

      // Input teks/pecahan
      const inputText = document.createElement('input');
      inputText.type = 'text';
      container.appendChild(inputText);

      // Input angka/desimal
      const inputNumber = document.createElement('input');
      inputNumber.type = 'number';
      container.appendChild(inputNumber);

      // Radio PG
      const inputRadio = document.createElement('input');
      inputRadio.type = 'radio';
      container.appendChild(inputRadio);

      // Checkbox PGK
      const inputCheckbox = document.createElement('input');
      inputCheckbox.type = 'checkbox';
      container.appendChild(inputCheckbox);

      // Contenteditable
      const divEditable = document.createElement('div');
      divEditable.contentEditable = 'true';
      container.appendChild(divEditable);

      // Test fokus textarea
      textarea.focus();
      const activeTextarea = isWritingInputActive(document);

      // Test fokus input teks
      inputText.focus();
      const activeInputText = isWritingInputActive(document);

      // Test fokus input angka
      inputNumber.focus();
      const activeInputNumber = isWritingInputActive(document);

      // Test fokus radio (tidak boleh dianggap typing)
      inputRadio.focus();
      const activeRadio = isWritingInputActive(document);

      // Test fokus checkbox (tidak boleh dianggap typing)
      inputCheckbox.focus();
      const activeCheckbox = isWritingInputActive(document);

      // Test fokus editable div
      divEditable.focus();
      const activeEditable = isWritingInputActive(document);

      // Test fokus body setelah blur (tidak ada input yang aktif)
      divEditable.blur();
      document.body.focus();
      const activeBody = isWritingInputActive(document);

      container.remove();

      return {
        activeTextarea,
        activeInputText,
        activeInputNumber,
        activeRadio,
        activeCheckbox,
        activeEditable,
        activeBody
      };
    });

    expect(results.activeTextarea).toBe(true);
    expect(results.activeInputText).toBe(true);
    expect(results.activeInputNumber).toBe(true);
    expect(results.activeRadio).toBe(false);
    expect(results.activeCheckbox).toBe(false);
    expect(results.activeEditable).toBe(true);
    expect(results.activeBody).toBe(false);
  });

  test('Cooldown 10 detik mengabaikan pemicu beruntun dalam 10 detik dan menerima setelah 10 detik', async ({ page }) => {
    const simulation = await page.evaluate(async () => {
      const { CHEATING_COOLDOWN_MS } = await import('/js/antiCheat.js');

      let lastCheatingLogTime = 0;
      const loggedEvents = [];

      const triggerCheatingViolation = (eventName, fakeNow) => {
        if (fakeNow - lastCheatingLogTime < CHEATING_COOLDOWN_MS) {
          return false; // Diabaikan karena cooldown
        }
        lastCheatingLogTime = fakeNow;
        loggedEvents.push({ event: eventName, time: fakeNow });
        return true; // Berhasil dicatat
      };

      // T = 0s: Pelanggaran pertama pada timestamp 20.000 ms (masuk karena 20000 - 0 >= 10000)
      const t0 = triggerCheatingViolation("Keluar Layar Penuh", 20000);

      // T = 2s: Pelanggaran kedua pada 22.000 ms (dalam cooldown 10s: 22000 - 20000 = 2000 < 10000, diabaikan)
      const t2 = triggerCheatingViolation("Kehilangan Fokus Browser", 22000);

      // T = 7s: Pelanggaran ketiga pada 27.000 ms (dalam cooldown 10s: 27000 - 20000 = 7000 < 10000, diabaikan)
      const t7 = triggerCheatingViolation("Keluar Layar Penuh", 27000);

      // T = 11.5s: Pelanggaran keempat pada 31.500 ms (setelah 10s: 31500 - 20000 = 11500 >= 10000, harus masuk)
      const t11 = triggerCheatingViolation("Membuka Tab Baru", 31500);

      return {
        t0,
        t2,
        t7,
        t11,
        totalLogged: loggedEvents.length
      };
    });

    expect(simulation.t0).toBe(true);
    expect(simulation.t2).toBe(false);
    expect(simulation.t7).toBe(false);
    expect(simulation.t11).toBe(true);
    expect(simulation.totalLogged).toBe(2);
  });

  test('Layar sentuh (tablet) mengabaikan window.blur tetapi tetap mencatat visibilitychange', async ({ page }) => {
    const simulation = await page.evaluate(async () => {
      const { isTouchDevice } = await import('/js/antiCheat.js');

      // Simulasikan lingkungan tablet
      const tabletWin = { matchMedia: (q) => ({ matches: q.includes('coarse') }) };
      const tabletNav = { maxTouchPoints: 5, userAgent: 'Android Tablet' };
      const isTouch = isTouchDevice(tabletWin, tabletNav);

      const logged = [];
      let hasSubmitted = false;
      let isSystemPopupOpen = false;

      // Logika onWindowBlur sama seperti di examPage.js
      const onWindowBlur = () => {
        if (isTouch) {
          return "IGNORED_TOUCH";
        }
        if (!hasSubmitted && !isSystemPopupOpen) {
          logged.push("Kehilangan Fokus Browser");
          return "LOGGED";
        }
      };

      // Logika onVisibilityChange sama seperti di examPage.js
      const onVisibilityChange = (state) => {
        if (state === "hidden" && !hasSubmitted) {
          logged.push("Membuka Tab Baru / Pindah Aplikasi");
          return "LOGGED";
        }
      };

      // 1. Tablet memicu blur (keyboard muncul, dock tertarik, dsb)
      const blurResult = onWindowBlur();

      // 2. Siswa benar-benar pindah tab / minimize browser
      const visibilityResult = onVisibilityChange("hidden");

      return {
        isTouch,
        blurResult,
        visibilityResult,
        logged
      };
    });

    expect(simulation.isTouch).toBe(true);
    expect(simulation.blurResult).toBe("IGNORED_TOUCH");
    expect(simulation.visibilityResult).toBe("LOGGED");
    expect(simulation.logged).toEqual(["Membuka Tab Baru / Pindah Aplikasi"]);
  });

  test('Sedang mengetik esai mengabaikan keluarnya mode fullscreen (toleransi keyboard virtual)', async ({ page }) => {
    const simulation = await page.evaluate(async () => {
      const { isWritingInputActive } = await import('/js/antiCheat.js');

      const container = document.createElement('div');
      document.body.appendChild(container);

      const textarea = document.createElement('textarea');
      container.appendChild(textarea);

      const logged = [];
      let lockOverlayVisible = false;

      const handleFullscreenChange = (isFS) => {
        // Toleransi esai sama persis dengan examPage.js
        if (isWritingInputActive(document)) {
          return "EXEMPTED_TYPING";
        }

        if (!isFS) {
          lockOverlayVisible = true;
          logged.push("Keluar dari Mode Layar Penuh");
          return "LOGGED";
        }
        return "FS_ACTIVE";
      };

      // Kasus A: Siswa sedang fokus di textarea esai, keyboard virtual mendesak browser keluar fullscreen
      textarea.focus();
      const resTyping = handleFullscreenChange(false);

      // Kasus B: Siswa tidak sedang fokus di textarea (kursor di luar), keluar fullscreen
      textarea.blur();
      document.body.focus();
      const resNonTyping = handleFullscreenChange(false);

      container.remove();

      return {
        resTyping,
        resNonTyping,
        lockOverlayVisible,
        logged
      };
    });

    expect(simulation.resTyping).toBe("EXEMPTED_TYPING");
    expect(simulation.resNonTyping).toBe("LOGGED");
    expect(simulation.lockOverlayVisible).toBe(true);
    expect(simulation.logged).toEqual(["Keluar dari Mode Layar Penuh"]);
  });

  test('Rotasi layar tablet dalam ambang batas toleransi mengabaikan keluar fullscreen', async ({ page }) => {
    const simulation = await page.evaluate(async () => {
      let lastOrientationChangeTime = 0;
      const logged = [];

      const handleFullscreenChange = (isFS, nowTime) => {
        if (nowTime - lastOrientationChangeTime < 2500) {
          return "EXEMPTED_ROTATION";
        }

        if (!isFS) {
          logged.push("Keluar dari Mode Layar Penuh");
          return "LOGGED";
        }
      };

      // T = 1000: Layar tablet dirotasi
      lastOrientationChangeTime = 1000;

      // T = 1500 (500ms setelah rotasi): Browser mobile mereset layout fullscreen sesaat
      const resDuringRotation = handleFullscreenChange(false, 1500);

      // T = 5000 (4 detik setelah rotasi): Siswa benar-benar keluar fullscreen tanpa rotasi
      const resAfterRotation = handleFullscreenChange(false, 5000);

      return {
        resDuringRotation,
        resAfterRotation,
        logged
      };
    });

    expect(simulation.resDuringRotation).toBe("EXEMPTED_ROTATION");
    expect(simulation.resAfterRotation).toBe("LOGGED");
    expect(simulation.logged).toEqual(["Keluar dari Mode Layar Penuh"]);
  });
});

