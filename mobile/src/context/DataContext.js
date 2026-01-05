import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getItem, setItem, removeItem } from '../storage';

const DATA_KEY = 'lamb-mobile-data-v3';
const STORAGE_VERSION = 3;
const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/112?text=Profile';
const DEFAULT_MEDIA_IMAGE = 'https://via.placeholder.com/900x600?text=Image';

const withProfileImage = (user) => user && (user.profileImage ? user : { ...user, profileImage: DEFAULT_PROFILE_IMAGE });
const withMedia = (item) => {
  if (!item) return item;
  const images = Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, 4) : [];
  const heroImage = item.heroImage || images[0] || DEFAULT_MEDIA_IMAGE;
  return { ...item, images, heroImage };
};

const migrateData = (data) => {
  if (!data) return data;
  const migrated = { ...data };
  migrated.vaults = (data.vaults || []).map(v => withMedia(v.name === 'Family Vault' ? { ...v, name: 'Example Vault' } : v));
  migrated.collections = (data.collections || []).map(c => withMedia(c.name === 'Watches' ? { ...c, name: 'Example Collection' } : c));
  migrated.assets = (data.assets || []).map(a => withMedia(a.title === 'Speedmaster' ? { ...a, title: 'Example Asset' } : a));
  migrated.users = (data.users || []).map(u => withProfileImage(u));
  migrated.currentUser = withProfileImage(data.currentUser);
  return migrated;
};

const seedUsers = [
  { id: 'u1', username: 'james', firstName: 'James', lastName: 'Wallace', email: 'james@example.com', password: 'pass123', profileImage: DEFAULT_PROFILE_IMAGE },
  { id: 'u2', username: 'alex', firstName: 'Alex', lastName: 'Smith', email: 'alex@example.com', password: 'pass123', profileImage: DEFAULT_PROFILE_IMAGE }
];

const seedVaults = [
  { id: 'v1', name: 'Example Vault', ownerId: 'u1', sharedWith: [], createdAt: Date.now(), viewedAt: Date.now(), editedAt: Date.now(), heroImage: DEFAULT_MEDIA_IMAGE, images: [] },
  { id: 'v2', name: 'Example Vault', ownerId: 'u2', sharedWith: [], createdAt: Date.now(), viewedAt: Date.now(), editedAt: Date.now(), heroImage: DEFAULT_MEDIA_IMAGE, images: [] }
];

const seedCollections = [
  { id: 'c1', vaultId: 'v1', name: 'Example Collection', ownerId: 'u1', sharedWith: [], createdAt: Date.now(), viewedAt: Date.now(), editedAt: Date.now(), heroImage: DEFAULT_MEDIA_IMAGE, images: [] },
  { id: 'c2', vaultId: 'v2', name: 'Example Collection', ownerId: 'u2', sharedWith: [], createdAt: Date.now(), viewedAt: Date.now(), editedAt: Date.now(), heroImage: DEFAULT_MEDIA_IMAGE, images: [] }
];

