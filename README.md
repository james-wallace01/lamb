# lamb
Liquid Asset Management Board

## Repo layout
- web app (React) at repository root
- mobile app (Expo React Native) in `mobile/`
- shared assets/config in root

## Versioning
- Semantic versioning via git tags (vMAJOR.MINOR.PATCH) driven by Conventional Commits (`feat` = MINOR, `fix` = PATCH, `feat!`/`BREAKING CHANGE` = MAJOR).
- Run `npm run release` locally or rely on the `Release` GitHub Action (pushes on `main`) to bump, tag, and update `public/version.json`.
- The app reads `public/version.json` at runtime for the footer; avoid hardcoding version strings anywhere else.

## Mobile setup
1) Install: `cd mobile && npm install`
2) iOS simulator: `npm run ios`
3) Physical device (more reliable QR): `npm run tunnel` (or `npx expo start --tunnel`) and scan with Expo Go
4) Health check: `npm run doctor`
5) Stop Metro when done: Ctrl+C

## Env/secrets
- Keep API keys and Apple/EAS credentials out of git; use CI secrets/keychain.
- `.env*` files are gitignored; add mobile-specific vars under `mobile/.env` if needed.
