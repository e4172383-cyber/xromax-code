// Отдельный процесс: ошибки TypeScript для одного файла по tsconfig проекта.
// node diag-ts.js <путь к typescript.js> <файл>  →  "OK" или до 20 ошибок «строка:столбец  текст»
const path = require("path");
const [tsPath, file] = process.argv.slice(2);
const ts = require(tsPath);

const dir = path.dirname(file);
const cfgPath = ts.findConfigFile(dir, ts.sys.fileExists, "tsconfig.json");
let options = { noEmit: true, skipLibCheck: true, allowJs: true, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
if (cfgPath) {
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
  if (!cfg.error) {
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
    options = { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false, composite: false, tsBuildInfoFile: undefined };
  }
}
const program = ts.createProgram({ rootNames: [file], options });
const sf = program.getSourceFile(file);
if (!sf) {
  console.log("OK");
  process.exit(0);
}
const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].filter((d) => d.category === ts.DiagnosticCategory.Error);
if (!diags.length) {
  console.log("OK");
  process.exit(0);
}
const lines = diags.slice(0, 20).map((d) => {
  const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
  return `${pos ? `${pos.line + 1}:${pos.character + 1}` : "?"}  TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n").split("\n")[0]}`;
});
if (diags.length > 20) lines.push(`… and ${diags.length - 20} more`);
console.log(lines.join("\n"));
