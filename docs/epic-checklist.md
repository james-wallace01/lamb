# EPIC completion checklist (Vault auth canonical)

This is a lightweight “definition of done” checklist for the canonical vault auth EPIC across backend, Firestore rules, mobile, and web.

## Canonical data model
- Vault access is membership-based (`/vaults/{vaultId}/memberships/{uid}`), with roles limited to `OWNER` and `DELEGATE`.
- Fine-grained access is represented by scoped grants (`/vaults/{vaultId}/permissionGrants/{grantId}`) for `COLLECTION` and `ASSET`.
- Subscriptions are vault-scoped (`/vaultSubscriptions/{vaultId}`), not user-scoped.

## Firestore rules
- Rules are the canonical authorization source for client reads/writes.
- Clients cannot list a global user directory (`/users`); users can only read their own `/users/{uid}`.
- Paid-gated features are enforced (e.g. delegate membership creation, scoped grants, invitations/audit logs).

## Backend responsibilities
- Server-only “hard ops” exist for operations that are unsafe/impossible client-side (recursive deletes, cross-vault moves).
- Invitation system is server mediated (create/list/revoke/accept) and paid+owner gated where appropriate.
- A paid+owner gated user resolver endpoint exists for email/username → uid lookups without exposing a client user directory:
  - `POST /vaults/:vaultId/users/resolve` with `{ "query": "email-or-username" }`

## Web app (CRA)
- Uses Firebase Auth for session state.
- Uses Firestore snapshots for vaults/collections/assets/memberships/grants.
- Avoids any global `/users` reads.
- Vault sharing uses invitations via backend; Share dialog can list/revoke pending invitations.
- Scoped grants require the target to already be a vault member; target can be entered as uid/email/username (resolver used).

## Mobile app
- Uses canonical vault membership + grants model.
- Invitation accept flow works for invitees.

## Operational / release steps
- Configure backend Firebase Admin credentials (one of):
  - `GOOGLE_APPLICATION_CREDENTIALS`, or
  - `FIREBASE_SERVICE_ACCOUNT_JSON`, or
  - `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
- Ensure `CORS_ORIGINS` includes deployed web origin.
- Ensure production rules are deployed (`firestore.rules`).
- Verify Stripe webhook + subscription state writes to `/vaultSubscriptions/{vaultId}`.
