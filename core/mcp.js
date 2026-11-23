// XroMax Code: коннекторы — серверы MCP (Model Context Protocol). Два вида подключения:
//  stdio — программа на этом ПК (command + args), обмен JSON-RPC построчно;
//  http  — удалённый сервер (url, заголовки), Streamable HTTP: ответ JSON или поток SSE.
// Инструменты коннектора видны агенту как mcp__<коннектор>__<инструмент>.
const { spawn } = require("child_process");

const PROTOCOL = "2025-06-18";
const CLIENT = { name: "XroMax Code", version: "1.0" };

/** Рекомендуемые коннекторы. fields — что спросить у человека перед подключением. */
const RECOMMENDED = [
  { id: "context7", name: "Context7", description: "Свежая документация библиотек и фреймворков прямо в контекст", type: "http", url: "https://mcp.context7.com/mcp" },
  { id: "playwright", name: "Playwright", description: "Браузер: открыть сайт, кликнуть, заполнить форму, снять скриншот", type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], needs: "Node.js" },
  { id: "github", name: "GitHub", description: "Репозитории, issues, pull requests, код", type: "http", url: "https://api.githubcopilot.com/mcp/", fields: [{ key: "token", label: "GitHub-токен (Personal access token)", header: "Authorization", prefix: "Bearer " }] },
  { id: "filesystem", name: "Файлы (Filesystem)", description: "Доступ к выбранной папке через MCP", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "{{HOME}}"], needs: "Node.js" },
  { id: "memory", name: "Память (Memory)", description: "Долгая память агента: факты и связи между ними", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], needs: "Node.js" },
  { id: "sequential-thinking", name: "Sequential Thinking", description: "Пошаговое планирование сложных задач", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], needs: "Node.js" },
  { id: "supabase", name: "Supabase", description: "Базы данных, авторизация и хранилище Supabase", type: "stdio", command: "npx", args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "{{token}}"], needs: "Node.js", fields: [{ key: "token", label: "Supabase access token" }] },
  { id: "brave-search", name: "Brave Search", description: "Поиск в интернете", type: "stdio", command: "npx", args: ["-y", "@brave/brave-search-mcp-server"], needs: "Node.js", env: { BRAVE_API_KEY: "{{token}}" }, fields: [{ key: "token", label: "Brave Search API key" }] },
];

class StdioConn {
  constructor(cfg) {
    this.cfg = cfg;
    this.seq = 0;
    this.waiting = new Map();
    this.buf = "";
  }
  start() {
    const { command, args = [], env = {} } = this.cfg;
    // npx / npm на Windows — .cmd-файлы: запускаем через оболочку
    this.child = spawn(command, args, { shell: process.platform === "win32", windowsHide: true, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (d) => {
      this.buf += d.toString("utf8");
      let nl;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== undefined && this.waiting.has(msg.id)) {
          const w = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          msg.error ? w.reject(new Error(msg.error.message || "MCP error")) : w.resolve(msg.result);
        }
      }
    });
    this.stderr = "";
    this.child.stderr.on("data", (d) => (this.stderr = (this.stderr + d).slice(-2000)));
    this.child.on("exit", () => {
      for (const w of this.waiting.values()) w.reject(new Error("Коннектор закрылся. " + this.stderr.slice(-300)));
      this.waiting.clear();
      this.dead = true;
    });
    this.child.on("error", (e) => {
      for (const w of this.waiting.values()) w.reject(e);
      this.waiting.clear();
      this.dead = true;
    });
  }
  request(method, params, timeoutMs = 60_000) {
    if (this.dead) return Promise.reject(new Error("Коннектор не запущен. " + this.stderr.slice(-300)));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`Коннектор не ответил за ${Math.round(timeoutMs / 1000)} с`));
      }, timeoutMs);
      this.waiting.set(id, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method, params) {
    if (!this.dead) this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  close() {
    try {
      if (process.platform === "win32" && this.child?.pid) spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true });
      else this.child?.kill();
    } catch {}
  }
}

