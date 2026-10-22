import { EndpointError } from 'sdk';
import { getCandidate, summarize } from '../lib/rating.js';

// Карточка кандидата, моя оценка и (если я уже голосовал) общие результаты.
export default async function (input, ctx) {
  const candidate = await getCandidate(input.id);
  if (!candidate) throw new EndpointError('Кандидат не найден. Проверьте ссылку.', { code: 'NOT_FOUND' });
  return summarize(candidate, ctx.initData.user.id);
}
