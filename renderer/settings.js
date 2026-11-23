// XroMax Code — страница «Настройки»: предпочтения, внешний вид, уведомления, горячие клавиши, провайдеры,
// модели, расширения, проекты, экспериментальное, о программе. Применение настроек к интерфейсу, звуки, горячие клавиши.
"use strict";

// ───────────────────────── горячие клавиши ─────────────────────────
const HOTKEYS = [
  { id: "newSession", label: "Новая сессия", def: "Ctrl+T", run: () => newTab() },
  { id: "closeTab", label: "Закрыть вкладку", def: "Ctrl+W", run: () => closeTab(app.active) },
  { id: "nextTab", label: "Следующая вкладка", def: "Ctrl+Tab", run: () => cycleTab(1) },
  { id: "prevTab", label: "Предыдущая вкладка", def: "Ctrl+Shift+Tab", run: () => cycleTab(-1) },
  { id: "models", label: "Выбор модели", def: "Ctrl+K", run: () => openModelPicker() },
  { id: "settings", label: "Открыть или закрыть настройки", def: "Ctrl+,", run: () => ($("#settings-page") ? closeSettingsPage() : openSettingsPage()) },
  { id: "plugins", label: "Плагины и коннекторы", def: "Ctrl+Shift+P", run: () => openPlugins() },
  { id: "sidebar", label: "Список сессий", def: "Ctrl+B", run: () => toggleSidebar2() },
  { id: "compact", label: "Сжать разговор", def: "Ctrl+Shift+C", run: () => compressNow() },
  { id: "ultra", label: "UltraCode вкл/выкл", def: "Ctrl+U", run: () => toggleUltra() },
  { id: "attach", label: "Прикрепить файл", def: "Ctrl+O", run: () => $("#file-input").click() },
  { id: "stop", label: "Остановить агента", def: "", run: () => cur()?.busy && stop() },
  { id: "focus", label: "Перейти в поле ввода", def: "Ctrl+L", run: () => $("#input").focus() },
];
function cycleTab(d) {
  if (app.tabs.length < 2) return;
  const i = app.tabs.indexOf(app.active);
  activate(app.tabs[(i + d + app.tabs.length) % app.tabs.length]);
}
const comboOf = (e) => {
  const k = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", k].filter(Boolean).join("+");
};
const keyFor = (h) => (app.prefs?.hotkeys?.[h.id] ?? h.def) || "";
let recordingHotkey = null;
document.addEventListener("keydown", (e) => {
  if (recordingHotkey) return;
  const c = comboOf(e);
  if (!c || (!c.includes("Ctrl") && !c.includes("Alt") && !/^F\d+$/.test(c))) return;
  const h = HOTKEYS.find((x) => keyFor(x) === c);
  if (!h) return;
  e.preventDefault();
  h.run();
});

// ───────────────────────── звуки (без файлов — синтез) ─────────────────────────
let audioCtx = null;
const TONES = {
  soft: [[660, 0.09], [880, 0.12]],
  ping: [[1046, 0.08], [1318, 0.14]],
  chime: [[784, 0.1], [988, 0.1], [1318, 0.18]],
  low: [[330, 0.12], [247, 0.18]],
  click: [[1800, 0.02]],
};
function playTone(name) {
  const seq = TONES[name];
  if (!seq) return;
  try {
    audioCtx ??= new AudioContext();
    let t = audioCtx.currentTime;
    for (const [f, d] of seq) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + d + 0.02);
      t += d * 0.9;
    }
  } catch {}
}
window.xcSound = (kind) => {
  const s = app.prefs?.sounds;
  if (!s || !kind) return;
  if (kind === "send") return s.ui && playTone("click");
  if (s[kind] && s[kind] !== "none") playTone(s[kind]);
};

// ───────────────────────── применение настроек ─────────────────────────
function applyUiPrefs(p, dark) {
  const h = document.documentElement;
  h.dataset.theme = dark ? "dark" : "light";
  h.style.setProperty("--sans", `"${p.uiFont || "Inter"}", "Segoe UI", system-ui, sans-serif`);
  h.style.setProperty("--mono", `"${p.codeFont || "JetBrains Mono"}", "Cascadia Code", Consolas, monospace`);
  h.classList.toggle("wrap-code", !!p.wrapCode);
  h.classList.toggle("reduce-motion", p.motion === "reduce" || (p.motion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches));
  h.classList.toggle("layout-side", p.layout === "side");
  let collapsed = false;
  try {
    collapsed = localStorage.getItem("xc.sideCollapsed") === "1";
  } catch {}
  h.classList.toggle("side-collapsed", collapsed || innerWidth <= 720);
  const input = $("#input");
  if (input) input.spellcheck = !!p.spellcheck;
  // язык интерфейса: словарь грузится один раз, дальше всё переводится на лету
  if (applyUiPrefs.lang !== (p.language || "ru")) {
    const first = applyUiPrefs.lang === undefined;
    applyUiPrefs.lang = p.language || "ru";
    if (!(first && applyUiPrefs.lang === "ru")) window.i18n?.setLanguage(applyUiPrefs.lang);
  }
  if (p.layout === "side" && $("#sidebar").classList.contains("hidden")) renderSidebar().then(() => $("#sidebar").classList.remove("hidden"));
  // вернулись на «Вкладки сверху» — боковая панель сессий закрывается (раньше оставалась висеть)
  if (applyUiPrefs.layout === "side" && p.layout !== "side") $("#sidebar").classList.add("hidden");
  applyUiPrefs.layout = p.layout;
}
async function setPrefs(patch) {
  const r = await window.xc.prefs.set(patch);
  app.prefs = r.prefs;
  applyUiPrefs(r.prefs, r.dark);
  return r.prefs;
}