class HttpConn {
  constructor(cfg) {
    this.cfg = cfg;
    this.seq = 0;
    this.session = null;
  }
  start() {}
  async send(body, timeoutMs) {
    const res = await fetch(this.cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL, ...(this.session ? { "Mcp-Session-Id": this.session } : {}), ...(this.cfg.headers || {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    return res;
  }
  async request(method, params, timeoutMs = 60_000) {
    const id = ++this.seq;
    const res = await this.send({ jsonrpc: "2.0", id, method, params }, timeoutMs);
    if (!res.ok) throw new Error(`Коннектор ответил ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const type = res.headers.get("content-type") || "";
    let msg = null;
    if (type.includes("text/event-stream")) {
      const text = await res.text();
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          const j = JSON.parse(data);
          if (j.id === id) msg = j;
        } catch {}
      }
    } else msg = await res.json();
    if (!msg) throw new Error("Коннектор не прислал ответ");
    if (msg.error) throw new Error(msg.error.message || "MCP error");
    return msg.result;
  }
  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params }, 15_000).catch(() => {});
  }
  close() {}
}

/** Подставить ключи и пути в описание коннектора */
function materialize(c, homeDir) {
  const fill = (s) =>
    String(s)
      .replace(/\{\{HOME\}\}/g, homeDir)
      .replace(/\{\{(\w+)\}\}/g, (_, k) => c.values?.[k] ?? "");
  const cfg = { ...c, args: (c.args || []).map(fill), env: Object.fromEntries(Object.entries(c.env || {}).map(([k, v]) => [k, fill(v)])), headers: { ...(c.headers || {}) } };
  for (const f of c.fields || []) if (f.header && c.values?.[f.key]) cfg.headers[f.header] = (f.prefix || "") + c.values[f.key];
  if (cfg.url) cfg.url = fill(cfg.url);
  return cfg;
}

const toolSafe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);

class McpManager {
  constructor(homeDir) {
    this.homeDir = homeDir;
    this.conns = new Map(); // id → { conn, tools, sig }
  }
  /** Подключить (или взять готовое) и вернуть список инструментов */
  async connect(c) {
    const sig = JSON.stringify([c.type, c.url, c.command, c.args, c.values, c.headers, c.env]);
    const have = this.conns.get(c.id);
    if (have && have.sig === sig && !have.conn.dead) return have.tools;
    have?.conn.close();
    const cfg = materialize(c, this.homeDir);
    const conn = cfg.type === "http" ? new HttpConn(cfg) : new StdioConn(cfg);
    conn.start();
    await conn.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT }, cfg.type === "http" ? 30_000 : 120_000);
    conn.notify("notifications/initialized", {});
    const r = await conn.request("tools/list", {});
    const tools = (r?.tools || []).map((t) => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || { type: "object", properties: {} } }));
    this.conns.set(c.id, { conn, tools, sig });
    return tools;
  }
  async call(id, tool, args) {
    const have = this.conns.get(id);
    if (!have) throw new Error("Коннектор не подключён");
    const r = await have.conn.request("tools/call", { name: tool, arguments: args || {} }, 300_000);
    const parts = (r?.content || []).map((p) => (p.type === "text" ? p.text : p.type === "image" ? "[image]" : p.type === "resource" ? p.resource?.text || "[resource]" : JSON.stringify(p)));
    return (r?.isError ? "Error from connector: " : "") + (parts.join("\n") || JSON.stringify(r?.structuredContent ?? r ?? {}));
  }
  /** Инструменты всех включённых коннекторов для агента. Ошибки — в errors, агент работает без них. */
  async agentTools(list) {
    const tools = [];
    const errors = [];
    await Promise.all(
      list.map(async (c) => {
        try {
          const ts = await this.connect(c);
          for (const t of ts) {
            tools.push({
              name: `mcp__${toolSafe(c.id)}__${toolSafe(t.name)}`.slice(0, 64),
              description: `[${c.name}] ${t.description}`.slice(0, 1000),
              parameters: t.inputSchema,
              connector: c.name,
              run: (args) => this.call(c.id, t.name, args),
            });
          }
        } catch (e) {
          errors.push(`${c.name}: ${String(e.message || e).slice(0, 200)}`);
        }
      })
    );
    return { tools, errors };
  }
  async test(c) {
    this.conns.get(c.id)?.conn.close();
    this.conns.delete(c.id);
    const tools = await this.connect(c);
    return tools.length;
  }
  closeAll() {
    for (const { conn } of this.conns.values()) conn.close();
    this.conns.clear();
  }
}

module.exports = { McpManager, RECOMMENDED, materialize };
