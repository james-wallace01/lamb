// Simulation of shared vault creation logic from src/App.js

function permissionIncludes(perm, verb) {
  if (!perm) return false;
  if (perm === "owner") return true;
  try {
    const tokens = String(perm).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.includes(verb);
  } catch (e) {
    return false;
  }
}

function attemptCreateVault({ vaults, users, currentUser, sharedMode, sharedOwnerId, newVault }) {
  const trimToFour = (arr = []) => arr.slice(0, 4);
  const DEFAULT_HERO = "/images/collection_default.jpg";

  const images = trimToFour(newVault.images || []);
  const heroImage = newVault.heroImage || images[0] || DEFAULT_HERO;

  const ownerId = (sharedMode && sharedOwnerId) ? sharedOwnerId : currentUser.id;

  if (ownerId !== currentUser.id) {
    const ownerVaults = vaults.filter(v => v.ownerId === ownerId);
    const sharedEntries = ownerVaults.flatMap(v => (v.sharedWith || []).map(s => ({ ...s, vaultId: v.id })));
    const entry = sharedEntries.find(s => s.userId === currentUser.id || s.username === currentUser.username || s.email === currentUser.email);
    if (!entry || !permissionIncludes(entry.permission || "", "create")) {
      return { ok: false, reason: "no-create-permission" };
    }
    const sharedPermission = entry.permission || "view";
    const vault = {
      id: Date.now(),
      ownerId: ownerId,
      name: newVault.name.trim(),
      description: newVault.description.trim(),
      manager: (newVault.manager || "").trim(),
      isPrivate: true,
      isDefault: false,
      createdAt: new Date().toISOString(),
      lastViewed: new Date().toISOString(),
      lastEditedBy: currentUser.username,
      heroImage,
      images,
      sharedWith: [{ userId: currentUser.id, username: currentUser.username, permission: sharedPermission, includeContents: true }]
    };
    return { ok: true, vault, vaults: [vault, ...vaults] };
  }

  const vault = {
    id: Date.now(),
    ownerId: currentUser.id,
    name: newVault.name.trim(),
    description: newVault.description.trim(),
    manager: (newVault.manager || "").trim(),
    isPrivate: true,
    isDefault: false,
    createdAt: new Date().toISOString(),
    lastViewed: new Date().toISOString(),
    lastEditedBy: currentUser.username,
    heroImage,
    images
  };
  return { ok: true, vault, vaults: [vault, ...vaults] };
}

// Setup users
const james = { id: 1, firstName: 'James', lastName: 'Owner', email: 'james@example.com', username: 'james' };
const watson = { id: 2, firstName: 'Watson', lastName: 'User', email: 'watson@example.com', username: 'watson' };

// Owner's existing vault (shared with Watson with varying permission)
const ownerVault = (permission) => ({ id: 100, ownerId: james.id, name: 'James Vault', sharedWith: [{ userId: watson.id, username: watson.username, permission }] });

const basicNewVault = { name: 'New Shared Vault', description: 'Created in shared view', images: [] };

console.log('Scenario 1: Watson has only VIEW permission (should be blocked)');
let vaults1 = [ownerVault('view')];
let res1 = attemptCreateVault({ vaults: vaults1, users: [james, watson], currentUser: watson, sharedMode: true, sharedOwnerId: james.id, newVault: basicNewVault });
console.log('Result:', res1.ok ? 'ALLOWED' : 'BLOCKED', res1.reason || '');
if (res1.ok) console.log('Created vault ownerId=', res1.vault.ownerId, 'sharedWith=', res1.vault.sharedWith);

console.log('\nScenario 2: Watson has CREATE permission (should be allowed)');
let vaults2 = [ownerVault('create')];
let res2 = attemptCreateVault({ vaults: vaults2, users: [james, watson], currentUser: watson, sharedMode: true, sharedOwnerId: james.id, newVault: basicNewVault });
console.log('Result:', res2.ok ? 'ALLOWED' : 'BLOCKED', res2.reason || '');
if (res2.ok) console.log('Created vault ownerId=', res2.vault.ownerId, 'sharedWith=', res2.vault.sharedWith);

console.log('\nScenario 3: Watson creates in his own space (should be allowed)');
let vaults3 = [];
let res3 = attemptCreateVault({ vaults: vaults3, users: [james, watson], currentUser: watson, sharedMode: false, sharedOwnerId: null, newVault: basicNewVault });
console.log('Result:', res3.ok ? 'ALLOWED' : 'BLOCKED', res3.reason || '');
if (res3.ok) console.log('Created vault ownerId=', res3.vault.ownerId, 'sharedWith=', res3.vault.sharedWith || []);

// Exit code
if (!res1.ok && res2.ok && res3.ok) {
  process.exit(0);
} else {
  process.exit(1);
}
