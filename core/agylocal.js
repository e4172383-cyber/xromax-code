// XroMax Code: подписка Gemini через Antigravity CLI (agy), установленный на ЭТОМ компьютере.
// Приложение запускает ваш локальный agy в режиме печати: запросы идут по вашей подписке Google, без ключей и без нашего сервера.
// Инструменты приложения модель вызывает текстовыми блоками <tool_call>…</tool_call> (встроенные инструменты agy в этом режиме запрещены).
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DOWNLOAD_URL = "https://antigravity.google/product/antigravity-cli/";
let customPath = "";
let cleanHome = ""; // «чистый» профиль для запусков agy: без ваших плагинов и MCP-серверов (они грузятся ~17 секунд на каждый запрос)
const setHome = (d) => {
  cleanHome = d;
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {}
};
let cached = { at: 0, state: "unknown", models: [], detail: "", fast: false };
const envFor = (fast) => (fast && cleanHome ? { ...process.env, USERPROFILE: cleanHome, HOME: cleanHome } : process.env);
const setPath = (p) => ((customPath = String(p || "").trim()), (cached.at = 0));

// ───── поиск agy на этом ПК ─────
function candidates() {
  const h = os.homedir();
  const la = process.env.LOCALAPPDATA || path.join(h, "AppData", "Local");
  const ap = process.env.APPDATA || path.join(h, "AppData", "Roaming");
  return [
    customPath,
    path.join(la, "agy", "bin", "agy.exe"),
    path.join(la, "Programs", "agy", "agy.exe"),
    path.join(la, "Programs", "Antigravity", "bin", "agy.exe"),
    path.join(la, "Antigravity", "bin", "agy.exe"),
    path.join(la, "agy", "agy.exe"),
    path.join(h, ".agy", "bin", "agy.exe"),
    path.join(h, ".local", "bin", "agy.exe"),
    path.join(ap, "npm", "agy.cmd"),
  ].filter(Boolean);
}
function whereAgy() {
  return new Promise((res) => execFile("where", ["agy"], { windowsHide: true, timeout: 5000 }, (e, out) => res(e ? null : String(out).split(/\r?\n/).find((l) => l.trim()) || null)));
}
async function findAgy() {
  for (const c of candidates()) if (fs.existsSync(c)) return c;
  return await whereAgy();
}
const spawnAgy = (exe, args, opts = {}) => spawn(exe, args, { windowsHide: true, shell: /\.(cmd|bat)$/i.test(exe), env: process.env, ...opts });

// ───── статус и список моделей (`agy models`) ─────
/** state: missing — не установлен; login — установлен, но нет входа; ready — подключено; error */
async function status(force = false) {
  if (!force && Date.now() - cached.at < 20_000) return cached;
  const exe = await findAgy();
  if (!exe) return (cached = { at: Date.now(), state: "missing", models: [], detail: "Antigravity CLI не найден на этом компьютере", exe: null });
  // сначала пробуем «чистый» профиль (в 4–5 раз быстрее: ответ за ~4 с вместо ~22 с); вход Google берётся из диспетчера учётных данных Windows
  let fast = !!cleanHome;
  let r = await runModels(exe, fast);
  if (fast && !parseModels(r.out).length) {
    fast = false; // вход не виден из чистого профиля — работаем обычным профилем
    r = await runModels(exe, false);
  }
  const models = parseModels(r.out);
  if (models.length) return (cached = { at: Date.now(), state: "ready", models, detail: "", exe, fast });
  const text = (r.out + "\n" + r.err).toLowerCase();
  if (/login|log in|sign in|auth|credential|unauthor/.test(text)) return (cached = { at: Date.now(), state: "login", models: [], detail: "Нужно войти в аккаунт Google в Antigravity CLI", exe, fast: false });
  return (cached = { at: Date.now(), state: "error", models: [], detail: String(r.err || r.out).trim().slice(0, 200) || "agy models не вернул моделей", exe, fast: false });
}
function parseModels(out) {
  return String(out)
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 2 && /^[a-z0-9][a-z0-9._-]+$/i.test(p[0].trim()))
    .map(([id, name]) => ({ id: id.trim(), name: name.trim() }));
}
function runModels(exe, fast) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    const c = spawnAgy(exe, ["models"], { env: envFor(fast) });
    const t = setTimeout(() => {
      if (!done) (done = true), c.kill(), resolve({ out, err: err + "timeout" });
    }, 40_000);
    c.stdout.on("data", (b) => (out += b));
    c.stderr.on("data", (b) => (err += b));
    c.on("error", (e) => !done && ((done = true), clearTimeout(t), resolve({ out, err: String(e.message) })));
    c.on("close", () => !done && ((done = true), clearTimeout(t), resolve({ out, err })));
  });
}

