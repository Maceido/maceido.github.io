const STATION_ID = "mixman";
const RADIOCULT_API = "https://api.radiocult.fm";
const ORIGINS = new Set([
  "https://wtinyradio.com",
  "https://www.wtinyradio.com"
]);

function allowedOrigin(origin) {
  return ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
}

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  });
  if (allowedOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(request, value, status = 200, cacheControl = "no-store") {
  const headers = cors(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  return new Response(JSON.stringify(value), { status, headers });
}

async function proxy(request, url, cacheControl = "no-store") {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const headers = cors(request);
  headers.set("Content-Type", response.headers.get("Content-Type") || "application/json; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  return new Response(await response.text(), { status: response.status, headers });
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function displayName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

async function tokenHash(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function schema(env) {
  if (!env.DB) throw new Error("The chat database is not bound");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_users (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_messages_created_idx ON chat_messages(created_at)")
  ]);
}

function dbMessage(row) {
  return {
    timestampId: `${row.created_at}-${row.id}`,
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    type: "message",
    content: { text: row.text },
    station: STATION_ID,
    flagged: false,
    isStationMessage: false
  };
}

async function chatHistory(request, env) {
  await schema(env);
  const [localResult, legacyResponse] = await Promise.all([
    env.DB.prepare(`SELECT id, user_id, display_name, text, created_at
      FROM chat_messages ORDER BY created_at DESC LIMIT 100`).all(),
    fetch(`${RADIOCULT_API}/api/chat/messages/${STATION_ID}`, {
      headers: { Accept: "application/json" }
    }).catch(() => null)
  ]);

  let legacy = [];
  if (legacyResponse?.ok) {
    const data = await legacyResponse.json().catch(() => ({}));
    legacy = Array.isArray(data?.messages) ? data.messages : [];
  }

  const messages = new Map();
  legacy.forEach(message => {
    if (message?.id) messages.set(message.id, message);
  });
  (localResult.results || []).forEach(row => messages.set(row.id, dbMessage(row)));

  const combined = Array.from(messages.values())
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(-150);
  return json(request, { messages: combined });
}

async function saveIdentity(request, env) {
  await schema(env);
  const body = await request.json().catch(() => null);
  const name = displayName(body?.displayName);
  if (name.length < 2 || name.length > 28) {
    return json(request, { success: false, error: "Display name must be between 2 and 28 characters" }, 400);
  }

  let userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  let token = typeof body?.token === "string" ? body.token.trim() : "";
  const now = Math.floor(Date.now() / 1000);

  if (userId && token) {
    const user = await env.DB.prepare("SELECT token_hash FROM chat_users WHERE id = ?").bind(userId).first();
    if (!user || user.token_hash !== await tokenHash(token)) {
      return json(request, { success: false, error: "This chat identity is no longer valid" }, 401);
    }
  } else {
    userId = crypto.randomUUID();
    token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  }

  await env.DB.prepare(`INSERT INTO chat_users (id, token_hash, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
    .bind(userId, await tokenHash(token), name, now, now).run();

  return json(request, { user: { userId, displayName: name, token }, message: null }, userId ? 200 : 201);
}

async function saveMessage(request, env) {
  await schema(env);
  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!userId || !token || !text || text.length > 1000) {
    return json(request, { success: false, error: "A valid chat identity and message are required" }, 400);
  }

  const user = await env.DB.prepare("SELECT token_hash, display_name FROM chat_users WHERE id = ?")
    .bind(userId).first();
  if (!user || user.token_hash !== await tokenHash(token)) {
    return json(request, { success: false, error: "Please choose your display name again" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const recent = await env.DB.prepare(`SELECT created_at FROM chat_messages
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).bind(userId).first();
  if (recent && now - recent.created_at < 1) {
    return json(request, { success: false, error: "Please wait a moment before sending again" }, 429);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO chat_messages (id, user_id, display_name, text, created_at)
    VALUES (?, ?, ?, ?, ?)`).bind(id, userId, user.display_name, text, now).run();

  return json(request, { message: dbMessage({
    id,
    user_id: userId,
    display_name: user.display_name,
    text,
    created_at: now
  }) }, 201);
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    const origin = request.headers.get("Origin") || "";
    return allowedOrigin(origin)
      ? new Response(null, { status: 204, headers: cors(request) })
      : json(request, { success: false, error: "Origin not allowed" }, 403);
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("Origin") || "";
    if (!allowedOrigin(origin)) return json(request, { success: false, error: "Origin not allowed" }, 403);
  }

  if (path === "/live" && request.method === "GET") {
    return proxy(request, `${RADIOCULT_API}/api/station/${STATION_ID}/schedule/live`);
  }
  if (path === "/schedule" && request.method === "GET") {
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const timezone = url.searchParams.get("timezone") || "America/Phoenix";
    if (!validTimestamp(start) || !validTimestamp(end) || timezone.length > 80) {
      return json(request, { success: false, error: "A valid schedule range is required" }, 400);
    }
    const upstream = new URL(`${RADIOCULT_API}/api/station/${STATION_ID}/schedule`);
    upstream.searchParams.set("startDate", start);
    upstream.searchParams.set("endDate", end);
    upstream.searchParams.set("timezone", timezone);
    upstream.searchParams.set("expand", "artist");
    return proxy(request, upstream, "public, max-age=60, stale-while-revalidate=120");
  }
  if (path === "/chat" && request.method === "GET") return chatHistory(request, env);
  if (path === "/chat/user" && request.method === "POST") return saveIdentity(request, env);
  if (path === "/chat/message" && request.method === "POST") return saveMessage(request, env);
  return json(request, { success: false, error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error("WTinyRadio data bridge failed", error);
      return json(request, { success: false, error: "The live data service is temporarily unavailable" }, 502);
    }
  }
};
