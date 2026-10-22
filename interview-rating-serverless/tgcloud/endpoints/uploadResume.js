import { api, BotApiError, EndpointError, InputFile } from 'sdk';
import { RESUME_EXTENSIONS, RESUME_MAX_MB } from '../lib/config.js';
import {
  base64ToBytes, canUploadResume, displayName, getCandidate, resumeExtension, setResume, summarize,
} from '../lib/rating.js';

const MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

// Загрузка резюме из Mini App. Файл хранится в Telegram: бот отправляет его загрузившему
// в личный чат и запоминает file_id — по нему резюме потом пересылается любому участнику.
export default async function (input, ctx) {
  const user = ctx.initData.user;
  if (!canUploadResume(user.id)) {
    throw new EndpointError('Загрузка резюме вам недоступна', { code: 'FORBIDDEN' });
  }
  const candidate = await getCandidate(input.id);
  if (!candidate) throw new EndpointError('Кандидат не найден. Проверьте ссылку.', { code: 'NOT_FOUND' });

  const fileName = String(input.fileName || '').split(/[\\/]/).pop().slice(0, 200);
  const ext = resumeExtension(fileName);
  if (!ext) {
    throw new EndpointError('Допустимые форматы: ' + RESUME_EXTENSIONS.join(', '), { code: 'BAD_TYPE' });
  }

  let bytes;
  try {
    bytes = base64ToBytes(input.data || '');
  } catch {
    throw new EndpointError('Не удалось прочитать файл', { code: 'BAD_FILE' });
  }
  if (!bytes.length) throw new EndpointError('Пустой файл', { code: 'BAD_FILE' });
  if (bytes.length > RESUME_MAX_MB * 1024 * 1024) {
    throw new EndpointError(`Файл больше ${RESUME_MAX_MB} МБ`, { code: 'TOO_LARGE' });
  }

  let message;
  try {
    message = await api.sendDocument({
      chat_id: user.id,
      document: new InputFile(bytes, fileName, { type: MIME[ext] }),
      caption: `Резюме загружено: ${candidate.name}${candidate.position ? ' — ' + candidate.position : ''}`,
    });
  } catch (e) {
    if (e instanceof BotApiError && e.code === 403) {
      throw new EndpointError('Разрешите боту писать вам — туда сохраняется файл', { code: 'NO_WRITE_ACCESS' });
    }
    throw e;
  }

  const doc = message.document;
  await setResume(candidate.id, {
    fileId: doc.file_id,
    fileName,
    size: doc.file_size ?? bytes.length,
    uploadedBy: displayName(user),
  });
  return summarize(await getCandidate(candidate.id), user.id);
}
