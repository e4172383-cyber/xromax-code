// XroMax Code: цикл агента. Модель отвечает, вызывает инструменты, получает результаты — пока задача не готова.
// Режим доступа решает, о чём спрашивать человека. UltraCode добавляет инструмент run_subagents:
// главный агент запускает до 11 субагентов параллельно (исполнители, критики, тестировщики, дизайн-ревью).
const os = require("os");
const { TOOLS, runTool, assessRisk, needsApproval, clip } = require("./tools");
const { complete } = require("./llm");
const { shrinkHistory, shrinkTools } = require("./saver");

const MAX_PARALLEL = 11;
/** Сколько субагентов одновременно в UltraCode: у XroMax 2.5 Xenon — до 24, у остальных моделей — до 11 */
const XENON_ID = "xromax-2.5-xenon";
const agentCap = (model) => (model === XENON_ID ? 24 : MAX_PARALLEL);
/** Настройка «агентов параллельно» (1–11) только уменьшает лимит; значение по умолчанию (11 и выше) = максимум модели */
const agentLimit = (opts) => (Number(opts.maxParallel) >= MAX_PARALLEL || !opts.maxParallel ? agentCap(opts.model) : Math.min(Number(opts.maxParallel), agentCap(opts.model)));

const subagentsTool = (cap) => ({
  name: "run_subagents",
  description:
    `Run up to ${cap} sub-agents in parallel. Each gets its own task, works in the same workspace with the same tools, and returns a report. ` +
    "Use roles: builder (implements a part), critic (reviews code or a plan and lists concrete problems), tester (runs and writes tests, hunts bugs), designer (reviews a website's look, layout, responsiveness, accessibility). " +
    "Give each task everything it needs (files, goal, constraints): sub-agents don't see this conversation. Split work so parallel builders don't edit the same files.",
  parameters: {
    type: "object",
    properties: {
      agents: {
        type: "array",
        maxItems: cap,
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["builder", "critic", "tester", "designer", "researcher"] },
            title: { type: "string", description: "Short label shown to the user, 2-5 words." },
            task: { type: "string", description: "Full self-contained instructions." },
          },
          required: ["role", "title", "task"],
        },
      },
    },
    required: ["agents"],
  },
});
const SUBAGENTS_TOOL = subagentsTool(MAX_PARALLEL); // для совместимости (тесты); в работе — subagentsTool(agentCap(модель))

/** Встроенный плагин «Команда субагентов»: всегда включён. Агент сам создаёт обученных субагентов и вызывает их. */
const CREATE_AGENT_TOOL = {
  name: "create_subagent",
  description:
    "Create (or update) a reusable custom sub-agent for the user: a specialist with its own permanent instructions (its 'training'). Use when the user asks to create/train a sub-agent or when a recurring specialist role would help. Write detailed instructions: role, expertise, rules, output format.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short unique name, latin letters, digits, dashes (e.g. code-reviewer)." },
      description: { type: "string", description: "One line: what this sub-agent does and when to call it." },
      instructions: { type: "string", description: "Full system instructions (its training): role, knowledge, rules, style, report format." },
    },
    required: ["name", "description", "instructions"],
  },
};
const RUN_AGENT_TOOL = {
  name: "run_custom_agent",
  description: "Run one of the user's custom sub-agents (listed in the system prompt) on a self-contained task. It works in the same workspace with the same tools and returns a report. It doesn't see this conversation: give it all it needs.",
  parameters: { type: "object", properties: { agent: { type: "string" }, task: { type: "string" } }, required: ["agent", "task"] },
};

const GENERATE_IMAGE_TOOL = {
  name: "generate_image",
  description: "Generate an image (picture, photo, illustration, logo, texture). Call it whenever the user asks to draw or create an image. The app asks the user which generator to use and how strong; the picture is saved in the workspace (generated-images) and shown to the user. Write a rich, specific English prompt.",
  parameters: { type: "object", properties: { prompt: { type: "string", description: "Detailed description of the image." } }, required: ["prompt"] },
};

const USE_SKILL_TOOL = {
  name: "use_skill",
  description: "Load the full instructions of a skill by name (see the Skills list in the system prompt). Call it before doing a task the skill covers.",
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
};

