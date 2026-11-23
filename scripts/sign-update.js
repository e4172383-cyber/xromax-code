// Подписать собранный установщик: dist/XroMax-Code-Setup-<версия>.exe → .exe.v1.sig (Ed25519, ключ signing/update-private.pem).
// Без этой подписи установленные приложения обновление не примут.
const fs = require("fs");
const path = require("path");
const { signUpdate, verifyUpdateSignature } = require("../core/update-sign");

(async () => {
  const root = path.join(__dirname, "..");
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const exe = path.join(root, "dist", `XroMax-Code-Setup-${version}.exe`);
  if (!fs.existsSync(exe)) throw new Error("No installer: " + exe);
  const priv = fs.readFileSync(path.join(root, "signing", "update-private.pem"), "utf8");
  const pub = fs.readFileSync(path.join(root, "signing", "update-public.pem"), "utf8");
  const sig = await signUpdate(exe, version, priv);
  fs.writeFileSync(exe + ".v1.sig", sig);
  const ok = await verifyUpdateSignature(exe, version, sig, pub, "0.0.0");
  if (!ok) throw new Error("Self-check of the signature failed");
  console.log("signed", path.basename(exe), "→", path.basename(exe) + ".v1.sig");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
