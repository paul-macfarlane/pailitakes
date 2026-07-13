// Regenerates the binary brand assets from src/app/icon.svg (BRAND-2):
// favicon.ico (PNG-in-ICO 16/32/48), apple-icon.png (180), and the manifest
// PNGs in public/icons. Run after any change to the mark:
//   npx tsx scripts/render-brand-assets.ts
// Set OUT_DIR to also emit a proof sheet of the mark on tab-bar chrome.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = process.env.OUT_DIR;
const svg = readFileSync("src/app/icon.svg", "utf8");

async function renderPng(size: number, pad = 0): Promise<Buffer> {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: size, height: size },
  });
  // pad>0 inset-renders the tile (apple-icon wants its own opaque bleed)
  const inner = size - pad * 2;
  await page.setContent(
    `<body style="margin:0;background:transparent">
       <div style="padding:${pad}px">${svg.replace(
         "<svg ",
         `<svg width="${inner}" height="${inner}" `,
       )}</div>
     </body>`,
  );
  const buf = await page.screenshot({ omitBackground: pad === 0 });
  await browser.close();
  return buf as Buffer;
}

function buildIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const dirs: Buffer[] = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const d = Buffer.alloc(16);
    d.writeUInt8(size === 256 ? 0 : size, 0);
    d.writeUInt8(size === 256 ? 0 : size, 1);
    d.writeUInt8(0, 2); // palette
    d.writeUInt8(0, 3); // reserved
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += data.length;
    dirs.push(d);
  }
  return Buffer.concat([header, ...dirs, ...pngs.map((p) => p.data)]);
}

async function main() {
  mkdirSync("public/icons", { recursive: true });

  const [p16, p32, p48, p180, p192, p512] = await Promise.all(
    [16, 32, 48, 180, 192, 512].map((s) => renderPng(s)),
  );
  writeFileSync(
    "src/app/favicon.ico",
    buildIco([
      { size: 16, data: p16 },
      { size: 32, data: p32 },
      { size: 48, data: p48 },
    ]),
  );
  writeFileSync("src/app/apple-icon.png", p180);
  writeFileSync("public/icons/icon-192.png", p192);
  writeFileSync("public/icons/icon-512.png", p512);

  if (!OUT) {
    console.log("assets written (set OUT_DIR for a proof sheet)");
    return;
  }
  mkdirSync(OUT, { recursive: true });
  // proof sheet: the mark at real-world sizes on light + dark tab-bar chrome
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 640, height: 300 },
  });
  const cell = (bg: string, fg: string) =>
    `<div style="background:${bg};color:${fg};padding:16px;display:flex;gap:16px;align-items:center;font:13px system-ui">
       ${[16, 24, 32, 48, 96]
         .map(
           (s) =>
             `<span>${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</span>`,
         )
         .join("")}
       <span>16 / 24 / 32 / 48 / 96</span>
     </div>`;
  await page.setContent(
    `<body style="margin:0">${cell("#f1f3f4", "#202124")}${cell("#202124", "#e8eaed")}${cell("#ffffff", "#000")}</body>`,
  );
  await page.screenshot({ path: `${OUT}/mark-proof.png` });
  await browser.close();
  console.log("assets written");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