/** Открыть окно PowerShell с agy: там вводим /login и входим в Google */
async function openLogin() {
  const exe = await findAgy();
  if (!exe) return { ok: false, error: "Antigravity CLI не найден — сначала установите его" };
  const q = exe.replace(/'/g, "''");
  spawn("cmd.exe", ["/c", "start", "", "powershell.exe", "-NoExit", "-Command", `& '${q}'`], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  return { ok: true };
}

// ───── запрос к модели ─────
const textOf = (c) => (Array.isArray(c) ? c.filter((p) => p.type === "text").map((p) => p.text).join("\n") : String(c ?? ""));
// компактная схема параметров: без описаний полей — модели хватает имён и типов, а запрос короче и быстрее
const compact = (p) => {
  if (!p || typeof p !== "object") return p;
  if (Array.isArray(p)) return p.map(compact);
  const o = {};
  for (const [k, v] of Object.entries(p)) if (k !== "description") o[k] = compact(v);
  return o;
};
function toolsSection(tools) {
  const list = tools
    .filter((t) => t.name)
    .map((t) => `- ${t.name}: ${String(t.description || "").replace(/\s+/g, " ").slice(0, 200)}\n  parameters: ${JSON.stringify(compact(t.parameters ?? {}))}`)
    .join("\n");
  return (
    "\n\n# Tools of the user's computer (through XroMax Code)\n" +
    "You DO have access to the user's computer: XroMax Code runs these tools on the user's PC for you (files, folders, commands). Never say you can't access files — use the tools. Do NOT use your own built-in tools; use only these.\n" +
    "To call tools, end your reply with one or more blocks exactly like this (valid JSON, nothing after the last block):\n" +
    '<tool_call>{"name": "write_file", "arguments": {"path": "hello.txt", "content": "hi"}}</tool_call>\n' +
    "You may write a short sentence before the blocks. The app runs the calls and sends the results back as «Tool result». Continue until the task is done, then answer normally without blocks.\n\n" +
    list
  );
}
function buildPrompt(system, history, tools) {
  const head = `${system}${tools.length ? toolsSection(tools) : ""}`;
  const body = history
    .map((m) => {
      if (m.role === "tool") return `=== Tool result (${m.tool_call_id ?? ""}) ===\n${textOf(m.content)}`;
      if (m.role === "assistant") {
        const calls = (m.tool_calls ?? []).map((c) => {
          let a = {};
          try {
            a = JSON.parse(c.function.arguments || "{}");
          } catch {}
          return `<tool_call>${JSON.stringify({ name: c.function.name, arguments: a })}</tool_call>`;
        });
        return `=== Assistant ===\n${[textOf(m.content), ...calls].filter(Boolean).join("\n")}`;
      }
      return `=== User ===\n${textOf(m.content)}`;
    })
    .join("\n\n");
  return `${head}\n\n${body}\n\n=== Assistant ===\n`;
}
function parseToolCalls(text) {
  const out = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m;
  while ((m = re.exec(text))) {
    try {
      const j = JSON.parse(m[1]);
      if (j && typeof j.name === "string") out.push({ id: "call_" + Math.random().toString(36).slice(2, 10), name: j.name, args: JSON.stringify(j.arguments ?? {}) });
    } catch {
      const n = /"name"\s*:\s*"([^"]+)"/.exec(m[1]);
      if (n) out.push({ id: "call_" + Math.random().toString(36).slice(2, 10), name: n[1], args: "" });
    }
  }
  return out;
}

