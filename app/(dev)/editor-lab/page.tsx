import { EditorLab } from "./EditorLab";

/*
 * The transform-layer lab — plan.md §4b as a standalone page.
 *
 * A dev page, like /tokens and /primitives. Nothing here touches the database,
 * a session, or a widget: it exists to answer whether the manipulation feels
 * right, which §9 calls the highest-risk question in the build.
 */

export const metadata = { title: "Editor lab" };

export default function EditorLabPage() {
  return <EditorLab />;
}
