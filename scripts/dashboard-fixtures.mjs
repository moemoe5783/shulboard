/**
 * The shul the dashboard tests sign into: one org, three people, two screens,
 * two boards, an album. Served by scripts/mock-supabase.mjs.
 */

export const ORG_ID = "0a000000-0000-4000-8000-000000000001";
export const GABBAI = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "gabbai@example.org",
  password: "kiddush5786",
  metadata: { full_name: "Moshe Levi" },
  factors: [],
};
export const EDITOR = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "editor@example.org",
  password: "notices123",
  metadata: { full_name: "Sara Cohen" },
};
export const INVITE_TOKEN = "Zy3c1b1sQ0tTUmZ1dm9lX3Rlc3QtaW52aXRl";

const org = { id: ORG_ID, name: "Beis Menachem", slug: "beis-menachem", timezone: "America/New_York", location_label: "Brooklyn, NY", postal_code: "11213", latitude: 40.66, longitude: -73.94 };

/** Photos for the /m proxy checks: one ready, one deleted, one mid-upload. */
export const PHOTO = {
  ready: "a5000000-0000-4000-8000-000000000001",
  deleted: "a5000000-0000-4000-8000-000000000002",
  pending: "a5000000-0000-4000-8000-000000000003",
  /** Ready on record, but Storage has no file for it. */
  fileMissing: "a5000000-0000-4000-8000-000000000004",
  /** Deleted 40 days ago: past the 30 days Recently deleted keeps it. */
  expired: "a5000000-0000-4000-8000-000000000005",
};
const photoVariant = (id, name, hash) => ({
  storage_path: `${ORG_ID}/${id}/${name}-${hash}.webp`,
  content_hash: hash,
  extension: "webp",
  content_type: "image/webp",
  bytes: 12,
  width: 400,
  height: 300,
});
const photo = (id, extra) => ({
  created_at: new Date(Date.now() - 864e5).toISOString(),
  id,
  org_id: ORG_ID,
  kind: "image",
  storage_bucket: "assets",
  storage_path: `${ORG_ID}/${id}/display-1111111111111111.webp`,
  mime_type: "image/webp",
  width: 400,
  height: 300,
  status: "ready",
  deleted_at: null,
  variants: { display: photoVariant(id, "display", "1111111111111111") },
  ...extra,
});

