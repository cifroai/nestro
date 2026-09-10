import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buildRequestContext } from '@/server/http/context.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';

/**
 * Оболочка административной части. Desktop-first (§51).
 * Навигация скрывает недоступные разделы, но защита обеспечивается
 * на сервере в каждом API-обработчике — скрытие в UI защитой не является.
 */

const NAV: Array<{ href: string; label: string; permission: string }> = [
  { href: '/dashboard', label: 'Дашборд', permission: PERMISSIONS.CANDIDATE_READ },
  { href: '/candidates', label: 'Кандидаты', permission: PERMISSIONS.CANDIDATE_READ },
  { href: '/review', label: 'Экспертная проверка', permission: PERMISSIONS.REVIEW_READ },
  { href: '/compare', label: 'Сравнение', permission: PERMISSIONS.REPORT_READ },
  { href: '/invitations', label: 'Приглашения', permission: PERMISSIONS.INVITATION_READ },
  { href: '/analytics', label: 'Аналитика', permission: PERMISSIONS.ANALYTICS_READ },
  { href: '/calibration', label: 'Калибровка', permission: PERMISSIONS.CALIBRATION_READ },
  { href: '/builder', label: 'Конструктор', permission: PERMISSIONS.ASSESSMENT_READ },
  { href: '/users', label: 'Пользователи', permission: PERMISSIONS.USER_READ },
  { href: '/audit', label: 'Журнал аудита', permission: PERMISSIONS.AUDIT_READ },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await buildRequestContext();
  if (!ctx.user) redirect('/login');

  const held = new Set(ctx.user.permissions);
  const items = NAV.filter((item) => held.has(item.permission as never));

  return (
    <div className="min-h-screen bg-graphite-100">
      <header className="border-b border-graphite-300 bg-white no-print">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold text-graphite-900">Платформа оценки</span>
            <span className="text-2xs text-graphite-500">
              инженерный персонал бурового сервиса
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-graphite-600">
            <span>{ctx.user.fullName}</span>
            <span className="text-graphite-400">{ctx.user.roles.join(', ')}</span>
            <form action="/api/auth/logout" method="post">
              <Link href="/login" className="text-accent-700 hover:underline">
                Выйти
              </Link>
            </form>
          </div>
        </div>
        <nav aria-label="Основная навигация" className="mx-auto max-w-[1600px] px-4">
          <ul className="flex flex-wrap gap-x-1 gap-y-1 pb-2">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded px-2.5 py-1 text-xs text-graphite-700 hover:bg-graphite-100"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-[1600px] px-4 py-5">
        {children}
      </main>
    </div>
  );
}
