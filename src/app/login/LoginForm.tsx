'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, api, setCsrfToken } from '../../lib/api.js';
import { Button, TechError } from '../../components/ui/index.js';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ csrfToken: string }>('/api/auth/login', { email, password });
      setCsrfToken(result.csrfToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Не удалось выполнить вход');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      {error && <TechError>{error}</TechError>}
      <div className="mb-4">
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-graphite-800">
          Адрес электронной почты
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded border border-graphite-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="mb-5">
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-graphite-800">
          Пароль
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded border border-graphite-300 px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? 'Вход…' : 'Войти'}
      </Button>
    </form>
  );
}