// ───────────────────────── страница настроек ─────────────────────────
/** Языки интерфейса: код, название на самом языке */
const UI_LANGS = [["ru", "Русский"], ["en", "English"], ["uk", "Українська"], ["es", "Español"], ["de", "Deutsch"], ["fr", "Français"], ["it", "Italiano"], ["pt", "Português (Brasil)"], ["pl", "Polski"], ["tr", "Türkçe"], ["nl", "Nederlands"], ["cs", "Čeština"], ["ro", "Română"], ["sv", "Svenska"], ["zh", "简体中文"], ["ja", "日本語"], ["ko", "한국어"], ["ar", "العربية"], ["he", "עברית"], ["hi", "हिन्दी"], ["id", "Bahasa Indonesia"], ["vi", "Tiếng Việt"], ["th", "ไทย"], ["hu", "Magyar"], ["kk", "Қазақша"], ["el", "Ελληνικά"]];
const SECTIONS = [
  { id: "prefs", label: "Предпочтения", ico: "⚙" },
  { id: "look", label: "Внешний вид", ico: "◐" },
  { id: "notify", label: "Уведомления", ico: "◔" },
  { id: "keys", label: "Горячие клавиши", ico: "⌘" },
  { id: "privacy", label: "Конфиденциальность", ico: "⛨" },
  { gap: true },
  { id: "limits", label: "Лимиты", ico: "◷" },
  { id: "providers", label: "Провайдеры", ico: "⛁" },
  { id: "models", label: "Модели", ico: "✦" },
  { id: "agents", label: "Субагенты", ico: "☻" },
  { id: "ext", label: "Расширения", ico: "⧉" },
  { id: "projects", label: "Проекты", ico: "▭" },
  { gap: true },
  { id: "exp", label: "Экспериментальное", ico: "⚗" },
  { id: "help", label: "Документация", ico: "?" },
  { id: "about", label: "О программе", ico: "ⓘ" },
];
let stSection = "prefs";

function openSettingsPage(section) {
  if (section) stSection = section;
  let page = $("#settings-page");
  if (!page) {
    page = document.createElement("div");
    page.id = "settings-page";
    document.body.appendChild(page);
  }
  page.innerHTML = `<div class="st-wrap"><nav class="st-nav"><button class="st-back">← Назад в приложение</button>
    <label class="st-search">⌕<input placeholder="Поиск" /></label><div class="st-items"></div></nav><main class="st-main"></main></div>`;
  page.querySelector(".st-back").onclick = closeSettingsPage;
  const q = page.querySelector(".st-search input");
  const drawNav = () => {
    const s = q.value.trim().toLowerCase();
    page.querySelector(".st-items").innerHTML = SECTIONS.filter((x) => x.gap || !s || x.label.toLowerCase().includes(s))
      .map((x) => (x.gap ? (s ? "" : '<div class="st-nav-gap"></div>') : `<button class="st-nav-item ${x.id === stSection ? "on" : ""}" data-s="${x.id}"><span style="width:16px;text-align:center">${x.ico}</span>${esc(x.label)}</button>`))
      .join("");
    page.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => ((stSection = b.dataset.s), drawNav(), drawSection())));
  };
  q.oninput = drawNav;
  drawNav();
  drawSection();
  document.addEventListener("keydown", escClose);
}
function escClose(e) {
  if (e.key === "Escape" && !recordingHotkey && !document.querySelector(".overlay")) closeSettingsPage();
}
function closeSettingsPage() {
  $("#settings-page")?.remove();
  document.removeEventListener("keydown", escClose);
  reloadCatalog();
}

