// XroMax Code: вход через подписку ChatGPT (OAuth, как у Codex): без API-ключа, с лимитами вашей подписки.
// Приложение получает только доступ к модели — историю ваших чатов ChatGPT оно не видит.
// Токены хранятся на этом компьютере в зашифрованном виде (шифрование Windows).
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"; // публичный клиент Codex (разрешён OpenAI для сторонних приложений)
const ISSUER = "https://auth.openai.com";
const PORT = 1455;
const REDIRECT = `http://localhost:${PORT}/auth/callback`;
const API = "https://chatgpt.com/backend-api/codex/responses";

let store = null; // { file, enc, dec, openExternal }
let auth = null; // { access, refresh, expires, account, email }
let loginServer = null;

const b64url = (b) => Buffer.from(b).toString("base64url");

function init(s) {
  store = s;
  try {
    const raw = fs.readFileSync(store.file, "utf8");
    auth = JSON.parse(store.dec(JSON.parse(raw).data) || "null");
  } catch {
    auth = null;
  }
}
function persist() {
  try {
    if (!auth) return fs.rmSync(store.file, { force: true });
    fs.writeFileSync(store.file, JSON.stringify({ data: store.enc(JSON.stringify(auth)) }));
  } catch {}
}
const isLoggedIn = () => !!auth?.refresh;
const info = () => (auth ? { email: auth.email || null } : null);

function claims(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
function applyTokens(t) {
  const idc = claims(t.id_token || "");
  const ac = claims(t.access_token || "");
  const account = idc["https://api.openai.com/auth"]?.chatgpt_account_id || ac["https://api.openai.com/auth"]?.chatgpt_account_id || auth?.account || "";
  auth = {
    access: t.access_token,
    refresh: t.refresh_token || auth?.refresh,
    expires: Date.now() + (Number(t.expires_in) || 3600) * 1000,
    account,
    email: idc.email || auth?.email || null,
  };
  persist();
}

async function tokenRequest(params) {
  const res = await fetch(`${ISSUER}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenAI: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
  return res.json();
}

/** Войти: открывает браузер, ждёт возврата на localhost:1455 */
function login() {
  return new Promise((resolve, reject) => {
    try {
      loginServer?.close();
    } catch {}
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const url =
      `${ISSUER}/oauth/authorize?` +
      new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        scope: "openid profile email offline_access",
        code_challenge: challenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        state,
        originator: "codex_cli_rs",
      });
    const done = (fn, v) => {
      clearTimeout(timer);
      try {
        srv.close();
      } catch {}
      loginServer = null;
      fn(v);
    };
    const page = (ok) => `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;background:#0b0b0b;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${ok ? "Готово — ChatGPT подключён" : "Не получилось войти"}</h2><p>${ok ? "Можно закрыть эту вкладку и вернуться в XroMax Code." : "Закройте вкладку и попробуйте ещё раз в приложении."}</p></div>`;
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      if (u.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get("code");
      if (!code || u.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page(false));
        return done(reject, new Error(u.searchParams.get("error_description") || "Вход отменён"));
      }
      try {
        const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier });
        applyTokens(t);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page(true));
        done(resolve, info());
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end(page(false));
        done(reject, e);
      }
    });
    loginServer = srv;
    srv.on("error", (e) => done(reject, new Error(e.code === "EADDRINUSE" ? "Порт 1455 занят (возможно, открыт Codex CLI) — закройте его и повторите" : e.message)));
    const timer = setTimeout(() => done(reject, new Error("Время входа вышло")), 5 * 60_000);
    srv.listen(PORT, "127.0.0.1", () => store.openExternal(url));
  });
}
function logout() {
  auth = null;
  persist();
}

/** Актуальные токены (обновляет, когда истекают) */
async function getAuth() {
  if (!auth) throw new Error("ChatGPT не подключён — войдите в настройках → Провайдеры");
  if (Date.now() > auth.expires - 60_000) {
    try {
      applyTokens(await tokenRequest({ grant_type: "refresh_token", refresh_token: auth.refresh, client_id: CLIENT_ID, scope: "openid profile email" }));
    } catch (e) {
      throw new Error("Сессия ChatGPT истекла — войдите заново в настройках → Провайдеры (" + String(e.message).slice(0, 80) + ")");
    }
  }
  return auth;
}

