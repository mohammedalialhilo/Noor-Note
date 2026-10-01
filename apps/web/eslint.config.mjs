import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The app uses the App Router and has no Pages Router directory.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["netlify/functions/**/*.tsx"],
    // Netlify renders these pages outside the Next.js image pipeline.
    rules: { "@next/next/no-img-element": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "test-results/**", "next-env.d.ts", "public/search-worker.js", "public/graph-worker.js", "public/transcription-worker.js", "public/ai-note-worker.js", "public/semantic-worker.js", "public/publish-mermaid.js", "public/ocr/runtime/**", "public/transcription/runtime/**"]),
]);
