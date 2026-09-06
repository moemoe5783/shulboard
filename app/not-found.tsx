import Link from "next/link";
import { buttonClassName } from "@/components/Button";
import { Notice } from "@/components/Notice";

/*
 * A URL that points at nothing: an old bookmark, a screen someone deleted, a
 * mistyped path. Not a fault, so the heading stays in --ink.
 */

export default function NotFound() {
  return (
    <div className="bg-paper font-ui min-h-screen px-6 py-6">
      <div className="mx-auto max-w-360">
        <Notice
          title="That page isn't here"
          actions={
            <Link href="/screens" className={buttonClassName("primary")}>
              Go to screens
            </Link>
          }
        >
          The link may be old, or the screen it pointed at was deleted.
        </Notice>
      </div>
    </div>
  );
}
