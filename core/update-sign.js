"use strict";
/**
 * XroMax Code: подпись обновлений (копия схемы приложения XROMAX, свой ключ и свой тег манифеста).
 * подпись обновлений (Ed25519 по манифесту «версия + SHA-512 установщика») 
 */
const crypto = require("crypto");
const fs = require("fs");

/** SHA-512 файла (потоком) */
function sha512File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha512");
    const s = fs.createReadStream(file);
    s.on("data", (d) => h.update(d));
    s.on("error", reject);
    s.on("end", () => resolve(h.digest()));
  });
}

/**
 * Манифест, который подписывается: версия привязана к файлу, чтобы старый подписанный установщик
 * нельзя было выдать за новую версию (откат) и подпись одной версии не подходила к другой.
 */
const MANIFEST_TAG = "XROMAX-CODE-update-v1";
function updateManifest(version, sha512Base64) {
  return `${MANIFEST_TAG}\n${version}\n${sha512Base64}`;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
/** Сравнение semver: -1 / 0 / 1; null — не версия. Пре-релиз меньше релиза (1.0.1-beta < 1.0.1) */
function compareSemver(a, b) {
  const x = SEMVER.exec(String(a || ""));
  const y = SEMVER.exec(String(b || ""));
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d > 0 ? 1 : -1;
  }
  const pa = x[4];
  const pb = y[4];
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const A = pa.split(".");
  const B = pb.split(".");
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] === undefined) return -1;
    if (B[i] === undefined) return 1;
    const na = /^\d+$/.test(A[i]);
    const nb = /^\d+$/.test(B[i]);
    if (na && nb) {
      const d = Number(A[i]) - Number(B[i]);
      if (d) return d > 0 ? 1 : -1;
    } else if (na !== nb) return na ? -1 : 1;
    else if (A[i] !== B[i]) return A[i] > B[i] ? 1 : -1;
  }
  return 0;
}

/** Подписать установщик версии version закрытым ключом → base64 (scripts/sign-update.js) */
async function signUpdate(file, version, privateKeyPem) {
  if (!SEMVER.test(String(version || ""))) throw new Error("Bad version: " + version);
  const digest = (await sha512File(file)).toString("base64");
  return crypto.sign(null, Buffer.from(updateManifest(version, digest), "utf8"), crypto.createPrivateKey(privateKeyPem)).toString("base64");
}

/**
 * Проверить обновление: подпись манифеста (версия из latest.yml + SHA-512 скачанного файла) встроенным ключом
 * И версия строго новее установленной. Никогда не бросает: true только если всё верно.
 */
async function verifyUpdateSignature(file, version, sigBase64, publicKeyPem, currentVersion) {
  try {
    if (!SEMVER.test(String(version || ""))) return false;
    const cmp = compareSemver(version, currentVersion);
    if (cmp === null || cmp <= 0) return false; // та же или старая версия — не ставим
    const b64 = String(sigBase64 || "").trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
    const sig = Buffer.from(b64, "base64");
    if (sig.length !== 64) return false; // Ed25519 — ровно 64 байта
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const digest = (await sha512File(file)).toString("base64");
    return crypto.verify(null, Buffer.from(updateManifest(version, digest), "utf8"), key, sig);
  } catch {
    return false;
  }
}

module.exports = { sha512File, signUpdate, verifyUpdateSignature, updateManifest, compareSemver };
