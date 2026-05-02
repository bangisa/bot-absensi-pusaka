const { getBrowser } = require("./browser.service");

const pagePool = [];
const MAX_PAGE = 3;

// Ambil page
async function getPage() {
  // ambil dari pool kalau ada
  if (pagePool.length > 0) {
    return pagePool.pop();
  }

  // kalau tidak ada, buat baru
  const browser = await getBrowser();
  return await browser.newPage();
}

// Kembalikan page ke pool
async function releasePage(page) {
  try {
    await page.goto("about:blank");

    if (pagePool.length >= MAX_PAGE) {
      await page.close();
    } else {
      pagePool.push(page);
    }
  } catch (err) {
    console.log("[X] Page rusak, tidak dikembalikan ke pool");
  }
}

module.exports = {
  getPage,
  releasePage,
};
