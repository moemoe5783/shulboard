/**
 * A fake Supabase — just enough of Auth (GoTrue) and the REST API (PostgREST)
 * for a signed-in dashboard to render and for the sign-in flows to run, with
 * no Supabase project, Docker or network. Used by scripts/test-dashboard.mjs.
 *
 * AUTH follows the real wire format the installed supabase-js speaks:
 * password sign-in, sign-up, sign-in links, reset, token verification,
 * updateUser, refresh, sign-out, and authenticator apps (enrol, challenge,
 * verify, unenrol — any 6-digit code "123456" is right, anything else wrong).
 * Access tokens are real-shaped JWTs (unsigned) because supabase-js reads
 * `aal` out of them for two-step sign-in.
 *
 * REST returns rows from `fixtures` by table, applying `eq`, `neq`, `is`, `in`,
 * `lt`, `lte`, `gt` and `gte` filters and honouring `.single()`/
 * `.maybeSingle()` and `limit`. Writes change the fixtures — insert appends,
 * update merges into the matching rows, delete removes them — and are logged
 * in `state.writes`. `rpc/<fn>` returns `fixtures.rpc[fn]` (a value, or a
 * function of the arguments that may change the fixtures itself).
 *
 * NOT A REIMPLEMENTATION: no RLS, no select-shaping, no ordering. The SQL
 * tests (supabase/tests) are where the database's own rules are checked.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const b64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function fakeJwt(payload) {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.${b64url("signature")}`;
}

export function startMockSupabase({ port, users, fixtures = {}, emailConfirmation = false }) {
  const state = {
    writes: [],
    emails: [],
    /** access token -> { userId, aal } */
    sessions: new Map(),
    refresh: new Map(),
  };
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byId = new Map(users.map((u) => [u.id, u]));

  const userJson = (u) => ({
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    phone: "",
    app_metadata: { provider: u.provider ?? "email", providers: [u.provider ?? "email"] },
    user_metadata: u.metadata ?? {},
    identities: [
      { id: u.id, identity_id: u.id, user_id: u.id, provider: u.provider ?? "email", identity_data: { email: u.email }, created_at: "2026-01-01T00:00:00Z" },
    ],
    factors: (u.factors ?? []).map((f) => ({
      id: f.id,
      friendly_name: f.friendly_name ?? "Authenticator app",
      factor_type: "totp",
      status: f.status,
      created_at: f.created_at ?? "2026-02-01T00:00:00Z",
      updated_at: f.created_at ?? "2026-02-01T00:00:00Z",
    })),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });

  function session(u, aal) {
    const now = Math.floor(Date.now() / 1000);
    const access = fakeJwt({
      sub: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      aal,
      amr: aal === "aal2" ? [{ method: "totp", timestamp: now }, { method: "password", timestamp: now }] : [{ method: "password", timestamp: now }],
      session_id: randomUUID(),
      iat: now,
      exp: now + 3600,
    });
    const refresh = randomUUID();
    state.sessions.set(access, { userId: u.id, aal });
    state.refresh.set(refresh, { userId: u.id, aal });
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
  }

  const bearer = (req) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    return state.sessions.get(token) ? { token, ...state.sessions.get(token) } : null;
  };

  function applyFilters(rows, params) {
    let out = rows;
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
      const dot = raw.indexOf(".");
      const op = raw.slice(0, dot);
      const value = raw.slice(dot + 1);
      const get = (row) => row[key];
      if (op === "eq") out = out.filter((row) => String(get(row)) === value);
      else if (op === "neq") out = out.filter((row) => String(get(row)) !== value);
      else if (op === "is") out = out.filter((row) => (value === "null" ? get(row) == null : String(get(row)) === value));
      else if (op === "not.is") out = out.filter((row) => (value === "null" ? get(row) != null : String(get(row)) !== value));
      else if (["lt", "lte", "gt", "gte"].includes(op)) {
        const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        out = out.filter((row) => {
          const c = cmp(String(get(row) ?? ""), value);
          return op === "lt" ? c < 0 : op === "lte" ? c <= 0 : op === "gt" ? c > 0 : c >= 0;
        });
      } else if (op === "in") {
        const set = new Set(value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")));
        out = out.filter((row) => set.has(String(get(row))));
      }
    }
    return out;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {}

    const send = (status, payload, headers = {}) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-expose-headers": "content-range, x-supabase-api-version",
        ...headers,
      });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    if (req.method === "OPTIONS") return send(204);

    const path = url.pathname;

    // ---------------------------------------------------------------- auth
    if (path.startsWith("/auth/v1/")) {
      const route = path.slice("/auth/v1/".length);
      const authError = (status, code, message) => send(status, { code: status, error_code: code, msg: message, message });

      if (route === "token" && url.searchParams.get("grant_type") === "password") {
        const u = byEmail.get(String(body.email ?? "").toLowerCase());
        if (!u || u.password !== body.password) return authError(400, "invalid_credentials", "Invalid login credentials");
        return send(200, session(u, "aal1"));
      }
      if (route === "token" && url.searchParams.get("grant_type") === "refresh_token") {
        const known = state.refresh.get(body.refresh_token);
        if (!known) return authError(400, "refresh_token_not_found", "Invalid Refresh Token");
        return send(200, session(byId.get(known.userId), known.aal));
      }
      if (route === "user" && req.method === "GET") {
        const who = bearer(req);
        if (!who) return authError(401, "bad_jwt", "invalid JWT");
        return send(200, userJson(byId.get(who.userId)));
      }
      if (route === "user" && req.method === "PUT") {
        const who = bearer(req);
        if (!who) return authError(401, "bad_jwt", "invalid JWT");
        const u = byId.get(who.userId);
        if (body.password) u.password = body.password;
        if (body.data) u.metadata = { ...(u.metadata ?? {}), ...body.data };
        state.writes.push({ auth: "updateUser", body });
        return send(200, userJson(u));
      }
      if (route === "signup") {
        const email = String(body.email ?? "").toLowerCase();
        if (byEmail.has(email)) return send(200, { ...userJson(byEmail.get(email)), identities: [] });
        const u = { id: randomUUID(), email, password: body.password, metadata: body.data ?? {} };
        users.push(u);
        byEmail.set(email, u);
        byId.set(u.id, u);
        state.emails.push({ kind: "confirmation", to: email, redirectTo: url.searchParams.get("redirect_to") });
        return send(200, emailConfirmation ? userJson(u) : session(u, "aal1"));
      }
      if (route === "otp") {
        state.emails.push({ kind: "magic_link", to: body.email, redirectTo: url.searchParams.get("redirect_to") });
        return send(200, {});
      }
      if (route === "recover") {
        state.emails.push({ kind: "recovery", to: body.email, redirectTo: url.searchParams.get("redirect_to") });
        return send(200, {});
      }
      if (route === "verify") {
        // Token hashes in tests are "hash-<email>".
        const email = String(body.token_hash ?? "").replace(/^hash-/, "");
        const u = byEmail.get(email);
        if (!u) return authError(403, "otp_expired", "Email link is invalid or has expired");
        return send(200, session(u, "aal1"));
      }
      if (route.startsWith("logout")) {
        const who = bearer(req);
        if (who) state.sessions.delete(who.token);
        return send(204);
      }
      if (route === "factors" && req.method === "POST") {
        const who = bearer(req);
        const u = byId.get(who?.userId);
        if (!u) return authError(401, "bad_jwt", "invalid JWT");
        const factor = { id: randomUUID(), status: "unverified", friendly_name: body.friendly_name };
        u.factors = [...(u.factors ?? []), factor];
        const qr = `data:image/svg+xml;utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/><rect x="1" y="1" width="3" height="3"/><rect x="6" y="1" width="3" height="3"/><rect x="1" y="6" width="3" height="3"/></svg>')}`;
        return send(200, { id: factor.id, type: "totp", friendly_name: body.friendly_name, totp: { qr_code: qr, secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Shulboard" } });
      }
      const factorMatch = /^factors\/([^/]+)(\/challenge|\/verify)?$/.exec(route);
      if (factorMatch) {
        const who = bearer(req);
        const u = byId.get(who?.userId);
        if (!u) return authError(401, "bad_jwt", "invalid JWT");
        const factor = (u.factors ?? []).find((f) => f.id === factorMatch[1]);
        if (!factor) return authError(404, "mfa_factor_not_found", "Factor not found");
        if (factorMatch[2] === "/challenge") return send(200, { id: randomUUID(), type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
        if (factorMatch[2] === "/verify") {
          if (body.code !== "123456") return authError(422, "mfa_verification_failed", "Invalid TOTP code entered");
          factor.status = "verified";
          return send(200, session(u, "aal2"));
        }
        if (req.method === "DELETE") {
          u.factors = u.factors.filter((f) => f.id !== factor.id);
          return send(200, { id: factor.id });
        }
      }
      return authError(404, "not_found", `mock has no ${req.method} ${route}`);
    }

    // ---------------------------------------------------------------- rest
    if (path.startsWith("/rest/v1/")) {
      const who = bearer(req);
      const name = path.slice("/rest/v1/".length);
      if (name.startsWith("rpc/")) {
        const fn = name.slice(4);
        const value = fixtures.rpc?.[fn];
        state.writes.push({ rpc: fn, body, user: who?.userId ?? null });
        const result = typeof value === "function" ? value(body, who, state) : value;
        if (result && result.__error) return send(400, { message: result.__error, code: "P0001" });
        return send(200, result ?? null);
      }
      fixtures[name] ??= [];
      const rows = fixtures[name];
      const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
      const limit = Number(url.searchParams.get("limit") ?? "") || undefined;
      if (req.method === "GET" || req.method === "HEAD") {
        let out = applyFilters(rows, url.searchParams);
        const total = out.length;
        if (limit) out = out.slice(0, limit);
        const headers = { "content-range": `0-${Math.max(0, out.length - 1)}/${total}` };
        if (single) return out.length ? send(200, out[0], headers) : send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        return send(200, out, headers);
      }
      state.writes.push({ table: name, method: req.method, query: url.search, body, user: who?.userId ?? null });
      let changed = [];
      if (req.method === "POST") {
        changed = (Array.isArray(body) ? body : [body]).map((row) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...row }));
        rows.push(...changed);
      } else if (req.method === "PATCH") {
        changed = applyFilters(rows, url.searchParams);
        for (const row of changed) Object.assign(row, body);
      } else if (req.method === "DELETE") {
        changed = applyFilters(rows, url.searchParams);
        fixtures[name] = rows.filter((row) => !changed.includes(row));
      }
      if (single) return send(200, changed[0] ?? null);
      return send(req.method === "POST" ? 201 : 200, changed);
    }

    send(404, { message: `mock has no ${path}` });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({ url: `http://localhost:${port}`, state, close: () => new Promise((r) => server.close(r)) }),
    );
  });
}
