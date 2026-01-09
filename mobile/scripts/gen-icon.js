const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function main() {
  const root = path.resolve(__dirname, '..');
  const inSvg = path.join(root, 'assets', 'icon-vault.svg');
  const outPng = path.join(root, 'assets', 'icon.png');
  const logoSvg = path.join(root, 'assets', 'logo-vault.svg');
  const logoPng = path.join(root, 'assets', 'logo.png');

  if (!fs.existsSync(inSvg)) {
    throw new Error(`Missing input SVG: ${inSvg}`);
  }

  const svg = fs.readFileSync(inSvg);

  await sharp(svg, { density: 512 })
    .resize(1024, 1024, { fit: 'cover' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPng);

  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPng}`);

  if (fs.existsSync(logoSvg)) {
    const logo = fs.readFileSync(logoSvg);
    await sharp(logo, { density: 512 })
      .resize(1024, 1024, { fit: 'cover' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(logoPng);
    // eslint-disable-next-line no-console
    console.log(`Wrote ${logoPng}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
