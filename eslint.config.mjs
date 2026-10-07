import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "server/src/generated/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    linterOptions: { reportUnusedDisableDirectives: false },
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-debugger": "error",
      "no-constant-binary-expression": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
