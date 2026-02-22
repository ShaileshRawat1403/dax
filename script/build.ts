import * as esbuild from "esbuild";
import { mkdirSync, existsSync } from "node:fs";

const isWatch = process.argv.includes("--watch");
const outdir = "dist";

if (!existsSync(outdir)) {
  mkdirSync(outdir);
}

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ["cli/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/cli.js",
  format: "esm",
  external: [],
  sourcemap: true,
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete: dist/cli.js");
}
