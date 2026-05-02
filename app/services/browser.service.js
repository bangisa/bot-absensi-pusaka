const puppeteer = require("puppeteer");

const BASE_URL = "https://pusaka-v3.kemenag.go.id";

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = browserInstance.defaultBrowserContext();
    await context.overridePermissions(BASE_URL, ["geolocation"]);

    browserInstance.on("disconnected", () => {
      console.log("[!] Browser closed, resetting instance...");
      browserInstance = null;
    });
  }

  return browserInstance;
}

module.exports = { getBrowser };
