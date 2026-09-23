"use server";

import { revalidatePath } from "next/cache";
import { hasRoleAtLeast, requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";

/*
 * Album and asset mutations for the Media section.
 *
 * The UPLOAD itself is client-side (lib/media/upload.ts — it needs the browser's
 * canvas to resize and re-encode); these are the surrounding operations that are
 * plain table writes. Every one goes through the authenticated server client, so
 * RLS (is_org_member / editor role) is the boundary; the role check here is a
 * friendlier early "no", not the thing keeping shuls apart.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

async function editorOrg() {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "editor")) {
    return { org: null, error: "You need editor access to change media." as const };
  }
  return { org, error: null };
}

export async function createAlbum(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the album a name." };

  const { org, error: roleError } = await editorOrg();
  if (!org) return { ok: false, error: roleError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("albums")
    .insert({ org_id: org.orgId, name: trimmed })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: `Couldn't create the album: ${error?.message ?? "unknown"}` };
  revalidatePath("/media");
  return { ok: true, id: data.id };
}

export async function renameAlbum(albumId: string, name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the album a name." };

  const { org, error: roleError } = await editorOrg();
  if (!org) return { ok: false, error: roleError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("albums")
    .update({ name: trimmed })
    .eq("id", albumId)
    .eq("org_id", org.orgId);

  if (error) return { ok: false, error: `Couldn't rename the album: ${error.message}` };
  revalidatePath("/media");
  revalidatePath(`/media/${albumId}`);
  return { ok: true };
}

export async function deleteAlbum(albumId: string): Promise<ActionResult> {
  const { org, error: roleError } = await editorOrg();
  if (!org) return { ok: false, error: roleError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("albums")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", albumId)
    .eq("org_id", org.orgId);

  if (error) return { ok: false, error: `Couldn't delete the album: ${error.message}` };
  revalidatePath("/media");
  return { ok: true };
}

/**
 * Soft-delete an asset. The /m proxy 404s a soft-deleted asset and the bundle
 * excludes it (schema.md §6), so this pulls the photo off every board at once
 * without hunting down references — a board pointing at it shows the widget's
 * own empty state, not a broken image.
 */
export async function deleteAsset(assetId: string, albumId: string): Promise<ActionResult> {
  const { org, error: roleError } = await editorOrg();
  if (!org) return { ok: false, error: roleError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("org_id", org.orgId);

  if (error) return { ok: false, error: `Couldn't delete the photo: ${error.message}` };
  revalidatePath(`/media/${albumId}`);
  revalidatePath("/media");
  return { ok: true };
}

/** Remove a photo from THIS album without deleting the asset (it may be in
 *  other albums). */
export async function removeFromAlbum(albumId: string, assetId: string): Promise<ActionResult> {
  const { org, error: roleError } = await editorOrg();
  if (!org) return { ok: false, error: roleError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("album_items")
    .delete()
    .eq("album_id", albumId)
    .eq("asset_id", assetId)
    .eq("org_id", org.orgId);

  if (error) return { ok: false, error: `Couldn't remove the photo: ${error.message}` };
  revalidatePath(`/media/${albumId}`);
  return { ok: true };
}

export async function setCaption(albumId: string, assetId: string, caption: string): Promise<ActionResult> {
  const { org, error: roleError } = await editorOrg();
  if (!org) return { ok: false, error: roleError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("album_items")
    .update({ caption: caption.trim() || null })
    .eq("album_id", albumId)
    .eq("asset_id", assetId)
    .eq("org_id", org.orgId);

  if (error) return { ok: false, error: `Couldn't save the caption: ${error.message}` };
  revalidatePath(`/media/${albumId}`);
  return { ok: true };
}
