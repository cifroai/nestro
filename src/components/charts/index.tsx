'use client';

import { useId } from 'react';

/**
 * Графики на чистом SVG (ADR-8). Причины отказа от библиотек:
 *  — полный контроль над цветовой семантикой (§51: цвет не кодирует человека);
 *  — SSR-совместимость для печати отчёта;
 *  — доступность: у каждого графика есть табличный эквивалент (§52).
 *
 * Палитра нейтральная: акцент индиго, оттенки графита. Красный не применяется.
 */

const ACCENT = '#4f46e5';
const ACCENT_LIGHT = '#a5b4fc';
const GRID = '#d5d9df';
const TEXT = '#4e5a69';

export interface SeriesPoint {
  label: string;
  value: number | null;
  /** Дополнительная величина для парного отображения (например эталон). */
  reference?: number | null;
}

/** Столбчатая диаграмма. Значения null отображаются как «нет данных». */
export function BarChart({
  data,
  max = 100,
  height = 220,
  unit = '',
  referenceLabel,
}: {
  data: SeriesPoint[];
  max?: number;
  height?: number;
  unit?: string;
  referenceLabel?: string;
}) {
  const barWidth = 34;
  const gap = 16;
  const paddingLeft = 44;
  const paddingBottom = 56;
  const width = paddingLeft + data.length * (barWidth + gap) + 16;
  const plotHeight = height - paddingBottom;
  const titleId = useId();

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>Столбчатая диаграмма значений</title>
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = plotHeight - tick * plotHeight + 8;
        return (
          <g key={tick}>
            <line x1={paddingLeft} y1={y} x2={width - 8} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={paddingLeft - 6} y={y + 3} textAnchor="end" fontSize={9} fill={TEXT}>
              {Math.round(max * tick)}
            </text>
          </g>
        );
      })}
      {data.map((point, index) => {
        const x = paddingLeft + index * (barWidth + gap);
        if (point.value === null) {
          return (
            <g key={point.label}>
              <text x={x + barWidth / 2} y={plotHeight} textAnchor="middle" fontSize={8} fill={TEXT}>
                нет данных
              </text>
              <text
                x={x + barWidth / 2}
                y={plotHeight + 20}
                textAnchor="middle"
                fontSize={9}
                fill={TEXT}
              >
                {point.label.length > 12 ? `${point.label.slice(0, 11)}…` : point.label}
              </text>
            </g>
          );
        }
        const ratio = Math.max(0, Math.min(1, point.value / max));
        const barHeight = ratio * plotHeight;
        return (
          <g key={point.label}>
            {point.reference !== undefined && point.reference !== null && (
              <line
                x1={x - 3}
                x2={x + barWidth + 3}
                y1={plotHeight + 8 - (point.reference / max) * plotHeight}
                y2={plotHeight + 8 - (point.reference / max) * plotHeight}
                stroke={TEXT}
                strokeDasharray="3 2"
                strokeWidth={1.2}
              />
            )}
            <rect
              x={x}
              y={plotHeight + 8 - barHeight}
              width={barWidth}
              height={barHeight}
              fill={ACCENT}
              rx={1}
            />
            <text
              x={x + barWidth / 2}
              y={plotHeight + 8 - barHeight - 4}
              textAnchor="middle"
              fontSize={9}
              fill={TEXT}
            >
              {point.value.toFixed(unit === '%' ? 0 : 1)}
              {unit}
            </text>
            <text x={x + barWidth / 2} y={plotHeight + 24} textAnchor="middle" fontSize={9} fill={TEXT}>
              {point.label.length > 12 ? `${point.label.slice(0, 11)}…` : point.label}
            </text>
          </g>
        );
      })}
      {referenceLabel && (
        <text x={paddingLeft} y={height - 6} fontSize={9} fill={TEXT}>
          Пунктир — {referenceLabel}
        </text>
      )}
    </svg>
  );
}

