// XroMax Code: перенос чатов из Claude Code, Codex и OpenCode — переписка на экране и контекст для модели.
// Где лежат чаты:
//   Claude Code — ~/.claude/projects/<папка>/<id>.jsonl
//   Codex       — ~/.codex/sessions/ГГГГ/ММ/ДД/rollout-*.jsonl
//   OpenCode    — ~/.local/share/opencode/storage/{session,message,part}/… (JSON-файлы)
// Контекст для модели переносится обычными сообщениями user/assistant: вызовы инструментов чужого
// приложения сворачиваются в короткие строки (их формат несовместим), длинные выводы обрезаются.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");

const HOME = os.homedir();
const DIRS = {
  claude: () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude"), "projects"),
  codex: () => path.join(process.env.CODEX_HOME || path.join(HOME, ".codex"), "sessions"),
  opencode: () => path.join(process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share"), "opencode", "storage"),
};
const NAMES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const MAX_CONTEXT_CHARS = 400_000; // примерно 100k токенов — остальное сжимается до последних сообщений
const MAX_TOOL_OUT = 1500;

const clip = (s, n) => (s.length > n ? s.slice(0, n) + ` … [+${s.length - n}]` : s);
const stripSys = (t) =>
  String(t || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-[\w-]+>[\s\S]*?<\/local-command-[\w-]+>/g, "")
    .trim();
const isServiceText = (t) => /^<(environment_context|user_instructions|command-|local-command|system-reminder|codex_|app-context|permissions|INSTRUCTIONS)/i.test(t.trim());

async function walkFiles(dir, test, out = [], depth = 0) {
  if (depth > 5) return out;
  let items;
  try {
    items = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (it.name !== "subagents") await walkFiles(p, test, out, depth + 1);
    } else if (test(it.name)) out.push(p);
  }
  return out;
}

/** первые байты файла — для быстрого списка без чтения больших файлов целиком */
async function head(file, bytes = 400_000) {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}
const jsonLines = (text) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

// ───────────────────────── Claude Code ─────────────────────────
function claudeText(content) {
  if (typeof content === "string") return stripSys(content);
  if (!Array.isArray(content)) return "";
  return stripSys(content.filter((c) => c.type === "text").map((c) => c.text).join("\n"));
}
async function claudeList() {
  const files = await walkFiles(DIRS.claude(), (n) => n.endsWith(".jsonl"));
  const out = [];
  for (const f of files) {
    try {
      const st = await fsp.stat(f);
      if (st.size < 200) continue;
      const lines = jsonLines(await head(f));
      let title = "";
      let cwd = "";
      let first = "";
      for (const j of lines) {
        if (j.type === "custom-title" && j.customTitle) title = j.customTitle;
        if (j.type === "ai-title" && j.aiTitle && !title) title = j.aiTitle;
        if (j.type === "summary" && j.summary && !title) title = j.summary;
        if (j.cwd && !cwd) cwd = j.cwd;
        if (!first && j.type === "user" && !j.isMeta && !j.isSidechain) {
          const t = claudeText(j.message?.content);
          if (t && !isServiceText(t)) first = t;
        }
      }
      if (!first && !title) continue;
      out.push({ source: "claude", ref: f, title: clip((title || first).replace(/\s+/g, " "), 80), workspace: cwd, updatedAt: st.mtimeMs, size: st.size });
    } catch {}
  }
  return out;
}
async function claudeLoad(file) {
  const lines = jsonLines(await fsp.readFile(file, "utf8"));
  const turns = []; // {role, text, tools:[{name,args,result}]}
  let title = "";
  let cwd = "";
  const pending = new Map();
  for (const j of lines) {
    if (j.type === "custom-title" && j.customTitle) title = j.customTitle;
    if (j.type === "ai-title" && j.aiTitle && !title) title = j.aiTitle;
    if (j.cwd && !cwd) cwd = j.cwd;
    if (j.isSidechain || j.isMeta) continue;
    const c = j.message?.content;
    if (j.type === "user") {
      if (Array.isArray(c)) {
        for (const x of c.filter((x) => x.type === "tool_result")) {
          const t = pending.get(x.tool_use_id);
          if (t) t.result = typeof x.content === "string" ? x.content : Array.isArray(x.content) ? x.content.filter((y) => y.type === "text").map((y) => y.text).join("\n") : "";
        }
      }
      const t = claudeText(c);
      if (t && !isServiceText(t)) turns.push({ role: "user", text: t });
    } else if (j.type === "assistant" && Array.isArray(c)) {
      let last = turns[turns.length - 1];
      if (!last || last.role !== "assistant") turns.push((last = { role: "assistant", text: "", tools: [] }));
      for (const x of c) {
        if (x.type === "text" && x.text) last.text += (last.text ? "\n\n" : "") + x.text;
        if (x.type === "tool_use") {
          const tool = { name: x.name, args: x.input || {}, result: "" };
          last.tools.push(tool);
          pending.set(x.id, tool);
        }
      }
    }
  }
  return { title, workspace: cwd, turns };
}

