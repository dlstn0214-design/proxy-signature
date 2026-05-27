const fs = require("node:fs");
const path = require("node:path");

const outputDir = path.join(__dirname, "dist");
const files = ["index.html", "styles.css", "script.js"];

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(__dirname, file), path.join(outputDir, file));
}

console.log(`Built ${files.length} files into dist/`);
