"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { label: "Usage", href: "/admin/usage" },
  { label: "Members", href: "/admin/members" },
  { label: "Health", href: "/admin/health" },
  { label: "Memory", href: "/admin/memory" },
  { label: "Dev", href: "/admin/dev" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <Link href="/chat" className="admin-back-link">
          ← Bruce
        </Link>
        <span className="admin-header-sep">/</span>
        <span className="admin-header-title">Admin</span>
      </header>

      <div className="admin-body">
        <nav className="admin-nav" aria-label="Admin sections">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-item${isActive ? " admin-nav-item--active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
