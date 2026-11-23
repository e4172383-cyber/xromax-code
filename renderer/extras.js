// XroMax Code — вход через сайт, обновления, страница плагинов, команды «/», вложения, аккаунт и копии чатов.
"use strict";

// ───────────────────────── вход через сайт ─────────────────────────
const signinBox = () => $("#signin");
let signinState = null;
function showSignin(note) {
  const box = signinBox();
  box.classList.remove("hidden");
  box.innerHTML = `<div class="si-box"><div id="si-logo"></div><h2>Войдите в XroMax Code</h2><p>Вход — через сайт XroMax. Бесплатные встроенные модели и копии чатов в аккаунте появятся сразу после входа.</p>
    ${note ? `<div class="err" style="margin-bottom:14px">${esc(note)}</div>` : ""}
    <div class="si-btns"><button class="si-btn primary" id="si-start">Войти через сайт</button></div>
    <div class="si-small">Сайт: <a data-site>xromax-ai.defhosting.com</a></div></div>`;
  $("#si-logo").innerHTML = $("#logo").innerHTML;
  $("#si-start").onclick = startSignin;
  box.querySelector("[data-site]").onclick = () => window.xc.openExternal("https://xromax-ai.defhosting.com");
}
async function startSignin() {
  const box = signinBox();
  const b = $("#si-start");
  b.textContent = "Подождите…";
  const r = await window.xc.auth.start();
  if (!r.ok) return showSignin("Не удалось связаться с сайтом: " + r.error);
  signinState = r;
  box.querySelector(".si-box").innerHTML = `<div id="si-logo"></div><h2>Подтвердите вход на сайте</h2><p>Войдите в браузере и введите там этот код:</p>
    <div class="si-code">${esc(r.code)}</div>
    <div class="si-btns">${r.providers.map((p) => `<button class="si-btn ${p.id === "github" ? "primary" : ""}" data-url="${esc(p.url)}">Войти через ${esc(p.name)}</button>`).join("")}</div>
    <div class="si-wait">Ждём подтверждения на сайте…</div>
    <div class="si-small"><a data-cancel>Начать заново</a></div>`;
  $("#si-logo").innerHTML = $("#logo").innerHTML;
  box.querySelectorAll("[data-url]").forEach((x) => (x.onclick = () => window.xc.auth.open(x.dataset.url)));
  box.querySelector("[data-cancel]").onclick = () => {
    window.xc.auth.cancel();
    showSignin();
  };
}
// ───────────────────────── лимиты тарифа (общие с сайтом) ─────────────────────────
const fmtReset = (ts) => {
  if (!ts) return "ещё не начался";
  const ms = ts - Date.now();
  if (ms <= 0) return "сбросится сейчас";
  const m = Math.round(ms / 60000);
  if (m < 60) return `сброс через ${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 48) return `сброс через ${h} ч ${m % 60} мин`;
  return "сброс " + new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
};
// лимиты тарифа: жёлтый с 75%, красный с 90%
const limState = (p) => (p >= 90 ? "full" : p >= 75 ? "warn" : "");
/** Какие лимиты показывать: тариф сайта (если есть модели «по тарифу») или общие лимиты XroMax 2.5 (5 часов / неделя) */
function currentLimits() {
  // выбрана модель ChatGPT (подписка) — показываем лимиты подписки, а не XroMax
  if (cur()?.modelRef?.provider === "chatgpt") return app.gptLimits ? { L: app.gptLimits, title: "Лимиты подписки ChatGPT" } : null;
  const anyPlan = app.catalog?.some((g) => g.models?.some((m) => m.plan));
  if (anyPlan && app.account?.limits) return { L: app.account.limits, title: "Лимиты XroMax" };
  const T = app.account?.tests ? Object.values(app.account.tests)[0] : null;
  if (T && typeof T.pct5h === "number") return { L: T, title: "Лимиты XroMax 2.5" };
  return null;
}
/** «5 ч: 12% · сброс через 3 ч · нед: 40% · сброс 28 ноября» */
window.gptLimitsText = (L) => `Лимиты подписки · 5 часов: ${Math.round(L.pct5h)}% (${fmtReset(L.reset5h)}) · неделя: ${Math.round(L.pctWeek)}% (${fmtReset(L.resetWeek)})`;
function renderLimits() {
  const btn = $("#limits-btn");
  const cl = currentLimits();
  if (!cl) return btn.classList.add("hidden");
  const L = cl.L;
  btn.classList.remove("hidden");
  window.__limFill?.(); // открытое окошко лимитов обновляется само
  for (const [id, p] of [["lim5", L.pct5h], ["limW", L.pctWeek]]) {
    const b = $("#" + id);
    b.style.setProperty("--p", Math.min(100, Math.round(p)) + "%");
    b.parentElement.className = "lim " + limState(p);
  }
  btn.title = `${cl.title}: 5 часов — ${Math.round(L.pct5h)}%, неделя — ${Math.round(L.pctWeek)}%`;
}
// «на сколько хватит» — отдельно под выбранную модель (считает сайт по вашему реальному расходу)
const BASIS = { app: "по вашим запросам в приложении", model: "по вашим запросам к этой модели", all: "по вашим запросам на сайте", default: "по среднему расходу — точнее станет после нескольких запросов" };
const fmtReq = (n) => (n >= 1000 ? "1000+" : String(n));
window.estimateFor = (provId, modelId) => (provId === "xromax-free" ? app.account?.estimates?.[modelId] ?? null : null);
function modelEstimateHtml() {
  const ref = cur()?.modelRef;
  const { model } = findModel(ref);
  if (!model) return "";
  const est = estimateFor(ref.provider, ref.model);
  const head = `<div class="est-t">Выбрана: <b>${esc(model.name)}</b></div>`;
  if (ref.provider !== "xromax-free") return `<div class="est">${head}<small>Свой API — лимиты XroMax не тратятся, расход у вашего поставщика</small></div>`;
  if (!est && app.account?.tests?.[ref.model]) return `<div class="est">${head}<small>Эта модель использует лимиты XroMax 2.5: 5 часов и неделя (общие для Helium и Xenon)</small></div>`;
  if (!est) return `<div class="est">${head}<small>Эта модель без лимитов</small></div>`;
  const cell = (n, label) => `<div class="c ${n === 0 ? "zero" : ""}"><b>≈ ${fmtReq(n)}</b><span>запросов ${label}</span></div>`;
  return `<div class="est">${head}<div class="cells">${cell(est.left5h, "до конца 5 часов")}${cell(est.leftWeek, "до конца недели")}</div><small>Один запрос ≈ ${est.pctPer}% 5-часового лимита · ${BASIS[est.basis] || ""}</small></div>`;
}
function limitsPopover() {
  if (document.querySelector(".lim-pop")) return document.querySelector(".lim-pop").remove(); // повторное нажатие закрывает
  if (!currentLimits()) return;
  const row = (title, p, reset) =>
    `<div class="r ${limState(p)}"><div class="top"><b>${title}</b><span>${Math.round(p)}% использовано</span></div><div class="bar"><i style="width:${Math.min(100, p)}%"></i></div><small>${fmtReset(reset)}</small></div>`;
  const box = document.createElement("div");
  box.className = "menu lim-pop";
  // содержимое перерисовывается при каждом обновлении лимитов и смене модели, пока окошко открыто
  const fill = () => {
    const cl = currentLimits();
    if (!cl) return box.remove();
    const L = cl.L;
    box.innerHTML = `<h5>${esc(cl.title)}</h5>${row("5 часов", L.pct5h, L.reset5h)}${row("Неделя", L.pctWeek, L.resetWeek)}${modelEstimateHtml()}`;
  };
  fill();
  window.__limFill = fill;
  box.addEventListener("remove", () => (window.__limFill = null));
  document.body.appendChild(box);
  const r = $("#limits-btn").getBoundingClientRect();
  box.style.top = r.bottom + 6 + "px";
  box.style.left = Math.min(r.left, innerWidth - box.offsetWidth - 8) + "px";
  const close = (e) => {
    if (!box.contains(e.target) && !e.target.closest("#limits-btn")) {
      box.remove();
      window.__limFill = null;
      document.removeEventListener("mousedown", close);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
}
// после ответа XroMax-модели и раз в минуту — свежие лимиты с сайта
window.refreshGptLimits = async () => {
  if (cur()?.modelRef?.provider !== "chatgpt") return;
  try {
    app.gptLimits = await window.xc.chatgpt.limits();
  } catch {}
  renderLimits();
};
window.refreshLimits = () => (window.refreshGptLimits(), window.xc.auth.refresh());
setInterval(() => (window.refreshGptLimits(), app.account && window.xc.auth.refresh()), 60_000);

/** Обязательное обновление: версия ниже минимальной — пользоваться нельзя, пока не обновишь */
function showUpdateRequired(p) {
  let el = document.getElementById("upd-required");
  if (!p) {
    window.__policyUpd = null;
    return el?.remove();
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "upd-required";
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="ban-box"><div class="ban-ico">⬆</div><h2>Нужно обновить XroMax Code</h2><p>Ваша версия ${esc(p.current)} устарела — нужна ${esc(p.minDisplay)} или новее. Пока приложение не обновлено, пользоваться им нельзя.</p>${p.note ? `<p><b>${esc(p.note)}</b></p>` : ""}<div class="ban-act"><button class="btn primary" data-upd>Обновить сейчас</button>${p.download ? '<button class="btn" data-site>Скачать с сайта</button>' : ""}</div><small data-st>Обновление скачается и установится само, приложение перезапустится.</small></div>`;
  const st = el.querySelector("[data-st]");
  const btn = el.querySelector("[data-upd]");
  window.__policyUpd = (s) => {
    if (!s) return;
    if (s.state === "available") st.textContent = `Доступна версия ${s.name || s.version} — нажмите «Обновить сейчас».`;
    if (s.state === "downloading") ((st.textContent = `Скачивание ${s.percent ?? 0}%…`), (btn.disabled = true));
    if (s.state === "verifying") st.textContent = "Проверка подписи…";
    if (s.state === "restarting") st.textContent = "Перезапуск…";
    if (s.state === "error") ((st.textContent = (s.message || "Не получилось обновиться") + " — скачайте установщик с сайта."), (btn.disabled = false));
  };
  btn.onclick = async () => {
    btn.disabled = true;
    st.textContent = "Проверяю обновление…";
    const s = await window.xc.update.get();
    if (s?.state === "available") return window.xc.update.download();
    await window.xc.update.check();
    setTimeout(async () => {
      const s2 = await window.xc.update.get();
      if (s2?.state === "available") window.xc.update.download();
      else ((btn.disabled = false), (st.textContent = "Обновление пока не найдено — скачайте установщик с сайта."));
    }, 4000);
  };
  el.querySelector("[data-site]")?.addEventListener("click", () => window.xc.openExternal(p.download));
}
/** Экран блокировки: аккаунт заблокирован за попытки обойти приложение — пользоваться нельзя, можно подать апелляцию */
function showBanned(b) {
  let el = document.getElementById("ban-screen");
  if (!b) return el?.remove();
  if (!el) {
    el = document.createElement("div");
    el.id = "ban-screen";
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="ban-box"><div class="ban-ico">⛔</div><h2>Аккаунт заблокирован</h2><p>${esc(b.message)}</p><div class="ban-act">${b.appealUrl ? '<button class="btn primary" data-appeal>Подать апелляцию на сайте</button>' : ""}<button class="btn" data-recheck>Проверить снова</button></div><small>После рассмотрения апелляции доступ вернётся сам — нажмите «Проверить снова».</small></div>`;
  el.querySelector("[data-appeal]")?.addEventListener("click", () => window.xc.openExternal(b.appealUrl));
  el.querySelector("[data-recheck]").addEventListener("click", () => window.xc.auth.refresh());
}
function onAuth(acc) {
  showBanned(acc?.banned || null);
  if (acc && acc.user) {
    app.account = acc;
    signinBox().classList.add("hidden");
    signinBox().innerHTML = "";
    reloadCatalog();
    renderLimits();
  } else {
    renderLimits();
    app.account = null;
    showSignin(acc?.expired ? "Время на вход вышло — начните заново." : "");
  }
}

// ───────────────────────── обновления ─────────────────────────
// Плавный индикатор обновления: один элемент на всё время, проценты и полоса «догоняют» плавно,
// смена этапов (скачивание → проверка → перезапуск) — мягкой сменой подписи, без перерисовки и мигания.
const updAnim = { shown: 0, target: 0, raf: 0 };
function tweenUpd() {
  const el = document.querySelector("#update-slot .upd.busy");
  if (!el) return (updAnim.raf = 0);
  updAnim.shown += (updAnim.target - updAnim.shown) * 0.12; // плавное «догоняние»
  if (Math.abs(updAnim.target - updAnim.shown) < 0.05) updAnim.shown = updAnim.target;
  el.style.setProperty("--p", updAnim.shown.toFixed(2) + "%");
  const n = el.querySelector(".pct");
  if (n) n.textContent = Math.round(updAnim.shown) + "%";
  updAnim.raf = updAnim.shown === updAnim.target ? 0 : requestAnimationFrame(tweenUpd);
}
function setUpdLabel(el, text) {
  const lab = el.querySelector(".lab");
  if (lab.dataset.t === text) return;
  lab.dataset.t = text;
  lab.classList.add("swap");
  setTimeout(() => {
    lab.firstChild.textContent = text;
    lab.classList.remove("swap");
  }, 180);
}
function renderUpdate(s) {
  const slot = $("#update-slot");
  if (!s || ["idle", "none", "checking"].includes(s.state)) return (slot.innerHTML = "");
  if (s.state === "available") {
    slot.innerHTML = `<button class="upd avail" title="Скачать обновление — приложение само перезапустится"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M6 10l6 6 6-6M5 20h14"/></svg>Обновление ${esc(s.name || s.version)} · Скачать</button>`;
    slot.firstChild.onclick = () => window.xc.update.download();
    return;
  }
  if (s.state === "error") {
    slot.innerHTML = `<span class="upd err" title="${esc(s.message || "")}">Обновление не удалось</span>`;
    return;
  }
  // скачивание / проверка / перезапуск — один и тот же элемент
  let el = slot.querySelector(".upd.busy");
  if (!el) {
    slot.innerHTML = `<span class="upd busy" style="--p:0%"><span class="fill"></span><span class="spin"></span><span class="lab">Скачивание<span class="pct">0%</span></span></span>`;
    el = slot.firstChild;
    updAnim.shown = 0;
    updAnim.target = 0;
  }
  el.dataset.stage = s.state;
  if (s.state === "downloading") {
    setUpdLabel(el, "Скачивание ");
    updAnim.target = Math.max(updAnim.target, Math.min(100, s.percent ?? 0));
  } else {
    updAnim.target = 100;
    setUpdLabel(el, s.state === "verifying" ? "Проверка подписи… " : "Перезапуск… ");
  }
  const pct = el.querySelector(".pct");
  pct.style.display = s.state === "downloading" ? "" : "none";
  if (!updAnim.raf) updAnim.raf = requestAnimationFrame(tweenUpd);
}

