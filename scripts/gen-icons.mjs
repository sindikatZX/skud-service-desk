/**
 * Генерация PNG-иконок PWA из public/icons/icon.svg.
 * Запуск: node scripts/gen-icons.mjs
 * Требует sharp (ставится транзитивно вместе с next).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "public", "icons");
await mkdir(out, { recursive: true });

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp не найден — установите `npm i -D sharp` и повторите");
  process.exit(1);
}

const brand = "#4338ca";
/** Обычная иконка: скруглённый квадрат + символ камеры/считывателя. */
const iconSvg = (size, { maskable = false } = {}) => {
  // Для maskable оставляем безопасную зону 20 % по краям: рисуем сплошной фон и уменьшенный символ.
  const pad = maskable ? size * 0.2 : 0;
  const inner = size - pad * 2;
  const rx = maskable ? 0 : size * 0.1875;
  const s = inner / 512; // масштаб относительно исходного 512-viewBox
  const tx = pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${brand}"/>
  <g transform="translate(${tx} ${tx}) scale(${s})">
    <circle cx="256" cy="232" r="96" fill="none" stroke="#fff" stroke-width="28"/>
    <circle cx="256" cy="232" r="36" fill="#fff"/>
    <rect x="176" y="352" width="160" height="56" rx="16" fill="#fff"/>
  </g>
</svg>`;
};

const jobs = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-192.png", 192, { maskable: true }],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, {}],
  ["favicon-32.png", 32, {}],
];

for (const [name, size, opts] of jobs) {
  const png = await sharp(Buffer.from(iconSvg(size, opts))).png().toBuffer();
  await writeFile(path.join(out, name), png);
  console.log("✓", name, `${size}×${size}`);
}

// Ярлыки для manifest.shortcuts (монохромные символы на фирменном фоне)
const shortcut = (glyph) => `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="${brand}"/>
  <text x="48" y="62" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#fff" text-anchor="middle">${glyph}</text>
</svg>`;
for (const [name, glyph] of [["shortcut-new.png", "+"], ["shortcut-list.png", "≡"], ["shortcut-team.png", "⛟"]]) {
  await writeFile(path.join(out, name), await sharp(Buffer.from(shortcut(glyph))).png().toBuffer());
  console.log("✓", name);
}
