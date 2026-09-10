import { z } from 'zod';

/** Общие схемы запросов. Единый источник для API и генерации OpenAPI. */

export const idSchema = z.string().min(1).max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const periodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const positionFilterSchema = z.object({
  positionCode: z.string().min(1).max(64).optional(),
});

export const loginSchema = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(1).max(200),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(12).max(200),
  })
  .strict();

export const createInvitationSchema = z
  .object({
    fullName: z.string().trim().min(3).max(200),
    email: z.string().email().max(320).optional(),
    positionCode: z.string().min(1).max(64),
    assessmentVersionId: idSchema,
    expiresAt: z.coerce.date(),
    maxAttempts: z.coerce.number().int().min(1).max(5).optional(),
    experienceYears: z.coerce.number().int().min(0).max(70).optional(),
    sourceChannel: z.string().max(120).optional(),
  })
  .strict();

export const invitationListSchema = paginationSchema
  .merge(periodSchema)
  .merge(positionFilterSchema)
  .extend({
    status: z
      .enum(['CREATED', 'SENT', 'OPENED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'REVIEWED'])
      .optional(),
  });

export const resendInvitationSchema = z
  .object({ expiresAt: z.coerce.date().optional() })
  .strict();

export const startSessionSchema = z.object({ token: z.string().min(10).max(200) }).strict();

export const sessionEventSchema = z
  .object({
    type: z.enum(['TAB_HIDDEN', 'TAB_VISIBLE', 'RECONNECT', 'NAVIGATED_BACK', 'CLIENT_ERROR']),
    payload: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

export const candidateListSchema = paginationSchema
  .merge(periodSchema)
  .merge(positionFilterSchema)
  .extend({
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'ABANDONED']).optional(),
    band: z
      .enum(['EXPERT', 'HIGH', 'SUFFICIENT', 'GAPS', 'NOT_CONFIRMED', 'INSUFFICIENT_DATA'])
      .optional(),
    minScore: z.coerce.number().min(0).max(100).optional(),
    maxScore: z.coerce.number().min(0).max(100).optional(),
    competencyCode: z.string().max(64).optional(),
    minCompetencyScore: z.coerce.number().min(0).max(4).optional(),
    riskFlagCode: z.string().max(64).optional(),
    reviewRequired: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    minConfidence: z.coerce.number().min(0).max(1).optional(),
    search: z.string().max(200).optional(),
    sort: z.enum(['completedAt', 'score', 'fullName', 'confidence']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  });

export const compareSchema = z
  .object({ sessionIds: z.array(idSchema).min(2).max(5) })
  .strict();

export const reviewSchema = z
  .object({
    dimensionScoreId: idSchema.optional(),
    answerId: idSchema.optional(),
    competencyId: idSchema.optional(),
    humanScore: z.number().min(0).max(4).nullable().optional(),
    markedUninformative: z.boolean().optional(),
    reviewReason: z.string().trim().min(20).max(4000),
  })
  .strict();

export const weightsSchema = z
  .object({
    weights: z
      .array(
        z
          .object({
            competencyId: idSchema,
            weight: z.number().min(0).max(100),
            isHardGate: z.boolean().optional(),
            minEvidenceCount: z.number().int().min(1).max(50).optional(),
            minQuestionCount: z.number().int().min(1).max(50).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();

export const thresholdsSchema = z
  .object({
    bandThresholds: z
      .object({
        EXPERT: z.number().min(0).max(100),
        HIGH: z.number().min(0).max(100),
        SUFFICIENT: z.number().min(0).max(100),
        GAPS: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
    disagreementThreshold: z.number().min(0.1).max(4).optional(),
    gateThreshold: z.number().min(0).max(4).optional(),
    minCoverage: z.number().min(0).max(1).optional(),
    similarityThreshold: z.number().min(0.1).max(1).optional(),
    ladderConstructCount: z.number().int().min(3).max(5).optional(),
    targetConstructCount: z.number().int().min(5).max(15).optional(),
  })
  .strict();

export const employmentOutcomeSchema = z
  .object({
    hiringDecision: z.enum(['HIRED', 'NOT_HIRED', 'WITHDRAWN']).nullable().optional(),
    decisionDate: z.coerce.date().nullable().optional(),
    probationResult: z.string().max(2000).nullable().optional(),
    probationScore: z.number().min(0).max(100).nullable().optional(),
    performanceNotes: z.string().max(4000).nullable().optional(),
    followUpAssessment: z.number().min(0).max(100).nullable().optional(),
  })
  .strict();

export const searchSchema = z.object({
  q: z.string().min(2).max(200),
  scope: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const auditListSchema = paginationSchema.merge(periodSchema).extend({
  entity: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  action: z.string().max(120).optional(),
  actorUserId: z.string().max(64).optional(),
});

export const exportSchema = positionFilterSchema.merge(periodSchema).extend({
  format: z.enum(['csv', 'xlsx', 'json']).default('xlsx'),
});

export const createUserSchema = z
  .object({
    email: z.string().email().max(320),
    fullName: z.string().trim().min(3).max(200),
    roleCodes: z
      .array(z.enum(['SuperAdmin', 'AssessmentAdmin', 'HR', 'TechnicalExpert', 'Viewer']))
      .min(1)
      .max(5),
    password: z.string().min(12).max(200).optional(),
  })
  .strict();

export const updateRolesSchema = z
  .object({
    roleCodes: z
      .array(z.enum(['SuperAdmin', 'AssessmentAdmin', 'HR', 'TechnicalExpert', 'Viewer']))
      .min(1)
      .max(5),
  })
  .strict();

export const benchmarkSchema = z
  .object({
    code: z.string().min(2).max(64),
    title: z.string().min(3).max(200),
    positionCode: z.string().min(1).max(64),
    description: z.string().max(2000).optional(),
    candidateIds: z.array(idSchema).max(500).optional(),
  })
  .strict();

export const calibrationRunSchema = positionFilterSchema.merge(periodSchema).extend({
  label: z.string().min(3).max(200),
});
