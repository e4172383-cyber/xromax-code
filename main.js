// XroMax Code — главный процесс: окно, настройки (ключи шифруются средствами Windows), список моделей,
// сессии (вкладки) и ИИ-агент. Интерфейс — renderer/, мост — preload.js (window.xc).
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { BUILTIN, discoverModels, testProvider, costUsd } = require("./core/providers");
const { runAgent, compressHistory } = require("./core/agent");
const account = require("./core/account");
const importers = require("./core/importers");
const chatgpt = require("./core/chatgpt");
const mentions = require("./core/mentions");
ipcMain.handle("files:search", (_e, { workspace, q }) => mentions.searchFiles(workspace, q).catch(() => []));
const { createUpdater } = require("./core/updater");
const skills = require("./core/skills");
const { McpManager, RECOMMENDED } = require("./core/mcp");

// только для автотестов: все запросы к моделям — на локальный поддельный сервер
const TEST_BASE = process.env.XC_TEST_API_BASE;
if (TEST_BASE) for (const p of BUILTIN) p.baseUrl = TEST_BASE;
if (process.env.XC_USER_DATA) app.setPath("userData", process.env.XC_USER_DATA);

const HOME_DIR = path.join(app.getPath("documents"), "XroMax Code");
const DEFAULT_PROJECT = path.join(HOME_DIR, "Default Project");
const DATA = () => app.getPath("userData");
// язык системных окон и уведомлений: словарь i18n/<код>.js (тот же, что у окна приложения)
let __dict = { code: "", map: {} };
function T(tpl, ...args) {
  const code = settings?.prefs?.language || "ru";
  if (code !== "ru" && __dict.code !== code) {
    try {
      const w = {};
      new Function("window", fs.readFileSync(path.join(__dirname, "i18n", code + ".js"), "utf8"))(w);
      __dict = { code, map: w.__i18nDict || {} };
    } catch {
      __dict = { code, map: {} };
    }
  }
  const out = code === "ru" ? tpl : __dict.map[tpl] ?? tpl;
  return out.replace(/{(d+)}/g, (_, i) => String(args[Number(i)] ?? ""));
}
const SETTINGS_FILE = () => path.join(DATA(), "settings.json");
const MODELS_FILE = () => path.join(DATA(), "models-cache.json");
const SESSIONS_DIR = () => path.join(DATA(), "sessions");

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let settings = null;
let modelsCache = {}; // providerId → { at, models, error }
const running = new Map(); // sessionId → { ctrl }
const pendingApprovals = new Map(); // reqId → resolve

// ───────────────────────── настройки ─────────────────────────
const enc = (s) => (s ? (safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(s).toString("base64") : "raw:" + s) : "");
const dec = (s) => {
  if (!s) return "";
  if (s.startsWith("enc:")) {
    try {
      return safeStorage.decryptString(Buffer.from(s.slice(4), "base64"));
    } catch {
      return "";
    }
  }
  return s.startsWith("raw:") ? s.slice(4) : s;
};

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
  } catch {}
  settings = {
    keys: {}, // providerId → зашифрованный ключ
    custom: [], // свои поставщики: { id, name, baseUrl, key }
    customModels: [], // свои модели: { provider, id, name, context }
    defaultModel: { provider: "xromax-free", model: "xromax-2.0-truo" },
    recents: [],
    totalSpentUsd: 0,
    projects: [DEFAULT_PROJECT],
    access: "auto",
    thinking: "default",
    ultraWarned: false,
    account: null, // { token (зашифрован), user }
    connectors: [], // { id, name, type, url|command,args, values, enabled, recommended }
    disabled: [], // выключенные скиллы / плагины / коннекторы плагинов (id)
    ...s,
  };
  settings.prefs = { ...DEFAULT_PREFS, ...(s.prefs || {}), notify: { ...DEFAULT_PREFS.notify, ...(s.prefs?.notify || {}) }, sounds: { ...DEFAULT_PREFS.sounds, ...(s.prefs?.sounds || {}) } };
}

/** Настройки интерфейса и поведения (страница «Настройки») */
const DEFAULT_PREFS = {
  layout: "top", // top — вкладки сверху, side — сессии списком сбоку
  language: "ru",
  followUp: "queue", // queue — в очередь, stop — остановить и отправить
  spellcheck: true,
  wrapCode: false,
  theme: "system", // system | light | dark
  uiFont: "Inter",
  codeFont: "JetBrains Mono",
  zoom: 100,
  motion: "system", // system | reduce | full
  notify: { done: true, approval: true, error: false },
  sounds: { done: "soft", approval: "ping", error: "low", ui: true },
  hotkeys: {},
  hiddenModels: [], // "провайдер/модель" — скрыты из выбора
  autoCompress: true,
  superSaver: false, // бета: супер-экономия токенов
  thinkingOpen: false,
  maxParallel: 11,
  customAgents: [], // свои субагенты: {name, description, prompt, enabled}
  // Конфиденциальность
  shareRegion: true, // сообщать агенту часовой пояс и регион Windows (без точного местоположения)
  improveModels: false, // согласие использовать чаты для улучшения моделей XroMax (хранится в аккаунте)
  chatCopies: true, // копии чатов в аккаунте XroMax
};
function saveSettings() {
  fs.mkdirSync(DATA(), { recursive: true });
  const tmp = SETTINGS_FILE() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE());
}

const allProviders = () => [
  ...BUILTIN,
  ...settings.custom.map((c) => ({ id: c.id, name: c.name, kind: c.kind === "anthropic" ? "anthropic" : "openai", baseUrl: TEST_BASE || c.baseUrl.replace(/\/+$/, ""), reasoning: "none", custom: true })),
];
const providerById = (id) => allProviders().find((p) => p.id === id);
// встроенная бесплатная модель XroMax работает по токену аккаунта (вход через сайт)
const accountToken = () => dec(settings.account?.token);
const keyFor = (p) => (p.oauth === "chatgpt" ? (chatgpt.isLoggedIn() ? "oauth" : "") : p.id === "xromax-free" ? accountToken() : p.custom ? dec(settings.custom.find((c) => c.id === p.id)?.key) : dec(settings.keys[p.id]));
const hasAccess = (p) => (p.needsKey === false ? !!accountToken() : !!keyFor(p));

// ───────────────────────── модели ─────────────────────────
function loadModelsCache() {
  try {
    modelsCache = JSON.parse(fs.readFileSync(MODELS_FILE(), "utf8"));
  } catch {
    modelsCache = {};
  }
}
function saveModelsCache() {
  fs.writeFileSync(MODELS_FILE(), JSON.stringify(modelsCache));
}

