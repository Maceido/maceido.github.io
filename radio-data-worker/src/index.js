const STATION_ID = "mixman";
const RADIOCULT_API = "https://api.radiocult.fm";
const PRODUCTION_ORIGINS = new Set([
  "https://wtinyradio.com",
  "https://www.wtinyradio.com"
]);

function isAllowedOrigin(origin) {
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  });
  if (isAllowedOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(request, value, status = 200, cacheControl = "no-store") {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  return new Response(JSON.stringify(value), { status, headers });
}

async function proxyJson(request, upstreamUrl, init = {}, cacheControl = "no-store") {
  const upstreamResponse = await fetch(upstreamUrl, {
    ...init,
    headers: {
      "Accept": "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
  const body = await upstreamResponse.text();
  const headers = corsHeaders(request);
  headers.set("Content-Type", upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  return new Response(body, { status: upstreamResponse.status, headers });
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    const origin = request.headers.get("Origin") || "";
    return isAllowedOrigin(origin)
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : jsonResponse(request, { success: false, error: "Origin not allowed" }, 403);
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("Origin") || "";
    if (!isAllowedOrigin(origin)) return jsonResponse(request, { success: false, error: "Origin not allowed" }, 403);
  }

  if (path === "/live" && request.method === "GET") {
    return proxyJson(request, `${RADIOCULT_API}/api/station/${STATION_ID}/schedule/live`);
  }

  if (path === "/schedule" && request.method === "GET") {
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const timezone = url.searchParams.get("timezone") || "America/Phoenix";
    if (!validTimestamp(start) || !validTimestamp(end) || timezone.length > 80) {
      return jsonResponse(request, { success: false, error: "A valid schedule range is required" }, 400);
    }
    const upstream = new URL(`${RADIOCULT_API}/api/station/${STATION_ID}/schedule`);
    upstream.searchParams.set("startDate", start);
    upstream.searchParams.set("endDate", end);
    upstream.searchParams.set("timezone", timezone);
    upstream.searchParams.set("expand", "artist");
    return proxyJson(request, upstream, {}, "public, max-age=60, stale-while-revalidate=120");
  }

  if (path === "/chat" && request.method === "GET") {
    return proxyJson(request, `${RADIOCULT_API}/api/chat/messages/${STATION_ID}`);
  }

  if (path === "/chat/user" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const displayName = body?.displayName?.trim();
    if (!displayName || displayName.length < 2 || displayName.length > 28) {
      return jsonResponse(request, { success: false, error: "Display name must be between 2 and 28 characters" }, 400);
    }
    return proxyJson(request, `${RADIOCULT_API}/api/chat/user`, {
      method: "POST",
      body: JSON.stringify({ displayName })
    });
  }

  const displayNameMatch = path.match(/^\/chat\/user\/([^/]+)\/display-name$/);
  if (displayNameMatch && request.method === "PUT") {
    const userId = decodeURIComponent(displayNameMatch[1]);
    const body = await request.json().catch(() => null);
    const newDisplayName = body?.newDisplayName?.trim();
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(userId) || !newDisplayName || newDisplayName.length < 2 || newDisplayName.length > 28) {
      return jsonResponse(request, { success: false, error: "Invalid chat user update" }, 400);
    }
    return proxyJson(request, `${RADIOCULT_API}/api/chat/user/${encodeURIComponent(userId)}/display-name`, {
      method: "PUT",
      body: JSON.stringify({ newDisplayName })
    });
  }

  return jsonResponse(request, { success: false, error: "Not found" }, 404);
}

export default {
  async fetch(request) {
    try {
      return await handleRequest(request);
    } catch (error) {
      console.error("WTinyRadio data bridge failed", error);
      return jsonResponse(request, { success: false, error: "The live data service is temporarily unavailable" }, 502);
    }
  }
};