const seedAssets = [
  { id: 'a1', collectionId: 'c1', vaultId: 'v1', title: 'Example Asset', type: 'Watch', category: 'Collectable', ownerId: 'u1', manager: 'james', createdAt: Date.now(), viewedAt: Date.now(), editedAt: Date.now(), quantity: 1, value: 7200, heroImage: DEFAULT_MEDIA_IMAGE, images: [] },
  { id: 'a2', collectionId: 'c2', vaultId: 'v2', title: 'Example Asset', type: 'Art', category: 'Painting', ownerId: 'u2', manager: 'alex', createdAt: Date.now(), viewedAt: Date.now(), editedAt: Date.now(), quantity: 1, value: 15000, heroImage: DEFAULT_MEDIA_IMAGE, images: [] }
];

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [vaults, setVaults] = useState([]);
  const [collections, setCollections] = useState([]);
  const [assets, setAssets] = useState([]);

    useEffect(() => {
      (async () => {
        await removeItem('lamb-mobile-data-v1'); // clean legacy
        await removeItem('lamb-mobile-data-v2'); // clean previous version
        const stored = await getItem(DATA_KEY, null);
        if (stored && stored.version === STORAGE_VERSION) {
          const migrated = migrateData(stored);
          setUsers(migrated.users || []);
          setCurrentUser(migrated.currentUser || null);
          setVaults(migrated.vaults || []);
          setCollections(migrated.collections || []);
          setAssets(migrated.assets || []);
          await setItem(DATA_KEY, { ...migrated, version: STORAGE_VERSION });
        } else {
          setUsers(seedUsers);
          setCurrentUser(null); // force sign-in
          setVaults(seedVaults);
          setCollections(seedCollections);
          setAssets(seedAssets);
          await setItem(DATA_KEY, { version: STORAGE_VERSION, users: seedUsers, currentUser: null, vaults: seedVaults, collections: seedCollections, assets: seedAssets });
        }
        setLoading(false);
      })();
    }, []);

    useEffect(() => {
      if (loading) return;
      setItem(DATA_KEY, { version: STORAGE_VERSION, users, currentUser, vaults, collections, assets });
    }, [users, currentUser, vaults, collections, assets, loading]);

    const login = (identifier, password) => {
      const found = users.find(u => (u.username === identifier || u.email === identifier) && u.password === password);
      if (!found) return { ok: false, message: 'Invalid credentials' };
      const ensured = withProfileImage(found);
      setCurrentUser(ensured);
      return { ok: true };
    };

  const logout = () => {
    setCurrentUser(null);
  };

    const register = ({ firstName, lastName, email, username, password }) => {
    const exists = users.find(u => u.username === username || u.email === email);
    if (exists) return { ok: false, message: 'User already exists' };
      const newUser = { id: `u${Date.now()}`, firstName, lastName, email, username, password, profileImage: DEFAULT_PROFILE_IMAGE };
    const now = Date.now();
    const newVault = { id: `v${Date.now()}`, name: 'Example Vault', ownerId: newUser.id, sharedWith: [], createdAt: now, viewedAt: now, editedAt: now, heroImage: DEFAULT_MEDIA_IMAGE, images: [] };
    const newCollection = { id: `c${Date.now() + 1}`, vaultId: newVault.id, name: 'Example Collection', ownerId: newUser.id, sharedWith: [], createdAt: now, viewedAt: now, editedAt: now, heroImage: DEFAULT_MEDIA_IMAGE, images: [] };
    const newAsset = { id: `a${Date.now() + 2}`, vaultId: newVault.id, collectionId: newCollection.id, title: 'Example Asset', type: 'Asset', category: 'Example', ownerId: newUser.id, manager: newUser.username, createdAt: now, viewedAt: now, editedAt: now, quantity: 1, heroImage: DEFAULT_MEDIA_IMAGE, images: [] };
      setUsers(prev => [...prev, newUser]);
      setVaults(prev => [newVault, ...prev]);
      setCollections(prev => [newCollection, ...prev]);
      setAssets(prev => [newAsset, ...prev]);
      setCurrentUser(newUser);
      return { ok: true };
  };

    const updateCurrentUser = (patch) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const { username, email } = patch;
      if (username && users.some(u => u.username === username && u.id !== currentUser.id)) {
        return { ok: false, message: 'Username already taken' };
      }
      if (email && users.some(u => u.email === email && u.id !== currentUser.id)) {
        return { ok: false, message: 'Email already taken' };
      }
        const merged = withProfileImage({ ...currentUser, ...patch });
      setCurrentUser(merged);
      setUsers(prev => prev.map(u => u.id === currentUser.id ? merged : u));
      return { ok: true };
    };

      const resetPassword = (newPassword = 'changeme') => {
        if (!currentUser) return { ok: false, message: 'Not signed in' };
        const updated = { ...currentUser, password: newPassword };
        setCurrentUser(updated);
        setUsers(prev => prev.map(u => u.id === currentUser.id ? updated : u));
        return { ok: true, password: newPassword };
      };

      const deleteAccount = () => {
        if (!currentUser) return { ok: false, message: 'Not signed in' };
        const userId = currentUser.id;
        setUsers(prev => prev.filter(u => u.id !== userId));
        setVaults(prev => prev
          .filter(v => v.ownerId !== userId)
          .map(v => ({ ...v, sharedWith: (v.sharedWith || []).filter(s => s.userId !== userId) }))
        );
        setCollections(prev => prev
          .filter(c => c.ownerId !== userId)
          .map(c => ({ ...c, sharedWith: (c.sharedWith || []).filter(s => s.userId !== userId) }))
        );
        setAssets(prev => prev.filter(a => a.ownerId !== userId));
        setCurrentUser(null);
        return { ok: true };
      };

    const addVault = ({ name, images = [], heroImage }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const createdAt = Date.now();
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const vault = withMedia({
        id: `v${Date.now()}`,
        name: name || 'Untitled',
        ownerId: currentUser.id,
        sharedWith: [],
        createdAt,
        viewedAt: createdAt,
        editedAt: createdAt,
        images: normalizedImages,
        heroImage: heroImage || normalizedImages[0] || DEFAULT_MEDIA_IMAGE,
      });
      setVaults(prev => [vault, ...prev]);
      return { ok: true, vault };
    };

    const canCreateCollectionsInVault = (vaultId, userId) => {
      if (!vaultId || !userId) return false;
      const vault = vaults.find(v => v.id === vaultId);
      if (!vault) return false;
      if (vault.ownerId === userId) return true;
      const match = (vault.sharedWith || []).find(s => s.userId === userId);
      if (!match) return false;
      if (match.role === 'manager') return true;
      return !!match.canCreateCollections;
    };

    const addCollection = ({ vaultId, name, images = [], heroImage }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      if (!canCreateCollectionsInVault(vaultId, currentUser.id)) return { ok: false, message: 'No permission to add collections' };
      const createdAt = Date.now();
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const collection = withMedia({
        id: `c${Date.now()}`,
        vaultId,
        name: name || 'Untitled',
        ownerId: currentUser.id,
        sharedWith: [],
        createdAt,
        viewedAt: createdAt,
        editedAt: createdAt,
        images: normalizedImages,
        heroImage: heroImage || normalizedImages[0] || DEFAULT_MEDIA_IMAGE,
      });
      setCollections(prev => [collection, ...prev]);
      return { ok: true, collection };
    };

    const canCreateAssetsInCollection = (collectionId, userId) => {
      if (!collectionId || !userId) return false;
      const collection = collections.find(c => c.id === collectionId);
      if (!collection) return false;
      if (collection.ownerId === userId) return true;
      const match = (collection.sharedWith || []).find(s => s.userId === userId);
      if (!match) return false;
      if (match.role === 'manager') return true;
      return !!match.canCreateAssets;
    };

    const addAsset = ({ vaultId, collectionId, title, type, category, images = [], heroImage }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      if (!canCreateAssetsInCollection(collectionId, currentUser.id)) return { ok: false, message: 'No permission to add assets' };
      const createdAt = Date.now();
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const asset = withMedia({
        id: `a${Date.now()}`,
        vaultId,
        collectionId,
        title: title || 'Untitled',
        type: type || '',
        category: category || '',
        ownerId: currentUser.id,
        manager: currentUser.username,
        createdAt,
        viewedAt: createdAt,
        editedAt: createdAt,
        quantity: 1,
        images: normalizedImages,
        heroImage: heroImage || normalizedImages[0] || DEFAULT_MEDIA_IMAGE,
      });
      setAssets(prev => [asset, ...prev]);
      return { ok: true, asset };
    };

    const shareVault = ({ vaultId, userId, role = 'viewer', canCreateCollections = false }) => {
      setVaults(prev => prev.map(v => {
        if (v.id !== vaultId) return v;
        const sharedWith = v.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return v;
        return { ...v, sharedWith: [...sharedWith, { userId, role, canCreateCollections }] };
      }));
    };

    const shareCollection = ({ collectionId, userId, role = 'viewer', canCreateAssets = false }) => {
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        const sharedWith = c.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return c;
        return { ...c, sharedWith: [...sharedWith, { userId, role, canCreateAssets }] };
      }));
    };

    const shareAsset = ({ assetId, userId, role = 'viewer' }) => {
      setAssets(prev => prev.map(a => {
        if (a.id !== assetId) return a;
        const sharedWith = a.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return a;
        return { ...a, sharedWith: [...sharedWith, { userId, role }] };
      }));
    };

    const updateVaultShare = ({ vaultId, userId, role, canCreateCollections }) => {
      setVaults(prev => prev.map(v => {
        if (v.id !== vaultId) return v;
        const sharedWith = (v.sharedWith || []).map(s => s.userId === userId ? { ...s, role: role || s.role, canCreateCollections: typeof canCreateCollections === 'boolean' ? canCreateCollections : s.canCreateCollections } : s);
        return { ...v, sharedWith };
      }));
    };

    const updateCollectionShare = ({ collectionId, userId, role, canCreateAssets }) => {
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        const sharedWith = (c.sharedWith || []).map(s => s.userId === userId ? { ...s, role: role || s.role, canCreateAssets: typeof canCreateAssets === 'boolean' ? canCreateAssets : s.canCreateAssets } : s);
        return { ...c, sharedWith };
      }));
    };

    const updateAssetShare = ({ assetId, userId, role }) => {
      setAssets(prev => prev.map(a => {
        if (a.id !== assetId) return a;
        const sharedWith = (a.sharedWith || []).map(s => s.userId === userId ? { ...s, role: role || s.role } : s);
        return { ...a, sharedWith };
      }));
    };

    const removeVaultShare = ({ vaultId, userId }) => {
      setVaults(prev => prev.map(v => v.id === vaultId ? { ...v, sharedWith: (v.sharedWith || []).filter(s => s.userId !== userId) } : v));
    };

    const removeCollectionShare = ({ collectionId, userId }) => {
      setCollections(prev => prev.map(c => c.id === collectionId ? { ...c, sharedWith: (c.sharedWith || []).filter(s => s.userId !== userId) } : c));
    };

    const removeAssetShare = ({ assetId, userId }) => {
      setAssets(prev => prev.map(a => a.id === assetId ? { ...a, sharedWith: (a.sharedWith || []).filter(s => s.userId !== userId) } : a));
    };

  const updateVault = (vaultId, patch) => {
    const editedAt = Date.now();
    setVaults(prev => prev.map(v => v.id === vaultId ? withMedia({ ...v, ...patch, editedAt }) : v));
  };

  const updateCollection = (collectionId, patch) => {
    const editedAt = Date.now();
    setCollections(prev => prev.map(c => c.id === collectionId ? withMedia({ ...c, ...patch, editedAt }) : c));
  };

  const updateAsset = (assetId, patch) => {
    const editedAt = Date.now();
    setAssets(prev => prev.map(a => a.id === assetId ? withMedia({ ...a, ...patch, editedAt }) : a));
  };

  const moveCollection = ({ collectionId, targetVaultId }) => {
    setCollections(prev => prev.map(c => c.id === collectionId ? { ...c, vaultId: targetVaultId } : c));
    setAssets(prev => prev.map(a => a.collectionId && a.collectionId === collectionId ? { ...a, vaultId: targetVaultId } : a));
  };

  const moveAsset = ({ assetId, targetVaultId, targetCollectionId }) => {
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, vaultId: targetVaultId, collectionId: targetCollectionId } : a));
  };

  const deleteVault = (vaultId) => {
    setVaults(prev => prev.filter(v => v.id !== vaultId));
    setCollections(prev => prev.filter(c => c.vaultId !== vaultId));
    setAssets(prev => prev.filter(a => a.vaultId !== vaultId));
  };

  const deleteCollection = (collectionId) => {
    setCollections(prev => prev.filter(c => c.id !== collectionId));
    setAssets(prev => prev.filter(a => a.collectionId !== collectionId));
  };

  const deleteAsset = (assetId) => {
    setAssets(prev => prev.filter(a => a.id !== assetId));
  };

  const getRoleForVault = (vaultId, userId) => {
    const vault = vaults.find(v => v.id === vaultId);
    if (!vault) return null;
    if (vault.ownerId === userId) return 'owner';
    const match = (vault.sharedWith || []).find(s => s.userId === userId);
    return match?.role || null;
  };

    const getRoleForCollection = (collectionId, userId) => {
      const collection = collections.find(c => c.id === collectionId);
      if (!collection) return null;
      if (collection.ownerId === userId) return 'owner';
      const match = (collection.sharedWith || []).find(s => s.userId === userId);
      return match?.role || null;
    };

  const getRoleForAsset = (assetId, userId) => {
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return null;
    if (asset.ownerId === userId) return 'owner';
    const match = (asset.sharedWith || []).find(s => s.userId === userId);
    return match?.role || null;
  };

  const value = useMemo(() => ({
    loading,
    users,
    currentUser,
    setCurrentUser,
    vaults,
    collections,
    assets,
    setVaults,
    setCollections,
    setAssets,
    login,
    logout,
    register,
    updateCurrentUser,
    resetPassword,
    deleteAccount,
    addVault,
    addCollection,
    addAsset,
    updateVault,
    updateCollection,
    shareVault,
    shareCollection,
    shareAsset,
    updateVaultShare,
    updateCollectionShare,
    updateAssetShare,
    removeVaultShare,
    removeCollectionShare,
    removeAssetShare,
    updateAsset,
    moveCollection,
    moveAsset,
    deleteVault,
    deleteCollection,
    deleteAsset,
    getRoleForVault,
    getRoleForCollection,
    getRoleForAsset,
      canCreateCollectionsInVault,
      canCreateAssetsInCollection,
  }), [loading, users, currentUser, vaults, collections, assets]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