// ───────────────────────── вложения ─────────────────────────
const TEXT_EXT = /\.(txt|md|markdown|json|jsonc|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cs|php|swift|sql|html?|css|scss|less|xml|yml|yaml|toml|ini|cfg|conf|env|sh|bash|ps1|bat|cmd|csv|tsv|log|vue|svelte|astro|gradle|dockerfile|gitignore|lua|r|dart|ex|exs|scala|zig|tex|srt)$/i;
const LONG_PASTE = 1500; // символов — длинная вставка становится блоком-файлом, как на сайте
const MAX_FILE = 2_000_000;
const MAX_IMAGE = 8_000_000;
const attachments = [];
const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + " МБ" : n > 1e3 ? Math.round(n / 1e3) + " КБ" : n + " Б");

function attHtml(a, i) {
  if (a.kind === "image") return `<div class="att img" title="${esc(a.name)}"><img src="${a.thumb}" alt=""><button class="rm" data-i="${i}">×</button></div>`;
  const ext = (a.name.split(".").pop() || "txt").slice(0, 4);
  return `<div class="att" title="${esc(a.name)}"><span class="fi">${esc(a.pasted ? "txt" : ext)}</span><span style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="sz">${a.lines} строк · ${fmtSize(a.size)}</div></span><button class="rm" data-i="${i}">×</button></div>`;
}
function renderAttachments() {
  const box = $("#attachments");
  box.innerHTML = attachments.map(attHtml).join("");
  box.querySelectorAll(".rm").forEach((b) => (b.onclick = () => (attachments.splice(Number(b.dataset.i), 1), renderAttachments(), updateSend())));
  updateSend();
}
function thumbOf(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 160 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
const readAs = (file, how) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    how === "url" ? r.readAsDataURL(file) : r.readAsText(file);
  });
