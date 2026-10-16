import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client + the static design prototype
    // (in-browser Babel JSX, never built or imported by the app).
    "src/generated/**",
    "design_handoff_kosloski_law_crm/**",
    // Agent git worktrees (.claude/worktrees/*) are full copies of
    // the repo; linting them from the main checkout double-reports.
    ".claude/**",
  ]),
]);

export default eslintConfig;
