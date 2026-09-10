'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import {
  Card,
  ChartWithTable,
  EmptyState,
  Notice,
  Spinner,
  Table,
  Tag,
  Td,
} from '../../../components/ui/index.js';
import { DistributionChart, ScatterChart } from '../../../components/charts/index.js';
import { formatNumber, formatPercent } from '../../../lib/format.js';

/**
 * Калибровка (§31). Показывает расхождение модельной и экспертной оценки.
 * Веса модели автоматически не меняются — только наблюдения для администратора.
 */

interface CalibrationData {
  metrics: {
    sampleSize: number;
    mae: number | null;
    bias: number | null;
    deltaDistribution: Array<{ bucket: string; count: number }>;
    significantOverrideShare: number;
    byCompetency: Array<{
      competencyCode: string;
      competencyTitle: string;
      sampleSize: number;
      mae: number | null;
      bias: number | null;
      overrideRate: number;
      observation: string;
    }>;
    reviewerConsistency: Array<{
      reviewerName: string;
      reviews: number;
      averageDelta: number | null;
      deviationFromPeers: number | null;
    }>;
    points: Array<{ competencyCode: string; modelScore: number; humanScore: number }>;
    notes: string[];
  };
  outcomes: { sampleSize: number; correlation: number | null; observation: string };
}

export function CalibrationView() {
  const [data, setData] = useState<CalibrationData | null>(null);

  useEffect(() => {
    void (async () => {
      setData(await api.get<CalibrationData>('/api/calibration'));
    })();
  }, []);

  if (!data) return <Spinner label="Загрузка калибровки" />;

  const { metrics } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Сопоставлений', value: String(metrics.sampleSize) },
          { label: 'MAE', value: formatNumber(metrics.mae) },
          { label: 'Систематическое смещение', value: formatNumber(metrics.bias) },
          { label: 'Доля корректировок ≥ 1 балла', value: formatPercent(metrics.significantOverrideShare) },
        ].map((tile) => (
          <div key={tile.label} className="rounded border border-graphite-200 bg-white px-3 py-3">
            <div className="text-2xs uppercase tracking-wide text-graphite-500">{tile.label}</div>
            <div className="tnum mt-1 text-xl font-semibold text-graphite-900">{tile.value}</div>
          </div>
        ))}
      </div>

      {metrics.notes.map((note) => (
        <Notice key={note} tone="method">
          {note}
        </Notice>
      ))}
      {metrics.bias !== null && Math.abs(metrics.bias) > 0.3 && (
        <Notice tone="tech" title="Наблюдение">
          Модель систематически {metrics.bias > 0 ? 'завышает' : 'занижает'} оценку относительно
          экспертной на {formatNumber(Math.abs(metrics.bias))} балла. Это наблюдение для методической
          проверки rubric и промптов; автоматических изменений не производится.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartWithTable
          title="Модельная оценка против экспертной"
          note="Пунктир — линия полного согласия. Точки выше линии: эксперт оценил выше модели."
          chart={
            <ScatterChart
              points={metrics.points.map((point) => ({
                x: point.modelScore,
                y: point.humanScore,
                label: `${point.competencyCode}: модель ${point.modelScore}, эксперт ${point.humanScore}`,
              }))}
            />
          }
          table={
            metrics.points.length === 0 ? (
              <EmptyState title="Экспертных сопоставлений пока нет" />
            ) : (
              <Table
                headers={[
                  { label: 'Компетенция' },
                  { label: 'Модель', align: 'right' },
                  { label: 'Эксперт', align: 'right' },
                  { label: 'Расхождение', align: 'right' },
                ]}
              >
                {metrics.points.slice(0, 100).map((point, index) => (
                  <tr key={index}>
                    <Td>{point.competencyCode}</Td>
                    <Td numeric align="right">{formatNumber(point.modelScore)}</Td>
                    <Td numeric align="right">{formatNumber(point.humanScore)}</Td>
                    <Td numeric align="right">{formatNumber(point.modelScore - point.humanScore)}</Td>
                  </tr>
                ))}
              </Table>
            )
          }
        />

        <ChartWithTable
          title="Распределение расхождений"
          chart={<DistributionChart buckets={metrics.deltaDistribution} />}
          table={
            <Table headers={[{ label: 'Величина расхождения' }, { label: 'Случаев', align: 'right' }]}>
              {metrics.deltaDistribution.map((bucket) => (
                <tr key={bucket.bucket}>
                  <Td>{bucket.bucket}</Td>
                  <Td numeric align="right">{bucket.count}</Td>
                </tr>
              ))}
            </Table>
          }
        />
      </div>

      <Card title="Наблюдения по компетенциям">
        {metrics.byCompetency.length === 0 ? (
          <EmptyState title="Недостаточно экспертных оценок" />
        ) : (
          <Table
            headers={[
              { label: 'Компетенция' },
              { label: 'Выборка', align: 'right' },
              { label: 'MAE', align: 'right' },
              { label: 'Смещение', align: 'right' },
              { label: 'Частота корректировок', align: 'right' },
              { label: 'Наблюдение' },
            ]}
          >
            {metrics.byCompetency.map((item) => (
              <tr key={item.competencyCode}>
                <Td>{item.competencyTitle}</Td>
                <Td numeric align="right">{item.sampleSize}</Td>
                <Td numeric align="right">{formatNumber(item.mae)}</Td>
                <Td numeric align="right">{formatNumber(item.bias)}</Td>
                <Td numeric align="right">{formatPercent(item.overrideRate)}</Td>
                <Td className="text-xs">{item.observation}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Согласованность экспертов">
          {metrics.reviewerConsistency.length === 0 ? (
            <EmptyState title="Экспертных оценок пока нет" />
          ) : (
            <Table
              headers={[
                { label: 'Эксперт' },
                { label: 'Проверок', align: 'right' },
                { label: 'Среднее расхождение с моделью', align: 'right' },
                { label: 'Отклонение от коллег', align: 'right' },
              ]}
            >
              {metrics.reviewerConsistency.map((reviewer) => (
                <tr key={reviewer.reviewerName}>
                  <Td>{reviewer.reviewerName}</Td>
                  <Td numeric align="right">{reviewer.reviews}</Td>
                  <Td numeric align="right">{formatNumber(reviewer.averageDelta)}</Td>
                  <Td numeric align="right">{formatNumber(reviewer.deviationFromPeers)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Связь с последующей профессиональной эффективностью">
          <Table headers={[{ label: 'Показатель' }, { label: 'Значение', align: 'right' }]}>
            <tr>
              <Td>Наблюдений с результатами испытательного срока</Td>
              <Td numeric align="right">{data.outcomes.sampleSize}</Td>
            </tr>
            <tr>
              <Td>Коэффициент связи</Td>
              <Td numeric align="right">{formatNumber(data.outcomes.correlation, 3)}</Td>
            </tr>
          </Table>
          <Notice tone="method">{data.outcomes.observation}</Notice>
          <Tag>изменение модели оценки выполняет администратор</Tag>
        </Card>
      </div>
    </div>
  );
}
