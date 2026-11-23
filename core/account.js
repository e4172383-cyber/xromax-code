// XroMax Code: вход через сайт XroMax и резервные копии чатов в аккаунте.
// Вход: приложение заводит вход (4-значный код), человек входит на сайте (GitHub / Google) и вводит код,
// приложение получает свой токен на 180 дней. Копии чатов уходят на сайт после каждого ответа и остаются
// там, даже если чат удалили на ПК.
const crypto = require("crypto");
const { XROMAX_ORIGIN } = require("./providers");

const ORIGIN = process.env.XC_ACCOUNT_ORIGIN || XROMAX_ORIGIN;
const rnd = () => crypto.randomBytes(24).toString("base64url");

async function post(pathname, body, token) {
  const res = await fetch(ORIGIN + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "XroMaxCode", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.error?.message || j.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return j;
}
async function get(pathname, token) {
  const res = await fetch(ORIGIN + pathname, { headers: { "User-Agent": "XroMaxCode", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return j;
}

/** Начать вход: { code, providers:[{id,name,url}], wait() → {token,user} | null } */
async function startSignIn(signal) {
  const n = rnd();
  const secret = rnd();
  const r = await post("/v1/code/auth", { op: "start", n, secret });
  const wait = async () => {
    const until = Date.now() + 10 * 60_000;
    while (Date.now() < until && !signal?.aborted) {
      await new Promise((ok) => setTimeout(ok, 2000));
      try {
        const p = await post("/v1/code/auth", { op: "poll", n, secret });
        if (p.state === "ok") return { token: p.token, user: p.user };
        if (p.state === "expired") return null;
      } catch {}
    }
    return null;
  };
  return { code: r.code, providers: r.providers || [], wait };
}

const me = (token) => get("/v1/code/me", token);

/** Очередь выгрузки копий: последняя версия каждой сессии, по одной за раз, с повтором */
function createBackupQueue(getToken, readSession) {
  const pending = new Set();
  let busy = false;
  let timer = null;
  async function flush() {
    if (busy) return;
    const token = getToken();
    if (!token) return;
    busy = true;
    try {
      for (const id of [...pending]) {
        pending.delete(id);
        const s = await readSession(id);
        if (!s || !s.items?.length) continue;
        let doc = { id: s.id, title: s.title, workspace: s.workspace, updatedAt: s.updatedAt, items: s.items, history: s.history, stats: s.stats, modelRef: s.modelRef };
        // слишком большая история модели — сохраняем без неё (переписка на экране всё равно целиком)
        if (JSON.stringify(doc).length > 5_500_000) doc = { ...doc, history: undefined };
        try {
          await post("/v1/code/chats", { ...doc, items: doc.items }, token);
        } catch (e) {
          if (e.status !== 400 && e.status !== 413 && e.status !== 507) pending.add(id); // повторим позже
        }
      }
    } finally {
      busy = false;
      if (pending.size) schedule(30_000);
    }
  }
  function schedule(ms = 2500) {
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), ms);
  }
  return {
    push(id) {
      pending.add(id);
      schedule();
    },
    flush,
  };
}

const listBackups = (token) => get("/v1/code/chats", token);
const getBackup = (token, id) => get(`/v1/code/chats?id=${encodeURIComponent(id)}`, token);

/** Удалить все копии чатов этого аккаунта на сайте */
async function deleteBackups(token) {
  const res = await fetch(ORIGIN + "/v1/code/chats", { method: "DELETE", headers: { "User-Agent": "XroMaxCode", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status });
  return j;
}
/** Выбор «Помогать улучшать модели XroMax» — хранится в аккаунте */
const getPrivacy = (token) => get("/v1/code/privacy", token);
const setPrivacy = (token, body) => post("/v1/code/privacy", body, token);

/** Жалоба на баг: текст, скриншоты (data URL), сведения о приложении */
const sendBugReport = (token, body) => post("/v1/code/bugs", body, token);

module.exports = { sendBugReport, startSignIn, me, createBackupQueue, listBackups, getBackup, deleteBackups, getPrivacy, setPrivacy, ORIGIN };