/** Лепестковая диаграмма профиля компетенций или осей. */
export function RadarChart({
  data,
  max = 4,
  size = 340,
}: {
  data: SeriesPoint[];
  max?: number;
  size?: number;
}) {
  const titleId = useId();
  const center = size / 2;
  const radius = center - 62;
  const count = data.length;
  if (count < 3) {
    return <p className="py-4 text-xs text-graphite-500">Для лепестковой диаграммы нужно не менее трёх осей.</p>;
  }

  const angleFor = (index: number): number => (Math.PI * 2 * index) / count - Math.PI / 2;
  const pointFor = (index: number, ratio: number): [number, number] => [
    center + Math.cos(angleFor(index)) * radius * ratio,
    center + Math.sin(angleFor(index)) * radius * ratio,
  ];

  const polygon = data
    .map((point, index) => {
      const ratio = point.value === null ? 0 : Math.max(0, Math.min(1, point.value / max));
      const [x, y] = pointFor(index, ratio);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Лепестковая диаграмма профиля</title>
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={data
            .map((_, index) => {
              const [x, y] = pointFor(index, ring);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ')}
          fill="none"
          stroke={GRID}
          strokeWidth={1}
        />
      ))}
      {data.map((point, index) => {
        const [x, y] = pointFor(index, 1);
        return <line key={point.label} x1={center} y1={center} x2={x} y2={y} stroke={GRID} strokeWidth={1} />;
      })}
      <polygon points={polygon} fill={ACCENT} fillOpacity={0.18} stroke={ACCENT} strokeWidth={1.6} />
      {data.map((point, index) => {
        const ratio = point.value === null ? 0 : Math.max(0, Math.min(1, point.value / max));
        const [px, py] = pointFor(index, ratio);
        const [lx, ly] = pointFor(index, 1.16);
        const anchor = lx < center - 6 ? 'end' : lx > center + 6 ? 'start' : 'middle';
        return (
          <g key={`${point.label}-label`}>
            {point.value !== null && <circle cx={px} cy={py} r={2.6} fill={ACCENT} />}
            <text x={lx} y={ly} textAnchor={anchor} fontSize={9} fill={TEXT}>
              {point.label.length > 18 ? `${point.label.slice(0, 17)}…` : point.label}
            </text>
            <text x={lx} y={ly + 10} textAnchor={anchor} fontSize={9} fill={TEXT} className="tnum">
              {point.value === null ? 'нет данных' : point.value.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Гистограмма распределения. */
export function DistributionChart({
  buckets,
  height = 180,
}: {
  buckets: Array<{ bucket: string; count: number }>;
  height?: number;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return <BarChart data={buckets.map((b) => ({ label: b.bucket, value: b.count }))} max={max} height={height} />;
}

/**
 * Тепловая карта репертуарной решётки. Насыщенность отражает положение
 * между полюсами конструкта, а не «хорошо/плохо».
 */
export function GridHeatmap({
  elements,
  rows,
}: {
  elements: Array<{ code: string; label: string }>;
  rows: Array<{ constructId: string; poleLeft: string; poleRight: string; values: Array<number | null> }>;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-xs text-graphite-500">Репертуарная решётка не заполнена.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
        <caption className="sr-only">Тепловая карта репертуарной решётки</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-normal text-graphite-500">
              Левый полюс
            </th>
            {elements.map((element) => (
              <th
                key={element.code}
                scope="col"
                title={element.label}
                className="px-1 py-1 text-center font-semibold text-graphite-600"
              >
                {element.code}
              </th>
            ))}
            <th scope="col" className="px-2 py-1 text-left font-normal text-graphite-500">
              Правый полюс
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.constructId}>
              <th scope="row" className="max-w-[13rem] px-2 py-1 text-left font-normal text-graphite-700">
                {row.poleLeft}
              </th>
              {row.values.map((value, index) => (
                <td
                  key={`${row.constructId}-${elements[index]?.code ?? index}`}
                  className="tnum h-7 w-7 border border-white text-center text-graphite-900"
                  style={{
                    background:
                      value === null ? '#f6f7f8' : `rgba(79, 70, 229, ${((value - 1) / 6) * 0.55})`,
                  }}
                  title={`${elements[index]?.label ?? ''}: ${value ?? 'не заполнено'}`}
                >
                  {value ?? '—'}
                </td>
              ))}
              <th scope="row" className="max-w-[13rem] px-2 py-1 text-left font-normal text-graphite-700">
                {row.poleRight}
              </th>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-2xs text-graphite-500">
        Насыщенность отражает положение специалиста между полюсами критерия (1 — левый полюс,
        7 — правый) и не является оценкой «хорошо / плохо».
      </p>
    </div>
  );
}

/** Диаграмма рассеяния для калибровки: модельная оценка против экспертной. */
export function ScatterChart({
  points,
  size = 320,
  max = 4,
  xLabel = 'Оценка модели',
  yLabel = 'Оценка эксперта',
}: {
  points: Array<{ x: number; y: number; label?: string }>;
  size?: number;
  max?: number;
  xLabel?: string;
  yLabel?: string;
}) {
  const titleId = useId();
  const padding = 44;
  const plot = size - padding * 2;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Диаграмма рассеяния оценок модели и эксперта</title>
      <rect x={padding} y={padding} width={plot} height={plot} fill="none" stroke={GRID} />
      {[0, 1, 2, 3, 4].map((tick) => {
        const ratio = tick / max;
        const x = padding + ratio * plot;
        const y = padding + plot - ratio * plot;
        return (
          <g key={tick}>
            <line x1={x} y1={padding} x2={x} y2={padding + plot} stroke={GRID} strokeWidth={0.6} />
            <line x1={padding} y1={y} x2={padding + plot} y2={y} stroke={GRID} strokeWidth={0.6} />
            <text x={x} y={padding + plot + 14} textAnchor="middle" fontSize={9} fill={TEXT}>
              {tick}
            </text>
            <text x={padding - 8} y={y + 3} textAnchor="end" fontSize={9} fill={TEXT}>
              {tick}
            </text>
          </g>
        );
      })}
      {/* Линия полного согласия модели и эксперта. */}
      <line
        x1={padding}
        y1={padding + plot}
        x2={padding + plot}
        y2={padding}
        stroke={ACCENT_LIGHT}
        strokeDasharray="4 3"
        strokeWidth={1.2}
      />
      {points.map((point, index) => (
        <circle
          key={`${point.x}-${point.y}-${index}`}
          cx={padding + (point.x / max) * plot}
          cy={padding + plot - (point.y / max) * plot}
          r={3.2}
          fill={ACCENT}
          fillOpacity={0.65}
        >
          <title>{point.label ?? `модель ${point.x}, эксперт ${point.y}`}</title>
        </circle>
      ))}
      <text x={padding + plot / 2} y={size - 6} textAnchor="middle" fontSize={9} fill={TEXT}>
        {xLabel}
      </text>
      <text
        x={12}
        y={padding + plot / 2}
        textAnchor="middle"
        fontSize={9}
        fill={TEXT}
        transform={`rotate(-90 12 ${padding + plot / 2})`}
      >
        {yLabel}
      </text>
    </svg>
  );
}

/** Линейный график динамики параметра кейса. */
export function LineChart({
  series,
  height = 160,
}: {
  series: Array<{ label: string; unit: string; points: Array<{ t: string; value: number }> }>;
  height?: number;
}) {
  const titleId = useId();
  const width = 420;
  const padding = { left: 46, right: 12, top: 12, bottom: 26 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  return (
    <div className="space-y-4">
      {series.map((item) => {
        const values = item.points.map((p) => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const path = item.points
          .map((point, index) => {
            const x = padding.left + (index / Math.max(1, item.points.length - 1)) * plotWidth;
            const y = padding.top + plotHeight - ((point.value - min) / range) * plotHeight;
            return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');

        return (
          <div key={item.label}>
            <div className="mb-1 text-xs font-medium text-graphite-700">
              {item.label}
              {item.unit ? `, ${item.unit}` : ''}
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby={titleId}>
              <title id={titleId}>Динамика параметра {item.label}</title>
              <line
                x1={padding.left}
                y1={padding.top + plotHeight}
                x2={width - padding.right}
                y2={padding.top + plotHeight}
                stroke={GRID}
              />
              <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotHeight} stroke={GRID} />
              <text x={padding.left - 6} y={padding.top + 4} textAnchor="end" fontSize={9} fill={TEXT}>
                {max}
              </text>
              <text x={padding.left - 6} y={padding.top + plotHeight} textAnchor="end" fontSize={9} fill={TEXT}>
                {min}
              </text>
              <path d={path} fill="none" stroke={ACCENT} strokeWidth={1.8} />
              {item.points.map((point, index) => {
                const x = padding.left + (index / Math.max(1, item.points.length - 1)) * plotWidth;
                const y = padding.top + plotHeight - ((point.value - min) / range) * plotHeight;
                return (
                  <g key={point.t}>
                    <circle cx={x} cy={y} r={2.6} fill={ACCENT} />
                    <text x={x} y={height - 8} textAnchor="middle" fontSize={8} fill={TEXT}>
                      {point.t}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
