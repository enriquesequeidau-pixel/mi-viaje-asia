import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

await mkdir('assets', { recursive: true });
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [512, 'icon-maskable-512.png'], [180, 'apple-touch-icon.png']]) {
  await sharp('app-icon-v2.png').resize(size, size).png({ compressionLevel: 9, palette: true }).toFile(`assets/${name}`);
}
