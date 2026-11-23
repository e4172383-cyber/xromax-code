// XroMax Code: проверка кода сразу после правки файла — агент видит ошибки и чинит их сам (как подсветка в редакторе).
//   .js .mjs .cjs  — синтаксис (node --check)
//   .ts .tsx .jsx  — ошибки TypeScript по tsconfig проекта (если в проекте установлен typescript)
//   .json          — синтаксис JSON
//   .py            — синтаксис Python (python -m py_compile), если Python установлен
// Ничего не проверяем — возвращаем "" (в ответ инструмента ничего не добавляется).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const TIMEOUT = 30_000;

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts });
    } catch (e) {
      return resolve({ code: -1, out: "", missing: true });
    }
    const t = setTimeout(() => child.kill(), TIMEOUT);
    child.stdout?.on("data", (b) => out.length < 60_000 && (out += b));
    child.stderr?.on("data", (b) => out.length < 60_000 && (out += b));
    child.on("error", (e) => (clearTimeout(t), resolve({ code: -1, out: "", missing: e.code === "ENOENT" })));
    child.on("close", (code) => (clearTimeout(t), resolve({ code, out: out.trim() })));
  });
}
// в Electron process.execPath — сам XroMax Code; с ELECTRON_RUN_AS_NODE он работает как Node.js
const nodeRun = (args, cwd) => run(process.execPath, args, { cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });

function findUp(start, stop, rel) {
  let dir = start;
  for (let i = 0; i < 30; i++) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir || (stop && path.relative(stop, dir).startsWith(".."))) break;
    dir = up;
  }
  return null;
}

const fmt = (label, problems) => (problems ? `\n\n[Check after edit — ${label}: problems found, fix them:]\n${problems}` : `\n\n[Check after edit — ${label}: no errors.]`);

async function diagnose(file, workspace) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file).toLowerCase();
  try {
    if ([".js", ".mjs", ".cjs"].includes(ext)) {
      const r = await nodeRun(["--check", file], path.dirname(file));
      if (r.missing) return "";
      const msg = r.out
        .split("\n")
        .filter((l) => !/^\s+at /.test(l) && !/^Node\.js v[\d.]+$/.test(l))
        .join("\n")
        .trim();
      return fmt("node --check", r.code === 0 ? "" : msg.split("\n").slice(0, 12).join("\n"));
    }
    if (ext === ".json") {
      if (/^(ts|js)config.*\.json$/.test(name) || name.endsWith(".jsonc")) return ""; // там разрешены комментарии
      try {
        JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
        return fmt("JSON", "");
      } catch (e) {
        return fmt("JSON", e.message);
      }
    }
    if ([".ts", ".tsx", ".mts", ".cts", ".jsx"].includes(ext)) {
      const ts = findUp(path.dirname(file), workspace, path.join("node_modules", "typescript", "lib", "typescript.js"));
      if (!ts) return ""; // в проекте нет TypeScript — проверять нечем
      // в собранном приложении скрипт лежит распакованным рядом с app.asar
      const script = path.join(__dirname, "diag-ts.js").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
      const r = await nodeRun([script, ts, file], path.dirname(file));
      if (r.code === -1 || r.missing) return "";
      if (r.out === "OK") return fmt("TypeScript", "");
      return r.out ? fmt("TypeScript", r.out) : "";
    }
    if (ext === ".py") {
      const r = await run("python", ["-m", "py_compile", file], { cwd: path.dirname(file) });
      if (r.missing || /was not found|Microsoft Store/i.test(r.out)) return "";
      return fmt("Python", r.code === 0 ? "" : r.out.split("\n").slice(-8).join("\n"));
    }
  } catch {}
  return "";
}

module.exports = { diagnose };
