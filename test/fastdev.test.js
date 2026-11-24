// Проверка режима «Быстрая разработка»: node test/fastdev.test.js
const assert = require("assert");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { runAgent } = require("../core/agent");
const { stopBackground } = require("../core/tools");

const ws = path.join(os.tmpdir(), "xc-fastdev-ws-" + Date.now());
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, "a.txt"), "AAA");
fs.writeFileSync(path.join(ws, "b.txt"), "BBB");

let turn = 0;
let seen = null; // что получила модель
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body);
    seen = { system: String(j.messages[0].content), tools: (j.tools || []).map((t) => t.function.name), reasoning: j.reasoning_effort, messages: j.messages };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
    turn++;
    if (turn === 1) {
      // три вызова сразу: два чтения (пойдут параллельно) и фоновая команда
      send({ choices: [{ delta: { tool_calls: [
        { index: 0, id: "c1", function: { name: "read_file", arguments: JSON.stringify({ path: "a.txt" }) } },
        { index: 1, id: "c2", function: { name: "read_file", arguments: JSON.stringify({ path: "b.txt" }) } },
        { index: 2, id: "c3", function: { name: "run_command", arguments: JSON.stringify({ command: "Start-Sleep 2; echo bg-done", background: true }) } },
      ] } }] });
      send({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    } else {
      send({ choices: [{ delta: { content: "Готово." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

(async () => {
  await new Promise((r) => srv.listen(9421, r));
  const provider = { id: "mock", name: "Mock", kind: "openai", baseUrl: "http://127.0.0.1:9421", reasoning: "effort" };
  const events = [];
  const history = [{ role: "user", content: "сделай быстро" }];
  const t0 = Date.now();
  await runAgent({ provider, key: "k", model: "m", modelName: "M", workspace: ws, thinking: "default", ctx: {}, history, access: "auto", fastDev: true, ev: (e) => events.push(e), approve: async () => "deny", customAgents: [{ name: "x", prompt: "p", enabled: true }] });
  const took = Date.now() - t0;

  const first = seen; // последний запрос (второй ход)
  assert.ok(first.system.includes("FAST DEVELOPMENT MODE"), "в системный промт добавлены правила быстрого режима");
  assert.ok(!first.tools.includes("run_subagents"), "субагентов нет без UltraCode");
  assert.ok(!first.tools.includes("run_custom_agent"), "свои субагенты тоже выключены без UltraCode");
  assert.ok(first.tools.includes("command_status"), "есть command_status");
  assert.strictEqual(first.reasoning, "low", "мышление по умолчанию — low");
  const results = events.filter((e) => e.type === "tool_result");
  assert.strictEqual(results.length, 3, "все три вызова выполнены");
  assert.ok(results.find((r) => r.id === "c1").result.includes("AAA"), "чтение a.txt");
  assert.ok(results.find((r) => r.id === "c2").result.includes("BBB"), "чтение b.txt");
  assert.ok(results.find((r) => r.id === "c3").result.includes("background"), "команда ушла в фон и вернула управление");
  assert.ok(took < 1900, "агент не ждал 2-секундную фоновую команду (занял " + took + " мс)");
  assert.ok(events.some((e) => e.type === "text" && e.text.includes("Готово")), "финальный ответ");
  stopBackground();
  srv.close();
  console.log("fastdev: 9 checks passed");
})().catch((e) => {
  console.error(e);
  stopBackground();
  process.exit(1);
});
