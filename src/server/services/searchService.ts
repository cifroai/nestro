import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { badRequest } from '../http/errors.js';

/**
 * Полнотекстовый поиск (§57) по кандидатам, конструктам, ответам и
 * комментариям экспертов. Используется PostgreSQL FTS с конфигурацией
 * `russian` и GIN-индексами (см. миграцию constraints_and_fts).
 *
 * Единственное место в кодовой базе, где допускается $queryRaw; запросы
 * строятся через Prisma.sql — параметризация обязательна (T11).
 */

export type SearchScope = 'candidates' | 'constructs' | 'answers' | 'reviews';

export interface SearchResultItem {
  scope: SearchScope;
  id: string;
  title: string;
  snippet: string;
  candidateId: string | null;
  sessionId: string | null;
  rank: number;
}

const MAX_QUERY_LENGTH = 200;

/** Преобразование пользовательского запроса в websearch_to_tsquery. */
function normalizeQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 2) throw badRequest('Поисковый запрос должен содержать не менее двух символов');
  return trimmed.slice(0, MAX_QUERY_LENGTH);
}

export async function search(
  rawQuery: string,
  scopes: SearchScope[],
  limit = 25,
): Promise<SearchResultItem[]> {
  const query = normalizeQuery(rawQuery);
  const take = Math.min(100, Math.max(1, limit));
  const results: SearchResultItem[] = [];

  if (scopes.includes('candidates')) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; fullName: string; snippet: string; rank: number }>
    >(Prisma.sql`
      SELECT c."id",
             c."fullName",
             coalesce(c."email", '') AS snippet,
             ts_rank(to_tsvector('russian', coalesce(c."fullName", '') || ' ' || coalesce(c."email", '')),
                     websearch_to_tsquery('russian', ${query})) AS rank
      FROM "Candidate" c
      WHERE to_tsvector('russian', coalesce(c."fullName", '') || ' ' || coalesce(c."email", ''))
            @@ websearch_to_tsquery('russian', ${query})
      ORDER BY rank DESC
      LIMIT ${take}
    `);
    results.push(
      ...rows.map((r) => ({
        scope: 'candidates' as const,
        id: r.id,
        title: r.fullName,
        snippet: r.snippet,
        candidateId: r.id,
        sessionId: null,
        rank: Number(r.rank),
      })),
    );
  }

  if (scopes.includes('constructs')) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; sessionId: string; title: string; snippet: string; rank: number }>
    >(Prisma.sql`
      SELECT cc."id",
             cc."sessionId",
             cc."poleLeft" || ' ↔ ' || cc."poleRight" AS title,
             ts_headline('russian',
               coalesce(cc."importanceReason", '') || ' ' || coalesce(cc."rigManifestation", '') || ' ' ||
               coalesce(cc."experienceExample", ''),
               websearch_to_tsquery('russian', ${query}),
               'MaxFragments=1, MaxWords=30, MinWords=10') AS snippet,
             ts_rank(to_tsvector('russian',
               coalesce(cc."poleLeft", '') || ' ' || coalesce(cc."poleRight", '') || ' ' ||
               coalesce(cc."importanceReason", '') || ' ' || coalesce(cc."rigManifestation", '') || ' ' ||
               coalesce(cc."experienceExample", '')),
               websearch_to_tsquery('russian', ${query})) AS rank
      FROM "CandidateConstruct" cc
      WHERE to_tsvector('russian',
              coalesce(cc."poleLeft", '') || ' ' || coalesce(cc."poleRight", '') || ' ' ||
              coalesce(cc."importanceReason", '') || ' ' || coalesce(cc."rigManifestation", '') || ' ' ||
              coalesce(cc."experienceExample", ''))
            @@ websearch_to_tsquery('russian', ${query})
      ORDER BY rank DESC
      LIMIT ${take}
    `);
    results.push(
      ...rows.map((r) => ({
        scope: 'constructs' as const,
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        candidateId: null,
        sessionId: r.sessionId,
        rank: Number(r.rank),
      })),
    );
  }

  if (scopes.includes('answers')) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; sessionId: string; title: string; snippet: string; rank: number }>
    >(Prisma.sql`
      SELECT a."id",
             a."sessionId",
             q."code" AS title,
             ts_headline('russian', coalesce(a."textValue", ''),
               websearch_to_tsquery('russian', ${query}),
               'MaxFragments=2, MaxWords=32, MinWords=12') AS snippet,
             ts_rank(to_tsvector('russian', coalesce(a."textValue", '')),
                     websearch_to_tsquery('russian', ${query})) AS rank
      FROM "Answer" a
      JOIN "QuestionVersion" qv ON qv."id" = a."questionVersionId"
      JOIN "Question" q ON q."id" = qv."questionId"
      WHERE to_tsvector('russian', coalesce(a."textValue", ''))
            @@ websearch_to_tsquery('russian', ${query})
      ORDER BY rank DESC
      LIMIT ${take}
    `);
    results.push(
      ...rows.map((r) => ({
        scope: 'answers' as const,
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        candidateId: null,
        sessionId: r.sessionId,
        rank: Number(r.rank),
      })),
    );
  }

  if (scopes.includes('reviews')) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; sessionId: string | null; title: string; snippet: string; rank: number }>
    >(Prisma.sql`
      SELECT hr."id",
             a."sessionId",
             cmp."code" AS title,
             ts_headline('russian', hr."reviewReason",
               websearch_to_tsquery('russian', ${query}),
               'MaxFragments=1, MaxWords=32, MinWords=12') AS snippet,
             ts_rank(to_tsvector('russian', hr."reviewReason"),
                     websearch_to_tsquery('russian', ${query})) AS rank
      FROM "HumanReview" hr
      LEFT JOIN "Answer" a ON a."id" = hr."answerId"
      JOIN "Competency" cmp ON cmp."id" = hr."competencyId"
      WHERE to_tsvector('russian', hr."reviewReason") @@ websearch_to_tsquery('russian', ${query})
      ORDER BY rank DESC
      LIMIT ${take}
    `);
    results.push(
      ...rows.map((r) => ({
        scope: 'reviews' as const,
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        candidateId: null,
        sessionId: r.sessionId,
        rank: Number(r.rank),
      })),
    );
  }

  return results.sort((a, b) => b.rank - a.rank).slice(0, take);
}
