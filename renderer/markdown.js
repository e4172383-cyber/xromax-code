// Небольшой безопасный Markdown для ответов ИИ: сначала экранируем HTML, потом размечаем.
(function () {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function inline(s) {
    // s уже экранирована
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = s
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
      .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<i>$2</i>")
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function render(md) {
    const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let list = null; // "ul" | "ol"
    let para = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${inline(esc(para.join("\n"))).replace(/\n/g, "<br>")}</p>`);
      para = [];
    };
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };
    while (i < lines.length) {
      const line = lines[i];
      const fence = /^\s*```\s*([\w#+.-]*)/.exec(line);
      if (fence) {
        flushPara();
        closeList();
        const lang = fence[1] || "";
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++; // закрывающая ``` (или конец, пока ответ печатается)
        out.push(
          `<pre><div class="code-head"><span>${esc(lang || "code")}</span><button class="copy" data-copy>Копировать</button></div><code>${esc(body.join("\n"))}</code></pre>`
        );
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        flushPara();
        closeList();
        const n = Math.min(3, h[1].length);
        out.push(`<h${n}>${inline(esc(h[2]))}</h${n}>`);
        i++;
        continue;
      }
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara();
        const kind = ul ? "ul" : "ol";
        if (list !== kind) {
          closeList();
          out.push(`<${kind}>`);
          list = kind;
        }
        out.push(`<li>${inline(esc((ul || ol)[1]))}</li>`);
        i++;
        continue;
      }
      if (!line.trim()) {
        flushPara();
        closeList();
        i++;
        continue;
      }
      closeList();
      para.push(line);
      i++;
    }
    flushPara();
    closeList();
    return out.join("");
  }

  window.renderMarkdown = render;
  window.escapeHtml = esc;
})();
