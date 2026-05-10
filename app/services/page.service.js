import { getBrowser } from "./browser.service.js";

const BASE_URL = "https://pusaka-v3.kemenag.go.id";

let activeContexts = 0;

export async function getPage() {
  const browser = await getBrowser();

  const context = await browser.createBrowserContext();

  activeContexts++;
  console.log("[CTX OPEN]", activeContexts);

  await context.overridePermissions(BASE_URL, ["geolocation"]);

  const page = await context.newPage();

  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);

  page.on("console", (msg) => console.log("[PAGE]", msg.text()));

  page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));

  return { page, context };
}

export async function releasePage(page, context) {
  try {
    if (page && !page.isClosed()) {
      page.removeAllListeners();
      await page.close();
    }
  } catch (err) {
    console.log("[X] Gagal close page:", err.message);
  }

  try {
    if (context) {
      await context.close();

      activeContexts--;
      console.log("[CTX CLOSE]", activeContexts);
    }
  } catch (err) {
    console.log("[X] Gagal close context:", err.message);
  }
}
