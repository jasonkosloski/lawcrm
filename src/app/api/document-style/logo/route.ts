/**
 * /api/document-style/logo — the firm letterhead logo.
 *
 * Route handler, not a server action: document bytes never travel
 * through server actions (ADR-034).
 *
 *   POST    multipart, one `file` field. Needs `firm.edit_document_style`.
 *           Size <= 1 MB and PNG/JPEG magic bytes are checked (never the
 *           extension), then the image is re-encoded to PNG with sharp
 *           (longest side capped at 1200 px) so what we store is always a
 *           clean, bounded PNG. Replace order: store new file -> update
 *           row -> delete old file; a failed row update deletes the new
 *           file.
 *   DELETE  clears the logo and deletes the file. Same permission.
 *   GET     streams the PNG for previews. Any signed-in user.
 *
 * Permission uses `userHasPermission`, not `requirePermission`, because
 * the latter redirects, which is wrong for a fetch() caller (see
 * /api/documents/upload).
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { deleteFile, readStoredFile, storeFile } from "@/lib/file-storage";
import { userHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getStaffAuthFromRequest } from "@/lib/staff-auth";
import { logTemplateChange } from "@/lib/template-activity";
import { getDocumentStyle } from "@/lib/templates/document-style";
import { LOGO_MAX_BYTES } from "@/lib/templates/page-style";

const PERMISSION = "firm.edit_document_style";
const CHANGED = "The logo changed — try again.";
const MAX_DIMENSION = 1200;
/** Multipart framing slack on top of the 1 MB file cap. */
const BODY_SLACK = 64 * 1024;

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

function isPng(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}
function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

async function authorize(req: Request): Promise<{ userId: string } | { response: Response }> {
  const staff = await getStaffAuthFromRequest(req);
  if (staff.status !== "ok") return { response: fail("Unauthorized", 401) };
  if (!(await userHasPermission(staff.userId, PERMISSION))) {
    return {
      response: fail("You don't have permission to change the document style.", 403),
    };
  }
  return { userId: staff.userId };
}

export async function POST(req: Request): Promise<Response> {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;

  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader === null) return fail("Upload size unknown.", 411);
  const declared = Number(lengthHeader);
  if (!Number.isFinite(declared) || declared > LOGO_MAX_BYTES + BODY_SLACK) {
    return fail("The logo must be 1 MB or smaller.", 413);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return fail("Choose a PNG or JPEG image.", 400);
  }
  if (!(file instanceof File) || file.size === 0) return fail("Choose a PNG or JPEG image.", 400);
  if (file.size > LOGO_MAX_BYTES) return fail("The logo must be 1 MB or smaller.", 413);

  const input = new Uint8Array(await file.arrayBuffer());
  if (!isPng(input) && !isJpeg(input)) return fail("The logo must be a PNG or JPEG image.", 400);

  let png: Buffer;
  try {
    png = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return fail("That image couldn't be read.", 400);
  }
  // Generation refuses logos over the cap, so refuse them here too.
  if (png.length > LOGO_MAX_BYTES) return fail("That image is too large once processed.", 413);

  const stored = await storeFile(
    new File([new Uint8Array(png)], "logo.png", { type: "image/png" }),
  );

  const style = await getDocumentStyle();
  const previousKey = style.logoKey;
  let count: number;
  try {
    ({ count } = await prisma.documentStyle.updateMany({
      where: { id: style.id, logoKey: previousKey },
      data: {
        logoKey: stored.key,
        logoContentType: "image/png",
        updatedAt: new Date(),
        ...(style.logoPosition === "none" ? { logoPosition: "left" } : {}),
      },
    }));
  } catch (err) {
    await deleteFile(stored.key).catch(() => {});
    throw err;
  }
  if (count === 0) {
    await deleteFile(stored.key).catch(() => {});
    return fail(CHANGED, 409);
  }
  if (previousKey && previousKey !== stored.key) await deleteFile(previousKey).catch(() => {});

  await logTemplateChange(auth.userId, "Document style logo uploaded", null);
  const row = await getDocumentStyle();
  return NextResponse.json({
    ok: true,
    updatedAt: row.updatedAt.toISOString(),
    logoPosition: row.logoPosition,
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;

  const style = await getDocumentStyle();
  const previousKey = style.logoKey;
  const { count } = await prisma.documentStyle.updateMany({
    where: { id: style.id, logoKey: previousKey },
    data: { logoKey: null, logoContentType: null, updatedAt: new Date() },
  });
  if (count === 0) return fail(CHANGED, 409);
  if (previousKey) {
    await deleteFile(previousKey).catch(() => {});
    await logTemplateChange(auth.userId, "Document style logo removed", null);
  }
  const row = await getDocumentStyle();
  return NextResponse.json({
    ok: true,
    updatedAt: row.updatedAt.toISOString(),
    logoPosition: row.logoPosition,
  });
}

export async function GET(req: Request): Promise<Response> {
  const staff = await getStaffAuthFromRequest(req);
  if (staff.status !== "ok") return fail("Unauthorized", 401);

  const style = await getDocumentStyle();
  if (!style.logoKey) return new Response(null, { status: 404 });
  const bytes = await readStoredFile(style.logoKey, LOGO_MAX_BYTES + 1);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": style.logoContentType ?? "image/png",
      "Content-Length": String(bytes.length),
      // Stable URL, replaced in place: never cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
