#!/usr/bin/env node
/**
 * Render AutoShop SMS AI logo PNGs using Puppeteer + Google Fonts.
 * Produces:
 *   autoshop-logo-stripe.png  — 1200x300, white bg
 *   autoshop-icon-square.png  — 512x512, navy bg
 */
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';

function buildHTML({ width, height, bgColor, darkColor, accentColor, fontSize, letterSpacing }) {
  return `<!DOCTYPE html>
<html>
<head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; }
  body {
    width: ${width}px;
    height: ${height}px;
    background: ${bgColor};
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .logo {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: ${fontSize}px;
    letter-spacing: ${letterSpacing}px;
    text-transform: uppercase;
    white-space: nowrap;
    color: ${darkColor};
  }
  .logo .sms { color: ${accentColor}; }
</style>
</head>
<body>
  <div class="logo">AUTOSHOP <span class="sms">SMS</span> AI</div>
</body>
</html>`;
}

async function renderLogo(browser, filename, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: opts.width, height: opts.height, deviceScaleFactor: 1 });
  await page.setContent(buildHTML(opts), { waitUntil: 'networkidle0' });
  // Wait for font to load
  await page.evaluate(() => document.fonts.ready);
  const outPath = path.join(__dirname, '..', filename);
  await page.screenshot({ path: outPath, type: 'png' });
  await page.close();
  console.log(`${filename}: ${opts.width}x${opts.height}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // 1) Stripe logo — white bg, navy+rust text
  await renderLogo(browser, 'autoshop-logo-stripe.png', {
    width: 1200,
    height: 300,
    bgColor: '#FFFFFF',
    darkColor: '#0D1B2A',
    accentColor: '#C94B1F',
    fontSize: 88,
    letterSpacing: 6,
  });

  // 2) Square icon — navy bg, white+rust text
  await renderLogo(browser, 'autoshop-icon-square.png', {
    width: 512,
    height: 512,
    bgColor: '#0D1B2A',
    darkColor: '#FFFFFF',
    accentColor: '#C94B1F',
    fontSize: 52,
    letterSpacing: 4,
  });

  await browser.close();
  console.log('Done.');
})();
