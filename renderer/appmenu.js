// Главное меню приложения (кнопка ☰ слева вверху): Файл / Правка / Вид / Переход / Окно / Справка.
// Заменяет прежнюю кнопку боковой панели — список сессий теперь в «Вид → Список сессий» (и по Ctrl+B).
(function () {
  const SITE = "https://xromax-ai.defhosting.com";
  const w = (n) => () => window.xc.win.action(n);
  const go = (d) => () => {
    const i = app.tabs.indexOf(app.active);
    if (i < 0 || app.tabs.length < 2) return;
    activate(app.tabs[(i + d + app.tabs.length) % app.tabs.length]);
  };
  const click = (sel) => () => document.querySelector(sel)?.click();
  const MENU = [
    ["Файл", [
      ["Новая сессия", "Ctrl+T", click("#new-tab")],
      ["Настройки", "Ctrl+,", () => (typeof openSettingsPage === "function" ? openSettingsPage() : click("#settings-btn")())],
      "-",
      ["Закрыть окно", "Ctrl+Shift+W", w("close")],
    ]],
    ["Правка", [
      ["Отменить", "Ctrl+Z", w("undo")],
      ["Повторить", "Ctrl+Y", w("redo")],
      "-",
      ["Вырезать", "Ctrl+X", w("cut")],
      ["Копировать", "Ctrl+C", w("copy")],
      ["Вставить", "Ctrl+V", w("paste")],
      ["Удалить", "", w("delete")],
      ["Выбрать всё", "Ctrl+A", w("selectAll")],
    ]],
    ["Вид", [
      ["Список сессий", "Ctrl+B", () => toggleSidebar2()],
      "-",
      ["Перезагрузить", "", w("reload")],
      "-",
      ["Фактический размер", "Ctrl+0", w("zoomReset")],
      ["Увеличить", "Ctrl++", w("zoomIn")],
      ["Уменьшить", "Ctrl+-", w("zoomOut")],
      "-",
      ["Переключить полноэкранный режим", "F11", w("fullscreen")],
    ]],
    ["Переход", [
      ["Предыдущая сессия", "Alt+↑", go(-1)],
      ["Следующая сессия", "Alt+↓", go(1)],
    ]],
    ["Окно", [
      ["Свернуть", "", w("minimize")],
      ["Развернуть", "", w("maximize")],
      "-",
      ["Закрыть окно", "", w("close")],
    ]],
    ["Справка", [
      ["Сайт XroMax", "", () => window.xc.openExternal(SITE)],
      ["Условия и конфиденциальность", "", () => window.xc.openExternal(SITE + "/terms")],
      "-",
      ["Отправить отзыв", "", click("#bug-btn")],
      ["Сообщить об ошибке", "", click("#bug-btn")],
    ]],
  ];

  let root = null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function close() {
    root?.remove();
    root = null;
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  const outside = (e) => {
    if (root && !root.contains(e.target) && !e.target.closest("#side-toggle")) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  function open() {
    if (root) return close();
    const btn = document.getElementById("side-toggle");
    const r = btn.getBoundingClientRect();
    root = document.createElement("div");
    root.id = "appmenu";
    root.style.left = r.left + "px";
    root.style.top = r.bottom + 6 + "px";
    root.innerHTML =
      `<div class="am-title">XroMax Code</div>` +
      MENU.map(([name], i) => `<div class="am-item" data-i="${i}"><span>${esc(name)}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></div>`).join("");
    // не отнимаем фокус у поля ввода — иначе «Вставить/Копировать» не сработают
    root.addEventListener("mousedown", (e) => e.preventDefault());
    root.querySelectorAll(".am-item").forEach((el) => {
      el.addEventListener("mouseenter", () => sub(el));
      el.addEventListener("click", () => sub(el));
    });
    document.body.appendChild(root);
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", onKey, true);
  }
  function sub(el) {
    root.querySelectorAll(".am-sub").forEach((x) => x.remove());
    root.querySelectorAll(".am-item.on").forEach((x) => x.classList.remove("on"));
    el.classList.add("on");
    const items = MENU[Number(el.dataset.i)][1];
    const s = document.createElement("div");
    s.className = "am-sub";
    s.innerHTML = items
      .map((it, i) => (it === "-" ? `<div class="am-sep"></div>` : `<div class="am-row" data-k="${i}"><span>${esc(it[0])}</span><kbd>${esc(it[1])}</kbd></div>`))
      .join("");
    s.querySelectorAll(".am-row").forEach((row) =>
      row.addEventListener("click", () => {
        const fn = items[Number(row.dataset.k)][2];
        close();
        setTimeout(() => fn(), 30);
      })
    );
    const r = el.getBoundingClientRect();
    s.style.left = r.right + 4 + "px";
    s.style.top = r.top - 6 + "px";
    document.body.appendChild(s);
    const b = s.getBoundingClientRect();
    if (b.right > innerWidth - 8) s.style.left = Math.max(8, r.left - b.width - 4) + "px";
    if (b.bottom > innerHeight - 8) s.style.top = Math.max(8, innerHeight - b.height - 8) + "px";
    // подменю лежит вне #appmenu — закрываем и его вместе с меню
    const rm = close;
    close = function () {
      s.remove();
      rm();
    };
  }
  const start = () => {
    const btn = document.getElementById("side-toggle");
    if (btn) btn.onclick = open; // перекрывает прежний обработчик боковой панели
  };
  // extras.js вешает свой onclick после загрузки, поэтому перекрываем чуть позже
  setTimeout(start, 400);
  setTimeout(start, 1500);
})();
