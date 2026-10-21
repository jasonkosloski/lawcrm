/**
 * Overlays a VOID stamp on an existing invoice PDF. Overlay only: the
 * original page content (and its extractable text) is left untouched.
 */
import "server-only";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export async function stampVoid(
  bytes: Buffer,
  voidedOn: string
): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const red = rgb(0.8, 0.1, 0.1);

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();

    // Big diagonal VOID, centred on the page and rotated 45° about it.
    const size = width / 4;
    const w = bold.widthOfTextAtSize("VOID", size);
    const h = bold.heightAtSize(size, { descender: false });
    const rad = Math.PI / 4;
    // Rotation is about the draw origin, so offset it to land the text
    // centre on the page centre.
    const x = width / 2 - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad);
    const y = height / 2 - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad);
    page.drawText("VOID", {
      x,
      y,
      size,
      font: bold,
      color: red,
      opacity: 0.35,
      rotate: degrees(45),
    });

    const label = `Voided ${voidedOn}`;
    const lw = regular.widthOfTextAtSize(label, 10);
    page.drawText(label, {
      x: width - 36 - lw,
      y: height - 28,
      size: 10,
      font: regular,
      color: red,
    });
  }

  return Buffer.from(await doc.save());
}