const row = (title, desc, control) => `<div class="st-row"><div class="t"><b>${title}</b><span>${desc}</span></div>${control}</div>`;
const sel = (key, options, value) => `<select class="st-select" data-k="${key}">${options.map(([v, l, dis]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""} ${dis ? "disabled" : ""}>${l}</option>`).join("")}</select>`;
const tog = (key, on) => `<button class="toggle ${on ? "on" : ""}" data-tg="${key}"></button>`;

async function drawSection() {
  const main = $("#settings-page .st-main");
  if (!main) return;
  const p = app.prefs;
  const st = await window.xc.state.get();
  const head = (t, sub, right = "") => `<div style="display:flex;justify-content:space-between;gap:16px"><div><h2>${t}</h2><p class="st-sub">${sub}</p></div>${right}</div>`;
  let html = "";
  if (stSection === "prefs") {
    html =
      head("Предпочтения", "Как выглядит работа с сессиями и что происходит по умолчанию") +
      `<h3>Основные</h3><div class="st-card">` +
      row("Макет интерфейса", "Как переключаться между сессиями и следить за тем, что выполняется", `<div class="layout-tiles"><button class="lt top ${p.layout !== "side" ? "on" : ""}" data-layout="top"><i></i>Вкладки сверху</button><button class="lt side ${p.layout === "side" ? "on" : ""}" data-layout="side"><i></i>Сессии сбоку</button></div>`) +
      row("Язык", "Язык интерфейса XroMax Code. ИИ отвечает на языке ваших сообщений", sel("language", UI_LANGS, p.language)) +
      row("Доступ по умолчанию", "С каким режимом доступа начинаются новые сессии", sel("st:access", [["auto", "Авто — спрашивать при угрозах"], ["full", "Полный доступ"], ["ask", "Спрашивать всегда"]], st.access)) +
      row("Мышление по умолчанию", "Глубина размышлений модели в новых сессиях", sel("st:thinking", [["default", "Default"], ["low", "Low"], ["high", "High"], ["max", "Max"]], st.thinking)) +
      row("Сообщения во время работы", "Что делать с сообщением, отправленным, пока агент ещё работает", sel("followUp", [["queue", "В очередь"], ["stop", "Остановить и отправить"]], p.followUp)) +
      row("Проверка орфографии", "Подчёркивать слова с ошибками при вводе", tog("spellcheck", p.spellcheck)) +
      row("Переносить строки в коде", "Перенос длинных строк в блоках кода вместо горизонтальной прокрутки", tog("wrapCode", p.wrapCode)) +
      `</div>`;
  } else if (stSection === "look") {
    html =
      head("Внешний вид", "Тема, шрифты и масштаб") +
      `<div class="st-card">` +
      row("Цветовая схема", "Следовать системе, светлая или тёмная тема", sel("theme", [["system", "Системная"], ["light", "Светлая"], ["dark", "Тёмная"]], p.theme)) +
      row("Шрифт интерфейса", "Шрифт всего интерфейса (должен быть установлен в Windows)", `<input class="st-input" data-in="uiFont" value="${esc(p.uiFont)}" placeholder="Inter" />`) +
      row("Шрифт кода", "Шрифт в блоках кода и путях файлов", `<input class="st-input" data-in="codeFont" value="${esc(p.codeFont)}" placeholder="JetBrains Mono" style="font-family:var(--mono)" />`) +
      row("Масштаб", "Увеличить текст и элементы во всём приложении", sel("zoom", [80, 90, 100, 110, 125, 150].map((z) => [z, z + " %"]), p.zoom)) +
      row("Уменьшить движение", "Сократить анимации или следовать настройкам Windows", sel("motion", [["system", "Как в системе"], ["reduce", "Без анимаций"], ["full", "Все анимации"]], p.motion)) +
      `</div>`;
  } else if (stSection === "notify") {
    const snd = (k) => sel("snd:" + k, [["none", "Без звука"], ["soft", "Мягкий"], ["ping", "Пинг"], ["chime", "Колокольчик"], ["low", "Низкий"]], p.sounds[k]);
    html =
      head("Уведомления", "Когда показывать уведомления Windows и какие звуки играть") +
      `<h3>Системные уведомления</h3><div class="st-card">` +
      row("Агент", "Когда агент закончил работу (если окно не в фокусе)", tog("n:done", p.notify.done)) +
      row("Разрешения", "Когда агенту нужно ваше разрешение", tog("n:approval", p.notify.approval)) +
      row("Ошибки", "Когда произошла ошибка", tog("n:error", p.notify.error)) +
      `</div><h3>Звуковые эффекты</h3><div class="st-card">` +
      row("Агент", "Звук, когда агент закончил работу", snd("done")) +
      row("Разрешения", "Звук, когда нужно разрешение", snd("approval")) +
      row("Ошибки", "Звук при ошибке", snd("error")) +
      row("Интерфейс", "Тихий щелчок при отправке сообщения", tog("s:ui", p.sounds.ui)) +
      `</div>`;
  } else if (stSection === "keys") {
    html =
      head("Горячие клавиши", "Нажмите на сочетание, чтобы поменять его. Esc — отмена, Backspace — убрать", `<button class="st-link" data-reset-keys>Восстановить по умолчанию</button>`) +
      `<div class="st-card">${HOTKEYS.map((h) => row(h.label, "", `<button class="hk-key ${keyFor(h) ? "" : "none"}" data-hk="${h.id}">${esc(keyFor(h) || "Не назначено")}</button>`)).join("")}</div>`;
  } else if (stSection === "privacy") {
    const d = await window.xc.privacy.get();
    const mb = (b) => (!b ? "пусто" : b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " МБ" : Math.max(1, Math.round(b / 1024)) + " КБ");
    const site = "https://xromax-ai.defhosting.com";
    html =
      head("Конфиденциальность", "") +
      `<p class="st-lead">XroMax Code хранит ваши чаты на этом компьютере. В аккаунт XroMax уходят только копии чатов (если они включены) и запросы к встроенным моделям — чтобы модель могла ответить. Подробнее — в <a class="st-link" data-url="${site}/privacy">Политике конфиденциальности</a> и <a class="st-link" data-url="${site}/terms">Условиях использования</a>.</p>` +
      `<div class="st-card">` +
      `<button class="st-row st-more" data-pv-info="protect"><div class="t"><b>Как мы защищаем ваши данные</b></div><span class="chev">›</span></button>` +
      `<div class="st-info hidden" data-pv-box="protect">Чаты лежат в папке приложения на вашем ПК. Ключи API хранятся зашифрованными средствами Windows и никуда не отправляются, кроме самого поставщика. Связь с сайтом — только по HTTPS, вход — по токену приложения, который можно отозвать выходом из аккаунта. Копии чатов в аккаунте доступны только вам.</div>` +
      `<button class="st-row st-more" data-pv-info="use"><div class="t"><b>Как мы используем ваши данные</b></div><span class="chev">›</span></button>` +
      `<div class="st-info hidden" data-pv-box="use">Запросы к встроенным моделям XroMax передаются модели, чтобы получить ответ, и считаются в общие лимиты XroMax. Запросы к вашим API (свои ключи) идут напрямую поставщику, минуя XroMax. Для улучшения моделей чаты используются только с вашего согласия — переключатель ниже.</div>` +
      `</div><h3>Предпочтения</h3><div class="st-card">` +
      row("Метаданные о местоположении", "Сообщать агенту часовой пояс, регион Windows и местное время, чтобы ответы учитывали ваш регион. Точное местоположение не передаётся", tog("shareRegion", p.shareRegion !== false)) +
      row("Помогать улучшать модели XroMax", d.signedIn ? "Разрешить использовать ваши чаты и сессии программирования для обучения и улучшения моделей XroMax. Выбор сохраняется в аккаунте" : "Разрешить использовать ваши чаты для улучшения моделей XroMax. Войдите в аккаунт, чтобы выбор сохранился", tog("pv:improve", !!d.improve)) +
      row("Копии чатов в аккаунте", "Сохранять копии чатов в аккаунте XroMax, чтобы восстановить их на другом ПК или после удаления", tog("chatCopies", p.chatCopies !== false)) +
      `</div><h3>Ваши данные</h3><div class="st-card">` +
      row("Экспортировать данные", `Все чаты (${d.local}) в JSON и Markdown и ваши настройки — в выбранную папку`, `<button class="btn" data-pv="export">Экспортировать данные</button>`) +
      row("Чаты на этом компьютере", `${d.local} ${d.local === 1 ? "чат" : "чатов"} · ${mb(d.localBytes)}`, `<span style="display:flex;gap:6px"><button class="btn" data-pv="openLocal">Открыть папку</button><button class="btn danger" data-pv="deleteLocal">Удалить все</button></span>`) +
      `</div><h3>Перенос из других приложений</h3><p class="st-lead" style="margin:-4px 0 12px">Перенесите чаты из Claude Code, Codex или OpenCode: переписка появится в сессиях, а модель получит её как контекст и продолжит с того же места.</p><div class="st-card">` +
      ["claude", "codex", "opencode"].map((src) => row(esc(IMPORT_NAMES[src]), `<span data-imp-info="${src}">Ищу чаты…</span>`, `<button class="btn" data-imp="${src}" disabled>Выбрать чаты…</button>`)).join("") +
      `</div><h3 style="margin-top:22px">Хранилище</h3><div class="st-card">` +
      row("Копии в аккаунте", d.signedIn ? (d.copies == null ? "Не удалось получить список — проверьте интернет" : `${d.copies} ${d.copies === 1 ? "копия" : "копий"} на сайте XroMax`) : "Войдите в аккаунт, чтобы управлять копиями", d.signedIn ? `<button class="btn danger" data-pv="deleteCopies" ${d.copies ? "" : "disabled"}>Удалить копии</button>` : "") +
      `</div>`;
  } else if (stSection === "providers") {
    const list = await window.xc.providers.list();
    const on = list.filter((x) => !x.needsKey || x.hasKey);
    const off = list.filter((x) => x.needsKey && !x.hasKey);
    const prow = (x, connected) =>
      `<div class="st-row"><div class="t"><b>${esc(x.name)} ${x.custom ? '<span class="badge">свой</span>' : ""} ${!x.needsKey ? '<span class="badge">Встроенный</span>' : connected ? `<span class="badge">${x.oauth ? "Подписка" : "Ключ API"}</span>` : ""}</b><span>${esc(!x.needsKey ? "Бесплатно — по входу через сайт" : connected ? (x.error ? "Ошибка: " + x.error.slice(0, 80) : `Моделей: ${x.count}`) : x.oauth ? "Вход через вашу подписку ChatGPT, без API-ключа" : x.noTools ? "Чат без инструментов" : "Нужен API-ключ")}</span></div><button class="btn" data-prov>${connected ? "Настроить" : "+ Подключить"}</button></div>`;
    setTimeout(() => {
      const row0 = [...document.querySelectorAll("#settings-page .st-row")].find((r) => r.textContent.includes("ChatGPT (подписка)") && !r.textContent.includes("Нужен") && r.textContent.includes("Подписка"));
      if (!row0 || !window.xc.chatgpt) return;
      const sp = row0.querySelector(".t span");
      window.xc.chatgpt.limits().then((L) => L && sp && (sp.textContent = gptLimitsText(L)));
    }, 50);
    html =
      head("Провайдеры", "Подключите любой API: свои ключи, OpenRouter, Anthropic, OpenAI, DeepSeek и другие", `<button class="btn primary" data-prov>+ Свой API</button>`) +
      `<h3>Подключённые</h3><div class="st-card">${on.map((x) => prow(x, true)).join("")}</div>` +
      (off.length ? `<h3>Популярные</h3><div class="st-card">${off.map((x) => prow(x, false)).join("")}</div>` : "");
  } else if (stSection === "models") {
    const cat = await window.xc.models.list();
    const hidden = new Set(p.hiddenModels);
    html =
      head("Модели", "Какие модели показывать в выборе модели") +
      `<label class="plug-search" style="margin-bottom:6px">⌕<input data-msearch placeholder="Поиск моделей" /></label><div data-mlist></div>`;
    main.innerHTML = html;
    const drawModels = () => {
      const s = main.querySelector("[data-msearch]").value.trim().toLowerCase();
      main.querySelector("[data-mlist]").innerHTML = cat
        .map((g) => {
          const ms = g.models.filter((m) => !s || m.name.toLowerCase().includes(s) || m.id.toLowerCase().includes(s));
          if (!ms.length) return "";
          return `<div class="st-group">${esc(g.provider.name)} <span class="badge">${ms.length}</span></div><div class="st-card">${ms
            .slice(0, 300)
            .map((m) => row(esc(m.name) + (m.free ? ' <span class="badge">Бесплатно</span>' : ""), esc(m.id), tog("m:" + g.provider.id + "/" + m.id, !hidden.has(g.provider.id + "/" + m.id))))
            .join("")}</div>`;
        })
        .join("");
      bindSection(main);
    };
    main.querySelector("[data-msearch]").oninput = drawModels;
    drawModels();
    return;
  } else if (stSection === "ext") {
    const d = await window.xc.ext.list();
    const tab = main.dataset.tab || "mcp";
    const list =
      tab === "mcp"
        ? d.connectors.map((c) => row(esc(c.name), esc(c.type === "http" ? c.url : `${c.command} ${(c.args || []).join(" ")}`), tog("ext:" + c.id, c.enabled))).join("") || '<div class="empty-sm" style="padding:16px 0">Коннекторов пока нет</div>'
        : tab === "plugins"
          ? d.plugins.map((x) => row(esc(x.name), esc(`${x.description || "Плагин"} · скиллов ${x.skills}, коннекторов ${x.connectors}`), tog("ext:" + x.id, x.enabled))).join("") || '<div class="empty-sm" style="padding:16px 0">Плагинов пока нет</div>'
          : d.skills.map((x) => row("/" + esc(x.name), esc(x.description), tog("ext:" + x.id, x.enabled))).join("");
    html =
      head("Расширения", "Коннекторы (MCP), плагины и скиллы", `<button class="btn primary" data-open-plugins>Добавить…</button>`) +
      `<div class="seg" style="width:max-content;margin-bottom:12px"><button data-tab="mcp" class="${tab === "mcp" ? "on" : ""}">MCP</button><button data-tab="plugins" class="${tab === "plugins" ? "on" : ""}">Плагины</button><button data-tab="skills" class="${tab === "skills" ? "on" : ""}">Скиллы</button></div><div class="st-card">${list}</div>`;
  } else if (stSection === "limits") {
    await window.xc.auth.refresh().catch(() => {});
    const acc = app.account;
    const T = acc?.tests ? Object.values(acc.tests)[0] : null;
    const R = acc?.resets || { h5: 0, week: 0 };
    const bar = (title, p, reset) => `<div class="st-row" style="display:block"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><b>${title}</b><span class="st-sub">${Math.round(p)}% использовано · ${esc(fmtReset(reset))}</span></div><div class="lim-line"><i style="width:${Math.min(100, p)}%;background:${p >= 90 ? "#ef4444" : p >= 75 ? "#f59e0b" : "#8b5cf6"}"></i></div></div>`;
    const resetBtn = (w, n, label) => `<div class="st-row"><div class="t"><b>${label}</b><span>${n > 0 ? `Доступно: ${n}. Сразу освобождает лимит.` : "Уже использован"}</span></div><button class="btn ${n > 0 ? "primary" : ""}" data-reset="${w}" ${n > 0 ? "" : "disabled"}>Сбросить</button></div>`;
    html =
      head("Лимиты", "Расход общих лимитов XroMax и лимиты подписки ChatGPT") +
      (acc ? `<h3>Аккаунт XroMax</h3><div class="st-card">${row(esc(acc.user?.name || "Аккаунт"), "XroMax Code бесплатный — без подписок и оплаты", "")}</div>` : `<div class="st-card">${row("Вы не вошли", "Войдите через сайт, чтобы видеть лимиты", "")}</div>`) +
      (T ? `<h3>Общий лимит XroMax</h3><p class="st-sub">Helium, Xenon и Claude 5.5 тратят один счётчик. Модели 2.0 (Truo, Lite) — без лимитов.</p><div class="st-card">${bar("5 часов", T.pct5h, T.reset5h)}${bar("Неделя", T.pctWeek, T.resetWeek)}</div>` +
        `<h3>Сбросы лимитов</h3><p class="st-sub">Каждому — по одному сбросу. Сброс недели обнуляет и 5-часовой лимит.</p><div class="st-card">${resetBtn("5h", R.h5, "Сброс 5-часового лимита")}${resetBtn("week", R.week, "Сброс недельного лимита")}</div>` : "") +
      `<h3>Подписка ChatGPT</h3><div class="st-card" data-gptlim>${row("ChatGPT", "Проверяю…", "")}</div>`;
    setTimeout(async () => {
      const box = document.querySelector("#settings-page [data-gptlim]");
      if (!box) return;
      const info = await window.xc.chatgpt.info().catch(() => null);
      if (!info) return (box.innerHTML = row("ChatGPT не подключён", "Подключите в «Провайдерах» — вход через подписку, без API-ключа", '<button class="btn" data-prov>Подключить</button>'), box.querySelector("[data-prov]").addEventListener("click", () => openSettings()));
      const L = await window.xc.chatgpt.limits().catch(() => null);
      box.innerHTML = row("ChatGPT подключён" + (info.email ? " · " + esc(info.email) : ""), L?.plan ? "План: " + esc(L.plan) : "Подписка ChatGPT", "") + (L ? bar("5 часов", L.pct5h, L.reset5h) + bar("Неделя", L.pctWeek, L.resetWeek) : row("Лимиты", "Появятся после первого ответа модели ChatGPT", ""));
    }, 30);
  } else if (stSection === "agents") {
    const mine = p.customAgents || [];
    const cards = mine
      .map((a) => `<div class="st-row"><div class="t"><b>${esc(a.name)}</b><span>${esc(a.description || "Свой субагент")}</span></div><button class="btn" data-ag-edit="${esc(a.name)}">Изменить</button>${tog("agent:" + a.name, a.enabled !== false)}<button class="icon-btn" data-ag-rm="${esc(a.name)}" title="Удалить">×</button></div>`)
      .join("");
    html =
      head("Субагенты", "Свои «обученные» помощники: у каждого постоянные инструкции. Главный агент вызывает их сам", `<button class="btn primary" data-ag-new>+ Создать</button>`) +
      `<h3>Мои субагенты</h3><div class="st-card">${cards || '<div class="empty-sm" style="padding:16px 0">Пока нет. Нажмите «Создать» или попросите в чате: «создай субагента, который…»</div>'}</div>` +
      `<h3>Встроенные</h3><div class="st-card">` +
      row("Команда субагентов", "Встроенный плагин, всегда включён: агент умеет создавать и запускать ваших субагентов (инструменты create_subagent и run_custom_agent)", '<span class="st-sub" style="white-space:nowrap">всегда вкл</span>') +
      row("builder · critic · tester · designer · researcher", "Роли UltraCode — запускаются через run_subagents", '<span class="st-sub">UltraCode</span>') +
      `</div><div id="ag-form"></div>`;
  } else if (stSection === "projects") {
    html =
      head("Проекты", "Папки, с которыми работает агент", `<button class="btn primary" data-add-project>+ Добавить проект</button>`) +
      `<div class="st-card">${st.projects.map((d) => `<div class="st-row"><div class="t"><b>${esc(baseName(d))}</b><span>${esc(d)}</span></div><button class="btn" data-open-dir="${esc(d)}">Открыть</button>${st.projects.length > 1 ? `<button class="icon-btn" data-rm-dir="${esc(d)}" title="Убрать из списка (папка не удаляется)">×</button>` : ""}</div>`).join("")}</div>`;
  } else if (stSection === "exp") {
    html =
      head("Экспериментальное", "Функции, которые ещё дорабатываются") +
      `<div class="st-card">` +
      row('Супер-экономия токенов <span class="badge">бета</span>', "Работает с любой моделью, в том числе с подпиской ChatGPT. Старые результаты инструментов и повторные чтения файлов сокращаются, контекст сжимается раньше (при 60%), а при уровне «Default» модель думает поменьше. Обычно экономит 30–40% токенов; последние сообщения не трогаются", tog("superSaver", p.superSaver)) +
      row("Автосжатие контекста", "Когда контекст заполнен на 95%, приложение само сжимает разговор перед ответом", tog("autoCompress", p.autoCompress)) +
      row("Размышления раскрыты", "Показывать мысли модели сразу, а не свёрнутыми", tog("thinkingOpen", p.thinkingOpen)) +
      row("UltraCode: агентов параллельно", "Сколько субагентов главный агент может запустить за раз", sel("maxParallel", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => [n, String(n)]), p.maxParallel)) +
      `</div>`;
  } else if (stSection === "help") {
    const qa = (q, a) => `<div class="st-row" style="display:block"><div class="t"><b>${q}</b><span style="white-space:normal;display:block;margin-top:4px">${a}</span></div></div>`;
    html =
      head("Документация", "Быстрые ответы, если что-то работает не так") +
      `<h3>Если не работает</h3><div class="st-card">` +
      qa("Модель долго думает и не отвечает, пишет «terminated» или ошибки сети", "<b>Включите VPN</b> и нажмите «Попробовать снова». Часть провайдеров и регионов блокирует или замедляет соединение с серверами ИИ — через VPN обычно всё заводится. Приложение само пробует переподключиться до 10 раз, при проблемах сервера — до 15.") +
      qa("Не заходит в аккаунт или не открывается сайт входа", "Включите VPN и повторите вход. Если входите через Telegram, откройте сайт входа в обычном браузере.") +
      qa("Не приходит обновление", "Приложение проверяет обновления каждые 35 секунд, пока открыто. Если кнопки «Скачать» нет — включите VPN, перезапустите приложение, либо скачайте установщик с сайта xromax-ai.defhosting.com и поставьте поверх: настройки и чаты сохранятся.") +
      qa("Ответ обрывается или агент «остановился»", "Напишите «продолжай». Для длинных задач выберите модель с большим контекстом или сожмите разговор командой /compact.") +
      qa("Модель написала «сделал», но файл не создан", "Нажмите кнопку-жучок в правом нижнем углу и отправьте отзыв — это поможет исправить. Попробуйте также режим «Полный доступ» и более точный запрос.") +
      `</div><h3>Основы</h3><div class="st-card">` +
      qa("Лимиты моделей XroMax 2.5", "У Helium и Xenon общий лимит на 5 часов и на неделю, он показан в процентах. Модели 2.0 (Truo, Lite) без лимитов.") +
      qa("Субагенты", "В «Субагентах» можно создать своего обученного помощника или попросить агента в чате: «создай субагента, который…». Для параллельной работы включите UltraCode.") +
      qa("@файл, план, задачи", "Упоминайте файлы через @, режим «План» сначала покажет шаги, а потом выполнит их по кнопке «Выполнить план».") +
      `</div>`;
  } else if (stSection === "about") {
    const acc = app.account?.user;
    html = `<div class="st-about"><p>Версия ${esc(st.version)}</p><div style="margin:18px 0 22px">${$("#logo").innerHTML}</div>
      <p><b style="color:var(--text)">XroMax Code</b> — ИИ-агент для кода на Windows от XROMAX.</p>
      <p>Любые API: свои ключи, OpenRouter, Anthropic, OpenAI, DeepSeek и другие.<br>Встроенные бесплатные модели, UltraCode, плагины, скиллы и коннекторы.</p>
      ${acc ? `<p>Вы вошли как ${esc(acc.name)}</p>` : ""}
      <p><button class="btn" data-check-update>Проверить обновления</button></p>
      <p><a class="st-link" data-url="https://xromax-ai.defhosting.com">xromax-ai.defhosting.com</a> · <a class="st-link" data-url="https://xromax-ai.defhosting.com/developers">XroMax API</a></p>
      <p style="color:var(--text-3)">© XROMAX</p></div>`;
  }
  main.innerHTML = html;
  bindSection(main);
}