const FIRST_MS = 300_000; // до первого текста
const IDLE_MS = 120_000; // тишина после начала
const TOTAL_MS = 1_200_000;

/** Один шаг: как openaiOnce — возвращает { content, toolCalls, finish, usage, assistantExtra } */
async function agyOnce({ model, system, history, tools, signal, onText, onThinking }, ApiError) {
  const st = await status();
  if (st.state !== "ready") throw new ApiError(st.state === "login" ? 401 : 503, st.state === "missing" ? "Antigravity CLI не установлен — подключите Gemini в «Провайдерах»." : st.state === "login" ? "Antigravity CLI: нужно войти — «Провайдеры» → Gemini → «Соединить»." : "Antigravity CLI: " + st.detail);
  // история ужимается (старые длинные результаты инструментов сокращаются) — меньше токенов, быстрее ответ
  const prompt = buildPrompt(system, require("./saver").shrinkHistory(history), tools || []);
  const args = ["--output-format=stream-json", "--disable-slash-commands", `--model=${model}`];
  const child = spawnAgy(st.exe, args, { env: envFor(st.fast) });
  return await new Promise((resolve, reject) => {
    let buf = "";
    let full = "";
    let sent = 0;
    let inCalls = false;
    let usage = null;
    let sawAny = false;
    let killed = "";
    let stderr = "";
    const kill = (why) => {
      killed = why;
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } catch {
        child.kill();
      }
    };
    let timer = setTimeout(() => kill("нет ответа за 5 минут"), FIRST_MS);
    const total = setTimeout(() => kill("слишком долго (20 минут)"), TOTAL_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => kill("тишина больше 2 минут"), IDLE_MS);
    };
    const onAbort = () => kill("остановлено");
    signal?.addEventListener("abort", onAbort, { once: true });
    onThinking?.("Gemini обдумывает задачу…");
    const emit = (final) => {
      if (inCalls) return;
      const at = full.indexOf("<tool_call", sent);
      if (at >= 0) {
        if (at > sent) onText?.(full.slice(sent, at));
        sent = at;
        inCalls = true;
        return;
      }
      let hold = 0;
      if (!final) {
        const tail = full.slice(-10);
        const lt = tail.lastIndexOf("<");
        if (lt >= 0 && "<tool_call".startsWith(tail.slice(lt))) hold = tail.length - lt;
      }
      const upto = full.length - hold;
      if (upto > sent) {
        onText?.(full.slice(sent, upto));
        sent = upto;
      }
    };
    child.stdout.on("data", (chunk) => {
      bump();
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.event === "step_update") {
            const u = j.step_update;
            if (u?.text_delta) {
              sawAny = true;
              full += u.text_delta;
              emit(false);
            }
            if (u?.usage) usage = u.usage;
          } else if (j.event === "result" && j.result?.usage) usage = j.result.usage;
        } catch {}
      }
    });
    child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      clearTimeout(total);
      reject(new ApiError(503, "Не удалось запустить Antigravity CLI: " + e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(total);
      signal?.removeEventListener("abort", onAbort);
      if (killed === "остановлено") return resolve({ content: full, toolCalls: [], finish: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null }, assistantExtra: {} });
      if (!sawAny && (killed || code !== 0)) return reject(new ApiError(killed ? 504 : 502, killed ? `Antigravity CLI: ${killed}` : "Antigravity CLI не ответил: " + (stderr.trim().slice(-200) || `код ${code}`)));
      emit(true);
      const calls = (tools || []).length ? parseToolCalls(full.slice(sent)) : [];
      if (!calls.length && inCalls) onText?.(full.slice(sent));
      const u = { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      resolve({ content: full, toolCalls: calls, finish: calls.length ? "tool_calls" : "stop", usage: u, assistantExtra: {} });
    });
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

module.exports = { DOWNLOAD_URL, setHome, setPath, findAgy, status, openLogin, agyOnce, buildPrompt, parseToolCalls };
