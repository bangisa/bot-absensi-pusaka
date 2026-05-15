import { browserConfig } from "../config/index.js";
import { sleep, logSuccess, logSkip, logFail } from "../helpers/index.js";
import { loginWithRetry } from "./auth.service.js";

async function gotoPresence(page, user) {
  for (let i = 0; i < 3; i++) {
    try {
      console.log(`[i] Go to presence attempt ${i + 1} user ${user.id}`);

      await page.goto(`${browserConfig.baseUrl}/profile/presence`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await page.waitForFunction(() => {
        const btns = [...document.querySelectorAll("button")];
        return btns.some((b) => b.innerText.toLowerCase().includes("presensi"));
      });

      await page.waitForFunction(
        () => {
          return (
            window.location.pathname.includes("/profile/presence") ||
            window.location.pathname.includes("/login")
          );
        },
        { timeout: 15000 },
      );

      const isLoginPage = await page.evaluate(() =>
        window.location.pathname.includes("/login"),
      );

      if (isLoginPage) {
        i = -1;
        console.log("[!] Session expired, mencoba login ulang...");

        const success = await loginWithRetry(page, user, 2);

        if (!success) {
          throw new Error("Login ulang gagal");
        }

        // ulangi navigasi setelah login
        continue;
      }

      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button")).filter(
          (btn) => {
            const text = btn.innerText.toLowerCase();
            return (
              btn.offsetParent !== null &&
              text.length > 3 &&
              (text.includes("presensi") ||
                text.includes("masuk") ||
                text.includes("pulang"))
            );
          },
        );
      });

      console.log("[V] Berhasil masuk halaman absensi");
      return true;
    } catch (err) {
      console.log(`[X] Gagal masuk presence: ${err.message}`);
    }

    await sleep(browserConfig.botDelay);
  }

  console.log("[X] Gagal masuk halaman absensi setelah retry");
  return false;
}

// CEK APAKAH SUDAH ABSEN
async function getPresenceStatus(page) {
  return await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter((btn) => btn.offsetParent !== null)
      .map((btn) => btn.innerText.toLowerCase().trim());

    console.log("[DEBUG BUTTONS]", JSON.stringify(buttons));

    const hasMasukButton = buttons.some((t) => t.includes("presensi masuk"));

    const hasPulangButton = buttons.some((t) => t.includes("presensi pulang"));

    const alreadyFinished = buttons.some((t) =>
      t.includes("anda sudah presensi hari ini"),
    );

    return {
      hasMasukButton,
      hasPulangButton,
      alreadyFinished,

      debug: buttons,
    };
  });
}

// KLIK PRESENSI
async function clickPresensi(page, type) {
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.innerText.toLowerCase().includes("presensi"),
    );

    return btn && !btn.disabled;
  });

  await sleep(3000);

  return await page.evaluate((type) => {
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (btn) => btn.offsetParent !== null,
    );

    for (const btn of buttons) {
      const text = btn.innerText.toLowerCase();

      const match =
        (type === "masuk" &&
          (text.includes("masuk") || text.includes("presensi masuk"))) ||
        (type === "pulang" &&
          (text.includes("pulang") || text.includes("presensi pulang")));

      if (match) {
        if (btn.disabled) return { status: "disabled" };

        btn.click();
        return { status: "clicked" };
      }
    }

    return { status: "not_found" };
  }, type);
}

async function clickWithRetry(page, type, maxRetry = 3) {
  for (let i = 0; i < maxRetry; i++) {
    const result = await clickPresensi(page, type);

    if (result.status !== "not_found") {
      return result;
    }

    console.log(`[i] Tombol belum ada, retry ${i + 1}`);
    await sleep(3000);
  }

  return { status: "not_found" };
}

// HANDLE MODAL
async function handleConfirm(page) {
  for (let i = 0; i < 5; i++) {
    const found = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const yes = btns.find((b) => b.innerText.toLowerCase().trim() === "ya");

      if (yes) {
        yes.click();
        return true;
      }

      return false;
    });

    if (found) {
      console.log("[i] Mengonfirmasi absen...");
      await page
        .waitForFunction(
          () => {
            return (
              document.body.innerText.toLowerCase().includes("berhasil") ||
              document.body.innerText.toLowerCase().includes("sudah presensi")
            );
          },
          { timeout: 10000 },
        )
        .catch(() => {});
      return true;
    }

    await sleep(3000);
  }

  return false;
}

async function handlePresenceFlow(page, type, user, startTime, now) {
  const status = await getPresenceStatus(page);
  console.log("[DEBUG STATUS]", status);

  if (type === "masuk") {
    if (!status.hasMasukButton) {
      return logSkip("Sudah presensi masuk", user, type, startTime, now);
    }
  }

  if (type === "pulang") {
    if (!status.hasPulangButton) {
      return logSkip("Sudah presensi pulang", user, type, startTime, now);
    }
  }

  const result = await clickWithRetry(page, type);

  if (result.status === "clicked") {
    await sleep(3000);
    await handleConfirm(page);

    return logSuccess(type, user, startTime, now);
  }

  if (result.status === "disabled") {
    return logSkip("Tombol disabled", user, type, startTime, now);
  }

  return logFail("Tombol tidak ditemukan", user, type, startTime, now);
}

export {
  gotoPresence,
  getPresenceStatus,
  clickPresensi,
  clickWithRetry,
  handleConfirm,
  handlePresenceFlow,
};
