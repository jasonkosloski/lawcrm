/**
 * Guard: every TipTap editor gets its extensions from a preset, so the
 * StarterKit is configured in exactly two places (the shared presets and
 * the template editor's own extension module). A new `useEditor` setup
 * with its own StarterKit would bypass the sanitizer pairing (ADR-068).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ALLOWED = new Set([
  "src/components/editor/presets.ts",
  "src/components/templates/editor/extensions.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("StarterKit usage", () => {
  it("is imported only by the presets and the template extensions", () => {
    const offenders = sourceFiles(join(process.cwd(), "src"))
      .map((f) => relative(process.cwd(), f))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => /["']@tiptap\/starter-kit["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