const ACCESS_TEXT = {
  auto: "Access mode: Auto. Work freely; the app itself pauses to ask the user before strongly dangerous actions (deleting outside the project, system folders, registry, force-push and similar). Don't ask for permission in text.",
  full: "Access mode: Full access. Every action is allowed without confirmation. Still never do destructive things the user didn't ask for.",
  ask: "Access mode: Ask always. The app asks the user before every change and command; if an action is denied, adapt and continue.",
  plan:
    "PLAN MODE: you may only read and research (list_files, read_file, search_text, web_search, web_fetch). You can't change files or run commands. Study the code and the task, then answer with a clear step-by-step plan in Markdown: goal, the files to create or change and what exactly to do in each, risks, and how to verify it. Ask only if something important is truly unclear. The user will press «Выполнить план» to let you do it.",
};
/** «Создал / записал / исправил…» — утверждение, что действие выполнено */
const CLAIM_RE =
  /(?:^|[^а-яё])(?:создал|записал|изменил|обновил|удалил|добавил|сохранил|исправил|запустил|установил|переименовал|переместил|отредактировал|написал файл|сделал файл)[аи]?(?![а-яё])|\bI(?:'ve| have)? (?:created|written|wrote|updated|modified|deleted|added|saved|fixed|installed|ran|edited|renamed)\b|\b(?:file|files) (?:has|have) been (?:created|updated|saved|written)\b/i;

/**
 * Вызовы инструментов, написанные текстом: <tool_call>{...}</tool_call>, <function=name>{...}</function>,
 * ```json {"name": ..., "arguments": {...}}``` — только для известных инструментов.
 */
function textToolCalls(content, names) {
  const text = String(content || "");
  const calls = [];
  let rest = text;
  const add = (name, args, raw) => {
    if (!names.has(name)) return;
    calls.push({ id: `call_txt_${Date.now()}_${calls.length}`, name, args: typeof args === "string" ? args : JSON.stringify(args ?? {}) });
    rest = rest.replace(raw, "");
  };
  const tryJson = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    const j = tryJson(m[1]);
    if (j && typeof j.name === "string") add(j.name, j.arguments ?? j.parameters ?? {}, m[0]);
  }
  for (const m of text.matchAll(/<function=([\w.-]+)>\s*([\s\S]*?)\s*<\/function>/g)) add(m[1], tryJson(m[2]) ?? {}, m[0]);
  if (!calls.length) {
    for (const m of text.matchAll(/```(?:json|tool_call|tool)?\s*(\{[\s\S]*?\})\s*```/g)) {
      const j = tryJson(m[1]);
      if (j && typeof j.name === "string" && (j.arguments || j.parameters)) add(j.name, j.arguments ?? j.parameters, m[0]);
    }
  }
  return { calls, rest: rest.replace(/\n{3,}/g, "\n\n").trim() };
}

const PLAN_TOOLS = new Set(["list_files", "read_file", "search_text", "web_search", "web_fetch", "update_todos", "use_skill"]);

