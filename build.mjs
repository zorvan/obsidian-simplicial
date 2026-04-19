import esbuild from "esbuild";
import process from "node:process";

const production = process.argv[2] === "production";
const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  target: "es2020",
  sourcemap: production ? false : "inline",
  minify: production,
  legalComments: "none",
  treeShaking: true,
  logLevel: "info",
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/commands",
    "@codemirror/search",
    "@codemirror/language",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/lint",
    "@codemirror/panel",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr"
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development")
  }
});

if (watch) {
  await context.watch();
  console.log("[simplicial-complex] watching for changes...");
} else {
  await context.rebuild();
  await context.dispose();
}