export function fixtures() {
  const now = Date.now();
  const ago = (ms) => new Date(now - ms).toISOString();
  const f = {
    platform_admins: [GABBAI.id],
    orgs: [{ ...org }],
    org_members: [
      { org_id: ORG_ID, user_id: GABBAI.id, role: "owner", orgs: org },
      { org_id: ORG_ID, user_id: EDITOR.id, role: "editor", orgs: org },
    ],
    org_invites: [
      { id: "inv-1", org_id: ORG_ID, email: "treasurer@example.org", role: "viewer", token: "a-pending-invite-token-000000000000", expires_at: new Date(now + 10 * 864e5).toISOString(), created_at: ago(864e5), accepted_at: null, revoked_at: null },
    ],
    screens: [
      { id: "5c000000-0000-4000-8000-000000000001", org_id: ORG_ID, name: "Main lobby", location_note: "Entrance, north wall", token: "abcdefghijkmnpqrstuvwxyz23456789", canvas_width: 1920, canvas_height: 1080, last_seen_at: ago(20_000), playlist_id: null, is_active: true, device_secret_hash: null, device_label: null, device_paired_at: null },
      { id: "5c000000-0000-4000-8000-000000000002", org_id: ORG_ID, name: "Simcha hall", location_note: "East wall", token: "bcdefghijkmnpqrstuvwxyz234567892", canvas_width: 3840, canvas_height: 2160, last_seen_at: ago(3 * 864e5), playlist_id: null, is_active: true, device_secret_hash: null, device_label: null, device_paired_at: null },
    ],
    boards: [
      { id: "b0000000-0000-4000-8000-000000000001", org_id: ORG_ID, name: "Weekday board", canvas_width: 1920, canvas_height: 1080, updated_at: ago(3600e3), doc: { schemaVersion: 1, widgets: [] }, published_hash: null, published_at: null, deleted_at: null },
      { id: "b0000000-0000-4000-8000-000000000002", org_id: ORG_ID, name: "Shabbos board", canvas_width: 1920, canvas_height: 1080, updated_at: ago(2 * 864e5), doc: { schemaVersion: 1, widgets: [] }, published_hash: null, published_at: null, deleted_at: null },
    ],
    albums: [{ id: "a1000000-0000-4000-8000-000000000001", org_id: ORG_ID, name: "Kiddush photos", created_at: ago(5 * 864e5), deleted_at: null, source: "manual" }],
    album_items: [],
    assets: [
      photo(PHOTO.ready),
      photo(PHOTO.deleted, { deleted_at: new Date(Date.now() - 864e5).toISOString(), original_filename: "purim-seudah.jpg" }),
      photo(PHOTO.pending, { status: "pending" }),
      photo(PHOTO.fileMissing),
      photo(PHOTO.expired, { deleted_at: new Date(Date.now() - 40 * 864e5).toISOString(), original_filename: "old-kiddush.jpg" }),
    ],
    storage: Object.fromEntries(
      [PHOTO.ready, PHOTO.deleted, PHOTO.pending, PHOTO.expired].map((id) => [`assets/${ORG_ID}/${id}/display-1111111111111111.webp`, "fake-webp-bytes"]),
    ),
    playlists: [],
    playlist_items: [],
    screen_bundles: [],
    pairing_requests: [],
    rpc: {
      // The cleanup job's two lookups (20260927090300_media_cleanup.sql).
      media_purge_candidates: [
        { asset_id: PHOTO.expired, org_id: ORG_ID, deleted_at: ago(40 * 864e5), referenced: false, boards: [], in_bundle: false },
        {
          asset_id: PHOTO.deleted,
          org_id: ORG_ID,
          deleted_at: ago(40 * 864e5),
          referenced: true,
          boards: [{ id: "b0000000-0000-4000-8000-000000000001", name: "Weekday board" }],
          in_bundle: false,
        },
      ],
      media_orphan_objects: [{ name: `${ORG_ID}/a5000000-0000-4000-8000-0000000000ff/display-1.webp`, created_at: ago(3 * 864e5) }],
      org_member_directory: [
        { user_id: GABBAI.id, email: GABBAI.email, full_name: "Moshe Levi", role: "owner", joined_at: "2026-01-02T00:00:00Z", two_step: false },
        { user_id: EDITOR.id, email: EDITOR.email, full_name: "Sara Cohen", role: "editor", joined_at: "2026-03-10T00:00:00Z", two_step: true },
      ],
      invite_preview: (args) =>
        args.p_token === INVITE_TOKEN
          ? [{ org_id: ORG_ID, org_name: "Beis Menachem", email: "newcomer@example.org", role: "editor", invited_by_name: "Moshe Levi", status: "pending", expires_at: new Date(now + 10 * 864e5).toISOString() }]
          : [],
      accept_org_invite: () => ORG_ID,
      // The platform admin (supabase/tests/platform_admin.test.sql holds the
      // database's own checks): the gabbai runs the platform in these tests.
      is_platform_admin: (_args, who) => f.platform_admins.includes(who?.userId),
      platform_orgs: (_args, who) =>
        f.platform_admins.includes(who?.userId)
          ? f.orgs.map((o) => ({
              org_id: o.id, name: o.name, slug: o.slug, created_at: ago(40 * 864e5), deleted_at: null,
              plan: o.plan ?? "trial", trial_ends_at: o.plan && o.plan !== "trial" ? null : (o.trial_ends_at ?? new Date(now + 12 * 864e5).toISOString()),
              stripe_customer_id: null, stripe_subscription_id: null, owner_email: GABBAI.email,
              member_count: 2, screen_count: f.screens.length, screens_live: 1, board_count: f.boards.length, photo_count: 3, storage_bytes: 6_400_000, file_count: 12, recorded_bytes: 4_200_000,
            }))
          : [],
      platform_usage: (_args, who) =>
        f.platform_admins.includes(who?.userId)
          ? [{ storage_bytes: 7_100_000, file_count: 14, unattributed_bytes: 700_000, database_bytes: 12_300_000 }]
          : [],
      platform_set_org_plan: ({ p_org, p_plan, p_trial_ends_at }) => {
        const o = f.orgs.find((one) => one.id === p_org);
        if (!o) return { __error: "no such shul" };
        Object.assign(o, { plan: p_plan, trial_ends_at: p_plan === "trial" ? p_trial_ends_at : null });
        return null;
      },
      platform_users: (_args, who) =>
        f.platform_admins.includes(who?.userId)
          ? [GABBAI, EDITOR].map((u) => ({
              user_id: u.id, email: u.email, full_name: u.metadata.full_name, created_at: ago(40 * 864e5),
              last_sign_in_at: ago(3600e3), is_platform_admin: f.platform_admins.includes(u.id), two_step: false, shuls: "Beis Menachem",
            }))
          : [],
      platform_set_admin: ({ p_user, p_admin }, who) => {
        if (!p_admin && p_user === who?.userId) return { __error: "you can't remove yourself as a platform admin" };
        f.platform_admins = p_admin ? [...new Set([...f.platform_admins, p_user])] : f.platform_admins.filter((id) => id !== p_user);
        return null;
      },
      // The database's own checks are in supabase/tests/pairing.test.sql;
      // this is just enough of claim_pairing to drive the flow.
      claim_pairing: ({ p_code, p_screen_id }) => {
        const code = String(p_code).replace(/\s/g, "");
        const request = f.pairing_requests.find((r) => r.code === code && !r.claimed_at && r.expires_at > new Date().toISOString());
        const screen = f.screens.find((s) => s.id === p_screen_id);
        if (!screen) return { __error: "only an owner or admin can connect a TV to this screen" };
        if (screen.device_secret_hash) return { __error: "this screen already has a TV connected" };
        if (!request) return { __error: "that code is wrong or has expired" };
        Object.assign(screen, { device_secret_hash: request.device_secret_hash, device_label: request.device_label, device_paired_at: new Date().toISOString() });
        Object.assign(request, { claimed_at: new Date().toISOString(), claimed_screen_id: screen.id });
        return screen.name;
      },
    },
  };
  return f;
}