function systemPrompt({ workspace, access, ultra, role, modelName, ownApi, region, model: modelId, customPrompt, agentTitle, folders }) {
  // реальные пути папок пользователя (рабочий стол может быть в OneDrive) — чтобы «на рабочем столе» не превращалось в папку проекта
  const where0 = folders?.desktop
    ? [`User's folders: Desktop = ${folders.desktop}; Documents = ${folders.documents}; Downloads = ${folders.downloads}. When the user says "on the desktop" / «на рабочем столе» (or Documents / Downloads), use these absolute paths — NOT the workspace folder and not the home folder. Use the workspace only when the user doesn't name a place.`]
    : [];
  const where = region ? [`User's approximate location (from Windows settings): ${region}.`] : [];
  // Свой API пользователя без UltraCode: не навязываем модели промт XROMAX — только минимум,
  // чтобы инструменты работали (человек платит за свои токены сам).
  if (ownApi && !ultra && !role) {
    return [
      "You are a coding assistant with tools to work with files and run commands on this Windows PC.",
      `Workspace folder: ${workspace}`,
      `OS: Windows (${os.release()}), home: ${os.homedir()}. Shell for run_command: PowerShell.`,
      ACCESS_TEXT[access] ?? ACCESS_TEXT.auto,
      "Answer in the user's language.",
      ...where0,
      ...where,
    ].join("\n");
  }
  const lines = [
    role
      ? `You are a ${role} sub-agent inside XroMax Code, working for the main agent on one task. Do the task fully, then reply with a short report: what you did or found, files touched, problems left.` +
        (customPrompt ? `

You are the custom sub-agent "${agentTitle}". Your permanent instructions:
${customPrompt}` : "")
      : `You are the AI coding agent inside XroMax Code, a desktop app for Windows. You are running on the model "${modelName}".`,
    `Workspace folder: ${workspace}`,
    `OS: Windows (${os.release()}), home: ${os.homedir()}. Shell for run_command: PowerShell.`,
    ACCESS_TEXT[access] ?? ACCESS_TEXT.auto,
    "Work like a senior engineer: read the relevant files first, make focused edits with edit_file, create files with write_file, run commands to install, build and test, and fix the errors you see. Verify before you say it works.",
    "Answer in the user's language. Keep answers short and concrete; after finishing, say briefly what you did and where.",
    ...where0,
    ...where,
  ];
  if (role === "critic") lines.push("As a critic: read the code, find real bugs, security issues and gaps against the task. Report each with file:line and a concrete fix. Don't edit files unless the task says so.");
  if (role === "tester") lines.push("As a tester: run the project and its tests, write missing tests for the main paths, try edge cases, and report each failure with how to reproduce it.");
  if (role === "designer") lines.push("As a design reviewer: check the website's visual hierarchy, typography, spacing, colors and contrast, responsiveness (360px to 1440px), states and accessibility. Fix what's clearly broken; report the rest.");
  if (ultra && !role) {
    lines.push(
      `UltraCode is ON: aim for the highest quality. For non-trivial work, plan first, then use run_subagents to work in parallel (up to ${agentCap(modelId)} at once; when they finish you may launch more). ` +
        "After building, always run a verification round: critic agents review the code, tester agents run tests and hunt bugs, and for websites a designer agent reviews the design. Fix what they find and re-check if the fixes were substantial. " +
        "Don't use sub-agents for tiny tasks or simple questions — do those yourself."
    );
  }
  return lines.join("\n");
}

/**
 * Запуск агента.
 * opts: { provider, key, model, modelName, history (изменяется), workspace, access, ultra, thinking, signal,
 *         ev(event), approve(request) → Promise<"allow"|"allow_session"|"deny">, ctx, role?, maxSteps?, agentId? }
 * События: text, thinking, tool, tool_result, usage, step, subagents_start, subagent_event, subagents_end.
 */
