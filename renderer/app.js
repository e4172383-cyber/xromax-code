// XroMax Code — интерфейс: вкладки-сессии, поле ввода, выбор модели / мышления / доступа, UltraCode,
// индикатор заполненности контекста, расходы, подтверждения действий агента.
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = window.escapeHtml;

const THINK = [
  { id: "default", label: "Default" },
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
];
/** Расширенные уровни (Medium, Extra High) — только у моделей из подписки ChatGPT */
const GPT_THINK = [
  { id: "default", label: "Default" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
];
/** У Claude 5.5 (через XroMax) только два уровня: «Стандарт» и «Макс» (на сервере — разгон до high) */
const CLAUDE_THINK = [
  { id: "default", label: "Стандарт" },
  { id: "max", label: "Макс" },
];
const isClaudeModel = (s) => s?.modelRef?.provider === "xromax-free" && /^claude-5\.5-/.test(s?.modelRef?.model || "");
const claudeThink = (t) => (["high", "xhigh", "max"].includes(t) ? "max" : "default");
const thinkList = (s) => (isClaudeModel(s) ? CLAUDE_THINK : s?.modelRef?.provider === "chatgpt" ? GPT_THINK : THINK);
const ACCESS = [
  { id: "auto", label: "Авто", desc: "Быстро. Спрашивает только при сильных угрозах" },
  { id: "full", label: "Полный доступ", desc: "Всё разрешено, без вопросов" },
  { id: "ask", label: "Спрашивать всегда", desc: "Перед каждым изменением и командой" },
  { id: "plan", label: "План", desc: "Только читает и составляет план — ничего не меняет, пока не нажмёте «Выполнить план»" },
];
const TOOL_VERB = {
  list_files: "Смотрит папку",
  read_file: "Читает",
  write_file: "Создаёт",
  edit_file: "Правит",
  delete_path: "Удаляет",
  move_path: "Перемещает",
  make_dir: "Создаёт папку",
  search_text: "Ищет",
  run_command: "Выполняет",
  open_in_editor: "Открывает",
  run_subagents: "Запускает агентов",
  web_search: "Ищет в интернете",
  web_fetch: "Открывает страницу",
  update_todos: "План задач",
};
const DRAFT_VERB = { write_file: "Пишет файл", edit_file: "Готовит правку", run_command: "Готовит команду", run_subagents: "Готовит задания агентам" };
const ROLE_RU = { builder: "исполнитель", critic: "критик", tester: "тестировщик", designer: "дизайн", researcher: "исследователь" };

const app = {
  state: null,
  catalog: [],
  sessions: new Map(),
  tabs: [],
  active: null,
};

// ───────────────────────── вспомогательное ─────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n || 0));
const fmtUsd = (v) => (!v ? "$0.00" : v < 0.01 ? "$" + v.toFixed(4) : v < 1 ? "$" + v.toFixed(3) : "$" + v.toFixed(2));
const baseName = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || p;
function toast(text, ms = 3200) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  // плавное исчезновение вместо резкого
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 260);
  }, ms);
}
function findModel(ref) {
  const g = app.catalog.find((x) => x.provider.id === ref?.provider);
  return g ? { model: g.models.find((m) => m.id === ref.model), provider: g.provider } : { model: null, provider: null };
}
const cur = () => app.sessions.get(app.active);
// фон-ролик UltraCode: играет только пока включён (и окно не свёрнуто), чтобы не тратить процессор
function ultraBackground(on) {
  const v = document.getElementById("ultra-bg");
  if (!v) return;
  document.getElementById("main").classList.toggle("ultra-on", on);
  if (on && !document.hidden) {
    if (v.preload === "none") v.preload = "auto";
    v.play().catch(() => {});
  } else if (!on) setTimeout(() => !document.getElementById("main").classList.contains("ultra-on") && v.pause(), 900);
}
document.addEventListener("visibilitychange", () => {
  const v = document.getElementById("ultra-bg");
  if (!v) return;
  if (document.hidden) v.pause();
  else if (document.getElementById("main").classList.contains("ultra-on")) v.play().catch(() => {});
});

// ───────────────────────── логотип ─────────────────────────
const GLYPHS = {
  x: ["1...1", ".1.1.", "..1..", ".1.1.", "1...1"],
  r: ["1.11.", "11..1", "1....", "1....", "1...."],
  o: [".111.", "1...1", "1...1", "1...1", ".111."],
  m: ["11.1.", "1.1.1", "1.1.1", "1.1.1", "1.1.1"],
  a: [".111.", "....1", ".1111", "1...1", ".1111"],
};
function drawLogo() {
  const word = "xromax";
  const S = 13;
  const gap = S;
  const w = word.length * (5 * S + gap) - gap;
  let rects = "";
  let n = 0;
  [...word].forEach((ch, li) => {
    const ox = li * (5 * S + gap);
    GLYPHS[ch].forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== "1") return;
        const shade = (x + y + li) % 3 === 0 ? "#dcdcdc" : "#ebebeb";
        rects += `<rect x="${ox + x * S}" y="${y * S}" width="${S}" height="${S}" fill="${shade}" style="animation-delay:${(n++ * 8) % 600}ms"/>`;
      })
    );
  });
  $("#logo").innerHTML = `<svg width="${w}" height="${5 * S}" viewBox="0 0 ${w} ${5 * S}" aria-label="XroMax Code">${rects}</svg>`;
}

// ───────────────────────── меню ─────────────────────────
let openMenuEl = null;
function closeMenu() {
  const m = openMenuEl;
  openMenuEl = null;
  if (!m) return;
  m.classList.add("out");
  setTimeout(() => m.remove(), 140);
}
function showMenu(anchor, items, { up = true } = {}) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu";
  for (const it of items) {
    const b = document.createElement("button");
    b.innerHTML = `<span><span class="item-t">${esc(it.label)}</span>${it.desc ? `<span class="sub-t">${esc(it.desc)}</span>` : ""}</span>${it.checked ? '<span class="check">✓</span>' : ""}`;
    b.onclick = () => {
      closeMenu();
      it.onClick();
    };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mh = m.offsetHeight;
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = (up && r.top - mh - 6 > 8 ? r.top - mh - 6 : r.bottom + 6) + "px";
  openMenuEl = m;
  setTimeout(() => document.addEventListener("mousedown", onDocDown, { once: true }), 0);
  function onDocDown(e) {
    if (!m.contains(e.target)) closeMenu();
    else document.addEventListener("mousedown", onDocDown, { once: true });
  }
}
function overlay(contentEl, { onClose } = {}) {
  const o = document.createElement("div");
  o.className = "overlay";
  o.appendChild(contentEl);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    o.classList.add("closing"); // плавное закрытие окна
    setTimeout(() => o.remove(), 180);
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === "Escape" && close();
  o.addEventListener("mousedown", (e) => e.target === o && close());
  document.addEventListener("keydown", onKey);
  document.body.appendChild(o);
  return close;
}

