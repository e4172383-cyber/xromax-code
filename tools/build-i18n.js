// Превращает переведённые JSON (i18n-out/<код>.json) в скрипты i18n/<код>.js для окна приложения
const fs = require("fs");
const dir = process.argv[2] || "i18n-out";
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const code = f.replace(".json", "");
  const map = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
  // только то, что реально изменилось
  const out = {};
  for (const [k, v] of Object.entries(map)) if (v && v !== k) out[k] = v;
  fs.writeFileSync("i18n/" + code + ".js", "window.__i18nDict=" + JSON.stringify(out) + ";\n");
  console.log(code, Object.keys(out).length);
}
