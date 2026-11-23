// XroMax Code: чекпоинты — перед первым изменением каждого файла в ходе ответа сохраняем его прежнее состояние,
// чтобы кнопкой «Откатить» вернуть файлы (и разговор) к моменту до сообщения.
// Хранится: <userData>/checkpoints/<sessionId>/<turnId>/manifest.json + blobs/<n>.
// Команды PowerShell (run_command) не отслеживаются — их изменения откатить нельзя.
const fsp = require("fs/promises");
const path = require("path");

const MAX_FILE = 10 * 1024 * 1024; // больше — не сохраняем (отметим как «не откатить»)
const MAX_DIR_FILES = 3000;
const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".venv", "venv"]);
const safeId = (s) => String(s).replace(/[^\w-]/g, "").slice(0, 64);

function createStore(rootDir) {
  const turnDir = (sid, turn) => path.join(rootDir(), safeId(sid), safeId(turn));

  /** Начать ход: вернёт { snap(absPath) } — вызывать ДО изменения пути */
  async function beginTurn(sid, turn, histLen) {
    const dir = turnDir(sid, turn);
    await fsp.mkdir(path.join(dir, "blobs"), { recursive: true });
    const manifest = { turn: String(turn), histLen, at: Date.now(), entries: [] };
    const seen = new Set();
    let n = 0;
    let dirty = false;
    const save = () => fsp.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));

    async function snapFile(p, st) {
      if (st.size > MAX_FILE) return manifest.entries.push({ path: p, kind: "file", tooBig: true });
      const blob = String(++n);
      await fsp.copyFile(p, path.join(dir, "blobs", blob));
      manifest.entries.push({ path: p, kind: "file", blob });
    }
    async function snapDir(p) {
      manifest.entries.push({ path: p, kind: "dir" });
      let count = 0;
      async function walk(d) {
        let items;
        try {
          items = await fsp.readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const it of items) {
          if (count >= MAX_DIR_FILES) return;
          const q = path.join(d, it.name);
          const key = q.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          if (it.isDirectory()) {
            if (SKIP.has(it.name)) {
              manifest.entries.push({ path: q, kind: "dir", skipped: true });
              continue;
            }
            manifest.entries.push({ path: q, kind: "dir" });
            await walk(q);
          } else if (it.isFile()) {
            count++;
            const st = await fsp.stat(q).catch(() => null);
            if (st) await snapFile(q, st);
          }
        }
      }
      await walk(p);
    }

    return {
      async snap(absPath) {
        const p = path.normalize(absPath);
        const key = p.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        try {
          const st = await fsp.stat(p).catch(() => null);
          if (!st) manifest.entries.push({ path: p, kind: "none" }); // не было — при откате удалим
          else if (st.isDirectory()) await snapDir(p);
          else await snapFile(p, st);
          dirty = true;
          await save();
        } catch {}
      },
      /** ход закончился: пустой чекпоинт не храним */
      async end() {
        if (!dirty) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  }

  async function listTurns(sid) {
    const base = path.join(rootDir(), safeId(sid));
    const names = await fsp.readdir(base).catch(() => []);
    const out = [];
    for (const n of names) {
      try {
        out.push({ ...JSON.parse(await fsp.readFile(path.join(base, n, "manifest.json"), "utf8")), dir: path.join(base, n) });
      } catch {}
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** Какие ходы есть (для кнопок «Откатить») */
  async function turnsWithChanges(sid) {
    return (await listTurns(sid)).map((t) => ({ turn: t.turn, files: t.entries.filter((e) => e.kind !== "dir").length }));
  }

  /**
   * Откатить файлы к состоянию до хода turn: проходим ходы от последнего к этому и возвращаем
   * прежнее содержимое (самые ранние снимки побеждают). Возвращает { restored, removed, skipped, histLen }.
   */
  async function restore(sid, turn) {
    const turns = await listTurns(sid);
    const idx = turns.findIndex((t) => t.turn === String(turn));
    const from = idx >= 0 ? idx : turns.length;
    const histLen = idx >= 0 ? turns[idx].histLen : null;
    const r = { restored: 0, removed: 0, skipped: 0, histLen };
    for (let i = turns.length - 1; i >= from; i--) {
      const t = turns[i];
      // сначала удаляем созданное (глубокие пути первыми), потом возвращаем папки и файлы
      const none = t.entries.filter((e) => e.kind === "none").sort((a, b) => b.path.length - a.path.length);
      for (const e of none) {
        await fsp.rm(e.path, { recursive: true, force: true }).catch(() => {});
        r.removed++;
      }
      for (const e of t.entries.filter((x) => x.kind === "dir" && !x.skipped)) await fsp.mkdir(e.path, { recursive: true }).catch(() => {});
      for (const e of t.entries.filter((x) => x.kind === "file")) {
        if (e.tooBig || !e.blob) {
          r.skipped++;
          continue;
        }
        try {
          await fsp.mkdir(path.dirname(e.path), { recursive: true });
          // на месте файла могла появиться папка
          const st = await fsp.stat(e.path).catch(() => null);
          if (st?.isDirectory()) await fsp.rm(e.path, { recursive: true, force: true });
          await fsp.copyFile(path.join(t.dir, "blobs", e.blob), e.path);
          r.restored++;
        } catch {
          r.skipped++;
        }
      }
      await fsp.rm(t.dir, { recursive: true, force: true }).catch(() => {});
    }
    return r;
  }

  const removeSession = (sid) => fsp.rm(path.join(rootDir(), safeId(sid)), { recursive: true, force: true }).catch(() => {});

  return { beginTurn, restore, turnsWithChanges, removeSession };
}

module.exports = { createStore };