async function runAgent(opts) {
  const { history, signal, ev, role } = opts;
  const extra = opts.extraTools ?? [];
  const skillList = opts.skills ?? [];
  const planMode = opts.access === "plan";
  const subTool = subagentsTool(agentLimit(opts));
  const customAgents = (opts.customAgents || []).filter((a) => a && a.enabled !== false && a.name && a.prompt);
  const tools = [
    ...TOOLS,
    ...extra.map(({ name, description, parameters }) => ({ name, description, parameters })),
    ...(skillList.length ? [USE_SKILL_TOOL] : []),
    ...(opts.ultra && !role ? [subTool] : []),
    ...(!role && opts.onCreateAgent ? [CREATE_AGENT_TOOL] : []),
    ...(!role && opts.onImage ? [GENERATE_IMAGE_TOOL] : []),
    ...(!role && customAgents.length ? [RUN_AGENT_TOOL] : []),
  ].filter((t) => !planMode || PLAN_TOOLS.has(t.name)); // в режиме плана — только чтение и поиск
  let system = systemPrompt(opts);
  if (skillList.length) {
    system +=
      "\n\nSkills (ready instructions for specific tasks). When a task matches a skill, call use_skill with its name first and follow it:\n" +
      skillList.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  }
  if (!role && customAgents.length)
    system += "\n\nCustom sub-agents of the user (call with run_custom_agent when a task fits; the user may also name one directly):\n" + customAgents.map((a) => `- ${a.name}: ${a.description || ""}`).join("\n");
  if (extra.length) system += `\n\nConnectors are connected: ${[...new Set(extra.map((t) => t.connector))].join(", ")}. Their tools start with mcp__.`;
  // шагов с запасом: большие задачи (сайты, рефакторинг) не должны обрываться на «80 шагов»
  const maxSteps = opts.maxSteps ?? (role ? 150 : 1000);
  let continues = 0;
  const allowedInSession = opts.allowedInSession ?? new Set();

  let toolsUsed = 0;
  let nudged = false;
  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return;
    ev({ type: "step_start" });
    const r = await complete({
      provider: opts.provider,
      key: opts.key,
      model: opts.model,
      system,
      history: opts.superSaver ? shrinkHistory(history) : history,
      tools: opts.superSaver ? shrinkTools(tools) : tools,
      // супер-экономия: «Default» → Low (не заморачивается), явно выбранный уровень и UltraCode не трогаем
      fast: !!opts.fast,
      thinking: opts.superSaver && (!opts.thinking || opts.thinking === "default") && !opts.ultra ? "low" : opts.thinking,
      signal,
      onText: (t) => ev({ type: "text", text: t }),
      onThinking: (t) => ev({ type: "thinking", text: t }),
      onRetry: (x) => ev({ type: "retry", ...x }),
      onToolDraft: (x) => ev({ type: "tool_draft", ...x }),
    });
    ev({ type: "usage", usage: r.usage });

    // Некоторые модели пишут вызов инструмента текстом вместо настоящего вызова — разбираем и выполняем
    if (!r.toolCalls.length && !planMode) {
      const parsed = textToolCalls(r.content, new Set(tools.map((t) => t.name)));
      if (parsed.calls.length) {
        r.toolCalls = parsed.calls;
        r.content = parsed.rest;
        ev({ type: "replace_text", text: parsed.rest });
      }
    }

    if (!r.toolCalls.length) {
      // Ответ оборвался по длине — модель не закончила: просим продолжить с того же места, человеку писать не нужно
      if (/^(length|max_tokens)$/.test(String(r.finish || "")) && continues < 8) {
        continues++;
        history.push({ role: "assistant", content: r.content || "", ...r.assistantExtra });
        history.push({ role: "user", content: "Continue exactly from where you stopped. Don't repeat what you already wrote." });
        ev({ type: "notice", text: "Ответ оборвался по длине — продолжаю автоматически…" });
        continue;
      }
      // «Сделал», но ни одного инструмента за весь ответ не вызвал — один раз просим сделать по-настоящему
      if (!planMode && !toolsUsed && !nudged && tools.length && CLAIM_RE.test(r.content || "")) {
        nudged = true;
        history.push({ role: "assistant", content: r.content || "" });
        history.push({
          role: "user",
          content:
            "[XroMax Code check] You wrote that you did something, but you did not call any tool — nothing actually changed on the computer. Do it now with the tools (write_file, edit_file, run_command and others). If you can't, say honestly that it isn't done.",
        });
        ev({ type: "notice", text: "Модель написала, что всё сделала, но не вызвала ни одного инструмента — прошу сделать по-настоящему…" });
        continue;
      }
      history.push({ role: "assistant", content: r.content, ...r.assistantExtra });
      ev({ type: "done" });
      return r.content;
    }
    toolsUsed += r.toolCalls.length;
    const calls = r.toolCalls.map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${step}_${i}` }));
    history.push({
      role: "assistant",
      content: r.content || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
      ...r.assistantExtra,
    });

    for (const c of calls) {
      let args;
      try {
        args = c.args ? JSON.parse(c.args) : {};
      } catch {
        args = null;
      }
      ev({ type: "tool", id: c.id, name: c.name, args: args || {} });
      let result;
      if (args === null) result = "The tool arguments were not valid JSON. Send them again.";
      else if (planMode && !PLAN_TOOLS.has(c.name)) result = "Plan mode: changes and commands are not allowed. Finish the plan; the user will approve it.";
      else if (c.name === "run_subagents") result = tools.includes(subTool) ? await runSubagents(opts, args, allowedInSession) : "Unknown tool: run_subagents (UltraCode is off).";
      else if (c.name === "generate_image" && !role && opts.onImage) {
        try {
          result = await opts.onImage({ prompt: String(args.prompt || "") });
        } catch (e) {
          result = `Image generation failed: ${String(e.message || e).slice(0, 200)}`;
        }
      } else if (c.name === "create_subagent" && !role && opts.onCreateAgent) {
        try {
          const d = opts.onCreateAgent({ name: String(args.name || ""), description: String(args.description || ""), prompt: String(args.instructions || "") });
          result = `Sub-agent "${d.name}" saved. It appears in Settings → Субагенты and can be run with run_custom_agent.`;
          if (!customAgents.some((a) => a.name === d.name)) customAgents.push({ ...d, enabled: true });
          if (!tools.includes(RUN_AGENT_TOOL)) tools.push(RUN_AGENT_TOOL);
        } catch (e) {
          result = `Could not create: ${String(e.message || e)}`;
        }
      } else if (c.name === "run_custom_agent" && !role) {
        const a = customAgents.find((x) => x.name === String(args.agent || "").trim());
        result = a ? await runSubagents(opts, { agents: [{ role: "custom", title: a.name, task: String(args.task || ""), prompt: a.prompt, model: a.model }] }, allowedInSession) : `No such custom sub-agent. Available: ${customAgents.map((x) => x.name).join(", ") || "none"}`;
      } else if (c.name === "use_skill") {
        const s = skillList.find((x) => x.name === String(args.name || "").trim());
        result = s ? s.text() : `No skill named "${args.name}". Available: ${skillList.map((x) => x.name).join(", ")}`;
      } else {
        const ext = extra.find((t) => t.name === c.name);
        const risk = assessRisk(c.name, args, opts.workspace);
        let allowed = true;
        if (needsApproval(opts.access, risk) && !allowedInSession.has(approvalKey(c.name, risk))) {
          const answer = await opts.approve({ tool: c.name, args, reason: risk.reason, level: risk.level, agent: role ? opts.agentTitle : null });
          if (answer === "allow_session") allowedInSession.add(approvalKey(c.name, risk));
          allowed = answer === "allow" || answer === "allow_session";
        }
        if (!allowed) result = "The user denied this action. Don't retry it; choose another way or explain what you need.";
        else if (ext) {
          try {
            result = await ext.run(args);
          } catch (e) {
            result = `Connector error: ${String(e.message || e).slice(0, 500)}`;
          }
        } else result = await runTool(c.name, args, { ...opts.ctx, workspace: opts.workspace, signal });
      }
      ev({ type: "tool_result", id: c.id, result: clip(String(result), 4000) });
      history.push({ role: "tool", tool_call_id: c.id, content: String(result) });
      if (signal?.aborted) return;
    }
  }
  const note = "\n\n_(Остановился: слишком много шагов подряд. Напишите «продолжай», чтобы продолжить.)_";
  ev({ type: "text", text: note });
  history.push({ role: "assistant", content: note });
  ev({ type: "done" });
}

// одно «разрешать в этой сессии» — для одного вида действия (опасные спрашиваются каждый раз по своей причине)
const approvalKey = (tool, risk) => (risk.level === "danger" ? `${tool}:${risk.reason}` : tool);

async function runSubagents(opts, args, allowedInSession) {
  const list = Array.isArray(args.agents) ? args.agents.slice(0, agentLimit(opts)) : [];
  if (!list.length) return "No agents given.";
  const runId = `sub_${Date.now()}`;
  opts.ev({ type: "subagents_start", runId, agents: list.map((a, i) => ({ i, role: a.role, title: a.title })) });
  const results = await Promise.all(
    list.map(async (a, i) => {
      const history = [{ role: "user", content: a.task }];
      const sub = (e) => opts.ev({ type: "subagent_event", runId, i, event: e });
      try {
        const text = await runAgent({
          ...opts,
          history,
          role: a.role || "builder",
          agentTitle: a.title,
          customPrompt: a.prompt || null,
          customAgents: [],
          onCreateAgent: null,
          ultra: false,
          allowedInSession,
          ev: (e) => {
            if (e.type === "usage") opts.ev(e); // расход субагентов идёт в общий счётчик
            sub(e);
          },
        });
        sub({ type: "finished", ok: true });
        return `### ${a.title} (${a.role})\n${text || "(no report)"}`;
      } catch (e) {
        sub({ type: "finished", ok: false, error: String(e.message || e) });
        return `### ${a.title} (${a.role})\nFAILED: ${String(e.message || e).slice(0, 300)}`;
      }
    })
  );
  opts.ev({ type: "subagents_end", runId });
  return results.join("\n\n");
}

