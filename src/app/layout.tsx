import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Платформа оценки инженерного персонала',
  description:
    'Корпоративная платформа дистанционной оценки инженерного персонала бурового сервиса',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <a href="#main" className="skip-link">
          Перейти к основному содержанию
        </a>
        {children}
      </body>
    </html>
  );
}
