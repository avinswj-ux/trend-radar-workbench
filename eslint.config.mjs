import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "storage/**",
    "public/generated/**",
    "production/**",
  ]),
]);
