// XroMax Code: один потоковый запрос к модели. Два формата: OpenAI Chat Completions и родной API Anthropic.
// История разговора хранится в формате OpenAI; для Anthropic она переводится перед запросом.
// Ответ Anthropic (с блоками мышления) сохраняется как есть в _anthropic и возвращается неизменным, пока модель та же.
const Anthropic = require("@anthropic-ai/sdk");

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Default | Low | High | Max → уровень для API */
const LEVELS = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
/** Уровень для OpenAI-совместимого API: у моделей GPT (OpenAI, ChatGPT) есть «xhigh»; у остальных верхний уровень — high */
const gptEffort = (lvl, provider) => (provider.id === "openai" || provider.kind === "chatgpt" ? (lvl === "max" ? "xhigh" : lvl) : lvl === "max" || lvl === "xhigh" ? "high" : lvl);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Сколько раз переподключаться: обрыв связи — 10, проблема на сервере модели — 15 */
const RETRY = { network: 10, server: 15 };
function retryKind(e, signal) {
  if (signal?.aborted || e?.name === "AbortError") return null;
  const st = Number(e?.status) || 0;
  if (st === 429 || st === 408 || st >= 500) return "server";
  if (!st) return "network"; // terminated, fetch failed, ECONNRESET, оборванный поток
  return null; // 400/401/403/404 — повтор не поможет
}

/** Повторяет шаг целиком (даже если ответ уже начал приходить — частичный вывод интерфейс отбрасывает) */
async function withRetry(fn, signal, onRetry) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const kind = retryKind(e, signal);
      if (!kind || attempt > RETRY[kind]) throw e;
      onRetry?.({ attempt, max: RETRY[kind], kind, error: String(e?.message || e).slice(0, 200) });
      // пауза растёт: 1.5 с, 3 с … не больше 8 с; прерывается кнопкой «Стоп»
      await new Promise((res) => {
        const t = setTimeout(res, Math.min(8000, 1500 * attempt));
        signal?.addEventListener("abort", () => (clearTimeout(t), res()), { once: true });
      });
      if (signal?.aborted) throw e;
    }
  }
}

/** Пока модель «пишет» вызов инструмента (например, целый файл в write_file), шлём прогресс не чаще 4 раз в секунду */
function toolDrafter(onToolDraft) {
  let at = 0;
  return (i, name, args, force) => {
    if (!onToolDraft || !name) return;
    const now = Date.now();
    if (!force && now - at < 250) return;
    at = now;
    const path = /"(?:path|file_path|filename|from)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(args)?.[1];
    const command = /"command"\s*:\s*"((?:[^"\\]|\\.){0,80})/.exec(args)?.[1];
    onToolDraft({ i, name, chars: args.length, path: path?.replace(/\\\\/g, "\\"), command });
  };
}

// ───────────────────────── OpenAI-совместимые ─────────────────────────

