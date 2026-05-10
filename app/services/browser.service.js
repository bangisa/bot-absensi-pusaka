import { launch } from "puppeteer";

let browserInstance = null;

export async function getBrowser() {
  if (browserInstance && !browserInstance.isConnected()) {
    browserInstance = null;
  }

  if (!browserInstance) {
    browserInstance = await launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
      defaultViewport: {
        width: 1280,
        height: 720,
      },
    });

    browserInstance.on("disconnected", () => {
      console.log("[!] Browser closed");
      browserInstance = null;
    });
  }

  return browserInstance;
}