// ───────── лимиты подписки (5 часов / неделя) ─────────
let limits = null; // { pct5h, pctWeek, reset5h, resetWeek, plan, at }
/** окна лимитов → 5 часов и неделя (по длине окна), проценты и время сброса в мс */
function putWindow(L, w) {
  if (!w || typeof w.pct !== "number") return;
  const week = (w.minutes || 0) > 360;
  if (week) {
    L.pctWeek = w.pct;
    L.resetWeek = w.resetAt;
  } else {
    L.pct5h = w.pct;
    L.reset5h = w.resetAt;
  }
}
function limitsFromHeaders(h) {
  const num = (k) => (h.get(k) != null && h.get(k) !== "" ? Number(h.get(k)) : null);
  const L = { pct5h: null, pctWeek: null, reset5h: 0, resetWeek: 0, plan: limits?.plan || null, at: Date.now() };
  for (const k of ["primary", "secondary"]) {
    const pct = num(`x-codex-${k}-used-percent`);
    if (pct == null) continue;
    const after = num(`x-codex-${k}-reset-after-seconds`);
    putWindow(L, { pct, minutes: num(`x-codex-${k}-window-minutes`) ?? (k === "primary" ? 300 : 10080), resetAt: after != null ? Date.now() + after * 1000 : 0 });
  }
  if (L.pct5h != null || L.pctWeek != null) limits = { ...limits, ...L };
}
/** Свежие лимиты подписки с сервера ChatGPT (нужен вход) */
async function refreshLimits() {
  if (!isLoggedIn()) return null;
  try {
    const a = await getAuth();
    const res = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers: { Authorization: `Bearer ${a.access}`, "chatgpt-account-id": a.account, originator: "codex_cli_rs" }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const j = await res.json();
      const rl = j.rate_limit || j.rate_limits || {};
      const L = { pct5h: null, pctWeek: null, reset5h: 0, resetWeek: 0, plan: j.plan_type || null, at: Date.now() };
      for (const w of [rl.primary_window, rl.secondary_window]) {
        if (!w) continue;
        const secs = Number(w.limit_window_seconds) || 0;
        const resetAt = w.reset_at ? Number(w.reset_at) * (Number(w.reset_at) < 1e12 ? 1000 : 1) : w.reset_after_seconds != null ? Date.now() + Number(w.reset_after_seconds) * 1000 : 0;
        putWindow(L, { pct: Number(w.used_percent), minutes: secs / 60 || (w === rl.primary_window ? 300 : 10080), resetAt });
      }
      if (L.pct5h != null || L.pctWeek != null) limits = L;
    }
  } catch {}
  return getLimits();
}
const getLimits = () => (limits ? { ...limits, pct5h: limits.pct5h ?? 0, pctWeek: limits.pctWeek ?? 0 } : null);

// ───────── Responses API ─────────
function toInput(history) {
  const out = [];
  const textOf = (c) => (Array.isArray(c) ? c.filter((p) => p.type === "text").map((p) => p.text).join("\n") : String(c ?? ""));
  for (const m of history) {
    if (m.role === "user") {
      const parts = Array.isArray(m.content)
        ? m.content.map((p) => (p.type === "image_url" ? { type: "input_image", image_url: p.image_url?.url || p.image_url } : { type: "input_text", text: p.text ?? "" }))
        : [{ type: "input_text", text: String(m.content ?? "") }];
      out.push({ role: "user", content: parts });
    } else if (m.role === "assistant") {
      const t = textOf(m.content);
      if (t) out.push({ role: "assistant", content: [{ type: "output_text", text: t }] });
      for (const c of m.tool_calls || []) out.push({ type: "function_call", call_id: c.id, name: c.function.name, arguments: c.function.arguments || "{}" });
    } else if (m.role === "tool") {
      out.push({ type: "function_call_output", call_id: m.tool_call_id, output: textOf(m.content) });
    }
  }
  return out;
}

const EFFORT = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" };

