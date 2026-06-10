"use client";

// Mobile bottom tab bar — one-tap switching between the app's top-level
// surfaces. Shown only on hub screens (new-chat welcome, project home) where
// no message input is pinned to the bottom; conversation screens keep their
// full height, iMessage-style. Hidden on desktop via the .mobile-tabbar media
// rules in globals.css, and hidden while the keyboard is open.

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

function isHubRoute(pathname: string): boolean {
  if (pathname === "/chat") return true;
  // Project home (/projects/[id]) but not a chat inside it
  if (/^\/projects\/[^/]+$/.test(pathname)) return true;
  return false;
}

export default function MobileTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onResize() {
      setKeyboardOpen(window.innerHeight - (vv?.height ?? window.innerHeight) > 80);
    }
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  if (!isHubRoute(pathname) || keyboardOpen) return null;

  const tabs = [
    {
      label: "Chats",
      href: "/chat",
      active: pathname.startsWith("/chat") || pathname.startsWith("/projects"),
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 3C5.86 3 2.5 5.91 2.5 9.5c0 1.62.68 3.1 1.81 4.24-.13.95-.5 2.1-1.31 2.96 1.53-.05 2.86-.6 3.81-1.23.98.34 2.06.53 3.19.53 4.14 0 7.5-2.91 7.5-6.5S14.14 3 10 3Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      label: "Family",
      href: "/family",
      active: pathname.startsWith("/family"),
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3 9.5 10 3l7 6.5M5 8.5V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      label: "Settings",
      href: "/settings",
      active: pathname.startsWith("/settings"),
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
  ];

  return (
    <nav className="mobile-tabbar" aria-label="Main navigation">
      {tabs.map((tab) => (
        <button
          key={tab.href}
          type="button"
          className={`mobile-tabbar-item${tab.active ? " mobile-tabbar-item--active" : ""}`}
          onClick={() => router.push(tab.href)}
          aria-label={tab.label}
          aria-current={tab.active ? "page" : undefined}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
