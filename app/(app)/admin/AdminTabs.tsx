"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The platform admin's two lists: every shul, and every account. */
const TABS = [
  { href: "/admin", label: "Shuls", match: (path: string) => path === "/admin" || path.startsWith("/admin/shuls") },
  { href: "/admin/accounts", label: "Accounts", match: (path: string) => path.startsWith("/admin/accounts") },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform admin" className="border-rule mt-4 flex gap-1 border-b">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`text-body -mb-px border-b-2 px-3 py-2 ${
              active ? "border-verdigris text-verdigris" : "text-ink-soft hover:text-ink border-transparent"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
