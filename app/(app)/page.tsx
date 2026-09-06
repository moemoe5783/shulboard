import { redirect } from "next/navigation";

/*
 * The signed-in landing.
 *
 * There is no separate home view: what a gabbai opens this app to find out is
 * whether every screen in the building is alive and showing the right thing,
 * which is the screens view. The rail has no row for a dashboard either, so a
 * landing page here would be a section of the product nothing navigates to.
 *
 * Redirecting rather than rendering the screens view at two URLs keeps one
 * canonical address for it, so a bookmark, the rail, and a row link all agree.
 */

export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  redirect("/screens");
}
