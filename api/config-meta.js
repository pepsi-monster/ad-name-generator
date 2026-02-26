const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: `Method ${req.method} not allowed` });
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return sendJson(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SECRET_KEY" });
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/app_config?select=id,version,updated_at&order=id.asc&limit=1`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`config meta read failed (${resp.status}): ${text}`);
    }
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("app_config is empty; seed one row first");
    }
    const row = rows[0];
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    return sendJson(res, 200, {
      id: row.id,
      version: row.version,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Failed to read config meta" });
  }
};
