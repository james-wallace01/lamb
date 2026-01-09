import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getItem, setItem, removeItem } from '../storage';

const DATA_KEY = 'lamb-mobile-data-v5';
const STORAGE_VERSION = 5;
const DEFAULT_PROFILE_IMAGE = 'http://192.168.7.112:3000/images/default-avatar.png';
const DEFAULT_MEDIA_IMAGE = 'http://192.168.7.112:3000/images/collection_default.jpg';

const normalizeRole = (role) => {
  if (!role) return null;
  const raw = role.toString().trim().toLowerCase();
  if (raw === 'viewer' || raw === 'reviewer') return 'reviewer';
  if (raw === 'editor') return 'editor';
  if (raw === 'manager') return 'manager';
  if (raw === 'owner') return 'owner';
  return raw;
};

// Subscription tiers with features
const SUBSCRIPTION_TIERS = {
  BASIC: { 
    id: 'BASIC', 
    name: 'Basic', 
    price: 4.99, 
    period: 'month', 
    description: 'Get started with LAMB',
    features: [
      'Up to 5 vaults',
      'Basic organization tools',
      'Email support',
      'Mobile app access'
    ]
  },
  PREMIUM: { 
    id: 'PREMIUM', 
    name: 'Premium', 
    price: 9.99, 
    period: 'month', 
    description: 'Advanced features',
    features: [
      'Unlimited vaults',
      'Advanced analytics',
      'Priority email support',
      'API access',
      'Custom metadata'
    ]
  },
  PRO: { 
    id: 'PRO', 
    name: 'Pro', 
    price: 19.99, 
    period: 'month', 
    description: 'Full access',
    features: [
      'Unlimited everything',
      'Advanced analytics & reports',
      'Priority 24/7 support',
      'API access + webhooks',
      'Custom workflows',
      'Team collaboration',
      'Advanced security'
    ]
  }
};

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

const DEMO_USERS = [
  {
    id: 'u_demo_alex',
    firstName: 'Alex',
    lastName: 'Morgan',
    email: 'alex@example.com',
    username: 'alex',
    password: 'demo123',
    profileImage: DEFAULT_PROFILE_IMAGE,
    subscription: {
      tier: 'BASIC',
      startDate: 0,
      renewalDate: 4102444800000,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      cancelAtPeriodEnd: false,
    },
  },
  {
    id: 'u_demo_sam',
    firstName: 'Sam',
    lastName: 'Taylor',
    email: 'sam@example.com',
    username: 'sam',
    password: 'demo123',
    profileImage: DEFAULT_PROFILE_IMAGE,
    subscription: {
      tier: 'PREMIUM',
      startDate: 0,
      renewalDate: 4102444800000,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      cancelAtPeriodEnd: false,
    },
  },
];

const ensureDemoUsers = (existingUsers) => {
  const base = Array.isArray(existingUsers) ? existingUsers : [];
  const hasUser = (candidate) =>
    base.some(
      (u) =>
        u?.id === candidate.id ||
        (u?.username && candidate.username && u.username.toLowerCase() === candidate.username.toLowerCase()) ||
        (u?.email && candidate.email && u.email.toLowerCase() === candidate.email.toLowerCase())
    );

  const additions = DEMO_USERS.filter((u) => !hasUser(u));
  if (additions.length === 0) return base;
  return [...base, ...additions.map(withProfileImage)];
};

const seedUsers = [];

const seedVaults = [];

const seedCollections = [];

const seedAssets = [];

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
          const nextUsers = ensureDemoUsers(migrated.users || []);
          setUsers(nextUsers);
          setCurrentUser(migrated.currentUser || null);
          setVaults(migrated.vaults || []);
          setCollections(migrated.collections || []);
          setAssets(migrated.assets || []);
          await setItem(DATA_KEY, { ...migrated, users: nextUsers, version: STORAGE_VERSION });
        } else {
          const seedData = { users: seedUsers, vaults: seedVaults, collections: seedCollections, assets: seedAssets, currentUser: null };
          const migratedSeed = migrateData(seedData);
          const nextUsers = ensureDemoUsers(migratedSeed.users);
          setUsers(nextUsers);
          setCurrentUser(migratedSeed.currentUser);
          setVaults(migratedSeed.vaults);
          setCollections(migratedSeed.collections);
          setAssets(migratedSeed.assets);
          await setItem(DATA_KEY, { version: STORAGE_VERSION, users: nextUsers, currentUser: migratedSeed.currentUser, vaults: migratedSeed.vaults, collections: migratedSeed.collections, assets: migratedSeed.assets });
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
      
      // Check if user has an active subscription
      if (!found.subscription || !found.subscription.tier) {
        return { ok: false, message: 'No active subscription. Please purchase a subscription to continue.' };
      }
      
      const ensured = withProfileImage(found);
      setCurrentUser(ensured);
      return { ok: true };
    };

  const logout = () => {
    setCurrentUser(null);
  };

  // Reset all data - useful for testing
  const resetAllData = async () => {
    try {
      setCurrentUser(null);
      setUsers([]);
      setVaults([]);
      setCollections([]);
      setAssets([]);
      await removeItem(DATA_KEY);
      console.log('All data cleared successfully');
      return { ok: true, message: 'All data cleared' };
    } catch (error) {
      console.error('Error clearing data:', error);
      return { ok: false, message: error.message };
    }
  };

