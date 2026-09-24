import { PairScreen } from "./PairScreen";

/*
 * The page a TV opens to be connected: shulboard's address plus /pair, typed
 * once with the remote. It shows a code and a QR code; someone signed in enters
 * the code against a screen (or scans the QR with their phone), and this TV
 * becomes that screen's TV for good. Public — a TV has no account.
 */

export const metadata = { title: "Connect this TV — Shulboard" };

export default async function PairPage({ searchParams }: PageProps<"/pair">) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  return (
    <main>
      <h1 className="sr-only">Connect this TV</h1>
      <PairScreen reason={reason} />
    </main>
  );
}
