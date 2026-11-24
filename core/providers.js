// XroMax Code: поставщики моделей, автопоиск новых моделей и цены (для счётчика потраченных долларов).
// kind "openai" — формат OpenAI Chat Completions (OpenRouter, OpenAI, DeepSeek, XroMax, Groq, свои API…);
// kind "anthropic" — родной API Anthropic (Messages API, мышление adaptive).

const XROMAX_ORIGIN = process.env.XC_XROMAX_ORIGIN || "https://xromax-ai.defhosting.com";

/** Встроенные поставщики. reasoning — как передавать глубину мышления. */
const BUILTIN = [
  {
    id: "xromax-free",
    name: "XroMax",
    kind: "openai",
    baseUrl: `${XROMAX_ORIGIN}/v1/free`,
    needsKey: false,
    reasoning: "effort",
    fixedModels: [
      { id: "xromax-2.0-truo", name: "XroMax 2.0 Truo", context: 256_000, free: true, priceIn: 0, priceOut: 0 },
      { id: "particle-1", name: "Particle 1", context: 1_000_000, free: true, vision: true, priceIn: 0, priceOut: 0 },
      { id: "ling-3.2-flash", name: "Ling 3.2 Flash", context: 1_000_000, free: true, vision: true, maxImages: 200, priceIn: 0, priceOut: 0 },
      { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra", context: 1_000_000, free: true, priceIn: 0, priceOut: 0 },
      { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", context: 1_000_000, free: true, vision: true, status: "soon", note: "Скоро появится бесплатно", priceIn: 0, priceOut: 0 },
    ],
    note: "Встроено бесплатно — нужен только вход через сайт",
  },
  {
    id: "chatgpt",
    name: "ChatGPT (подписка)",
    kind: "chatgpt",
    oauth: "chatgpt",
    reasoning: "effort",
    note: "Вход через вашу подписку ChatGPT: без API-ключа, с лимитами подписки. История ваших чатов приложению недоступна",
    fixedModels: [
      { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", context: 1_000_000, vision: true, priceIn: 0, priceOut: 0 },
      { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", context: 1_000_000, vision: true, priceIn: 0, priceOut: 0 },
      { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", context: 400_000, vision: true, priceIn: 0, priceOut: 0 },
      { id: "gpt-6-luna", name: "GPT-6 Luna", context: 400_000, vision: true, priceIn: 0, priceOut: 0 },
    ],
  },
  {
    id: "antigravity",
    name: "Gemini (Antigravity)",
    kind: "agy",
    local: "agy",
    reasoning: "none",
    note: "Ваша подписка Gemini через Antigravity CLI на этом ПК: без ключей, запросы идут напрямую с вашего компьютера",
  },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", keyUrl: "https://platform.claude.com/settings/keys" },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", reasoning: "effort", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", reasoning: "openrouter", keyUrl: "https://openrouter.ai/keys" },
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", reasoning: "none", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "google", name: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", reasoning: "effort", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "xai", name: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1", reasoning: "none", keyUrl: "https://console.x.ai" },
  { id: "groq", name: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", reasoning: "none", keyUrl: "https://console.groq.com/keys" },
  { id: "mistral", name: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", reasoning: "none", keyUrl: "https://console.mistral.ai/api-keys" },
];

/** Цены за 1 млн токенов (USD), когда поставщик сам их не сообщает. Ключ — начало ID модели. */
const PRICE_TABLE = [
  ["claude-fable-5-2", 8, 40],
  ["claude-mythos-5-2", 8, 40],
  ["claude-fable-5", 10, 50],
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-5-5", 0.1, 0.5],
  ["claude-haiku-4", 1, 5],
  ["deepseek-chat", 0.28, 0.42],
  ["deepseek-reasoner", 0.28, 0.42],
];

/** Сколько вмещает контекст, если поставщик не сообщает */
const CONTEXT_GUESS = [
  [/^claude-(fable|mythos|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6|haiku-5)/, 1_000_000],
  [/^claude-/, 200_000],
  [/^gpt-6|^gpt-5|^o[34]/, 400_000],
  [/^gemini/, 1_000_000],
  [/^deepseek/, 128_000],
  [/^grok/, 256_000],
];

const guessContext = (id) => {
  for (const [re, n] of CONTEXT_GUESS) if (re.test(id)) return n;
  return 128_000;
};
const tablePrice = (id) => {
  const row = PRICE_TABLE.find(([p]) => id.startsWith(p));
  return row ? { priceIn: row[1], priceOut: row[2] } : null;
};

/** Человеческое имя из ID, если поставщик не дал своего */
const prettyName = (id) =>
  id
    .replace(/^[^/]+\//, "")
    .replace(/:free$/, "")
    .split(/[-_]/)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/(\d) (\d)/g, "$1.$2");

/** Модели, которые в списках поставщиков не нужны агенту (картинки, речь, эмбеддинги, модерация) */
const NOT_CHAT = /embed|whisper|tts|dall-e|image|moderation|audio|realtime|transcribe|davinci|babbage|rerank|search-preview|computer-use/i;

/**
 * Загрузить список моделей поставщика. Возвращает модели вида
 * { id, name, context, priceIn, priceOut, free, created }.
 */
async function discoverModels(provider, key) {
  // Gemini через локальный Antigravity CLI: список моделей («тиров») даёт `agy models`
  if (provider.local === "agy") {
    const st = await require("./agylocal").status(true);
    if (st.state !== "ready") throw new Error(st.detail || "Antigravity CLI не подключён");
    return st.models.map((m) => ({ id: m.id, name: m.name, context: 1_000_000, vision: true, free: true, priceIn: 0, priceOut: 0, created: 0 }));
  }
  // XroMax: каталог бесплатных моделей с сервера (доступность, «Скоро», пометки меняются без обновления приложения);
  // если сервер не ответил — встроенный список
  if (provider.id === "xromax-free") {
    try {
      const res = await fetch(`${provider.baseUrl}/models`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      const list = (j.data || []).filter((m) => m && m.id && m.status !== "disabled");
      if (list.length)
        return list.map((m) => ({ id: String(m.id), name: String(m.name || m.id), context: Number(m.context) || 128_000, vision: !!m.vision, maxImages: m.maxImages, free: !m.plan, plan: !!m.plan, priceIn: 0, priceOut: 0, status: m.status === "soon" ? "soon" : "available", badge: m.badge ? String(m.badge).slice(0, 20) : undefined, note: m.note ? String(m.note).slice(0, 120) : undefined, order: m.order ?? 99, created: 0 }));
    } catch {}
    return (provider.fixedModels || []).map((m) => ({ ...m, created: 0 }));
  }
  if (provider.fixedModels) return provider.fixedModels.map((m) => ({ ...m, created: m.created ?? 0 }));
  if (provider.kind === "anthropic") {
    const out = [];
    let after = "";
    for (let page = 0; page < 5; page++) {
      const res = await fetch(`${provider.baseUrl}/v1/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      for (const m of j.data ?? []) {
        out.push({
          id: m.id,
          name: m.display_name || prettyName(m.id),
          context: m.max_input_tokens || guessContext(m.id),
          vision: true,
          ...(tablePrice(m.id) ?? {}),
          created: Date.parse(m.created_at) || 0,
        });
      }
      if (!j.has_more || !j.last_id) break;
      after = j.last_id;
    }
    return out;
  }
  const res = await fetch(`${provider.baseUrl}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const list = Array.isArray(j) ? j : j.data ?? j.models ?? [];
  const out = [];
  for (const m of list) {
    const id = String(m.id ?? m.name ?? "").replace(/^models\//, "");
    if (!id || NOT_CHAT.test(id)) continue;
    // OpenRouter: модели без текстового ответа и без инструментов агенту не подходят
    if (provider.id === "openrouter") {
      const outMods = m.architecture?.output_modalities;
      if (Array.isArray(outMods) && !outMods.includes("text")) continue;
      if (Array.isArray(m.supported_parameters) && !m.supported_parameters.includes("tools")) continue;
    }
    const p = m.pricing ?? {};
    // OpenRouter: цена за токен строкой; XroMax API: за миллион числом
    const perM = (v, perMillion) => (v === undefined || v === null || v === "" ? undefined : perMillion ? Number(v) : Number(v) * 1_000_000);
    let priceIn = perM(p.input_per_million_usd, true) ?? perM(p.prompt, false);
    let priceOut = perM(p.output_per_million_usd, true) ?? perM(p.completion, false);
    if (priceIn === undefined) ({ priceIn, priceOut } = tablePrice(id) ?? {});
    out.push({
      id,
      name: m.name ? String(m.name).replace(/^[^:]+:\s*/, "") : prettyName(id),
      context: m.context_length || m.context_window || m.max_context_length || guessContext(id),
      priceIn,
      priceOut,
      free: id.endsWith(":free") || (priceIn === 0 && priceOut === 0),
      // понимает ли картинки: OpenRouter сообщает это сам, у остальных — по названию
      vision: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes("image") : /gpt-4o|gpt-4\.1|gpt-5|gpt-6|gemini|claude|vision|vl\b|pixtral|grok-[2-9]/i.test(id),
      created: (m.created ? Number(m.created) * (m.created > 1e12 ? 1 : 1000) : 0) || 0,
    });
  }
  return out;
}

/** Проверка ключа: удаётся ли получить список моделей */
async function testProvider(provider, key) {
  try {
    const models = await discoverModels(provider, key);
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }
}

/** Стоимость запроса в долларах (если цена известна) */
function costUsd(model, usage) {
  if (!model || model.priceIn === undefined || model.priceOut === undefined) return null;
  const input = (usage.input ?? 0) + (usage.cacheWrite ?? 0) * 1.25 + (usage.cacheRead ?? 0) * 0.1;
  return (input * model.priceIn + (usage.output ?? 0) * model.priceOut) / 1_000_000;
}

const NEW_DAYS = 21;
const isNew = (m) => !!m.created && Date.now() - m.created < NEW_DAYS * 86_400_000;

module.exports = { BUILTIN, XROMAX_ORIGIN, discoverModels, testProvider, costUsd, isNew, guessContext, prettyName };
