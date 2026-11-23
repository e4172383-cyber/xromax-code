// Поддельный OpenAI-совместимый сервер для тестов XroMax Code (потоковый ответ, вызовы инструментов, usage).
// Сценарий выбирается по последнему сообщению пользователя:
//  «создай файл» → write_file, потом текст;  «удали рабочий стол» → delete_path вне проекта (опасно);
//  «ultra» → run_subagents (2 агента);  «сожми» / сжатие → выжимка;  иначе — мышление + текст.
const http = require("http");

function sse(res, chunks, usage) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: c.delta, finish_reason: c.finish ?? null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
const toolCall = (name, args) => [
  { delta: { tool_calls: [{ index: 0, id: "call_" + Math.random().toString(36).slice(2, 8), function: { name, arguments: "" } }] } },
  { delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }, finish: "tool_calls" },
];

function handle(body, res) {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1];
  const sys = msgs[0]?.content || "";
  const firstUser = msgs.find((m) => m.role === "user")?.content || "";
  const usage = { prompt_tokens: 9000 + msgs.length * 500, completion_tokens: 120 };
  if (last.role === "tool") {
    if (sys.includes("sub-agent inside XroMax Code")) return sse(res, [{ delta: { content: "Отчёт субагента: всё проверено." }, finish: "stop" }], usage);
    return sse(res, [{ delta: { content: "Готово. Результат инструмента получен." }, finish: "stop" }], usage);
  }
  const text = String(last.content || "").toLowerCase();
  if (/summarize this conversation|DETAILED record/i.test(text)) return sse(res, [{ delta: { content: "- Пользователь просил создать файл hello.txt\n- Файл создан" }, finish: "stop" }], usage);
  if (sys.includes("sub-agent inside XroMax Code")) return sse(res, toolCall("list_files", { depth: 1 }), usage);
  if (text.includes("создай файл")) return sse(res, toolCall("write_file", { path: "hello.txt", content: "привет" }), usage);
  if (text.includes("удали рабочий стол")) return sse(res, toolCall("delete_path", { path: "C:\\Users\\Public\\xc-danger-test-folder" }), usage);
  if (text.includes("ultra")) {
    return sse(res, toolCall("run_subagents", { agents: [ { role: "builder", title: "Сборка", task: "build it" }, { role: "critic", title: "Критика", task: "review it" } ] }), usage);
  }
  if (text.includes("большой контекст")) return sse(res, [{ delta: { content: "Много текста." }, finish: "stop" }], { prompt_tokens: 120000, completion_tokens: 50 });
  return sse(
    res,
    [
      { delta: { reasoning: "Подумаю над вопросом. " } },
      { delta: { reasoning: "Ответ простой." } },
      { delta: { content: "Привет! " } },
      { delta: { content: `Это ответ на: ${firstUser.slice(0, 40)}` }, finish: "stop" },
    ],
    usage
  );
}

function start(port = 9411) {
  const srv = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "mock-new", name: "Mock New", context_length: 128000, created: Math.floor(Date.now() / 1000), pricing: { prompt: "0.000001", completion: "0.000002" } }] }));
    }
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      try {
        handle(JSON.parse(raw), res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}
module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 9411).then(() => console.log("mock model on", process.argv[2] || 9411));
