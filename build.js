const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const dist = path.join(root, "dist");
const files = ["index.html", "README.md"];
const dirs = ["src", "supabase"];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(dist, file));
  }
}

for (const dir of dirs) {
  const source = path.join(root, dir);
  const target = path.join(dist, dir);
  if (fs.existsSync(source)) {
    fs.cpSync(source, target, { recursive: true });
  }
}

console.log("Built static MVP into dist/");
