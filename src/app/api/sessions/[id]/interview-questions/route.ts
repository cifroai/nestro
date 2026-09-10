import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { generateInterviewQuestions } from '@/server/services/interviewQuestionService.js';

/** Индивидуальные вопросы к очному собеседованию (§46). */
export const GET = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REPORT_READ },
  async ({ params }) => {
    const questions = await prisma.interviewQuestion.findMany({
      where: { sessionId: params.id },
      include: { competency: { select: { code: true, title: true } } },
      orderBy: { orderIndex: 'asc' },
    });
    return { questions };
  },
);

/** Повторная генерация вопросов (например после экспертной проверки). */
export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REPORT_READ },
  async ({ params }) => generateInterviewQuestions(params.id),
);