// ───────────────────────── поле ввода ─────────────────────────
function mountComposer() {
  const frag = $("#composer-tpl").content.cloneNode(true);
  $("#hero-slot").appendChild(frag);
  const input = $("#input");
  input.addEventListener("input", () => {
    autoGrow();
    updateSend();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  $("#send").onclick = () => (isBusy() ? stop() : submit());
  $("#model-chip").onclick = openModelPicker;
  $("#think-chip").onclick = (e) =>
    showMenu(e.currentTarget, [
      ...thinkList(cur()).map((t) => ({ label: t.label, checked: (isClaudeModel(cur()) ? claudeThink(cur().thinking) : cur().thinking) === t.id, onClick: () => setSess({ thinking: t.id }, { remember: "thinking" }) })),
      // быстрый режим есть только у моделей из подписки ChatGPT
      ...(cur().modelRef?.provider === "chatgpt" ? [{ label: "⚡ Быстрый режим · 1.5× расход", desc: "Ответы быстрее, лимит подписки тратится в 1,5 раза быстрее", checked: !!cur().fast, onClick: () => setSess({ fast: !cur().fast }) }] : []),
    ]);
  $("#access-chip").onclick = (e) =>
    showMenu(
      e.currentTarget,
      ACCESS.map((a) => ({
        label: a.label,
        desc: a.desc,
        checked: cur().access === a.id,
        // «План» — временный режим: запоминаем, к чему вернуться, и не делаем его режимом по умолчанию
        onClick: () => (a.id === "plan" ? setSess({ access: "plan", accessBeforePlan: cur().access === "plan" ? cur().accessBeforePlan : cur().access }) : setSess({ access: a.id }, { remember: "access" })),
      }))
    );
  $("#ultra-chip").onclick = toggleUltra;
  $("#daily-chip").onclick = () => setSess({ daily: !cur().daily });
  $("#project-chip").onclick = (e) => projectMenu(e.currentTarget);
}
function autoGrow() {
  const i = $("#input");
  i.style.height = "auto";
  i.style.height = Math.min(i.scrollHeight, 280) + "px";
}
const isBusy = () => !!cur()?.busy;
function updateSend() {
  const s = $("#send");
  const busy = isBusy();
  s.classList.toggle("stop", busy);
  s.disabled = !busy && ((!$("#input").value.trim() && !window.xcAttach?.has()) || app.net?.online === false);
  s.title = busy ? "Остановить" : "Отправить (Enter)";
  s.innerHTML = busy
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
}
// ───── состояние сети: без сети отправить нельзя, над полем ввода — плашка ─────
app.net = { online: navigator.onLine };
function renderNetBar() {
  let bar = document.getElementById("net-bar");
  if (app.net.online !== false) {
    if (bar && !bar.classList.contains("out")) {
      bar.classList.add("out");
      setTimeout(() => bar.remove(), 260);
    }
    return updateSend();
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "net-bar";
    bar.innerHTML = '<span class="net-dot"></span><span>Нестабильное подключение к сети — отправка недоступна. Проверьте интернет или включите VPN.</span>';
    $("#composer").before(bar);
  }
  updateSend();
}
function setNet(online) {
  if (app.net.online === online) return;
  const was = app.net.online;
  app.net.online = online;
  renderNetBar();
  if (online && was === false) toast("Подключение восстановлено");
}
window.addEventListener("offline", () => setNet(false));
window.addEventListener("online", () => window.xc.net?.check().then((r) => setNet(!!r?.online)).catch(() => setNet(true)));
window.xc.net?.onState((r) => setNet(!!r.online));
function placeComposer() {
  const s = cur();
  const empty = !s || !s.items.length;
  $("#main").classList.toggle("empty", empty);
  const target = empty ? $("#hero-slot") : $("#dock-slot");
  const nodes = ["#approval-slot", "#slash-menu", "#ultra-warn", "#retry-bar", "#net-bar", "#composer", ".project-row"].map((q) => $(q)).filter(Boolean);
  if (nodes[0].parentElement !== target) nodes.forEach((n) => target.appendChild(n));
}
function refreshChips() {
  // смена модели: ChatGPT ↔ XroMax — переключаем показ лимитов
  if (typeof renderLimits === "function") {
    if (cur()?.modelRef?.provider === "chatgpt" && !app.gptLimits) window.refreshGptLimits?.();
    renderLimits();
  }
  window.__limFill?.();
  const s = cur();
  if (!s) return;
  const { model } = findModel(s.modelRef);
  $("#model-chip .lbl").textContent = model?.name || s.modelRef?.model || "Выберите модель";
  $("#think-chip .lbl").textContent = (isClaudeModel(s) ? CLAUDE_THINK.find((t) => t.id === claudeThink(s.thinking)).label : thinkList(s).find((t) => t.id === s.thinking)?.label ?? GPT_THINK.find((t) => t.id === s.thinking)?.label ?? "Default") + (s.fast && s.modelRef?.provider === "chatgpt" ? " ⚡" : "");
  $("#access-chip .lbl").textContent = ACCESS.find((a) => a.id === s.access)?.label ?? "Авто";
  $("#access-chip").classList.toggle("on", s.access === "full");
  $("#access-chip").classList.toggle("plan", s.access === "plan");
  $("#ultra-chip").classList.toggle("on", !!s.ultra);
  $("#daily-chip").classList.toggle("on", !!s.daily);
  $("#composer").classList.toggle("ultra", !!s.ultra);
  $("#ultra-warn").classList.toggle("hidden", !s.ultra);
  ultraBackground(!!s.ultra);
  renderRetryBar();
  $("#project-chip .lbl").textContent = baseName(s.workspace);
  $("#project-path").textContent = s.workspace;
  $("#project-path").title = s.workspace;
  updateSend();
  updateMeter();
}

function setSess(patch, { remember } = {}) {
  const s = cur();
  Object.assign(s, patch);
  if (remember) window.xc.state.set({ [remember]: patch[remember] });
  refreshChips();
  saveSession(s);
}

async function toggleUltra() {
  const s = cur();
  if (s.ultra) return setSess({ ultra: false });
  const { provider } = findModel(s.modelRef);
  if (provider?.noTools) return toast("У этой модели нет инструментов — UltraCode недоступен. Выберите другую модель.");
  if (!app.state.ultraWarned) {
    const box = document.createElement("div");
    box.className = "modal";
    box.style.maxWidth = "520px";
    box.innerHTML = `<div style="padding:22px 22px 18px">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px"><div style="width:38px;height:38px;border-radius:11px;background:#111;color:#fff;display:grid;place-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg></div><h3 style="margin:0;font-size:17px">UltraCode — высокое потребление</h3></div>
      <p style="color:#555;margin:0 0 10px">UltraCode — усиление от XroMax для любой модели. Главный агент планирует работу и запускает до <b>11 субагентов параллельно</b>, а затем ещё — если это нужно для качества: критики проверяют код, тестировщики ищут баги, дизайн-агенты проверяют сайты.</p>
      <p style="color:#555;margin:0 0 16px">Токенов уходит <b>в разы больше</b>, чем в обычном режиме. Включайте для больших и важных задач.</p>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-no>Отмена</button><button class="btn primary" data-yes>Включить UltraCode</button></div></div>`;
    const close = overlay(box);
    box.querySelector("[data-no]").onclick = close;
    box.querySelector("[data-yes]").onclick = () => {
      app.state.ultraWarned = true;
      window.xc.state.set({ ultraWarned: true });
      close();
      setSess({ ultra: true });
    };
    return;
  }
  setSess({ ultra: true });
}

async function projectMenu(anchor) {
  const s = cur();
  const st = await window.xc.state.get();
  const items = st.projects.map((p) => ({ label: baseName(p), desc: p, checked: p === s.workspace, onClick: () => setSess({ workspace: p }) }));
  items.push({ label: "Выбрать папку…", onClick: async () => {
    const dir = await window.xc.projects.pick();
    if (dir) setSess({ workspace: dir });
  } });
  items.push({ label: "Открыть в проводнике", onClick: () => window.xc.projects.open(s.workspace) });
  showMenu(anchor, items, { up: false });
}

// ───────────────────────── индикатор контекста и расходов ─────────────────────────
function updateMeter() {
  const s = cur();
  const max = (findModel(s?.modelRef).model?.context) || 128_000;
  const used = s?.stats?.contextTokens || 0;
  const pct = Math.min(1, used / max);
  const color = pct >= 0.9 ? "var(--ctx-red)" : pct >= 0.75 ? "var(--ctx-yellow)" : "var(--ctx-blue)";
  const arc = $("#ctx-arc");
  arc.style.stroke = color;
  arc.style.strokeDashoffset = String(50.27 * (1 - pct));
  const btn = $("#ctx-btn");
  btn.querySelector(".pct").textContent = Math.round(pct * 100) + "%";
  btn.classList.toggle("warn", pct >= 0.75 && pct < 0.9);
  btn.classList.toggle("full", pct >= 0.9);
  btn.title = `Контекст: ${fmtTok(used)} из ${fmtTok(max)} токенов`;
  const cb = $("#compress-btn");
  const show = pct >= 0.75 && !s?.busy && (s?.items?.length ?? 0) > 1;
  if (show && cb.classList.contains("hidden")) {
    cb.classList.remove("hidden");
    cb.style.animation = "none";
    void cb.offsetWidth;
    cb.style.animation = "";
  } else if (!show) cb.classList.add("hidden");
  cb.classList.toggle("red", pct >= 0.9);
  cb.classList.toggle("yellow", pct >= 0.75 && pct < 0.9);
  const sp = $("#spend");
  sp.textContent = fmtUsd(s?.stats?.costUsd || 0);
  sp.title = `Потрачено на API в этой сессии: ${fmtUsd(s?.stats?.costUsd || 0)}\nВсего в приложении: ${fmtUsd(app.state?.totalSpentUsd || 0)}`;
}

function ctxPopover() {
  const s = cur();
  const max = (findModel(s.modelRef).model?.context) || 128_000;
  const used = s.stats?.contextTokens || 0;
  showMenu(
    $("#ctx-btn"),
    [
      { label: `Контекст: ${fmtTok(used)} / ${fmtTok(max)}`, desc: `${Math.round((used / max) * 100)}% заполнено · вход ${fmtTok(s.stats?.input || 0)}, выход ${fmtTok(s.stats?.output || 0)}`, onClick: () => {} },
      { label: `Потрачено: ${fmtUsd(s.stats?.costUsd || 0)}`, desc: `Всего в приложении: ${fmtUsd(app.state.totalSpentUsd || 0)}`, onClick: () => {} },
      { label: "Сжать разговор", desc: "Модель сделает выжимку — контекст освободится", onClick: compressNow },
    ],
    { up: false }
  );
}

async function compressNow() {
  const s = cur();
  if (s.busy) return toast("Дождитесь, пока агент закончит");
  if (s.items.length < 2) return toast("Пока нечего сжимать");
  s.busy = true;
  refreshChips();
  pushPart(s, { k: "note", text: "Сжимаю разговор…" }, true);
  const r = await window.xc.agent.compress({ id: s.id, modelRef: s.modelRef });
  s.busy = false;
  const last = s.items[s.items.length - 1];
  last.parts[last.parts.length - 1] = r.ok ? { k: "note", text: `Разговор сжат${r.ratio ? ` примерно в ${Math.round(r.ratio)} раз` : ""}: старая часть — подробным резюме, последние сообщения — как были.` } : { k: "err", text: "Не получилось сжать: " + r.error };
  if (r.ok) {
    s.stats = r.stats;
    app.state.totalSpentUsd = r.totalSpentUsd;
  }
  renderTranscript();
  refreshChips();
  saveSession(s);
}

// ───────────────────────── выбор модели ─────────────────────────
/** Лимит тестирования модели (например, XroMax 2.5 Helium: 175 тыс. токенов за сутки) — процент в выборе модели */
function testNote(provId, modelId) {
  const t = provId === "xromax-free" ? app.account?.tests?.[modelId] : null;
  if (!t || typeof t.pct5h !== "number") return "";
  // только проценты — без числа токенов
  const p5 = Math.round(t.pct5h);
  const pw = Math.round(t.pctWeek);
  const worst = Math.max(p5, pw);
  const cls = worst >= 90 ? "full" : worst >= 75 ? "warn" : "";
  return `<span class="m-note test ${cls}" title="Лимиты XroMax 2.5: 5 часов и неделя (общие для Helium и Xenon)">5 ч: ${p5}% · нед: ${pw}%</span>`;
}
async function openModelPicker() {
  const s = cur();
  app.catalog = await window.xc.models.list();
  const st = await window.xc.state.get();
  app.state = { ...app.state, ...st };
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input placeholder="Поиск моделей" />
      <button class="icon-btn" data-refresh title="Найти новые модели"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg></button>
      <button class="icon-btn" data-add title="Подключить API или модель"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class="icon-btn" data-settings title="Поставщики и ключи"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></button>
    </div><div class="modal-body"></div>`;
  // справа может открыться боковая панель «Другие модели»
  const wrap = document.createElement("div");
  wrap.className = "m-wrap";
  wrap.appendChild(box);
  const close = overlay(wrap);
  const input = box.querySelector("input");
  const body = box.querySelector(".modal-body");
  let side = null;
  box.querySelector("[data-settings]").onclick = () => {
    close();
    openSettings();
  };
  box.querySelector("[data-add]").onclick = () => {
    close();
    openSettings({ focusCustom: true });
  };
  box.querySelector("[data-refresh]").onclick = async (e) => {
    e.currentTarget.style.animation = "spin 1s linear infinite";
    app.catalog = await window.xc.models.refresh();
    e.currentTarget.style.animation = "";
    draw();
    toast("Списки моделей обновлены");
  };
  let rows = [];
  let kb = -1;
  const isDef = (p, m) => app.state.defaultModel?.provider === p && app.state.defaultModel?.model === m;
  function row(p, m, provName) {
    const sel = s.modelRef?.provider === p.id && s.modelRef?.model === m.id;
    const b = document.createElement("button");
    b.className = "m-row";
    const isNewModel = m.created && Date.now() - m.created < 21 * 86400000;
    const soon = m.status === "soon";
    if (soon) b.classList.add("soon");
    b.innerHTML = `<span class="ck">${sel ? "✓" : ""}</span><span class="nm">${esc(m.name)}</span>${provName ? `<span class="pv">${esc(provName)}</span>` : ""}${soon ? '<span class="badge soon">Скоро</span>' : m.plan ? '<span class="badge plan">С лимитом</span>' : m.free ? '<span class="badge">Бесплатно</span>' : ""}${m.badge ? `<span class="badge new">${esc(m.badge)}</span>` : isNewModel ? '<span class="badge new">Новое</span>' : ""}${testNote(p.id, m.id) || (m.plan && estimateFor(p.id, m.id) ? `<span class="m-note">≈ ${fmtReq(estimateFor(p.id, m.id).left5h)} запросов на 5 ч</span>` : m.note ? `<span class="m-note">${esc(m.note)}</span>` : "")}<span class="ctx">${m.context ? fmtTok(m.context) : ""}</span>${soon ? "" : `<span class="def ${isDef(p.id, m.id) ? "is" : ""}" data-def>${isDef(p.id, m.id) ? "По умолчанию" : "Сделать по умолчанию"} ›</span>`}`;
    b.onclick = (e) => {
      if (soon) return toast(`${m.name} скоро появится — следите за обновлениями`);
      if (e.target.closest("[data-def]")) {
        e.stopPropagation();
        app.state.defaultModel = { provider: p.id, model: m.id };
        window.xc.state.set({ defaultModel: app.state.defaultModel });
        draw();
        return;
      }
      pick(p.id, m.id);
    };
    rows.push(b);
    return b;
  }
  function pick(provider, model) {
    setSess({ modelRef: { provider, model } });
    if (findModel(cur().modelRef).provider?.noTools && cur().ultra) setSess({ ultra: false });
    window.xc.models.recent({ provider, model });
    close();
    $("#input").focus();
  }
  function draw() {
    const q = input.value.trim().toLowerCase();
    body.innerHTML = "";
    rows = [];
    kb = -1;
    const match = (g, m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || g.provider.name.toLowerCase().includes(q);
    if (!q && app.state.recents?.length) {
      const recent = app.state.recents
        .map((r) => {
          const g = app.catalog.find((x) => x.provider.id === r.provider);
          const m = g?.models.find((x) => x.id === r.model);
          return g && m ? [g, m] : null;
        })
        .filter(Boolean);
      if (recent.length) {
        body.insertAdjacentHTML("beforeend", '<div class="group-t">Недавние</div>');
        for (const [g, m] of recent) body.appendChild(row(g.provider, m, g.provider.name));
      }
    }
    let any = false;
    // без поиска основной список — модели XroMax; остальные (бесплатные и свои API) — в боковой панели «Другие модели»
    for (const g of app.catalog) {
      if (!q && g.provider.id !== "xromax-free") continue;
      any = renderGroup(body, g, q, q ? null : true) || any;
    }
    if (!q) {
      const others = app.catalog.map((g) => ({ g, n: visibleModels(g, "", false).length })).filter((x) => x.n);
      const n = others.reduce((k, x) => k + x.n, 0);
      const btn = document.createElement("button");
      btn.className = "m-more" + (side ? " on" : "");
      btn.innerHTML = `<span>Другие модели</span><span class="n">${n ? n + " моделей" : "подключите API"}</span><span class="chev">›</span>`;
      btn.onclick = () => (side ? closeSide() : openSide());
      body.appendChild(btn);
      any = true;
    }
    if (!any) body.insertAdjacentHTML("beforeend", '<div class="empty-note">Ничего не найдено. Подключите поставщика кнопкой «+».</div>');
  }
  /** own: true — только модели XroMax, false — все остальные, null — все */
  const isOwn = (g, m) => g.provider.id === "xromax-free" && m.id.startsWith("xromax-");
  function visibleModels(g, q, own = null) {
    const hidden = new Set(app.prefs?.hiddenModels || []);
    const match = (m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || g.provider.name.toLowerCase().includes(q);
    return g.models
      .filter((m) => own === null || isOwn(g, m) === own)
      .filter((m) => match(m) && (!hidden.has(`${g.provider.id}/${m.id}`) || (s.modelRef?.provider === g.provider.id && s.modelRef?.model === m.id)))
      .slice(0, q ? 60 : 200);
  }
  function renderGroup(target, g, q, own = null) {
    const ms = visibleModels(g, q, own);
    if (!ms.length && !(g.error && !q)) return false;
    target.insertAdjacentHTML("beforeend", `<div class="group-t"><span>${esc(g.provider.name)}</span><span>${g.error ? "ошибка: " + esc(g.error.slice(0, 60)) : g.provider.noTools ? "без инструментов" : ""}</span></div>`);
    for (const m of ms) target.appendChild(row(g.provider, m));
    return true;
  }
  function openSide() {
    side = document.createElement("div");
    side.className = "modal m-side";
    side.innerHTML = `<div class="m-side-h"><b>Другие модели</b><button class="icon-btn" data-x title="Закрыть">×</button></div>
      <div class="modal-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input placeholder="Поиск среди других моделей" /></div>
      <div class="modal-body"></div>`;
    wrap.appendChild(side);
    wrap.classList.add("side");
    const sIn = side.querySelector("input");
    const sBody = side.querySelector(".modal-body");
    const drawSide = () => {
      const q = sIn.value.trim().toLowerCase();
      sBody.innerHTML = "";
      let any = false;
      for (const g of app.catalog) any = renderGroup(sBody, g, q, false) || any;
      if (!any) sBody.innerHTML = `<div class="empty-note">${q ? "Ничего не найдено." : "Других моделей пока нет. Подключите свой API — OpenRouter, Anthropic, OpenAI и другие."}</div><div style="padding:0 10px 12px"><button class="btn" data-addapi>+ Подключить API</button></div>`;
      sBody.querySelector("[data-addapi]")?.addEventListener("click", () => (close(), openSettings({ focusCustom: true })));
    };
    sIn.oninput = drawSide;
    side.querySelector("[data-x]").onclick = closeSide;
    drawSide();
    draw();
    setTimeout(() => sIn.focus(), 30);
  }
  function closeSide() {
    side?.remove();
    side = null;
    wrap.classList.remove("side");
    draw();
    input.focus();
  }
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[kb]?.classList.remove("kb");
      kb = Math.max(0, Math.min(rows.length - 1, kb + (e.key === "ArrowDown" ? 1 : -1)));
      rows[kb]?.classList.add("kb");
      rows[kb]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") rows[Math.max(0, kb)]?.click();
  });
  draw();
  input.focus();
}

// ───────────────────────── настройки поставщиков ─────────────────────────
async function openSettings({ focusCustom } = {}) {
  const box = document.createElement("div");
  box.className = "modal settings";
  box.innerHTML = `<div class="modal-search"><h3>Поставщики и ключи</h3><span class="spacer"></span><button class="btn" data-refresh>Обновить списки моделей</button></div><div class="modal-body"></div>`;
  const close = overlay(box, { onClose: () => reloadCatalog() });
  const body = box.querySelector(".modal-body");
  box.querySelector("[data-refresh]").onclick = async (e) => {
    e.currentTarget.textContent = "Обновляю…";
    await window.xc.models.refresh();
    draw();
  };
  async function draw() {
    const list = await window.xc.providers.list();
    body.innerHTML = "";
    for (const p of list) {
      const d = document.createElement("div");
      d.className = "prov";
      const status = !p.needsKey ? "Встроено · бесплатно" : p.hasKey ? (p.error ? "Ошибка: " + p.error.slice(0, 80) : `Подключено · ${p.count} моделей`) : p.oauth ? "Не подключено" : "Нет ключа";
      d.innerHTML = `<div class="prov-top"><span class="nm">${esc(p.name)}</span>${p.custom ? `<span class="badge">свой · ${esc(p.baseUrl || "")}</span>` : ""}${p.noTools ? '<span class="badge">без инструментов</span>' : ""}<span class="st ${p.hasKey || !p.needsKey ? "ok" : ""}">${esc(status)}</span></div>`;
      if (p.local === "agy") {
        fillAgyBlock(d, p, draw);
      } else if (p.oauth) {
        d.insertAdjacentHTML("beforeend", `<div class="prov-key">${p.hasKey ? '<button class="btn" data-gptout>Выйти из ChatGPT</button>' : '<button class="btn primary" data-gptin>Войти через ChatGPT</button>'}</div><small>${esc(p.note || "")}</small>`);
        d.querySelector("[data-gptin]")?.addEventListener("click", async (e) => {
          e.currentTarget.textContent = "Открыл браузер — войдите там…";
          const r = await window.xc.chatgpt.login();
          toast(r.ok ? "ChatGPT подключён" + (r.email ? " · " + r.email : "") : "ChatGPT: " + r.error, 5000);
          draw();
        });
        if (p.hasKey) {
          const lim = document.createElement("small");
          lim.textContent = "Лимиты подписки: загружаю…";
          d.appendChild(lim);
          window.xc.chatgpt.limits().then((L) => (lim.textContent = L ? gptLimitsText(L) : "Лимиты подписки: пока нет данных — появятся после первого ответа"));
        }
        d.querySelector("[data-gptout]")?.addEventListener("click", async () => (await window.xc.chatgpt.logout(), draw()));
      } else if (p.needsKey) {
        d.insertAdjacentHTML(
          "beforeend",
          `<div class="prov-key"><input class="field" type="password" placeholder="${p.hasKey ? "Ключ сохранён — введите новый, чтобы заменить" : "API-ключ"}" /><button class="btn primary" data-save>Сохранить</button>${p.hasKey ? '<button class="btn" data-del>Убрать</button>' : ""}${p.custom ? '<button class="btn" data-remove>Удалить</button>' : ""}</div>${p.keyUrl ? `<small><a data-url="${esc(p.keyUrl)}">Получить ключ</a></small>` : ""}`
        );
        const field = d.querySelector("input");
        d.querySelector("[data-save]").onclick = async (e) => {
          if (!field.value.trim()) return;
          e.currentTarget.textContent = "Проверяю…";
          const r = await window.xc.providers.setKey({ id: p.id, key: field.value });
          toast(r.ok ? `${p.name}: подключено, моделей — ${r.count}` : `${p.name}: ${r.error}`, 5000);
          draw();
        };
        d.querySelector("[data-del]")?.addEventListener("click", async () => {
          await window.xc.providers.setKey({ id: p.id, key: "" });
          draw();
        });
        d.querySelector("[data-remove]")?.addEventListener("click", async () => {
          await window.xc.providers.removeCustom(p.id);
          draw();
        });
        d.querySelector("[data-url]")?.addEventListener("click", (e) => window.xc.openExternal(e.currentTarget.dataset.url));
      } else if (p.note) d.insertAdjacentHTML("beforeend", `<small>${esc(p.note)}</small>`);
      body.appendChild(d);
    }
    // свой API
    const c = document.createElement("div");
    c.className = "prov";
    c.innerHTML = `<div class="prov-top"><span class="nm">Подключить свой API</span><span class="st">любой OpenAI-совместимый или Anthropic</span></div>
      <div class="form-grid"><input class="field" data-n placeholder="Название, например «мой ии»" /><select class="field" data-k><option value="openai">OpenAI-совместимый</option><option value="anthropic">Anthropic</option></select>
      <input class="field" data-u placeholder="Адрес API, например https://api.example.com/v1" /><input class="field" data-key type="password" placeholder="Ключ (если нужен)" /></div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn primary" data-add>Подключить</button></div>`;
    c.querySelector("[data-add]").onclick = async (e) => {
      const baseUrl = c.querySelector("[data-u]").value.trim();
      if (!/^https?:\/\//.test(baseUrl)) return toast("Укажите адрес API, начиная с https://");
      e.currentTarget.textContent = "Проверяю…";
      const r = await window.xc.providers.addCustom({ name: c.querySelector("[data-n]").value, baseUrl, key: c.querySelector("[data-key]").value, kind: c.querySelector("[data-k]").value });
      toast(r.ok ? `Подключено, моделей — ${r.count}` : `Подключено, но список моделей не получен: ${r.error}. Добавьте модель вручную ниже.`, 6000);
      draw();
    };
    body.appendChild(c);
    // своя модель
    const all = list.filter((p) => !p.needsKey || p.hasKey);
    const m = document.createElement("div");
    m.className = "prov";
    m.innerHTML = `<div class="prov-top"><span class="nm">Добавить модель вручную</span><span class="st">если её нет в списке поставщика</span></div>
      <div class="form-grid"><select class="field" data-p>${all.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><input class="field" data-id placeholder="ID модели, например gpt-6-sol" />
      <input class="field" data-nm placeholder="Название (необязательно)" /><input class="field" data-ctx type="number" placeholder="Контекст, токенов (128000)" /></div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn primary" data-addm>Добавить модель</button></div>`;
    m.querySelector("[data-addm]").onclick = async () => {
      const id = m.querySelector("[data-id]").value.trim();
      if (!id) return toast("Укажите ID модели");
      await window.xc.models.addCustom({ provider: m.querySelector("[data-p]").value, id, name: m.querySelector("[data-nm]").value || id, context: m.querySelector("[data-ctx]").value });
      toast("Модель добавлена");
      draw();
    };
    body.appendChild(m);
    if (focusCustom) c.scrollIntoView({ block: "center" });
  }
  draw();
}

async function reloadCatalog() {
  app.catalog = await window.xc.models.list();
  refreshChips();
}

// ───────────────────────── сессии и вкладки ─────────────────────────
function newSessionObj() {
  return {
    id: uid(),
    title: "Сессия",
    workspace: app.state.projects?.[0] || app.state.defaultProject,
    modelRef: app.state.defaultModel,
    thinking: app.state.thinking || "default",
    access: app.state.access || "auto",
    ultra: false,
    items: [],
    stats: { input: 0, output: 0, costUsd: 0, contextTokens: 0 },
    busy: false,
    approvals: [],
  };
}
function saveTabs() {
  localStorage.setItem("xc.tabs", JSON.stringify(app.tabs));
  localStorage.setItem("xc.active", app.active || "");
}
function saveSession(s) {
  if (!s.items.length) return;
  // сами картинки (base64) в сохранённый чат не кладём — только путь к файлу
  const slim = JSON.parse(JSON.stringify(s.items, (k, v) => (k === "src" && typeof v === "string" && v.startsWith("data:") ? undefined : v)));
  window.xc.sessions.save({ id: s.id, title: s.title, workspace: s.workspace, modelRef: s.modelRef, thinking: s.thinking, access: s.access, ultra: s.ultra, daily: s.daily, items: slim });
  // макет «Сессии сбоку»: список слева всегда свежий
  if (document.documentElement.classList.contains("layout-side")) {
    clearTimeout(saveSession.t);
    saveSession.t = setTimeout(() => window.renderSidebar?.(), 400);
  }
}
async function loadSession(id) {
  const d = await window.xc.sessions.get(id);
  if (!d) return null;
  const s = { ...newSessionObj(), ...d, id, busy: false, approvals: [] };
  s.items = (d.items || []).map((it) => ({ ...it, parts: (it.parts || []).filter((p) => !p.retry && p.k !== "draft").map((p) => ({ ...p, live: false, status: p.status === "running" ? "ok" : p.status })) }));
  // ответ шёл, когда приложение закрыли или обновили: «Думает» больше не висит, есть «Попробовать снова»
  const cut = s.items.filter((it) => it.pending);
  for (const it of cut) {
    it.pending = false;
    (it.parts ??= []).push({ k: "note", text: "Ответ прервался — приложение было закрыто или обновлено. Нажмите «Попробовать снова», чтобы продолжить." });
  }
  if (cut.length && cut[cut.length - 1] === s.items[s.items.length - 1]) s.failed = true;
  s.stats = d.stats || s.stats;
  return s;
}
function newTab() {
  const s = newSessionObj();
  app.sessions.set(s.id, s);
  app.tabs.push(s.id);
  activate(s.id);
}
async function openSessionTab(id) {
  if (!app.sessions.has(id)) {
    const s = await loadSession(id);
    if (!s) return;
    app.sessions.set(id, s);
  }
  if (!app.tabs.includes(id)) app.tabs.push(id);
  activate(id);
}
function closeTab(id) {
  const s = app.sessions.get(id);
  if (s?.busy) window.xc.agent.stop(id);
  app.tabs = app.tabs.filter((t) => t !== id);
  if (!s?.items.length) app.sessions.delete(id);
  if (!app.tabs.length) return newTab();
  if (app.active === id) activate(app.tabs[app.tabs.length - 1]);
  else renderTabs();
  saveTabs();
}
function activate(id) {
  app.active = id;
  saveTabs();
  renderTabs();
  // плавная смена вкладки
  const tr = document.getElementById("transcript");
  if (tr) {
    tr.classList.remove("switch-in");
    void tr.offsetWidth;
    tr.classList.add("switch-in");
  }
  placeComposer();
  renderTranscript();
  renderApproval();
  if (cur()?.imageChoice) showImageChoice(cur());
  refreshChips();
  $("#input").focus();
  if (document.documentElement.classList.contains("layout-side")) window.renderSidebar?.();
}
function renderTabs() {
  const box = $("#tabs");
  box.innerHTML = "";
  for (const id of app.tabs) {
    const s = app.sessions.get(id);
    if (!s) continue;
    const t = document.createElement("div");
    t.className = "tab" + (id === app.active ? " active" : "");
    t.innerHTML = `${s.busy ? '<span class="dot"></span>' : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>'}<span class="t">${esc(s.title)}</span><span class="x" title="Закрыть">×</span>`;
    t.onclick = (e) => (e.target.closest(".x") ? closeTab(id) : activate(id));
    t.onauxclick = (e) => e.button === 1 && closeTab(id);
    box.appendChild(t);
  }
  // лента вкладок: колесо крутит вбок, активная всегда видна, края гаснут, если есть скрытые вкладки
  if (!box.dataset.wired) {
    box.dataset.wired = "1";
    box.addEventListener("wheel", (e) => {
      if (box.scrollWidth <= box.clientWidth) return;
      e.preventDefault();
      box.scrollLeft += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    }, { passive: false });
    box.addEventListener("scroll", () => tabFades(box));
    window.addEventListener("resize", () => tabFades(box));
  }
  box.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  tabFades(box);
}
function tabFades(box) {
  box.classList.toggle("fade-l", box.scrollLeft > 2);
  box.classList.toggle("fade-r", box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
}
async function toggleSidebar() {
  const sb = $("#sidebar");
  if (!sb.classList.contains("hidden")) return sb.classList.add("hidden");
  const list = await window.xc.sessions.list();
  sb.innerHTML = `<h4>Сессии</h4>`;
  if (!list.length) sb.insertAdjacentHTML("beforeend", '<div class="empty-note">Пока нет сессий</div>');
  for (const it of list) {
    const b = document.createElement("button");
    b.className = "side-item";
    b.innerHTML = `${esc(it.title || "Сессия")}<small>${esc(baseName(it.workspace))} · ${new Date(it.updatedAt || 0).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>`;
    b.onclick = () => openSessionTab(it.id);
    sb.appendChild(b);
  }
  sb.classList.remove("hidden");
}

// ───────────────────────── переписка ─────────────────────────
function toolArg(name, a = {}) {
  if (name === "run_command") return a.command;
  if (name === "move_path") return `${a.from} → ${a.to}`;
  if (name === "search_text") return `«${a.query}»`;
  if (name === "run_subagents") return `${a.agents?.length || 0} агент(ов)`;
  if (name === "web_search") return a.query ? `«${a.query}»` : "";
  if (name === "web_fetch") return a.url || "";
  return a.path || "";
}
function renderPart(p, idx) {
  if (p.k === "text") return `<div class="md">${window.renderMarkdown(p.text)}</div>`;
  if (p.k === "think") {
    return `<div class="think ${p.live ? "live" : ""} ${p.open ? "open" : ""}" data-i="${idx}"><button class="think-head" data-toggle><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg><span class="think-label">${p.live ? "Думает" : "Размышления"}</span>${p.live ? '<span class="think-dots"><i></i><i></i><i></i></span>' : ""}</button><div class="think-body">${esc(p.text)}</div></div>`;
  }
  if (p.k === "planbar") {
    return p.used
      ? `<div class="planbar used">План передан в работу</div>`
      : `<div class="planbar"><span>План готов. Проверьте его — можно попросить поправить или сразу запустить.</span><button class="plan-go" data-plan-go>▶ Выполнить план</button></div>`;
  }
  if (p.k === "tool" && p.name === "update_todos") {
    if (p.hidden) return "";
    const list = Array.isArray(p.args?.todos) ? p.args.todos : [];
    const done = list.filter((t) => t.status === "completed").length;
    return `<div class="todos"><div class="todos-h"><span>Задачи</span><span>${done}/${list.length}</span></div>${list
      .map((t) => `<div class="todo ${t.status}"><span class="tb">${t.status === "completed" ? "✓" : t.status === "in_progress" ? "" : ""}</span><span>${esc(t.content)}</span></div>`)
      .join("")}</div>`;
  }
  if (p.k === "tool") {
    if (p.name === "run_subagents") return "";
    return `<div class="tool ${p.status} ${p.open ? "open" : ""}" data-i="${idx}"><button class="tool-head" data-toggle><span class="st"></span><span class="name">${esc(TOOL_VERB[p.name] || p.name)}</span><span class="arg">${esc(toolArg(p.name, p.args))}</span></button><div class="tool-out">${esc(p.result ?? "…")}</div></div>`;
  }
  if (p.k === "subs") {
    const done = p.agents.filter((a) => a.status !== "run").length;
    return `<div class="subs"><div class="subs-head"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>UltraCode · агенты ${done}/${p.agents.length}</div><div class="subs-grid">${p.agents
      .map((a, i) => `<div class="sub ${a.status === "done" ? "done" : a.status === "fail" ? "fail" : ""}" style="animation-delay:${i * 50}ms"><div class="r"><span class="led"></span><span class="ttl">${esc(a.title)}</span></div><div class="role">${esc(ROLE_RU[a.role] || a.role)}</div><div class="last">${esc(a.last || "запуск…")}</div></div>`)
      .join("")}</div></div>`;
  }
  if (p.k === "draft") {
    // модель ещё «пишет» вызов инструмента (часто — целый файл): видно, что работа идёт
    const verb = DRAFT_VERB[p.name] || (TOOL_VERB[p.name] || p.name) + "…";
    const size = p.chars >= 1000 ? `${(p.chars / 1000).toFixed(1).replace(".", ",")} тыс. символов` : `${p.chars} символов`;
    const what = p.path || p.command || "";
    return `<div class="tool running draft"><div class="tool-head"><span class="st"></span><span class="name">${esc(verb)}</span><span class="arg">${esc(what)}${what ? " · " : ""}${size}</span></div></div>`;
  }
  if (p.k === "img") {
    if (p.state === "loading") return `<div class="genimg loading"><div class="shimmer"></div><div class="gi-cap"><span class="gi-dot"></span>Рисую картинку…<small>${esc((p.prompt || "").slice(0, 140))}</small></div></div>`;
    if (p.state === "error") return `<div class="err">Картинка не создана: ${esc(p.error || "")}</div>`;
    return p.src
      ? `<figure class="genimg done"><img src="${p.src}" alt=""><figcaption>${esc(p.path || "")}</figcaption></figure>`
      : `<div class="note">Картинка сохранена: ${esc(p.path || "")}</div>`;
  }
  if (p.k === "note") return `<div class="note">${esc(p.text)}</div>`;
  if (p.k === "err") return `<div class="err">${esc(p.text)}</div>`;
  return "";
}
function renderItem(it) {
  const el = document.createElement("div");
  el.className = "msg " + it.role;
  if (it.role === "user") {
    const atts = (it.atts || [])
      .map((a) => (a.kind === "image" ? `<div class="att img" title="${esc(a.name)}"><img src="${a.thumb || ""}" alt=""></div>` : `<div class="att" title="${esc(a.name)}"><span class="fi">${esc(a.pasted ? "txt" : (a.name.split(".").pop() || "txt").slice(0, 4))}</span><span style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="sz">${a.lines || 0} строк</div></span></div>`))
      .join("");
    el.innerHTML = `${atts ? `<div class="atts">${atts}</div>` : ""}${it.text ? `<div class="bubble">${esc(it.text)}</div>` : ""}`;
  }
  else {
    const htmls = assistantHtml(it);
    el.innerHTML = htmls.map((h) => `<div class="pt">${h}</div>`).join("");
    el._h = htmls;
    el.addEventListener("click", (e) => {
      const tg = e.target.closest("[data-toggle]");
      if (tg) {
        const i = Number(tg.parentElement.dataset.i);
        it.parts[i].open = !it.parts[i].open;
        tg.parentElement.classList.toggle("open");
      }
      if (e.target.closest("[data-plan-go]")) {
        const bar = it.parts.find((p) => p.k === "planbar" && !p.used);
        if (bar) executePlan(bar);
        return;
      }
      const cp = e.target.closest("[data-copy]");
      if (cp) {
        navigator.clipboard.writeText(cp.closest("pre").querySelector("code").textContent);
        cp.textContent = "Скопировано";
        setTimeout(() => (cp.textContent = "Копировать"), 1200);
      }
    });
  }
  return el;
}
/** Части ответа по отдельности (последняя — индикатор «Думает», если нужен) */
function assistantHtml(it) {
  const htmls = it.parts.map(renderPart);
  const lastLive = it.parts.some((p) => p.live);
  const tailPart = it.parts[it.parts.length - 1];
  const waitingTool = tailPart?.k === "tool" && tailPart.status === "running";
  if (it.pending && !lastLive && !waitingTool && tailPart?.k !== "text") htmls.push(`<div class="think live"><span class="think-head"><span class="think-label">Думает</span><span class="think-dots"><i></i><i></i><i></i></span></span></div>`);
  return htmls;
}
/** Пока ответ печатается — меняем только изменившиеся части, без пересоздания сообщения (иначе текст моргает) */
function patchItem(el, it) {
  const htmls = assistantHtml(it);
  const old = el._h || [];
  for (let i = 0; i < htmls.length; i++) {
    if (old[i] === htmls[i] && el.children[i]) continue;
    if (el.children[i]) el.children[i].innerHTML = htmls[i];
    else el.insertAdjacentHTML("beforeend", `<div class="pt">${htmls[i]}</div>`);
  }
  while (el.children.length > htmls.length) el.lastElementChild.remove();
  el._h = htmls;
}
function renderTranscript() {
  const s = cur();
  const box = $("#transcript");
  box.innerHTML = "";
  if (!s) return;
  for (const it of s.items) box.appendChild(renderItem(it));
  const sc = $("#scroll");
  sc.scrollTop = sc.scrollHeight;
}
let rafPending = false;
function scheduleLiveRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const s = cur();
    if (!s) return;
    const box = $("#transcript");
    const sc = $("#scroll");
    const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
    const lastEl = box.lastElementChild;
    const last = s.items[s.items.length - 1];
    if (!last) return;
    if (lastEl && box.children.length === s.items.length && last.role === "assistant" && lastEl._h) patchItem(lastEl, last);
    else if (lastEl && box.children.length === s.items.length) box.replaceChild(renderItem(last), lastEl);
    else renderTranscript();
    if (atBottom) sc.scrollTop = sc.scrollHeight;
  });
}
function pushPart(s, part, render) {
  const last = s.items[s.items.length - 1];
  last.parts.push(part);
  if (render && s.id === app.active) scheduleLiveRender();
}

