// XroMax Code: проверка целостности файлов приложения.
// При сборке (scripts/make-integrity.js) все файлы приложения хешируются и список подписывается ключом XROMAX.
// При запуске приложение сверяет свои файлы со списком; если файл изменён, удалён или добавлен лишний —
// приложение блокируется и предлагает поставить официальное обновление.
// Это защита от случайной и грубой подмены; от полной переделки приложения злоумышленником она не спасает —
// поэтому дорогие модели дополнительно защищены на сервере (подпись запросов ключом устройства).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TAG = "XROMAX-CODE-integrity-v1";
// что входит в проверку (относительно корня приложения)
const DIRS = ["core", "renderer", "i18n", "skills"];
const FILES = ["main.js", "preload.js"]; // package.json не входит: electron-builder сам вырезает из него scripts и devDependencies

function listFiles(root) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const n of fs.readdirSync(abs).sort()) walk(path.posix.join(rel.split(path.sep).join("/"), n));
    else out.push(rel.split(path.sep).join("/"));
  };
  for (const f of FILES) walk(f);
  for (const d of DIRS) walk(d);
  return out.sort();
}
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Список «файл → хеш» для папки приложения. package.json сборщик урезает, поэтому проверяем только ключевые поля (имя, версия, точка входа). */
function collect(root) {
  const files = {};
  for (const rel of listFiles(root)) files[rel] = sha256(path.join(root, rel));
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    files["package.json#core"] = crypto.createHash("sha256").update(JSON.stringify({ name: p.name, version: p.version, main: p.main })).digest("hex");
  } catch {
    files["package.json#core"] = "missing";
  }
  return files;
}
const canonical = (version, files) => `${TAG}\n${version}\n` + Object.keys(files).sort().map((k) => `${k}\t${files[k]}`).join("\n");

/** Подписать (при сборке) */
function make(root, version, privatePem) {
  const files = collect(root);
  const sig = crypto.sign(null, Buffer.from(canonical(version, files)), crypto.createPrivateKey(privatePem)).toString("base64");
  return { version, files, sig };
}

/** Проверить (при запуске). Возвращает { ok:true } или { ok:false, reason, changed:[…] } */
function verify(root, publicPem, manifestFile = path.join(root, "integrity.json")) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch {
    return { ok: false, reason: "no-manifest", changed: [] };
  }
  try {
    const good = crypto.verify(null, Buffer.from(canonical(m.version, m.files)), crypto.createPublicKey(publicPem), Buffer.from(m.sig, "base64"));
    if (!good) return { ok: false, reason: "bad-signature", changed: [] };
  } catch {
    return { ok: false, reason: "bad-signature", changed: [] };
  }
  const now = collect(root);
  const changed = [];
  for (const k of Object.keys(m.files)) if (now[k] !== m.files[k]) changed.push(k);
  for (const k of Object.keys(now)) if (!(k in m.files)) changed.push(k + " (лишний)");
  return changed.length ? { ok: false, reason: "modified", changed } : { ok: true };
}

module.exports = { make, verify, collect };
