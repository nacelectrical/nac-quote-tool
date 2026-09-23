// KEEPING AN INSTALLER'S WORK WHEN THE SIGNAL GOES.
//
// Site Adjust is used in a roof space and in a driveway. Reception drops, the
// iPad sleeps, Safari reloads the tab to reclaim memory. None of those may cost
// somebody the twenty minutes they just spent moving fittings.
//
// Nick: "Save edits locally on the device. Save after every completed edit ...
// Never discard an on-site edit because the browser refreshed ... Detect
// conflicting server revisions instead of silently overwriting them."
//
// So every completed edit is written to local storage immediately and the
// server is a SECOND destination, not the first. The sync state is always one
// of four things and is always on screen.

export const SYNC = Object.freeze({
  LOCAL: 'Saved locally',
  SYNCING: 'Syncing',
  SYNCED: 'Synced',
  FAILED: 'Sync failed',
  CONFLICT: 'Conflict'
});

const KEY_PREFIX = 'nac_site_session_';
export const sessionKey = (designId) => KEY_PREFIX + (designId || 'unsaved');

/**
 * A storage that cannot throw.
 *
 * Private browsing, cleared site data and a full quota all make localStorage
 * throw rather than return null, and an exception here would lose the edit this
 * function exists to protect.
 */
function safeStorage(storage) {
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  return {
    get(k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } },
    set(k, v) { try { if (s) { s.setItem(k, v); return true; } } catch (e) { /* full or blocked */ }
                return false; },
    remove(k) { try { if (s) s.removeItem(k); } catch (e) { /* nothing to do */ } }
  };
}

/**
 * Write the session to the device. Called after EVERY completed edit.
 *
 * Returns whether it actually landed, because "saved locally" must never be
 * shown for a write that silently failed.
 */
export function saveSessionLocally(designId, session, { storage = null,
                                                        baseUpdatedAt = null } = {}) {
  const st = safeStorage(storage);
  const record = {
    designId: designId || null,
    savedAt: new Date().toISOString(),
    // What the session was opened from. If the server has moved on from this,
    // somebody else has edited the design and the two have to be reconciled
    // rather than one of them quietly winning.
    baseUpdatedAt,
    session
  };
  const ok = st.set(sessionKey(designId), JSON.stringify(record));
  return { ok, record };
}

/** Read back whatever survived a reload. Never throws, never half-returns. */
export function loadSessionLocally(designId, { storage = null } = {}) {
  const raw = safeStorage(storage).get(sessionKey(designId));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (!rec || !rec.session || !Array.isArray(rec.session.edits)) return null;
    return rec;
  } catch (e) {
    return null;                                  // corrupt is the same as absent
  }
}

export function clearSessionLocally(designId, { storage = null } = {}) {
  safeStorage(storage).remove(sessionKey(designId));
}

/**
 * Has the design moved underneath this session?
 *
 * Compares what the session was opened from against what the server holds now.
 * A conflict is REPORTED, never resolved by guessing: Nick, "Allow the installer
 * to review and resolve a sync conflict."
 */
export function detectConflict(record, serverUpdatedAt) {
  if (!record?.baseUpdatedAt || !serverUpdatedAt) return { conflict: false };
  const conflict = new Date(serverUpdatedAt).getTime() >
                   new Date(record.baseUpdatedAt).getTime();
  return {
    conflict,
    localBase: record.baseUpdatedAt,
    serverVersion: serverUpdatedAt,
    message: conflict
      ? 'This design was changed on the server after you opened it on site. Your ' +
        (record.session?.edits?.length || 0) + ' local edit(s) are safe and have not been ' +
        'sent. Review both versions before syncing.'
      : null
  };
}

/**
 * Push a session to the server, keeping the local copy until it is confirmed.
 *
 * `push` is whatever the app uses to save; it only has to resolve or reject.
 * The local record is deleted ONLY after a confirmed success.
 */
export async function syncSession(designId, record, push, { storage = null } = {}) {
  if (!record) return { state: SYNC.SYNCED, edits: 0 };
  try {
    await push(record);
    clearSessionLocally(designId, { storage });
    return { state: SYNC.SYNCED, edits: record.session?.edits?.length || 0 };
  } catch (e) {
    // The edit stays on the device. This is the case the whole module exists
    // for, so it is not an error path — it is the expected one in a roof.
    return { state: SYNC.FAILED, edits: record.session?.edits?.length || 0,
             error: e?.message || String(e),
             message: 'Not sent — your work is saved on this iPad and will go up when ' +
                      'there is signal.' };
  }
}

export default { SYNC, sessionKey, saveSessionLocally, loadSessionLocally,
                 clearSessionLocally, detectConflict, syncSession };
