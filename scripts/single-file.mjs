// Turns each page into one self-contained HTML file in dist/ that opens straight
// from disk (double-click), with no server or internet needed.
//
// Each page is built again on its own, so all of its code lands in one script that
// can be inlined (the normal build shares chunks between pages).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";

const dist = "dist";
const tmp = join(dist, ".single");
// Each page, and the offline file it becomes. Links between pages point at the offline files.
const pages = [
  ["index.html", "sharks-vs-fish.html"],
  ["ultra.html", "sharks-vs-fish-ultra.html"],
];

for (const [page, out] of pages) {
  const dir = join(tmp, out);
  await build({ logLevel: "warn", build: { outDir: dir, emptyOutDir: true, rollupOptions: { input: page } } });
  let html = readFileSync(join(dir, page), "utf8");

  html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_, file) => {
    const js = readFileSync(join(dir, file), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script type="module">${js}</script>`;
  });
  html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/g, (_, file) => {
    return `<style>${readFileSync(join(dir, file), "utf8")}</style>`;
  });
  html = html
    .replace(/href="\.\/ultra\.html"/g, 'href="./sharks-vs-fish-ultra.html"')
    .replace(/href="\.\/(#[^"]*)?"/g, 'href="./sharks-vs-fish.html$1"');

  if (/src="\.\/assets|href="\.\/assets/.test(html)) {
    throw new Error(`single-file: some assets were not inlined in ${page}`);
  }
  writeFileSync(join(dist, out), html);
  console.log(`single-file: wrote ${join(dist, out)} (${Math.round(html.length / 1024)} KB)`);
}
rmSync(tmp, { recursive: true, force: true });