// ───────────────────────── отправка и события агента ─────────────────────────
async function submit(queued) {
  const s = queued ? app.sessions.get(queued.sessionId) : cur();
  if (!s) return;
  const text = queued ? queued.text : $("#input").value.trim();
  if (!queued && !text && !window.xcAttach?.has()) return;
  // нет сети — не отправляем, текст остаётся в поле
  if (app.net?.online === false) return toast("Нестабильное подключение к сети — сообщение не отправлено. Проверьте интернет или включите VPN.", 4500);
  // агент ещё работает: сообщение — в очередь (или остановить и отправить — как выбрано в настройках)
  if (s.busy) {
    if (queued) return;
    const atts = window.xcAttach?.take() ?? [];
    $("#input").value = "";
    autoGrow();
    (s.queue ??= []).push({ sessionId: s.id, text, atts });
    if (app.prefs?.followUp === "stop") stop();
    else toast(`Сообщение в очереди — отправлю, когда агент закончит (${s.queue.length})`);
    return;
  }
  if (!queued && text === "/compact" && !window.xcAttach?.has()) {
    $("#input").value = "";
    autoGrow();
    return compressNow();
  }
  const { provider } = findModel(s.modelRef);
  if (!provider) return toast("Эта модель недоступна — выберите другую или подключите поставщика"), openModelPicker();
  const atts = queued ? queued.atts : window.xcAttach?.take() ?? [];
  if (!queued) {
    $("#input").value = "";
    autoGrow();
  }
  window.xcSound?.("send");
  if (!s.items.length) s.title = (text || atts[0]?.name || "Сессия").replace(/\s+/g, " ").slice(0, 42);
  s.failed = false;
  renderRetryBar();
  s.items.push({ role: "user", text, atts: atts.map((a) => ({ kind: a.kind, name: a.name, thumb: a.thumb, size: a.size, lines: a.lines, pasted: a.pasted })) });
  s.items.push({ role: "assistant", parts: [], pending: true });
  s.busy = true;
  placeComposer();
  renderTabs();
  renderTranscript();
  refreshChips();
  saveSession(s);
  const r = await window.xc.agent.run({ id: s.id, text, modelRef: s.modelRef, fast: !!s.fast, thinking: s.thinking, access: s.access, ultra: s.ultra, daily: s.daily, workspace: s.workspace, attachments: atts.map((a) => ({ kind: a.kind, name: a.name, text: a.text, dataUrl: a.dataUrl })) });
  if (r && r.ok === false) onAgentEvent({ sessionId: s.id, type: "finished", ok: false, error: r.error });
}
function stop() {
  window.xc.agent.stop(app.active);
}
/** «Выполнить план»: режим доступа — обратно на обычный, агент делает то, что спланировал */
function executePlan(bar) {
  const s = cur();
  if (!s || s.busy) return toast("Дождитесь, пока агент закончит");
  bar.used = true;
  const back = s.accessBeforePlan && s.accessBeforePlan !== "plan" ? s.accessBeforePlan : "auto";
  setSess({ access: back });
  submit({ sessionId: s.id, text: "Выполни этот план полностью. Если по ходу что-то пойдёт не так — поправь план и продолжай.", atts: [] });
}
/** «Попробовать снова»: продолжить с места ошибки (без нового сообщения) */
async function retryLast() {
  const s = cur();
  if (!s || s.busy || !s.failed) return;
  const { provider } = findModel(s.modelRef);
  if (!provider) return toast("Эта модель недоступна — выберите другую или подключите поставщика"), openModelPicker();
  s.failed = false;
  renderRetryBar();
  s.items.push({ role: "assistant", parts: [], pending: true });
  s.busy = true;
  renderTabs();
  renderTranscript();
  refreshChips();
  const r = await window.xc.agent.run({ id: s.id, text: "", resume: true, modelRef: s.modelRef, fast: !!s.fast, thinking: s.thinking, access: s.access, ultra: s.ultra, daily: s.daily, workspace: s.workspace, attachments: [] });
  if (r && r.ok === false) onAgentEvent({ sessionId: s.id, type: "finished", ok: false, error: r.error });
}
function renderRetryBar() {
  const slot = $("#retry-bar");
  if (!slot) return;
  const s = cur();
  const show = !!(s && s.failed && !s.busy);
  slot.classList.toggle("hidden", !show);
  if (show && !slot.dataset.wired) {
    slot.dataset.wired = "1";
    slot.querySelector("[data-retry]").onclick = retryLast;
    slot.querySelector("[data-dismiss]").onclick = () => {
      const c = cur();
      if (c) c.failed = false;
      renderRetryBar();
    };
  }
}

