// Проверки агента на поддельном сервере: node test/agent.test.js
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { start } = require("./mock-model");
const { runAgent, compressHistory, systemPrompt } = require("../core/agent");
const { discoverModels, costUsd } = require("../core/providers");
const { toAnthropic } = require("../core/llm");

const ws = path.join(os.tmpdir(), "xc-agent-ws-" + Date.now());
fs.mkdirSync(ws, { recursive: true });
let n = 0;
const ok = (c, label) => {
  assert.ok(c, label);
  n++;
};

(async () => {
  const srv = await start(9412);
  const provider = { id: "mock", name: "Mock", kind: "openai", baseUrl: "http://127.0.0.1:9412", reasoning: "openrouter" };
  const base = { provider, key: "k", model: "mock-new", modelName: "Mock", workspace: ws, thinking: "high", ctx: {} };
  const collect = () => {
    const events = [];
    return { events, ev: (e) => events.push(e) };
  };

  // 1. мышление и текст
  {
    const c = collect();
    const history = [{ role: "user", content: "привет" }];
    await runAgent({ ...base, history, access: "auto", ev: c.ev, approve: async () => "deny" });
    ok(c.events.some((e) => e.type === "thinking"), "thinking streamed");
    ok(c.events.filter((e) => e.type === "text").map((e) => e.text).join("").includes("Привет"), "text streamed");
    ok(c.events.some((e) => e.type === "usage" && e.usage.input > 0), "usage reported");
    ok(history.length === 2 && history[1].role === "assistant", "history updated");
  }
  // 2. инструмент в проекте без вопросов в режиме «Авто»
  {
    const c = collect();
    let asked = 0;
    await runAgent({ ...base, history: [{ role: "user", content: "создай файл" }], access: "auto", ev: c.ev, approve: async () => (asked++, "allow") });
    ok(asked === 0, "auto mode doesn't ask for a normal write");
    ok(fs.readFileSync(path.join(ws, "hello.txt"), "utf8") === "привет", "file written");
  }
  // 3. «Спрашивать всегда» → спрашивает; отказ — файл не пишется
  {
    fs.rmSync(path.join(ws, "hello.txt"), { force: true });
    const c = collect();
    let asked = 0;
    await runAgent({ ...base, history: [{ role: "user", content: "создай файл" }], access: "ask", ev: c.ev, approve: async () => (asked++, "deny") });
    ok(asked === 1, "ask mode asks");
    ok(!fs.existsSync(path.join(ws, "hello.txt")), "denied write not done");
    ok(c.events.some((e) => e.type === "tool_result" && /denied/.test(e.result)), "denial reported to model");
  }
  // 4. опасное действие в «Авто» спрашивается, в «Полном доступе» — нет
  {
    let asked = 0;
    let req = null;
    await runAgent({ ...base, history: [{ role: "user", content: "удали рабочий стол" }], access: "auto", ev: () => {}, approve: async (r) => ((asked++, (req = r)), "deny") });
    ok(asked === 1 && req.level === "danger" && req.reason, "danger asked in auto mode with reason");
    let asked2 = 0;
    await runAgent({ ...base, history: [{ role: "user", content: "удали рабочий стол" }], access: "full", ev: () => {}, approve: async () => (asked2++, "deny"), ctx: { trash: async () => {} } });
    ok(asked2 === 0, "full access never asks");
  }
  // 5. UltraCode: субагенты параллельно
  {
    const c = collect();
    await runAgent({ ...base, history: [{ role: "user", content: "ultra" }], access: "auto", ultra: true, ev: c.ev, approve: async () => "allow" });
    const start = c.events.find((e) => e.type === "subagents_start");
    ok(start && start.agents.length === 2, "subagents started");
    ok(c.events.filter((e) => e.type === "subagent_event" && e.event.type === "finished" && e.event.ok).length === 2, "both subagents finished");
    const res = c.events.find((e) => e.type === "tool_result" && /Отчёт субагента/.test(e.result));
    ok(!!res, "subagent reports returned to main agent");
    ok(c.events.filter((e) => e.type === "usage").length >= 4, "subagent usage counted");
  }
  // 6. без UltraCode инструмента субагентов нет
  {
    const c = collect();
    const history = [{ role: "user", content: "ultra" }];
    await runAgent({ ...base, history, access: "auto", ultra: false, ev: c.ev, approve: async () => "allow" });
    ok(c.events.some((e) => e.type === "tool_result" && /Unknown tool/.test(e.result)), "run_subagents unavailable without UltraCode");
  }
  // 7. сжатие
  {
    const r = await compressHistory({ ...base, history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] });
    // короткий разговор: последние сообщения остаются дословно после резюме
    ok(/hello\.txt/.test(r.history[0].content) && r.history[1].role === "assistant" && r.history.length <= 4, "compress produces summary");
    // большой разговор: сжимается примерно в 10–11 раз, не сильнее
    const big = [];
    for (let i = 0; i < 40; i++) big.push({ role: "user", content: "задача ".repeat(400) + i }, { role: "assistant", content: "ответ ".repeat(800) + i });
    const total = big.reduce((n, m) => n + m.content.length, 0);
    const b = await compressHistory({ ...base, history: big });
    const kept = b.history.slice(2);
    ok(kept.length >= 2 && kept[0].role === "user" && kept[kept.length - 1].content === big[big.length - 1].content, "recent messages kept verbatim");
    const keptChars = kept.reduce((n, m) => n + m.content.length, 0);
    ok(keptChars > total / 40 && keptChars < total / 10.5, "verbatim tail fits the ~10.5x budget");
  }
  // 8. список моделей и цена
  {
    const ms = await discoverModels({ id: "openrouter", kind: "openai", baseUrl: "http://127.0.0.1:9412" }, "k");
    ok(ms[0].id === "mock-new" && ms[0].priceIn === 1 && ms[0].context === 128000 && ms[0].created > 0, "discovery parses pricing/context/created");
    ok(Math.abs(costUsd(ms[0], { input: 1_000_000, output: 1_000_000 }) - 3) < 1e-9, "cost computed");
  }
  // 9. перевод истории для Anthropic
  {
    const h = [
      { role: "user", content: "x" },
      { role: "assistant", content: "ok", tool_calls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }] },
      { role: "tool", tool_call_id: "t1", content: "data" },
      { role: "assistant", content: "done", _anthropic: { model: "claude-x", blocks: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "done" }] } },
    ];
    const a = toAnthropic(h, "claude-x");
    ok(a[1].content[1].type === "tool_use" && a[2].content[0].type === "tool_result", "tool calls converted");
    ok(a[3].content[0].type === "thinking", "own thinking blocks replayed unchanged");
    const b = toAnthropic(h, "claude-y");
    ok(b[3].content[0].type === "text", "other model's blocks not replayed");
  }
  srv.close();
  const mini = systemPrompt({ workspace: ws, access: "auto", ownApi: true, ultra: false, modelName: "M" });
  ok(!/senior engineer/.test(mini) && /coding assistant with tools/.test(mini), "own API without UltraCode gets a minimal prompt");
  const fullOwn = systemPrompt({ workspace: ws, access: "auto", ownApi: true, ultra: true, modelName: "M" });
  ok(/UltraCode is ON/.test(fullOwn), "own API with UltraCode gets the full prompt");
  const builtin = systemPrompt({ workspace: ws, access: "auto", ownApi: false, ultra: false, modelName: "M" });
  ok(/senior engineer/.test(builtin), "built-in XroMax model always gets the full prompt");
  console.log(`agent: ${n} checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
