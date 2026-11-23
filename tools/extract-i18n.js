// Достаёт русские строки интерфейса (строковые и шаблонные литералы с кириллицей + текст index.html) в i18n/ru.json.
// Строки с ${...} превращаются в шаблоны с {0}, {1}… — переводятся целиком и подставляются обратно.
const fs = require("fs");
const parser = require(process.env.BABEL_PARSER || "@babel/parser");
const FILES = ["renderer/app.js", "renderer/extras.js", "renderer/settings.js", "renderer/markdown.js", "main.js", "core/mcp.js", "core/providers.js", "core/skills.js", "core/updater.js", "core/importers.js", "core/agent.js", "core/tools.js", "core/llm.js", "core/diagnostics.js", "core/web.js", "core/mentions.js"];
const CYR = /[А-Яа-яЁё]/;
const out = new Map();
const add = (s) => {
  s = s.replace(/\s+/g, " ").trim();
  if (s && CYR.test(s) && s.length < 700) out.set(s, true);
};
for (const f of FILES) {
  const src = fs.readFileSync(f, "utf8");
  const ast = parser.parse(src, { sourceType: "script", errorRecovery: true, plugins: [] });
  const walk = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "StringLiteral" && CYR.test(n.value)) { if (/<[a-z/]/i.test(n.value)) for (const p of n.value.split(/<[^>]*>/)) add(p); else add(n.value); }
    if (n.type === "TemplateLiteral") {
      // текст с ${} → «{0}»; внутри HTML-шаблона вырезаем теги, оставляя каждый текстовый кусок отдельной строкой
      let i = 0;
      const full = n.quasis.map((q, k) => q.value.cooked + (k < n.expressions.length ? `{${i++}}` : "")).join("");
      if (CYR.test(full)) {
        if (/<[a-z/]/i.test(full)) {
          for (const piece of full.split(/<[^>]*>/)) add(piece.replace(/\{\d+\}/g, (m) => m));
          for (const m of full.matchAll(/(?:placeholder|title|alt|aria-label)="([^"]*[А-Яа-яЁё][^"]*)"/g)) add(m[1]);
        } else add(full);
      }
    }
    for (const k in n) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(ast.program);
}
// index.html: текстовые узлы и атрибуты
const html = fs.readFileSync("renderer/index.html", "utf8");
for (const piece of html.split(/<[^>]*>/)) add(piece);
for (const m of html.matchAll(/(?:placeholder|title|alt|aria-label)="([^"]*[А-Яа-яЁё][^"]*)"/g)) add(m[1]);
const list = [...out.keys()].sort();
fs.writeFileSync("i18n/ru.json", JSON.stringify(list, null, 1));
console.log("строк:", list.length);