async function openaiOnce({ provider, key, model, system, history, tools, thinking, signal, onText, onThinking, onToolDraft }) {
  const draft = toolDrafter(onToolDraft);
  const body = {
    model,
    messages: [{ role: "system", content: system }, ...history.map(({ _anthropic, ...m }) => m)],
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools?.length && !provider.noTools) {
    body.tools = tools.map((t) => ({ type: "function", function: t }));
    body.tool_choice = "auto";
  }
  const lvl = LEVELS[thinking];
  if (lvl && provider.reasoning === "effort") body.reasoning_effort = gptEffort(lvl, provider);
  if (provider.reasoning === "openrouter") {
    body.usage = { include: true };
    if (lvl) body.reasoning = { effort: lvl === "max" || lvl === "xhigh" ? "high" : lvl };
  }
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (provider.id === "openrouter") Object.assign(headers, { "HTTP-Referer": "https://xromax-ai.defhosting.com", "X-Title": "XroMax Code" });
  if (provider.id === "xromax-free") {
    headers["X-Client"] = "XroMax Code";
    headers.Cookie = "xromax_lang=ru"; // сообщения сайта (лимиты, ошибки) — на русском
  }

  const res = await fetch(provider.baseUrl + "/chat/completions", { method: "POST", signal, headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = await res.text().catch(() => "");
    try {
      const j = JSON.parse(msg);
      msg = j.error?.message || j.message || msg;
    } catch {}
    throw new ApiError(res.status, String(msg).slice(0, 500) || res.statusText);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let finish = null;
  const calls = [];
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
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new ApiError(j.error.code || 500, j.error.message || "Model error");
      if (j.usage) {
        const cached = j.usage.prompt_tokens_details?.cached_tokens ?? 0;
        usage.input = (j.usage.prompt_tokens ?? 0) - cached;
        usage.cacheRead = cached;
        usage.output = j.usage.completion_tokens ?? 0;
        if (typeof j.usage.cost === "number") usage.cost = j.usage.cost;
      }
      const ch = j.choices?.[0];
      if (!ch) continue;
      const d = ch.delta || {};
      const think = d.reasoning || d.reasoning_content;
      if (think) onThinking?.(think);
      if (d.content) {
        content += d.content;
        onText?.(d.content);
      }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? calls.length;
        calls[i] ??= { id: "", name: "", args: "" };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        draft(i, calls[i].name, calls[i].args, !!tc.function?.name);
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  // поток оборвался без конца ответа — это обрыв связи, шаг надо повторить
  if (!finish && (provider.id === "xromax-free" || (!content && !calls.length))) throw new Error("terminated: the answer stream ended early");
  return { content, toolCalls: calls.filter(Boolean).filter((c) => c.name), finish, usage, assistantExtra: {} };
}

// ───────────────────────── Anthropic ─────────────────────────

/** Модели, где мышление включается режимом adaptive (на более старых — без мышления) */
const ADAPTIVE = /^claude-(fable|mythos|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6|haiku-5)/;

function toAnthropic(history, model) {
  const out = [];
  const pushUser = (blocks) => {
    const last = out[out.length - 1];
    if (last && last.role === "user") last.content.push(...blocks);
    else out.push({ role: "user", content: [...blocks] });
  };
  for (const m of history) {
    if (m.role === "user") {
      if (!Array.isArray(m.content)) pushUser([{ type: "text", text: String(m.content || " ") }]);
      else
        pushUser(
          m.content
            .map((p) => {
              if (p.type === "text") return { type: "text", text: p.text || " " };
              const d = /^data:([^;]+);base64,(.*)$/s.exec(p.image_url?.url || "");
              return d ? { type: "image", source: { type: "base64", media_type: d[1], data: d[2] } } : null;
            })
            .filter(Boolean)
        );
    }
    else if (m.role === "tool") pushUser([{ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content ?? "") }]);
    else if (m.role === "assistant") {
      if (m._anthropic && m._anthropic.model === model) {
        out.push({ role: "assistant", content: m._anthropic.blocks });
        continue;
      }
      const blocks = [];
      if (m.content) blocks.push({ type: "text", text: String(m.content) });
      for (const tc of m.tool_calls || []) {
        let input = {};
        try {
          input = JSON.parse(tc.function.arguments || "{}");
        } catch {}
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      if (!blocks.length) blocks.push({ type: "text", text: "…" });
      out.push({ role: "assistant", content: blocks });
    }
  }
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "(начало разговора)" }] });
  return out;
}

async function anthropicOnce({ provider, key, model, system, history, tools, thinking, signal, onText, onThinking, onToolDraft }) {
  const draft = toolDrafter(onToolDraft);
  const drafts = {};
  const client = new Anthropic({ apiKey: key, baseURL: provider.baseUrl, maxRetries: 0 });
  const params = {
    model,
    max_tokens: /claude-3-/.test(model) ? 8192 : 64_000,
    system,
    cache_control: { type: "ephemeral" },
    messages: toAnthropic(history, model),
  };
  if (tools?.length) params.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (ADAPTIVE.test(model)) {
    params.thinking = { type: "adaptive", display: "summarized" };
    if (LEVELS[thinking]) params.output_config = { effort: thinking === "xhigh" ? "max" : LEVELS[thinking] };
  }
  const stream = client.messages.stream(params, { signal });
  let content = "";
  for await (const ev of stream) {
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
      drafts[ev.index] = { name: ev.content_block.name, args: "" };
      draft(ev.index, ev.content_block.name, "", true);
      continue;
    }
    if (ev.type !== "content_block_delta") continue;
    if (ev.delta.type === "input_json_delta" && drafts[ev.index]) {
      const d = drafts[ev.index];
      d.args += ev.delta.partial_json || "";
      draft(ev.index, d.name, d.args);
      continue;
    }
    if (ev.delta.type === "text_delta" && ev.delta.text) {
      content += ev.delta.text;
      onText?.(ev.delta.text);
    } else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) onThinking?.(ev.delta.thinking);
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") {
    const note = "\n\n_(Модель отказалась отвечать на этот запрос.)_";
    content += note;
    onText?.(note);
  }
  const toolCalls = msg.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: JSON.stringify(b.input ?? {}) }));
  const u = msg.usage;
  return {
    content,
    toolCalls,
    finish: msg.stop_reason,
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost: null },
    assistantExtra: { _anthropic: { model, blocks: msg.content } },
  };
}

/** Один шаг: ответ модели (текст, мышление, вызовы инструментов, расход) */
async function complete(opts) {
  const fn = opts.provider.kind === "anthropic" ? anthropicOnce : opts.provider.kind === "chatgpt" ? (o) => require("./chatgpt").chatgptOnce(o, ApiError) : openaiOnce;
  try {
    return await withRetry(() => fn(opts), opts.signal, opts.onRetry);
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new ApiError(e.status ?? 0, e.message);
    throw e;
  }
}

module.exports = { complete, ApiError, toAnthropic, withRetry, retryKind, RETRY };
