import { DisplayBoot } from "./DisplayBoot";
import { TvColorScheme } from "@/components/board/TvColorScheme";

/** The meta-tag half of TvColorScheme, for browsers that decide before CSS. */
export const viewport = { colorScheme: "dark" as const };

/*
 * The display route. Still a placeholder — it prints which token it booted with
 * and nothing else. The bundle, the renderer and the offline layers are P3.
 */

export default async function DisplayPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;

  return (
    <main>
      <TvColorScheme />
      <h1 className="sr-only">Display</h1>
      <DisplayBoot urlToken={token} />
    </main>
  );
}
