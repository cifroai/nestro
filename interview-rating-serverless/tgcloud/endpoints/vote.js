import { EndpointError } from 'sdk';
import { getCandidate, saveVote, summarize, validateVote } from '../lib/rating.js';

// Сохранить (или заменить) оценку текущего участника.
export default async function (input, ctx) {
  const user = ctx.initData.user;
  const candidate = await getCandidate(input.id);
  if (!candidate) throw new EndpointError('Кандидат не найден. Проверьте ссылку.', { code: 'NOT_FOUND' });

  const vote = validateVote(input);
  if (vote.error) throw new EndpointError(vote.error, { code: 'INVALID_VOTE' });

  await saveVote(candidate.id, user, vote);
  return summarize(candidate, user.id);
}
