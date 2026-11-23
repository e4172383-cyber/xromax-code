// XroMax Code: «@файл» в сообщении — подсказки при вводе и вставка содержимого файла (или списка папки) в запрос.
const fsp = require("fs/promises");
const path = require("path");

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", "out", ".idea", ".vs", ".turbo", ".cache", "coverage"]);
const MAX_FILES = 20_000;
const MAX_INLINE = 200_000; // больше — даём только путь и размер
const cache = new Map(); // workspace → { at, list }

async function listAll(ws) {
  const c = cache.get(ws);
  if (c && Date.now() - c.at < 20_000) return c.list;
  const list = [];
  async function walk(dir, rel, depth) {
    if (list.length >= MAX_FILES || depth > 12) return;
    let items;
    try {
      items = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (list.length >= MAX_FILES) return;
      const r = rel ? rel + "/" + it.name : it.name;
      if (it.isDirectory()) {
        if (SKIP.has(it.name)) continue;
        list.push({ path: r, dir: true });
        await walk(path.join(dir, it.name), r, depth + 1);
      } else list.push({ path: r, dir: false });
    }
  }
  await walk(ws, "", 0);
  cache.set(ws, { at: Date.now(), list });
  return list;
}

/** подсказки для «@запрос»: сначала совпадение имени, потом пути; папка «a/» — её содержимое */
async function searchFiles(ws, q) {
  if (!ws) return [];
  const all = await listAll(ws);
  const query = String(q || "").replace(/\\/g, "/").toLowerCase();
  let hits;
  if (!query) hits = all.filter((f) => !f.path.includes("/"));
  else if (query.endsWith("/")) hits = all.filter((f) => f.path.toLowerCase().startsWith(query) && !f.path.slice(query.length).includes("/"));
  else {
    const score = (f) => {
      const p = f.path.toLowerCase();
      const base = p.split("/").pop();
      if (base === query) return 0;
      if (base.startsWith(query)) return 1;
      if (p.startsWith(query)) return 2;
      if (base.includes(query)) return 3;
      if (p.includes(query)) return 4;
      // буквы по порядку (fuzzy)
      let i = 0;
      for (const ch of p) if (ch === query[i]) i++;
      return i === query.length ? 5 : 99;
    };
    hits = all
      .map((f) => ({ f, s: score(f) }))
      .filter((x) => x.s < 99)
      .sort((a, b) => a.s - b.s || a.f.path.length - b.f.path.length)
      .map((x) => x.f);
  }
  const out = hits.slice(0, 40);
  await Promise.all(out.map(async (f) => !f.dir && (f.size = (await fsp.stat(path.join(ws, f.path)).catch(() => null))?.size ?? null)));
  return out;
}

/** «@путь» в тексте → содержимое файла / список папки в конце сообщения */
async function expandMentions(ws, text) {
  const re = /(^|\s)@(?:"([^"]+)"|([^\s"]+))/g;
  const seen = new Set();
  const blocks = [];
  let m;
  while ((m = re.exec(text)) && blocks.length < 20) {
    const rel = (m[2] || m[3]).replace(/[.,;:!?)]+$/, "");
    const abs = path.isAbsolute(rel) ? rel : path.resolve(ws, rel);
    if (seen.has(abs.toLowerCase())) continue;
    seen.add(abs.toLowerCase());
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      const items = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
      blocks.push(`<folder path="${rel}">\n${items.slice(0, 300).map((i) => i.name + (i.isDirectory() ? "/" : "")).join("\n")}\n</folder>`);
      continue;
    }
    if (st.size > MAX_INLINE) {
      blocks.push(`<file path="${rel}" size="${st.size}">[too big to include — read it with read_file]</file>`);
      continue;
    }
    const buf = await fsp.readFile(abs).catch(() => null);
    if (!buf) continue;
    if (buf.subarray(0, 8000).includes(0)) {
      blocks.push(`<file path="${rel}" size="${st.size}">[binary file]</file>`);
      continue;
    }
    blocks.push(`<file path="${rel}">\n${buf.toString("utf8")}\n</file>`);
  }
  return blocks.length ? `${text}\n\n[Files the user mentioned with @:]\n${blocks.join("\n\n")}` : text;
}

module.exports = { searchFiles, expandMentions };
