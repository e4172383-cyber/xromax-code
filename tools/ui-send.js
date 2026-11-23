// Для тестов UI: node tools/ui-send.js "текст" — вписать в поле и отправить (через CDP)
const { execFileSync } = require("child_process");
const text = process.argv[2] || "привет";
const js = `(() => { const i = document.querySelector('#input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); document.querySelector('#send').click(); return 'sent'; })()`;
console.log(execFileSync(process.execPath, [require("path").join(__dirname, "cdp.js"), "eval", js]).toString().trim());
