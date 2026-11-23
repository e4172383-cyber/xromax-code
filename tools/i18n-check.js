// Проверка перевода в запущенном приложении (порт отладки 9336): включает язык, обходит экраны и печатает,
// что на экране осталось с кириллицей.   node tools/i18n-check.js de [путь-для-скриншотов]
const http = require("http");
const fs = require("fs");
const lang = process.argv[2] || "de";
const shots = process.argv[3];
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }).on("error", rej));

(async () => {
  const list = await get("http://127.0.0.1:9336/json");
  const page = list.find((p) => p.type === "page" && p.url.startsWith("file://"));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) pend.get(j.id)(j); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => { if (!shots) return; const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${shots}/${lang}-${name}.png`, Buffer.from(r.result.data, "base64")); };

  // оставшийся русский текст на экране (узлы и атрибуты), кроме сообщений модели и кода
  const CYRRE = lang === "uk" ? "/[ыэъёЫЭЪЁ]/" : "/[А-Яа-яЁё]/";
  const LEFT = `(() => { const out = new Set(); const CYR = ${CYRRE};
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const n = w.currentNode; const el = n.parentElement; if (!el || el.closest("script,style,.md,.bubble,.think-body,.tool-out,code,pre,textarea")) continue; if (CYR.test(n.nodeValue) && el.offsetParent !== null) out.add(n.nodeValue.trim().slice(0, 80)); }
    for (const el of document.querySelectorAll("[placeholder],[title],[aria-label]")) for (const a of ["placeholder","title","aria-label"]) { const v = el.getAttribute(a); if (v && CYR.test(v)) out.add("@" + a + ": " + v.slice(0, 80)); }
    return [...out]; })()`;

  await ev(`document.getElementById("signin")?.classList.add("hidden")`);
  await ev(`window.xc.prefs.set({ language: "${lang}" }).then((r) => { app.prefs = r.prefs; applyUiPrefs(r.prefs, r.dark); return 1; })`);
  await sleep(1500);
  const report = {};
  const step = async (name, expr, wait = 700) => { if (expr) await ev(expr); await sleep(wait); await shot(name); report[name] = await ev(LEFT); };
  await step("main", "");
  await step("model-picker", "openModelPicker()");
  await ev(`document.querySelector(".m-more")?.click()`); await sleep(500); await shot("model-side"); report["model-side"] = await ev(LEFT);
  await ev(`document.querySelector(".overlay")?.remove()`);
  await step("bug", `document.getElementById("bug-btn").click()`);
  await ev(`document.querySelector(".overlay")?.remove()`);
  await step("plugins", "openPlugins()", 1200);
  await ev(`document.querySelector("#plugins-page, .plug-page, .overlay")?.remove()`);
  for (const sec of ["prefs", "look", "notify", "keys", "privacy", "providers", "models", "ext", "projects", "exp", "about"]) {
    await step("settings-" + sec, `openSettingsPage("${sec}")`, 1800);
  }
  await ev(`closeSettingsPage()`);
  await step("slash", `(() => { const i = document.getElementById("input"); i.value = "/"; i.dispatchEvent(new Event("input")); })()`, 800);
  // демо-сессия: подтверждение, список задач, план
  await step("session", `(() => { newTab(); const x = cur(); x.items.push({role:"user",text:"привет"},{role:"assistant",parts:[{k:"tool",name:"write_file",args:{path:"a.txt"},status:"ok",result:"ok"},{k:"note",text:"Контекст почти заполнен — сжимаю разговор перед ответом…"},{k:"err",text:"Ошибка: terminated"},{k:"planbar"}],pending:false}); x.failed=true; placeComposer(); renderTranscript(); renderRetryBar(); })()`, 900);
  let total = 0;
  for (const [k, v] of Object.entries(report)) { total += v.length; console.log(`${v.length ? "✗" : "✓"} ${k}${v.length ? ": " + v.length : ""}`); for (const s of v.slice(0, 12)) console.log("     ", s); }
  console.log(`\nЯзык ${lang}: осталось русского на экране — ${total}`);
  process.exit(0);
})();
