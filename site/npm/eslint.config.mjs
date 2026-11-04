import js from "@eslint/js";
import globals from "globals";

// The browser app's sources live one level up; the linter and its plugins live here, pinned with the other tools.
export default [
  { basePath: "..", ignores: ["npm/**"] },
  { ...js.configs.recommended, basePath: "..", files: ["*.js", "test/*.mjs"] },
  {
    basePath: "..",
    files: ["*.js", "test/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, ...globals.worker } },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-restricted-properties": ["error",
        { property: "innerHTML", message: "Build nodes with h(); text never becomes markup." },
        { property: "outerHTML", message: "Build nodes with h(); text never becomes markup." },
        { object: "document", property: "write", message: "Not allowed." }],
      "no-restricted-syntax": ["error", { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Build nodes with h()." }],
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  { basePath: "..", files: ["sw.js"], languageOptions: { sourceType: "script", globals: { ...globals.serviceworker, __ASSETS__: "readonly" } } },
  { basePath: "..", files: ["test/*.mjs"], languageOptions: { globals: globals.node } },
];
