import globals from "globals"
import pluginJs from "@eslint/js"
import tseslint from "typescript-eslint"

export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {},
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Type-aware rules.
  //
  // The config used typescript-eslint's `recommended`, not
  // `recommendedTypeChecked`, so every rule that needs type information was
  // off. That is the family that catches the mistakes this codebase actually
  // makes: a promise nobody awaits, an async function passed where a sync one
  // is expected. Enabled deliberately rather than by taking the whole
  // recommendedTypeChecked set, which is mostly `any` hygiene and would bury
  // these behind hundreds of suppressions.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "child_process",
              message:
                "Spawning is governed: go through tool/shell.ts (permission + sandbox) or shell/sandbox, so a command cannot bypass the approval path.",
            },
          ],
        },
      ],
    },
  },
]