async function addFiles(files) {
  for (const f of files) {
    if (attachments.length >= 200) return toast("Не больше 200 вложений за раз");
    if (f.type.startsWith("image/")) {
      if (f.size > MAX_IMAGE) {
        toast(`«${f.name}» больше 8 МБ — уменьшите фото`);
        continue;
      }
      const dataUrl = await readAs(f, "url");
      attachments.push({ kind: "image", name: f.name || "фото.png", size: f.size, dataUrl, thumb: await thumbOf(dataUrl) });
    } else if (TEXT_EXT.test(f.name) || f.type.startsWith("text/") || /json|xml|javascript/.test(f.type)) {
      if (f.size > MAX_FILE) {
        toast(`«${f.name}» больше 2 МБ — слишком большой для сообщения`);
        continue;
      }
      const text = await readAs(f, "text");
      attachments.push({ kind: "text", name: f.name, size: f.size, text, lines: text.split("\n").length });
    } else toast(`«${f.name}»: такие файлы пока не прикрепить — только фото и текстовые файлы`);
  }
  renderAttachments();
  $("#input").focus();
}
function addPastedText(text) {
  const n = attachments.filter((a) => a.pasted).length + 1;
  attachments.push({ kind: "text", pasted: true, name: `Вставленный текст ${n}`, size: new Blob([text]).size, text, lines: text.split("\n").length });
  renderAttachments();
}
// для app.js: забрать вложения при отправке
window.xcAttach = {
  has: () => attachments.length > 0,
  take: () => attachments.splice(0, attachments.length).map((a) => (renderAttachments(), a)),
};

