import { withRoute } from '@/server/http/route.js';
import { assertOwnsSession } from '@/server/auth/candidateSession.js';
import { saveAnswerSchema } from '@/server/validation/answers.js';
import type { z } from 'zod';
import { saveAnswer } from '@/server/services/testSessionService.js';

/**
 * Сохранение ответа (autosave и окончательная отправка).
 * Идемпотентно по (sessionId, questionVersionId, stageIndex): повторная
 * отправка создаёт новую ревизию, а не дублирующий ответ.
 */
type Body = z.infer<typeof saveAnswerSchema>;

export const POST = withRoute<Body>(
  {
    actor: 'candidate',
    bodySchema: saveAnswerSchema,
    rateLimit: { rule: 'ANSWER_SAVE', keyOf: (ctx) => ctx.candidate?.testSessionId ?? 'unknown' },
  },
  async ({ body, ctx }) => {
    assertOwnsSession(ctx.candidate!, body.sessionId);
    return saveAnswer(body.sessionId, body, { ip: ctx.ip, requestId: ctx.requestId });
  },
);
