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

const buildConfig: BunBuildConfig = {
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    compile: {
        target,
        outfile: "bin/ori",
    },
    entrypoints: ["./src/index.tsx"],
    minify: false, // Keep readable for debugging
};

await Bun.build(buildConfig);

console.log("✓ Build complete: bin/ori");
