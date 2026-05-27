const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const sourceDir = "C:\\Users\\hwang_insoo02\\Desktop\\패션 HR - 복사본";
const sources = [
  {
    id: "sap-manual",
    title: "HR SAP 매뉴얼_210715(법인공유용)",
    file: path.join(sourceDir, "HR SAP 매뉴얼_210715(법인공유용).pdf"),
  },
  {
    id: "work-rules",
    title: "취업규칙_월드_250401",
    file: path.join(sourceDir, "취업규칙_월드_250401.pdf"),
  },
];

const distDir = path.join(__dirname, "dist");

function cleanText(value) {
  return value
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([가-힣A-Za-z0-9)])\s+([가-힣A-Za-z0-9(])/g, "$1 $2")
    .trim();
}

function decodePdfLiteral(value) {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[++i];
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "\\" || next === "(" || next === ")") out += next;
    else if (/[0-7]/.test(next || "")) {
      let oct = next;
      for (let j = 0; j < 2 && /[0-7]/.test(value[i + 1] || ""); j += 1) {
        oct += value[++i];
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (next !== "\n" && next !== "\r") {
      out += next || "";
    }
  }
  return out;
}

function decodeUtf16Hex(hex) {
  const bytes = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    out += String.fromCharCode(parseInt(bytes.slice(i, i + 4), 16));
  }
  return out;
}

function parseObjects(buffer) {
  const text = buffer.toString("latin1");
  const objects = new Map();
  const all = [];
  const re = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let match;
  while ((match = re.exec(text))) {
    const num = Number(match[1]);
    const body = match[3];
    let stream = null;
    const streamIndex = body.indexOf("stream");
    const endStreamIndex = body.indexOf("endstream");
    if (streamIndex !== -1 && endStreamIndex !== -1) {
      let start = match.index + match[0].indexOf(body) + streamIndex + "stream".length;
      if (text[start] === "\r" && text[start + 1] === "\n") start += 2;
      else if (text[start] === "\n" || text[start] === "\r") start += 1;
      let end = match.index + match[0].indexOf(body) + endStreamIndex;
      if (text[end - 2] === "\r" && text[end - 1] === "\n") end -= 2;
      else if (text[end - 1] === "\n" || text[end - 1] === "\r") end -= 1;
      stream = buffer.subarray(start, end);
    }
    const obj = { num, body, stream };
    all.push(obj);
    objects.set(num, obj);
  }
  objects.all = all;
  return objects;
}

function inflateStream(obj) {
  if (!obj.stream) return "";
  const isFlate = /\/Filter\s*(?:\[[^\]]*)?\/FlateDecode/.test(obj.body);
  const data = isFlate ? zlib.inflateSync(obj.stream) : obj.stream;
  return data.toString("latin1");
}

function parseCMap(text) {
  const map = new Map();
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  let block;

  while ((block = bfchar.exec(text))) {
    for (const line of block[1].split(/\r?\n/)) {
      const parts = [...line.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => m[1]);
      for (let i = 0; i + 1 < parts.length; i += 2) {
        map.set(parts[i].toUpperCase(), decodeUtf16Hex(parts[i + 1]));
      }
    }
  }

  while ((block = bfrange.exec(text))) {
    for (const line of block[1].split(/\r?\n/)) {
      const parts = [...line.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => m[1]);
      if (parts.length < 3) continue;
      const start = parseInt(parts[0], 16);
      const end = parseInt(parts[1], 16);
      if (line.includes("[")) {
        for (let code = start, i = 2; code <= end && i < parts.length; code += 1, i += 1) {
          map.set(code.toString(16).toUpperCase().padStart(parts[0].length, "0"), decodeUtf16Hex(parts[i]));
        }
      } else {
        const dest = parseInt(parts[2], 16);
        for (let code = start; code <= end; code += 1) {
          const key = code.toString(16).toUpperCase().padStart(parts[0].length, "0");
          const val = (dest + code - start).toString(16).toUpperCase().padStart(parts[2].length, "0");
          map.set(key, decodeUtf16Hex(val));
        }
      }
    }
  }

  return map;
}

