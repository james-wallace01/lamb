# Firestore Canonical Schema (Vault Model)

This document describes the *canonical* Firestore data model used by LAMB as of 12 Jan 2026.

Principles
- Firestore is the source of truth.
- Firestore Security Rules enforce access control.
- Roles are vault-scoped and only: `OWNER | DELEGATE`.
- Delegates never pay; subscriptions apply to vaults.
- Paid features are enforced by rules using `/vaultSubscriptions/{vaultId}`.

## Top-level collections

### `/users/{uid}`
User profile (one doc per Firebase Auth user).

Required / common fields
- `id` (string) – usually equals `{uid}`
- `email` (string)
- `username` (string)
- `firstName` (string)
- `lastName` (string)
- `prefersDarkMode` (boolean)

Rules
- Only the user can read/write their own doc.

### `/vaultSubscriptions/{vaultId}` (server-written)
Legacy vault subscription state used for paid gating (back-compat fallback).

Fields
- `vault_id` (string)
- `tier` (string|null) – e.g. `BASIC|PREMIUM|PRO` (optional)
- `status` (string) – one of: `active|trialing|past_due|canceled|none|...`
- `cancelAtPeriodEnd` (boolean)
- `trialEndsAt` (number|null ms)
- `renewalDate` (number|null ms)
- `currentPeriodStart` (number|null ms)
- `currentPeriodEnd` (number|null ms)
- `updatedAt` (number ms)

Rules
- Readable by active members of the vault.
- Writes are denied to clients; backend keeps this up to date.

### `/userSubscriptions/{uid}` (server-written, canonical)
Per-user subscription state (one doc per Firebase Auth uid). This is the canonical source of truth used by rules to determine if a vault owner is paid.

Fields (common)
- `user_id` (string uid)
- `tier` (string|null)
- `status` (string) – one of: `active|trialing|past_due|canceled|none|...`
- `provider` (string) – e.g. `apple_iap`
- `productId` (string|null)
- `updatedAt` (number ms)

## Vaults

### `/vaults/{vaultId}`
Canonical vault document.

Required / common fields
- `id` (string)
- `activeOwnerId` (string uid) – canonical owner uid
- `ownerId` (string uid) – back-compat / alias (kept in sync)
- `createdBy` (string uid)
- `createdAt` (number ms)
- `editedAt` (number ms)
- `viewedAt` (number ms)
- `name` (string)
- `description` (string)
- `manager` (string)
- `images` (array<string>)
- `heroImage` (string)

Rules
- Create requires creating an OWNER membership doc in the same batch.
- Update requires OWNER; ownership transfer must be explicit + atomic.
- Client-side delete is disallowed (requires backend recursive delete).

### `/vaults/{vaultId}/memberships/{uid}`
Single source of truth for vault membership.

Fields
- `user_id` (string uid)
- `vault_id` (string vaultId)
- `role` (`OWNER|DELEGATE`)
- `status` (`ACTIVE|REVOKED`)
- `permissions` (object|null)
  - for `OWNER`: `null`
  - for `DELEGATE`: permission map (see below)
- `assigned_at` (number ms)
- `revoked_at` (number|null ms)
- optional: `invitedBy`, `invitedAt`

Permission map keys
- `View`, `Create`, `Edit`, `Move`, `Clone`, `Delete` (boolean)

Rules
- Active members can read.
- Only OWNER can create/update (paid-gated for delegate assignment).
- Transfer ownership is supported by rules (new owner promoted; previous owner demoted).

### `/vaults/{vaultId}/permissionGrants/{grantId}` (paid feature)
Scoped permission grants for collection/asset.

Grant doc id format (canonical)
- `COLLECTION:{collectionId}:{uid}`
- `ASSET:{assetId}:{uid}`

Fields
- `id` (string grantId)
- `vault_id` (string)
- `user_id` (string uid)
- `scope_type` (`COLLECTION|ASSET`)
- `scope_id` (string)
- `permissions` (object) – same keys as membership permissions
- `assigned_at` (number ms)

Rules
- Active members can read.
- OWNER can create/update/delete only when vault is paid.

### `/vaults/{vaultId}/collections/{collectionId}`
Collection documents under a vault.

Fields
- `id` (string)
- `vaultId` (string)
- `name` (string)
- `description` (string)
- `manager` (string)
- `images` (array<string>)
- `heroImage` (string)
- `createdAt` / `editedAt` / `viewedAt` (number ms)

Rules
- Read requires active membership.
- Create requires vault `Create`.
- Update/delete requires scope permission (`Edit` / `Delete`).

### `/vaults/{vaultId}/assets/{assetId}`
Asset documents under a vault.

Fields
- `id` (string)
- `vaultId` (string)
- `collectionId` (string)
- `title` (string)
- `type` (string)
- `category` (string)
- `quantity` (number)
- value fields: `value`, `estimateValue`, `rrp`, `purchasePrice` (optional)
- `description` (string)
- `manager` (string)
- `images` (array<string>)
- `heroImage` (string)
- `createdAt` / `editedAt` / `viewedAt` (number ms)

Rules
- Read requires active membership.
- Create requires `Create` on parent collection OR vault `Create`.
- Update/delete requires asset scope permission.

### `/vaults/{vaultId}/invitations/{code}` (paid feature)
Vault delegate invitations.

Fields (canonical subset)
- `code` (string)
- `vaultId` or `vault_id` (string)
- `status` (`PENDING|ACCEPTED|REVOKED|EXPIRED`)
- `invitee_email` or `email` (string)
- `createdAt` (number ms)
- `createdBy` (string uid)
- `expiresAt` (number ms|null)
- `acceptedAt`, `acceptedByUid`
- `revokedAt`, `revokedBy`

Rules
- OWNER can read.
- OWNER can create/update/delete only when vault is paid.

### `/vaults/{vaultId}/auditEvents/{eventId}` (paid feature)
Immutable audit trail.

Fields
- `id` (string)
- `vault_id` (string)
- `type` (string)
- `actor_uid` (string|null)
- `createdAt` (number ms)
- `payload` (object|null)

Rules
- OWNER can read and create only when vault is paid.
- Updates/deletes are denied.

## Suggested indexes

This model is designed to avoid heavy composite indexes by favoring:
- membership lookups by doc id (`/memberships/{uid}`)
- permission grant lookups by deterministic doc id (`scope:scopeId:uid`)

If you add query patterns like multi-field `where` + `orderBy`, Firestore may prompt you to create composite indexes.

## Notes on “move” and “delete”

- Vault deletion is server-only because client-side deletion is blocked by rules (prevents orphaned subcollections).
- Cross-vault moves (assets/collections) are server-assisted copy+delete operations, exposed by authenticated backend endpoints.
