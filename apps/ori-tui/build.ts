#!/usr/bin/env bun

import solidPlugin from "./node_modules/@opentui/solid/scripts/solid-plugin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dir = path.resolve(__dirname);

process.chdir(dir);

import pkg from "./package.json";

console.log("Building ori-tui...");

const target = `bun-${process.platform}-${process.arch}` as any;

await Bun.build({
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  compile: {
    target: target,
    outfile: "bin/ori-tui",
  },
  entrypoints: ["./src/index.tsx"],
  minify: false, // Keep readable for debugging
});

console.log("✓ Build complete: bin/ori-tui");