function decodeHexWithMap(hex, cmap) {
  const raw = hex.replace(/\s+/g, "").toUpperCase();
  if (!raw) return "";
  if (!cmap || cmap.size === 0) return decodeUtf16Hex(raw);
  let out = "";
  for (let i = 0; i < raw.length; ) {
    let matched = "";
    for (const len of [8, 6, 4, 2]) {
      const key = raw.slice(i, i + len);
      if (key.length === len && cmap.has(key)) {
        matched = cmap.get(key);
        i += len;
        break;
      }
    }
    if (!matched) {
      matched = raw.length - i >= 4 ? decodeUtf16Hex(raw.slice(i, i + 4)) : "";
      i += raw.length - i >= 4 ? 4 : 2;
    }
    out += matched;
  }
  return out;
}

function parseFontMaps(objects) {
  const cmapByObject = new Map();
  const allObjects = objects.all || [...objects.values()];
  for (const obj of allObjects) {
    if (/begin(?:bfchar|bfrange)/.test(inflateStream(obj))) {
      cmapByObject.set(obj.num, parseCMap(inflateStream(obj)));
    }
  }
  const allCMaps = [...cmapByObject.values()].filter((cmap) => cmap.size > 0);

  const fontByObject = new Map();
  for (const obj of allObjects) {
    const m = obj.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    const cmap = m ? cmapByObject.get(Number(m[1])) : null;
    if (cmap && cmap.size > 0) {
      fontByObject.set(obj.num, cmap);
    }
  }

  const fontByName = new Map();
  for (const obj of allObjects) {
    const baseFont = obj.body.match(/\/BaseFont\s+\/(?:[A-Z]{6}\+)?(?:CIDFont\+)?([A-Za-z0-9_.-]+)/);
    const toUnicode = obj.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (baseFont && toUnicode && cmapByObject.has(Number(toUnicode[1]))) {
      fontByName.set(baseFont[1], cmapByObject.get(Number(toUnicode[1])));
    }

    const blocks = [...obj.body.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)];
    for (const block of blocks) {
      for (const m of block[1].matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R/g)) {
        const cmap = fontByObject.get(Number(m[2]));
        if (cmap && !fontByName.has(m[1])) fontByName.set(m[1], cmap);
      }
    }
  }
  fontByName.allCMaps = allCMaps;
  return fontByName;
}

