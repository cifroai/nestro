import { TestRunner } from './TestRunner.js';

/** Страница прохождения теста. Полностью адаптивна (§51). */
export default async function TestPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return (
    <div className="min-h-screen bg-graphite-50">
      <TestRunner sessionId={sessionId} />
    </div>
  );
}
