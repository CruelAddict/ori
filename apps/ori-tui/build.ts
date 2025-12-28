#!/usr/bin/env bun

// @ts-nocheck

import path from "node:path";
import { fileURLToPath } from "node:url";
import solidPlugin from "./node_modules/@opentui/solid/scripts/solid-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dir = path.resolve(__dirname);

process.chdir(dir);

import pkg from "./package.json";

const versionLabel = pkg?.version ? ` v${pkg.version}` : "";
console.log(`Building ori${versionLabel}...`);

type BunBuildConfig = Parameters<typeof Bun.build>[0];
type CompileOptions = NonNullable<BunBuildConfig["compile"]>;

const target = `bun-${process.platform}-${process.arch}` as CompileOptions["target"];

const TREE_SITTER_WORKER_PATH = "/$bunfs/root/node_modules/@opentui/core/parser.worker.js";

const buildConfig: BunBuildConfig = {
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  compile: {
    target,
    outfile: "bin/ori",
  },
  entrypoints: [
    "./src/index.tsx",
    "./node_modules/@opentui/core/parser.worker.js",
    "./src/assets/tree-sitter-sql.wasm",
    "./src/assets/highlights.scm",
  ],
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(TREE_SITTER_WORKER_PATH),
  },
  minify: false, // Keep readable for debugging
};

const result = await Bun.build(buildConfig);

if (result.success) {
  console.log("✓ Build complete: bin/ori");
  // Copy SQL assets to bunfs root so TreeSitterClient’s bunfs normalization finds them.
  const targetWasm = path.join(dir, "tree-sitter-sql.wasm");
  const targetHighlights = path.join(dir, "highlights.scm");
  await Bun.write(targetWasm, await Bun.file("./src/assets/tree-sitter-sql.wasm").arrayBuffer());
  await Bun.write(targetHighlights, await Bun.file("./src/assets/highlights.scm").text());
  console.log("✓ Copied SQL assets to bunfs root flattening targets");
} else {
  console.error("✗ Build failed");
  result.logs?.forEach((log) => {
    console.error(log);
  });
  process.exit(1);
}