function tokenizeContent(content) {
  const tokens = [];
  for (let i = 0; i < content.length; ) {
    const ch = content[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "%") {
      while (i < content.length && content[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "(") {
      let value = "";
      let depth = 1;
      i += 1;
      while (i < content.length && depth > 0) {
        const c = content[i];
        if (c === "\\") {
          value += c + (content[i + 1] || "");
          i += 2;
        } else if (c === "(") {
          depth += 1;
          value += c;
          i += 1;
        } else if (c === ")") {
          depth -= 1;
          if (depth > 0) value += c;
          i += 1;
        } else {
          value += c;
          i += 1;
        }
      }
      tokens.push({ type: "literal", value: decodePdfLiteral(value) });
      continue;
    }
    if (ch === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i + 1);
      if (end === -1) break;
      tokens.push({ type: "hex", value: content.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === "/") {
      const m = content.slice(i).match(/^\/[^\s<>\[\](){}%]+/);
      tokens.push({ type: "name", value: m[0].slice(1) });
      i += m[0].length;
      continue;
    }
    const m = content.slice(i).match(/^[^\s<>\[\](){}%]+/);
    if (!m) {
      tokens.push({ type: ch, value: ch });
      i += 1;
      continue;
    }
    tokens.push({ type: "word", value: m[0] });
    i += m[0].length;
  }
  return tokens;
}

function extractTextFromContent(content, fontByName) {
  const tokens = tokenizeContent(content);
  const stack = [];
  let currentCMap = null;
  const parts = [];
  const allCMaps = fontByName.allCMaps || [];

  function textScore(text) {
    const hangul = (text.match(/[가-힣]/g) || []).length;
    const plain = (text.match(/[A-Za-z0-9 .,;:()[\]/+-]/g) || []).length;
    const controls = (text.match(/[\u0000-\u001F\u007F-\u009F]/g) || []).length;
    const unusual = (text.match(/[^\u0000-\u007F가-힣ㄱ-ㅎㅏ-ㅣ]/g) || []).length;
    return hangul * 5 + plain - controls * 6 - unusual * 2;
  }

  function decodeBestHex(hex) {
    const candidates = [];
    if (currentCMap) candidates.push(currentCMap);
    for (const cmap of allCMaps) {
      if (cmap !== currentCMap) candidates.push(cmap);
    }
    let best = decodeHexWithMap(hex, currentCMap);
    let bestScore = textScore(best);
    for (const cmap of candidates) {
      const value = decodeHexWithMap(hex, cmap);
      const score = textScore(value);
      if (score > bestScore) {
        best = value;
        bestScore = score;
      }
    }
    return best;
  }

  function decodeToken(token) {
    if (!token) return "";
    if (token.type === "literal") return token.value;
    if (token.type === "hex") return decodeBestHex(token.value);
    return "";
  }

  for (const token of tokens) {
    if (token.type === "word" && token.value === "Tf") {
      const fontName = [...stack].reverse().find((item) => item.type === "name");
      currentCMap = fontName ? fontByName.get(fontName.value) || null : null;
      stack.length = 0;
      continue;
    }
    if (token.type === "word" && (token.value === "Tj" || token.value === "'")) {
      const text = decodeToken(stack.at(-1));
      if (text) parts.push(text);
      stack.length = 0;
      continue;
    }
    if (token.type === "word" && token.value === "TJ") {
      const text = stack.map(decodeToken).join("");
      if (text) parts.push(text);
      stack.length = 0;
      continue;
    }
    if (token.type === "word" && (token.value === "Td" || token.value === "TD" || token.value === "T*" || token.value === "ET")) {
      if (parts.at(-1) !== "\n") parts.push("\n");
      stack.length = 0;
      continue;
    }
    stack.push(token);
    if (stack.length > 60) stack.shift();
  }
  return cleanText(parts.join(" "));
}

function getContentRefs(body) {
  const refs = [];
  const one = body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
  if (one) refs.push(Number(one[1]));
  const many = body.match(/\/Contents\s*\[([^\]]+)\]/);
  if (many) {
    for (const m of many[1].matchAll(/(\d+)\s+\d+\s+R/g)) refs.push(Number(m[1]));
  }
  return refs;
}

function extractPdf(file) {
  const buffer = fs.readFileSync(file);
  const objects = parseObjects(buffer);
  const fontByName = parseFontMaps(objects);
  const pages = [];

  for (const obj of [...objects.values()].sort((a, b) => a.num - b.num)) {
    if (!/\/Type\s*\/Page\b/.test(obj.body)) continue;
    const contents = getContentRefs(obj.body)
      .map((ref) => objects.get(ref))
      .filter(Boolean)
      .map(inflateStream)
      .join("\n");
    const text = extractTextFromContent(contents, fontByName);
    if (text) pages.push({ page: pages.length + 1, text });
  }

  return pages;
}

function chunkPage(source, page) {
  const chunks = [];
  const sentences = page.text
    .split(/(?<=[.!?。！？]|다\.|요\.|함\.|음\.|임\.|됨\.|\. )\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  let buf = "";
  for (const sentence of sentences.length ? sentences : [page.text]) {
    if ((buf + " " + sentence).length > 850 && buf.length > 120) {
      chunks.push(buf.trim());
      buf = sentence;
    } else {
      buf = `${buf} ${sentence}`.trim();
    }
  }
  if (buf) chunks.push(buf.trim());
  return chunks.map((text, index) => ({
    id: `${source.id}-p${page.page}-${index + 1}`,
    sourceId: source.id,
    title: source.title,
    fileName: path.basename(source.file),
    page: page.page,
    text,
    terms: makeTerms(text),
  }));
}

function makeTerms(text) {
  return [...new Set((text.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || []))];
}

function copyStatic() {
  fs.mkdirSync(distDir, { recursive: true });
  for (const file of ["index.html", "styles.css", "script.js"]) {
    fs.copyFileSync(path.join(__dirname, file), path.join(distDir, file));
  }
}

const documents = sources.map((source) => {
  const pages = extractPdf(source.file);
  return {
    id: source.id,
    title: source.title,
    fileName: path.basename(source.file),
    pageCount: pages.length,
    charCount: pages.reduce((sum, page) => sum + page.text.length, 0),
    pages,
  };
});

const chunks = documents.flatMap((doc) => {
  const source = sources.find((item) => item.id === doc.id);
  return doc.pages.flatMap((page) => chunkPage(source, page));
});

copyStatic();
fs.writeFileSync(
  path.join(distDir, "knowledge-base.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      policy: "두 PDF에서 추출한 내용만 근거로 답변합니다.",
      documents: documents.map(({ pages, ...doc }) => doc),
      chunks,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`Built ${documents.length} documents, ${chunks.length} chunks.`);
for (const doc of documents) {
  console.log(`- ${doc.title}: ${doc.pageCount} pages, ${doc.charCount.toLocaleString()} chars`);
}
