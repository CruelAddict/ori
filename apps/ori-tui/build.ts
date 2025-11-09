#!/usr/bin/env bun
// @ts-nocheck

import solidPlugin from "./node_modules/@opentui/solid/scripts/solid-plugin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dir = path.resolve(__dirname);

process.chdir(dir);

import pkg from "./package.json";

const versionLabel = pkg?.version ? ` v${pkg.version}` : "";
console.log(`Building ori-tui${versionLabel}...`);

const target = `bun-${process.platform}-${process.arch}` as any;

await Bun.build({
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  compile: {
    target,
    outfile: "bin/ori-tui",
  },
  entrypoints: ["./src/index.tsx"],
  minify: false, // Keep readable for debugging
} as any);

console.log("✓ Build complete: bin/ori-tui");
