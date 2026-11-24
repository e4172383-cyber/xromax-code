// XroMax Code: короткий журнал работы приложения (кольцо из последних 300 строк) — прикладывается к жалобам,
// чтобы сразу видеть, что случилось: ошибки, повторы, обрывы, шаги агента. Содержимое чатов и ключи сюда не попадают.
const LIMIT = 300;
const lines = [];
const t0 = Date.now();

function add(kind, text) {
  const s = `${new Date().toISOString().slice(11, 19)} ${kind} ${String(text).replace(/\s+/g, " ").slice(0, 300)}`;
  lines.push(s);
  if (lines.length > LIMIT) lines.shift();
}
// ключи и токены маскируем на всякий случай
const mask = (s) => String(s).replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1…").replace(/(xct1\.)[A-Za-z0-9_.-]+/g, "$1…").replace(/(Bearer\s+)[A-Za-z0-9_.-]+/gi, "$1…");

/** Перехват console.warn/error основного процесса */
function hookConsole() {
  for (const k of ["warn", "error"]) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      try {
        add(k === "error" ? "ERROR" : "WARN", mask(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
      } catch {}
      orig(...a);
    };
  }
}
/** События агента: пишем только значимые (ошибки, повторы, этапы), без текста ответов */
function agentEvent(sessionId, e) {
  if (!e || !e.type) return;
  const sid = String(sessionId || "").slice(0, 6);
  if (e.type === "error") add("ERROR", `agent[${sid}] ${mask(e.message || e.error || "")}`);
  else if (e.type === "retry") add("WARN", `agent[${sid}] повтор ${e.attempt ?? ""}/${e.max ?? ""} ${mask(e.reason || "")}`);
  else if (e.type === "done") add("INFO", `agent[${sid}] завершил`);
  else if (e.type === "tool_result" && /^(Error|Ошибка|Failed)/i.test(String(e.result || ""))) add("WARN", `agent[${sid}] инструмент вернул ошибку: ${mask(String(e.result).slice(0, 120))}`);
  else if (e.type === "notice") add("INFO", `agent[${sid}] ${mask(e.text || "")}`);
}
const tail = () => [`uptime ${Math.round((Date.now() - t0) / 1000)}s`, ...lines];

module.exports = { add, hookConsole, agentEvent, tail };
