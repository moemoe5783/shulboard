"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { resolutionById } from "@/lib/screens";

/**
 * Screen tokens.
 *
 * 32 characters from a 32-symbol alphabet is 160 bits — not guessable, and the
 * URL is the only thing standing between a stranger and a shul's board.
 *
 * The alphabet drops the glyphs that get misread off a TV screen: no l or o, no
 * 0 or 1. 256 divides by 32 exactly, so taking each byte modulo 32 stays
 * uniform — no modulo bias, and no rejection loop needed.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 32;

function generateToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = "";
  for (const byte of bytes) {
    token += ALPHABET[byte % ALPHABET.length];
  }
  return token;
}

export type ScreenFormState = { error?: string };

export async function createScreen(
  _previous: ScreenFormState,
  formData: FormData,
): Promise<ScreenFormState> {
  const org = await requireActiveOrg();

  const name = String(formData.get("name") ?? "").trim();
  const locationNote = String(formData.get("location") ?? "").trim();
  const resolution = resolutionById(String(formData.get("resolution") ?? ""));

  if (!name) return { error: "Give the screen a name — the room it's in works well." };
  if (!resolution) return { error: "Pick a resolution." };

  const supabase = await createClient();
  let createdId: string | null = null;

  // A token collision is astronomically unlikely, but the unique index is the
  // thing that decides, not the odds. Retry rather than surfacing a constraint
  // error to a gabbai.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateToken();

    const { error } = await supabase.from("screens").insert({
      org_id: org.orgId,
      name,
      location_note: locationNote || null,
      token,
      canvas_width: resolution.width,
      canvas_height: resolution.height,
      orientation: resolution.height > resolution.width ? "portrait" : "landscape",
    });

    if (!error) {
      // Read back rather than using .insert().select(): PostgREST turns that
      // into INSERT ... RETURNING, and Postgres applies the SELECT policy to a
      // RETURNING clause. See the comment on orgs_add_creator_as_owner.
      const { data, error: readError } = await supabase
        .from("screens")
        .select("id")
        .eq("token", token)
        .single();

      if (readError || !data) {
        return {
          error: `The screen was created but couldn't be opened: ${readError?.message ?? "not found"}. It should be in the list.`,
        };
      }

      createdId = data.id;
      break;
    }

    if (error.code !== "23505") {
      return { error: `That didn't save: ${error.message}. Check the name and try again.` };
    }
  }

  if (!createdId) {
    return { error: "Couldn't allocate a display link. Try again." };
  }

  revalidatePath("/screens");
  redirect(`/screens/${createdId}`);
}

/**
 * Rotating a token blacks out the TV until somebody re-enters the new link, so
 * this is deliberate, confirmed, and never automatic.
 */
export async function rotateToken(formData: FormData): Promise<void> {
  await requireActiveOrg();
  const screenId = String(formData.get("screenId") ?? "");

  const supabase = await createClient();
  const { error } = await supabase
    .from("screens")
    .update({ token: generateToken(), token_rotated_at: new Date().toISOString() })
    .eq("id", screenId);

  // RLS decides whether this row is the caller's: an id from another org
  // matches nothing and updates nothing.
  if (error) throw new Error(`Couldn't rotate the link: ${error.message}`);

  revalidatePath(`/screens/${screenId}`);
  redirect(`/screens/${screenId}?rotated=1`);
}

export async function deleteScreen(formData: FormData): Promise<void> {
  await requireActiveOrg();
  const screenId = String(formData.get("screenId") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.from("screens").delete().eq("id", screenId);

  if (error) throw new Error(`Couldn't delete the screen: ${error.message}`);

  revalidatePath("/screens");
  redirect("/screens");
}

/**
 * Wiring a board to a screen — plan.md §1.
 *
 * A screen points at a playlist, never at a board, even for the simplest case:
 * retrofitting rotation later is the whole reason that decision was made up
 * front, so "assign a board" has to go through the playlist layer rather than
 * fake it with a direct screens.board_id this table does not have.
 *
 * The playlist is created the first time a screen needs one, named after the
 * screen's own id rather than something a person would recognise — nothing in
 * the product shows an auto-created playlist's name yet, and naming it after
 * the screen instead would risk colliding with playlists_org_name_key the
 * moment two screens shared a name. Multi-board rotation is a later feature;
 * until it exists, "assign a board" means "this playlist has exactly one
 * item," so the item is replaced rather than added to.
 */
export async function assignBoard(formData: FormData): Promise<void> {
  const org = await requireActiveOrg();
  const screenId = String(formData.get("screenId") ?? "");
  const boardId = String(formData.get("boardId") ?? "");
  if (!boardId) return;

  const supabase = await createClient();

  const { data: screen, error: screenError } = await supabase
    .from("screens")
    .select("id, playlist_id")
    .eq("id", screenId)
    .maybeSingle();

  if (screenError || !screen) {
    throw new Error(`Couldn't find that screen: ${screenError?.message ?? "not found"}.`);
  }

  let playlistId = screen.playlist_id;

  if (!playlistId) {
    const { data: playlist, error: playlistError } = await supabase
      .from("playlists")
      .insert({ org_id: org.orgId, name: `Screen ${screen.id}` })
      .select("id")
      .single();

    if (playlistError || !playlist) {
      throw new Error(`Couldn't set up the screen's playlist: ${playlistError?.message ?? "unknown problem"}.`);
    }
    playlistId = playlist.id;
  }

  // Out with whatever this playlist was showing before. §1's rotation is a
  // later feature; today a playlist holds exactly one item.
  const { error: clearError } = await supabase
    .from("playlist_items")
    .delete()
    .eq("playlist_id", playlistId);
  if (clearError) throw new Error(`Couldn't update the playlist: ${clearError.message}`);

  const { error: itemError } = await supabase.from("playlist_items").insert({
    org_id: org.orgId,
    playlist_id: playlistId,
    board_id: boardId,
    position: 1,
  });
  if (itemError) throw new Error(`Couldn't put the board on the playlist: ${itemError.message}`);

  if (screen.playlist_id !== playlistId) {
    // Screens are admin-only to update (plan.md §8: an editor rotating this
    // silently blacks out a lobby) — an editor gets exactly this far and then
    // a clear RLS error naming what happened, rather than a board that looks
    // assigned but never reaches the screen.
    const { error: linkError } = await supabase
      .from("screens")
      .update({ playlist_id: playlistId })
      .eq("id", screenId);
    if (linkError) throw new Error(`Couldn't point the screen at its playlist: ${linkError.message}`);
  }

  revalidatePath(`/screens/${screenId}`);
}
