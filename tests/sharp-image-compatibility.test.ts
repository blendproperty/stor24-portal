import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { detectContentType, optimizeImage } from "next/dist/server/image-optimizer";
import { normaliseFacialPhoto } from "../src/lib/facial-photo-security";
import { normaliseIdentityPage } from "../src/lib/identity-document-security";
import { trainingSample, validateTrainingSample } from "../src/lib/move-in-training";

test("SVG disguised as an allowed raster upload stays rejected", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="blue"/></svg>';
  for (const type of ["image/jpeg", "image/png"]) {
    await assert.rejects(normaliseFacialPhoto(new File([svg], "photo", { type })), /PHOTO_INVALID/);
    await assert.rejects(normaliseIdentityPage(new File([svg], "page", { type })), /ID_INVALID/);
  }
});

test("application-authored SVG training sample still renders and validates", async () => {
  const image = await trainingSample();
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 320);
  await validateTrainingSample(new File([new Uint8Array(image)], "training.png", { type: "image/png" }));
});

test("Next image optimizer still resizes raster inputs and encodes supported outputs", async () => {
  const buffer = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#336699" } }).png().toBuffer();
  for (const [contentType, format] of [["image/jpeg", "jpeg"], ["image/webp", "webp"], ["image/avif", "heif"]]) {
    const optimized = await optimizeImage({ buffer, contentType, quality: 75, width: 160 });
    const metadata = await sharp(optimized).metadata();
    assert.equal(await detectContentType(optimized), contentType);
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 160);
    assert.equal(metadata.height, 120);
  }
});
