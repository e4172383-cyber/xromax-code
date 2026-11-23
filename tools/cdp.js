// Отладка: выполнить JS в окне XroMax Code и/или снять скриншот через протокол DevTools.
//   node tools/cdp.js eval "<js>"     node tools/cdp.js shot out.png
const http = require("http");
const fs = require("fs");
const port = process.env.CDP_PORT || 9336;
const get = (u) =>
  new Promise((res, rej) =>
    http
      .get(u, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(JSON.parse(d)));
      })
      .on("error", rej)
  );
(async () => {
  const list = await get(`http://127.0.0.1:${port}/json`);
  const page = list.find((p) => p.type === "page" && p.url.startsWith("file://"));
  if (!page) throw new Error("no page: " + JSON.stringify(list.map((p) => p.url)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data);
    if (j.id && pending.has(j.id)) pending.get(j.id)(j);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "eval") {
    const r = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
  } else if (cmd === "shot") {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(arg, Buffer.from(r.result.data, "base64"));
    console.log("saved", arg);
  } else if (cmd === "logs") {
    await send("Runtime.enable");
  }
  ws.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