// ───────────────────────── Codex ─────────────────────────
const codexText = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((c) => c.type === "input_text" || c.type === "output_text" || c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
const codexRecords = (lines) => lines.map((j) => (j.type === "response_item" || j.type === "session_meta" ? { kind: j.type, p: j.payload || {} } : j.type && j.payload ? null : { kind: "response_item", p: j }));
/** названия чатов Codex: ~/.codex/session_index.jsonl {id, thread_name} */
async function codexNames() {
  const map = new Map();
  try {
    for (const j of jsonLines(await fsp.readFile(path.join(path.dirname(DIRS.codex()), "session_index.jsonl"), "utf8"))) if (j.id && j.thread_name) map.set(j.id, j.thread_name);
  } catch {}
  return map;
}
const codexId = (file, meta) => meta.id || /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file)?.[1];
/** Codex оборачивает запрос: «# Files mentioned by the user … ## My request for Codex: …» — берём сам запрос */
function codexAsk(t) {
  const m = /##\s*My request for Codex:?\s*([\s\S]*)$/i.exec(t);
  return (m ? m[1] : t).trim();
}
function codexOut(o) {
  if (typeof o === "string") {
    try {
      const j = JSON.parse(o);
      if (Array.isArray(j)) return j.map((x) => x.text || "").join("\n");
      if (j && typeof j.output === "string") return j.output;
    } catch {}
    return o;
  }
  if (Array.isArray(o)) return o.map((x) => x.text || "").join("\n");
  return o?.content ?? o?.output ?? JSON.stringify(o ?? "");
}
async function codexList() {
  const names = await codexNames();
  const files = [...(await walkFiles(DIRS.codex(), (n) => /^rollout-.*\.jsonl$/.test(n))), ...(await walkFiles(path.join(path.dirname(DIRS.codex()), "archived_sessions"), (n) => /^rollout-.*\.jsonl$/.test(n)))];
  const out = [];
  for (const f of files) {
    try {
      const st = await fsp.stat(f);
      if (st.size < 200) continue;
      const recs = codexRecords(jsonLines(await head(f))).filter(Boolean);
      const meta = recs.find((r) => r.kind === "session_meta")?.p || {};
      const first = recs.map((r) => (r.p.type === "message" && r.p.role === "user" ? codexText(r.p.content) : "")).find((t) => t && !isServiceText(t)) || "";
      if (!first) continue;
      out.push({ source: "codex", ref: f, title: clip((names.get(codexId(f, meta)) || codexAsk(first)).replace(/\s+/g, " "), 80), workspace: meta.cwd || "", updatedAt: st.mtimeMs, size: st.size });
    } catch {}
  }
  return out;
}
async function codexLoad(file) {
  const recs = codexRecords(jsonLines(await fsp.readFile(file, "utf8"))).filter(Boolean);
  const meta = recs.find((r) => r.kind === "session_meta")?.p || {};
  const turns = [];
  const pending = new Map();
  const asst = () => {
    let last = turns[turns.length - 1];
    if (!last || last.role !== "assistant") turns.push((last = { role: "assistant", text: "", tools: [] }));
    return last;
  };
  for (const { kind, p } of recs) {
    if (kind !== "response_item") continue;
    if (p.type === "message" && p.role === "user") {
      const t = codexText(p.content);
      if (t && !isServiceText(t)) turns.push({ role: "user", text: codexAsk(t) });
    } else if (p.type === "message" && p.role === "assistant") {
      const t = codexText(p.content);
      if (t) {
        const a = asst();
        a.text += (a.text ? "\n\n" : "") + t;
      }
    } else if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
      let args = p.arguments ?? p.input ?? p.action ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = { input: args };
        }
      }
      const tool = { name: p.name || p.type, args, result: "" };
      asst().tools.push(tool);
      if (p.call_id) pending.set(p.call_id, tool);
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output" || p.type === "local_shell_call_output") {
      const t = pending.get(p.call_id);
      const o = p.output;
      if (t) t.result = codexOut(o);
    }
  }
  return { title: (await codexNames()).get(codexId(file, meta)) || "", workspace: meta.cwd || "", turns };
}

