# Firestore Canonical Schema (Vault Model)

This project is migrating to Firestore as the canonical source of truth for roles, permissions, and paid gating.

## Top-level collections

### `users/{uid}`
User profile data (no global roles).

Recommended fields:
- `id`: string (optional; can equal `{uid}`)
- `email`: string
- `firstName`, `lastName`, `username`: string
- `createdAt`: number (ms)

### `vaultSubscriptions/{vaultId}`
One document per vault that represents the vault’s paid status.

Fields (written by server/Stripe webhook only):
- `vault_id`: string
- `status`: string (`active | trialing | past_due | canceled | none | ...`)
- `tier`: string (`BASIC | PREMIUM | PRO | ...`) or null
- `stripeCustomerId`: string or null
- `stripeSubscriptionId`: string or null
- `cancelAtPeriodEnd`: boolean
- `trialEndsAt`, `renewalDate`: number (ms) or null
- `updatedAt`: number (ms)

## Vaults

### `vaults/{vaultId}`
Canonical vault document.

Required fields:
- `activeOwnerId`: string (uid) — exactly one ACTIVE OWNER
- `createdBy`: string (uid)
- `createdAt`: number (ms)

Optional fields (product/UI):
- `name`: string
- `description`: string
- `images`: array
- `heroImage`: string|null

### `vaults/{vaultId}/memberships/{uid}`
The *only* source of truth for role within a vault.

Fields:
- `user_id`: string (uid)
- `vault_id`: string
- `role`: `OWNER | DELEGATE`
- `status`: `ACTIVE | REVOKED`
- `permissions`: object|null (null for OWNER; for DELEGATE, keys like `View`, `Create`, `Edit`, `Move`, `Clone`, `Delete`)
- `assigned_at`: number (ms)
- `revoked_at`: number (ms) or null

### `vaults/{vaultId}/permissionGrants/{grantId}`
Paid feature. Optional fine-grained permissions for a delegate on a specific scope.

Recommended id format:
- `${scopeType}:${scopeId}:${uid}`

Fields:
- `vault_id`: string
- `scope_type`: `COLLECTION | ASSET`
- `scope_id`: string
- `user_id`: string (uid)
- `permissions`: object

### `vaults/{vaultId}/collections/{collectionId}`
Collection documents.

Must include:
- `vaultId`: string

### `vaults/{vaultId}/assets/{assetId}`
Asset documents.

Must include:
- `vaultId`: string
- `collectionId`: string

### `vaults/{vaultId}/invitations/{inviteId}`
Paid feature. Server-managed invitations.

Fields:
- `status`: `PENDING | ACCEPTED | EXPIRED | REVOKED`
- `invitee_email`: string
- `createdBy`: string (uid)
- `createdAt`: number (ms)
- `expiresAt`: number (ms)

### `vaults/{vaultId}/auditEvents/{eventId}`
Paid feature. Immutable audit events written server-side.

Fields:
- `type`: string
- `actor_uid`: string|null
- `createdAt`: number (ms)
- `payload`: object|null
