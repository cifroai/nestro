-- CreateEnum
CREATE TYPE "CompetencyAxis" AS ENUM ('TECHNICAL_REASONING', 'SYSTEM_THINKING', 'RISK_MANAGEMENT', 'PREVENTIVE_THINKING', 'DECISION_MAKING', 'OPERATIONAL_MATURITY', 'COMMUNICATION', 'SELF_AWARENESS');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER', 'NUMERIC', 'RANKING', 'KELLY_TRIAD', 'REPERTORY_GRID', 'SJT', 'MULTI_STAGE_CASE', 'SELF_RATING');

-- CreateEnum
CREATE TYPE "TestSection" AS ENUM ('INTRO', 'KELLY_TRIADS', 'REPERTORY_GRID', 'LADDERING', 'SJT_CASES', 'ARGUMENTATION', 'SELF_RATING', 'FINISH');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('CREATED', 'SENT', 'OPENED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AssessmentRunStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'RUNNING', 'DONE', 'FAILED', 'MANUAL_ONLY');

-- CreateEnum
CREATE TYPE "AnswerStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SimilarityVerdict" AS ENUM ('PENDING', 'SAME', 'DIFFERENT');

-- CreateEnum
CREATE TYPE "EvaluatorRole" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "LLMRunStatus" AS ENUM ('OK', 'INVALID_JSON', 'PROVIDER_ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SUPPORTING', 'MISSING', 'RISK', 'STRENGTH', 'AMBIGUITY');

-- CreateEnum
CREATE TYPE "ScoreBand" AS ENUM ('EXPERT', 'HIGH', 'SUFFICIENT', 'GAPS', 'NOT_CONFIRMED', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FlagSource" AS ENUM ('LLM', 'RULE', 'HUMAN');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('WEB', 'PDF');

-- CreateEnum
CREATE TYPE "PromptRole" AS ENUM ('EVAL_A', 'EVAL_B', 'INTERVIEW_Q', 'DEDUP', 'CONSTRUCT_MAP');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('USER', 'CANDIDATE', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "userAgentHash" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "family" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "axis" "CompetencyAxis" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentVersion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "scoringModelId" TEXT,
    "promptTemplateAId" TEXT,
    "promptTemplateBId" TEXT,
    "llmModelPrimary" TEXT,
    "llmModelSecondary" TEXT,
    "disagreementThreshold" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "gateThreshold" DECIMAL(4,2) NOT NULL DEFAULT 2.0,
    "minCoverage" DECIMAL(4,3) NOT NULL DEFAULT 0.6,
    "bandThresholds" JSONB NOT NULL DEFAULT '{"EXPERT":85,"HIGH":70,"SUFFICIENT":55,"GAPS":40}',
    "ladderConstructCount" INTEGER NOT NULL DEFAULT 4,
    "targetConstructCount" INTEGER NOT NULL DEFAULT 8,
    "similarityThreshold" DECIMAL(4,3) NOT NULL DEFAULT 0.62,
    "configSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentCompetency" (
    "id" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL,
    "isHardGate" BOOLEAN NOT NULL DEFAULT false,
    "minEvidenceCount" INTEGER NOT NULL DEFAULT 4,
    "minQuestionCount" INTEGER NOT NULL DEFAULT 3,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssessmentCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "section" "TestSection" NOT NULL,
    "prompt" TEXT NOT NULL,
    "helpText" TEXT,
    "subFields" JSONB,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "minLength" INTEGER,
    "maxLength" INTEGER,
    "numericUnit" TEXT,
    "numericMin" DECIMAL(14,4),
    "numericMax" DECIMAL(14,4),
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "randomizable" BOOLEAN NOT NULL DEFAULT false,
    "scenarioStageId" TEXT,
    "rubricId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionCompetency" (
    "questionVersionId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "weightWithinCompetency" DECIMAL(6,3) NOT NULL DEFAULT 1.0,

    CONSTRAINT "QuestionCompetency_pkey" PRIMARY KEY ("questionVersionId","competencyId")
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "competencyId" TEXT NOT NULL,
    "guidance" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricLevel" (
    "id" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "descriptor" TEXT NOT NULL,
    "positiveIndicators" JSONB,
    "negativeIndicators" JSONB,

    CONSTRAINT "RubricLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "equivalenceGroup" TEXT,
    "expectedEvidence" JSONB,
    "unsafeActions" JSONB,
    "expertNotes" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioStage" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "stageIndex" INTEGER NOT NULL,
    "situation" TEXT NOT NULL,
    "dynamics" JSONB,
    "constraints" TEXT,
    "adjacentServiceInfo" TEXT,
    "revealNote" TEXT,

    CONSTRAINT "ScenarioStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KellyElement" (
    "id" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "isIdeal" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KellyElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KellyTriad" (
    "id" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "elementAId" TEXT NOT NULL,
    "elementBId" TEXT NOT NULL,
    "elementCId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "randomizable" BOOLEAN NOT NULL DEFAULT true,
    "isReserve" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "KellyTriad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "positionId" TEXT NOT NULL,
    "experienceYears" INTEGER,
    "sourceChannel" TEXT,
    "externalRef" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'CREATED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSession" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "invitationId" TEXT,
    "assessmentVersionId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assessmentStatus" "AssessmentRunStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "randomSeed" TEXT NOT NULL,
    "sectionOrder" JSONB NOT NULL,
    "currentSection" "TestSection" NOT NULL DEFAULT 'INTRO',
    "currentQuestionId" TEXT,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "reviewCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSessionToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "ip" TEXT,
    "userAgentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateSessionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "textValue" TEXT,
    "numericValue" DECIMAL(14,4),
    "status" "AnswerStatus" NOT NULL DEFAULT 'DRAFT',
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "shownAt" TIMESTAMP(3),
    "firstInputAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "msActive" INTEGER NOT NULL DEFAULT 0,
    "returnCount" INTEGER NOT NULL DEFAULT 0,
    "focusLossCount" INTEGER NOT NULL DEFAULT 0,
    "stageIndex" INTEGER,
    "supersededByStage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerRevision" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "valueJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateConstruct" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "triadId" TEXT,
    "poleLeft" TEXT NOT NULL,
    "poleRight" TEXT NOT NULL,
    "similarPairElements" JSONB,
    "similarityExplanation" TEXT,
    "differenceExplanation" TEXT,
    "importanceReason" TEXT,
    "rigManifestation" TEXT,
    "experienceExample" TEXT,
    "isDuplicateOf" TEXT,
    "importanceRank" INTEGER,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateConstruct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructRating" (
    "id" TEXT NOT NULL,
    "constructId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,

    CONSTRAINT "ConstructRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LadderStep" (
    "id" TEXT NOT NULL,
    "constructId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "terminalTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LadderStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructSimilarityCheck" (
    "id" TEXT NOT NULL,
    "constructAId" TEXT NOT NULL,
    "constructBId" TEXT NOT NULL,
    "lexicalScore" DECIMAL(5,4) NOT NULL,
    "semanticScore" DECIMAL(5,4),
    "candidateVerdict" "SimilarityVerdict" NOT NULL DEFAULT 'PENDING',
    "candidateExplanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ConstructSimilarityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridAnalysis" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GridAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMAssessment" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "evaluatorRole" "EvaluatorRole" NOT NULL,
    "promptTemplateId" TEXT,
    "llmProvider" TEXT NOT NULL,
    "llmModel" TEXT NOT NULL,
    "llmModelVersion" TEXT,
    "rubricRef" TEXT,
    "rawResponse" TEXT,
    "parsedJson" JSONB,
    "confidence" DECIMAL(4,3),
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "LLMRunStatus" NOT NULL DEFAULT 'OK',
    "errorMessage" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "latencyMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMDimensionScore" (
    "id" TEXT NOT NULL,
    "llmAssessmentId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "score" DECIMAL(4,2),
    "level" INTEGER,
    "notEnoughEvidence" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT NOT NULL,
    "rubricRule" TEXT,
    "confidence" DECIMAL(4,3) NOT NULL,

    CONSTRAINT "LLMDimensionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMEvidence" (
    "id" TEXT NOT NULL,
    "llmAssessmentId" TEXT NOT NULL,
    "dimensionScoreId" TEXT,
    "kind" "EvidenceKind" NOT NULL,
    "quote" TEXT NOT NULL,
    "comment" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanReview" (
    "id" TEXT NOT NULL,
    "dimensionScoreId" TEXT,
    "answerId" TEXT,
    "competencyId" TEXT NOT NULL,
    "modelScore" DECIMAL(4,2),
    "humanScore" DECIMAL(4,2),
    "finalScore" DECIMAL(4,2),
    "reviewReason" TEXT NOT NULL,
    "markedUninformative" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalScore" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "competencyId" TEXT,
    "axis" "CompetencyAxis",
    "score0to4" DECIMAL(5,3),
    "score0to100" DECIMAL(6,3),
    "level" INTEGER,
    "confidence" DECIMAL(4,3) NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "notEnoughEvidence" BOOLEAN NOT NULL DEFAULT false,
    "coverage" DECIMAL(4,3),
    "band" "ScoreBand",
    "scoringModelId" TEXT,
    "supersededById" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "answerId" TEXT,
    "code" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL DEFAULT 'MEDIUM',
    "quote" TEXT,
    "explanation" TEXT NOT NULL,
    "source" "FlagSource" NOT NULL,
    "confirmedByUserId" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contradiction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "constructId" TEXT,
    "competencyId" TEXT,
    "answerIds" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "strength" DECIMAL(4,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contradiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "competencyId" TEXT,
    "text" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "refAnswerIds" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LLM',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "versionsSnapshot" JSONB NOT NULL,
    "renderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentOutcome" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "hiringDecision" TEXT,
    "decisionDate" TIMESTAMP(3),
    "probationResult" TEXT,
    "probationScore" DECIMAL(5,2),
    "performanceNotes" TEXT,
    "followUpAssessment" DECIMAL(5,2),
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Benchmark" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Benchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkMember" (
    "benchmarkId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "BenchmarkMember_pkey" PRIMARY KEY ("benchmarkId","candidateId")
);

-- CreateTable
CREATE TABLE "CalibrationRun" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "positionId" TEXT,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "sampleSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalibrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationMetric" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "competencyCode" TEXT,
    "metric" TEXT NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "observationNote" TEXT,

    CONSTRAINT "CalibrationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionStat" (
    "id" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "completionRate" DECIMAL(5,4),
    "averageScore" DECIMAL(5,3),
    "variance" DECIMAL(8,5),
    "correlationWithTotal" DECIMAL(6,5),
    "humanOverrideRate" DECIMAL(5,4),
    "missingDataFrequency" DECIMAL(5,4),
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "needsMethodicalReview" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringModel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "params" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoringModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "role" "PromptRole" NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userTemplate" TEXT NOT NULL,
    "jsonSchema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorKind" "ActorKind" NOT NULL DEFAULT 'USER',
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Position_code_key" ON "Position"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_code_key" ON "Competency"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_code_key" ON "Assessment"("code");

-- CreateIndex
CREATE INDEX "Assessment_positionId_idx" ON "Assessment"("positionId");

-- CreateIndex
CREATE INDEX "AssessmentVersion_status_idx" ON "AssessmentVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentVersion_assessmentId_version_key" ON "AssessmentVersion"("assessmentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCompetency_assessmentVersionId_competencyId_key" ON "AssessmentCompetency"("assessmentVersionId", "competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_code_key" ON "Question"("code");

-- CreateIndex
CREATE INDEX "QuestionVersion_assessmentVersionId_section_orderIndex_idx" ON "QuestionVersion"("assessmentVersionId", "section", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_assessmentVersionId_questionId_key" ON "QuestionVersion"("assessmentVersionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_code_version_key" ON "Rubric"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RubricLevel_rubricId_level_key" ON "RubricLevel"("rubricId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Scenario_code_key" ON "Scenario"("code");

-- CreateIndex
CREATE INDEX "Scenario_assessmentVersionId_isActive_idx" ON "Scenario"("assessmentVersionId", "isActive");

-- CreateIndex
CREATE INDEX "Scenario_equivalenceGroup_idx" ON "Scenario"("equivalenceGroup");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioStage_scenarioId_stageIndex_key" ON "ScenarioStage"("scenarioId", "stageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "KellyElement_assessmentVersionId_code_key" ON "KellyElement"("assessmentVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "KellyTriad_assessmentVersionId_code_key" ON "KellyTriad"("assessmentVersionId", "code");

-- CreateIndex
CREATE INDEX "Candidate_positionId_idx" ON "Candidate"("positionId");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_status_expiresAt_idx" ON "Invitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_candidateId_idx" ON "Invitation"("candidateId");

-- CreateIndex
CREATE INDEX "TestSession_status_assessmentStatus_idx" ON "TestSession"("status", "assessmentStatus");

-- CreateIndex
CREATE INDEX "TestSession_candidateId_idx" ON "TestSession"("candidateId");

-- CreateIndex
CREATE INDEX "TestSession_reviewRequired_idx" ON "TestSession"("reviewRequired");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSessionToken_tokenHash_key" ON "CandidateSessionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CandidateSessionToken_sessionId_revokedAt_idx" ON "CandidateSessionToken"("sessionId", "revokedAt");

-- CreateIndex
CREATE INDEX "Answer_sessionId_idx" ON "Answer"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_sessionId_questionVersionId_stageIndex_key" ON "Answer"("sessionId", "questionVersionId", "stageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerRevision_answerId_revision_key" ON "AnswerRevision"("answerId", "revision");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_type_idx" ON "SessionEvent"("sessionId", "type");

-- CreateIndex
CREATE INDEX "CandidateConstruct_sessionId_orderIndex_idx" ON "CandidateConstruct"("sessionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructRating_constructId_elementId_key" ON "ConstructRating"("constructId", "elementId");

-- CreateIndex
CREATE UNIQUE INDEX "LadderStep_constructId_depth_key" ON "LadderStep"("constructId", "depth");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructSimilarityCheck_constructAId_constructBId_key" ON "ConstructSimilarityCheck"("constructAId", "constructBId");

-- CreateIndex
CREATE INDEX "GridAnalysis_sessionId_computedAt_idx" ON "GridAnalysis"("sessionId", "computedAt");

-- CreateIndex
CREATE INDEX "LLMAssessment_answerId_evaluatorRole_idx" ON "LLMAssessment"("answerId", "evaluatorRole");

-- CreateIndex
CREATE INDEX "LLMAssessment_status_idx" ON "LLMAssessment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LLMAssessment_answerId_evaluatorRole_attempt_key" ON "LLMAssessment"("answerId", "evaluatorRole", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "LLMDimensionScore_llmAssessmentId_competencyId_key" ON "LLMDimensionScore"("llmAssessmentId", "competencyId");

-- CreateIndex
CREATE INDEX "LLMEvidence_dimensionScoreId_kind_idx" ON "LLMEvidence"("dimensionScoreId", "kind");

-- CreateIndex
CREATE INDEX "HumanReview_answerId_competencyId_idx" ON "HumanReview"("answerId", "competencyId");

-- CreateIndex
CREATE INDEX "HumanReview_reviewerId_idx" ON "HumanReview"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalScore_supersededById_key" ON "FinalScore"("supersededById");

-- CreateIndex
CREATE INDEX "FinalScore_sessionId_idx" ON "FinalScore"("sessionId");

-- CreateIndex
CREATE INDEX "RiskFlag_sessionId_code_idx" ON "RiskFlag"("sessionId", "code");

-- CreateIndex
CREATE INDEX "Contradiction_sessionId_idx" ON "Contradiction"("sessionId");

-- CreateIndex
CREATE INDEX "InterviewQuestion_sessionId_orderIndex_idx" ON "InterviewQuestion"("sessionId", "orderIndex");

-- CreateIndex
CREATE INDEX "Report_sessionId_format_idx" ON "Report"("sessionId", "format");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentOutcome_candidateId_key" ON "EmploymentOutcome"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "Benchmark_code_key" ON "Benchmark"("code");

-- CreateIndex
CREATE INDEX "CalibrationMetric_runId_metric_idx" ON "CalibrationMetric"("runId", "metric");

-- CreateIndex
CREATE INDEX "QuestionStat_questionVersionId_computedAt_idx" ON "QuestionStat"("questionVersionId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringModel_code_version_key" ON "ScoringModel"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_code_version_key" ON "PromptTemplate"("code", "version");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentVersion" ADD CONSTRAINT "AssessmentVersion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentVersion" ADD CONSTRAINT "AssessmentVersion_scoringModelId_fkey" FOREIGN KEY ("scoringModelId") REFERENCES "ScoringModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentVersion" ADD CONSTRAINT "AssessmentVersion_promptTemplateAId_fkey" FOREIGN KEY ("promptTemplateAId") REFERENCES "PromptTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentVersion" ADD CONSTRAINT "AssessmentVersion_promptTemplateBId_fkey" FOREIGN KEY ("promptTemplateBId") REFERENCES "PromptTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCompetency" ADD CONSTRAINT "AssessmentCompetency_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCompetency" ADD CONSTRAINT "AssessmentCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_scenarioStageId_fkey" FOREIGN KEY ("scenarioStageId") REFERENCES "ScenarioStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCompetency" ADD CONSTRAINT "QuestionCompetency_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCompetency" ADD CONSTRAINT "QuestionCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricLevel" ADD CONSTRAINT "RubricLevel_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioStage" ADD CONSTRAINT "ScenarioStage_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KellyElement" ADD CONSTRAINT "KellyElement_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KellyTriad" ADD CONSTRAINT "KellyTriad_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KellyTriad" ADD CONSTRAINT "KellyTriad_elementAId_fkey" FOREIGN KEY ("elementAId") REFERENCES "KellyElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KellyTriad" ADD CONSTRAINT "KellyTriad_elementBId_fkey" FOREIGN KEY ("elementBId") REFERENCES "KellyElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KellyTriad" ADD CONSTRAINT "KellyTriad_elementCId_fkey" FOREIGN KEY ("elementCId") REFERENCES "KellyElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSessionToken" ADD CONSTRAINT "CandidateSessionToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerRevision" ADD CONSTRAINT "AnswerRevision_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateConstruct" ADD CONSTRAINT "CandidateConstruct_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateConstruct" ADD CONSTRAINT "CandidateConstruct_triadId_fkey" FOREIGN KEY ("triadId") REFERENCES "KellyTriad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateConstruct" ADD CONSTRAINT "CandidateConstruct_isDuplicateOf_fkey" FOREIGN KEY ("isDuplicateOf") REFERENCES "CandidateConstruct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructRating" ADD CONSTRAINT "ConstructRating_constructId_fkey" FOREIGN KEY ("constructId") REFERENCES "CandidateConstruct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructRating" ADD CONSTRAINT "ConstructRating_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "KellyElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LadderStep" ADD CONSTRAINT "LadderStep_constructId_fkey" FOREIGN KEY ("constructId") REFERENCES "CandidateConstruct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructSimilarityCheck" ADD CONSTRAINT "ConstructSimilarityCheck_constructAId_fkey" FOREIGN KEY ("constructAId") REFERENCES "CandidateConstruct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructSimilarityCheck" ADD CONSTRAINT "ConstructSimilarityCheck_constructBId_fkey" FOREIGN KEY ("constructBId") REFERENCES "CandidateConstruct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridAnalysis" ADD CONSTRAINT "GridAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMAssessment" ADD CONSTRAINT "LLMAssessment_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMAssessment" ADD CONSTRAINT "LLMAssessment_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "PromptTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMDimensionScore" ADD CONSTRAINT "LLMDimensionScore_llmAssessmentId_fkey" FOREIGN KEY ("llmAssessmentId") REFERENCES "LLMAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMDimensionScore" ADD CONSTRAINT "LLMDimensionScore_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMEvidence" ADD CONSTRAINT "LLMEvidence_llmAssessmentId_fkey" FOREIGN KEY ("llmAssessmentId") REFERENCES "LLMAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMEvidence" ADD CONSTRAINT "LLMEvidence_dimensionScoreId_fkey" FOREIGN KEY ("dimensionScoreId") REFERENCES "LLMDimensionScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReview" ADD CONSTRAINT "HumanReview_dimensionScoreId_fkey" FOREIGN KEY ("dimensionScoreId") REFERENCES "LLMDimensionScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReview" ADD CONSTRAINT "HumanReview_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReview" ADD CONSTRAINT "HumanReview_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReview" ADD CONSTRAINT "HumanReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalScore" ADD CONSTRAINT "FinalScore_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalScore" ADD CONSTRAINT "FinalScore_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalScore" ADD CONSTRAINT "FinalScore_scoringModelId_fkey" FOREIGN KEY ("scoringModelId") REFERENCES "ScoringModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalScore" ADD CONSTRAINT "FinalScore_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "FinalScore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contradiction" ADD CONSTRAINT "Contradiction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contradiction" ADD CONSTRAINT "Contradiction_constructId_fkey" FOREIGN KEY ("constructId") REFERENCES "CandidateConstruct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contradiction" ADD CONSTRAINT "Contradiction_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentOutcome" ADD CONSTRAINT "EmploymentOutcome_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentOutcome" ADD CONSTRAINT "EmploymentOutcome_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Benchmark" ADD CONSTRAINT "Benchmark_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkMember" ADD CONSTRAINT "BenchmarkMember_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "Benchmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkMember" ADD CONSTRAINT "BenchmarkMember_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationMetric" ADD CONSTRAINT "CalibrationMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CalibrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionStat" ADD CONSTRAINT "QuestionStat_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
