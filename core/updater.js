// XroMax Code: автообновления. Лента — https://xromax-ai.defhosting.com/downloads/code/ (latest.yml).
// Новая версия → в правом верхнем углу кнопка «Скачать» → загрузка с процентами → проверка нашей подписи
// (Ed25519, ключ встроен в приложение) → приложение само перезапускается уже обновлённым.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { verifyUpdateSignature } = require("./update-sign");

const FEED = "https://xromax-ai.defhosting.com/downloads/code/";

function createUpdater(send) {
  let state = { state: "idle" };
  let autoUpdater = null;
  let pending = null; // UpdateInfo
  let checking = false;
  const set = (s) => {
    state = s;
    send(s);
  };
  const publicKey = () => fs.readFileSync(path.join(__dirname, "..", "signing", "update-public.pem"), "utf8");

  async function checkSignature(version, file) {
    try {
      const res = await fetch(new URL(`XroMax-Code-Setup-${version}.exe.v1.sig`, FEED).toString(), { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return false;
      const sig = (await res.text()).slice(0, 2000);
      return await verifyUpdateSignature(file, version, sig, publicKey(), app.getVersion());
    } catch {
      return false;
    }
  }

  function setup() {
    if (!app.isPackaged && !process.env.XC_UPDATE_TEST) return; // в разработке обновлений нет
    try {
      autoUpdater = require("electron-updater").autoUpdater;
    } catch {
      return;
    }
    autoUpdater.autoDownload = false; // качаем по кнопке «Скачать»
    autoUpdater.autoInstallOnAppQuit = false; // ставим только после проверки подписи
    autoUpdater.disableDifferentialDownload = true;
    if (process.env.XC_UPDATE_TEST) autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.on("update-available", (i) => {
      pending = i;
      set({ state: "available", version: i.version, name: i.releaseName || i.version });
    });
    autoUpdater.on("update-not-available", () => set({ state: "none" }));
    autoUpdater.on("download-progress", (p) => set({ state: "downloading", version: pending?.version, name: pending?.releaseName, percent: Math.round(p.percent || 0) }));
    autoUpdater.on("update-downloaded", async (i) => {
      set({ state: "verifying", version: i.version });
      const file = i.downloadedFile;
      const good = await checkSignature(i.version, file);
      if (!good) {
        try {
          if (file) fs.unlinkSync(file);
        } catch {}
        return set({ state: "error", message: "Проверка подписи обновления не пройдена — обновление не установлено." });
      }
      set({ state: "restarting", version: i.version });
      if (process.env.XC_UPDATE_DRY) return; // тест: всё проверено, но не ставим
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 900); // тихая установка и автозапуск
    });
    autoUpdater.on("error", (e) => {
      const msg = String(e?.message || e).split("\n")[0].slice(0, 200);
      if (/\b404\b/.test(msg)) return set({ state: "none" });
      if (state.state === "downloading" || state.state === "verifying") set({ state: "error", message: "Не удалось скачать обновление: " + msg });
      else set({ state: "none" });
    });
    setTimeout(check, 8000);
    // проверка каждые 35 секунд, пока приложение открыто (файл latest.yml крошечный)
    setInterval(check, 35_000);
  }
  function check() {
    if (!autoUpdater || checking || ["downloading", "verifying", "restarting"].includes(state.state)) return;
    checking = true;
    autoUpdater.checkForUpdates().catch(() => {}).finally(() => (checking = false));
  }
  function download() {
    if (!autoUpdater || !pending) return;
    set({ state: "downloading", version: pending.version, percent: 0 });
    autoUpdater.downloadUpdate().catch((e) => set({ state: "error", message: "Не удалось скачать обновление: " + String(e?.message || e).slice(0, 160) }));
  }
  return { setup, check, download, get: () => state };
}

module.exports = { createUpdater, FEED };
