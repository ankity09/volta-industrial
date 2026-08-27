/**
 * The filterable at-risk lines table. Risk band filter chips + search + plant/machine filters +
 * the row list itself. Click a row → opens the detail drawer. Rows whose risk band or action
 * changed between dataMutated refetches pulse a critical-red highlight (1.5s) so the user's
 * eye lands on what the agent just flipped.
 */
import { Search } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { LineStatus, RiskBand } from '@/shared/types';
import { RiskBandBadge, ActionBadge } from '@/shared/badges';

const RISK_TABS: { value: RiskBand | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'elevated', label: 'Elevated' },
  { value: 'watch', label: 'Watch' },
  { value: 'healthy', label: 'Healthy' },
];

function SortHeader({
  label,
  active,
  onClick,
  align = 'left',
  hint,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`inline-flex items-center gap-1 ${
        align === 'right' ? 'flex-row-reverse' : ''
      } ${
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      } transition-colors cursor-pointer`}
    >
      {label}
      <span className="text-[10px]" aria-hidden>
        {active ? '↓' : '↕'}
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr
          key={i}
          className="border-t border-border"
          style={{ animation: `skelPulse 1.2s ease-in-out ${i * 60}ms infinite` }}
        >
          {Array.from({ length: 8 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 w-32 rounded bg-muted" />
            </td>
          ))}
        </tr>
      ))}
      <style>{`
        @keyframes skelPulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}

type SortKey = 'risk' | 'exposure' | 'vibration';

type Props = {
  rows: LineStatus[];
  loading: boolean;
  error: string | null;
  riskFilter: RiskBand | 'all';
  onRiskFilter: (r: RiskBand | 'all') => void;
  search: string;
  onSearch: (s: string) => void;
  plantFilter: string | null;
  onPlantFilter: (p: string | null) => void;
  machineFilter: string | null;
  onMachineFilter: (m: string | null) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onSelect: (id: string) => void;
};

export function LinesTable({
  rows,
  loading,
  error,
  riskFilter,
  onRiskFilter,
  search,
  onSearch,
  plantFilter,
  onPlantFilter,
  machineFilter,
  onMachineFilter,
  sort,
  onSortChange,
  onSelect,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Risk band filter"
          className="relative inline-flex rounded-full border border-border bg-card p-0.5 text-sm"
        >
          {RISK_TABS.map((r) => {
            const active = riskFilter === r.value;
            return (
              <button
                key={r.value}
                onClick={() => onRiskFilter(r.value)}
                aria-pressed={active}
                className={`relative z-10 rounded-full px-3 py-1 transition-colors duration-200 ${
                  active
                    ? 'text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-full bg-foreground transition-all"
                    style={{ viewTransitionName: 'risk-tab-active' }}
                    aria-hidden
                  />
                )}
                <span className="relative">{r.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm flex-1 sm:flex-initial min-w-[180px]">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search line, plant, machine…"
            className="bg-transparent outline-none w-full sm:w-60 placeholder:text-muted-foreground"
          />
        </div>
        {plantFilter && (
          <button
            onClick={() => onPlantFilter(null)}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
          >
            Plant: {plantFilter} ✕
          </button>
        )}
        {machineFilter && (
          <button
            onClick={() => onMachineFilter(null)}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
          >
            Machine: {machineFilter} ✕
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        {loading && (
          <div
            className="absolute inset-x-0 top-0 h-0.5 z-10 overflow-hidden"
            aria-hidden
          >
            <div
              className="h-full w-1/3 rounded-full"
              style={{
                background: '#E5484D',
                animation: 'loadingBar 1.1s ease-in-out infinite',
              }}
            />
          </div>
        )}
        {/* ───── PHONE: card list ───── */}
        <ul
          className={`sm:hidden divide-y divide-border transition-opacity duration-150 ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
          {loading && rows.length === 0 && (
            <li className="px-4 py-6 text-center text-muted-foreground text-sm">
              Loading…
            </li>
          )}
          {!loading && rows.length === 0 && (
            <li className="px-4 py-8 text-center text-muted-foreground text-sm">
              No lines match the current filters.
            </li>
          )}
          {rows.map((line) => (
            <MobileCard
              key={line.lineId}
              line={line}
              onSelect={onSelect}
              onPlantFilter={onPlantFilter}
              onMachineFilter={onMachineFilter}
            />
          ))}
        </ul>

        {/* ───── TABLET + DESKTOP: full table ───── */}
        <div
          className={`hidden sm:block transition-opacity duration-150 overflow-x-auto ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Line</th>
                <th className="text-left px-4 py-2 font-semibold">Plant</th>
                <th className="text-left px-4 py-2 font-semibold">Machine Type</th>
                <th className="text-center px-4 py-2 font-semibold">
                  <SortHeader
                    label="Vibration"
                    active={sort === 'vibration'}
                    onClick={() =>
                      onSortChange(sort === 'vibration' ? 'exposure' : 'vibration')
                    }
                    hint="Sort by RMS vibration"
                  />
                </th>
                <th className="text-center px-4 py-2 font-semibold">
                  <SortHeader
                    label="Failure Risk"
                    active={sort === 'risk'}
                    onClick={() =>
                      onSortChange(sort === 'risk' ? 'exposure' : 'risk')
                    }
                    hint="Sort by failure risk score"
                  />
                </th>
                <th className="text-center px-4 py-2 font-semibold">Part Local</th>
                <th className="text-right px-4 py-2 font-semibold">
                  <SortHeader
                    label="Downtime Exposure"
                    align="right"
                    active={sort === 'exposure'}
                    onClick={() =>
                      onSortChange(sort === 'exposure' ? 'risk' : 'exposure')
                    }
                    hint="Sort by downtime exposure cost"
                  />
                </th>
                <th className="text-left px-4 py-2 font-semibold">Recommended</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <SkeletonRows />}
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No lines match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((line) => (
                <Row
                  key={line.lineId}
                  line={line}
                  onSelect={onSelect}
                  onPlantFilter={onPlantFilter}
                  onMachineFilter={onMachineFilter}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({
  line,
  onSelect,
  onPlantFilter,
  onMachineFilter,
}: {
  line: LineStatus;
  onSelect: (id: string) => void;
  onPlantFilter: (p: string) => void;
  onMachineFilter: (m: string) => void;
}) {
  const pulse = usePulseOnChange(line.riskBand);

  return (
    <tr
      onClick={() => onSelect(line.lineId)}
      className={`border-t border-border hover:bg-muted/50 cursor-pointer transition-colors ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <td className="px-4 py-3 font-mono text-sm font-semibold text-foreground">
        {line.lineId}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlantFilter(line.plantId);
          }}
          className="text-sm hover:underline text-muted-foreground"
        >
          {line.plantId}
        </button>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMachineFilter(line.machineType);
          }}
          className="text-sm hover:underline text-muted-foreground"
        >
          {line.machineType}
        </button>
      </td>
      <td className="px-4 py-3 text-center font-mono">
        {line.vibrationRms.toFixed(2)}
      </td>
      <td className="px-4 py-3 text-center font-mono">
        {(line.failureRiskScore * 100).toFixed(0)}%
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm">{line.partLocal ? 'Yes' : 'No'}</span>
      </td>
      <td className="px-4 py-3 text-right font-mono">
        ${(line.downtimeExposureUsd / 1000).toFixed(1)}K
      </td>
      <td className="px-4 py-3">
        <RiskBandBadge band={line.riskBand} />
      </td>
    </tr>
  );
}

function MobileCard({
  line,
  onSelect,
  onPlantFilter,
  onMachineFilter,
}: {
  line: LineStatus;
  onSelect: (id: string) => void;
  onPlantFilter: (p: string) => void;
  onMachineFilter: (m: string) => void;
}) {
  const pulse = usePulseOnChange(line.riskBand);

  return (
    <li
      onClick={() => onSelect(line.lineId)}
      className={`px-4 py-4 hover:bg-muted/50 cursor-pointer transition-colors ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm font-semibold text-foreground">
            {line.lineId}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {line.machineType} · Plant {line.plantId}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">
              Vib: {line.vibrationRms.toFixed(2)} · Risk: {(line.failureRiskScore * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <RiskBandBadge band={line.riskBand} />
          <div className="text-xs font-mono text-right">
            ${(line.downtimeExposureUsd / 1000).toFixed(1)}K
          </div>
        </div>
      </div>
    </li>
  );
}
