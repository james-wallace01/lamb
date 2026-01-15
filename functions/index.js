const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

const firestore = getFirestore();

const truncateString = (value, maxLen = 180) => {
  const s = value == null ? '' : String(value);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
};

const normalizeValue = (value) => {
  if (value == null) return null;
  const t = typeof value;
  if (t === 'string') return truncateString(value, 180);
  if (t === 'number') return Number.isFinite(value) ? value : String(value);
  if (t === 'boolean') return value;

  if (Array.isArray(value)) {
    if (value.length <= 8) {
      return value.map((v) => {
        const tv = typeof v;
        if (v == null || tv === 'string' || tv === 'number' || tv === 'boolean') return normalizeValue(v);
        try {
          return truncateString(JSON.stringify(v), 180);
        } catch {
          return '[complex]';
        }
      });
    }
    return { __type: 'array', length: value.length };
  }

  if (t === 'object') {
    try {
      return truncateString(JSON.stringify(value), 220);
    } catch {
      return '[object]';
    }
  }

  try {
    return truncateString(String(value), 180);
  } catch {
    return '[unknown]';
  }
};

const fnv1a32Hex = (input) => {
  const str = input == null ? '' : String(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const buildFingerprint = ({ vaultId, type, actorUid, payload }) => {
  const v = vaultId != null ? String(vaultId) : '';
  const t = type != null ? String(type) : '';
  const a = actorUid != null ? String(actorUid) : '';
  let p = '';
  try {
    p = payload ? JSON.stringify(payload) : '';
  } catch {
    p = '[unstringifiable]';
  }
  return fnv1a32Hex(`${t}|${v}|${a}|${p}`);
};

const diffForUpdate = (before, after) => {
  const changes = {};
  const b = before || {};
  const a = after || {};

  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    if (k === 'editedAt' || k === 'viewedAt') continue; // avoid noisy timestamp-only updates
    const bv = b[k];
    const av = a[k];
    if (bv === av) continue;
    // simple equality for primitives; fall back to JSON
    if (typeof bv === 'object' || typeof av === 'object') {
      try {
        if (JSON.stringify(bv) === JSON.stringify(av)) continue;
      } catch {
        // if unstringifiable, assume changed
      }
    }
    changes[k] = { from: normalizeValue(bv), to: normalizeValue(av) };
  }

  return changes;
};

const getActorUid = (event) => {
  // Best-effort: Firestore triggers may include auth info for client writes.
  // In some environments this can be undefined (admin/server writes).
  return event?.auth?.uid || event?.authId || null;
};

const shouldSkipDuplicate = async ({ vaultId, fingerprint }) => {
  if (!vaultId || !fingerprint) return false;
  try {
    const snap = await firestore
      .collection('vaults')
      .doc(String(vaultId))
      .collection('auditEvents')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snap.empty) return false;
    const doc = snap.docs[0];
    const data = doc.data() || {};
    const lastFp = data.fingerprint || null;
    const lastAt = typeof data.createdAt === 'number' ? data.createdAt : null;

    if (!lastFp || lastFp !== fingerprint) return false;
    if (!lastAt) return false;
    if (Math.abs(Date.now() - lastAt) > 5000) return false;

    return true;
  } catch {
    return false;
  }
};

const writeAuditEvent = async ({ vaultId, type, actorUid, payload }) => {
  const createdAt = Date.now();
  const safePayload = payload && typeof payload === 'object' ? payload : null;
  const fp = buildFingerprint({ vaultId, type, actorUid, payload: safePayload });

  if (await shouldSkipDuplicate({ vaultId, fingerprint: fp })) return;

  await firestore
    .collection('vaults')
    .doc(String(vaultId))
    .collection('auditEvents')
    .add({
      createdAt,
      type: String(type || 'UNKNOWN'),
      actor_uid: actorUid || null,
      actor_id: actorUid || null,
      vault_id: String(vaultId),
      payload: safePayload,
      source: 'function',
      fingerprint: fp,
      // Useful for debugging: helps spot which writes are server-originated.
      serverTimestamp: FieldValue.serverTimestamp(),
    });
};

const handleVaultWrite = async (event) => {
  const vaultId = event.params.vaultId;
  const actorUid = getActorUid(event);

  const beforeExists = !!event.data?.before?.exists;
  const afterExists = !!event.data?.after?.exists;

  const before = beforeExists ? event.data.before.data() : null;
  const after = afterExists ? event.data.after.data() : null;

  if (!beforeExists && afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'VAULT_CREATED',
      actorUid,
      payload: { vault_id: String(vaultId), name: after?.name || null },
    });
    return;
  }

  if (beforeExists && !afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'VAULT_DELETED',
      actorUid,
      payload: { vault_id: String(vaultId), name: before?.name || null },
    });
    return;
  }

  if (beforeExists && afterExists) {
    const changes = diffForUpdate(before, after);
    if (Object.keys(changes).length === 0) return;
    await writeAuditEvent({
      vaultId,
      type: 'VAULT_UPDATED',
      actorUid,
      payload: { vault_id: String(vaultId), changes },
    });
  }
};

