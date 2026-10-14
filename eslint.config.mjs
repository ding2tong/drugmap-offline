import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const compatibility = new FlatCompat({ baseDirectory: currentDirectory });

const config = [
  { ignores: ["release/**", "data/**", ".next/**", ".next-dev/**", "node_modules/**", "out/**", "public/sw.js", "next-env.d.ts"] },
  ...compatibility.extends("next/core-web-vitals", "next/typescript"),
];

export default config;

