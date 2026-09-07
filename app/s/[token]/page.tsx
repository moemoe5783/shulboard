import { DisplayBoot } from "./DisplayBoot";

/*
 * The display route. Still a placeholder — it prints which token it booted with
 * and nothing else. The bundle, the renderer and the offline layers are P3.
 */

export default async function DisplayPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;

  return (
    <main>
      <h1 className="sr-only">Display</h1>
      <DisplayBoot urlToken={token} />
    </main>
  );
}
