import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'public/icons/source.png');
const SIZES = [16, 32, 48, 128];

for (const size of SIZES) {
  const out = resolve(ROOT, `public/icons/icon-${size}.png`);
  await sharp(SRC).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out);
  console.log(`✔ icon-${size}.png`);
}
