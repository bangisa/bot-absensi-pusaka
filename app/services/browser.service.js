import { launch } from "puppeteer";
import { browserConfig } from "../config/index.js";

let browserInstance = null;
let activeContexts = 0;
let launchedAt = null;

async function getBrowser() {
  if (browserInstance && !browserInstance.isConnected()) {
    browserInstance = null;
  }

  if (!browserInstance) {
    browserInstance = await launch({
      // executablePath: "/usr/bin/chromium",
      headless: browserConfig.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-accelerated-2d-canvas",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-sync",
        "--mute-audio",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-features=Translate,BackForwardCache",
        "--disable-ipc-flooding-protection",
        "--metrics-recording-only",
        "--password-store=basic",
        "--use-mock-keychain",
      ],
      defaultViewport: {
        width: 1280,
        height: 720,
      },
    });

    launchedAt = Date.now();

    browserInstance.on("disconnected", () => {
      console.log("[!] Browser closed");
      browserInstance = null;
      launchedAt = null;
    });
  }

  return browserInstance;
}

async function closeBrowserIfIdle(reason = "idle") {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = null;
    launchedAt = null;
    return false;
  }

  if (activeContexts > 0) {
    return false;
  }

  console.log(`[BROWSER] Closing idle browser: ${reason}`);

  const browser = browserInstance;
  browserInstance = null;
  launchedAt = null;

  await browser.close();

  return true;
}

function incrementContexts() {
  activeContexts++;
}

function decrementContexts() {
  activeContexts = Math.max(0, activeContexts - 1);
}

function getBrowserStatus() {
  return {
    connected: !!browserInstance?.connected,

    activeContexts,

    pid: browserInstance?.process()?.pid ?? null,

    headless: browserConfig.headless,

    launchedAt,

    uptime: launchedAt ? Date.now() - launchedAt : 0,
  };
}

export {
  getBrowser,
  closeBrowserIfIdle,
  getBrowserStatus,
  incrementContexts,
  decrementContexts,
};


