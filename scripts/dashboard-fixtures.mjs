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

export function fixtures() {
  const now = Date.now();
  const ago = (ms) => new Date(now - ms).toISOString();
  return {
    orgs: [org],
    org_members: [
      { org_id: ORG_ID, user_id: GABBAI.id, role: "owner", orgs: org },
      { org_id: ORG_ID, user_id: EDITOR.id, role: "editor", orgs: org },
    ],
    org_invites: [
      { id: "inv-1", org_id: ORG_ID, email: "treasurer@example.org", role: "viewer", token: "a-pending-invite-token-000000000000", expires_at: new Date(now + 10 * 864e5).toISOString(), created_at: ago(864e5), accepted_at: null, revoked_at: null },
    ],
    screens: [
      { id: "5c000000-0000-4000-8000-000000000001", org_id: ORG_ID, name: "Main lobby", location_note: "Entrance, north wall", token: "abcdefghijkmnpqrstuvwxyz23456789", canvas_width: 1920, canvas_height: 1080, last_seen_at: ago(20_000), playlist_id: null },
      { id: "5c000000-0000-4000-8000-000000000002", org_id: ORG_ID, name: "Simcha hall", location_note: "East wall", token: "bcdefghijkmnpqrstuvwxyz234567892", canvas_width: 3840, canvas_height: 2160, last_seen_at: ago(3 * 864e5), playlist_id: null },
    ],
    boards: [
      { id: "b0000000-0000-4000-8000-000000000001", org_id: ORG_ID, name: "Weekday board", canvas_width: 1920, canvas_height: 1080, updated_at: ago(3600e3), doc: { schemaVersion: 1, widgets: [] }, published_hash: null, published_at: null, deleted_at: null },
      { id: "b0000000-0000-4000-8000-000000000002", org_id: ORG_ID, name: "Shabbos board", canvas_width: 1920, canvas_height: 1080, updated_at: ago(2 * 864e5), doc: { schemaVersion: 1, widgets: [] }, published_hash: null, published_at: null, deleted_at: null },
    ],
    albums: [{ id: "a1000000-0000-4000-8000-000000000001", org_id: ORG_ID, name: "Kiddush photos", created_at: ago(5 * 864e5), deleted_at: null, source: "manual" }],
    album_items: [],
    assets: [],
    playlists: [],
    playlist_items: [],
    screen_bundles: [],
    rpc: {
      org_member_directory: [
        { user_id: GABBAI.id, email: GABBAI.email, full_name: "Moshe Levi", role: "owner", joined_at: "2026-01-02T00:00:00Z", two_step: false },
        { user_id: EDITOR.id, email: EDITOR.email, full_name: "Sara Cohen", role: "editor", joined_at: "2026-03-10T00:00:00Z", two_step: true },
      ],
      invite_preview: (args) =>
        args.p_token === INVITE_TOKEN
          ? [{ org_id: ORG_ID, org_name: "Beis Menachem", email: "newcomer@example.org", role: "editor", invited_by_name: "Moshe Levi", status: "pending", expires_at: new Date(now + 10 * 864e5).toISOString() }]
          : [],
      accept_org_invite: () => ORG_ID,
    },
  };
}