function onAgentEvent(e) {
  const s = app.sessions.get(e.sessionId);
  if (!s) return;
  const last = s.items[s.items.length - 1];
  const parts = last?.parts;
  // ответ снова пошёл — убираем строку «переподключаюсь…»
  if (parts && /^(thinking|text|tool|tool_draft|finished)$/.test(e.type)) {
    const ri = parts.findIndex((p) => p.retry);
    if (ri >= 0) parts.splice(ri, 1);
  }
  // черновик вызова инструмента заменяется настоящим вызовом (или пропадает в конце/при обрыве)
  if (parts && /^(tool|text|finished|retry|usage)$/.test(e.type)) {
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].k === "draft") parts.splice(i, 1);
  }
  const tail = parts?.[parts.length - 1];
  const endThinking = () => parts?.forEach((p) => p.k === "think" && (p.live = false));
  switch (e.type) {
    case "step_start":
      if (parts) s.stepFrom = parts.length;
      return;
    case "replace_text": {
      // модель написала вызов инструмента текстом — убираем его из показанного ответа (он выполнится как инструмент)
      if (!parts) return;
      for (let i = parts.length - 1; i >= (s.stepFrom ?? 0); i--) {
        if (parts[i].k !== "text") continue;
        if (e.text) parts[i].text = e.text;
        else parts.splice(i, 1);
        break;
      }
      break;
    }
    case "tool_draft": {
      if (!parts) return;
      endThinking();
      let d = parts.find((p) => p.k === "draft" && p.i === e.i);
      if (!d) parts.push((d = { k: "draft", i: e.i, live: true }));
      Object.assign(d, { name: e.name, chars: e.chars, path: e.path || d.path, command: e.command || d.command });
      break;
    }
    case "retry": {
      if (!parts) return;
      // частичный вывод оборванной попытки выбрасываем — шаг начнётся заново
      parts.splice(Math.min(s.stepFrom ?? parts.length, parts.length));
      const text = e.kind === "server" ? `Сервер модели не отвечает — пробую снова… попытка ${e.attempt} из ${e.max}` : `Связь с моделью прервалась — переподключаюсь… попытка ${e.attempt} из ${e.max}`;
      parts.push({ k: "note", text, retry: true });
      break;
    }
    case "thinking":
      if (tail?.k === "think" && tail.live) tail.text += e.text;
      else parts.push({ k: "think", text: e.text, live: true, open: !!app.prefs?.thinkingOpen });
      break;
    case "text":
      endThinking();
      if (tail?.k === "text") tail.text += e.text;
      else parts.push({ k: "text", text: e.text });
      break;
    case "tool":
      endThinking();
      // список задач показываем один — последний
      if (e.name === "update_todos") parts.forEach((p) => p.k === "tool" && p.name === "update_todos" && (p.hidden = true));
      parts.push({ k: "tool", id: e.id, name: e.name, args: e.args, status: "running", open: false });
      break;
    case "tool_result": {
      const t = parts.find((p) => p.k === "tool" && p.id === e.id);
      if (t) {
        t.result = e.result;
        t.status = /^The user denied/.test(e.result) ? "denied" : "ok";
      }
      break;
    }
    case "image_choice":
      endThinking();
      s.imageChoice = e;
      window.xcSound?.("approval");
      if (s.id === app.active) showImageChoice(s);
      else toast(`«${s.title}»: агент просит выбрать генератор картинок`);
      return;
    case "image_start":
      parts.push({ k: "img", id: e.reqId, state: "loading", prompt: e.prompt });
      break;
    case "image_done": {
      const ip = parts.find((p) => p.k === "img" && p.id === e.reqId);
      if (ip) Object.assign(ip, e.error ? { state: "error", error: e.error } : { state: "done", src: e.src, path: e.path });
      else if (!e.error) parts.push({ k: "img", id: e.reqId, state: "done", src: e.src, path: e.path });
      break;
    }
    case "approval":
      s.approvals.push(e);
      window.xcSound?.("approval");
      if (s.id === app.active) renderApproval();
      else {
        toast(`«${s.title}»: агент ждёт разрешения`);
        renderTabs();
      }
      return;
    case "usage":
      s.stats = e.stats;
      app.state.totalSpentUsd = e.totalSpentUsd;
      if (s.id === app.active) updateMeter();
      return;
    case "subagents_start":
      endThinking();
      parts.push({ k: "subs", runId: e.runId, agents: e.agents.map((a) => ({ ...a, status: "run", last: "" })), live: true });
      break;
    case "subagent_event": {
      const sp = parts.find((p) => p.k === "subs" && p.runId === e.runId);
      const a = sp?.agents[e.i];
      if (!a) break;
      const ev = e.event;
      if (ev.type === "tool") a.last = `${TOOL_VERB[ev.name] || ev.name} ${toolArg(ev.name, ev.args) || ""}`.trim();
      else if (ev.type === "thinking") a.last = "думает…";
      else if (ev.type === "text") a.last = "пишет отчёт…";
      else if (ev.type === "approval") return;
      else if (ev.type === "finished") {
        a.status = ev.ok ? "done" : "fail";
        a.last = ev.ok ? "готово" : "ошибка: " + (ev.error || "");
      }
      break;
    }
    case "subagents_end": {
      const sp = parts.find((p) => p.k === "subs" && p.runId === e.runId);
      if (sp) sp.live = false;
      break;
    }
    case "notice":
      parts.push({ k: "note", text: e.text });
      break;
    case "compress_start":
      parts.push({ k: "note", text: "Контекст почти заполнен — сжимаю разговор перед ответом…" });
      break;
    case "compress_end":
      parts.push({ k: e.ok ? "note" : "err", text: e.ok ? `Разговор сжат${e.ratio ? ` примерно в ${Math.round(e.ratio)} раз` : ""}.` : "Не получилось сжать: " + e.error });
      if (e.stats) s.stats = e.stats;
      break;
    case "finished":
      endThinking();
      last.pending = false;
      s.busy = false;
      s.approvals = [];
      if (e.stopped) parts.push({ k: "note", text: "Остановлено." });
      else if (!e.ok) parts.push({ k: "err", text: humanError(e) });
      else if (s.access === "plan") parts.push({ k: "planbar" });
      // над полем ввода — плашка «Попробовать снова», пока не отправят что-то новое
      s.failed = !e.ok && !e.stopped && e.retryable !== false;
      if (s.id === app.active) {
        renderRetryBar();
        renderApproval();
        refreshChips();
      }
      renderTabs();
      saveSession(s);
      window.xcSound?.(e.ok ? "done" : e.stopped ? null : "error");
      setTimeout(() => window.refreshLimits?.(), 600);
      // сообщения, написанные во время работы, — по очереди
      if (s.queue?.length) {
        const next = s.queue.shift();
        setTimeout(() => submit(next), 300);
      }
      break;
    default:
      return;
  }
  if (s.id === app.active) scheduleLiveRender();
}
function humanError(e) {
  const st = e.status;
  const msg = String(e.error || "");
  // лимит тарифа XroMax: сообщение приходит с сайта уже понятным (на языке пользователя)
  if (/5-hour|weekly|5-часов|недельн|лимит/i.test(msg) && /limit|лимит/i.test(msg)) return "Лимит: " + msg.replace(/^Error:\s*/, "") + " XroMax 2.0 Truo и Lite работают без лимитов.";
  if (/isn.t available on the|недоступна на плане|not available on the/i.test(msg)) return msg + " Выберите другую модель.";
  // понятное объяснение с сервера XroMax (модель приостановлена, нужно обновить приложение, запрос заблокирован фильтром, аккаунт ограничен) — показываем как есть
  if ((st === 400 || st === 403 || st === 426) && /[а-яё]{4,}/i.test(msg) && msg.length > 20) return msg.replace(/^Error:\s*/, "");
  if (st === 401 || st === 403) return "Ключ не подошёл (" + st + "). Проверьте его в настройках поставщика.";
  if (st === 402) return "На балансе поставщика закончились деньги.";
  if (st === 429) return "Поставщик просит подождать: слишком много запросов. Попробуйте через минуту.";
  if (st === 404) return "Модель не найдена у поставщика. Выберите другую.";
  if (!st && /terminated|fetch failed|ECONNRESET|socket|network|ended early/i.test(msg)) return "Связь с моделью оборвалась — 10 попыток переподключения не помогли. Проверьте интернет и нажмите «Попробовать снова».";
  if (st >= 500) return `Сервер модели не отвечает (${st}) — 15 попыток не помогли. Нажмите «Попробовать снова» чуть позже или выберите другую модель.`;
  return "Ошибка: " + (e.error || "неизвестная");
}

