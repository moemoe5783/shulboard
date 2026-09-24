"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The shul's settings, in two parts: the shul itself, and the people in it. */
const TABS = [
  { href: "/settings", label: "Shul" },
  { href: "/settings/members", label: "Members" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="border-rule mt-4 flex gap-1 border-b">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
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
