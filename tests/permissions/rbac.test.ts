import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type RoleCode,
} from '@/server/auth/permissions.js';
import { permissionsForRoles } from '@/server/auth/session.js';

/**
 * Матрица прав (docs/SECURITY.md §3.1).
 * Проверяются требования §60: HR не может менять модель оценки,
 * Viewer не имеет права записи, кандидат не имеет административных прав.
 */

const held = (role: RoleCode): Set<Permission> => new Set(permissionsForRoles([role]));

describe('матрица ролей и прав', () => {
  it('каждое право из каталога имеет описание и уникальный код', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('SuperAdmin обладает всеми правами', () => {
    const permissions = held(ROLES.SUPER_ADMIN);
    for (const permission of ALL_PERMISSIONS) {
      expect(permissions.has(permission)).toBe(true);
    }
  });

  it('HR не может изменять модель скоринга, rubric и веса', () => {
    const permissions = held(ROLES.HR);
    expect(permissions.has(PERMISSIONS.SCORING_MODEL_WRITE)).toBe(false);
    expect(permissions.has(PERMISSIONS.RUBRIC_WRITE)).toBe(false);
    expect(permissions.has(PERMISSIONS.WEIGHTS_WRITE)).toBe(false);
    expect(permissions.has(PERMISSIONS.PROMPT_WRITE)).toBe(false);
    expect(permissions.has(PERMISSIONS.ASSESSMENT_VERSION_PUBLISH)).toBe(false);
  });

  it('HR может приглашать кандидатов и читать отчёты', () => {
    const permissions = held(ROLES.HR);
    expect(permissions.has(PERMISSIONS.INVITATION_WRITE)).toBe(true);
    expect(permissions.has(PERMISSIONS.CANDIDATE_READ)).toBe(true);
    expect(permissions.has(PERMISSIONS.REPORT_READ)).toBe(true);
  });

  it('HR не может выносить экспертную оценку', () => {
    expect(held(ROLES.HR).has(PERMISSIONS.REVIEW_WRITE)).toBe(false);
  });

  it('TechnicalExpert выносит экспертную оценку, но не публикует версии', () => {
    const permissions = held(ROLES.TECHNICAL_EXPERT);
    expect(permissions.has(PERMISSIONS.REVIEW_WRITE)).toBe(true);
    expect(permissions.has(PERMISSIONS.ASSESSMENT_VERSION_PUBLISH)).toBe(false);
    expect(permissions.has(PERMISSIONS.WEIGHTS_WRITE)).toBe(false);
    expect(permissions.has(PERMISSIONS.INVITATION_WRITE)).toBe(false);
  });

  it('Viewer не имеет ни одного права записи', () => {
    const permissions = [...held(ROLES.VIEWER)];
    const writes = permissions.filter(
      (permission) =>
        permission.endsWith(':write') ||
        permission.endsWith(':publish') ||
        permission.endsWith(':erase') ||
        permission.endsWith(':recompute'),
    );
    expect(writes).toEqual([]);
  });

  it('Viewer не может выгружать персональные данные и аналитику', () => {
    const permissions = held(ROLES.VIEWER);
    expect(permissions.has(PERMISSIONS.CANDIDATE_EXPORT_PERSONAL)).toBe(false);
    expect(permissions.has(PERMISSIONS.ANALYTICS_EXPORT)).toBe(false);
  });

  it('роль кандидата не имеет административных прав', () => {
    expect(ROLE_PERMISSIONS[ROLES.CANDIDATE]).toEqual([]);
  });

  it('право на данные после трудоустройства выдаётся точечно', () => {
    expect(held(ROLES.ASSESSMENT_ADMIN).has(PERMISSIONS.EMPLOYMENT_OUTCOME_WRITE)).toBe(false);
    expect(held(ROLES.TECHNICAL_EXPERT).has(PERMISSIONS.EMPLOYMENT_OUTCOME_WRITE)).toBe(false);
    expect(held(ROLES.VIEWER).has(PERMISSIONS.EMPLOYMENT_OUTCOME_WRITE)).toBe(false);
  });

  it('журнал аудита доступен только администраторам', () => {
    expect(held(ROLES.SUPER_ADMIN).has(PERMISSIONS.AUDIT_READ)).toBe(true);
    expect(held(ROLES.ASSESSMENT_ADMIN).has(PERMISSIONS.AUDIT_READ)).toBe(true);
    expect(held(ROLES.HR).has(PERMISSIONS.AUDIT_READ)).toBe(false);
    expect(held(ROLES.TECHNICAL_EXPERT).has(PERMISSIONS.AUDIT_READ)).toBe(false);
    expect(held(ROLES.VIEWER).has(PERMISSIONS.AUDIT_READ)).toBe(false);
  });

  it('удаление данных кандидата доступно только суперадминистратору', () => {
    for (const role of [ROLES.ASSESSMENT_ADMIN, ROLES.HR, ROLES.TECHNICAL_EXPERT, ROLES.VIEWER] as RoleCode[]) {
      expect(held(role).has(PERMISSIONS.CANDIDATE_ERASE)).toBe(false);
    }
    expect(held(ROLES.SUPER_ADMIN).has(PERMISSIONS.CANDIDATE_ERASE)).toBe(true);
  });

  it('объединение ролей даёт объединение прав без дубликатов', () => {
    const combined = permissionsForRoles([ROLES.HR, ROLES.TECHNICAL_EXPERT]);
    expect(new Set(combined).size).toBe(combined.length);
    expect(combined).toContain(PERMISSIONS.INVITATION_WRITE);
    expect(combined).toContain(PERMISSIONS.REVIEW_WRITE);
    // Объединение не создаёт прав, которых нет ни у одной из ролей.
    expect(combined).not.toContain(PERMISSIONS.SCORING_MODEL_WRITE);
  });
});
