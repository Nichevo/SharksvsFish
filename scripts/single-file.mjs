// Turns the Vite build in dist/ into one self-contained HTML file that opens
// straight from disk (double-click), with no server or internet needed.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
let html = readFileSync(join(dist, "index.html"), "utf8");

html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_, file) => {
  const js = readFileSync(join(dist, file), "utf8").replace(/<\/script/gi, "<\\/script");
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/g, (_, file) => {
  return `<style>${readFileSync(join(dist, file), "utf8")}</style>`;
});

if (/src="\.\/assets|href="\.\/assets/.test(html)) {
  throw new Error("single-file: some assets were not inlined");
}
writeFileSync(join(dist, "sharks-vs-fish.html"), html);
console.log(`single-file: wrote ${join(dist, "sharks-vs-fish.html")} (${Math.round(html.length / 1024)} KB)`);
