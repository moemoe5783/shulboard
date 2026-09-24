import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/*
 * The dev reference sheets and labs — /tokens, /primitives, /editor-lab,
 * /font-parity, /zmanim-lab, /collage-lab (and /artsy, /widget,
 * /legacy-editor), /backgrounds-lab, /upload-lab, /preview-lab, /clock-lab, /widgets-lab.
 *
 * NOT ON PRODUCTION. They're for building and for the browser tests, which
 * run against a local `next start`; on the production deployment
 * (VERCEL_ENV=production) every one of them is a 404. Preview deployments and
 * local builds keep them. One gate for the whole route group, so a lab added
 * later is covered without remembering to.
 *
 * Checked per request, not at build time, so the answer follows the
 * deployment it runs on.
 */

export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  return children;
}
