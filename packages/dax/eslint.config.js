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
      // Add any specific rules or overrides here
    },
  },
]
