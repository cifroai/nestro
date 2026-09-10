import { LoginForm } from './LoginForm.js';

export default function LoginPage() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-graphite-100 px-4">
      <div className="w-full max-w-sm rounded border border-graphite-200 bg-white px-6 py-8">
        <h1 className="mb-1 text-lg font-semibold text-graphite-900">Платформа оценки</h1>
        <p className="mb-6 text-xs text-graphite-500">
          Вход для сотрудников. Кандидаты проходят тестирование по персональной ссылке.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
