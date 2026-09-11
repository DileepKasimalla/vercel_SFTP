import type { ReactNode } from "react";

export function Banner({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`banner banner--${kind}`}>{children}</div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__dot" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

/** The FedEx wordmark shown at the top-left of every screen. */
export function Logo() {
  return (
    <span className="logo" aria-label="FedEx">
      <span className="logo__fed">Fed</span>
      <span className="logo__ex">Ex</span>
      <span className="logo__reg">®</span>
    </span>
  );
}

/** "FedEx Net®" product heading used at the top of every content screen. */
export function Product({ hero = false }: { hero?: boolean }) {
  return (
    <div className={`product ${hero ? "product--hero" : ""}`}>
      FedEx Net<sup>®</sup>
    </div>
  );
}

/** Timestamp in the FTN style: "2026-09-10 09:35:07.0" (local time). */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.0`
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human-readable retention countdown, e.g. "4 days left" / "6 hours left". */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Expired";
  // Ceiling, so a file uploaded a minute ago under a 5-day window reads
  // "5 days left" rather than "4".
  const days = Math.ceil(seconds / 86400);
  if (seconds >= 86400) return days === 1 ? "1 day left" : days + " days left";
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return hours === 1 ? "1 hour left" : hours + " hours left";
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return minutes === 1 ? "1 minute left" : minutes + " minutes left";
}

/** Files close to their deletion deadline get a warning colour. */
export function expiryTone(seconds: number): "ok" | "warn" | "off" {
  if (seconds <= 0) return "off";
  return seconds <= 86400 ? "warn" : "ok";
}

export function CopyField({ value }: { value: string }) {
  return (
    <div className="copy-field">
      <code>{value}</code>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        Copy
      </button>
    </div>
  );
}