function wireAttachments() {
  $("#attach-btn").onclick = () => $("#file-input").click();
  $("#file-input").onchange = (e) => {
    addFiles([...e.target.files]);
    e.target.value = "";
  };
  $("#input").addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      return addFiles(files);
    }
    const text = e.clipboardData?.getData("text") || "";
    if (text.length > LONG_PASTE) {
      e.preventDefault();
      addPastedText(text);
    }
  });
  let depth = 0;
  const hint = () => $("#drop-hint");
  window.addEventListener("dragenter", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    depth++;
    if (!hint()) document.body.insertAdjacentHTML("beforeend", '<div id="drop-hint">Отпустите, чтобы прикрепить</div>');
  });
  window.addEventListener("dragleave", () => {
    if (--depth <= 0) hint()?.remove();
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    hint()?.remove();
    if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
  });
}

// ───────────────────────── команды «/» ─────────────────────────
let slashItems = [];
let slashKb = 0;
async function slashCommands() {
  const ext = await window.xc.ext.list();
  return [
    { cmd: "compact", desc: "Сжать разговор — освободить контекст" },    ...ext.skills.filter((s) => s.enabled).map((s) => ({ cmd: s.name, desc: s.description })),
  ];
}
// «@путь» перед курсором — подсказки файлов и папок проекта
let mentionSeq = 0;
function mentionAtCaret() {
  const el = $("#input");
  const before = el.value.slice(0, el.selectionStart ?? el.value.length);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  return m ? { q: m[2], start: before.length - m[2].length - 1, end: el.selectionStart ?? el.value.length } : null;
}
async function updateSlash() {
  const v = $("#input").value;
  const menu = $("#slash-menu");
  const at = mentionAtCaret();
  if (at) {
    const seq = ++mentionSeq;
    const list = await window.xc.files.search({ workspace: cur()?.workspace, q: at.q });
    if (seq !== mentionSeq) return; // пока искали, человек печатал дальше
    slashItems = list.map((f) => ({ cmd: f.path, desc: f.dir ? "папка" : f.size != null ? fmtSize(f.size) : "файл", mention: true, dir: f.dir }));
    if (!slashItems.length) return menu.classList.add("hidden");
    slashKb = Math.min(slashKb, slashItems.length - 1);
    menu.innerHTML = slashItems.map((c, i) => `<button class="sl-item mention ${i === slashKb ? "kb" : ""}" data-i="${i}"><b>${c.dir ? "📁" : "📄"} ${esc(c.cmd)}</b><span>${esc(c.desc)}</span></button>`).join("");
    menu.querySelectorAll(".sl-item").forEach((b) => (b.onmousedown = (e) => (e.preventDefault(), pickSlash(Number(b.dataset.i)))));
    menu.querySelector(".kb")?.scrollIntoView({ block: "nearest" });
    return menu.classList.remove("hidden");
  }
  const m = /^\/([\wЀ-ӿ-]*)$/.exec(v);
  if (!m) return menu.classList.add("hidden");
  const all = await slashCommands();
  slashItems = all.filter((c) => c.cmd.startsWith(m[1].toLowerCase()));
  if (!slashItems.length) return menu.classList.add("hidden");
  slashKb = Math.min(slashKb, slashItems.length - 1);
  menu.innerHTML = slashItems.map((c, i) => `<button class="sl-item ${i === slashKb ? "kb" : ""}" data-i="${i}"><b>/${esc(c.cmd)}</b><span>${esc(c.desc || "")}</span></button>`).join("");
  menu.querySelectorAll(".sl-item").forEach((b) => (b.onmousedown = (e) => (e.preventDefault(), pickSlash(Number(b.dataset.i)))));
  menu.classList.remove("hidden");
}
function pickSlash(i) {
  const c = slashItems[i];
  if (!c) return;
  $("#slash-menu").classList.add("hidden");
  if (c.mention) {
    const el = $("#input");
    const at = mentionAtCaret();
    if (!at) return;
    const ins = "@" + (c.cmd.includes(" ") ? `"${c.cmd}"` : c.cmd) + (c.dir ? "/" : " ");
    el.value = el.value.slice(0, at.start) + ins + el.value.slice(at.end);
    const pos = at.start + ins.length;
    el.setSelectionRange(pos, pos);
    el.focus();
    autoGrow();
    updateSend();
    if (c.dir) updateSlash(); // папка — сразу показываем её содержимое
    return;
  }
  if (c.cmd === "compact") {
    $("#input").value = "";
    autoGrow();
    updateSend();
    return compressNow();
  }
  $("#input").value = `/${c.cmd} `;
  $("#input").focus();
  updateSend();
}
function wireSlash() {
  const input = $("#input");
  input.addEventListener("input", () => {
    slashKb = 0;
    updateSlash();
  });
  input.addEventListener(
    "keydown",
    (e) => {
      if ($("#slash-menu").classList.contains("hidden")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        slashKb = (slashKb + (e.key === "ArrowDown" ? 1 : -1) + slashItems.length) % slashItems.length;
        updateSlash();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        pickSlash(slashKb);
      } else if (e.key === "Escape") $("#slash-menu").classList.add("hidden");
    },
    true
  );
}