// ───────────────────────── подтверждение действия ─────────────────────────
/** Выбор генератора и силы для картинки (агент вызвал generate_image) */
function showImageChoice(s) {
  const e = s.imageChoice;
  if (!e || document.querySelector(".img-choice")) return;
  const box = document.createElement("div");
  box.className = "img-choice";
  const provs = e.providers;
  box.innerHTML = `<h3>Создать картинку</h3><label class="ic-l">Описание<textarea rows="4">${esc(e.prompt)}</textarea></label>
    <div class="ic-l">Генератор<div class="ic-opts">${provs.map((p, i) => `<button class="ic-opt ${i === 0 ? "on" : ""}" data-p="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.note || "")}</small></button>`).join("")}</div></div>
    <div class="ic-l ic-q">Сила<div class="seg"></div></div>
    <div class="ic-act"><button class="btn" data-no>Отмена</button><button class="btn primary" data-go>Создать</button></div>`;
  let prov = provs[0].id;
  let q = "medium";
  const drawQ = () => {
    const p = provs.find((x) => x.id === prov);
    const wrap = box.querySelector(".ic-q");
    wrap.style.display = p.qualities.length ? "" : "none";
    box.querySelector(".ic-q .seg").innerHTML = p.qualities.map(([id, l]) => `<button data-q="${id}" class="${id === q ? "on" : ""}">${l}</button>`).join("");
    box.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => ((q = b.dataset.q), drawQ())));
  };
  box.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => ((prov = b.dataset.p), box.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === b)), drawQ())));
  drawQ();
  const reply = (choice) => {
    s.imageChoice = null;
    close();
    window.xc.image.choose({ reqId: e.reqId, choice });
  };
  const close = overlay(box, { onClose: () => s.imageChoice && reply(null) });
  box.querySelector("[data-no]").onclick = () => reply(null);
  box.querySelector("[data-go]").onclick = () => reply({ provider: prov, quality: q, prompt: box.querySelector("textarea").value.trim() });
}
function renderApproval() {
  const slot = $("#approval-slot");
  slot.innerHTML = "";
  const s = cur();
  const a = s?.approvals?.[0];
  if (!a) return;
  const what =
    a.tool === "run_command" ? `Выполнить команду` : a.tool === "delete_path" ? `Удалить` : a.tool === "move_path" ? "Переместить" : a.tool === "write_file" ? "Записать файл" : a.tool === "edit_file" ? "Изменить файл" : a.tool === "book_or_pickup" ? (a.args.kind === "reserve" ? "Забронировать товар" : "Оформить самовывоз") : TOOL_VERB[a.tool] || a.tool;
  const detail = a.tool === "book_or_pickup" ? `${a.args.item} — ${a.args.place}${a.args.when ? `, ${a.args.when}` : ""}\nПриложение само ничего не оплачивает: покажет контакты магазина, текст сообщения и маршрут.` : a.tool === "run_command" ? a.args.command : a.tool === "move_path" ? `${a.args.from} → ${a.args.to}` : a.args.path || JSON.stringify(a.args);
  const el = document.createElement("div");
  el.id = "approval";
  if (a.level === "danger") el.className = "danger";
  el.innerHTML = `<div class="a-top"><div class="a-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="M12 8v5M12 16h.01"/></svg></div>
    <div style="min-width:0;flex:1"><div class="a-title">${a.agent ? `Агент «${esc(a.agent)}» хочет: ` : "Агент хочет: "}${esc(what)}</div><div class="a-why">${a.level === "danger" ? "Опасное действие: " + esc(a.reason) : "Нужно ваше разрешение"}</div><pre>${esc(detail || "")}</pre></div></div>
    <div class="a-btns"><button class="btn" data-d="deny">Отклонить</button>${a.tool === "book_or_pickup" ? "" : `<button class="btn" data-d="allow_session">Разрешать в этой сессии</button>`}<button class="btn ${a.level === "danger" ? "red" : "primary"}" data-d="allow">Разрешить</button></div>`;
  el.querySelectorAll("[data-d]").forEach((b) => {
    b.onclick = () => {
      window.xc.agent.approve({ reqId: a.reqId, decision: b.dataset.d });
      s.approvals.shift();
      renderApproval();
      renderTabs();
    };
  });
  slot.appendChild(el);
}

// ───────────────────────── запуск ─────────────────────────
async function init() {
  app.state = await window.xc.state.get();
  app.catalog = await window.xc.models.list();
  drawLogo();
  mountComposer();
  window.xc.agent.onEvent(onAgentEvent);
  window.xc.models.onUpdated(reloadCatalog);
  $("#new-tab").onclick = newTab;
  $("#side-toggle").onclick = toggleSidebar;
  $("#settings-btn").onclick = () => openSettings();
  $("#ctx-btn").onclick = ctxPopover;
  $("#compress-btn").onclick = compressNow;
  $("#spend").onclick = ctxPopover;
  // горячие клавиши — настраиваются на странице «Настройки» (settings.js)
  let tabs = [];
  try {
    tabs = JSON.parse(localStorage.getItem("xc.tabs") || "[]");
  } catch {}
  for (const id of tabs) {
    const s = await loadSession(id);
    if (s) {
      app.sessions.set(id, s);
      app.tabs.push(id);
    }
  }
  const want = localStorage.getItem("xc.active");
  if (!app.tabs.length) newTab();
  else activate(app.tabs.includes(want) ? want : app.tabs[0]);
}
init();
