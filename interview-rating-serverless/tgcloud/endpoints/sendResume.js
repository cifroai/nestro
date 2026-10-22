import { api, BotApiError, EndpointError } from 'sdk';
import { getCandidate } from '../lib/rating.js';

// «Открыть резюме»: бот присылает файл участнику в личный чат,
// где Telegram открывает его встроенным просмотрщиком.
export default async function (input, ctx) {
  const user = ctx.initData.user;
  const candidate = await getCandidate(input.id);
  if (!candidate) throw new EndpointError('Кандидат не найден. Проверьте ссылку.', { code: 'NOT_FOUND' });
  if (!candidate.resume_file_id) throw new EndpointError('Резюме пока не загружено', { code: 'NO_RESUME' });

  try {
    await api.sendDocument({
      chat_id: user.id,
      document: candidate.resume_file_id,
      caption: `Резюме: ${candidate.name}${candidate.position ? ' — ' + candidate.position : ''}`,
    });
  } catch (e) {
    if (e instanceof BotApiError && e.code === 403) {
      throw new EndpointError('Разрешите боту писать вам, чтобы получить резюме', { code: 'NO_WRITE_ACCESS' });
    }
    throw e;
  }
  return { sent: true };
}
