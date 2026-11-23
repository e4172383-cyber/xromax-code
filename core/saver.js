// XroMax Code: «Супер-экономия токенов» (бета). Работает с любым поставщиком, включая подписку ChatGPT.
// Хранимая история не меняется — модели уходит ужатая копия:
//  • старые результаты инструментов обрезаются до начала и конца;
//  • повторное чтение одного файла: старые копии заменяются пометкой;
//  • в старых вызовах write_file/edit_file длинное содержимое заменяется пометкой (JSON остаётся валидным);
//  • слишком длинный свежий вывод тоже режется;
//  • последние сообщения остаются нетронутыми — работа не теряет контекст.
const KEEP_RECENT = 8; // последних сообщений не трогаем
const OLD_TOOL_MAX = 700; // символов в старом результате инструмента
const NEW_TOOL_MAX = 8000; // символов в свежем результате
const OLD_ARG_MAX = 500; // символов в строковом поле аргументов старого вызова
const OLD_TEXT_MAX = 2500; // длинные старые ответы ассистента

const ERR_RE = /error|fail|exception|traceback|warn|не удалось|ошибка|denied|cannot|can't|not found|ENOENT|EACCES/i;
/** Умное сокращение вывода: начало, конец и строки с ошибками (логи установки и сборки на 90% — шум) */
const smartCut = (s, max) => {
  s = String(s ?? "");
  if (s.length <= max) return s;
  const lines = s.split(/\r?\n/);
  if (lines.length < 12) return cut(s, max);
  const head = lines.slice(0, 5);
  const tail = lines.slice(-5);
  const mid = lines.slice(5, -5).filter((l) => ERR_RE.test(l)).slice(0, 12).map((l) => l.slice(0, 200));
  const out = [...head, `…[сокращено ${lines.length - 10 - mid.length} строк]…`, ...mid, ...(mid.length ? ["…"] : []), ...tail].join("\n");
  return out.length > max * 1.5 ? cut(out, Math.round(max * 1.5)) : out;
};
const cut = (s, max, tail = 0.3) => {
  s = String(s ?? "");
  if (s.length <= max) return s;
  const t = Math.floor(max * tail);
  return `${s.slice(0, max - t)}\n…[сокращено ${s.length - max} симв. для экономии токенов]…\n${s.slice(s.length - t)}`;
};
const textOf = (c) => (Array.isArray(c) ? c.map((p) => (p.type === "text" ? p.text : "")).join("\n") : String(c ?? ""));

function shrinkArgs(args) {
  try {
    const o = JSON.parse(args || "{}");
    for (const [k, v] of Object.entries(o)) if (typeof v === "string" && v.length > OLD_ARG_MAX) o[k] = `${v.slice(0, 200)}…[ещё ${v.length - 200} симв. — смотрите файл]`;
    return JSON.stringify(o);
  } catch {
    return args;
  }
}

/** Вернуть ужатую копию истории для отправки модели */
function shrinkHistory(history) {
  if (!Array.isArray(history) || history.length <= KEEP_RECENT + 2) return history;
  const edge = history.length - KEEP_RECENT;
  // какой инструмент вызывал каждый результат, и последние чтения файлов
  const callOf = new Map();
  history.forEach((m) => {
    for (const c of m.tool_calls || []) callOf.set(c.id, c);
  });
  const lastRead = new Map();
  history.forEach((m, i) => {
    if (m.role !== "tool") return;
    const c = callOf.get(m.tool_call_id);
    if (c?.function?.name !== "read_file") return;
    try {
      lastRead.set(String(JSON.parse(c.function.arguments || "{}").path || ""), i);
    } catch {}
  });
  // одинаковые результаты одного и того же вызова: оставляем последний
  const seen = new Map();
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "tool") continue;
    const c = callOf.get(m.tool_call_id);
    const sig = c ? c.function?.name + "|" + (c.function?.arguments || "") + "|" + textOf(m.content).slice(0, 300) : null;
    if (sig && textOf(m.content).length > 200) {
      if (seen.has(sig)) m._dup = true;
      else seen.set(sig, i);
    }
  }
  return history.map((m, i) => {
    const old = i < edge;
    const far = i < edge / 2; // самая старая половина — режем сильнее
    if (m._dup && old) return { ...m, _dup: undefined, content: "[тот же результат повторён ниже]" };
    // старые картинки заменяем пометкой — одна картинка стоит тысячи токенов
    if (old && m.role === "user" && Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"))
      return { ...m, content: m.content.map((p) => (p.type === "image_url" ? { type: "text", text: "[картинка из ранней части разговора опущена]" } : p)) };
    if (m.role === "tool") {
      const c = callOf.get(m.tool_call_id);
      if (old && c?.function?.name === "read_file") {
        try {
          const p = String(JSON.parse(c.function.arguments || "{}").path || "");
          if (lastRead.get(p) > i) return { ...m, content: `[более ранняя версия ${p} — актуальное содержимое прочитано ниже]` };
        } catch {}
      }
      const t = textOf(m.content);
      const max = far ? 350 : old ? OLD_TOOL_MAX : NEW_TOOL_MAX;
      return t.length > max ? { ...m, content: smartCut(t, max) } : m;
    }
    if (!old) return m;
    if (m.role === "assistant") {
      let out = m;
      if (m.tool_calls?.length) out = { ...out, tool_calls: m.tool_calls.map((c) => ({ ...c, function: { ...c.function, arguments: shrinkArgs(c.function?.arguments) } })) };
      if (typeof m.content === "string" && m.content.length > OLD_TEXT_MAX) out = { ...out, content: cut(m.content, OLD_TEXT_MAX, 0.4) };
      return out;
    }
    return m;
  });
}

/** Короткие описания инструментов: у каждого запроса они идут целиком, а модели хватает первого предложения */
function shrinkTools(tools) {
  const first = (d) => {
    d = String(d || "");
    if (d.length <= 180) return d;
    const m = /^(.{60,180}?[.!?])(\s|$)/s.exec(d);
    return m ? m[1] : d.slice(0, 180);
  };
  const strip = (p) => {
    if (!p || typeof p !== "object") return p;
    const o = Array.isArray(p) ? p.map(strip) : { ...p };
    if (!Array.isArray(p)) {
      if (typeof o.description === "string") o.description = first(o.description);
      for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object") o[k] = strip(o[k]);
    }
    return o;
  };
  return (tools || []).map((t) => ({ ...t, description: first(t.description), parameters: strip(t.parameters) }));
}

module.exports = { shrinkHistory, shrinkTools };