function bindSection(main) {
  main.querySelectorAll("[data-k]").forEach(
    (s) =>
      (s.onchange = async () => {
        const k = s.dataset.k;
        const v = s.value;
        if (k.startsWith("st:")) {
          const key = k.slice(3);
          app.state[key] = v;
          return window.xc.state.set({ [key]: v });
        }
        if (k.startsWith("snd:")) {
          const name = k.slice(4);
          playTone(v);
          return setPrefs({ sounds: { ...app.prefs.sounds, [name]: v } });
        }
        await setPrefs({ [k]: k === "zoom" || k === "maxParallel" ? Number(v) : v });
      })
  );
  main.querySelectorAll("[data-tg]").forEach(
    (b) =>
      (b.onclick = async () => {
        const k = b.dataset.tg;
        const on = !b.classList.contains("on");
        b.classList.toggle("on", on);
        if (k.startsWith("n:")) return setPrefs({ notify: { ...app.prefs.notify, [k.slice(2)]: on } });
        if (k.startsWith("s:")) return setPrefs({ sounds: { ...app.prefs.sounds, [k.slice(2)]: on } });
        if (k.startsWith("m:")) {
          const id = k.slice(2);
          const hidden = new Set(app.prefs.hiddenModels);
          on ? hidden.delete(id) : hidden.add(id);
          return setPrefs({ hiddenModels: [...hidden] });
        }
        if (k.startsWith("agent:")) {
          const a = (app.prefs.customAgents || []).find((x) => x.name === k.slice(6));
          if (a) {
            const r = await window.xc.agents.save({ ...a, enabled: on });
            if (r.ok) app.prefs = r.prefs;
          }
          return;
        }
        if (k.startsWith("ext:")) return window.xc.ext.toggle({ id: k.slice(4), on });
        if (k === "pv:improve") {
          const r = await window.xc.privacy.improve(on);
          app.prefs = r.prefs;
          return;
        }
        await setPrefs({ [k]: on });
      })
  );
  main.querySelectorAll("[data-in]").forEach((i) => (i.onchange = () => setPrefs({ [i.dataset.in]: i.value.trim() })));
  main.querySelectorAll("[data-layout]").forEach((b) => (b.onclick = async () => (await setPrefs({ layout: b.dataset.layout }), drawSection())));
  main.querySelectorAll("[data-prov]").forEach((b) => (b.onclick = () => openSettings()));
  main.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => ((main.dataset.tab = b.dataset.tab), drawSection())));
  main.querySelector("[data-open-plugins]")?.addEventListener("click", () => openPlugins());
  main.querySelectorAll("[data-reset]").forEach(
    (b) =>
      (b.onclick = async () => {
        const w = b.dataset.reset;
        if (!confirm(w === "5h" ? "Сбросить 5-часовой лимит? Сброс даётся один раз." : "Сбросить недельный лимит (и 5-часовой тоже)? Сброс даётся один раз.")) return;
        b.disabled = true;
        b.textContent = "Сбрасываю…";
        const r = await window.xc.limits.reset(w);
        toast(r.ok ? "Лимит сброшен" : "Не получилось: " + r.error, 4000);
        await window.xc.auth.refresh().catch(() => {});
        drawSection();
      })
  );
  // субагенты: форма создания / правки, «Создать с ИИ», удаление
  const agForm = main.querySelector("#ag-form");
  const openAgForm = (a = {}) => {
    agForm.innerHTML = `<h3>${a.name ? "Изменить субагента" : "Новый субагент"}</h3><div class="st-card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <input class="st-select" id="ag-idea" placeholder="Опишите, кем он должен быть — ИИ напишет обучение (например: строгий ревьюер Python-кода)" style="width:100%" />
      <div><button class="btn" id="ag-gen">✨ Создать с ИИ</button> <span class="st-sub" id="ag-msg"></span></div>
      <input class="st-select" id="ag-name" placeholder="Имя (латиница, дефисы): code-reviewer" value="${esc(a.name || "")}" ${a.name ? "readonly" : ""} style="width:100%" />
      <input class="st-select" id="ag-desc" placeholder="Что делает и когда его звать" value="${esc(a.description || "")}" style="width:100%" />
      <textarea class="st-select" id="ag-prompt" rows="9" placeholder="Инструкции (обучение): роль, знания, правила, формат отчёта" style="width:100%;resize:vertical">${esc(a.prompt || "")}</textarea>
      <div><button class="btn primary" id="ag-save">Сохранить</button> <button class="btn" id="ag-cancel">Отмена</button></div></div>`;
    const g = (id) => agForm.querySelector(id);
    g("#ag-cancel").onclick = () => (agForm.innerHTML = "");
    g("#ag-gen").onclick = async () => {
      const idea = g("#ag-idea").value.trim() || g("#ag-desc").value.trim();
      if (!idea) return (g("#ag-msg").textContent = "Опишите идею в верхнем поле");
      const ref = cur()?.modelRef || app.state?.defaultModel;
      g("#ag-msg").textContent = "Пишу обучение…";
      const r = await window.xc.agents.generate({ idea, modelRef: ref });
      if (!r.ok) return (g("#ag-msg").textContent = r.error);
      if (!g("#ag-name").readOnly) g("#ag-name").value = r.name;
      g("#ag-desc").value = r.description;
      g("#ag-prompt").value = r.prompt;
      g("#ag-msg").textContent = "Готово — проверьте и сохраните";
    };
    g("#ag-save").onclick = async () => {
      const r = await window.xc.agents.save({ name: g("#ag-name").value, description: g("#ag-desc").value, prompt: g("#ag-prompt").value, enabled: a.enabled !== false });
      if (!r.ok) return (g("#ag-msg").textContent = r.error);
      app.prefs = r.prefs;
      drawSection();
    };
  };
  main.querySelector("[data-ag-new]")?.addEventListener("click", () => openAgForm());
  main.querySelectorAll("[data-ag-edit]").forEach((b) => (b.onclick = () => openAgForm((app.prefs.customAgents || []).find((x) => x.name === b.dataset.agEdit))));
  main.querySelectorAll("[data-ag-rm]").forEach((b) => (b.onclick = async () => ((app.prefs = (await window.xc.agents.remove(b.dataset.agRm)).prefs), drawSection())));
  main.querySelector("[data-add-project]")?.addEventListener("click", async () => {
    if (await window.xc.projects.pick()) drawSection();
  });
  main.querySelectorAll("[data-open-dir]").forEach((b) => (b.onclick = () => window.xc.projects.open(b.dataset.openDir)));
  main.querySelectorAll("[data-rm-dir]").forEach((b) => (b.onclick = async () => (await window.xc.projectsRemove(b.dataset.rmDir), drawSection())));
  main.querySelectorAll("[data-url]").forEach((a) => (a.onclick = () => window.xc.openExternal(a.dataset.url)));
  // перенос чатов: ищем в фоне, чтобы страница открылась сразу
  if (main.querySelector("[data-imp]")) {
    for (const src of Object.keys(IMPORT_NAMES)) {
      window.xc.importChats.scan(src).then((r) => {
        const info = main.querySelector(`[data-imp-info="${src}"]`);
        const btn = main.querySelector(`[data-imp="${src}"]`);
        if (!info || !btn) return;
        if (!r.ok) return void (info.textContent = "Не получилось прочитать: " + r.error);
        if (!r.found) return void (info.textContent = `Не найдено на этом ПК (${r.dir})`);
        const left = r.sessions.filter((s) => !s.imported).length;
        info.textContent = r.sessions.length ? `Найдено чатов: ${r.sessions.length}${left < r.sessions.length ? ` · уже перенесено: ${r.sessions.length - left}` : ""}` : "Чатов нет";
        btn.disabled = !r.sessions.length;
        btn.onclick = () => importPicker(src, r.sessions);
      });
    }
  }
  main.querySelectorAll("[data-pv-info]").forEach(
    (b) =>
      (b.onclick = () => {
        b.classList.toggle("open");
        main.querySelector(`[data-pv-box="${b.dataset.pvInfo}"]`)?.classList.toggle("hidden");
      })
  );
  main.querySelectorAll("[data-pv]").forEach(
    (b) =>
      (b.onclick = async () => {
        const act = b.dataset.pv;
        if (act === "openLocal") return window.xc.privacy.openLocal();
        if (act === "export") {
          b.disabled = true;
          b.textContent = "Экспортирую…";
          const r = await window.xc.privacy.exportAll();
          b.disabled = false;
          b.textContent = "Экспортировать данные";
          if (r.ok) toast(`Готово: ${r.count} чатов — папка открыта`);
          return;
        }
        if (act === "deleteLocal") {
          if (!confirm("Удалить все чаты на этом компьютере? Файлы уйдут в корзину Windows — оттуда их можно вернуть. Копии в аккаунте останутся.")) return;
          const r = await window.xc.privacy.deleteLocal();
          toast(`Удалено чатов: ${r.deleted}`);
          // открытые вкладки удалённых чатов закрываем — останется одна пустая сессия
          for (const id of [...app.tabs]) if (!app.sessions.get(id)?.busy) closeTab(id);
          return drawSection();
        }
        if (act === "deleteCopies") {
          if (!confirm("Удалить все копии чатов из аккаунта XroMax? Это нельзя отменить. Чаты на этом компьютере останутся.")) return;
          const r = await window.xc.privacy.deleteCopies();
          toast(r.ok ? `Удалено копий: ${r.deleted}` : "Не получилось: " + r.error);
          return drawSection();
        }
      })
  );
  main.querySelector("[data-check-update]")?.addEventListener("click", async (e) => {
    e.currentTarget.textContent = "Проверяю…";
    await window.xc.update.check();
    setTimeout(async () => {
      const s = await window.xc.update.get();
      e.target.textContent = s.state === "available" ? `Есть версия ${s.version} — кнопка вверху справа` : s.state === "none" ? "У вас последняя версия" : "Проверить обновления";
    }, 2500);
  });
  main.querySelector("[data-reset-keys]")?.addEventListener("click", async () => (await setPrefs({ hotkeys: {} }), drawSection()));
  main.querySelectorAll("[data-hk]").forEach(
    (b) =>
      (b.onclick = () => {
        if (recordingHotkey) return;
        b.classList.add("rec");
        b.textContent = "Нажмите сочетание…";
        recordingHotkey = b.dataset.hk;
        const onKey = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") return done();
          const c = e.key === "Backspace" ? "" : comboOf(e);
          if (c === null || (e.key !== "Backspace" && !c)) return; // только модификатор — ждём клавишу
          await setPrefs({ hotkeys: { ...app.prefs.hotkeys, [recordingHotkey]: c } });
          done();
        };
        const done = () => {
          document.removeEventListener("keydown", onKey, true);
          recordingHotkey = null;
          drawSection();
        };
        document.addEventListener("keydown", onKey, true);
      })
  );
}

