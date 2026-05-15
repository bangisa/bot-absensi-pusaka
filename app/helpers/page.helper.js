function configurePage(page) {
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
}

function attachPageListeners(
  page,
  { userId = null, requestFailed = false } = {},
) {
  page.on("console", (msg) => {
    const text = String(msg.text?.() || "");

    if (text.includes("autocomplete attributes")) {
      return;
    }

    console.log(`[PAGE${userId ? ` USER=${userId}` : ""}]`, text);
  });

  page.on("pageerror", (err) => {
    console.log(`[PAGE ERROR${userId ? ` USER=${userId}` : ""}]`, err.message);
  });

  if (requestFailed) {
    page.on("requestfailed", (req) => {
      const url = req.url();

      if (url.includes("google-analytics") || url.includes("_rsc=")) {
        return;
      }

      console.log(`[REQUEST FAILED${userId ? ` USER=${userId}` : ""}]`, url);
    });
  }
}

function detachPageListeners(page) {
  page.removeAllListeners();
}

export { configurePage, attachPageListeners, detachPageListeners };
