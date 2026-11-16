import type { AnalyticsSummary } from '../core/stats.js';

export function renderHeatmapSvg(summary: AnalyticsSummary): string {
  const days = summary.heatmapDays;
  const cellSize = 14;
  const gap = 4;
  const step = cellSize + gap;

  // Group into weeks (columns)
  const columns: Array<typeof days> = [];
  let currentCol: typeof days = [];

  for (const day of days) {
    if (day.dayOfWeek === 0 && currentCol.length > 0) {
      columns.push(currentCol);
      currentCol = [];
    }
    currentCol.push(day);
  }
  if (currentCol.length > 0) {
    columns.push(currentCol);
  }

  const leftLabelWidth = 28;
  const topPad = 18;
  const width = leftLabelWidth + columns.length * step + 8;
  const height = topPad + 7 * step + 6;

  const dayLabels = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];
  const labelSvg = dayLabels
    .map((lbl, idx) =>
      lbl
        ? `<text x="0" y="${topPad + idx * step + 11}" class="heatmap-label">${lbl}</text>`
        : '',
    )
    .join('');

  const cellsSvg = columns
    .map((col, colIdx) => {
      return col
        .map((day) => {
          const x = leftLabelWidth + colIdx * step;
          const y = topPad + day.dayOfWeek * step;
          const title = `${day.dateKey}: ${day.count} pomodoro${day.count === 1 ? '' : 's'} (${day.minutes}m)`;
          return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3.5" class="heatmap-cell level-${day.level}"><title>${title}</title></rect>`;
        })
        .join('');
    })
    .join('');

  return `
    <svg class="heatmap-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="12-week focus activity heatmap">
      ${labelSvg}
      ${cellsSvg}
    </svg>
  `;
}

export function renderHourlyChartSvg(hourlyMinutes: readonly number[]): string {
  const maxVal = Math.max(30, ...hourlyMinutes);
  const width = 480;
  const height = 110;
  const padBottom = 20;
  const chartHeight = height - padBottom - 8;
  const barWidth = 14;
  const gap = 6;

  const bars = hourlyMinutes
    .map((mins, hour) => {
      const h = Math.max(3, Math.round((mins / maxVal) * chartHeight));
      const x = hour * (barWidth + gap);
      const y = chartHeight + 6 - h;
      const isActive = mins > 0;
      const showLabel = hour % 4 === 0;
      const label = showLabel
        ? `<text x="${x + barWidth / 2}" y="${height - 4}" text-anchor="middle" class="heatmap-label">${String(hour).padStart(2, '0')}</text>`
        : '';
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="3" class="hourly-bar ${isActive ? 'is-active' : ''}">
          <title>${String(hour).padStart(2, '0')}:00 — ${mins} focus min</title>
        </rect>
        ${label}
      `;
    })
    .join('');

  return `
    <svg class="hourly-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hourly focus distribution">
      ${bars}
    </svg>
  `;
}