async function chatgptOnce({ model, system, history, tools, thinking, fast, signal, onText, onThinking, onToolDraft }, ApiError) {
  const a = await getAuth();
  const body = {
    model,
    instructions: system,
    input: toInput(history),
    store: false,
    stream: true,
    parallel_tool_calls: true,
    include: ["reasoning.encrypted_content"],
  };
  if (tools?.length) {
    body.tools = tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
    body.tool_choice = "auto";
  }
  if (fast) body.service_tier = "priority"; // быстрый режим: ответы быстрее, лимит подписки тратится ~в 1,5 раза быстрее
  const eff = EFFORT[thinking];
  body.reasoning = { ...(eff ? { effort: eff } : {}), summary: "auto" };
  const res = await fetch(API, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${a.access}`,
      "chatgpt-account-id": a.account,
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
    },
    body: JSON.stringify(body),
  });
  limitsFromHeaders(res.headers);
  if (!res.ok) {
    let msg = await res.text().catch(() => "");
    try {
      const j = JSON.parse(msg);
      msg = j.detail || j.error?.message || j.message || msg;
    } catch {}
    if (res.status === 401) msg = "ChatGPT: нужно войти заново (настройки → Провайдеры). " + String(msg).slice(0, 120);
    throw new ApiError(res.status, String(msg).slice(0, 500) || res.statusText);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let finish = null;
  const calls = []; // по порядку появления
  const byItem = new Map();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let j;
      try {
        j = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      switch (j.type) {
        case "response.output_text.delta":
          content += j.delta;
          onText?.(j.delta);
          break;
        case "response.reasoning_summary_text.delta":
        case "response.reasoning_text.delta":
          if (j.delta) onThinking?.(j.delta);
          break;
        case "response.output_item.added":
          if (j.item?.type === "function_call") {
            const c = { id: j.item.call_id, name: j.item.name, args: j.item.arguments || "" };
            calls.push(c);
            byItem.set(j.item.id, c);
            onToolDraft?.({ i: calls.length - 1, name: c.name, chars: c.args.length });
          }
          break;
        case "response.function_call_arguments.delta": {
          const c = byItem.get(j.item_id);
          if (c) {
            c.args += j.delta;
            onToolDraft?.({ i: calls.indexOf(c), name: c.name, chars: c.args.length, path: /"(?:path|file_path|filename)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(c.args)?.[1] });
          }
          break;
        }
        case "response.output_item.done":
          if (j.item?.type === "function_call") {
            const c = byItem.get(j.item.id);
            if (c) c.args = j.item.arguments ?? c.args;
          }
          break;
        case "response.completed":
        case "response.incomplete": {
          const u = j.response?.usage;
          if (u) {
            const cached = u.input_tokens_details?.cached_tokens ?? 0;
            usage.input = (u.input_tokens ?? 0) - cached;
            usage.cacheRead = cached;
            usage.output = u.output_tokens ?? 0;
          }
          finish = j.type === "response.incomplete" ? "length" : calls.length ? "tool_calls" : "stop";
          break;
        }
        case "response.failed":
        case "error":
          throw new ApiError(j.response?.status || 500, j.response?.error?.message || j.message || "ChatGPT: ошибка модели");
      }
    }
  }
  if (!finish && !content && !calls.length) throw new Error("terminated: the answer stream ended early");
  return { content, toolCalls: calls.filter((c) => c.name), finish: finish || "stop", usage, assistantExtra: {} };
}

/** Нарисовать картинку подпиской ChatGPT (инструмент image_generation); quality: low | medium | high. Возвращает data URL */
async function generateImage({ prompt, quality, signal }) {
  const a = await getAuth();
  const q = ["low", "medium", "high"].includes(quality) ? quality : "medium";
  const res = await fetch(API, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${a.access}`, "chatgpt-account-id": a.account, "OpenAI-Beta": "responses=experimental", originator: "codex_cli_rs" },
    body: JSON.stringify({
      model: "gpt-6.2-sol",
      instructions: "Create the image the user describes by calling the image_generation tool. Do not answer with text.",
      input: [{ role: "user", content: [{ type: "input_text", text: String(prompt || "").slice(0, 4000) }] }],
      tools: [{ type: "image_generation", quality: q, size: "auto", output_format: "png" }],
      tool_choice: { type: "image_generation" },
      store: false,
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`ChatGPT: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
  limitsFromHeaders(res.headers);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let j;
      try {
        j = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (j.type === "response.output_item.done" && j.item?.type === "image_generation_call" && j.item.result) return `data:image/png;base64,${j.item.result}`;
      if (j.type === "response.failed" || j.type === "error") throw new Error(j.response?.error?.message || j.message || "ChatGPT: не удалось нарисовать");
    }
  }
  throw new Error("ChatGPT не вернул картинку — возможно, генерация недоступна на вашем тарифе");
}

module.exports = { generateImage, init, login, logout, isLoggedIn, info, getAuth, chatgptOnce, refreshLimits, getLimits };