async function refreshProvider(p) {
  try {
    const models = await discoverModels(p, keyFor(p));
    modelsCache[p.id] = { at: Date.now(), models, error: null };
  } catch (e) {
    modelsCache[p.id] = { at: Date.now(), models: modelsCache[p.id]?.models ?? [], error: String(e.message || e).slice(0, 200) };
  }
}

/** Обновить списки моделей у всех подключённых поставщиков (новые модели появляются сами) */
async function refreshAllModels(force = false) {
  const jobs = allProviders()
    .filter(hasAccess)
    .filter((p) => force || !modelsCache[p.id] || Date.now() - modelsCache[p.id].at > 6 * 3600_000)
    .map(refreshProvider);
  await Promise.all(jobs);
  saveModelsCache();
  win?.webContents.send("models:updated");
}

function modelCatalog() {
  const groups = [];
  for (const p of allProviders()) {
    if (!hasAccess(p)) continue;
    const found = modelsCache[p.id]?.models ?? [];
    // XroMax: список целиком с сервера (встроенный — только пока сервер не ответил), порядок задаёт сервер
    const fixed = p.id === "xromax-free" && found.length ? [] : p.fixedModels ?? [];
    const custom = settings.customModels.filter((m) => m.provider === p.id).map((m) => ({ ...m, custom: true }));
    const seen = new Set();
    const models = [...fixed, ...custom, ...found].filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
    if (p.id === "xromax-free") models.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    else models.sort((a, b) => (b.created || 0) - (a.created || 0));
    groups.push({ provider: { id: p.id, name: p.name, note: p.note, noTools: !!p.noTools }, models, error: modelsCache[p.id]?.error ?? null });
  }
  return groups;
}
const findModel = (ref) => modelCatalog().find((g) => g.provider.id === ref?.provider)?.models.find((m) => m.id === ref.model);

// ───────────────────────── сессии ─────────────────────────
const sessionFile = (id) => path.join(SESSIONS_DIR(), `${id.replace(/[^\w-]/g, "")}.json`);
async function readSession(id) {
  try {
    return JSON.parse(await fsp.readFile(sessionFile(id), "utf8"));
  } catch {
    return null;
  }
}
async function writeSession(s) {
  await fsp.mkdir(SESSIONS_DIR(), { recursive: true });
  const f = sessionFile(s.id);
  await fsp.writeFile(f + ".tmp", JSON.stringify(s));
  await fsp.rename(f + ".tmp", f);
}
const sessionCache = new Map();
async function getSession(id) {
  if (!sessionCache.has(id)) sessionCache.set(id, (await readSession(id)) ?? null);
  return sessionCache.get(id);
}

// ───────────────────────── окно ─────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    title: "XroMax Code",
    backgroundColor: "#ffffff",
    icon: path.join(__dirname, "build", "icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#ffffff", symbolColor: "#111111", height: 44 },
    // в готовой сборке инструменты разработчика и просмотр исходника отключены (защита от копирования)
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: false, spellcheck: true, devTools: !app.isPackaged, webSecurity: true },
  });
  applyPrefs();
  win.removeMenu();
  // запрет инструментов разработчика, просмотра исходника и контекстного меню в готовой сборке
  if (app.isPackaged) {
    win.webContents.on("before-input-event", (e, i) => {
      const k = (i.key || "").toLowerCase();
      if (k === "f12" || (i.control && i.shift && ["i", "j", "c"].includes(k)) || (i.control && ["u"].includes(k))) e.preventDefault();
    });
    win.webContents.on("context-menu", (e) => e.preventDefault());
    win.webContents.on("devtools-opened", () => win.webContents.closeDevTools());
  }
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.on("closed", () => (win = null));
}

let updater = null;
let mcp = null;
// копии чатов уходят в аккаунт, только если это не выключено в «Конфиденциальности»
const backups = account.createBackupQueue(() => (settings.prefs?.chatCopies === false ? null : accountToken()), (id) => getSession(id));

app.whenReady().then(async () => {
  loadSettings();
  chatgpt.init({ file: path.join(DATA(), "chatgpt-auth.json"), enc, dec, openExternal: (u) => shell.openExternal(u) });
  loadModelsCache();
  skills.init(DATA());
  mcp = new McpManager(os.homedir());
  await fsp.mkdir(DEFAULT_PROJECT, { recursive: true }).catch(() => {});
  createWindow();
  updater = createUpdater((s) => send("update:state", s));
  updater.setup();
  refreshAllModels().catch(() => {});
  setInterval(() => refreshAllModels().catch(() => {}), 3600_000);
  // каталог бесплатных моделей XroMax меняется на сервере — обновляем при запуске и каждые 5 минут
  const refreshFree = () => {
    const p = providerById("xromax-free");
    if (p && hasAccess(p)) refreshProvider(p).then(() => (saveModelsCache(), send("models:updated"))).catch(() => {});
  };
  setTimeout(refreshFree, 1500);
  setInterval(refreshFree, 5 * 60_000);
  // токен ещё действует? Если сайт его не принимает — выходим, приложение попросит войти заново
  if (accountToken()) {
    account
      .me(accountToken())
      .then((r) => {
        settings.account.user = r.user;
        settings.account.plan = r.plan;
        settings.account.limits = r.limits;
        settings.account.estimates = r.estimates;
        saveSettings();
        send("auth:changed", publicAccount());
      })
      .catch((e) => {
        if (e.status === 401) {
          settings.account = null;
          saveSettings();
          send("auth:changed", null);
        }
      });
  }
});
app.on("before-quit", () => mcp?.closeAll());
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on("window-all-closed", () => app.quit());

// ───────────────────────── IPC ─────────────────────────
const send = (ch, data) => win?.webContents.send(ch, data);

ipcMain.handle("state:get", () => ({
  defaultModel: settings.defaultModel,
  recents: settings.recents,
  totalSpentUsd: settings.totalSpentUsd,
  projects: settings.projects,
  access: settings.access,
  thinking: settings.thinking,
  ultraWarned: settings.ultraWarned,
  defaultProject: DEFAULT_PROJECT,
  version: require("./package.json").displayVersion || app.getVersion(),
}));
ipcMain.handle("state:set", (_e, patch) => {
  for (const k of ["defaultModel", "access", "thinking", "ultraWarned"]) if (k in patch) settings[k] = patch[k];
  saveSettings();
});

