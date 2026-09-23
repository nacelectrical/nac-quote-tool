// ─────────────────────────────────────────────────────────────────────────────
// POST /api/presentation-media
//
// Uploads, and deletes, the photographs behind a customer proposal.
//
// Deliberately thin. Everything that could be wrong — validation, the metadata
// scan, the write order, the rollback — lives in designer/engines/media-upload
// so it can be tested without a network. This file is the transport and the
// credential, and nothing else.
//
// ESM, like api/upload.js: `export const config` makes Node treat the file as a
// module, so `module.exports` here would silently assign to nothing and Vercel
// would find no handler at all.
//
// Actions:
//   { action: 'upload', alt, tags, derivatives: [...], original: {...} }
//   { action: 'delete', asset: {...} }
//   { action: 'status' }
// ─────────────────────────────────────────────────────────────────────────────

// A phone original plus three web copies, base64-inflated by a third. The
// engine's own 24 MB limit on real bytes is the binding one; this only has to
// leave room for the encoding overhead.
export const config = { api: { bodyParser: { sizeLimit: '34mb' } } };

const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';

/**
 * Storage has always been written with SUPABASE_SERVICE_KEY on this deployment
 * (see api/upload.js) while the quote endpoints read SUPABASE_KEY. Rather than
 * pick one and leave a half-configured deployment failing mysteriously, both
 * are accepted and `status` reports which one was found.
 */
function serviceKey() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || null;
}

function transport(key) {
  return {
    async put(bucket, path, bytes, contentType) {
      const r = await fetch(SUPA_URL + '/storage/v1/object/' + bucket + '/' + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key, apikey: key,
          'Content-Type': contentType, 'x-upsert': 'true',
          'Cache-Control': 'public, max-age=31536000, immutable'
        },
        body: Buffer.from(bytes)
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        const err = new Error('storage write failed');
        // Bucket-missing is worth naming exactly: the fix is a one-off setup
        // step, not anything wrong with the photograph.
        if (/bucket not found/i.test(txt) || r.status === 404) {
          err.code = 'bucket_missing'; err.bucket = bucket;
        }
        throw err;
      }
    },
    async del(bucket, path) {
      await fetch(SUPA_URL + '/storage/v1/object/' + bucket + '/' + path, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + key, apikey: key }
      });
    }
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const KEY = serviceKey();
  const action = (req.body && req.body.action) || 'upload';

  if (action === 'status') {
    const media = await import('../designer/engines/media-store.mjs');
    return res.status(200).json({
      configured: !!KEY,
      keyVariable: process.env.SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY'
        : (process.env.SUPABASE_KEY ? 'SUPABASE_KEY' : null),
      buckets: media.MEDIA_BUCKETS,
      limits: media.LIMITS
    });
  }

  if (!KEY) {
    return res.status(500).json({ error: 'server_not_configured',
      detail: 'Neither SUPABASE_SERVICE_KEY nor SUPABASE_KEY is set on this deployment.' });
  }

  try {
    const io = transport(KEY);

    if (action === 'delete') {
      const asset = (req.body && req.body.asset) || null;
      if (!asset) return res.status(400).json({ error: 'no_asset' });
      const { removeImage } = await import('../designer/engines/media-upload.mjs');
      const removed = await removeImage(asset, io);
      return res.status(200).json({ ok: true, removed });
    }

    if (action !== 'upload') return res.status(400).json({ error: 'bad_action' });

    const { storeImage } = await import('../designer/engines/media-upload.mjs');
    const out = await storeImage(req.body || {}, io);
    const { status, ok, ...rest } = out;
    return res.status(status).json(ok ? { ok: true, asset: out.asset } : rest);
  } catch (e) {
    return res.status(500).json({ error: 'upload_failed' });
  }
}
