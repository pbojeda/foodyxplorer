import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Relax no-non-null-assertion in test files — controlled input, assertions
  // on known-shape data are legitimate (F116 lint cleanup).
  {
    files: ["packages/api/src/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  // Relax no-non-null-assertion in scraper package — auxiliary tooling,
  // non-runtime user path, controlled HTML parsing input (F116).
  {
    files: ["packages/scraper/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "**/coverage/", "**/*.js", "**/*.mjs"],
  },
);
