import { launch } from "puppeteer";
import { browserConfig } from "../config/index.js";

let browserInstance = null;
let browserLaunchPromise = null;
let activeContexts = 0;
let launchedAt = null;

function isBrowserConnected(browser) {
  return !!browser && browser.isConnected();
}

async function launchBrowserSingleFlight() {
  const launchedBrowser = await launch({
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

  browserInstance = launchedBrowser;
  launchedAt = Date.now();

  launchedBrowser.on("disconnected", () => {
    console.log("[!] Browser closed");

    // Only clear the global state when the disconnected browser is still
    // the currently tracked instance. This prevents a stale disconnect
    // event from clearing a newer replacement browser.
    if (browserInstance === launchedBrowser) {
      browserInstance = null;
      launchedAt = null;
    }
  });

  return launchedBrowser;
}

async function getBrowser() {
  if (browserInstance && !isBrowserConnected(browserInstance)) {
    browserInstance = null;
    launchedAt = null;
  }

  if (isBrowserConnected(browserInstance)) {
    return browserInstance;
  }

  // Single-flight browser initialization: concurrent callers share the same
  // launch promise instead of creating multiple Chromium instances.
  if (!browserLaunchPromise) {
    browserLaunchPromise = launchBrowserSingleFlight().finally(() => {
      browserLaunchPromise = null;
    });
  }

  return browserLaunchPromise;
}

async function closeBrowserIfIdle(reason = "idle") {
  // If initialization is already in progress, wait for that same browser
  // instead of allowing it to become untracked during an idle close.
  if (browserLaunchPromise) {
    try {
      await browserLaunchPromise;
    } catch {
      return false;
    }
  }

  if (!isBrowserConnected(browserInstance)) {
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

async function closeBrowserForShutdown(reason = "shutdown") {
  // Full-drain shutdown must not leave an in-flight launch orphaned. Wait for
  // the single-flight initialization to settle before applying the cold-close
  // invariant.
  if (browserLaunchPromise) {
    try {
      await browserLaunchPromise;
    } catch {
      // A failed launch has no live browser resource to close.
    }
  }

  if (!isBrowserConnected(browserInstance)) {
    browserInstance = null;
    launchedAt = null;
    return false;
  }

  if (activeContexts > 0) {
    throw new Error(
      `Browser belum bisa ditutup: masih ada ${activeContexts} context aktif`,
    );
  }

  console.log(`[BROWSER] Cold close: ${reason}`);

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
    connected: isBrowserConnected(browserInstance),

    launching: !!browserLaunchPromise,

    activeContexts,

    pid: browserInstance?.process()?.pid ?? null,

    headless: browserConfig.headless,

    launchedAt,

    uptime: launchedAt ? Date.now() - launchedAt : 0,
  };
}

async function getBrowserDiagnostics() {
  const status = getBrowserStatus();

  if (!isBrowserConnected(browserInstance)) {
    return {
      ...status,
      pageCount: 0,
    };
  }

  try {
    const pages = await browserInstance.pages();
    return {
      ...status,
      pageCount: pages.length,
    };
  } catch (err) {
    return {
      ...status,
      pageCount: null,
      diagnosticsError: err.message,
    };
  }
}

export {
  getBrowser,
  closeBrowserIfIdle,
  closeBrowserForShutdown,
  getBrowserStatus,
  getBrowserDiagnostics,
  incrementContexts,
  decrementContexts,
};
