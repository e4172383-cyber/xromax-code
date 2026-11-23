// XroMax Code: скиллы и плагины.
// Скилл — папка с SKILL.md (вверху name и description), как у Claude. Плагин — папка с plugin.json
// (или .claude-plugin/plugin.json): внутри могут быть skills/<имя>/SKILL.md и коннекторы (mcpServers или .mcp.json).
// Встроенные скиллы лежат в приложении (skills/), свои — в userData/skills, плагины — в userData/plugins.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

let ROOTS = null; // { builtin, user, plugins }
function init(userData) {
  ROOTS = { builtin: path.join(__dirname, "..", "skills"), user: path.join(userData, "skills"), plugins: path.join(userData, "plugins") };
  fs.mkdirSync(ROOTS.user, { recursive: true });
  fs.mkdirSync(ROOTS.plugins, { recursive: true });
  return ROOTS;
}
const roots = () => ROOTS;

/** Заголовок SKILL.md: --- name: … description: … --- */
function parseSkill(text) {
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { name: meta.name, description: meta.description || "", body: m ? text.slice(m[0].length).trim() : text.trim() };
}
const safeName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill";

function readSkillDir(dir, source) {
  const f = path.join(dir, "SKILL.md");
  if (!fs.existsSync(f)) return null;
  try {
    const p = parseSkill(fs.readFileSync(f, "utf8"));
    const name = safeName(p.name || path.basename(dir));
    return { id: `${source}:${name}`, name, description: p.description, source, dir, file: f };
  } catch {
    return null;
  }
}
const subdirs = (d) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name));
  } catch {
    return [];
  }
};

function pluginManifest(dir) {
  for (const f of [path.join(dir, "plugin.json"), path.join(dir, ".claude-plugin", "plugin.json")]) {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {}
  }
  return null;
}
function pluginMcp(dir, manifest) {
  let servers = manifest?.mcpServers && typeof manifest.mcpServers === "object" ? manifest.mcpServers : {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"));
    servers = { ...servers, ...(j.mcpServers || j) };
  } catch {}
  return servers;
}

/** Все установленные плагины: { id, name, description, version, dir, skills:[…], mcp:{…} } */
function listPlugins() {
  return subdirs(ROOTS.plugins)
    .map((dir) => {
      const m = pluginManifest(dir);
      if (!m) return null;
      const name = safeName(m.name || path.basename(dir));
      const sk = subdirs(path.join(dir, "skills"))
        .map((d) => readSkillDir(d, `plugin-${name}`))
        .filter(Boolean);
      return { id: `plugin:${name}`, name: m.name || name, description: m.description || "", version: m.version || "", dir, skills: sk, mcp: pluginMcp(dir, m) };
    })
    .filter(Boolean);
}

/** Все скиллы: встроенные, свои и из плагинов */
function listSkills() {
  const out = [];
  for (const d of subdirs(ROOTS.builtin)) out.push(readSkillDir(d, "builtin"));
  for (const d of subdirs(ROOTS.user)) out.push(readSkillDir(d, "user"));
  for (const p of listPlugins()) out.push(...p.skills);
  return out.filter(Boolean);
}

/** Текст скилла для модели (с путями папок вместо {{…}}) */
function skillText(s) {
  const raw = fs.readFileSync(s.file, "utf8");
  return raw.replace(/\{\{SKILLS_DIR\}\}/g, ROOTS.user).replace(/\{\{PLUGINS_DIR\}\}/g, ROOTS.plugins).replace(/\{\{SKILL_DIR\}\}/g, s.dir);
}

function unzip(zip) {
  const dest = path.join(os.tmpdir(), "xc-import-" + Date.now());
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`], { windowsHide: true });
    ps.on("close", (code) => (code === 0 ? resolve(dest) : reject(new Error("Не удалось распаковать архив"))));
    ps.on("error", reject);
  });
}
/** Внутри распакованного архива бывает одна папка-обёртка — спускаемся в неё */
function unwrap(dir, isRoot) {
  for (let i = 0; i < 3; i++) {
    if (isRoot(dir)) return dir;
    const kids = subdirs(dir);
    const files = fs.readdirSync(dir).filter((f) => !fs.statSync(path.join(dir, f)).isDirectory());
    if (kids.length === 1 && !files.length) dir = kids[0];
    else break;
  }
  return isRoot(dir) ? dir : null;
}

/** Загрузить скилл: папка с SKILL.md, .zip или один .md файл */
async function importSkill(src) {
  let dir = src;
  if (/\.md$/i.test(src)) {
    const p = parseSkill(await fsp.readFile(src, "utf8"));
    const name = safeName(p.name || path.basename(src, ".md"));
    const dest = path.join(ROOTS.user, name);
    await fsp.mkdir(dest, { recursive: true });
    await fsp.copyFile(src, path.join(dest, "SKILL.md"));
    return { ok: true, name };
  }
  if (/\.zip$/i.test(src)) dir = await unzip(src);
  const root = unwrap(dir, (d) => fs.existsSync(path.join(d, "SKILL.md")));
  if (!root) return { ok: false, error: "Не нашёл SKILL.md — это не похоже на скилл" };
  const s = readSkillDir(root, "user");
  const dest = path.join(ROOTS.user, s.name);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.cp(root, dest, { recursive: true });
  return { ok: true, name: s.name };
}

/** Загрузить плагин: папка или .zip с plugin.json (формат Claude-плагинов тоже подходит) */
async function importPlugin(src) {
  let dir = src;
  if (/\.zip$/i.test(src)) dir = await unzip(src);
  const root = unwrap(dir, (d) => !!pluginManifest(d));
  if (!root) {
    // папка без plugin.json, но со скиллами — тоже принимаем как плагин
    const alt = unwrap(dir, (d) => fs.existsSync(path.join(d, "skills")));
    if (!alt) return { ok: false, error: "Не нашёл plugin.json — это не похоже на плагин" };
    await fsp.writeFile(path.join(alt, "plugin.json"), JSON.stringify({ name: path.basename(alt), description: "" }, null, 2));
    return importPlugin(alt);
  }
  const m = pluginManifest(root);
  const name = safeName(m.name || path.basename(root));
  const dest = path.join(ROOTS.plugins, name);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.cp(root, dest, { recursive: true });
  return { ok: true, name: m.name || name };
}

async function removeItem(id) {
  if (id.startsWith("user:")) await fsp.rm(path.join(ROOTS.user, id.slice(5)), { recursive: true, force: true });
  else if (id.startsWith("plugin:")) await fsp.rm(path.join(ROOTS.plugins, id.slice(7)), { recursive: true, force: true });
}

module.exports = { init, roots, listSkills, listPlugins, skillText, importSkill, importPlugin, removeItem, parseSkill, safeName };