// ───────────────────────── страница плагинов ─────────────────────────
async function openPlugins() {
  let tab = "all";
  let data = await window.xc.ext.list();
  const box = document.createElement("div");
  box.className = "modal plug";
  box.innerHTML = `<div class="plug-head"><h2>Плагины</h2><div class="plug-bar">
      <label class="plug-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input placeholder="Поиск" /></label>
      <div class="seg"><button data-t="all" class="on">Все</button><button data-t="conn">Коннекторы</button><button data-t="skills">Skills</button></div>
      <button class="btn primary" data-add>Добавить ▾</button></div></div><div class="plug-body"></div>`;
  overlay(box);
  const body = box.querySelector(".plug-body");
  const q = box.querySelector("input");
  box.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => ((tab = b.dataset.t), box.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b)), draw())));
  q.oninput = draw;
  box.querySelector("[data-add]").onclick = (e) =>
    showMenu(
      e.currentTarget,
      [
        { label: "Загрузить скилл", desc: "Папка с SKILL.md, .zip или .md", onClick: () => doImport("skill") },
        { label: "Загрузить плагин", desc: "Папка или .zip с plugin.json (подходят плагины Claude)", onClick: () => doImport("plugin") },
        { label: "Свой коннектор", desc: "MCP-сервер: адрес или команда", onClick: customConnector },
        { label: "Создать скилл в чате", desc: "ИИ сделает скилл по вашему описанию", onClick: () => toChat("/skill-creator ") },
        { label: "Создать плагин в чате", desc: "ИИ соберёт плагин из скиллов и коннекторов", onClick: () => toChat("/plugin-creator ") },
      ],
      { up: false }
    );
  function toChat(prefix) {
    document.querySelector(".overlay")?.remove();
    $("#input").value = prefix;
    autoGrow();
    updateSend();
    $("#input").focus();
  }
  async function doImport(kind) {
    const r = await window.xc.ext.importItem(kind);
    if (r.canceled) return;
    if (!r.ok) return toast(r.error || "Не получилось загрузить");
    data = r.list;
    toast(`${kind === "plugin" ? "Плагин" : "Скилл"} «${r.name}» установлен`);
    draw();
  }
  function customConnector() {
    const f = document.createElement("div");
    f.className = "modal";
    f.style.maxWidth = "560px";
    f.innerHTML = `<div style="padding:20px"><h3 style="margin:0 0 4px">Свой коннектор (MCP)</h3><div class="empty-sm" style="padding:0 0 6px">Удалённый — по адресу, локальный — командой на этом ПК</div>
      <div class="seg" style="width:max-content"><button class="on" data-k="http">По адресу</button><button data-k="stdio">Команда</button></div>
      <div class="form-col"><input class="field" data-n placeholder="Название" />
        <div data-http class="form-col" style="margin:0"><input class="field" data-u placeholder="https://example.com/mcp" /><div style="display:flex;gap:8px"><input class="field" data-hn placeholder="Заголовок (например Authorization)" /><input class="field" data-hv type="password" placeholder="Значение (например Bearer …)" /></div></div>
        <div data-stdio class="form-col hidden" style="margin:0"><input class="field" data-c placeholder="Команда, например npx" /><input class="field" data-a placeholder='Аргументы, например -y @modelcontextprotocol/server-memory' /></div>
      </div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" data-x>Отмена</button><button class="btn primary" data-ok>Подключить</button></div></div>`;
    const close = overlay(f);
    let kind = "http";
    f.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
      kind = b.dataset.k;
      f.querySelectorAll("[data-k]").forEach((x) => x.classList.toggle("on", x === b));
      f.querySelector("[data-http]").classList.toggle("hidden", kind !== "http");
      f.querySelector("[data-stdio]").classList.toggle("hidden", kind !== "stdio");
    }));
    f.querySelector("[data-x]").onclick = close;
    f.querySelector("[data-ok]").onclick = async (e) => {
      const v = (s) => f.querySelector(s).value.trim();
      e.currentTarget.textContent = "Подключаю…";
      const r = await window.xc.ext.addConnector({ name: v("[data-n]"), type: kind, url: v("[data-u]"), headerName: v("[data-hn]"), headerValue: v("[data-hv]"), command: v("[data-c]"), args: v("[data-a]") });
      if (!r.ok) {
        e.currentTarget.textContent = "Подключить";
        return toast("Не подключился: " + r.error, 6000);
      }
      data = r.list;
      close();
      toast(`Коннектор подключён, инструментов: ${r.tools}`);
      draw();
    };
  }
  function connectRecommended(rec) {
    if (!rec.fields?.length) return finish({});
    const f = document.createElement("div");
    f.className = "modal";
    f.style.maxWidth = "520px";
    f.innerHTML = `<div style="padding:20px"><h3 style="margin:0 0 10px">${esc(rec.name)}</h3><div class="form-col">${rec.fields.map((x) => `<input class="field" type="password" data-f="${esc(x.key)}" placeholder="${esc(x.label)}" />`).join("")}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" data-x>Отмена</button><button class="btn primary" data-ok>Подключить</button></div></div>`;
    const close = overlay(f);
    f.querySelector("[data-x]").onclick = close;
    f.querySelector("[data-ok]").onclick = () => {
      const values = {};
      f.querySelectorAll("[data-f]").forEach((i) => (values[i.dataset.f] = i.value.trim()));
      close();
      finish(values);
    };
    async function finish(values) {
      toast(`Подключаю ${rec.name}…${rec.needs ? " (нужен " + rec.needs + ")" : ""}`);
      const r = await window.xc.ext.addConnector({ recommendedId: rec.id, values });
      if (!r.ok) return toast(`${rec.name} не подключился: ${r.error}`, 7000);
      data = r.list;
      toast(`${rec.name} подключён, инструментов: ${r.tools}`);
      draw();
    }
    if (!rec.fields?.length) return;
  }
  function row({ ico, name, badge, sub, on, id, removable }) {
    return `<div class="pl-row"><span class="pl-ico">${esc(ico)}</span><div class="pl-main"><div class="pl-name">${esc(name)}${badge ? `<span class="badge">${esc(badge)}</span>` : ""}</div><div class="pl-sub">${esc(sub || "")}</div></div>
      <button class="toggle ${on ? "on" : ""}" data-tg="${esc(id)}" title="${on ? "Выключить" : "Включить"}"></button>${removable ? `<button class="icon-btn" data-rm="${esc(id)}" title="Удалить">×</button>` : '<span style="width:30px"></span>'}</div>`;
  }
  function draw() {
    const s = q.value.trim().toLowerCase();
    const hit = (...t) => !s || t.join(" ").toLowerCase().includes(s);
    let html = "";
    if (tab !== "conn") {
      const pl = data.plugins.filter((p) => hit(p.name, p.description));
      const sk = data.skills.filter((x) => !x.source.startsWith("plugin-") && hit(x.name, x.description));
      html += `<div class="plug-sec"><h4>Ваши плагины и скиллы</h4>`;
      html += pl.map((p) => row({ ico: "P", name: p.name, badge: p.version ? "v" + p.version : "", sub: `${p.description || "Плагин"} · скиллов: ${p.skills}, коннекторов: ${p.connectors}`, on: p.enabled, id: p.id, removable: true })).join("");
      html += sk.map((x) => row({ ico: "/", name: "/" + x.name, badge: x.source === "builtin" ? "Встроенный" : "", sub: x.description, on: x.enabled, id: x.id, removable: x.source === "user" })).join("");
      if (tab === "all" || tab === "skills") html += row({ ico: "/", name: "/compact", badge: "Встроенная команда", sub: "Сжать разговор — освободить контекст", on: true, id: "cmd:compact" }).replace(/<button class="toggle[^>]*><\/button>/, "<span></span>");
      if (!pl.length && !sk.length) html += `<div class="empty-sm">Ничего не найдено</div>`;
      html += `</div>`;
    }
    if (tab !== "skills") {
      const own = data.connectors.filter((c) => hit(c.name));
      html += `<div class="plug-sec"><h4>Подключённые коннекторы</h4>${own.length ? own.map((c) => row({ ico: c.type === "http" ? "↗" : ">_", name: c.name, badge: c.source === "plugin" ? "из плагина" : c.source === "recommended" ? "" : "свой", sub: c.type === "http" ? c.url : `${c.command} ${(c.args || []).join(" ")}`, on: c.enabled, id: c.id, removable: c.source !== "plugin" })).join("") : '<div class="empty-sm">Пока нет — подключите рекомендуемый ниже или свой через «Добавить»</div>'}</div>`;
      const rec = data.recommended.filter((r) => !r.installed && hit(r.name, r.description));
      if (rec.length) html += `<div class="plug-sec"><h4>Рекомендуемые коннекторы</h4><div class="rec-grid">${rec.map((r) => `<div class="pl-row"><span class="pl-ico">${esc(r.name[0])}</span><div class="pl-main"><div class="pl-name">${esc(r.name)}</div><div class="pl-sub">${esc(r.description)}${r.needs ? " · нужен " + esc(r.needs) : ""}</div></div><button class="btn" data-rec="${esc(r.id)}">Подключить</button></div>`).join("")}</div></div>`;
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-tg]").forEach((b) => (b.onclick = async () => ((data = await window.xc.ext.toggle({ id: b.dataset.tg, on: !b.classList.contains("on") })), draw())));
    body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => ((data = await window.xc.ext.remove(b.dataset.rm)), draw())));
    body.querySelectorAll("[data-rec]").forEach((b) => (b.onclick = () => connectRecommended(data.recommended.find((r) => r.id === b.dataset.rec))));
  }
  draw();
  q.focus();
}

