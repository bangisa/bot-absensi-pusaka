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
  try {
    if (context) {
      detachPageListeners(page);

      await context.close();

      decrementContexts();
    }
  } catch (err) {
    console.log("[X] Gagal close context:", err.message);
  }
}
