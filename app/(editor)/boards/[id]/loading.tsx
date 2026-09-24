import { Spinner } from "@/components/Button";

/*
 * Opening a board: the editor's dark chrome straight away, saying so, rather
 * than the board list sitting there until the whole editor has loaded.
 */
export default function Loading() {
  return (
    <div role="status" className="bg-ink text-paper/60 text-body flex h-screen items-center justify-center gap-2" data-page-loading>
      <Spinner />
      Opening board
    </div>
  );
}
