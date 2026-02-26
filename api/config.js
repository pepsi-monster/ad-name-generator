const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function makeEtag(row) {
  const stamp = row?.updated_at ? Date.parse(row.updated_at) : 0;
  return `W/"cfg-${row?.id || 0}-${row?.version || 0}-${Number.isFinite(stamp) ? stamp : 0}"`;
}

function setCacheHeaders(res) {
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
}

function getSupabaseHeaders(preferResolution = false) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
  if (preferResolution) headers.Prefer = "return=representation";
  return headers;
}

async function fetchConfigRow() {
  const url = `${SUPABASE_URL}/rest/v1/app_config?select=id,data,version,updated_at&order=id.asc&limit=1`;
  const resp = await fetch(url, { headers: getSupabaseHeaders(false) });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`config read failed (${resp.status}): ${text}`);
  }
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("app_config is empty; seed one row first");
  }
  return rows[0];
}

async function updateConfigRow(id, payload) {
  const url = `${SUPABASE_URL}/rest/v1/app_config?id=eq.${id}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: getSupabaseHeaders(true),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`config update failed (${resp.status}): ${text}`);
  }
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("config update returned no rows");
  }
  return rows[0];
}

async function insertRevision(payload) {
  const url = `${SUPABASE_URL}/rest/v1/app_config_revisions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: getSupabaseHeaders(false),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`revision insert failed (${resp.status}): ${text}`);
  }
}

module.exports = async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return sendJson(res, 500, {
      error: "Missing SUPABASE_URL or SUPABASE_SECRET_KEY",
    });
  }

  if (req.method === "GET") {
    try {
      const row = await fetchConfigRow();
      const etag = makeEtag(row);
      setCacheHeaders(res);
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] && req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }
      return sendJson(res, 200, {
        id: row.id,
        version: row.version,
        data: row.data ?? {},
        updatedAt: row.updated_at,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || "Failed to read config" });
    }
  }

  if (req.method === "PUT") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const nextData = body && typeof body === "object" && body.data !== undefined ? body.data : body;
      if (!nextData || typeof nextData !== "object" || Array.isArray(nextData)) {
        return sendJson(res, 400, { error: "Request body must be an object or { data: object }" });
      }

      const base = await fetchConfigRow();
      const nextVersion = Number(base.version || 0) + 1;
      const now = new Date().toISOString();
      const updated = await updateConfigRow(base.id, {
        data: nextData,
        version: nextVersion,
        updated_at: now,
      });

      await insertRevision({
        config_id: base.id,
        version: nextVersion,
        data: nextData,
        changed_at: now,
      });

      const etag = makeEtag(updated);
      setCacheHeaders(res);
      res.setHeader("ETag", etag);
      return sendJson(res, 200, {
        ok: true,
        version: updated.version,
        updatedAt: updated.updated_at,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || "Failed to save config" });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return sendJson(res, 405, { error: `Method ${req.method} not allowed` });
};