// ───────────────────────── боковая панель: аккаунт, сессии, копии ─────────────────────────
async function renderSidebar() {
  const sb = $("#sidebar");
  const list = await window.xc.sessions.list();
  const a = app.account?.user;
  sb.innerHTML = a
    ? `<div class="acc">${a.picture ? `<img src="${esc(a.picture)}" alt="">` : `<span class="av">${esc((a.name || "?")[0])}</span>`}<div class="who">${esc(a.name)}<small>${esc(a.email || "")}</small></div><button class="icon-btn" data-logout title="Выйти">⎋</button></div>`
    : "";
  if (document.documentElement.classList.contains("layout-side")) {
    sb.insertAdjacentHTML("beforeend", `<button class="side-new" data-new>+ Новая сессия</button>`);
    sb.querySelector("[data-new]").onclick = () => (newTab(), renderSidebar());
  }
  sb.insertAdjacentHTML("beforeend", `<h4>Сессии</h4>`);
  // текущая сессия ещё не сохранена (пустая) — её в списке с диска нет
  const curS = cur();
  if (curS && !list.some((x) => x.id === curS.id) && curS.items.length) list.unshift({ id: curS.id, title: curS.title, workspace: curS.workspace, updatedAt: Date.now() });
  if (!list.length) sb.insertAdjacentHTML("beforeend", '<div class="empty-note">Пока нет сессий</div>');
  for (const it of list) {
    const r = document.createElement("div");
    r.className = "side-row" + (it.id === app.active ? " on" : "");
    r.innerHTML = `<button class="side-item">${esc(it.title || "Сессия")}<small>${esc(baseName(it.workspace))} · ${new Date(it.updatedAt || 0).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></button><button class="side-del" title="Удалить с этого ПК">×</button>`;
    r.querySelector(".side-item").onclick = () => openSessionTab(it.id);
    r.querySelector(".side-del").onclick = async () => {
      if (!confirm(`Удалить «${it.title || "Сессия"}» с этого ПК?\nКопия останется в вашем аккаунте XroMax — её можно вернуть кнопкой «Из аккаунта».`)) return;
      if (app.tabs.includes(it.id)) closeTab(it.id);
      app.sessions.delete(it.id);
      await window.xc.sessions.remove(it.id);
      renderSidebar();
    };
    sb.appendChild(r);
  }
  if (a) {
    sb.insertAdjacentHTML("beforeend", `<h4 style="margin-top:16px">Копии в аккаунте</h4><button class="side-item" data-cloud>Показать чаты из аккаунта…</button><div data-cloud-list></div>`);
    sb.querySelector("[data-cloud]").onclick = async (e) => {
      e.currentTarget.textContent = "Загружаю…";
      const r = await window.xc.backup.list();
      const box = sb.querySelector("[data-cloud-list]");
      e.currentTarget.remove();
      if (!r.ok) return (box.innerHTML = `<div class="empty-note">${esc(r.error)}</div>`);
      const missing = r.sessions.filter((x) => !x.local);
      box.innerHTML = missing.length ? "" : '<div class="empty-note">Все копии уже есть на этом ПК</div>';
      for (const x of missing) {
        const b = document.createElement("button");
        b.className = "side-item";
        b.innerHTML = `${esc(x.title)}<small>вернуть на ПК · ${new Date(x.updatedAt).toLocaleDateString("ru-RU")}</small>`;
        b.onclick = async () => {
          const res = await window.xc.backup.restore(x.id);
          if (!res.ok) return toast("Не получилось: " + res.error);
          toast("Чат возвращён");
          await openSessionTab(res.id);
          renderSidebar();
        };
        box.appendChild(b);
      }
    };
  }
  sb.querySelector("[data-logout]")?.addEventListener("click", () => window.xc.auth.logout());
}
async function toggleSidebar2() {
  const h = document.documentElement;
  const sb = $("#sidebar");
  // макет «Сессии сбоку»: ☰ скрывает и показывает закреплённую панель (запоминается)
  if (h.classList.contains("layout-side")) {
    const collapse = !h.classList.contains("side-collapsed");
    h.classList.toggle("side-collapsed", collapse);
    try {
      localStorage.setItem("xc.sideCollapsed", collapse ? "1" : "");
    } catch {}
    if (!collapse) {
      await renderSidebar();
      sb.classList.remove("hidden");
    }
    return;
  }
  if (!sb.classList.contains("hidden")) return sb.classList.add("hidden");
  await renderSidebar();
  sb.classList.remove("hidden");
}
// узкое окно: панель сама прячется, чтобы не закрывать чат
let wasNarrow = innerWidth <= 720;
addEventListener("resize", () => {
  const narrow = innerWidth <= 720;
  if (narrow && !wasNarrow) {
    document.documentElement.classList.add("side-collapsed");
    $("#sidebar")?.classList.add("hidden");
  }
  wasNarrow = narrow;
});
// «Вкладки сверху»: список сессий — временная шторка (закрывается по выбору сессии и по клику снаружи);
// «Сессии сбоку» в широком окне — закреплённая панель, её это не касается
document.addEventListener("click", (e) => {
  const side = document.documentElement.classList.contains("layout-side");
  if (e.target.closest("#sidebar .side-item, #sidebar [data-new]")) {
    if (side && innerWidth > 720) return;
    setTimeout(() => {
      if (side) document.documentElement.classList.add("side-collapsed");
      else $("#sidebar")?.classList.add("hidden");
    }, 50);
  } else if (!side && !e.target.closest("#sidebar, #side-toggle")) $("#sidebar")?.classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.documentElement.classList.contains("layout-side")) $("#sidebar")?.classList.add("hidden");
});