// ───────────────────────── OpenCode ─────────────────────────
async function readJson(f) {
  try {
    return JSON.parse(await fsp.readFile(f, "utf8"));
  } catch {
    return null;
  }
}
async function opencodeList() {
  const files = await walkFiles(path.join(DIRS.opencode(), "session"), (n) => n.endsWith(".json"));
  const out = [];
  for (const f of files) {
    const s = await readJson(f);
    if (!s?.id || s.parentID) continue; // подсессии агентов пропускаем
    out.push({ source: "opencode", ref: s.id, title: clip(String(s.title || "Сессия OpenCode"), 80), workspace: s.directory || "", updatedAt: s.time?.updated || s.time?.created || 0, size: 0 });
  }
  return out;
}
async function opencodeLoad(id) {
  const root = DIRS.opencode();
  const sid = String(id).replace(/[^\w-]/g, "");
  const msgFiles = await walkFiles(path.join(root, "message", sid), (n) => n.endsWith(".json"));
  const msgs = (await Promise.all(msgFiles.map(readJson))).filter(Boolean).sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
  const sess = (await Promise.all((await walkFiles(path.join(root, "session"), (n) => n === sid + ".json")).map(readJson)))[0] || {};
  const turns = [];
  for (const m of msgs) {
    const partFiles = await walkFiles(path.join(root, "part", m.id), (n) => n.endsWith(".json"));
    const parts = (await Promise.all(partFiles.map(readJson))).filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (m.role === "user") {
      const t = parts.filter((p) => p.type === "text" && !p.synthetic).map((p) => p.text).join("\n").trim();
      if (t) turns.push({ role: "user", text: t });
    } else {
      const a = { role: "assistant", text: "", tools: [] };
      for (const p of parts) {
        if (p.type === "text" && p.text) a.text += (a.text ? "\n\n" : "") + p.text;
        if (p.type === "tool") a.tools.push({ name: p.tool, args: p.state?.input || {}, result: String(p.state?.output ?? p.state?.error ?? "") });
      }
      const last = turns[turns.length - 1];
      if (last?.role === "assistant") {
        last.text += (last.text && a.text ? "\n\n" : "") + a.text;
        last.tools.push(...a.tools);
      } else turns.push(a);
    }
  }
  return { title: sess.title || "", workspace: sess.directory || "", turns };
}

// ───────────────────────── общее ─────────────────────────
/** аргумент чужого инструмента → path/command, понятные нашему интерфейсу */
function normArgs(args) {
  const a = args && typeof args === "object" ? args : {};
  const p = a.file_path || a.path || a.filePath || a.notebook_path || a.pattern;
  const cmd = a.command || a.cmd || (Array.isArray(a.argv) ? a.argv.join(" ") : undefined) || (typeof a.input === "string" ? a.input.slice(0, 200) : undefined);
  return { ...(p ? { path: String(p) } : {}), ...(cmd ? { command: Array.isArray(cmd) ? cmd.join(" ") : String(cmd) } : {}), query: a.query || a.url };
}

/** turns → { items (экран XroMax Code), history (контекст для модели) } */
function toSession(source, data) {
  const items = [];
  const history = [];
  for (const t of data.turns) {
    if (t.role === "user") {
      items.push({ role: "user", text: t.text });
      history.push({ role: "user", content: t.text });
      continue;
    }
    const parts = [];
    for (const tool of t.tools || []) parts.push({ k: "tool", name: tool.name, args: normArgs(tool.args), status: "ok", result: clip(String(tool.result || ""), 4000), open: false });
    if (t.text) parts.push({ k: "text", text: t.text });
    if (!parts.length) continue;
    items.push({ role: "assistant", parts });
    const toolLines = (t.tools || []).map((x) => {
      const a = normArgs(x.args);
      const what = a.path || a.command || a.query || JSON.stringify(x.args || {}).slice(0, 160);
      return `[${x.name}: ${clip(String(what), 200)}] → ${clip(String(x.result || "").replace(/\s+/g, " "), MAX_TOOL_OUT / 3)}`;
    });
    history.push({ role: "assistant", content: [...toolLines, t.text].filter(Boolean).join("\n") || "(done)" });
  }
  // соседние сообщения одной роли склеиваем (некоторые API требуют чередования)
  const merged = [];
  for (const m of history) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  // слишком длинную историю оставляем с конца
  let total = merged.reduce((n, m) => n + m.content.length, 0);
  let cut = 0;
  while (total > MAX_CONTEXT_CHARS && merged.length > 2) {
    total -= merged.shift().content.length;
    cut++;
  }
  if (merged[0]?.role === "assistant") merged.shift();
  const note = `[This conversation was imported from ${NAMES[source]}${cut ? `; the first ${cut} older messages were dropped to fit the context` : ""}. Tool calls of that app are shown as short [tool: …] lines. Continue the work from here with your own tools.]`;
  if (merged.length) merged[0] = { role: "user", content: note + "\n\n" + merged[0].content };
  return { items, history: merged };
}

async function scan(source) {
  const fn = { claude: claudeList, codex: codexList, opencode: opencodeList }[source];
  if (!fn) return { found: false, sessions: [] };
  const base = source === "opencode" ? DIRS.opencode() : DIRS[source]();
  if (!fs.existsSync(base)) return { found: false, dir: base, sessions: [] };
  const sessions = (await fn()).sort((a, b) => b.updatedAt - a.updatedAt);
  return { found: true, dir: base, sessions };
}

async function load(source, ref) {
  const fn = { claude: claudeLoad, codex: codexLoad, opencode: opencodeLoad }[source];
  const data = await fn(ref);
  const firstUser = data.turns.find((t) => t.role === "user")?.text || "";
  const title = clip((data.title || firstUser || NAMES[source]).replace(/\s+/g, " "), 60);
  return { title, workspace: data.workspace, ...toSession(source, data), turns: data.turns.length };
}

module.exports = { scan, load, NAMES, toSession, normArgs };
