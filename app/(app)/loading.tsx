import { Spinner } from "@/components/Button";

/*
 * Shown the moment a link in the dashboard is followed, while the next page's
 * data loads. Without it the old page sat there until the new one was ready,
 * and a click on a slow connection looked like a click that hadn't landed.
 *
 * Inside the shell (app/(app)/layout.tsx), so the rail stays put and only the
 * content pane says it's loading.
 */
export default function Loading() {
  return (
    <div role="status" className="text-body text-ink-soft flex items-center gap-2 py-2" data-page-loading>
      <Spinner />
      Loading
    </div>
  );
}