// ───────────────────────── запуск ─────────────────────────
(async function initExtras() {
  // ждём, пока app.js смонтирует поле ввода
  for (let i = 0; i < 50 && !$("#input"); i++) await new Promise((r) => setTimeout(r, 20));
  wireAttachments();
  wireSlash();
  $("#plugins-btn").onclick = openPlugins;
  $("#limits-btn").onclick = limitsPopover;
  $("#side-toggle").onclick = toggleSidebar2;
  window.xc.update.onState(renderUpdate);
  window.xc.update.onState((s) => window.__policyUpd?.(s));
  window.xc.policy?.onState(showUpdateRequired);
  window.xc.policy?.get().then(showUpdateRequired).catch(() => {});
  renderUpdate(await window.xc.update.get());
  window.xc.auth.onChanged(onAuth);
  onAuth(await window.xc.auth.get());
})();

// ───────────────────────── жалоба на баг (кнопка-жучок) ─────────────────────────
function openBugReport() {
  const box = document.createElement("div");
  box.className = "modal bug-modal";
  const imgs = [];
  box.innerHTML = `<div class="bug-top"><h3>Отправить отзыв</h3><button class="bug-close" data-x title="Закрыть"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <p class="bug-sub">Сообщите об ошибке, предложите идею или расскажите, что работает хорошо.</p>
    <textarea data-t placeholder="«Модель написала, что создала файл, но в папке его нет»."></textarea>
    <div class="bug-imgs" data-imgs></div>
    <p class="bug-note">В отчёт войдут ваше описание, скриншоты и последние сообщения текущей сессии — по ним мы найдём и исправим проблему. Скриншот можно вставить в поле (Ctrl+V) или <a href="#" data-pick>выбрать файл</a>.</p>
    <input type="file" accept="image/*" multiple hidden data-file />
    <div class="bug-foot"><button class="bug-btn ghost" data-x>Отмена</button><button class="bug-btn send" data-send disabled>Отправить</button></div>`;
  const close = overlay(box);
  const t = box.querySelector("[data-t]");
  const list = box.querySelector("[data-imgs]");
  const sendBtn = box.querySelector("[data-send]");
  const syncSend = () => (sendBtn.disabled = !t.value.trim() && !imgs.length);
  t.addEventListener("input", syncSend);
  const draw = () => {
    list.innerHTML = imgs.map((src, i) => `<div class="bug-img"><img src="${src}" alt=""><button data-rm="${i}" title="Убрать">×</button></div>`).join("");
    list.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => (imgs.splice(Number(b.dataset.rm), 1), draw())));
    syncSend();
  };
  // большие скриншоты уменьшаем до 1600px и JPEG, чтобы жалоба ушла быстро
  const addFile = (file) =>
    new Promise((res) => {
      if (!file || !/^image\//.test(file.type) || imgs.length >= 4) return res();
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const k = Math.min(1, 1600 / Math.max(im.width, im.height));
          const c = document.createElement("canvas");
          c.width = Math.round(im.width * k);
          c.height = Math.round(im.height * k);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          imgs.push(c.toDataURL("image/jpeg", 0.85));
          draw();
          res();
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  t.addEventListener("paste", (e) => {
    for (const it of e.clipboardData?.items || []) if (it.kind === "file") addFile(it.getAsFile());
  });
  const file = box.querySelector("[data-file]");
  box.querySelector("[data-pick]").onclick = (e) => (e.preventDefault(), file.click());
  file.onchange = async () => {
    for (const f of file.files) await addFile(f);
    file.value = "";
  };
  box.querySelectorAll("[data-x]").forEach((b) => (b.onclick = close));
  box.querySelector("[data-send]").onclick = async (e) => {
    const text = t.value.trim();
    if (!text && !imgs.length) return t.focus();
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Отправляю…";
    const r = await window.xc.bug.send({ text, images: imgs, sessionId: app.active });
    if (r.ok) {
      close();
      toast(`Спасибо! Жалоба отправлена${r.id ? " (№ " + r.id + ")" : ""}`);
    } else {
      b.disabled = false;
      b.textContent = "Отправить";
      toast("Не получилось отправить: " + r.error);
    }
  };
  setTimeout(() => t.focus(), 40);
}
document.getElementById("bug-btn")?.addEventListener("click", openBugReport);