const register = ({ firstName, lastName, email, username, password, subscriptionTier, stripeSubscriptionId, stripeCustomerId }) => {
      const exists = users.find(u => u.username === username || u.email === email);
      if (exists) return { ok: false, message: 'User already exists' };
      
      // Subscription is required
      if (!subscriptionTier) return { ok: false, message: 'You must select a subscription plan' };
      
      const now = Date.now();
      const newUser = { 
        id: `u${Date.now()}`, 
        firstName, 
        lastName, 
        email, 
        username, 
        password, 
        profileImage: DEFAULT_PROFILE_IMAGE,
        subscription: {
          tier: subscriptionTier,
          startDate: now,
          renewalDate: now + (30 * 24 * 60 * 60 * 1000), // 30 days from now
          stripeSubscriptionId: stripeSubscriptionId || null,
          stripeCustomerId: stripeCustomerId || null,
          cancelAtPeriodEnd: false
        }
      };
      
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
      if (normalizeRole(match.role) === 'manager') return true;
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
      if (normalizeRole(match.role) === 'manager') return true;
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

    const shareVault = ({ vaultId, userId, role = 'reviewer', canCreateCollections = false }) => {
      setVaults(prev => prev.map(v => {
        if (v.id !== vaultId) return v;
        const sharedWith = v.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return v;
        const normalizedRole = normalizeRole(role) || 'reviewer';
        return { ...v, sharedWith: [...sharedWith, { userId, role: normalizedRole, canCreateCollections }] };
      }));
    };

    const shareCollection = ({ collectionId, userId, role = 'reviewer', canCreateAssets = false }) => {
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        const sharedWith = c.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return c;
        const normalizedRole = normalizeRole(role) || 'reviewer';
        return { ...c, sharedWith: [...sharedWith, { userId, role: normalizedRole, canCreateAssets }] };
      }));
    };

    const shareAsset = ({ assetId, userId, role = 'reviewer' }) => {
      setAssets(prev => prev.map(a => {
        if (a.id !== assetId) return a;
        const sharedWith = a.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return a;
        const normalizedRole = normalizeRole(role) || 'reviewer';
        return { ...a, sharedWith: [...sharedWith, { userId, role: normalizedRole }] };
      }));
    };

    const updateVaultShare = ({ vaultId, userId, role, canCreateCollections }) => {
      setVaults(prev => prev.map(v => {
        if (v.id !== vaultId) return v;
        const sharedWith = (v.sharedWith || []).map(s => {
          if (s.userId !== userId) return s;
          const normalizedRole = normalizeRole(role || s.role) || 'reviewer';
          return {
            ...s,
            role: normalizedRole,
            canCreateCollections: typeof canCreateCollections === 'boolean' ? canCreateCollections : s.canCreateCollections,
          };
        });
        return { ...v, sharedWith };
      }));
    };

    const updateCollectionShare = ({ collectionId, userId, role, canCreateAssets }) => {
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        const sharedWith = (c.sharedWith || []).map(s => {
          if (s.userId !== userId) return s;
          const normalizedRole = normalizeRole(role || s.role) || 'reviewer';
          return {
            ...s,
            role: normalizedRole,
            canCreateAssets: typeof canCreateAssets === 'boolean' ? canCreateAssets : s.canCreateAssets,
          };
        });
        return { ...c, sharedWith };
      }));
    };

    const updateAssetShare = ({ assetId, userId, role }) => {
      setAssets(prev => prev.map(a => {
        if (a.id !== assetId) return a;
        const sharedWith = (a.sharedWith || []).map(s => {
          if (s.userId !== userId) return s;
          const normalizedRole = normalizeRole(role || s.role) || 'reviewer';
          return { ...s, role: normalizedRole };
        });
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
    return normalizeRole(match?.role) || null;
  };

    const getRoleForCollection = (collectionId, userId) => {
      const collection = collections.find(c => c.id === collectionId);
      if (!collection) return null;
      if (collection.ownerId === userId) return 'owner';
      const match = (collection.sharedWith || []).find(s => s.userId === userId);
      return normalizeRole(match?.role) || null;
    };

  const getRoleForAsset = (assetId, userId) => {
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return null;
    if (asset.ownerId === userId) return 'owner';
    const match = (asset.sharedWith || []).find(s => s.userId === userId);
    return normalizeRole(match?.role) || null;
  };

  const updateSubscription = (subscriptionTier, stripeSubscriptionId) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    if (!subscriptionTier) return { ok: false, message: 'Invalid subscription tier' };
    
    const tierUpper = subscriptionTier.toUpperCase();
    if (!SUBSCRIPTION_TIERS[tierUpper]) {
      return { ok: false, message: 'Invalid subscription tier' };
    }
    
    const now = Date.now();
    const updated = {
      ...currentUser,
      subscription: {
        ...currentUser.subscription,
        tier: tierUpper,
        startDate: now,
        renewalDate: now + (30 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: stripeSubscriptionId || currentUser.subscription?.stripeSubscriptionId,
        cancelAtPeriodEnd: false
      }
    };
    
    setCurrentUser(updated);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? updated : u));
    return { ok: true };
  };

  // Set subscription cancellation flag
  const setCancelAtPeriodEnd = (cancelAtPeriodEnd) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    
    const updated = {
      ...currentUser,
      subscription: {
        ...currentUser.subscription,
        cancelAtPeriodEnd: cancelAtPeriodEnd
      }
    };
    
    setCurrentUser(updated);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? updated : u));
    return { ok: true };
  };

  // Calculate proration for plan changes
  const calculateProration = (fromTier, toTier) => {
    const now = Date.now();
    const renewalDate = new Date(currentUser?.subscription?.renewalDate || now);
    const daysRemaining = Math.max(1, Math.ceil((renewalDate - now) / (1000 * 60 * 60 * 24)));
    const totalDaysInMonth = 30; // Approximate
    
    const currentPlan = SUBSCRIPTION_TIERS[fromTier.toUpperCase()];
    const newPlan = SUBSCRIPTION_TIERS[toTier.toUpperCase()];
    
    // Calculate daily rates
    const currentDailyRate = currentPlan.price / totalDaysInMonth;
    const newDailyRate = newPlan.price / totalDaysInMonth;
    
    // Calculate remaining value of current plan
    const remainingValue = currentDailyRate * daysRemaining;
    
    // Calculate cost of new plan for remaining period
    const costForRemaining = newDailyRate * daysRemaining;
    
    // Difference owed (positive = upgrade charge, negative = credit but no refund per user spec)
    const differenceOwed = Math.max(0, costForRemaining - remainingValue);
    
    // Next bill amount (full price of new plan)
    const nextBillAmount = newPlan.price;
    
    // Next bill date (renewal date)
    const nextBillDate = new Date(renewalDate);
    
    return {
      daysRemaining,
      remainingValue: parseFloat(remainingValue.toFixed(2)),
      costForRemaining: parseFloat(costForRemaining.toFixed(2)),
      chargeNow: parseFloat(differenceOwed.toFixed(2)),
      nextBillAmount: nextBillAmount,
      nextBillDate: nextBillDate,
      isUpgrade: newPlan.price > currentPlan.price
    };
  };

  // Get features comparison
  const getFeaturesComparison = (fromTier, toTier) => {
    const from = SUBSCRIPTION_TIERS[fromTier.toUpperCase()];
    const to = SUBSCRIPTION_TIERS[toTier.toUpperCase()];
    
    const isUpgrade = to.price > from.price;
    
    // When upgrading: only gain features (no losses)
    // When downgrading: only lose features (no gains)
    const featuresLost = isUpgrade ? [] : from.features.filter(f => !to.features.includes(f));
    const featuresGained = isUpgrade ? to.features.filter(f => !from.features.includes(f)) : [];
    
    return { featuresLost, featuresGained };
  };

  // Get currency and exchange rate based on locale
  const getCurrencyInfo = () => {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const currencyMap = {
      'en-AU': { code: 'AUD', rate: 1.50 },
      'en-GB': { code: 'GBP', rate: 0.79 },
      'en-NZ': { code: 'NZD', rate: 1.65 },
      'en-CA': { code: 'CAD', rate: 1.35 },
      'en-US': { code: 'USD', rate: 1.00 },
    };
    
    // Check for exact match first
    if (currencyMap[locale]) {
      return currencyMap[locale];
    }
    
    // Check for country match (e.g., 'en-AU' or 'en_AU')
    const country = locale.split(/[-_]/)[1]?.toUpperCase();
    const match = Object.keys(currencyMap).find(key => key.includes(country));
    
    return match ? currencyMap[match] : { code: 'USD', rate: 1.00 };
  };

  // Convert price to local currency
  const convertPrice = (usdPrice) => {
    const { code, rate } = getCurrencyInfo();
    return {
      amount: (usdPrice * rate).toFixed(2),
      currency: code,
      symbol: code === 'USD' ? '$' : code === 'AUD' ? 'A$' : code === 'GBP' ? '£' : code === 'CAD' ? 'C$' : code === 'NZD' ? 'NZ$' : '$'
    };
  };

  const value = useMemo(() => ({
    loading,
    users,
    currentUser,
    setCurrentUser,
    subscriptionTiers: SUBSCRIPTION_TIERS,
    vaults,
    collections,
    assets,
    setVaults,
    setCollections,
    setAssets,
    login,
    logout,
    resetAllData,
    register,
    updateCurrentUser,
    updateSubscription,
    setCancelAtPeriodEnd,
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
      updateSubscription,
      calculateProration,
      getFeaturesComparison,
      convertPrice,
      getCurrencyInfo,
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
