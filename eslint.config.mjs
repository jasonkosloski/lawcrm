import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // alert()/confirm()/prompt() block the page and ignore the brand.
    // Use notifyError / notifySuccess / confirmAction (src/lib/feedback.ts).
    rules: { "no-alert": "error" },
  },
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Use NativeSelect from @/components/ui/native-select (brand styling, aria-invalid errors).",
        },
      ],
    },
  },
  // Last: turn off stylistic rules that would fight Prettier.
  prettier,
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
