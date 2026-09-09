import sharp from "sharp";

const width = 270;
const height = 147;
const fadeWidth = 142;
const source = await sharp("public/brand/turbo-lev-document-car.png")
  .resize(width, height, { fit: "fill" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (let x = 0; x < width; x += 1) {
  const progress = Math.max(0, Math.min(1, x / fadeWidth));
  const smooth = progress * progress * (3 - 2 * progress);
  for (let y = 0; y < height; y += 1) {
    const alphaIndex = (y * width + x) * 4 + 3;
    source.data[alphaIndex] = Math.round(source.data[alphaIndex] * smooth);
  }
}

await sharp(source.data, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile("public/brand/turbo-lev-document-car-panorama.png");
