// Проверка повседневного режима («Рядом»): node test/daily.test.js
const assert = require("assert");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { runAgent } = require("../core/agent");

const ws = path.join(os.tmpdir(), "xc-daily-ws-" + Date.now());
fs.mkdirSync(ws, { recursive: true });

let turn = 0;
let seen = null;
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body);
    seen = { system: String(j.messages[0].content), tools: (j.tools || []).map((t) => t.function.name) };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
    turn++;
    if (turn === 1) {
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "d1", function: { name: "find_places", arguments: JSON.stringify({ query: "аптека" }) } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    } else {
      send({ choices: [{ delta: { content: "Нашёл." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

(async () => {
  await new Promise((r) => srv.listen(9422, r));
  const provider = { id: "mock", name: "Mock", kind: "openai", baseUrl: "http://127.0.0.1:9422", reasoning: "effort" };
  const calls = [];
  const events = [];
  const base = { provider, key: "k", model: "m", modelName: "M", workspace: ws, thinking: "default", ctx: {}, access: "auto", ev: (e) => events.push(e), approve: async () => "deny" };

  // режим выключен — инструментов нет
  await runAgent({ ...base, history: [{ role: "user", content: "где аптека" }], daily: false, onDaily: async () => "x" });
  assert.ok(!seen.tools.includes("find_places") && !seen.system.includes("EVERYDAY MODE"), "без режима «Рядом» инструментов и правил нет");

  // режим включён
  turn = 0;
  await runAgent({ ...base, history: [{ role: "user", content: "где аптека" }], daily: true, onDaily: async (n, a) => (calls.push([n, a]), "1. Тест — 100 m") });
  assert.ok(seen.tools.includes("get_location") && seen.tools.includes("find_places") && seen.tools.includes("book_or_pickup"), "три инструмента доступны");
  assert.ok(seen.system.includes("EVERYDAY MODE"), "правила режима в промте");
  assert.deepStrictEqual(calls, [["find_places", { query: "аптека" }]], "вызов дошёл до обработчика");
  assert.ok(events.some((e) => e.type === "tool_result" && e.result.includes("Тест")), "результат вернулся модели");

  // субагент (role) повседневных инструментов не получает
  turn = 0;
  await runAgent({ ...base, history: [{ role: "user", content: "x" }], daily: true, onDaily: async () => "x", role: "critic" });
  assert.ok(!seen.tools.includes("find_places"), "субагенты без повседневных инструментов");
  srv.close();
  console.log("daily: 6 checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
