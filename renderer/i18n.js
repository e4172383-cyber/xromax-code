// XroMax Code: язык интерфейса. Исходные тексты в коде — русские; для другого языка загружается словарь
// i18n/<код>.json (русская строка → перевод), и всё, что показано на экране, переводится на лету:
// текстовые узлы и атрибуты placeholder/title/aria-label/alt (включая то, что рисуется позже — через MutationObserver).
// Порядок: точное совпадение → шаблон с {0}… → замена известных кусков внутри строки (самые длинные первыми).
(function () {
  const CYR = /[А-Яа-яЁё]/;
  const ATTRS = ["placeholder", "title", "aria-label", "alt"];
  const RTL = new Set(["ar", "he"]);
  let dict = null; // Map ru → перевод
  let patterns = []; // [{re, tpl}]
  let frags = []; // [[ru, tr]] от длинных к коротким
  let observer = null;
  const cache = new Map();

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function build(obj) {
    dict = new Map(Object.entries(obj));
    patterns = [];
    frags = [];
    for (const [ru, tr] of dict) {
      if (/\{\d+\}/.test(ru)) {
        // «Перенесено чатов: {0}» → /^Перенесено чатов: (.+?)$/
        const parts = ru.split(/\{\d+\}/).map(esc);
        const order = [...ru.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
        patterns.push({ re: new RegExp("^" + parts.join("([\\s\\S]*?)") + "$"), tpl: tr, order });
      } else if (ru.length >= 3 && ru !== tr) frags.push([ru, tr]);
    }
    patterns.sort((a, b) => b.re.source.length - a.re.source.length);
    frags.sort((a, b) => b[0].length - a[0].length);
    cache.clear();
  }

  function tr(text) {
    if (!dict || !text || !CYR.test(text)) return text;
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const lead = /^\s*/.exec(text)[0];
    const trail = /\s*$/.exec(text)[0];
    const core = text.trim().replace(/\s+/g, " ");
    let res = null;
    if (dict.has(core)) res = dict.get(core);
    if (res == null) {
      for (const p of patterns) {
        const m = p.re.exec(core);
        if (m) {
          res = p.tpl.replace(/\{(\d+)\}/g, (_, i) => {
            const k = p.order.indexOf(Number(i));
            return tr(m[k + 1] ?? "");
          });
          break;
        }
      }
    }
    if (res == null) {
      res = core;
      for (const [ru, t] of frags) if (res.includes(ru)) res = res.split(ru).join(t);
    }
    const out = lead + res + trail;
    if (cache.size > 5000) cache.clear();
    cache.set(text, out);
    return out;
  }

  const SKIP = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);
  function translateNode(root) {
    if (!dict || !root) return;
    if (root.nodeType === 3) {
      const t = tr(root.nodeValue);
      if (t !== root.nodeValue) root.nodeValue = t;
      return;
    }
    if (root.nodeType !== 1 || root.tagName === "SCRIPT" || root.tagName === "STYLE") return;
    // сообщения модели и код пользователя не трогаем: переводим только интерфейс
    if (root.closest?.(".md, .bubble, .think-body, .tool-out, [data-no-i18n]")) return;
    // атрибуты (подсказки, placeholder) — у всех элементов, в том числе у полей ввода
    for (const a of ATTRS) {
      const v = root.getAttribute?.(a);
      if (v && CYR.test(v)) {
        const t = tr(v);
        if (t !== v) root.setAttribute(a, t);
      }
    }
    if (SKIP.has(root.tagName)) return; // содержимое кода и текстовых полей не переводим
    for (let c = root.firstChild; c; c = c.nextSibling) translateNode(c);
  }

  function observe() {
    observer?.disconnect();
    if (!dict) return;
    observer = new MutationObserver((muts) => {
      observer.disconnect();
      for (const m of muts) {
        if (m.type === "characterData") translateNode(m.target);
        else if (m.type === "attributes") translateNode(m.target);
        else for (const n of m.addedNodes) translateNode(n);
      }
      attach();
    });
    attach();
  }
  function attach() {
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  /** Сменить язык: ru — как в коде, иначе грузим словарь */
  let loaded = "";
  async function setLanguage(code) {
    // словарь ключуется русскими строками: уже переведённое окно в другой язык «на лету» не переключить — перезагружаем
    if (dict && code !== loaded) return location.reload();
    document.documentElement.lang = code || "ru";
    document.documentElement.dir = RTL.has(code) ? "rtl" : "ltr";
    if (!code || code === "ru") {
      if (dict) location.reload(); // вернуться к русскому проще перезагрузкой окна
      return;
    }
    // словарь — скрипт i18n/<код>.js (fetch запрещён политикой окна)
    try {
      await new Promise((res, rej) => {
        const el = document.createElement("script");
        el.src = `../i18n/${code}.js`;
        el.onload = res;
        el.onerror = rej;
        document.head.appendChild(el);
      });
      build(window.__i18nDict || {});
      loaded = code;
      delete window.__i18nDict;
    } catch {
      dict = null;
      return;
    }
    translateNode(document.body);
    translateNode(document.querySelector("title"));
    observe();
  }

  window.i18n = { setLanguage, tr: (s) => tr(String(s)), active: () => !!dict };
  // для сообщений, которые рисует JS (toast, confirm и т. п.)
  window.tr = (s) => tr(String(s));
})();