/** Сжать разговор: модель пишет подробную выжимку, история заменяется ею */
/** Сжатие примерно в 10–11 раз (не сильнее): подробное резюме старой части + последние сообщения дословно */
const COMPRESS_RATIO = 10.5;
const CHARS_PER_TOKEN = 3.5;
const msgChars = (m) => {
  const c = Array.isArray(m.content) ? m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ") : String(m.content ?? "");
  return c.length + (m.tool_calls || []).reduce((n, t) => n + String(t.function?.arguments ?? "").length + 40, 0);
};

async function compressHistory({ provider, key, model, history, signal }) {
  const totalChars = history.reduce((n, m) => n + msgChars(m), 0);
  const budget = Math.max(4000, totalChars / COMPRESS_RATIO); // сколько символов останется после сжатия
  // хвост дословно: последние сообщения на ~40% бюджета, начиная с сообщения пользователя (пары «вызов → результат» не рвём)
  let cut = history.length;
  let tail = 0;
  for (let i = history.length - 1; i > 0; i--) {
    tail += msgChars(history[i]);
    if (tail > budget * 0.4) break;
    if (history[i].role === "user") cut = i;
  }
  const older = history.slice(0, cut);
  const recent = history.slice(cut);
  const summaryChars = Math.max(2500, budget - recent.reduce((n, m) => n + msgChars(m), 0));
  const words = Math.round(summaryChars / 6.5); // ~6.5 символа на слово с пробелом
  const transcript = older
    .map((m) => {
      if (m.role === "tool") return `[tool result] ${String(m.content).slice(0, 3000)}`;
      if (m.role === "assistant") {
        const calls = (m.tool_calls || []).map((c) => `[called ${c.function.name} ${String(c.function.arguments).slice(0, 600)}]`).join(" ");
        return `Assistant: ${m.content || ""} ${calls}`.trim();
      }
      const t = Array.isArray(m.content) ? m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ") : m.content;
      return `User: ${t}`;
    })
    .join("\n\n");
  const r = await complete({
    provider,
    key,
    model,
    system: "You compress coding-agent conversations into a detailed working record. Keep facts, not just headlines — the agent must be able to continue as if it remembered everything.",
    history: [
      {
        role: "user",
        content:
          `Rewrite the conversation below as a DETAILED record of about ${words} words (not much shorter: it replaces roughly ${COMPRESS_RATIO}× more text). ` +
          "Keep, in order: the user's goals, requirements and preferences (with their exact wording where it matters); every decision and why; each file created or changed with its path and what is in it now (key functions, names, settings); commands that worked and errors that happened with how they were fixed; important code snippets and values; the current state, open problems and the next steps. " +
          "Write in the user's language, with headings and bullet points.\n\n" +
          transcript.slice(-600_000),
      },
    ],
    tools: [],
    thinking: "low",
    signal,
  });
  return {
    history: [
      { role: "user", content: `Detailed record of our earlier conversation (older messages were compressed about ${COMPRESS_RATIO}× to save context; the latest messages follow unchanged):\n\n${r.content}` },
      { role: "assistant", content: "Понял, продолжаю с этого места." },
      ...recent,
    ],
    usage: r.usage,
    ratio: totalChars / Math.max(1, (r.content || "").length + recent.reduce((n, m) => n + msgChars(m), 0)),
  };
}

module.exports = { CREATE_AGENT_TOOL, RUN_AGENT_TOOL, runAgent, compressHistory, systemPrompt, MAX_PARALLEL, SUBAGENTS_TOOL, subagentsTool, agentCap, agentLimit, textToolCalls, CLAIM_RE };
