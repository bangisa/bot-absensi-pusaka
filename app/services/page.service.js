import {
  getBrowser,
  incrementContexts,
  decrementContexts,
} from "./browser.service.js";
import {
  configurePage,
  attachPageListeners,
  detachPageListeners,
} from "../helpers/index.js";
import { browserConfig } from "./../config/index.js";

export async function getPage(user = null) {
  const browser = await getBrowser();

  const context = await browser.createBrowserContext();

  incrementContexts();

  await context.overridePermissions(browserConfig.baseUrl, ["geolocation"]);

  const page = await context.newPage();

  configurePage(page);

  attachPageListeners(page, {
    userId: user?.id,
    requestFailed: true,
  });

  return { page, context };
}

export async function releasePage(page, context) {
  let contextReleased = false;

  try {
    if (page && !page.isClosed()) {
      detachPageListeners(page);

      await page.close({
        runBeforeUnload: false,
      });
    }
  } catch (err) {
    console.log("[X] Gagal close page:", err.message);
  }

  try {
    if (context) {
      await context.close();
      contextReleased = true;
    }
  } catch (err) {
    const message = err?.message ?? "";

    const alreadyClosed =
      message.toLowerCase().includes("closed") ||
      message.toLowerCase().includes("detached");

    if (!alreadyClosed) {
      console.log("[X] Gagal close context:", message);
    }

    contextReleased = true;
  } finally {
    if (contextReleased) {
      decrementContexts();
    }
  }
}
