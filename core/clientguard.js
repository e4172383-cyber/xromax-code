// XroMax Code: проверка запроса ДО отправки. Быстрая обратная связь: явные попытки джейлбрейка/обхода защиты и мат
// отсекаются сразу в приложении (на сервере те же и более строгие проверки — он главный).
const NB = "(?<![а-яё])";
const RU = "[а-яё]*";
const RULES = [
  [/\bignore\b[^.\n]{0,40}\b(above|previous|prior|the system|all)\b[^.\n]{0,40}\b(instructions?|rules?|prompt)\b/i, "попытка отменить системные инструкции"],
  [new RegExp(NB + "(игнорируй|забудь|отмени)[^.\\n]{0,40}(все|предыдущ|систем|инструкц|правил|промт)", "i"), "попытка отменить системные инструкции"],
  [/\b(DAN|developer\s*mode|jailbr?oken|jailbreak|do\s+anything\s+now)\b/i, "режим-джейлбрейк"],
  [new RegExp(NB + "(?:обойд[иуе]" + RU + "|обход[иы]" + RU + "|обойт[иь]|отключ[иа]" + RU + "|сними|снять|убер[иуе]" + RU + "|сломай|взломай|нарушь)[^.\\n]{0,40}" + NB + "(?:систем" + RU + "\\s+)?(?:защит" + RU + "|ограничени" + RU + "|правил" + RU + "|фильтр" + RU + "|цензур" + RU + "|модерац" + RU + ")", "i"), "просьба обойти защиту или правила"],
  [/\b(?:bypass|circumvent|get\s+around)\s+(?:your|the|all|any|this)?\s*(?:safety|security|protection|restrictions?|rules|guardrails?|moderation|censorship|safeguards?)\b/i, "просьба обойти защиту или правила"],
  [/\b(reveal|show|print|dump)\b[^.\n]{0,40}\b(system\s+prompt|your\s+instructions|hidden\s+prompt)/i, "просьба раскрыть системный промт"],
  [new RegExp(NB + "(повтори|выдай|покажи)[^.\\n]{0,40}(системн" + RU + "\\s+промт|скрыт" + RU + "\\s+инструкц)", "i"), "просьба раскрыть системный промт"],
];

/** Вернёт текст причины или null. Блоки кода и файлы не проверяются. */
function check(text) {
  const t = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<file[\s\S]*?<\/file>/g, " ")
    .replace(/[​-‏⁠﻿­]/g, "")
    .normalize("NFKC");
  if (!t.trim() || t.length > 20000) return null;
  for (const [re, why] of RULES) if (re.test(t)) return `Запрос не отправлен: ${why}. Переформулируйте запрос по делу — и он пройдёт. Правила использования: https://xromax-ai.defhosting.com/policy`;
  return null;
}
module.exports = { check };