const handleCollectionWrite = async (event) => {
  const vaultId = event.params.vaultId;
  const collectionId = event.params.collectionId;
  const actorUid = getActorUid(event);

  const beforeExists = !!event.data?.before?.exists;
  const afterExists = !!event.data?.after?.exists;

  const before = beforeExists ? event.data.before.data() : null;
  const after = afterExists ? event.data.after.data() : null;

  if (!beforeExists && afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'COLLECTION_CREATED',
      actorUid,
      payload: { vault_id: String(vaultId), collection_id: String(collectionId), name: after?.name || null },
    });
    return;
  }

  if (beforeExists && !afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'COLLECTION_DELETED',
      actorUid,
      payload: { vault_id: String(vaultId), collection_id: String(collectionId), name: before?.name || null },
    });
    return;
  }

  if (beforeExists && afterExists) {
    const changes = diffForUpdate(before, after);
    if (Object.keys(changes).length === 0) return;
    await writeAuditEvent({
      vaultId,
      type: 'COLLECTION_UPDATED',
      actorUid,
      payload: { vault_id: String(vaultId), collection_id: String(collectionId), changes },
    });
  }
};

const handleAssetWrite = async (event) => {
  const vaultId = event.params.vaultId;
  const assetId = event.params.assetId;
  const actorUid = getActorUid(event);

  const beforeExists = !!event.data?.before?.exists;
  const afterExists = !!event.data?.after?.exists;

  const before = beforeExists ? event.data.before.data() : null;
  const after = afterExists ? event.data.after.data() : null;

  if (!beforeExists && afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'ASSET_CREATED',
      actorUid,
      payload: { vault_id: String(vaultId), asset_id: String(assetId), title: after?.title || null },
    });
    return;
  }

  if (beforeExists && !afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'ASSET_DELETED',
      actorUid,
      payload: { vault_id: String(vaultId), asset_id: String(assetId), title: before?.title || null },
    });
    return;
  }

  if (beforeExists && afterExists) {
    const changes = diffForUpdate(before, after);
    if (Object.keys(changes).length === 0) return;
    await writeAuditEvent({
      vaultId,
      type: 'ASSET_UPDATED',
      actorUid,
      payload: { vault_id: String(vaultId), asset_id: String(assetId), changes },
    });
  }
};

const handleMembershipWrite = async (event) => {
  const vaultId = event.params.vaultId;
  const memberUid = event.params.memberUid;
  const actorUid = getActorUid(event);

  const beforeExists = !!event.data?.before?.exists;
  const afterExists = !!event.data?.after?.exists;

  const before = beforeExists ? event.data.before.data() : null;
  const after = afterExists ? event.data.after.data() : null;

  if (!beforeExists && afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'VAULT_MEMBERSHIP_CREATED',
      actorUid,
      payload: {
        vault_id: String(vaultId),
        member_uid: String(memberUid),
        role: after?.role || null,
        status: after?.status || null,
        permissions: after?.permissions || null,
      },
    });
    return;
  }

  if (beforeExists && !afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'VAULT_MEMBERSHIP_DELETED',
      actorUid,
      payload: {
        vault_id: String(vaultId),
        member_uid: String(memberUid),
        role: before?.role || null,
        status: before?.status || null,
      },
    });
    return;
  }

  if (beforeExists && afterExists) {
    const changes = diffForUpdate(before, after);
    if (Object.keys(changes).length === 0) return;
    await writeAuditEvent({
      vaultId,
      type: 'VAULT_MEMBERSHIP_UPDATED',
      actorUid,
      payload: {
        vault_id: String(vaultId),
        member_uid: String(memberUid),
        changes,
      },
    });
  }
};

const handlePermissionGrantWrite = async (event) => {
  const vaultId = event.params.vaultId;
  const grantId = event.params.grantId;
  const actorUid = getActorUid(event);

  const beforeExists = !!event.data?.before?.exists;
  const afterExists = !!event.data?.after?.exists;

  const before = beforeExists ? event.data.before.data() : null;
  const after = afterExists ? event.data.after.data() : null;

  const basePayload = (docData) => ({
    vault_id: String(vaultId),
    grant_id: String(grantId),
    user_id: docData?.user_id || null,
    scope_type: docData?.scope_type || null,
    scope_id: docData?.scope_id || null,
  });

  if (!beforeExists && afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'PERMISSION_GRANT_CREATED',
      actorUid,
      payload: {
        ...basePayload(after),
        permissions: after?.permissions || null,
      },
    });
    return;
  }

  if (beforeExists && !afterExists) {
    await writeAuditEvent({
      vaultId,
      type: 'PERMISSION_GRANT_DELETED',
      actorUid,
      payload: {
        ...basePayload(before),
        permissions: before?.permissions || null,
      },
    });
    return;
  }

  if (beforeExists && afterExists) {
    const changes = diffForUpdate(before, after);
    if (Object.keys(changes).length === 0) return;
    await writeAuditEvent({
      vaultId,
      type: 'PERMISSION_GRANT_UPDATED',
      actorUid,
      payload: {
        ...basePayload(after),
        changes,
      },
    });
  }
};

exports.auditVaultWrites = onDocumentWritten('vaults/{vaultId}', handleVaultWrite);
exports.auditCollectionWrites = onDocumentWritten('vaults/{vaultId}/collections/{collectionId}', handleCollectionWrite);
exports.auditAssetWrites = onDocumentWritten('vaults/{vaultId}/assets/{assetId}', handleAssetWrite);
exports.auditMembershipWrites = onDocumentWritten('vaults/{vaultId}/memberships/{memberUid}', handleMembershipWrite);
exports.auditPermissionGrantWrites = onDocumentWritten('vaults/{vaultId}/permissionGrants/{grantId}', handlePermissionGrantWrite);
