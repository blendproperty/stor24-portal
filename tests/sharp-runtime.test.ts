import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

test("patched image runtime preserves SVG training renders and raster decoding", async () => {
  const [major, minor, patch] = sharp.versions.sharp.split(".").map(Number);
  assert.ok(major > 0 || minor > 35 || (minor === 35 && patch >= 5), "sharp must include the librsvg security patch");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#808080"/></svg>');
  const png = await sharp(svg).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 320);
  const jpeg = await sharp(png).jpeg().toBuffer();
  assert.equal((await sharp(jpeg).metadata()).format, "jpeg");
  await assert.rejects(sharp(Buffer.from("invalid image")).png().toBuffer());
});
