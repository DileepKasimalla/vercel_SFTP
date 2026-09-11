import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "./ui";

/** Header title, e.g. "FTN-Prod". Override with VITE_PORTAL_TITLE at build time. */
export const PORTAL_TITLE: string =
  (import.meta.env.VITE_PORTAL_TITLE as string | undefined) || "FTN-Prod";

export interface NavItem {
  label: string;
  /** Clicking the link. Parents without an onSelect just expand/collapse. */
  onSelect?: () => void;
  active?: boolean;
  children?: NavItem[];
  /** Whether the children are shown. */
  open?: boolean;
}

/**
 * FedEx Net page frame: wordmark + centred title over a purple rule, then a
 * grey navigation column on the left and the screen content on the right.
 * Screens without a nav (login, setup) get the full width.
 */
export default function Shell({
  nav,
  headerRight,
  children,
}: {
  nav?: NavItem[];
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ftn">
      <header className="ftn__header">
        <Link to="/" aria-label="Portal home" style={{ textDecoration: "none" }}>
          <Logo />
        </Link>
        <div className="ftn__title">{PORTAL_TITLE}</div>
        <div className="ftn__header-right">{headerRight}</div>
      </header>

      <div className="ftn__body">
        {nav ? (
          <nav className="ftn__nav" aria-label="Main">
            <NavList items={nav} />
          </nav>
        ) : null}
        <main className={`ftn__main ${nav ? "" : "ftn__main--full"}`}>{children}</main>
      </div>
    </div>
  );
}

function NavList({ items }: { items: NavItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            className={`navlink ${item.active ? "navlink--active" : ""}`}
            onClick={item.onSelect}
            aria-expanded={item.children ? Boolean(item.open) : undefined}
          >
            {item.label}
          </button>
          {item.children && item.open ? <NavList items={item.children} /> : null}
        </li>
      ))}
    </ul>
  );
}
