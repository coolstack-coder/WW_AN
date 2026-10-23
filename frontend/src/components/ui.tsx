import { ReactNode, useEffect, useState } from "react";

/** Minimal data-fetching hook: re-runs whenever `deps` change, ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn()
      .then((data) => live && setState({ data, loading: false }))
      .catch((e: Error) => live && setState({ error: e.message, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function Card({ title, sub, children, className = "" }: { title?: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {title && <h3>{title}</h3>}
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  );
}

export function Kpi({ label, value, hint, color }: { label: string; value: ReactNode; hint?: ReactNode; color?: string }) {
  return (
    <div className="card kpi">
      <div className="label">
        {color && <span className="swatch" style={{ background: color }} />}
        {label}
      </div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Status({ loading, error }: { loading?: boolean; error?: string }) {
  if (error) return <div className="status error">Couldn’t load data: {error}</div>;
  if (loading) return <div className="status">Loading…</div>;
  return null;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; area?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i
            style={{
              background: i.dashed ? "transparent" : i.color,
              borderTop: i.dashed ? `2px dashed ${i.color}` : undefined,
              height: i.area ? 10 : 3,
            }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

type TooltipRow = { name: string; value: string; color?: string };
export function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="tooltip">
      <div className="t">{title}</div>
      {rows.map((r) => (
        <div className="row" key={r.name}>
          <span style={{ color: r.color ?? "var(--muted)" }}>{r.name}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
