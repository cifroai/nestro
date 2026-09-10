/**
 * Проверка доказательств (docs/LLM_ASSESSMENT.md §5.1).
 *
 * Балл без подтверждённой цитаты не принимается: это же нейтрализует
 * попытки prompt injection — инъекция не способна создать цитату,
 * подтверждающую компетенцию, потому что цитата сверяется с текстом ответа.
 */

const QUOTE_TOKEN_COVERAGE = 0.9;

/** Нормализация: регистр, пробелы, кавычки, дефисы, концевая пунктуация. */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?)(]+$/g, '')
    .trim();
}

function tokens(text: string): string[] {
  return normalizeForQuoteMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Цитата считается подтверждённой, если:
 *  а) нормализованная цитата — подстрока нормализованного ответа, либо
 *  б) не менее 90% её токенов образуют непрерывное окно в ответе
 *     (защита от многоточий и склеек, которые допускает модель).
 */
export function isQuoteVerified(quote: string, answerText: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  const a = normalizeForQuoteMatch(answerText);
  if (q.length === 0 || a.length === 0) return false;
  if (a.includes(q)) return true;

  const qTokens = tokens(quote);
  const aTokens = tokens(answerText);
  if (qTokens.length === 0 || aTokens.length < qTokens.length) return false;

  const needed = Math.ceil(qTokens.length * QUOTE_TOKEN_COVERAGE);
  for (let start = 0; start + qTokens.length <= aTokens.length; start += 1) {
    let matched = 0;
    for (let i = 0; i < qTokens.length; i += 1) {
      if (aTokens[start + i] === qTokens[i]) matched += 1;
    }
    if (matched >= needed) return true;
  }
  return false;
}

export interface VerifiedQuote {
  quote: string;
  verified: boolean;
}

export function verifyQuotes(quotes: string[], answerText: string): VerifiedQuote[] {
  return quotes.map((quote) => ({ quote, verified: isQuoteVerified(quote, answerText) }));
}
