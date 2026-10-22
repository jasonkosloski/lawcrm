import "server-only";
import path from "node:path";

/** Absolute path of a bundled font file (server only). */
export function fontFilePath(file: string): string {
  return path.join(process.cwd(), "src/lib/templates/fonts", file);
}