ipcMain.handle("models:list", () => modelCatalog());
ipcMain.handle("models:refresh", async () => {
  await refreshAllModels(true);
  return modelCatalog();
});
ipcMain.handle("models:recent", (_e, ref) => {
  settings.recents = [ref, ...settings.recents.filter((r) => !(r.provider === ref.provider && r.model === ref.model))].slice(0, 6);
  saveSettings();
});
ipcMain.handle("models:addCustom", (_e, m) => {
  settings.customModels.push({ provider: m.provider, id: String(m.id).trim(), name: String(m.name || m.id).trim(), context: Number(m.context) || 128_000 });
  saveSettings();
  return modelCatalog();
});

ipcMain.handle("providers:list", () =>
  allProviders().map((p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.custom ? settings.custom.find((c) => c.id === p.id)?.baseUrl : p.baseUrl, needsKey: p.needsKey !== false, oauth: p.oauth || null, hasKey: !!keyFor(p), custom: !!p.custom, keyUrl: p.keyUrl, note: p.note, noTools: !!p.noTools, error: modelsCache[p.id]?.error ?? null, count: modelsCache[p.id]?.models?.length ?? (p.fixedModels?.length || 0) }))
);
ipcMain.handle("chatgpt:login", async () => {
  try {
    const i = await chatgpt.login();
    const p = providerById("chatgpt");
    await refreshProvider(p).catch(() => {});
    saveModelsCache();
    send("models:updated");
    return { ok: true, email: i?.email || null };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
});
ipcMain.handle("chatgpt:logout", () => {
  chatgpt.logout();
  delete modelsCache.chatgpt;
  saveModelsCache();
  send("models:updated");
  return { ok: true };
});
ipcMain.handle("chatgpt:info", () => chatgpt.info());
const pendingImage = new Map();
ipcMain.handle("image:choose", (_e, { reqId, choice }) => {
  pendingImage.get(reqId)?.(choice || null);
  return { ok: true };
});
/** Бесплатная генерация картинок XroMax (бэкенд на сервере, не раскрывается) */
async function xromaxImage(prompt, signal) {
  const base = providerById("xromax-free").baseUrl.replace(/\/v1\/free$/, "");
  const res = await fetch(`${base}/v1/free/images`, { method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accountToken()}` }, body: JSON.stringify({ prompt }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.image) throw new Error(j.error?.message || `XroMax: ${res.status}`);
  return j.image;
}
ipcMain.handle("chatgpt:limits", async () => (await chatgpt.refreshLimits()) || chatgpt.getLimits());
ipcMain.handle("providers:setKey", async (_e, { id, key }) => {
  const p = providerById(id);
  if (!p) return { ok: false, error: "Нет такого поставщика" };
  if (p.custom) settings.custom.find((c) => c.id === id).key = enc(key.trim());
  else if (key.trim()) settings.keys[id] = enc(key.trim());
  else delete settings.keys[id];
  saveSettings();
  if (!key.trim()) {
    delete modelsCache[id];
    saveModelsCache();
    send("models:updated");
    return { ok: true };
  }
  const t = await testProvider(p, key.trim());
  if (t.ok) {
    await refreshProvider(p);
    saveModelsCache();
    send("models:updated");
  }
  return t;
});
ipcMain.handle("providers:addCustom", async (_e, { name, baseUrl, key, kind }) => {
  const id = "custom-" + crypto.randomBytes(4).toString("hex");
  settings.custom.push({ id, name: String(name).trim() || "Мой API", baseUrl: String(baseUrl).trim(), key: enc(String(key || "").trim()), kind: kind === "anthropic" ? "anthropic" : "openai" });
  saveSettings();
  const p = providerById(id);
  const t = await testProvider(p, keyFor(p));
  if (t.ok) {
    await refreshProvider(p);
    saveModelsCache();
  }
  send("models:updated");
  return { id, ...t };
});
ipcMain.handle("providers:removeCustom", (_e, id) => {
  settings.custom = settings.custom.filter((c) => c.id !== id);
  settings.customModels = settings.customModels.filter((m) => m.provider !== id);
  delete modelsCache[id];
  saveSettings();
  saveModelsCache();
  send("models:updated");
});

ipcMain.handle("projects:pick", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: T("Папка проекта") });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  settings.projects = [dir, ...settings.projects.filter((p) => p !== dir)].slice(0, 12);
  saveSettings();
  return dir;
});
ipcMain.handle("projects:open", (_e, dir) => shell.openPath(dir));
ipcMain.handle("open:external", (_e, url) => /^https?:\/\//.test(url) && shell.openExternal(url));

ipcMain.handle("sessions:list", async () => {
  await fsp.mkdir(SESSIONS_DIR(), { recursive: true });
  const files = (await fsp.readdir(SESSIONS_DIR())).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    try {
      const s = JSON.parse(await fsp.readFile(path.join(SESSIONS_DIR(), f), "utf8"));
      out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, workspace: s.workspace });
    } catch {}
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});
ipcMain.handle("sessions:get", (_e, id) => getSession(id));
ipcMain.handle("sessions:save", async (_e, data) => {
  // интерфейс сохраняет вид (сообщения на экране, заголовок, настройки); историю для модели ведёт главный процесс
  const cur = (await getSession(data.id)) ?? { id: data.id, history: [], stats: { input: 0, output: 0, costUsd: 0, contextTokens: 0 }, createdAt: Date.now() };
  const next = { ...cur, ...data, history: cur.history, stats: cur.stats, updatedAt: Date.now() };
  sessionCache.set(next.id, next);
  await writeSession(next);
  backups.push(next.id);
});
// удаление на ПК: копия в аккаунте остаётся, а файл уходит в папку deleted (на всякий случай)
ipcMain.handle("sessions:delete", async (_e, id) => {
  running.get(id)?.ctrl.abort();
  sessionCache.delete(id);
  const del = path.join(DATA(), "deleted");
  await fsp.mkdir(del, { recursive: true });
  await fsp.rename(sessionFile(id), path.join(del, `${id.replace(/[^\w-]/g, "")}-${Date.now()}.json`)).catch(() => {});
});

// ───────── настройки (страница «Настройки») ─────────
const { Notification, nativeTheme } = require("electron");
function applyPrefs() {
  const p = settings.prefs;
  if (!win) return;
  win.webContents.session.setSpellCheckerLanguages(["ru", "en-US"]);
  win.webContents.session.setSpellCheckerEnabled(!!p.spellcheck);
  win.webContents.setZoomFactor(Math.min(2, Math.max(0.6, (Number(p.zoom) || 100) / 100)));
  nativeTheme.themeSource = p.theme === "dark" ? "dark" : p.theme === "light" ? "light" : "system";
  const dark = nativeTheme.shouldUseDarkColors;
  try {
    win.setTitleBarOverlay({ color: dark ? "#111111" : "#ffffff", symbolColor: dark ? "#eeeeee" : "#111111", height: 44 });
  } catch {}
  win.setBackgroundColor(dark ? "#111111" : "#ffffff");
}
nativeTheme.on("updated", () => {
  applyPrefs();
  send("prefs:theme", nativeTheme.shouldUseDarkColors);
});
ipcMain.handle("prefs:get", () => ({ prefs: settings.prefs, dark: nativeTheme.shouldUseDarkColors, version: app.getVersion() }));
ipcMain.handle("prefs:set", (_e, patch) => {
  settings.prefs = { ...settings.prefs, ...patch };
  saveSettings();
  applyPrefs();
  return { prefs: settings.prefs, dark: nativeTheme.shouldUseDarkColors };
});
function regionInfo() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const cc = app.getLocaleCountryCode?.() || "";
    const now = new Date().toLocaleString("ru-RU", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
    return `time zone ${tz}${cc ? `, Windows region ${cc}` : ""}, local time ${now}`;
  } catch {
    return null;
  }
}

// ───────── Конфиденциальность ─────────
ipcMain.handle("privacy:get", async () => {
  const out = { local: 0, localBytes: 0, copies: null, improve: settings.prefs.improveModels, signedIn: !!accountToken() };
  const files = (await fsp.readdir(SESSIONS_DIR()).catch(() => [])).filter((f) => f.endsWith(".json"));
  out.local = files.length;
  for (const f of files) out.localBytes += (await fsp.stat(path.join(SESSIONS_DIR(), f)).catch(() => ({ size: 0 }))).size;
  if (accountToken()) {
    const [list, pv] = await Promise.all([account.listBackups(accountToken()).catch(() => null), account.getPrivacy(accountToken()).catch(() => null)]);
    if (list) out.copies = list.sessions.length;
    if (pv && typeof pv.improve === "boolean" && pv.improve !== settings.prefs.improveModels) {
      settings.prefs.improveModels = out.improve = pv.improve;
      saveSettings();
    }
  }
  return out;
});
ipcMain.handle("privacy:improve", async (_e, on) => {
  settings.prefs.improveModels = !!on;
  saveSettings();
  if (accountToken()) await account.setPrivacy(accountToken(), { improve: !!on }).catch(() => {});
  return { prefs: settings.prefs };
});
// экспорт: все чаты — JSON (полностью) и Markdown (читать глазами) в выбранную папку
ipcMain.handle("privacy:export", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: T("Куда сохранить экспорт") });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  const dir = path.join(r.filePaths[0], `XroMax Code export ${new Date().toISOString().slice(0, 10)}`);
  await fsp.mkdir(path.join(dir, "json"), { recursive: true });
  await fsp.mkdir(path.join(dir, "markdown"), { recursive: true });
  const files = (await fsp.readdir(SESSIONS_DIR()).catch(() => [])).filter((f) => f.endsWith(".json"));
  let n = 0;
  for (const f of files) {
    try {
      const raw = await fsp.readFile(path.join(SESSIONS_DIR(), f), "utf8");
      const s = JSON.parse(raw);
      await fsp.writeFile(path.join(dir, "json", f), raw);
      const md = [`# ${s.title || "Сессия"}`, "", `Папка: ${s.workspace || ""}`, ""];
      for (const it of s.items || []) {
        if (it.role === "user") md.push("## Вы", "", it.text || "", "");
        else {
          md.push("## XroMax", "");
          for (const p of it.parts || []) {
            if (p.k === "text") md.push(p.text, "");
            else if (p.k === "tool") md.push(`> ${p.name} ${JSON.stringify(p.args || {}).slice(0, 300)}`, "");
          }
        }
      }
      const safe = String(s.title || f).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60).trim() || "session";
      await fsp.writeFile(path.join(dir, "markdown", `${safe} (${f.replace(/\.json$/, "").slice(0, 8)}).md`), md.join("\n"));
      n++;
    } catch {}
  }
  await fsp.writeFile(path.join(dir, "settings.json"), JSON.stringify({ prefs: settings.prefs, projects: settings.projects, exportedAt: new Date().toISOString() }, null, 2));
  shell.openPath(dir);
  return { ok: true, count: n, dir };
});
ipcMain.handle("privacy:deleteCopies", async () => {
  if (!accountToken()) return { ok: false, error: "Войдите в аккаунт" };
  try {
    const r = await account.deleteBackups(accountToken());
    return { ok: true, deleted: r.deleted ?? 0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle("privacy:openLocal", async () => {
  await fsp.mkdir(SESSIONS_DIR(), { recursive: true });
  return shell.openPath(SESSIONS_DIR());
});
// удалить все чаты на этом ПК (в корзину Windows — можно вернуть); работающие сессии не трогаем
ipcMain.handle("privacy:deleteLocal", async () => {
  const files = (await fsp.readdir(SESSIONS_DIR()).catch(() => [])).filter((f) => f.endsWith(".json"));
  let n = 0;
  for (const f of files) {
    if (running.has(f.replace(/\.json$/, ""))) continue;
    const p = path.join(SESSIONS_DIR(), f);
    await shell.trashItem(p).catch(() => fsp.rm(p, { force: true }));
    sessionCache.delete(f.replace(/\.json$/, ""));
    n++;
  }
  return { ok: true, deleted: n };
});
// ───────── перенос чатов из Claude Code / Codex / OpenCode ─────────
ipcMain.handle("import:scan", async (_e, source) => {
  try {
    const r = await importers.scan(source);
    const done = settings.imported || {};
    return { ok: true, found: r.found, dir: r.dir, sessions: r.sessions.map((s) => ({ ...s, imported: !!done[s.ref] })) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle("import:run", async (_e, { source, refs }) => {
  settings.imported ??= {};
  const out = { ok: true, imported: 0, failed: 0, ids: [] };
  for (const ref of (refs || []).slice(0, 500)) {
    try {
      const d = await importers.load(source, ref);
      if (!d.items.length) {
        out.failed++;
        continue;
      }
      // уже переносили этот чат — обновляем ту же сессию, а не плодим копии
      const id = settings.imported[ref] || Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const ws = d.workspace && fs.existsSync(d.workspace) ? d.workspace : settings.projects?.[0] || DEFAULT_PROJECT;
      const chars = d.history.reduce((n, m) => n + String(m.content).length, 0);
      const s = {
        id,
        title: d.title,
        workspace: ws,
        items: d.items,
        history: d.history,
        stats: { input: 0, output: 0, costUsd: 0, contextTokens: Math.round(chars / 3.5) },
        importedFrom: importers.NAMES[source],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      sessionCache.set(id, s);
      await writeSession(s);
      settings.imported[ref] = id;
      out.imported++;
      out.ids.push(id);
    } catch {
      out.failed++;
    }
  }
  saveSettings();
  return out;
});
// ───────── жалоба на баг ─────────
ipcMain.handle("bug:send", async (_e, { text, images, sessionId }) => {
  if (!accountToken()) return { ok: false, error: "Войдите в аккаунт, чтобы отправить жалобу" };
  const s = sessionId ? await getSession(sessionId).catch(() => null) : null;
  // последние сообщения сессии — чтобы было видно, где сломалось (без вложений и без больших результатов)
  const recent = (s?.items || []).slice(-6).map((it) =>
    it.role === "user" ? { role: "user", text: String(it.text || "").slice(0, 2000) } : { role: "assistant", parts: (it.parts || []).slice(-12).map((p) => ({ k: p.k, name: p.name, text: String(p.text || p.result || "").slice(0, 1200), status: p.status })) }
  );
  try {
    const r = await account.sendBugReport(accountToken(), {
      text: String(text || "").slice(0, 8000),
      images: (Array.isArray(images) ? images : []).filter((x) => /^data:image\/(png|jpeg|webp|gif);base64,/.test(x)).slice(0, 4),
      app: { version: require("./package.json").displayVersion || app.getVersion(), os: process.platform + " " + require("os").release() },
      model: s?.modelRef ? `${s.modelRef.provider}/${s.modelRef.model}` : null,
      access: s?.access ?? null,
      recent,
    });
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle("projects:remove", (_e, dir) => {
  settings.projects = settings.projects.filter((p) => p !== dir);
  if (!settings.projects.length) settings.projects = [DEFAULT_PROJECT];
  saveSettings();
  return settings.projects;
});
/** Системное уведомление, когда окно не в фокусе */
function notify(kind, title, body) {
  if (!settings.prefs.notify?.[kind] || !Notification.isSupported() || win?.isFocused()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, "build", "icon.png") });
  n.on("click", () => (win?.show(), win?.focus()));
  n.show();
}

// ───────── аккаунт (вход через сайт) ─────────
const publicAccount = () => (settings.account?.token ? { user: settings.account.user, plan: settings.account.plan ?? null, limits: settings.account.limits ?? null, estimates: settings.account.estimates ?? null, tests: settings.account.tests ?? null, resets: settings.account.resets ?? null } : null);
let signIn = null; // { ctrl, code, providers }
ipcMain.handle("auth:get", () => publicAccount());
// обновить тариф и лимиты с сайта (вызывается после ответа XroMax-модели)
let meRefreshAt = 0;
// ───── проверка сети: Windows «есть сеть» + реальный короткий запрос (сайт XroMax или generate_204) ─────
let netOnline = true;
let netFails = 0;
async function probeNet() {
  const { net } = require("electron");
  if (!net.isOnline()) return false;
  for (const u of [account.ORIGIN + "/v1/free/models", "https://www.gstatic.com/generate_204"]) {
    try {
      const r = await fetch(u, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (r.status < 500) return true;
    } catch {}
  }
  return false;
}
async function netTick() {
  const ok = await probeNet();
  netFails = ok ? 0 : netFails + 1;
  const online = ok || netFails < 2; // два неудачных подряд — считаем, что сети нет
  if (online !== netOnline) {
    netOnline = online;
    send("net:state", { online });
  }
}
setInterval(netTick, 10_000);
ipcMain.handle("net:check", async () => {
  const ok = await probeNet();
  netFails = ok ? 0 : 2;
  netOnline = ok;
  return { online: ok };
});
// сброс лимита XroMax 2.5 (по одному на 5 часов и на неделю)
ipcMain.handle("limits:reset", async (_e, w) => {
  if (!accountToken()) return { ok: false, error: "Войдите в аккаунт" };
  try {
    const res = await fetch(account.ORIGIN + "/v1/code/limits/reset", { method: "POST", headers: { "User-Agent": "XroMaxCode", "Content-Type": "application/json", Authorization: `Bearer ${accountToken()}` }, body: JSON.stringify({ window: w }), signal: AbortSignal.timeout(30_000) });
    const j = await res.json().catch(() => ({}));
    if (settings.account && j.resets) {
      settings.account.resets = j.resets;
      if (j.usage && settings.account.tests) for (const k of Object.keys(settings.account.tests)) settings.account.tests[k] = j.usage;
      saveSettings();
      send("auth:changed", publicAccount());
    }
    return j.ok ? { ok: true, resets: j.resets } : { ok: false, error: j.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 160) };
  }
});
ipcMain.handle("auth:refresh", async () => {
  if (!accountToken() || Date.now() - meRefreshAt < 3000) return publicAccount();
  meRefreshAt = Date.now();
  try {
    const m = await account.me(accountToken());
    if (settings.account) {
      settings.account.plan = m.plan;
      settings.account.limits = m.limits;
      settings.account.estimates = m.estimates;
        settings.account.tests = m.tests ?? null;
      settings.account.resets = m.resets ?? null;
      saveSettings();
      send("auth:changed", publicAccount());
    }
  } catch {}
  return publicAccount();
});
ipcMain.handle("auth:start", async () => {
  signIn?.ctrl.abort();
  const ctrl = new AbortController();
  try {
    const s = await account.startSignIn(ctrl.signal);
    signIn = { ctrl, code: s.code, providers: s.providers };
    s.wait().then((r) => {
      if (signIn?.ctrl !== ctrl) return;
      signIn = null;
      if (!r) return send("auth:changed", { expired: true });
      settings.account = { token: enc(r.token), user: r.user };
      saveSettings();
      refreshAllModels(true).catch(() => {});
      account.me(r.token).then((m) => {
        settings.account.plan = m.plan;
        settings.account.limits = m.limits;
        settings.account.estimates = m.estimates;
        settings.account.tests = m.tests ?? null;
        saveSettings();
        send("auth:changed", publicAccount());
      }).catch(() => {});
      send("auth:changed", publicAccount());
      win?.focus();
    });
    return { ok: true, code: s.code, providers: s.providers };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
});
ipcMain.handle("auth:open", (_e, url) => {
  if (typeof url === "string" && url.startsWith(account.ORIGIN + "/")) shell.openExternal(url);
});
ipcMain.handle("auth:cancel", () => {
  signIn?.ctrl.abort();
  signIn = null;
});
ipcMain.handle("auth:logout", () => {
  settings.account = null;
  saveSettings();
  send("auth:changed", null);
  send("models:updated");
});

// ───────── резервные копии в аккаунте ─────────
ipcMain.handle("backup:list", async () => {
  if (!accountToken()) return { ok: false, error: "Войдите в аккаунт" };
  try {
    const r = await account.listBackups(accountToken());
    const local = new Set((await fsp.readdir(SESSIONS_DIR()).catch(() => [])).map((f) => f.replace(/\.json$/, "")));
    return { ok: true, sessions: r.sessions.map((s) => ({ ...s, local: local.has(s.id) })) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
});
ipcMain.handle("backup:restore", async (_e, id) => {
  try {
    const d = await account.getBackup(accountToken(), id);
    const s = { id: d.id, title: d.title, workspace: d.workspace, items: d.items || [], history: d.history || [], stats: d.stats || { input: 0, output: 0, costUsd: 0, contextTokens: 0 }, modelRef: d.modelRef, createdAt: Date.now(), updatedAt: d.updatedAt || Date.now() };
    sessionCache.set(s.id, s);
    await writeSession(s);
    return { ok: true, id: s.id };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
});

// ───────── обновления ─────────
ipcMain.handle("update:get", () => updater?.get() ?? { state: "idle" });
ipcMain.handle("update:download", () => updater?.download());
ipcMain.handle("update:check", () => updater?.check());

// ───────── плагины, скиллы, коннекторы ─────────
const isOn = (id) => !settings.disabled.includes(id);
function allConnectors() {
  const own = settings.connectors.map((c) => ({ ...c, source: c.recommended ? "recommended" : "custom" }));
  const fromPlugins = [];
  for (const p of skills.listPlugins()) {
    for (const [key, v] of Object.entries(p.mcp || {})) {
      fromPlugins.push({ id: `plugin-${p.name}-${key}`, name: `${key} (${p.name})`, type: v.type === "http" || v.url ? "http" : "stdio", url: v.url, headers: v.headers, command: v.command, args: v.args, env: v.env, enabled: true, source: "plugin" });
    }
  }
  return [...own, ...fromPlugins].map((c) => ({ ...c, enabled: c.source === "plugin" ? isOn(c.id) : c.enabled !== false }));
}
function catalogExtras() {
  const sk = skills.listSkills();
  const plugins = skills.listPlugins();
  return {
    skills: sk.map((s) => ({ id: s.id, name: s.name, description: s.description, source: s.source, enabled: isOn(s.id) })),
    plugins: plugins.map((p) => ({ id: p.id, name: p.name, description: p.description, version: p.version, skills: p.skills.length, connectors: Object.keys(p.mcp || {}).length, enabled: isOn(p.id) })),
    connectors: allConnectors().map(({ values, headers, env, ...c }) => ({ ...c, hasValues: !!values && Object.keys(values).length > 0 })),
    recommended: RECOMMENDED.map((r) => ({ ...r, installed: settings.connectors.some((c) => c.id === r.id) })),
  };
}
ipcMain.handle("ext:list", () => catalogExtras());
ipcMain.handle("ext:toggle", (_e, { id, on }) => {
  const c = settings.connectors.find((x) => x.id === id);
  if (c) c.enabled = !!on;
  else settings.disabled = on ? settings.disabled.filter((x) => x !== id) : [...new Set([...settings.disabled, id])];
  saveSettings();
  return catalogExtras();
});
ipcMain.handle("ext:import", async (_e, kind) => {
  const r = await dialog.showOpenDialog(win, {
    title: kind === "plugin" ? T("Плагин: папка или .zip") : T("Скилл: папка, .zip или .md"),
    properties: ["openFile", "openDirectory"],
    filters: kind === "plugin" ? [{ name: "Плагин", extensions: ["zip", "json"] }] : [{ name: "Скилл", extensions: ["zip", "md"] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  let src = r.filePaths[0];
  if (/plugin\.json$/i.test(src)) src = path.dirname(src);
  try {
    const res = kind === "plugin" ? await skills.importPlugin(src) : await skills.importSkill(src);
    return { ...res, list: catalogExtras() };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
});
ipcMain.handle("ext:remove", async (_e, id) => {
  if (settings.connectors.some((c) => c.id === id)) settings.connectors = settings.connectors.filter((c) => c.id !== id);
  else await skills.removeItem(id);
  saveSettings();
  return catalogExtras();
});
ipcMain.handle("ext:addConnector", async (_e, c) => {
  // рекомендуемый (по id) или свой: { name, type: "http"|"stdio", url, headerName, headerValue, command, args }
  const rec = RECOMMENDED.find((r) => r.id === c.recommendedId);
  const conn = rec
    ? { ...rec, values: c.values || {}, enabled: true, recommended: true }
    : {
        id: "custom-" + crypto.randomBytes(3).toString("hex"),
        name: String(c.name || "Мой коннектор").slice(0, 60),
        type: c.type === "stdio" ? "stdio" : "http",
        url: c.url,
        headers: c.headerName && c.headerValue ? { [c.headerName]: c.headerValue } : {},
        command: c.command,
        args: String(c.args || "").match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, "")) ?? [],
        enabled: true,
      };
  try {
    const n = await mcp.test(conn);
    settings.connectors = [...settings.connectors.filter((x) => x.id !== conn.id), conn];
    saveSettings();
    return { ok: true, tools: n, list: catalogExtras() };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }
});

ipcMain.handle("agent:approve", (_e, { reqId, decision }) => {
  pendingApprovals.get(reqId)?.(decision);
  pendingApprovals.delete(reqId);
});
ipcMain.handle("agent:stop", (_e, id) => {
  running.get(id)?.ctrl.abort();
});

function addSpend(s, model, usage) {
  const cost = usage.cost ?? costUsd(model, usage);
  s.stats.input += (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  s.stats.output += usage.output ?? 0;
  if (cost) {
    s.stats.costUsd += cost;
    settings.totalSpentUsd = (settings.totalSpentUsd || 0) + cost;
    saveSettings();
  }
  return cost;
}

/** Отправить сообщение в сессию: { id, text, modelRef, thinking, access, ultra, workspace } */
ipcMain.handle("agent:run", async (_e, req) => {
  if (running.has(req.id)) return { ok: false, error: "Агент уже работает в этой сессии" };
  const p = providerById(req.modelRef?.provider);
  if (!p || !hasAccess(p)) return { ok: false, error: "Подключите поставщика этой модели в настройках" };
  const model = findModel(req.modelRef) ?? { id: req.modelRef.model, name: req.modelRef.model, context: 128_000 };
  if (model.status === "soon") return { ok: false, error: `${model.name} скоро появится — пока выберите другую модель` };
  let s = await getSession(req.id);
  if (!s) {
    s = { id: req.id, title: "Сессия", history: [], stats: { input: 0, output: 0, costUsd: 0, contextTokens: 0 }, createdAt: Date.now() };
    sessionCache.set(s.id, s);
  }
  s.workspace = req.workspace || s.workspace || DEFAULT_PROJECT;
  await fsp.mkdir(s.workspace, { recursive: true }).catch(() => {});
  const ctrl = new AbortController();
  running.set(req.id, { ctrl });
  const ev = (e) => send("agent:event", { sessionId: req.id, ...e });

  // контекст почти полон — сначала сжимаем сами
  if (settings.prefs.autoCompress && s.stats.contextTokens > (model.context || 128_000) * (settings.prefs.superSaver ? 0.6 : 0.95) && s.history.length > 2) {
    ev({ type: "compress_start", auto: true });
    try {
      const c = await compressHistory({ provider: p, key: keyFor(p), model: model.id, history: s.history, signal: ctrl.signal });
      s.history = c.history;
      addSpend(s, model, c.usage);
      s.stats.contextTokens = Math.ceil(c.history.reduce((n, m) => n + String(typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")).length, 0) / 3.5);
      ev({ type: "compress_end", ok: true, stats: s.stats, totalSpentUsd: settings.totalSpentUsd, ratio: c.ratio });
    } catch (e) {
      ev({ type: "compress_end", ok: false, error: String(e.message || e) });
    }
  }

  // включённые скиллы (свои, встроенные и из включённых плагинов)
  const enabledSkills = skills
    .listSkills()
    .filter((x) => isOn(x.id) && (!x.source.startsWith("plugin-") || isOn("plugin:" + x.source.slice(7))))
    .map((x) => ({ name: x.name, description: x.description, text: () => skills.skillText(x) }));
  // «/имя-скилла …» в начале сообщения — инструкции скилла сразу в сообщение
  let text = req.text;
  const slash = /^\/([\wЀ-ӿ-]+)\s*/.exec(text);
  const called = slash && enabledSkills.find((x) => x.name === slash[1].toLowerCase());
  if (called) text = `${text.slice(slash[0].length) || "Follow this skill."}\n\n[The user called the skill /${called.name}. Its instructions:]\n${called.text()}`;
  // вложения: текстовые файлы и длинные вставки — в текст, фото — картинками (если модель их видит)
  // «@файл» — содержимое файла прямо в сообщение
  if (text && text.includes("@")) text = await mentions.expandMentions(s.workspace, text);
  // «на рабочем столе» / «в документах» / «в загрузках»: дописываем реальный путь прямо в сообщение — так модели его не игнорируют
  {
    const where = [];
    if (/рабоч\w*\s+стол|на\s+стол[еу]\b|desktop/i.test(req.text || "")) where.push(`Desktop = ${app.getPath("desktop")}`);
    if (/документ|documents/i.test(req.text || "")) where.push(`Documents = ${app.getPath("documents")}`);
    if (/загрузк|downloads/i.test(req.text || "")) where.push(`Downloads = ${app.getPath("downloads")}`);
    if (where.length) text += `\n\n[System note: the user named a place on this PC. Use these absolute paths (not the project folder, not the home folder): ${where.join("; ")}. Create or search there by the full path.]`;
  }
  const att = Array.isArray(req.attachments) ? req.attachments : [];
  for (const a of att.filter((x) => x.kind === "text")) text += `\n\n<file name="${String(a.name).replace(/"/g, "'")}">\n${String(a.text ?? "")}\n</file>`;
  const images = att.filter((x) => x.kind === "image" && /^data:image\/[\w+.-]+;base64,/.test(x.dataUrl || ""));
  if (images.length && !model.vision) text += `\n\n[${images.length} image(s) were attached, but this model can't see images.]`;
  // «Попробовать снова» после ошибки: продолжаем с того же места, новое сообщение не добавляем
  if (!req.resume) s.history.push(
    images.length && model.vision
      ? { role: "user", content: [{ type: "text", text: text || "(image)" }, ...images.slice(0, model.maxImages || 20).map((i) => ({ type: "image_url", image_url: { url: i.dataUrl } }))] }
      : { role: "user", content: text }
  );

  // коннекторы: подключаем включённые (готовые подключения переиспользуются)
  let extraTools = [];
  const conns = allConnectors().filter((c) => c.enabled);
  if (conns.length && !p.noTools) {
    const r = await mcp.agentTools(conns);
    extraTools = r.tools;
    if (r.errors.length) ev({ type: "notice", text: "Не подключились коннекторы: " + r.errors.join("; ") });
  }

  let reqSeq = 0;
  try {
    await runAgent({
      skills: p.noTools ? [] : enabledSkills,
      extraTools,
      provider: p,
      key: keyFor(p),
      model: model.id,
      modelName: model.name,
      ownApi: p.id !== "xromax-free",
      history: s.history,
      workspace: s.workspace,
      access: req.access || "auto",
      ultra: !!req.ultra && !p.noTools,
      // UltraCode усиливает мышление: если уровень не выбран, берём High
      thinking: req.ultra && (!req.thinking || req.thinking === "default") ? "high" : req.thinking || "default",
      // примерное местоположение: только часовой пояс и регион Windows — если не выключено в «Конфиденциальности»
      region: settings.prefs.shareRegion === false ? null : regionInfo(),
      maxParallel: settings.prefs.maxParallel,
      folders: { desktop: app.getPath("desktop"), documents: app.getPath("documents"), downloads: app.getPath("downloads") },
      customAgents: settings.prefs.customAgents || [],
      superSaver: !!settings.prefs.superSaver,
      fast: !!req.fast && p.kind === "chatgpt", // быстрый режим — только для подписки ChatGPT
      onImage: p.noTools ? null : async (a) => {
        const reqId = `${req.id}:img${++reqSeq}`;
        const providers = [];
        if (chatgpt.isLoggedIn()) providers.push({ id: "chatgpt", name: "ChatGPT (подписка)", note: "Тратит лимиты подписки", qualities: [["low", "Быстро"], ["medium", "Средне"], ["high", "Максимум"]] });
        if (accountToken()) providers.push({ id: "xromax", name: "XroMax (бесплатно)", note: "До 20 картинок в сутки", qualities: [] });
        if (!providers.length) return "Image generation is unavailable: the user must sign in to XroMax or connect ChatGPT (Settings → Providers).";
        const choice = await new Promise((resolve) => {
          pendingImage.set(reqId, resolve);
          ev({ type: "image_choice", reqId, prompt: String(a.prompt || "").slice(0, 2000), providers });
          ctrl.signal.addEventListener("abort", () => resolve(null), { once: true });
        });
        pendingImage.delete(reqId);
        if (!choice || !choice.prompt) {
          ev({ type: "image_done", reqId, error: "Отменено" });
          return "The user cancelled image generation. Don't retry unless asked.";
        }
        ev({ type: "image_start", reqId, prompt: choice.prompt });
        try {
          const src = choice.provider === "chatgpt" ? await chatgpt.generateImage({ prompt: choice.prompt, quality: choice.quality, signal: ctrl.signal }) : await xromaxImage(choice.prompt, ctrl.signal);
          const ext = /^data:image\/(\w+)/.exec(src)?.[1] || "png";
          const dir = path.join(s.workspace || app.getPath("pictures"), "generated-images");
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `image-${Date.now()}.${ext}`);
          fs.writeFileSync(file, Buffer.from(src.slice(src.indexOf(",") + 1), "base64"));
          ev({ type: "image_done", reqId, src, path: file });
          return `Image generated and saved to ${file}. It is already shown to the user in the chat.`;
        } catch (e) {
          const msg = String(e.message || e).slice(0, 200);
          ev({ type: "image_done", reqId, error: msg });
          return `Image generation failed: ${msg}`;
        }
      },
      onCreateAgent: p.noTools ? null : saveCustomAgent,
      signal: ctrl.signal,
      ctx: { trash: (pth) => shell.trashItem(pth) },
      approve: (r) =>
        new Promise((resolve) => {
          const reqId = `${req.id}:${++reqSeq}`;
          pendingApprovals.set(reqId, resolve);
          ev({ type: "approval", reqId, ...r });
          notify("approval", T("XroMax Code — нужно разрешение"), T("{0}: агент ждёт вашего ответа", s.title));
          ctrl.signal.addEventListener("abort", () => resolve("deny"), { once: true });
        }),
      ev: (e) => {
        if (e.type === "usage") {
          const cost = addSpend(s, model, e.usage);
          s.stats.contextTokens = (e.usage.input ?? 0) + (e.usage.cacheRead ?? 0) + (e.usage.cacheWrite ?? 0) + (e.usage.output ?? 0);
          ev({ type: "usage", cost, stats: s.stats, context: model.context || 128_000, totalSpentUsd: settings.totalSpentUsd });
          return;
        }
        // расход субагентов приходит отдельным событием usage — внутри subagent_event его не считаем
        ev(e);
      },
    });
    ev({ type: "finished", ok: true });
    notify("done", T("XroMax Code — готово"), T("{0}: агент закончил", s.title));
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    // повторять имеет смысл обрыв и сбой сервера; ключ/лимит/неверный запрос — нет
    const st = Number(e.status) || 0;
    ev({ type: "finished", ok: aborted, stopped: aborted, error: aborted ? null : String(e.message || e).slice(0, 500), status: e.status ?? null, retryable: !st || st === 408 || st === 429 || st >= 500 });
    if (!aborted) notify("error", T("XroMax Code — ошибка"), T("{0}: {1}", s.title, String(e.message || e).slice(0, 120)));
  } finally {
    running.delete(req.id);
    s.updatedAt = Date.now();
    await writeSession(s).catch(() => {});
    backups.push(s.id);
  }
  return { ok: true };
});

// ───────── субагенты пользователя (встроенный плагин «Команда субагентов», всегда включён) ─────────
const agentName = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
function saveCustomAgent(d) {
  const name = agentName(d.name);
  if (!name) throw new Error("нужно имя (латиница, цифры, дефисы)");
  if (!String(d.prompt || "").trim()) throw new Error("пустые инструкции");
  const list = (settings.prefs.customAgents || []).filter((a) => a.name !== name);
  const def = { name, description: String(d.description || "").slice(0, 300), prompt: String(d.prompt).slice(0, 20000), enabled: d.enabled !== false };
  settings.prefs.customAgents = [...list, def];
  saveSettings();
  send("prefs:changed", settings.prefs);
  return def;
}
ipcMain.handle("agents:save", (_e, d) => {
  try {
    return { ok: true, agent: saveCustomAgent(d), prefs: settings.prefs };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle("agents:remove", (_e, name) => {
  settings.prefs.customAgents = (settings.prefs.customAgents || []).filter((a) => a.name !== name);
  saveSettings();
  return { prefs: settings.prefs };
});
// ИИ пишет «обучение» (инструкции) субагента по короткому описанию
ipcMain.handle("agents:generate", async (_e, { idea, modelRef }) => {
  const p = providerById(modelRef?.provider);
  if (!p) return { ok: false, error: "Сначала выберите модель" };
  const model = findModel(modelRef) ?? { id: modelRef.model };
  try {
    const r = await require("./core/llm").complete({
      provider: p,
      key: keyFor(p),
      model: model.id,
      system:
        "You design specialist sub-agents for a coding agent. Reply with ONLY a JSON object: {\"name\":\"short-latin-dashes\",\"description\":\"one line: what it does and when to call it\",\"instructions\":\"detailed system instructions: role, expertise, working rules, quality bar, report format\"}. Write description and instructions in the language of the user's idea.",
      history: [{ role: "user", content: String(idea || "").slice(0, 4000) }],
      tools: [],
      thinking: "low",
    });
    const m = String(r.content || "").match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : "{}");
    if (!j.instructions) return { ok: false, error: "Модель не вернула инструкции — попробуйте ещё раз" };
    return { ok: true, name: agentName(j.name), description: String(j.description || ""), prompt: String(j.instructions) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
});

ipcMain.handle("agent:compress", async (_e, { id, modelRef }) => {
  const s = await getSession(id);
  const p = providerById(modelRef?.provider);
  if (!s || !p || s.history.length < 3) return { ok: false, error: "Нечего сжимать" };
  const model = findModel(modelRef) ?? { id: modelRef.model, context: 128_000 };
  try {
    const c = await compressHistory({ provider: p, key: keyFor(p), model: model.id, history: s.history });
    s.history = c.history;
    addSpend(s, model, c.usage);
    s.stats.contextTokens = Math.ceil(c.history.reduce((n, m) => n + String(typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")).length, 0) / 3.5);
    await writeSession(s);
    return { ok: true, stats: s.stats, totalSpentUsd: settings.totalSpentUsd, ratio: c.ratio };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }
});
