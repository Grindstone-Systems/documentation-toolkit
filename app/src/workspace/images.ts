import { imageMime } from "../../../lib/workspace.ts";

const MAX_INPUT = 20 * 1024 * 1024;

/**
 * Re-encode an image the user picked. Drawing it to a canvas and encoding
 * again drops metadata (camera, GPS, editing history) and caps its size.
 * Only PNG, JPEG and WebP are decoded; SVG and anything else are refused.
 */
export async function reencode(file: File, opts: { maxWidth: number; type: "image/png" | "image/jpeg"; quality?: number }): Promise<Uint8Array> {
  if (file.size > MAX_INPUT) throw new Error(`${file.name} is larger than 20 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!imageMime(bytes)) throw new Error(`${file.name} isn't a PNG, JPEG or WebP image.`);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const scale = Math.min(1, opts.maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext("2d")!;
    if (opts.type === "image/jpeg") {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the image."))), opts.type, opts.quality ?? 0.88));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
