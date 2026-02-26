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
    return sendJson(res, 500, {
      error: "Missing SUPABASE_URL or SUPABASE_SECRET_KEY",
    });
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/app_config_revisions?select=id,config_id,version,data,changed_at&order=changed_at.desc&limit=100`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`history read failed (${resp.status}): ${text}`);
    }
    const rows = await resp.json();
    return sendJson(res, 200, { items: rows || [] });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Failed to read history" });
  }
};
