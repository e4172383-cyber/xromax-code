// XroMax Code: ключ устройства (Ed25519) для подписи запросов к серверу XroMax.
// Закрытый ключ создаётся на этом ПК и хранится зашифрованным (safeStorage Windows), открытый регистрируется на сервере.
// Каждый запрос к дорогим моделям подписан одноразово: ts.nonce.METHOD.path.sha256(body) —
// скопированный токен без этого ключа бесполезен, перехваченный запрос нельзя повторить.
const crypto = require("crypto");

let cfg = null; // { get(): stored|null, set(stored), enc, dec, origin, token(): string }
let key = null; // { priv: KeyObject, pub: base64, kid }
let registered = null; // Promise | null — регистрация для текущего токена

const keyId = (pubB64) => crypto.createHash("sha256").update(pubB64).digest("hex").slice(0, 24);

function init(c) {
  cfg = c;
}
function ensureKey() {
  if (key) return key;
  const s = cfg.get();
  if (s?.priv && s?.pub) {
    try {
      const pem = cfg.dec(s.priv);
      if (pem) key = { priv: crypto.createPrivateKey(pem), pub: s.pub, kid: keyId(s.pub) };
    } catch {}
  }
  if (!key) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    cfg.set({ priv: cfg.enc(privateKey.export({ format: "pem", type: "pkcs8" })), pub });
    key = { priv: privateKey, pub, kid: keyId(pub) };
  }
  return key;
}
/** Зарегистрировать открытый ключ на сервере (один раз на токен; при ошибке — повторим в следующий раз) */
function ensureRegistered() {
  const token = cfg.token();
  if (!token) return Promise.resolve(false);
  const tag = crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
  const s = cfg.get();
  if (s?.regFor === tag) return Promise.resolve(true);
  if (registered) return registered;
  const k = ensureKey();
  registered = fetch(cfg.origin + "/v1/code/device", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "XroMaxCode", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pub: k.pub }),
    signal: AbortSignal.timeout(20_000),
  })
    .then(async (r) => {
      const ok = r.ok && (await r.json().catch(() => ({}))).ok;
      if (ok) cfg.set({ ...cfg.get(), regFor: tag });
      return !!ok;
    })
    .catch(() => false)
    .finally(() => (registered = null));
  return registered;
}
/** Заголовки подписи для запроса (path — путь URL, body — тело ровно как будет отправлено) */
async function sign(method, path, body) {
  await ensureRegistered();
  const k = ensureKey();
  const ts = String(Date.now());
  const nonce = crypto.randomBytes(18).toString("base64url");
  const hash = crypto.createHash("sha256").update(body || "").digest("hex");
  const sig = crypto.sign(null, Buffer.from(`${ts}.${nonce}.${method.toUpperCase()}.${path}.${hash}`), k.priv).toString("base64");
  return { "X-XC-Key": k.kid, "X-XC-Ts": ts, "X-XC-Nonce": nonce, "X-XC-Sig": sig };
}
/** Сервер не знает устройство (например, вход заново) — зарегистрироваться снова */
function forget() {
  const s = cfg.get();
  if (s) cfg.set({ ...s, regFor: null });
}

module.exports = { init, sign, forget, ensureRegistered };