// ───────────────────────── перенос чатов ─────────────────────────
const IMPORT_NAMES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
function importPicker(src, sessions) {
  const box = document.createElement("div");
  box.className = "modal imp-modal";
  const picked = new Set();
  const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " МБ" : Math.max(1, Math.round(b / 1024)) + " КБ");
  const date = (t) => new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  box.innerHTML = `<div class="imp-head"><h3>Чаты из ${esc(IMPORT_NAMES[src])}</h3><label class="plug-search">⌕<input data-q placeholder="Поиск по названию или папке" /></label>
    <div class="imp-tools"><button class="st-link" data-all>Выбрать все</button><button class="st-link" data-none>Снять выбор</button><span data-count></span></div></div>
    <div class="imp-list" data-list></div>
    <div class="imp-foot"><span class="imp-note">Длинные чаты переносятся с последними сообщениями (до ~100 тыс. токенов контекста).</span><button class="btn" data-cancel>Отмена</button><button class="btn primary" data-go disabled>Перенести</button></div>`;
  const close = overlay(box);
  const list = box.querySelector("[data-list]");
  const q = box.querySelector("[data-q]");
  const visible = () => {
    const s = q.value.trim().toLowerCase();
    return sessions.filter((x) => !s || x.title.toLowerCase().includes(s) || (x.workspace || "").toLowerCase().includes(s));
  };
  const count = () => {
    box.querySelector("[data-count]").textContent = picked.size ? `Выбрано: ${picked.size}` : "";
    const go = box.querySelector("[data-go]");
    go.disabled = !picked.size;
    go.textContent = picked.size ? `Перенести (${picked.size})` : "Перенести";
  };
  const draw = () => {
    const v = visible().slice(0, 400);
    list.innerHTML =
      v
        .map(
          (x) => `<label class="imp-row ${picked.has(x.ref) ? "on" : ""}"><input type="checkbox" data-ref="${esc(x.ref)}" ${picked.has(x.ref) ? "checked" : ""}/><span class="imp-t"><b>${esc(x.title)}</b>${x.imported ? '<span class="badge">уже перенесён</span>' : ""}<small>${esc(x.workspace || "без папки")} · ${date(x.updatedAt)}${x.size ? " · " + kb(x.size) : ""}</small></span></label>`
        )
        .join("") || '<div class="empty-sm" style="padding:22px">Ничего не найдено</div>';
    list.querySelectorAll("[data-ref]").forEach(
      (c) =>
        (c.onchange = () => {
          c.checked ? picked.add(c.dataset.ref) : picked.delete(c.dataset.ref);
          c.closest(".imp-row").classList.toggle("on", c.checked);
          count();
        })
    );
    count();
  };
  q.oninput = draw;
  box.querySelector("[data-all]").onclick = () => (visible().forEach((x) => picked.add(x.ref)), draw());
  box.querySelector("[data-none]").onclick = () => (picked.clear(), draw());
  box.querySelector("[data-cancel]").onclick = close;
  box.querySelector("[data-go]").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Переношу…";
    const r = await window.xc.importChats.run({ source: src, refs: [...picked] });
    close();
    toast(`Перенесено чатов: ${r.imported}${r.failed ? ` · не получилось: ${r.failed}` : ""}. Они в списке сессий`);
    window.renderSidebar?.();
    if (r.ids?.length === 1) openSessionTab(r.ids[0]);
    drawSection();
  };
  draw();
  setTimeout(() => q.focus(), 50);
}

// ───────────────────────── запуск ─────────────────────────
(async function initSettings() {
  for (let i = 0; i < 50 && !$("#input"); i++) await new Promise((r) => setTimeout(r, 20));
  const r = await window.xc.prefs.get();
  app.prefs = r.prefs;
  applyUiPrefs(r.prefs, r.dark);
  window.xc.prefs.onTheme((dark) => applyUiPrefs(app.prefs, dark));
  window.xc.prefs.onChanged?.((p) => { app.prefs = p; if ($("#settings-page") && stSection === "agents") drawSection(); });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => applyUiPrefs(app.prefs, document.documentElement.dataset.theme === "dark"));
  // кнопка настроек в верхней панели теперь открывает страницу настроек
  // повторное нажатие закрывает настройки
  $("#settings-btn").onclick = () => ($("#settings-page") ? closeSettingsPage() : openSettingsPage());
  $("#settings-btn").title = "Настройки (Ctrl+,)";
})();
