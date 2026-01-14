import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updatePassword,
  updateEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
  sendPasswordResetEmail,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firebaseAuth, firestore, isFirebaseConfigured } from './firebase';
import { API_URL, apiFetch } from './utils/apiFetch';

const DEFAULT_AVATAR = "/images/default-avatar.png";
const DEFAULT_HERO = "/images/collection_default.jpg";
const MAX_IMAGE_SIZE = 30 * 1024 * 1024; // 30MB limit per image

const VIEW_TO_PATH = {
  landing: "/",
  home: "/home",
  settings: "/settings",
  login: "/login",
  register: "/sign-up",
  vault: "/vaults",
  profile: "/profile",
};

const PATH_TO_VIEW = {
  "/": "landing",
  "/home": "home",
  "/settings": "settings",
  "/login": "login",
  "/sign-up": "register",
  "/register": "register",
  "/vaults": "vault",
  "/profile": "profile",
};

const viewToPath = (view) => VIEW_TO_PATH[view] || "/";
const pathToView = (path) => PATH_TO_VIEW[path] || "landing";

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizeUsername = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function mapFirebaseAuthError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'auth/invalid-credential') return 'Invalid credentials.';
  if (code === 'auth/user-not-found') return 'Account not found.';
  if (code === 'auth/wrong-password') return 'Invalid credentials.';
  if (code === 'auth/email-already-in-use') return 'Email already in use.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
  if (code === 'auth/requires-recent-login') return 'Please sign in again and retry.';
  return error?.message ? String(error.message) : 'Authentication failed.';
}

function safeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.warn(`Failed to parse ${key} from storage`, err);
    return fallback;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`Failed to set ${key} in storage`, err);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeImage(file, maxWidth = 900, maxHeight = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate scaling factor to fit within max dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        // Create canvas and resize
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to base64 with quality compression
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function recompressDataUrl(dataUrl, maxWidth = 900, maxHeight = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      resolve("");
      return;
    }
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function legacyRoleToPermissions(role, extra = {}) {
  const r = (role || '').toLowerCase();
  const perms = { View: true, Create: false, Edit: false, Move: false, Delete: false };
  if (r === 'editor') {
    perms.Edit = true;
  }
  if (r === 'manager') {
    perms.Edit = true;
    perms.Move = true;
  }
  if (extra && extra.canCreate) perms.Create = true;
  return perms;
}

export default function App() {
  const initialPathView = pathToView(window.location.pathname);
  const [view, setView] = useState(initialPathView);
  const [previousView, setPreviousView] = useState(null);

  const [firebaseUser, setFirebaseUser] = useState(() => firebaseAuth?.currentUser || null);
  const [currentUser, setCurrentUser] = useState(null); // /users/{uid}
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!(firebaseAuth && firebaseAuth.currentUser));

  const [users, setUsers] = useState([]); // intentionally empty: Firestore rules do not allow listing /users
  const [vaults, setVaults] = useState([]);
  const [collections, setCollections] = useState([]);
  const [assets, setAssets] = useState([]);
  const [vaultMemberships, setVaultMemberships] = useState([]);
  const [permissionGrants, setPermissionGrants] = useState([]);

  const vaultListenerUnsubsRef = useRef(new Map());

  const [selectedVaultId, setSelectedVaultId] = useState(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const initialVaultState = { name: "", description: "", manager: "", heroImage: "", images: [] };
  const [newVault, setNewVault] = useState(initialVaultState);
  const initialCollectionState = { name: "", description: "", manager: "", heroImage: "", images: [] };
  const [newCollection, setNewCollection] = useState(initialCollectionState);
  const initialAssetState = { title: "", type: "", category: "", description: "", manager: "", value: "", estimatedValue: "", rrp: "", purchasePrice: "", quantity: 1, heroImage: "", images: [] };
  const [newAsset, setNewAsset] = useState(initialAssetState);

  const categoryOptions = {
    Vehicle: ["Automobile", "Motorcycle", "Aircraft", "Watercraft", "Recreational Vehicle"],
    Property: ["Residential", "Commercial", "Land", "Farmland", "Construction"],
    Collectables: ["Watch", "Jewellery", "Art", "Antique", "Toys"],
    Business: ["Company", "Partnership", "Trust", "Co-operative", "Patent", "Trademark"],
    Materials: ["Precious Metal", "Precious Stone"],
    Specialty: ["Livestock", "Alcohol"],
    Digital: ["Cryptocurrency", "Website/Domain"],
    Equipment: [],
    Machinery: [],
    Other: ["Other"]
  };

  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const initialRegisterForm = { firstName: "", lastName: "", email: "", username: "", password: "", profileImage: DEFAULT_AVATAR };
  const [registerForm, setRegisterForm] = useState(initialRegisterForm);
  const [vaultSort, setVaultSort] = useState("newest");
  const [vaultFilter, setVaultFilter] = useState("");
  const [collectionSort, setCollectionSort] = useState("newest");
  const [collectionFilter, setCollectionFilter] = useState("");
  const [assetSort, setAssetSort] = useState("newest");
  const [assetFilter, setAssetFilter] = useState("");
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", email: "", username: "", currentPassword: "", newPassword: "", confirmPassword: "" });
  const [profileErrors, setProfileErrors] = useState({});
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [showVaultForm, setShowVaultForm] = useState(false);
  const [showCollectionForm, setShowCollectionForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [sharedMode, setSharedMode] = useState(false);
  const [sharedOwnerId, setSharedOwnerId] = useState(null);

  const [confirmDialog, setConfirmDialog] = useState({ show: false, title: "", message: "", onConfirm: null });
  const [moveDialog, setMoveDialog] = useState({ show: false, assetId: null, targetVaultId: null, targetCollectionId: null });
  const [collectionMoveDialog, setCollectionMoveDialog] = useState({ show: false, collectionId: null, targetVaultId: null });
  const [managerDialog, setManagerDialog] = useState({ show: false, type: null, id: null, username: "" });
  const [shareDialog, setShareDialog] = useState({
    show: false,
    type: 'vault',
    targetId: null,
    username: "",
    permissions: { View: true, Create: false, Edit: false, Move: false, Delete: false },
  });
  const [showShareSuggestions, setShowShareSuggestions] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  const PERMISSION_KEYS = ["View", "Create", "Edit", "Move", "Delete"];

  const normalizePermissions = (value) => {
    const base = value && typeof value === 'object' ? value : {};
    return {
      View: !!base.View,
      Create: !!base.Create,
      Edit: !!base.Edit,
      Move: !!base.Move,
      Delete: !!base.Delete,
    };
  };

  const getVaultOwnerId = (vault) => (vault ? (vault.activeOwnerId || vault.ownerId) : null);

  const getMembershipForVault = (vaultId, userId) => {
    if (!vaultId || !userId) return null;
    return vaultMemberships.find((m) => m && m.vault_id === vaultId && m.user_id === userId && m.status !== 'REVOKED') || null;
  };

  const isOwnerOfVault = (vault) => {
    if (!vault || !currentUser) return false;
    return getVaultOwnerId(vault) === currentUser.id;
  };

  const hasVaultPermission = (vault, key) => {
    if (!vault || !currentUser) return false;
    if (isOwnerOfVault(vault)) return true;
    const membership = getMembershipForVault(vault.id, currentUser.id);
    const perms = normalizePermissions(membership?.permissions);
    return !!perms[key];
  };

  const grantIdForScope = (scopeType, scopeId, uid) => `${scopeType}:${scopeId}:${uid}`;
  const getGrantForScope = (vaultId, scopeType, scopeId, userId) => {
    if (!vaultId || !scopeType || !scopeId || !userId) return null;
    const id = grantIdForScope(scopeType, scopeId, userId);
    return permissionGrants.find((g) => g && g.vault_id === vaultId && g.id === id) || null;
  };

  const hasCollectionPermission = (collection, key) => {
    if (!collection || !currentUser) return false;
    const vault = vaults.find((v) => v.id === collection.vaultId) || null;
    if (!vault) return false;
    if (isOwnerOfVault(vault)) return true;
    // Read access is membership-based in the canonical model.
    if (key === 'View') return !!getMembershipForVault(vault.id, currentUser.id);
    const grant = getGrantForScope(vault.id, 'COLLECTION', collection.id, currentUser.id);
    const grantPerms = normalizePermissions(grant?.permissions);
    if (grant && grantPerms[key]) return true;
    return hasVaultPermission(vault, key);
  };

  const hasAssetPermission = (asset, key) => {
    if (!asset || !currentUser) return false;
    const collection = collections.find((c) => c.id === asset.collectionId) || null;
    if (!collection) return false;
    const vault = vaults.find((v) => v.id === collection.vaultId) || null;
    if (!vault) return false;
    if (isOwnerOfVault(vault)) return true;
    if (key === 'View') return !!getMembershipForVault(vault.id, currentUser.id);
    const assetGrant = getGrantForScope(vault.id, 'ASSET', asset.id, currentUser.id);
    const assetPerms = normalizePermissions(assetGrant?.permissions);
    if (assetGrant && assetPerms[key]) return true;
    // Fallback to collection grant for non-asset specific ops.
    const collectionGrant = getGrantForScope(vault.id, 'COLLECTION', collection.id, currentUser.id);
    const colPerms = normalizePermissions(collectionGrant?.permissions);
    if (collectionGrant && colPerms[key]) return true;
    return hasVaultPermission(vault, key);
  };

  const upsertVaultMembership = async (vaultId, userId, permissions) => {
    const now = Date.now();
    await setDoc(
      doc(db, 'vaults', String(vaultId), 'memberships', String(userId)),
      {
        user_id: String(userId),
        vault_id: String(vaultId),
        role: 'DELEGATE',
        status: 'ACTIVE',
        permissions: normalizePermissions({ View: true, ...permissions }),
        assigned_at: now,
        revoked_at: null,
      },
      { merge: true }
    );
  };

  const revokeVaultMembership = async (vaultId, userId) => {
    const now = Date.now();
    await setDoc(
      doc(db, 'vaults', String(vaultId), 'memberships', String(userId)),
      { status: 'REVOKED', revoked_at: now },
      { merge: true }
    );
  };

  const upsertPermissionGrant = async (vaultId, scopeType, scopeId, userId, permissions) => {
    const id = grantIdForScope(scopeType, scopeId, userId);
    const now = Date.now();
    await setDoc(
      doc(db, 'vaults', String(vaultId), 'permissionGrants', String(id)),
      {
        id,
        vault_id: String(vaultId),
        user_id: String(userId),
        scope_type: String(scopeType),
        scope_id: String(scopeId),
        permissions: normalizePermissions({ View: true, ...permissions }),
        assigned_at: now,
      },
      { merge: true }
    );
  };

  const revokePermissionGrant = async (vaultId, scopeType, scopeId, userId) => {
    const id = grantIdForScope(scopeType, scopeId, userId);
    await deleteDoc(doc(db, 'vaults', String(vaultId), 'permissionGrants', String(id)));
  };

  const updateAccessPermissionForUser = (userId, key, value) => {
    if (!userId) return;
    if (!PERMISSION_KEYS.includes(key)) return;
    if (key === 'View') return; // always true for delegates/grants

    if (shareDialog.type === 'vault') {
      const vaultId = shareDialog.targetId;
      const existing = vaultMemberships.find((m) => m && m.vault_id === vaultId && m.user_id === userId) || null;
      const perms = normalizePermissions(existing?.permissions);
      upsertVaultMembership(vaultId, userId, { ...perms, [key]: !!value }).catch(() => {});
      return;
    }

    if (shareDialog.type === 'collection') {
      const collection = collections.find((c) => c && c.id === shareDialog.targetId) || null;
      if (!collection) return;
      const vaultId = collection.vaultId;
      const existing = getGrantForScope(vaultId, 'COLLECTION', collection.id, userId);
      const perms = normalizePermissions(existing?.permissions);
      upsertPermissionGrant(vaultId, 'COLLECTION', collection.id, userId, { ...perms, [key]: !!value }).catch(() => {});
      return;
    }

    if (shareDialog.type === 'asset') {
      const asset = assets.find((a) => a && a.id === shareDialog.targetId) || null;
      if (!asset) return;
      const collection = collections.find((c) => c && c.id === asset.collectionId) || null;
      if (!collection) return;
      const vaultId = collection.vaultId;
      const existing = getGrantForScope(vaultId, 'ASSET', asset.id, userId);
      const perms = normalizePermissions(existing?.permissions);
      upsertPermissionGrant(vaultId, 'ASSET', asset.id, userId, { ...perms, [key]: !!value }).catch(() => {});
    }
  };
  const [viewAsset, setViewAsset] = useState(null);
  const [viewAssetDraft, setViewAssetDraft] = useState(initialAssetState);
  const [imageViewer, setImageViewer] = useState({ show: false, images: [], currentIndex: 0 });
  const [editDialog, setEditDialog] = useState({ show: false, type: null, item: null, name: "", description: "", manager: "", images: [], heroImage: "" });

  // LocalStorage migration removed: Firestore is canonical.

  const openShareDialog = (type, target) => {
    setShareDialog({
      show: true,
      type: type || 'vault',
      targetId: target?.id || null,
      username: "",
      permissions: { View: true, Create: false, Edit: false, Move: false, Delete: false },
    });
    setShowShareSuggestions(false);
  };

  const openManagerDialog = (type, item) => {
    setManagerDialog({ show: true, type, id: item.id, username: item.manager || "" });
    setShowShareSuggestions(false);
  };

  const closeManagerDialog = () => setManagerDialog({ show: false, type: null, id: null, username: "" });

  const handleManagerConfirm = () => {
    const managerName = (managerDialog.username || '').trim();
    if (!managerName) return showAlert("Enter a manager name.");
    (async () => {
      try {
        if (managerDialog.type === 'vault') {
          await updateDoc(doc(db, 'vaults', String(managerDialog.id)), { manager: managerName, editedAt: Date.now() });
        } else if (managerDialog.type === 'collection') {
          const col = collections.find(c => c && c.id === managerDialog.id) || null;
          if (!col?.vaultId) throw new Error('Missing vaultId');
          await updateDoc(doc(db, 'vaults', String(col.vaultId), 'collections', String(col.id)), { manager: managerName, editedAt: Date.now() });
        } else if (managerDialog.type === 'asset') {
          const a = assets.find(a => a && a.id === managerDialog.id) || null;
          const vaultId = a?.vaultId || getVaultForAsset(a)?.id || null;
          if (!vaultId || !a?.id) throw new Error('Missing vaultId');
          await updateDoc(doc(db, 'vaults', String(vaultId), 'assets', String(a.id)), { manager: managerName, editedAt: Date.now() });
        }
        showAlert(`Assigned manager ${managerName}`);
        closeManagerDialog();
      } catch (err) {
        showAlert(err?.message ? String(err.message) : 'Failed to assign manager.');
      }
    })();
  };

  const closeShareDialog = () => {
    setShareDialog({
      show: false,
      type: 'vault',
      targetId: null,
      username: "",
      permissions: { View: true, Create: false, Edit: false, Move: false, Delete: false },
    });
    setShowShareSuggestions(false);
  };

  const [vaultInvitations, setVaultInvitations] = useState([]);
  const [vaultInvitationsLoading, setVaultInvitationsLoading] = useState(false);
  const [vaultInvitationsError, setVaultInvitationsError] = useState('');

  const loadVaultInvitations = async (vaultId) => {
    if (!vaultId) return;
    if (!API_URL) throw new Error('Missing REACT_APP_API_URL.');
    setVaultInvitationsLoading(true);
    setVaultInvitationsError('');
    try {
      const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(String(vaultId))}/invitations`, { method: 'GET' });
      const invitations = Array.isArray(resp?.invitations) ? resp.invitations : [];
      setVaultInvitations(invitations);
    } catch (err) {
      setVaultInvitations([]);
      setVaultInvitationsError(err?.message ? String(err.message) : 'Failed to load invitations');
    } finally {
      setVaultInvitationsLoading(false);
    }
  };

  const revokeVaultInvitation = async (vaultId, code) => {
    if (!vaultId || !code) return;
    if (!API_URL) throw new Error('Missing REACT_APP_API_URL.');
    await apiFetch(`${API_URL}/vaults/${encodeURIComponent(String(vaultId))}/invitations/${encodeURIComponent(String(code))}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setVaultInvitations((prev) => (prev || []).map((i) => (i?.id === code ? { ...i, status: 'REVOKED', revokedAt: Date.now() } : i)));
  };

  const resolveUserForVault = async (vaultId, queryValue) => {
    if (!vaultId) throw new Error('Missing vaultId');
    const query = typeof queryValue === 'string' ? queryValue.trim() : '';
    if (!query) throw new Error('Missing user identifier');
    if (!API_URL) throw new Error('Missing REACT_APP_API_URL.');
    const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(String(vaultId))}/users/resolve`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    const uid = resp?.user?.uid ? String(resp.user.uid) : null;
    if (!uid) throw new Error('User not found');
    return uid;
  };

  useEffect(() => {
    if (!shareDialog?.show) {
      setVaultInvitations([]);
      setVaultInvitationsError('');
      setVaultInvitationsLoading(false);
      return;
    }

    if (shareDialog.type !== 'vault') return;
    if (!shareDialog.targetId) return;
    // Invitations are a paid feature; load errors are rendered in the dialog.
    loadVaultInvitations(shareDialog.targetId).catch(() => {});
  }, [shareDialog.show, shareDialog.type, shareDialog.targetId]);

  const handleShareConfirm = () => {
    const rawTarget = (shareDialog.username || '').trim();
    if (!rawTarget) {
      if (shareDialog.type === 'vault') return showAlert("Enter an email address to invite.");
      return showAlert("Enter a member uid/email/username to share with.");
    }

    const permissions = normalizePermissions(shareDialog.permissions);
    (async () => {
      try {
        if (shareDialog.type === 'vault') {
          const vault = vaults.find((v) => v.id === shareDialog.targetId) || null;
          if (!vault) return;
          const email = normalizeEmail(rawTarget);
          if (!email || !email.includes('@')) throw new Error('Enter a valid email address.');
          if (!API_URL) throw new Error('Missing REACT_APP_API_URL.');
          const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(String(vault.id))}/invitations`, {
            method: 'POST',
            body: JSON.stringify({ email }),
          });
          showAlert(`Invitation sent to ${email}`);
          if (resp?.invitation) {
            setVaultInvitations((prev) => {
              const next = Array.isArray(prev) ? [...prev] : [];
              const id = resp.invitation?.id || resp.code;
              if (!id) return next;
              const existing = next.find((i) => i && i.id === id);
              if (existing) return next;
              return [{ id, ...(resp.invitation || {}) }, ...next];
            });
          } else {
            loadVaultInvitations(String(vault.id)).catch(() => {});
          }
        } else if (shareDialog.type === 'collection') {
          const collection = collections.find((c) => c.id === shareDialog.targetId) || null;
          if (!collection) return;
          let userId = String(rawTarget);
          const looksLikeEmail = userId.includes('@');
          const looksLikeUsername = userId.includes(' ') || userId.length < 20;
          if (looksLikeEmail || looksLikeUsername) {
            userId = await resolveUserForVault(String(collection.vaultId), userId);
          }
          if (currentUser && userId === currentUser.id) throw new Error('You cannot share with yourself.');
          if (!getMembershipForVault(String(collection.vaultId), userId)) {
            throw new Error('User must already be a vault member.');
          }
          await upsertPermissionGrant(String(collection.vaultId), 'COLLECTION', String(collection.id), String(userId), permissions);
          showAlert(`Granted collection access to ${userId}`);
        } else if (shareDialog.type === 'asset') {
          const asset = assets.find((a) => a.id === shareDialog.targetId) || null;
          if (!asset) return;
          const vaultId = asset.vaultId || getVaultForAsset(asset)?.id || null;
          if (!vaultId) return;
          let userId = String(rawTarget);
          const looksLikeEmail = userId.includes('@');
          const looksLikeUsername = userId.includes(' ') || userId.length < 20;
          if (looksLikeEmail || looksLikeUsername) {
            userId = await resolveUserForVault(String(vaultId), userId);
          }
          if (currentUser && userId === currentUser.id) throw new Error('You cannot share with yourself.');
          if (!getMembershipForVault(String(vaultId), userId)) {
            throw new Error('User must already be a vault member.');
          }
          await upsertPermissionGrant(String(vaultId), 'ASSET', String(asset.id), String(userId), permissions);
          showAlert(`Granted asset access to ${userId}`);
        }

        setShareDialog((d) => ({ ...d, username: "" }));
        setShowShareSuggestions(false);
      } catch (err) {
        showAlert(err?.message ? String(err.message) : 'Failed to share.');
      }
    })();
  };

  const [alert, setAlert] = useState("");
  const alertTimeoutRef = useRef(null);

  const db = firestore;

  // Keep view protected routes aligned with Auth state.
  useEffect(() => {
    const next = pathToView(window.location.pathname);
    if ((next === 'vault' || next === 'profile') && !isLoggedIn) {
      setView('login');
      return;
    }
    setView(next);
  }, []);

  // Firebase Auth -> current user profile.
  useEffect(() => {
    if (!firebaseAuth || !isFirebaseConfigured()) return;
    const unsub = onAuthStateChanged(firebaseAuth, (user) => {
      setFirebaseUser(user || null);
      setIsLoggedIn(!!user);
      if (!user) {
        setCurrentUser(null);
        setVaults([]);
        setCollections([]);
        setAssets([]);
        setVaultMemberships([]);
        setPermissionGrants([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!db || !firebaseUser) return;
    const unsub = onSnapshot(doc(db, 'users', firebaseUser.uid), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      if (!data) {
        setCurrentUser({
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          username: firebaseUser.email || '',
          firstName: '',
          lastName: '',
          prefersDarkMode: false,
        });
        return;
      }
      setCurrentUser({ id: firebaseUser.uid, ...data });
    });
    return () => unsub();
  }, [db, firebaseUser]);

  // NOTE: We intentionally do not subscribe to `/users`.
  // Firestore rules only allow reading your own `/users/{uid}` doc.
  useEffect(() => {
    setUsers([]);
  }, []);

  // Subscribe to accessible vaults via owned vaults + membership collection group.
  useEffect(() => {
    if (!db || !firebaseUser) return;
    const uid = firebaseUser.uid;

    let ownedVaultIds = [];
    let memberVaultIds = [];
    let vaultUnsub = null;
    let memberUnsub = null;

    const reconcileVaultListeners = () => {
      const ids = Array.from(new Set([...(ownedVaultIds || []), ...(memberVaultIds || [])].filter(Boolean)));

      // Tear down listeners for removed vaults.
      for (const [vaultId, unsubs] of vaultListenerUnsubsRef.current.entries()) {
        if (!ids.includes(vaultId)) {
          try {
            (unsubs || []).forEach((fn) => {
              try { fn(); } catch (e) {}
            });
          } finally {
            vaultListenerUnsubsRef.current.delete(vaultId);
          }
        }
      }

      // Create listeners for new vaults.
      ids.forEach((vaultId) => {
        if (vaultListenerUnsubsRef.current.has(vaultId)) return;

        const unsubs = [];

        unsubs.push(
          onSnapshot(doc(db, 'vaults', vaultId), (snap) => {
            if (!snap.exists()) {
              setVaults((prev) => (prev || []).filter((v) => v.id !== vaultId));
              return;
            }
            const v = { id: snap.id, ...snap.data() };
            setVaults((prev) => {
              const next = Array.isArray(prev) ? [...prev] : [];
              const idx = next.findIndex((x) => x && x.id === v.id);
              if (idx >= 0) next[idx] = { ...next[idx], ...v };
              else next.push(v);
              return next;
            });
          })
        );

        unsubs.push(
          onSnapshot(collection(db, 'vaults', vaultId, 'collections'), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setCollections((prev) => {
              const keep = (prev || []).filter((c) => c && c.vaultId !== vaultId);
              return [...keep, ...rows];
            });
          })
        );

        unsubs.push(
          onSnapshot(collection(db, 'vaults', vaultId, 'assets'), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setAssets((prev) => {
              const keep = (prev || []).filter((a) => {
                const aVaultId = a?.vaultId ? String(a.vaultId) : null;
                if (!aVaultId) return true;
                return aVaultId !== String(vaultId);
              });
              return [...keep, ...rows];
            });
          })
        );

        unsubs.push(
          onSnapshot(collection(db, 'vaults', vaultId, 'memberships'), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setVaultMemberships((prev) => {
              const keep = (prev || []).filter((m) => m && m.vault_id !== vaultId);
              return [...keep, ...rows];
            });
          })
        );

        unsubs.push(
          onSnapshot(collection(db, 'vaults', vaultId, 'permissionGrants'), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setPermissionGrants((prev) => {
              const keep = (prev || []).filter((g) => g && g.vault_id !== vaultId);
              return [...keep, ...rows];
            });
          })
        );

        vaultListenerUnsubsRef.current.set(vaultId, unsubs);
      });
    };

    vaultUnsub = onSnapshot(query(collection(db, 'vaults'), where('activeOwnerId', '==', uid)), (snap) => {
      ownedVaultIds = snap.docs.map((d) => d.id);
      reconcileVaultListeners();
    });

    memberUnsub = onSnapshot(
      query(collectionGroup(db, 'memberships'), where('user_id', '==', uid), where('status', '==', 'ACTIVE')),
      (snap) => {
        memberVaultIds = snap.docs.map((d) => d.data()?.vault_id).filter(Boolean);
        reconcileVaultListeners();
      }
    );

    return () => {
      try { if (vaultUnsub) vaultUnsub(); } catch (e) {}
      try { if (memberUnsub) memberUnsub(); } catch (e) {}
      // Tear down all per-vault listeners.
      for (const [, unsubs] of vaultListenerUnsubsRef.current.entries()) {
        try {
          (unsubs || []).forEach((fn) => {
            try { fn(); } catch (e) {}
          });
        } catch (e) {}
      }
      vaultListenerUnsubsRef.current.clear();
    };
  }, [db, firebaseUser]);

  // Tutorial / onboarding state
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialRect, setTutorialRect] = useState(null);
  const tutorialTargets = ["vault-list", "collection-list", "assets-panel", "asset-list", "back-button"];
  const tutorialMessages = [
    "This column shows your Vaults — select one to view its Collections.",
    "This column shows Collections — select one to view its Assets.",
    "You clicked a Collection — the view switched to Collections and Assets.",
    "This column shows Assets — open one to view and edit details.",
    "If you want to go back to Vaults, click this Back button."
  ];

  const showAlert = (message, duration = 2400) => {
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
    setAlert(message);
    if (message) {
      alertTimeoutRef.current = setTimeout(() => setAlert(""), duration);
    }
  };

  const updateTutorialRect = (targetKey) => {
    try {
      const el = document.querySelector(`[data-tut="${targetKey}"]`);
      if (!el) {
        setTutorialRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTutorialRect({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height });
    } catch (err) {
      setTutorialRect(null);
    }
  };

  // Poll for the target element for a short timeout so tutorial works even if DOM is still rendering
  const ensureTutorialRect = (targetKey, timeout = 2000, interval = 150) => {
    if (!targetKey) return;
    let elapsed = 0;
    updateTutorialRect(targetKey);
    if (tutorialRect) return;
    const id = setInterval(() => {
      try {
        const el = document.querySelector(`[data-tut="${targetKey}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          setTutorialRect({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height });
          clearInterval(id);
          return;
        }
      } catch (e) {
        // ignore
      }
      elapsed += interval;
      if (elapsed >= timeout) {
        clearInterval(id);
        // leave tutorialRect null so UI shows preparing message
      }
    }, interval);
  };

  const nextTutorial = () => {
    const next = tutorialStep + 1;
    if (next >= tutorialTargets.length) {
      // finish
      if (currentUser) {
        try { localStorage.setItem(`tutorialShown_${currentUser.id}`, "true"); } catch (e) {}
      }
      setShowTutorial(false);
      setTutorialStep(0);
      setTutorialRect(null);
      return;
    }
    // If advancing to the Collection step, open the first vault so collections are visible
    if (next === 1) {
      try {
        const firstVault = (typeof sortedVaults !== 'undefined' && sortedVaults && sortedVaults.length > 0) ? sortedVaults[0] : null;
        if (firstVault) {
          handleSelectVault(firstVault.id);
          // delay a bit to allow collections to render, then move spotlight
          setTimeout(() => {
            setTutorialStep(next);
            ensureTutorialRect("collection-list");
          }, 220);
          return;
        }
      } catch (err) {
        // ignore and proceed
      }
    }

    // If advancing to the assets-panel step, auto-select the first collection in the current vault
    if (next === 2) {
      try {
        const vaultId = selectedVaultId || (sortedVaults && sortedVaults[0] && sortedVaults[0].id);
        const firstCollection = collections.find((c) => c.vaultId === vaultId);
        if (firstCollection && !selectedCollectionId) {
          handleSelectCollection(firstCollection.id);
          setTimeout(() => {
            setTutorialStep(next);
            ensureTutorialRect("assets-panel");
          }, 220);
          return;
        }
      } catch (e) {
        // ignore
      }
    }
    setTutorialStep(next);
    // ensure spotlight updates for the newly selected step
    setTimeout(() => {
      try { ensureTutorialRect(tutorialTargets[next]); } catch (e) { /* ignore */ }
    }, 160);
  };

  // Permission helpers (canonical): memberships/grants with View/Create/Edit/Move/Delete
  const canCreateCollectionInVault = (vault) => hasVaultPermission(vault, 'Create');
  const canEditVaultDoc = (vault) => isOwnerOfVault(vault);
  const canDeleteVault = (vault) => isOwnerOfVault(vault);

  const getVaultForCollection = (collection) => (collection ? vaults.find(v => v.id === collection.vaultId) || null : null);
  const getVaultForAsset = (asset) => {
    const col = asset ? collections.find(c => c.id === asset.collectionId) : null;
    return col ? vaults.find(v => v.id === col.vaultId) || null : null;
  };

  const canCreateAssetInCollection = (collection) => {
    if (!collection) return false;
    const vault = getVaultForCollection(collection);
    if (!vault) return false;
    return hasCollectionPermission(collection, 'Create') || hasVaultPermission(vault, 'Create');
  };

  const skipTutorial = () => {
    if (currentUser) {
      try { localStorage.setItem(`tutorialShown_${currentUser.id}`, "true"); } catch (e) {}
    }
    setShowTutorial(false);
    setTutorialStep(0);
    setTutorialRect(null);
  };

  // Format number with commas for thousands separators
  const formatCurrency = (value) => {
    if (!value && value !== 0) return "";
    const num = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
    if (isNaN(num)) return "";
    return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  // Parse formatted currency string to number
  const parseCurrency = (value) => {
    if (!value) return "";
    return value.replace(/,/g, "");
  };

  const ensureDefaultVaultForUser = () => null;

  const openEditVault = (vault) => setEditDialog({ show: true, type: "vault", item: vault, name: vault.name, description: vault.description || "", manager: vault.manager || "", images: vault.images || [], heroImage: vault.heroImage || "" });
  const openEditCollection = (collection) => setEditDialog({ show: true, type: "collection", item: collection, name: collection.name, description: collection.description || "", manager: collection.manager || "", images: collection.images || [], heroImage: collection.heroImage || "" });
  const closeEditDialog = () => setEditDialog({ show: false, type: null, item: null, name: "", description: "" });

  const saveEditDialog = () => {
    const name = (editDialog.name || "").trim();
    if (!name) {
      showAlert("Name is required.");
      return;
    }
    (async () => {
      try {
        if (editDialog.type === "vault" && editDialog.item) {
          // enforce vault-level edit permission
          const vault = editDialog.item;
          if (!canEditVaultDoc(vault)) {
            showAlert("You don't have permission to edit this vault.");
            closeEditDialog();
            return;
          }
          const description = (editDialog.description || "").trim();
          const manager = (editDialog.manager || "").trim();
          const images = trimToFour(editDialog.images || []);
          const heroImage = editDialog.heroImage || images[0] || DEFAULT_HERO;
          await updateDoc(doc(db, 'vaults', String(vault.id)), {
            name,
            description,
            manager,
            images,
            heroImage,
            editedAt: Date.now(),
          });
        }

        if (editDialog.type === "collection" && editDialog.item) {
          if (!hasCollectionPermission(editDialog.item, 'Edit')) {
            showAlert("You don't have permission to edit this collection.");
            closeEditDialog();
            return;
          }
          const c = editDialog.item;
          const description = (editDialog.description || "").trim();
          const manager = (editDialog.manager || "").trim();
          const images = trimToFour(editDialog.images || []);
          const heroImage = editDialog.heroImage || images[0] || DEFAULT_HERO;
          await updateDoc(doc(db, 'vaults', String(c.vaultId), 'collections', String(c.id)), {
            name,
            description,
            manager,
            images,
            heroImage,
            editedAt: Date.now(),
          });
        }

        closeEditDialog();
        showAlert("Updated.");
      } catch (err) {
        showAlert(err?.message ? String(err.message) : 'Failed to update.');
      }
    })();
  };

  useEffect(() => () => {
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
  }, []);

  const navigateTo = (nextView, { replace = false } = {}) => {
    // if user asked for the shared shortcut, open the shared-owner picker first
    if (nextView === "shared") {
      setSharedMode(false);
      setSharedOwnerId(null);
      const nextPath = "/shared-vaults";
      if (replace) {
        window.history.replaceState(null, "", nextPath);
      } else {
        window.history.pushState(null, "", nextPath);
      }
      setView("sharedPicker");
      return;
    } else if (nextView !== "vault") {
      // leaving the vault view clears shared mode
      setSharedMode(false);
      setSharedOwnerId(null);
    }
    // record previous view for back navigation
    try { setPreviousView(view); } catch (e) {}
    // Prevent non-logged-in users from accessing protected pages
    if ((nextView === "vault" || nextView === "profile") && !isLoggedIn) {
      const nextPath = viewToPath("login");
      if (replace) {
        window.history.replaceState(null, "", nextPath);
      } else {
        window.history.pushState(null, "", nextPath);
      }
      setView("login");
      return;
    }
    // Redirect logged-in users away from auth pages to vault
    if ((nextView === "login" || nextView === "register") && isLoggedIn) {
      const nextPath = viewToPath("vault");
      if (replace) {
        window.history.replaceState(null, "", nextPath);
      } else {
        window.history.pushState(null, "", nextPath);
      }
      setView("vault");
      return;
    }
    const nextPath = viewToPath(nextView);
    if (replace) {
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.pushState(null, "", nextPath);
    }
    setView(nextView);
  };

  const goBack = () => {
    // If we're in the Vault view, implement contextual back behavior:
    // - If a collection is selected (Collections and Assets view), deselect it
    //   to return to the Vaults list view.
    // - If no collection is selected (Vaults and Collections page), go to Home.
    if (view === "vault") {
      if (selectedCollectionId) {
        setSelectedCollectionId(null);
        setShowCollectionForm(false);
        setShowAssetForm(false);
        return;
      }
      navigateTo("home");
      return;
    }

    if (previousView && previousView !== view) {
      navigateTo(previousView);
      return;
    }
    try {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    } catch (e) {}
    navigateTo("home");
  };

  const logout = async () => {
    try {
      if (firebaseAuth) await signOut(firebaseAuth);
    } catch (e) {
      // ignore
    }
    setSelectedVaultId(null);
    setSelectedCollectionId(null);
    setShowVaultForm(false);
    setShowCollectionForm(false);
    setShowAssetForm(false);
    navigateTo("landing", { replace: true });
  };

  const createExampleDataForUser = async ({ uid, username }) => {
    if (!db || !uid) return null;

    // If the user previously deleted their default example vault, don't recreate it.
    try {
      const deletedFlag = localStorage.getItem(`defaultVaultDeleted_${uid}`);
      if (deletedFlag === "true") return null;
    } catch (e) {}

    // Only create if the user has no owned vaults.
    const ownedSnap = await getDocs(query(collection(db, 'vaults'), where('activeOwnerId', '==', String(uid)), limit(1)));
    if (!ownedSnap.empty) return ownedSnap.docs[0].id;

    const now = Date.now();
    const vaultId = `v${Date.now()}`;
    const collectionId = `c${Date.now() + 1}`;
    const assetId = `a${Date.now() + 2}`;

    const batch = writeBatch(db);

    batch.set(
      doc(db, 'vaults', vaultId),
      {
        id: vaultId,
        name: 'Example Vault',
        description: 'Your first vault for organizing collections',
        activeOwnerId: String(uid),
        ownerId: String(uid),
        createdBy: String(uid),
        createdAt: now,
        viewedAt: now,
        editedAt: now,
        isDefault: true,
        images: [],
        heroImage: DEFAULT_HERO,
      },
      { merge: true }
    );
    batch.set(
      doc(db, 'vaults', vaultId, 'memberships', String(uid)),
      {
        user_id: String(uid),
        vault_id: vaultId,
        role: 'OWNER',
        permissions: null,
        status: 'ACTIVE',
        assigned_at: now,
        revoked_at: null,
      },
      { merge: true }
    );

    batch.set(
      doc(db, 'vaults', vaultId, 'collections', collectionId),
      {
        id: collectionId,
        ownerId: String(uid),
        createdBy: String(uid),
        vaultId,
        name: 'Example Collection',
        description: 'Your first collection for storing assets',
        isDefault: true,
        createdAt: now,
        viewedAt: now,
        editedAt: now,
        images: [],
        heroImage: DEFAULT_HERO,
      },
      { merge: true }
    );

    batch.set(
      doc(db, 'vaults', vaultId, 'assets', assetId),
      {
        id: assetId,
        ownerId: String(uid),
        createdBy: String(uid),
        vaultId,
        collectionId,
        title: 'Example Asset',
        type: 'Asset',
        category: 'Example',
        description: 'This is an example asset to get you started',
        manager: username || '',
        quantity: 1,
        value: 1000,
        createdAt: now,
        viewedAt: now,
        editedAt: now,
        images: [],
        heroImage: DEFAULT_HERO,
      },
      { merge: true }
    );

    await batch.commit();
    return vaultId;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!isFirebaseConfigured()) {
      showAlert('Firebase is not configured. Set REACT_APP_FIREBASE_* env vars.');
      return;
    }
    const identifier = (loginForm.username || '').trim();
    const password = (loginForm.password || '').trim();
    if (!identifier || !password) {
      showAlert('Please enter your email/username and password.');
      return;
    }

    let email = identifier;
    if (!identifier.includes('@')) {
      const match = (users || []).find((u) => normalizeUsername(u?.username) === normalizeUsername(identifier));
      if (!match?.email) {
        showAlert('Enter your email to sign in.');
        return;
      }
      email = match.email;
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, normalizeEmail(email), password);
      setSelectedVaultId(null);
      setSelectedCollectionId(null);
      setShowVaultForm(false);
      setShowCollectionForm(false);
      setShowAssetForm(false);
      navigateTo('home');
    } catch (error) {
      showAlert(mapFirebaseAuthError(error));
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!isFirebaseConfigured()) {
      showAlert('Firebase is not configured. Set REACT_APP_FIREBASE_* env vars.');
      return;
    }

    const firstName = registerForm.firstName.trim();
    const lastName = registerForm.lastName.trim();
    const email = registerForm.email.trim();
    const username = registerForm.username.trim();
    const password = registerForm.password.trim();

    if (!firstName || !lastName || !email || !username || !password) {
      showAlert("Please fill in all fields.");
      return;
    }
    if (!email.includes("@")) {
      showAlert("Enter a valid email.");
      return;
    }

    // Firestore rules only allow reading your own /users/{uid} doc; we cannot
    // reliably pre-check username/email uniqueness here.

    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, normalizeEmail(email), password);
      const uid = String(cred?.user?.uid || '');
      if (!uid) {
        showAlert('Registration failed.');
        return;
      }

      const now = Date.now();
      await setDoc(
        doc(db, 'users', uid),
        {
          user_id: uid,
          email: normalizeEmail(email),
          username,
          firstName,
          lastName,
          prefersDarkMode: false,
          profileImage: registerForm.profileImage || DEFAULT_AVATAR,
          createdAt: now,
        },
        { merge: true }
      );

      await createExampleDataForUser({ uid, username });

      setSelectedVaultId(null);
      setSelectedCollectionId(null);
      setShowVaultForm(false);
      setShowCollectionForm(false);
      setShowAssetForm(false);
      navigateTo('home');
      setRegisterForm(initialRegisterForm);
    } catch (error) {
      showAlert(mapFirebaseAuthError(error));
    }
  };

    useEffect(() => {
      let isMounted = true;
      const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
      const url = `${base}/version.json` || '/version.json';

      fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isMounted && data?.version) {
            setAppVersion(data.version);
          }
        })
        .catch(() => {
          if (isMounted) setAppVersion("");
        });

      return () => {
        isMounted = false;
      };
    }, []);

  // Start tutorial for users who haven't seen it yet — only when viewing Vaults
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    if (view !== "vault") return; // don't auto-start on Home or other pages
    try {
      const seen = localStorage.getItem(`tutorialShown_${currentUser.id}`);
      if (!seen) {
        // small delay so DOM settles
        setTimeout(() => {
          setShowTutorial(true);
          setTutorialStep(0);
        }, 800);
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [isLoggedIn, currentUser, view]);

  // Update spotlight rect when step changes or on resize/scroll
  useEffect(() => {
    if (!showTutorial) return;
    const key = tutorialTargets[tutorialStep];
    ensureTutorialRect(key);
    const handler = () => ensureTutorialRect(key);
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler);
    };
  }, [showTutorial, tutorialStep]);

  useEffect(() => {
    if (view === "register") {
      setRegisterForm(initialRegisterForm);
    }
  }, [view]);

  useEffect(() => {
    if (currentUser) {
      setProfileForm({
        firstName: currentUser.firstName || "",
        lastName: currentUser.lastName || "",
        email: currentUser.email || "",
        username: currentUser.username || "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setProfileErrors({});
      setIsEditingProfile(false);
      setIsChangingPassword(false);

      const defaultVault = vaults.find((v) => getVaultOwnerId(v) === currentUser.id && v.isDefault);
      if (defaultVault && !selectedVaultId) {
        setSelectedVaultId(defaultVault.id);
      }
    }
  }, [currentUser, vaults, selectedVaultId]);

  useEffect(() => {
    const handlePopState = () => {
      const next = pathToView(window.location.pathname);
      if ((next === "vault" || next === "profile") && !isLoggedIn) {
        navigateTo("login", { replace: true });
        return;
      }
      setView(next);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isLoggedIn]);

  const handleAddVault = async () => {
    // Block vault creation while viewing shared vaults
    if (sharedMode) {
      showAlert("You can't create a vault while viewing a shared vault.");
      return false;
    }
    if (!newVault.name.trim()) {
      showAlert("Vault name is required.");
      return false;
    }
    if (!currentUser || !firebaseUser?.uid) return false;
    const images = trimToFour(newVault.images || []);
    const heroImage = newVault.heroImage || images[0] || DEFAULT_HERO;

    try {
      const now = Date.now();
      const uid = String(firebaseUser.uid);
      const vaultId = `v${Date.now()}`;
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'vaults', vaultId),
        {
          id: vaultId,
          name: newVault.name.trim(),
          description: newVault.description.trim(),
          manager: (newVault.manager || '').trim(),
          activeOwnerId: uid,
          ownerId: uid,
          createdBy: uid,
          createdAt: now,
          viewedAt: now,
          editedAt: now,
          isDefault: false,
          images,
          heroImage,
        },
        { merge: true }
      );
      batch.set(
        doc(db, 'vaults', vaultId, 'memberships', uid),
        {
          user_id: uid,
          vault_id: vaultId,
          role: 'OWNER',
          permissions: null,
          status: 'ACTIVE',
          assigned_at: now,
          revoked_at: null,
        },
        { merge: true }
      );
      await batch.commit();
      setNewVault(initialVaultState);
      setSelectedVaultId(vaultId);
      return true;
    } catch (err) {
      showAlert(err?.message ? String(err.message) : 'Failed to create vault.');
      return false;
    }
  };

  const handleAddCollection = async () => {
    if (!selectedVaultId) {
      showAlert("Select a vault first.");
      return false;
    }
    if (!newCollection.name.trim()) {
      showAlert("Collection name is required.");
      return false;
    }
    if (!currentUser || !firebaseUser?.uid) return false;
    const images = trimToFour(newCollection.images || []);
    const heroImage = newCollection.heroImage || images[0] || DEFAULT_HERO;
    
    
    
    const vault = vaults.find(v => v.id === selectedVaultId) || null;
    if (!vault) {
      showAlert("Select a vault first.");
      return false;
    }
    if (!canCreateCollectionInVault(vault)) {
      showAlert("You don't have permission to create a collection in this vault.");
      return false;
    }

    const ownerId = getVaultOwnerId(vault);
    try {
      const now = Date.now();
      const uid = String(firebaseUser.uid);
      const collectionId = `c${Date.now()}`;
      await setDoc(
        doc(db, 'vaults', String(selectedVaultId), 'collections', collectionId),
        {
          id: collectionId,
          vaultId: String(selectedVaultId),
          ownerId: ownerId ? String(ownerId) : uid,
          createdBy: uid,
          name: newCollection.name.trim(),
          description: newCollection.description.trim(),
          manager: (newCollection.manager || '').trim(),
          isDefault: false,
          createdAt: now,
          viewedAt: now,
          editedAt: now,
          images,
          heroImage,
        },
        { merge: true }
      );
      setNewCollection(initialCollectionState);
      setSelectedCollectionId(collectionId);
      return true;
    } catch (err) {
      showAlert(err?.message ? String(err.message) : 'Failed to create collection.');
      return false;
    }
  };

  const handleAddAsset = async () => {
    if (!selectedCollectionId) {
      showAlert("Select a collection first.");
      return false;
    }
    if (!newAsset.title.trim()) {
      showAlert("Asset title is required.");
      return false;
    }
    if (!newAsset.type.trim()) {
      showAlert("Asset type is required.");
      return false;
    }
    if (!newAsset.category.trim()) {
      showAlert("Asset category is required.");
      return false;
    }
    if (!currentUser) {
      showAlert("Please log in again.");
      return false;
    }

    const images = trimToFour(newAsset.images || []);
    const heroImage = newAsset.heroImage || images[0] || DEFAULT_HERO;

    const collection = collections.find(c => c.id === selectedCollectionId) || null;
    if (!collection) return false;
    if (!canCreateAssetInCollection(collection)) {
      showAlert("You don't have permission to create an asset in this collection.");
      return false;
    }
    const vault = getVaultForCollection(collection);
    const ownerId = getVaultOwnerId(vault);

    try {
      const now = Date.now();
      const uid = String(firebaseUser.uid);
      const vaultId = String(collection.vaultId);
      const assetId = `a${Date.now()}`;

      await setDoc(
        doc(db, 'vaults', vaultId, 'assets', assetId),
        {
          id: assetId,
          vaultId,
          ownerId: ownerId ? String(ownerId) : uid,
          createdBy: uid,
          collectionId: String(selectedCollectionId),
          title: newAsset.title.trim(),
          type: newAsset.type.trim(),
          category: newAsset.category.trim(),
          description: newAsset.description.trim(),
          manager: (newAsset.manager || '').trim(),
          value: parseFloat(newAsset.value) || 0,
          estimatedValue: parseFloat(newAsset.estimatedValue) || 0,
          rrp: parseFloat(newAsset.rrp) || 0,
          purchasePrice: parseFloat(newAsset.purchasePrice) || 0,
          quantity: parseInt(newAsset.quantity) || 1,
          images,
          heroImage,
          createdAt: now,
          viewedAt: now,
          editedAt: now,
        },
        { merge: true }
      );

      setNewAsset(initialAssetState);
      return true;
    } catch (err) {
      showAlert(err?.message ? String(err.message) : 'Failed to create asset.');
      return false;
    }
  };

  const updateAssetQuantity = async (id, qty) => {
    const n = parseInt(qty) || 1;
    const asset = (assets || []).find((a) => a && a.id === id) || null;
    if (!asset) return;
    if (!hasAssetPermission(asset, 'Edit')) {
      showAlert("You don't have permission to edit this asset.");
      return;
    }
    const vaultId = asset.vaultId || getVaultForAsset(asset)?.id || null;
    if (!vaultId) return;

    try {
      await updateDoc(doc(db, 'vaults', String(vaultId), 'assets', String(id)), { quantity: n, editedAt: Date.now() });
    } catch (err) {
      showAlert(err?.message ? String(err.message) : 'Failed to update quantity.');
    }
  };

  const handleDeleteAsset = (id) => {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;
    if (!hasAssetPermission(asset, 'Delete')) {
      showAlert("You don't have permission to delete this asset.");
      return;
    }
    
    setConfirmDialog({
      show: true,
      title: "Delete Asset",
      message: `Are you sure you want to delete "${asset.title}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          const vaultId = asset.vaultId || getVaultForAsset(asset)?.id || null;
          if (!vaultId) throw new Error('Missing vaultId');
          await deleteDoc(doc(db, 'vaults', String(vaultId), 'assets', String(id)));
        } catch (err) {
          showAlert(err?.message ? String(err.message) : 'Failed to delete asset.');
        } finally {
          setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
        }
      }
    });
  };

  const handleDeleteVault = (vault) => {
    if (!canDeleteVault(vault)) {
      showAlert("You don't have permission to delete this vault.");
      return;
    }
    setConfirmDialog({
      show: true,
      title: "Delete Vault",
      message: `Are you sure you want to delete "${vault.name}"? This will also delete all collections and assets within it.`,
      onConfirm: async () => {
        try {
          if (!API_URL) throw new Error('Missing API URL');
          await apiFetch(`/vaults/${encodeURIComponent(String(vault.id))}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'DELETE' }),
          });
          // If the user deleted their default/example vault, remember this so we don't recreate it on register.
          try {
            const ownerId = getVaultOwnerId(vault);
            if (vault.isDefault && ownerId) {
              localStorage.setItem(`defaultVaultDeleted_${String(ownerId)}`, "true");
            }
          } catch (e) {}
          if (selectedVaultId === vault.id) {
            setSelectedVaultId(null);
            setSelectedCollectionId(null);
          }
        } catch (err) {
          showAlert(err?.message ? String(err.message) : 'Failed to delete vault.');
        } finally {
          setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
        }
      }
    });
  };

  const handleDeleteCollection = (collection) => {
    if (!hasCollectionPermission(collection, 'Delete')) {
      showAlert("You don't have permission to delete this collection.");
      return;
    }
    setConfirmDialog({
      show: true,
      title: "Delete Collection",
      message: `Are you sure you want to delete "${collection.name}"? This will also delete all assets within it.`,
      onConfirm: async () => {
        try {
          const vaultId = collection.vaultId;
          if (!vaultId) throw new Error('Missing vaultId');

          // Delete assets within collection (paged; avoid 500 doc batch limit).
          while (true) {
            const snap = await getDocs(query(collection(db, 'vaults', String(vaultId), 'assets'), where('collectionId', '==', String(collection.id)), limit(400)));
            if (snap.empty) break;
            const batch = writeBatch(db);
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            if (snap.size < 400) break;
          }

          await deleteDoc(doc(db, 'vaults', String(vaultId), 'collections', String(collection.id)));
          if (selectedCollectionId === collection.id) setSelectedCollectionId(null);
        } catch (err) {
          showAlert(err?.message ? String(err.message) : 'Failed to delete collection.');
        } finally {
          setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
        }
      }
    });
  };

  const openMoveDialog = (asset) => {
    const currentCollectionId = asset.collectionId;
    const currentVaultId = collections.find(c => c.id === currentCollectionId)?.vaultId || null;
    setMoveDialog({ show: true, assetId: asset.id, targetVaultId: null, targetCollectionId: null, sourceCollectionId: currentCollectionId, sourceVaultId: currentVaultId });
  };

  const closeMoveDialog = () => setMoveDialog({ show: false, assetId: null, targetVaultId: null, targetCollectionId: null });

  const handleMoveConfirm = async () => {
    const targetId = moveDialog.targetCollectionId;
    if (!targetId) {
      showAlert("Select a collection to move to.");
      return;
    }
    const asset = (assets || []).find((a) => a && a.id === moveDialog.assetId) || null;
    if (!asset) return;
    if (!hasAssetPermission(asset, 'Move')) {
      showAlert("You don't have permission to move this asset.");
      return;
    }

    try {
      const sourceVaultId = String(moveDialog.sourceVaultId || asset.vaultId || '');
      const targetVaultId = String(moveDialog.targetVaultId || '');
      const targetCollectionId = String(targetId);
      if (!sourceVaultId || !targetVaultId || !targetCollectionId) throw new Error('Missing move parameters');

      if (sourceVaultId === targetVaultId) {
        await updateDoc(doc(db, 'vaults', sourceVaultId, 'assets', String(asset.id)), {
          collectionId: targetCollectionId,
          editedAt: Date.now(),
        });
      } else {
        await apiFetch(`/vaults/${encodeURIComponent(sourceVaultId)}/assets/${encodeURIComponent(String(asset.id))}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetVaultId, targetCollectionId }),
        });
      }

      closeMoveDialog();
      showAlert('Asset moved.');
    } catch (err) {
      showAlert(err?.message ? String(err.message) : 'Failed to move asset.');
    }
  };

  const openCollectionMoveDialog = (collection) => {
    const sourceVaultId = collection.vaultId || null;
    setCollectionMoveDialog({ show: true, collectionId: collection.id, targetVaultId: null, sourceVaultId });
  };

  const closeCollectionMoveDialog = () => setCollectionMoveDialog({ show: false, collectionId: null, targetVaultId: null });

  const handleCollectionMoveConfirm = async () => {
    const targetVault = collectionMoveDialog.targetVaultId;
    if (!targetVault) {
      showAlert("Select a vault to move this collection into.");
      return;
    }
    const collectionToMove = (collections || []).find((c) => c && c.id === collectionMoveDialog.collectionId) || null;
    if (!collectionToMove) return;
    if (!hasCollectionPermission(collectionToMove, 'Move')) {
      showAlert("You don't have permission to move this collection.");
      return;
    }
    try {
      const sourceVaultId = String(collectionMoveDialog.sourceVaultId || collectionToMove.vaultId || '');
      const targetVaultId = String(targetVault);
      if (!sourceVaultId || !targetVaultId) throw new Error('Missing move parameters');
      if (sourceVaultId === targetVaultId) {
        closeCollectionMoveDialog();
        return;
      }
      await apiFetch(`/vaults/${encodeURIComponent(sourceVaultId)}/collections/${encodeURIComponent(String(collectionToMove.id))}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetVaultId }),
      });
      setSelectedVaultId(targetVaultId);
      setSelectedCollectionId(String(collectionToMove.id));
      closeCollectionMoveDialog();
      showAlert('Collection moved.');
    } catch (err) {
      showAlert(err?.message ? String(err.message) : 'Failed to move collection.');
    }
  };

  const openViewAsset = (asset) => {
    const normalized = normalizeAsset(asset);
    setViewAsset(normalized);
    setViewAssetDraft({
      title: normalized.title || "",
      type: normalized.type || "",
      category: normalized.category || "",
      description: normalized.description || "",
      manager: normalized.manager || "",
      value: normalized.value || "",
      estimatedValue: normalized.estimatedValue || "",
      rrp: normalized.rrp || "",
      purchasePrice: normalized.purchasePrice || "",
      quantity: normalized.quantity || 1,
      heroImage: normalized.heroImage || normalized.images[0] || "",
      images: trimToFour(normalized.images || []),
    });
    try {
      const vaultId = normalized.vaultId || getVaultForAsset(normalized)?.id || null;
      if (vaultId) {
        updateDoc(doc(db, 'vaults', String(vaultId), 'assets', String(normalized.id)), { viewedAt: Date.now() }).catch(() => {});
      }
    } catch (e) {}
  };
  const closeViewAsset = () => {
    setViewAsset(null);
    setViewAssetDraft(initialAssetState);
  };

  const handleUpdateViewAsset = async () => {
    if (!viewAsset) return false;
    if (!hasAssetPermission(viewAsset, 'Edit')) {
      showAlert("You don't have permission to edit this asset.");
      return false;
    }
    if (!viewAssetDraft.title.trim()) {
      showAlert("Asset title is required.");
      return false;
    }
    if (!viewAssetDraft.type.trim()) {
      showAlert("Asset type is required.");
      return false;
    }
    if (!viewAssetDraft.category.trim()) {
      showAlert("Asset category is required.");
      return false;
    }

    const images = trimToFour(viewAssetDraft.images || []);
    const heroImage = viewAssetDraft.heroImage || images[0] || DEFAULT_HERO;

    try {
      const vaultId = viewAsset.vaultId || getVaultForAsset(viewAsset)?.id || null;
      if (!vaultId) throw new Error('Missing vaultId');
      await updateDoc(doc(db, 'vaults', String(vaultId), 'assets', String(viewAsset.id)), {
        title: viewAssetDraft.title.trim(),
        type: viewAssetDraft.type.trim(),
        category: viewAssetDraft.category.trim(),
        description: viewAssetDraft.description.trim(),
        manager: (viewAssetDraft.manager || '').trim(),
        value: parseFloat(viewAssetDraft.value) || 0,
        estimatedValue: parseFloat(viewAssetDraft.estimatedValue) || 0,
        rrp: parseFloat(viewAssetDraft.rrp) || 0,
        purchasePrice: parseFloat(viewAssetDraft.purchasePrice) || 0,
        quantity: parseInt(viewAssetDraft.quantity) || 1,
        heroImage,
        images,
        editedAt: Date.now(),
      });
      showAlert('Asset updated.');
      return true;
    } catch (err) {
      showAlert(err?.message ? String(err.message) : 'Failed to update asset.');
      return false;
    }
  };

  const handleClearData = () => {
    // Firestore is canonical; keep this as a local reset + sign-out.
    try { localStorage.clear(); } catch (e) {}
    logout();
    setLoginForm({ username: "", password: "" });
    setRegisterForm({ firstName: "", lastName: "", email: "", username: "", password: "", profileImage: DEFAULT_AVATAR });
  };

  const handleProfileUpdate = (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const prevUsername = String(currentUser.username || '').trim();

    const firstName = profileForm.firstName.trim();
    const lastName = profileForm.lastName.trim();
    const email = profileForm.email.trim();
    const username = profileForm.username.trim();

    const errors = {};
    if (!firstName) errors.firstName = "First name is required.";
    if (!lastName) errors.lastName = "Last name is required.";
    if (!email) errors.email = "Email is required.";
    if (email && !email.includes("@")) errors.email = "Enter a valid email.";
    if (!username) errors.username = "Username is required.";

    // Firestore rules only allow reading your own /users/{uid} doc; we cannot
    // reliably pre-check username/email uniqueness here.

    const authEmail = firebaseAuth?.currentUser?.email ? String(firebaseAuth.currentUser.email) : '';
    const wantsEmailChange = authEmail && normalizeEmail(email) !== normalizeEmail(authEmail);

    // Validate password change if user is changing password
    if (isChangingPassword) {
      if (!profileForm.currentPassword) errors.currentPassword = "Current password is required.";
      if (!profileForm.newPassword) errors.newPassword = "New password is required.";
      if (profileForm.newPassword && profileForm.newPassword.length < 6) errors.newPassword = "Password must be at least 6 characters.";
      if (!profileForm.confirmPassword) errors.confirmPassword = "Please confirm your new password.";
      if (profileForm.newPassword && profileForm.confirmPassword && profileForm.newPassword !== profileForm.confirmPassword) errors.confirmPassword = "Passwords do not match.";
    }
    if (wantsEmailChange && !profileForm.currentPassword) {
      errors.currentPassword = "Current password is required to change email.";
    }

    if (Object.keys(errors).length > 0) {
      setProfileErrors(errors);
      return;
    }

    (async () => {
      try {
        if (!firebaseAuth?.currentUser) throw new Error('Not signed in');
        const uid = String(firebaseAuth.currentUser.uid);

        if ((isChangingPassword || wantsEmailChange) && profileForm.currentPassword) {
          const cred = EmailAuthProvider.credential(String(firebaseAuth.currentUser.email || ''), String(profileForm.currentPassword));
          await reauthenticateWithCredential(firebaseAuth.currentUser, cred);
        }

        if (wantsEmailChange) {
          await updateEmail(firebaseAuth.currentUser, normalizeEmail(email));
        }

        if (isChangingPassword && profileForm.newPassword) {
          await updatePassword(firebaseAuth.currentUser, String(profileForm.newPassword));
        }

        await updateDoc(doc(db, 'users', uid), {
          firstName,
          lastName,
          email: normalizeEmail(email),
          username,
        });

        // Best-effort email notifications via backend.
        if (API_URL) {
          const nextUsername = String(username || '').trim();
          const usernameChanged = normalizeUsername(prevUsername) !== normalizeUsername(nextUsername);
          if (usernameChanged) {
            apiFetch(`${API_URL}/notifications/username-changed`, {
              method: 'POST',
              body: JSON.stringify({
                eventId: globalThis?.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                oldUsername: prevUsername,
                newUsername: nextUsername,
              }),
            }).catch(() => {});
          }

          if (isChangingPassword && profileForm.newPassword) {
            apiFetch(`${API_URL}/notifications/password-changed`, {
              method: 'POST',
              body: JSON.stringify({
                eventId: globalThis?.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`,
              }),
            }).catch(() => {});
          }
        }

        setProfileErrors({});
        setIsEditingProfile(false);
        setIsChangingPassword(false);
        setProfileForm({ ...profileForm, currentPassword: "", newPassword: "", confirmPassword: "" });
        showAlert(isChangingPassword && profileForm.newPassword ? "Profile and password updated." : "Profile updated.");
      } catch (err) {
        showAlert(err?.message ? String(err.message) : 'Failed to update profile.');
      }
    })();
  };

  const handleProfileImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > MAX_IMAGE_SIZE) {
      showAlert("Profile image is too large (max 30MB)");
      e.target.value = "";
      return;
    }

    try {
      const resized = await resizeImage(file, 400, 400, 0.8);
      if (!firebaseAuth?.currentUser?.uid) throw new Error('Not signed in');
      await updateDoc(doc(db, 'users', String(firebaseAuth.currentUser.uid)), { profileImage: resized });
      showAlert("Profile picture updated.");
      e.target.value = "";
    } catch (err) {
      showAlert("Failed to upload profile image.");
      e.target.value = "";
    }
  };

  const handleDeleteAccount = () => {
    setConfirmDialog({
      show: true,
      title: "Delete Account",
      message: "Are you sure you want to delete your account? This will permanently delete your profile and all your vaults, collections, and assets. This action cannot be undone.",
      onConfirm: async () => {
        try {
          const uid = firebaseAuth?.currentUser?.uid ? String(firebaseAuth.currentUser.uid) : null;
          if (!uid) throw new Error('Not signed in');

          // Delete owned vaults via backend hard-op.
          const owned = (vaults || []).filter((v) => String(getVaultOwnerId(v) || '') === uid);
          for (const v of owned) {
            try {
              await apiFetch(`/vaults/${encodeURIComponent(String(v.id))}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: 'DELETE' }),
              });
            } catch (e) {
              // keep going
            }
          }

          await deleteDoc(doc(db, 'users', uid)).catch(() => {});
          await deleteUser(firebaseAuth.currentUser);
          setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
          await logout();
        } catch (err) {
          showAlert(mapFirebaseAuthError(err));
          setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
        }
      }
    });
  };

  const handleSelectVault = (vaultId) => {
    setSelectedVaultId(vaultId);
    setSelectedCollectionId(null);
    setShowCollectionForm(false);
    setShowAssetForm(false);
    try {
      updateDoc(doc(db, 'vaults', String(vaultId)), { viewedAt: Date.now() }).catch(() => {});
    } catch (e) {}
  };

  const handleSelectCollection = (collectionId) => {
    setSelectedCollectionId(collectionId);
    const col = collections.find((c) => c.id === collectionId);
    if (col && col.vaultId) {
      setSelectedVaultId(col.vaultId);
    }
    setShowAssetForm(false);
    try {
      if (col?.vaultId) {
        updateDoc(doc(db, 'vaults', String(col.vaultId), 'collections', String(collectionId)), { viewedAt: Date.now() }).catch(() => {});
      }
    } catch (e) {}
    // During tutorial, advance to the asset highlight after user clicks a collection
    if (showTutorial && tutorialStep === 1) {
      // show the explanatory panel that the view switched
      setTutorialStep(2);
      setTimeout(() => ensureTutorialRect("assets-panel"), 150);
    }
  };

  const normalizeAsset = (asset) => {
    const images = asset?.images ? [...asset.images] : [asset.image1, asset.image2, asset.image3].filter(Boolean);
    return { ...asset, images };
  };

  const openImageViewer = (images, startIndex = 0) => {
    setImageViewer({ show: true, images: images.filter(Boolean), currentIndex: startIndex });
  };

  const closeImageViewer = () => {
    setImageViewer({ show: false, images: [], currentIndex: 0 });
  };

  const nextImage = () => {
    setImageViewer(prev => ({
      ...prev,
      currentIndex: (prev.currentIndex + 1) % prev.images.length
    }));
  };

  const prevImage = () => {
    setImageViewer(prev => ({
      ...prev,
      currentIndex: (prev.currentIndex - 1 + prev.images.length) % prev.images.length
    }));
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!imageViewer.show) return;
      if (e.key === 'Escape') closeImageViewer();
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageViewer.show]);

  const trimToFour = (images = []) => images.slice(0, 4);

  const handleUploadImages = async (fileList, setter) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const converted = [];
    const skipped = [];
    for (const file of files) {
      if (converted.length >= 4) break;
      if (file.size > MAX_IMAGE_SIZE) {
        skipped.push(file.name);
        continue;
      }
      const resized = await resizeImage(file);
      converted.push(resized);
    }

    setter((prev) => {
      const existing = prev.images || [];
      const next = trimToFour([...existing, ...converted]);
      // If no existing images or hero is default, set first new image as hero
      const isHeroDefault = !prev.heroImage || prev.heroImage === DEFAULT_HERO || !existing.includes(prev.heroImage);
      const nextHero = (isHeroDefault && converted.length > 0) ? converted[0] : (prev.heroImage || next[0] || "");
      return { ...prev, images: next, heroImage: nextHero };
    });

    if (skipped.length) {
      showAlert(`Some files were too large (max 30MB per file): ${skipped.join(", ")}`);
    }
  };

  const handleRemoveImage = (index, setter) => {
    setter((prev) => {
      const nextImages = [...(prev.images || [])];
      nextImages.splice(index, 1);
      const nextHero = prev.heroImage && nextImages.includes(prev.heroImage) ? prev.heroImage : nextImages[0] || "";
      return { ...prev, images: nextImages, heroImage: nextHero };
    });
  };

  const handleSetHero = (image, setter) => setter((prev) => {
    const existing = [...(prev.images || [])];
    // Move image to front (left-most). If not present, add it to front.
    const idx = existing.indexOf(image);
    if (idx === -1) {
      existing.unshift(image);
    } else {
      existing.splice(idx, 1);
      existing.unshift(image);
    }
    const nextImages = trimToFour(existing);
    return { ...prev, images: nextImages, heroImage: image };
  });

  const sortByDefaultThenDate = (a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  };

  const normalizeFilter = (value) => value.trim().toLowerCase();
  
  // Helper function to calculate total value of assets in a vault
  const getVaultTotalValue = (vaultId) => {
    const vaultCollectionIds = collections.filter(c => c.vaultId === vaultId).map(c => c.id);
    const vaultAssets = assets.filter(a => vaultCollectionIds.includes(a.collectionId));
    return vaultAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
  };
  
  // Helper function to calculate total value of assets in a collection
  const getCollectionTotalValue = (collectionId) => {
    const collectionAssets = assets.filter(a => a.collectionId === collectionId);
    return collectionAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
  };

  // Helper function to calculate total net worth for a user
  const getUserNetWorth = (userId) => {
    const userVaultList = vaults.filter(v => String(getVaultOwnerId(v) || '') === String(userId));
    const userCollectionIds = userVaultList.flatMap(v => collections.filter(c => c.vaultId === v.id).map(c => c.id));
    const userAssets = assets.filter(a => userCollectionIds.includes(a.collectionId));
    return userAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
  };

  const userVaults = currentUser ? vaults.filter((v) => getVaultOwnerId(v) === currentUser.id) : [];
  const filteredVaults = userVaults.filter((v) => v.name.toLowerCase().includes(normalizeFilter(vaultFilter)));
  console.log(`Current vaultSort: "${vaultSort}", Filtered vaults count: ${filteredVaults.length}`);
  const sortedVaults = [...filteredVaults].sort((a, b) => {
    if (vaultSort === "name") return a.name.localeCompare(b.name);
    if (vaultSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (vaultSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (vaultSort === "highestValue") {
      const aVal = getVaultTotalValue(a.id);
      const bVal = getVaultTotalValue(b.id);
      console.log(`Sorting by Highest Value: ${a.name}=$${aVal} vs ${b.name}=$${bVal}, result=${bVal - aVal}`);
      return bVal - aVal;
    }
    if (vaultSort === "lowestValue") {
      const aVal = getVaultTotalValue(a.id);
      const bVal = getVaultTotalValue(b.id);
      console.log(`Sorting by Lowest Value: ${a.name}=$${aVal} vs ${b.name}=$${bVal}, result=${aVal - bVal}`);
      return aVal - bVal;
    }
    return sortByDefaultThenDate(a, b);
  });
  const selectedVault = userVaults.find((v) => v.id === selectedVaultId) || null;

  // Show collections that belong to vaults owned by the current user (so vault owners
  // see collections created by collaborators inside their vaults).
  const userCollections = currentUser ? collections.filter((c) => {
    const vault = vaults.find(v => v.id === c.vaultId);
    return vault && String(getVaultOwnerId(vault) || '') === String(currentUser.id) && (!selectedVaultId || c.vaultId === selectedVaultId);
  }) : [];
  const filteredCollections = userCollections.filter((c) => c.name.toLowerCase().includes(normalizeFilter(collectionFilter)));
  const sortedCollections = [...filteredCollections].sort((a, b) => {
    if (collectionSort === "name") return a.name.localeCompare(b.name);
    if (collectionSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (collectionSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (collectionSort === "highestValue") return getCollectionTotalValue(b.id) - getCollectionTotalValue(a.id);
    if (collectionSort === "lowestValue") return getCollectionTotalValue(a.id) - getCollectionTotalValue(b.id);
    return sortByDefaultThenDate(a, b);
  });
  const selectedCollection = userCollections.find((c) => c.id === selectedCollectionId) || null;

  // Show assets within the selected collection regardless of who created them when
  // the collection belongs to the current user's vault (owners should see contents).
  const userAssets = currentUser && selectedCollection ? assets.filter((a) => a.collectionId === selectedCollection.id) : [];
  const filteredAssets = userAssets.filter((a) => {
    const term = normalizeFilter(assetFilter);
    if (!term) return true;
    return (a.title || "").toLowerCase().includes(term) || (a.category || "").toLowerCase().includes(term);
  });
  const sortedAssets = [...filteredAssets].sort((a, b) => {
    if (assetSort === "name") return (a.title || "").localeCompare(b.title || "");
    if (assetSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (assetSort === "highestValue") return (parseFloat(b.value) || 0) - (parseFloat(a.value) || 0);
    if (assetSort === "lowestValue") return (parseFloat(a.value) || 0) - (parseFloat(b.value) || 0);
    return new Date(b.createdAt) - new Date(a.createdAt); // default newest
  });

  // Datasets for Shared mode (vaults where I have a DELEGATE membership)
  const sharedVaultsList = currentUser ? vaults.filter((v) => {
    const ownerId = getVaultOwnerId(v);
    if (!ownerId || ownerId === currentUser.id) return false;
    if (sharedOwnerId && ownerId !== sharedOwnerId) return false;
    const m = getMembershipForVault(v.id, currentUser.id);
    return !!m;
  }) : [];
  const filteredSharedVaults = sharedVaultsList.filter((v) => v.name.toLowerCase().includes(normalizeFilter(vaultFilter)));
  const sortedSharedVaults = [...filteredSharedVaults].sort((a, b) => {
    if (vaultSort === "name") return a.name.localeCompare(b.name);
    if (vaultSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (vaultSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (vaultSort === "highestValue") return getVaultTotalValue(b.id) - getVaultTotalValue(a.id);
    if (vaultSort === "lowestValue") return getVaultTotalValue(a.id) - getVaultTotalValue(b.id);
    return sortByDefaultThenDate(a, b);
  });

  // In the canonical model, active members can read all collections in the vault.
  const sharedCollectionsList = currentUser ? collections.filter((c) => {
    const vault = vaults.find((v) => v.id === c.vaultId) || null;
    if (!vault) return false;
    const ownerId = getVaultOwnerId(vault);
    if (!ownerId || ownerId === currentUser.id) return false;
    if (!getMembershipForVault(vault.id, currentUser.id)) return false;
    return true;
  }) : [];
  const filteredSharedCollections = sharedCollectionsList.filter((c) => c.name.toLowerCase().includes(normalizeFilter(collectionFilter)) && (!selectedVaultId || c.vaultId === selectedVaultId));
  const sortedSharedCollections = [...filteredSharedCollections].sort((a, b) => {
    if (collectionSort === "name") return a.name.localeCompare(b.name);
    if (collectionSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (collectionSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (collectionSort === "highestValue") return getCollectionTotalValue(b.id) - getCollectionTotalValue(a.id);
    if (collectionSort === "lowestValue") return getCollectionTotalValue(a.id) - getCollectionTotalValue(b.id);
    return sortByDefaultThenDate(a, b);
  });

  const selectedSharedVault = sharedVaultsList.find((v) => v.id === selectedVaultId) || null;
  const selectedSharedCollection = sharedCollectionsList.find((c) => c.id === selectedCollectionId) || null;

  // In the canonical model, active members can read all assets in the vault.
  const sharedAssetsList = currentUser && selectedSharedCollection ? assets.filter((a) => {
    if (a.collectionId !== selectedSharedCollection.id) return false;
    const collection = collections.find((c) => c.id === a.collectionId) || null;
    if (!collection) return false;
    const vault = vaults.find((v) => v.id === collection.vaultId) || null;
    if (!vault) return false;
    const ownerId = getVaultOwnerId(vault);
    if (!ownerId || ownerId === currentUser.id) return false;
    return !!getMembershipForVault(vault.id, currentUser.id);
  }) : [];
  const filteredSharedAssets = sharedAssetsList.filter((a) => {
    const term = normalizeFilter(assetFilter);
    if (!term) return true;
    return (a.title || "").toLowerCase().includes(term) || (a.category || "").toLowerCase().includes(term);
  });
  const sortedSharedAssets = [...filteredSharedAssets].sort((a, b) => {
    if (assetSort === "name") return (a.title || "").localeCompare(b.title || "");
    if (assetSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (assetSort === "highestValue") return (parseFloat(b.value) || 0) - (parseFloat(a.value) || 0);
    if (assetSort === "lowestValue") return (parseFloat(a.value) || 0) - (parseFloat(b.value) || 0);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // Choose display datasets depending on sharedMode
  const displaySortedVaults = sharedMode ? sortedSharedVaults : sortedVaults;
  const displaySelectedVault = sharedMode ? selectedSharedVault : selectedVault;
  const displaySortedCollections = sharedMode ? sortedSharedCollections : sortedCollections;
  const displaySelectedCollection = sharedMode ? selectedSharedCollection : selectedCollection;
  const displaySortedAssets = sharedMode ? sortedSharedAssets : sortedAssets;

  // Single renderer for Collection tiles to avoid duplication in Vault/Collection views
  const renderCollectionTile = (collection, idx) => {
    const collectionAssets = assets.filter(a => a.collectionId === collection.id);
    const collectionValue = collectionAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
    const assetCount = collectionAssets.length;
    const hero = collection.heroImage || DEFAULT_HERO;
    const collectionImages = collection.images || [];
    const vault = getVaultForCollection(collection) || displaySelectedVault;
    const canEdit = hasCollectionPermission(collection, 'Edit');
    const canDelete = hasCollectionPermission(collection, 'Delete');
    const canMove = hasCollectionPermission(collection, 'Move');
    const isOwner = vault && isOwnerOfVault(vault);

    return (
      <div key={collection.id} data-tut={idx === 0 ? "collection-frame" : undefined} className={`relative overflow-hidden p-3 rounded border ${collection.id === selectedCollectionId ? "border-blue-700 bg-blue-950/40" : "border-neutral-800 bg-neutral-950"} flex flex-col justify-between h-48`}>
        <button className="w-full text-left hover:opacity-80" onClick={() => handleSelectCollection(collection.id)}>
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <img src={hero} alt={collection.name} className="w-24 h-24 object-cover bg-neutral-800 cursor-pointer hover:opacity-90 transition-opacity rounded" onClick={(e) => { e.stopPropagation(); openImageViewer(collectionImages, 0); }} onError={(e) => { e.target.src = DEFAULT_HERO; }} />
              {sharedMode && (
                <p className="mt-2 text-xs text-neutral-300">Access: Delegate</p>
              )}
            </div>
            <div className="flex-1 flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{collection.name}</p>
                  {permissionGrants.some((g) => g && g.scope_type === 'COLLECTION' && g.scope_id === collection.id) ? (
                    <svg className="w-4 h-4 text-green-700" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.5 1.1 2.51 2.75 2.97 4.45h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-neutral-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.5 1.1 2.51 2.75 2.97 4.45h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                    </svg>
                  )}
                </div>
                <div className="flex gap-2 items-center mt-1">
                  <span className="text-xs px-2 py-1 rounded bg-purple-900/50 border border-purple-700 text-purple-300">Collection</span>
                </div>
              </div>
              <div className="text-right text-xs text-white ml-4">
                <p>Created {new Date(collection.createdAt).toLocaleDateString()}</p>
                {collection.lastViewed && <p className="mt-0.5">Viewed {new Date(collection.lastViewed).toLocaleDateString()}</p>}
                {collection.lastEditedBy && <p className="mt-0.5">Edited by {(() => { const editor = users.find(u => u.username === collection.lastEditedBy) || {}; return editor.firstName ? `${editor.firstName} ${editor.lastName}` : (editor.username || collection.lastEditedBy); })()}</p>}
                <p className="mt-0.5">Manager: {(() => { const owner = users.find(u => u.id === collection.ownerId) || {}; const ownerName = owner.firstName ? `${owner.firstName} ${owner.lastName}` : (owner.username || 'Unknown'); return collection.manager || ownerName; })()}</p>
                <p className="mt-0.5">Assets: {assetCount}</p>
                {Number.isFinite(collectionValue) && <p className="mt-0.5 font-semibold">Value: ${collectionValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>}
                
              </div>
            </div>
          </div>
        </button>
        <div className="flex gap-2 mt-2">
          <button className={`px-2 py-0.5 bg-blue-700 text-white rounded text-xs hover:bg-blue-800`} onClick={(e) => { e.stopPropagation(); openEditCollection(collection); }}>Edit</button>
          {!sharedMode && (
            <button className={`px-2 py-0.5 rounded text-xs ${isOwner ? "bg-green-700 text-white hover:bg-green-800" : "bg-neutral-800 text-neutral-400 cursor-not-allowed"}`} onClick={(e) => { e.stopPropagation(); if (!isOwner) return; openShareDialog('collection', collection); }} title={isOwner ? "" : "Only the vault owner can change sharing"}>Share</button>
          )}
          {canMove && (
            <button className="px-2 py-0.5 rounded text-xs bg-yellow-600 text-white hover:bg-yellow-700" onClick={(e) => { e.stopPropagation(); openCollectionMoveDialog(collection); }}>Move</button>
          )}
          {canDelete && (
            <button className="px-2 py-0.5 rounded text-xs bg-red-700 text-white hover:bg-red-800" onClick={(e) => { e.stopPropagation(); handleDeleteCollection(collection); }}>Delete</button>
          )}
        </div>
      </div>
    );
  };

  const isAuthView = !isLoggedIn && (view === "login" || view === "register");
  const isLanding = !isLoggedIn && view === "landing";
  const activeCenteredView = isLanding ? "landing" : (isAuthView ? view : "other");
  const shouldCenter = isAuthView || isLanding;

  const breadcrumb = [
    { label: "Home", onClick: () => navigateTo(isLoggedIn ? "vault" : "landing") },
    { label: "Vault", onClick: isLoggedIn ? () => navigateTo("vault") : null },
    displaySelectedVault ? { label: displaySelectedVault.name, onClick: () => navigateTo("vault", { shared: sharedMode }) } : null,
    displaySelectedCollection ? { label: displaySelectedCollection.name } : null,
  ].filter(Boolean);

  const renderBreadcrumb = () => (
    <div className="flex items-center gap-2 text-sm text-neutral-400">
      {breadcrumb.map((item, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <span className="text-neutral-600">/</span>}
          {item.onClick ? (
            <button className="hover:text-white transition" onClick={item.onClick}>{item.label}</button>
          ) : (
            <span className="text-neutral-200">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );

  // compute permission booleans used by modals
  const assetCanEdit = viewAsset ? hasAssetPermission(viewAsset, 'Edit') : true;
  const editCanEdit = (editDialog && editDialog.show && editDialog.item) ? (() => {
    if (editDialog.type === "vault") {
      const vault = editDialog.item;
      return canEditVaultDoc(vault);
    }
    if (editDialog.type === "collection") {
      const vault = getVaultForCollection(editDialog.item);
      return hasCollectionPermission(editDialog.item, 'Edit');
    }
    return true;
  })() : true;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {alert && (
        <div className="fixed top-4 inset-x-0 flex justify-center z-[60]">
          <div className="px-4 py-2 bg-blue-700 text-white rounded shadow">{alert}</div>
        </div>
      )}

      {showTutorial && (
        <div className="fixed inset-0 z-50">
          {tutorialRect ? (
            <>
              <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: `${tutorialRect.top}px`, background: 'rgba(0,0,0,0.6)' }} />
              <div style={{ position: 'absolute', left: 0, top: `${tutorialRect.top}px`, width: `${tutorialRect.left}px`, height: `${tutorialRect.height}px`, background: 'rgba(0,0,0,0.6)' }} />
              <div style={{ position: 'absolute', left: `${tutorialRect.left + tutorialRect.width}px`, top: `${tutorialRect.top}px`, right: 0, height: `${tutorialRect.height}px`, background: 'rgba(0,0,0,0.6)' }} />
              <div style={{ position: 'absolute', left: 0, top: `${tutorialRect.top + tutorialRect.height}px`, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)' }} />
              <div style={{ position: 'absolute', left: `${tutorialRect.left}px`, top: `${tutorialRect.top}px`, width: `${tutorialRect.width}px`, height: `${tutorialRect.height}px`, boxShadow: '0 0 0 3px rgba(255,255,255,0.12) inset', borderRadius: 6, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', left: Math.max(12, tutorialRect.left), top: tutorialRect.top + tutorialRect.height + 12, maxWidth: 360 }} className="bg-neutral-900 border border-neutral-700 rounded p-3 text-sm text-neutral-200">
                <div className="mb-2">{tutorialMessages[tutorialStep]}</div>
                <div className="flex gap-2 justify-end">
                  <button className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800 text-xs" onClick={skipTutorial}>Skip</button>
                  <button className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-xs" onClick={nextTutorial}>{tutorialStep === tutorialTargets.length - 1 ? "Done" : "Next"}</button>
                </div>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <div className="bg-neutral-900 border border-neutral-700 rounded p-3 text-sm text-neutral-200">
                <div className="mb-2">Preparing tutorial...</div>
                <div className="flex gap-2 justify-end">
                  <button className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800 text-xs" onClick={skipTutorial}>Skip</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!shouldCenter && (
        <header className="border-b border-neutral-900 bg-neutral-950/70 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button className="hover:opacity-80 transition text-left" onClick={() => { setSelectedVaultId(null); setSelectedCollectionId(null); navigateTo(isLoggedIn ? "home" : "landing"); }}>
                <div className="font-semibold text-lg tracking-[0.15em]">LAMB</div>
                <div className="text-sm tracking-[0.2em] text-neutral-500">LIQUID ASSET MANAGEMENT BOARD</div>
              </button>
            </div>
            <div className="flex items-center gap-3">
              {isLoggedIn && currentUser ? (
                <>
                  <button className="flex items-center gap-2 px-3 py-2 rounded bg-neutral-900 border border-neutral-800 hover:bg-neutral-800" onClick={() => navigateTo("profile")}>
                    <img src={currentUser.profileImage || DEFAULT_AVATAR} alt="avatar" className="h-7 w-7 rounded-full object-cover" />
                    <span className="text-sm">{currentUser.firstName || currentUser.username}</span>
                  </button>
                  <button className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700" onClick={logout}>Logout</button>
                </>
              ) : (
                !isLanding && (
                  <div className="flex gap-2">
                    <button className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700" onClick={() => navigateTo("login")}>Login</button>
                    <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700" onClick={() => navigateTo("register")}>Sign up</button>
                  </div>
                )
              )}
            </div>
          </div>
        </header>
      )}

      <main className={`${shouldCenter ? "flex items-center justify-center min-h-screen" : ""}`}>
        <div className={`${shouldCenter ? "max-w-3xl w-full mx-auto" : "max-w-6xl mx-auto"} px-4 py-10 pb-24`}>
          {shouldCenter ? (
            <div className="max-w-xl mx-auto relative min-h-[520px]">
              <div className={`transition-all duration-300 ease-out ${activeCenteredView === "landing" ? "opacity-100 translate-y-0 relative" : "opacity-0 -translate-y-3 pointer-events-none absolute inset-0"}`}>
                <div className="p-8 rounded-2xl border border-neutral-900 bg-neutral-900/50 shadow-lg space-y-6 text-center flex flex-col items-center">
                  <div className="space-y-2">
                    <p className="text-4xl font-bold text-white tracking-[0.15em]">LAMB</p>
                    <p className="text-sm tracking-[0.2em] text-neutral-500">LIQUID ASSET MANAGEMENT BOARD</p>
                    <p className="text-sm uppercase tracking-[0.2em] text-blue-400">Secure by default</p>
                    <h1 className="text-xl font-bold mt-2">Your private vault for liquid assets.</h1>
                    <p className="text-neutral-400 mt-3 max-w-xl">Organize vaults, collections, and assets with privacy-first defaults. No feeds, no distractions.</p>
                  </div>
                  <div className="flex gap-3 justify-center">
                    <button className="px-4 py-2 rounded border border-neutral-700 hover:bg-neutral-800" onClick={() => navigateTo("login")}>Login</button>
                    <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" onClick={() => navigateTo("register")}>Sign up</button>
                  </div>
                </div>
              </div>

              <div className={`transition-all duration-300 ease-out ${activeCenteredView === "login" ? "opacity-100 translate-y-0 relative" : "opacity-0 -translate-y-3 pointer-events-none absolute inset-0"}`}>
                <form className="p-8 rounded-2xl border border-neutral-900 bg-neutral-900/50 shadow-lg space-y-5" onSubmit={handleLogin}>
                  <div className="space-y-2">
                    <p className="text-4xl font-bold text-white tracking-[0.15em]">LAMB</p>
                    <p className="text-sm tracking-[0.2em] text-neutral-500">LIQUID ASSET MANAGEMENT BOARD</p>
                    <h2 className="text-2xl font-semibold">Login</h2>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-neutral-400">Username</label>
                      <input className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={loginForm.username} onChange={(e) => setLoginForm((p) => ({ ...p, username: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm text-neutral-400">Password</label>
                      <input type="password" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={loginForm.password} onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <button className="w-full py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Login</button>
                    <button
                      className="w-full py-2 rounded border border-neutral-700 hover:bg-neutral-800 text-sm"
                      type="button"
                      onClick={async () => {
                        try {
                          const prefill = (loginForm.username || '').trim();
                          const input = window.prompt('Enter your email to reset your password:', prefill.includes('@') ? prefill : '');
                          const em = normalizeEmail(input || '');
                          if (!em) return;
                          await sendPasswordResetEmail(firebaseAuth, em);
                          showAlert('If an account exists for that email, you will receive a reset link shortly.');
                        } catch {
                          showAlert('If an account exists for that email, you will receive a reset link shortly.');
                        }
                      }}
                    >
                      Forgot password?
                    </button>
                    <p className="text-sm text-neutral-400 text-center">No account? <button className="text-blue-400 hover:text-blue-300" type="button" onClick={() => navigateTo("register")}>Sign up</button></p>
                  </div>
                </form>
              </div>

              <div className={`transition-all duration-300 ease-out ${activeCenteredView === "register" ? "opacity-100 translate-y-0 relative" : "opacity-0 -translate-y-3 pointer-events-none absolute inset-0"}`}>
                <form className="p-8 rounded-2xl border border-neutral-900 bg-neutral-900/50 shadow-lg space-y-5" onSubmit={handleRegister}>
                  <div className="space-y-2">
                    <p className="text-4xl font-bold text-white tracking-[0.15em]">LAMB</p>
                    <p className="text-sm tracking-[0.2em] text-neutral-500">LIQUID ASSET MANAGEMENT BOARD</p>
                    <h2 className="text-2xl font-semibold">Sign up</h2>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-sm text-neutral-400">First name</label>
                      <input className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={registerForm.firstName} onChange={(e) => setRegisterForm((p) => ({ ...p, firstName: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm text-neutral-400">Last name</label>
                      <input className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={registerForm.lastName} onChange={(e) => setRegisterForm((p) => ({ ...p, lastName: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm text-neutral-400">Email</label>
                      <input className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={registerForm.email} onChange={(e) => setRegisterForm((p) => ({ ...p, email: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm text-neutral-400">Username</label>
                      <input className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={registerForm.username} onChange={(e) => setRegisterForm((p) => ({ ...p, username: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm text-neutral-400">Password</label>
                      <input type="password" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={registerForm.password} onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <button className="w-full py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Sign up</button>
                    <p className="text-sm text-neutral-400 text-center">Have an account? <button className="text-blue-400 hover:text-blue-300" type="button" onClick={() => navigateTo("login")}>Login</button></p>
                  </div>
                </form>
              </div>
            </div>
          ) : view === "profile" && currentUser ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">Profile</h1>
                </div>
              </div>
              <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm" onClick={() => goBack()}>← Back</button>
              <div className="grid gap-4 md:grid-cols-3 items-start">
                <div className="p-5 rounded-xl border border-neutral-900 bg-neutral-900/60">
                      <p className="text-sm text-neutral-400">Profile</p>
                  <h2 className="text-xl font-semibold mt-1">{currentUser.firstName} {currentUser.lastName}</h2>
                  <div className="mt-4 relative inline-block">
                    <img src={currentUser.profileImage || DEFAULT_AVATAR} alt="avatar" className="h-28 w-28 rounded-full object-cover border border-neutral-800" />
                    <label className="absolute bottom-0 right-0 p-2 rounded-full bg-blue-600 hover:bg-blue-700 cursor-pointer border-2 border-neutral-900">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <input type="file" accept="image/*" className="hidden" onChange={handleProfileImageUpload} />
                    </label>
                  </div>
                  <div className="mt-4 p-3 rounded-lg bg-neutral-950/50 border border-neutral-800">
                    <p className="text-xs text-neutral-500">Net Worth</p>
                    <p className="text-lg font-semibold">${(currentUser ? getUserNetWorth(currentUser.id) : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <div className="md:col-span-2 space-y-4">
                  <form className="p-5 rounded-xl border border-neutral-900 bg-neutral-900/60 space-y-4" onSubmit={handleProfileUpdate}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-neutral-400">Account details</p>
                        <h3 className="text-lg font-semibold">Edit profile</h3>
                      </div>
                      {!isEditingProfile && <button className="text-sm text-blue-400" type="button" onClick={() => setIsEditingProfile(true)}>Edit</button>}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="text-sm text-neutral-400">First name</label>
                        <input disabled={!isEditingProfile} className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 disabled:opacity-70" value={profileForm.firstName} onChange={(e) => setProfileForm((p) => ({ ...p, firstName: e.target.value }))} />
                        {profileErrors.firstName && <p className="text-xs text-red-400 mt-1">{profileErrors.firstName}</p>}
                      </div>
                      <div>
                        <label className="text-sm text-neutral-400">Last name</label>
                        <input disabled={!isEditingProfile} className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 disabled:opacity-70" value={profileForm.lastName} onChange={(e) => setProfileForm((p) => ({ ...p, lastName: e.target.value }))} />
                        {profileErrors.lastName && <p className="text-xs text-red-400 mt-1">{profileErrors.lastName}</p>}
                      </div>
                      <div>
                        <label className="text-sm text-neutral-400">Email</label>
                        <input disabled={!isEditingProfile} className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 disabled:opacity-70" value={profileForm.email} onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))} />
                        {profileErrors.email && <p className="text-xs text-red-400 mt-1">{profileErrors.email}</p>}
                      </div>
                      <div>
                        <label className="text-sm text-neutral-400">Username</label>
                        <input disabled={!isEditingProfile} className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 disabled:opacity-70" value={profileForm.username} onChange={(e) => setProfileForm((p) => ({ ...p, username: e.target.value }))} />
                        {profileErrors.username && <p className="text-xs text-red-400 mt-1">{profileErrors.username}</p>}
                      </div>
                    </div>
                    {isEditingProfile && (
                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Save</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setIsEditingProfile(false); setProfileErrors({}); setProfileForm({ ...profileForm, firstName: currentUser.firstName, lastName: currentUser.lastName, email: currentUser.email, username: currentUser.username }); }}>Cancel</button>
                      </div>
                    )}
                  </form>

                  
                </div>
              </div>
            </div>
          ) : view === "settings" && currentUser ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">Settings</h1>
                </div>
              </div>
              <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm" onClick={() => goBack()}>← Back</button>
              <div className="grid gap-4 md:grid-cols-3 items-start">
                <div className="md:col-span-2 space-y-4">
                  <div className="p-5 rounded-xl border border-neutral-900 bg-neutral-900/60 space-y-4">
                    <div>
                      <p className="text-sm text-neutral-400">Settings</p>
                      <h3 className="text-lg font-semibold">Change password</h3>
                    </div>
                    <div className="mb-4">
                      <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="button" onClick={() => setIsChangingPassword(!isChangingPassword)}>
                        {isChangingPassword ? "Cancel password change" : "Change password"}
                      </button>
                    </div>
                    {isChangingPassword && (
                      <form className="space-y-4" onSubmit={handleProfileUpdate}>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <label className="text-sm text-neutral-400">Current password</label>
                            <input type="password" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={profileForm.currentPassword} onChange={(e) => setProfileForm((p) => ({ ...p, currentPassword: e.target.value }))} />
                            {profileErrors.currentPassword && <p className="text-xs text-red-400 mt-1">{profileErrors.currentPassword}</p>}
                          </div>
                          <div>
                            <label className="text-sm text-neutral-400">New password</label>
                            <input type="password" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={profileForm.newPassword} onChange={(e) => setProfileForm((p) => ({ ...p, newPassword: e.target.value }))} />
                            {profileErrors.newPassword && <p className="text-xs text-red-400 mt-1">{profileErrors.newPassword}</p>}
                          </div>
                          <div>
                            <label className="text-sm text-neutral-400">Confirm new password</label>
                            <input type="password" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" value={profileForm.confirmPassword} onChange={(e) => setProfileForm((p) => ({ ...p, confirmPassword: e.target.value }))} />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Update password</button>
                          <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setIsChangingPassword(false); setProfileErrors({}); setProfileForm({ ...profileForm, currentPassword: "", newPassword: "", confirmPassword: "" }); }}>Cancel</button>
                        </div>
                      </form>
                    )}

                    <div className="pt-4 border-t border-neutral-800 space-y-3">
                      <div>
                        <p className="text-sm text-neutral-400">Account</p>
                        <h3 className="text-lg font-semibold">Delete account</h3>
                      </div>
                      <p className="text-sm text-neutral-400">Once you delete your account, there is no going back. Please be certain.</p>
                      <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700" onClick={handleDeleteAccount}>Delete account</button>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          ) : view === "home" && currentUser ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold">Home</h1>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <button className="p-6 rounded-xl border border-neutral-900 bg-neutral-900/50 hover:bg-neutral-900/70 text-left" onClick={() => { navigateTo("vault"); }}>
                  <h3 className="text-lg font-semibold">My Vaults</h3>
                  <p className="text-sm text-neutral-400 mt-2">View and manage your vaults and collections.</p>
                </button>
                <button className="p-6 rounded-xl border border-neutral-900 bg-neutral-900/50 hover:bg-neutral-900/70 text-left" onClick={() => { navigateTo("shared"); }}>
                  <h3 className="text-lg font-semibold">Shared Vaults</h3>
                  <p className="text-sm text-neutral-400 mt-2">Vaults shared with you by others.</p>
                </button>
                <button className="p-6 rounded-xl border border-neutral-900 bg-neutral-900/50 hover:bg-neutral-900/70 text-left" onClick={() => { navigateTo("settings"); }}>
                  <h3 className="text-lg font-semibold">Settings</h3>
                  <p className="text-sm text-neutral-400 mt-2">Account settings and preferences.</p>
                </button>
                <button className="p-6 rounded-xl border border-neutral-900 bg-neutral-900/50 hover:bg-neutral-900/70 text-left" onClick={() => { navigateTo("profile"); }}>
                  <h3 className="text-lg font-semibold">Profile</h3>
                  <p className="text-sm text-neutral-400 mt-2">View and edit your profile details.</p>
                </button>
              </div>
            </div>
          ) : view === "sharedPicker" && currentUser ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">Shared Vaults</h1>
                </div>
              </div>
              <div className="mt-3">
                <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm" onClick={() => goBack()}>← Back</button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {(() => {
                  const memberVaultIds = Array.from(new Set((vaultMemberships || []).filter(m => m && m.user_id === currentUser.id && m.status !== 'REVOKED').map(m => m.vault_id)));
                  const ownerIds = Array.from(new Set(memberVaultIds.map(vId => getVaultOwnerId(vaults.find(v => v && v.id === vId))).filter(Boolean)));
                  if (ownerIds.length === 0) return (<p className="text-neutral-500">No users have shared vaults with you.</p>);
                  const owners = ownerIds.map(id => users.find(u => u.id === id)).filter(Boolean);
                  return owners.map((owner) => (
                    <div key={owner.id} className="p-4 rounded border border-neutral-800 bg-neutral-950/40 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{owner.firstName} {owner.lastName}</div>
                        <div className="text-xs text-neutral-400">{owner.email || owner.username}</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={() => { setSharedOwnerId(owner.id); setSharedMode(true); navigateTo("vault"); }}>Open</button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          ) : view === "shared" && currentUser ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">Shared Vaults</h1>
                </div>
              </div>
              <div className="mt-3">
                <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm" onClick={() => goBack()}>← Back</button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Shared By Me</h3>
                  <div className="space-y-3">
                    {(() => {
                      const owned = vaults.filter(v => getVaultOwnerId(v) === currentUser.id);
                      const sharedByMe = owned.filter(v => (vaultMemberships || []).some(m => m && m.vault_id === v.id && m.status !== 'REVOKED'));
                      if (sharedByMe.length === 0) {
                        return (
                          <div className="p-3 rounded border border-neutral-800 bg-neutral-950/30 flex items-center justify-between">
                            <div>
                              <div className="font-medium">You haven't shared any vaults</div>
                              <div className="text-xs text-neutral-400">You can share a vault to collaborate with others.</div>
                            </div>
                            <div className="flex gap-2">
                            </div>
                          </div>
                        );
                      }
                      return sharedByMe.map((v) => (
                        <div key={v.id} className="p-3 rounded border border-neutral-800 bg-neutral-950/30 flex items-center justify-between">
                          <div>
                            <div className="font-medium">{v.name}</div>
                            <div className="text-xs text-neutral-400">{(vaultMemberships || []).filter(m => m && m.vault_id === v.id && m.status !== 'REVOKED').length} users</div>
                          </div>
                            <div className="flex gap-2">
                            <button className="px-2 py-1 rounded bg-blue-600 text-white text-xs" onClick={() => { openShareDialog('vault', v); }}>Manage</button>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-2">Shared With Me</h3>
                  <div className="space-y-3">
                    {(() => {
                      const sharedWithMe = vaults.filter((v) => {
                        const ownerId = getVaultOwnerId(v);
                        if (!ownerId || ownerId === currentUser.id) return false;
                        return !!getMembershipForVault(v.id, currentUser.id);
                      });
                      if (sharedWithMe.length === 0) {
                        return (
                          <div className="p-3 rounded border border-neutral-800 bg-neutral-950/30 flex items-center justify-between">
                            <div>
                              <div className="font-medium">No vaults shared with you</div>
                              <div className="text-xs text-neutral-400">No one has shared a vault with you yet.</div>
                            </div>
                            <div className="flex gap-2">
                            </div>
                          </div>
                        );
                      }
                      return sharedWithMe.map((v) => {
                        const owner = users.find(u => u.id === getVaultOwnerId(v)) || { username: 'Unknown' };
                        return (
                          <div key={v.id} className="p-3 rounded border border-neutral-800 bg-neutral-950/30 flex items-center justify-between">
                            <div>
                              <div className="font-medium">{v.name}</div>
                              <div className="text-xs text-neutral-400">Shared by {owner.username} · Delegate</div>
                            </div>
                            <div className="flex gap-2">
                              <button className="px-2 py-1 rounded bg-blue-600 text-white text-xs" onClick={() => { handleSelectVault(v.id); }}>Open</button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">
                    {sharedMode ? (
                      sharedOwnerId ? (
                        `${(users.find(u => u.id === sharedOwnerId)?.firstName || users.find(u => u.id === sharedOwnerId)?.username || '').trim()} ${(users.find(u => u.id === sharedOwnerId)?.lastName || '').trim()}`.trim() + "'s Vault"
                      ) : (
                        "Shared Vaults"
                      )
                    ) : (
                      "My Vaults"
                    )}
                  </h1>
                </div>
                <button className="text-xs text-neutral-500 hover:text-neutral-300" onClick={handleClearData}>Clear local data</button>
              </div>
              <div className="mt-3">
                {!displaySelectedCollection && (
                  <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm" onClick={() => goBack()}>
                    ← Back
                  </button>
                )}
                {displaySelectedCollection && (
                  <button data-tut="back-button" className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm" onClick={() => { setSelectedCollectionId(null); setShowCollectionForm(false); setShowAssetForm(false); }}>
                    ← Back
                  </button>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 transition-all duration-300">
                <div className="p-4 border border-neutral-900 rounded-xl bg-neutral-900/50 space-y-4 min-h-[500px] transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-semibold">{displaySelectedCollection ? "Collections" : "Vaults"}</p>
                      <h3 className="text-sm text-neutral-400 truncate">{displaySelectedCollection ? (displaySelectedVault?.name || "Choose a Vault") : "Choose a Vault"}</h3>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {(() => {
                        const headerTargetVault = displaySelectedCollection ? (getVaultForCollection(displaySelectedCollection) || displaySelectedVault) : (displaySelectedVault || null);
                        // Determine header create permission:
                        // - If a vault context exists, use that vault's create permission.
                        // - If in sharedMode with an owner selected but no vault chosen, allow create
                        //   only if that owner has granted the current user 'create' on at least one of their vaults.
                        // - Otherwise (normal non-shared view with no specific vault), allow create.
                        // Hide header create entirely in shared mode (no vault creation entry point)
                        if (sharedMode) return null;

                        const headerCanCreate = headerTargetVault ? canCreateCollectionInVault(headerTargetVault) : true;
                        return headerCanCreate ? (
                          <button data-tut="create-button" className={`px-3 py-2 rounded w-10 h-10 flex items-center justify-center bg-blue-600 hover:bg-blue-700`} onClick={() => {
                            const activeCollection = displaySelectedCollection;
                            if (activeCollection) {
                              setShowCollectionForm((v) => !v);
                              setShowVaultForm(false);
                            } else {
                              setShowVaultForm((v) => !v);
                            }
                            setShowAssetForm(false);
                          }}>+</button>
                        ) : null;
                      })()}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-sm">
                    {!showVaultForm && !showCollectionForm && (displaySelectedCollection ? (
                      <>
                        <input className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 flex-1 min-w-[160px]" placeholder="Filter collections" value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} />
                        <select className="px-3 py-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={collectionSort} onChange={(e) => setCollectionSort(e.target.value)}>
                          <option value="default">Default</option>
                          <option value="name">Name</option>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="highestValue">Highest Value</option>
                          <option value="lowestValue">Lowest Value</option>
                        </select>
                          <option value="highestValue">Highest Value</option>
                          <option value="lowestValue">Lowest Value</option>                      </>
                    ) : (
                      <>
                        <input className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 flex-1 min-w-[160px]" placeholder="Filter vaults" value={vaultFilter} onChange={(e) => setVaultFilter(e.target.value)} />
                        <select className="px-3 py-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={vaultSort} onChange={(e) => setVaultSort(e.target.value)}>
                          <option value="default">Default</option>
                          <option value="name">Name</option>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="highestValue">Highest Value</option>
                          <option value="lowestValue">Lowest Value</option>
                        </select>
                      </>
                    ))}
                  </div>

                    {!displaySelectedCollection && showVaultForm && (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const ok = handleAddVault(); if (ok) setShowVaultForm(false); }}>
                      <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Vault name" value={newVault.name} onChange={(e) => setNewVault((p) => ({ ...p, name: e.target.value }))} />
                      <textarea className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={2} placeholder="Description (optional)" maxLength={100} value={newVault.description} onChange={(e) => setNewVault((p) => ({ ...p, description: e.target.value }))} />
                      
                            <input disabled className="w-full p-2 rounded bg-neutral-950 border border-neutral-800 mt-2 disabled:opacity-60 cursor-not-allowed" placeholder="username or email" value={newVault.manager} onChange={(e) => setNewVault((p) => ({ ...p, manager: e.target.value }))} />
                      <div className="space-y-3">
                        <div className="flex flex-col items-start gap-1">
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                            onChange={async (e) => { await handleUploadImages(e.target.files, setNewVault); e.target.value = ""; }}
                          />
                          <div className="pt-1">
                            <p className="text-sm text-neutral-400">Images (max 4)</p>
                          </div>
                        </div>

                        {newVault.images?.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {newVault.images.map((img, idx) => {
                              const isHero = newVault.heroImage === img;
                              return (
                                <div key={idx} className="relative border border-neutral-800 rounded overflow-hidden">
                                  <img src={img} alt={`Upload ${idx + 1}`} className="w-full h-28 object-cover" />
                                  <div className="absolute top-2 right-2 flex gap-1 items-center">
                                    {!isHero && (
                                      <button type="button" className="px-2 py-1 text-xs rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700" onClick={() => handleSetHero(img, setNewVault)}>☆</button>
                                    )}
                                    {isHero && <span className="px-2 py-1 text-xs rounded bg-neutral-900 text-amber-400">★</span>}
                                    <button type="button" className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700" onClick={() => handleRemoveImage(idx, setNewVault)}>Delete</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Create</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setShowVaultForm(false); setNewVault(initialVaultState); }}>Cancel</button>
                      </div>
                    </form>
                  )}

                  {displaySelectedCollection && showCollectionForm && (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const ok = handleAddCollection(); if (ok) setShowCollectionForm(false); }}>
                      <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Collection name" value={newCollection.name} onChange={(e) => setNewCollection((p) => ({ ...p, name: e.target.value }))} />
                      <textarea className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={2} placeholder="Description (optional)" maxLength={100} value={newCollection.description} onChange={(e) => setNewCollection((p) => ({ ...p, description: e.target.value }))} />
                      
                      <input disabled className="w-full p-2 rounded bg-neutral-950 border border-neutral-800 mt-2 disabled:opacity-60 cursor-not-allowed" placeholder="username or email" value={newCollection.manager} onChange={(e) => setNewCollection((p) => ({ ...p, manager: e.target.value }))} />
                      <div className="space-y-3">
                        <div className="flex flex-col items-start gap-1">
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                            onChange={async (e) => { await handleUploadImages(e.target.files, setNewCollection); e.target.value = ""; }}
                          />
                          <div className="pt-1">
                            <p className="text-sm text-neutral-400">Images (max 4)</p>
                          </div>
                        </div>

                        {newCollection.images?.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {newCollection.images.map((img, idx) => {
                              const isHero = newCollection.heroImage === img;
                              return (
                                <div key={idx} className="relative border border-neutral-800 rounded overflow-hidden">
                                  <img src={img} alt={`Upload ${idx + 1}`} className="w-full h-28 object-cover" />
                                  <div className="absolute top-2 right-2 flex gap-1 items-center">
                                    {!isHero && (
                                      <button type="button" className="px-2 py-1 text-xs rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700" onClick={() => handleSetHero(img, setNewCollection)}>☆</button>
                                    )}
                                    {isHero && <span className="px-2 py-1 text-xs rounded bg-neutral-900 text-amber-400">★</span>}
                                    <button type="button" className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700" onClick={() => handleRemoveImage(idx, setNewCollection)}>Delete</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Create</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setShowCollectionForm(false); setNewCollection(initialCollectionState); }}>Cancel</button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2">
                    {!displaySelectedCollection ? (
                      displaySortedVaults.length === 0 ? (
                        <p className="text-neutral-500">No vaults yet. Add one to start.</p>
                      ) : (
                        <div data-tut="vault-list" className="grid gap-2">
                          {displaySortedVaults.map((vault, idx) => {
                            const vaultCollectionIds = collections.filter(c => c.vaultId === vault.id).map(c => c.id);
                            const vaultAssets = assets.filter(a => vaultCollectionIds.includes(a.collectionId));
                            const vaultValue = vaultAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
                            const collectionCount = vaultCollectionIds.length;
                            const hero = vault.heroImage || DEFAULT_HERO;
                            const vaultImages = vault.images || [];
                            return (
                            <div key={vault.id} data-tut={idx === 0 ? "vault-frame" : undefined} className={`relative overflow-hidden p-3 rounded border ${vault.id === selectedVaultId ? "border-blue-700 bg-blue-950/40" : "border-neutral-800 bg-neutral-950"} flex flex-col justify-between h-48`}>
                              <button className="w-full text-left hover:opacity-80" onClick={() => handleSelectVault(vault.id)}>
                                <div className="flex gap-4">
                                  <div className="flex-shrink-0">
                                    <img src={hero} alt={vault.name} className="w-24 h-24 object-cover bg-neutral-800 cursor-pointer hover:opacity-90 transition-opacity rounded" onClick={(e) => { e.stopPropagation(); openImageViewer(vaultImages, 0); }} onError={(e) => { e.target.src = DEFAULT_HERO; }} />
                                    {sharedMode && (
                                      <p className="mt-2 text-xs text-neutral-300">Access: Delegate</p>
                                    )}
                                  </div>
                                  <div className="flex-1 flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold">{vault.name}</p>
                                        {(vaultMemberships || []).some((m) => m && m.vault_id === vault.id && m.status !== 'REVOKED') ? (
                                          <svg className="w-4 h-4 text-green-700" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.5 1.1 2.51 2.75 2.97 4.45h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                          </svg>
                                        ) : (
                                          <svg className="w-4 h-4 text-neutral-500" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.5 1.1 2.51 2.75 2.97 4.45h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                          </svg>
                                        )}
                                      </div>
                                      <div className="flex gap-2 items-center mt-1">
                                        <span className="text-xs px-2 py-1 rounded bg-blue-900/50 border border-blue-700 text-blue-300">Vault</span>
                                      </div>
                                    </div>
                                    <div className="text-right text-xs text-white ml-4">
                                      <p>Created {new Date(vault.createdAt).toLocaleDateString()}</p>
                                      {vault.lastViewed && <p className="mt-0.5">Viewed {new Date(vault.lastViewed).toLocaleDateString()}</p>}
                                      {vault.lastEditedBy && <p className="mt-0.5">Edited by {(() => { const editor = users.find(u => u.username === vault.lastEditedBy) || {}; return editor.firstName ? `${editor.firstName} ${editor.lastName}` : (editor.username || vault.lastEditedBy); })()}</p>}
                                      <p className="mt-0.5">Manager: {(() => { const owner = users.find(u => u.id === getVaultOwnerId(vault)) || {}; const ownerName = owner.firstName ? `${owner.firstName} ${owner.lastName}` : (owner.username || 'Unknown'); return vault.manager || ownerName; })()} {(() => {
                                        // Vault tiles no longer show inline Assign button; manager assignment is available via Edit
                                      })()}</p>
                                      <p className="mt-0.5">Collections: {collectionCount}</p>
                                      {Number.isFinite(vaultValue) && <p className="mt-0.5 font-semibold">Value: ${vaultValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>}
                                      
                                    </div>
                                  </div>
                                </div>
                              </button>
                              <div className="flex gap-2 mt-2">
                                <button className="px-2 py-0.5 bg-blue-700 text-white rounded text-xs hover:bg-blue-800" onClick={(e) => { e.stopPropagation(); openEditVault(vault); }}>Edit</button>
                                {!sharedMode && (
                                  <button className="px-2 py-0.5 bg-green-700 text-white rounded text-xs hover:bg-green-800" onClick={(e) => { e.stopPropagation(); openShareDialog('vault', vault); }}>Share</button>
                                )}
                                
                                {(() => {
                                  return canDeleteVault(vault) ? (
                                    <button
                                      className="px-2 py-0.5 rounded text-xs bg-red-700 text-white hover:bg-red-800"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteVault(vault); }}
                                    >Delete</button>
                                  ) : null;
                                })()}
                              </div>
                              
                            </div>
                            );
                          })}
                        </div>
                      )
                      ) : (
                      displaySortedCollections.length === 0 ? (
                        <p className="text-neutral-500">No collections yet. Add one to start.</p>
                      ) : (
                        <div data-tut="collection-list" className="grid gap-2">
                          {displaySortedCollections.map((collection, idx) => renderCollectionTile(collection, idx))}
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="p-4 border border-neutral-900 rounded-xl bg-neutral-900/50 space-y-4 min-h-[500px] transition-all duration-300">
                  <div className="flex items-center justify-between">
                      <div data-tut="assets-panel">
                        <p className="text-lg font-semibold">{displaySelectedCollection ? "Assets" : "Collections"}</p>
                        <h3 className="text-sm text-neutral-400">{displaySelectedCollection ? displaySelectedCollection.name : (displaySelectedVault ? displaySelectedVault.name : "Organize within a vault")}</h3>
                      </div>
                    {(() => {
                      const targetVault = displaySelectedCollection ? (getVaultForCollection(displaySelectedCollection || selectedCollection) || displaySelectedVault) : (displaySelectedVault || null);
                      if (displaySelectedCollection) {
                        const canCreateAsset = displaySelectedCollection ? canCreateAssetInCollection(displaySelectedCollection) : false;
                        return canCreateAsset ? (
                          <button
                            className={`px-3 py-2 rounded w-10 h-10 flex items-center justify-center bg-blue-600 hover:bg-blue-700`}
                            onClick={(e) => { setShowAssetForm((v) => !v); setShowVaultForm(false); setShowCollectionForm(false); }}
                          >+
                          </button>
                        ) : null;
                      }
                      if (displaySelectedVault) {
                        const canCreateCollection = targetVault ? canCreateCollectionInVault(targetVault) : false;
                        return canCreateCollection ? (
                          <button
                            className={`px-3 py-2 rounded w-10 h-10 flex items-center justify-center bg-blue-600 hover:bg-blue-700`}
                            onClick={(e) => { setShowCollectionForm((v) => !v); setShowVaultForm(false); setShowAssetForm(false); }}
                          >+
                          </button>
                        ) : null;
                      }
                      return null;
                    })()}
                  </div>

                  <div className="flex flex-wrap gap-2 text-sm">
                    {!(showAssetForm || showVaultForm || showCollectionForm) && (displaySelectedCollection ? (
                      <>
                        <input className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 flex-1 min-w-[160px]" placeholder="Filter assets" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} />
                        <select className="px-3 py-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={assetSort} onChange={(e) => setAssetSort(e.target.value)}>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="name">Name</option>
                          <option value="highestValue">Highest Value</option>
                          <option value="lowestValue">Lowest Value</option>
                        </select>
                      </>
                    ) : (
                      <>
                        <input className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 flex-1 min-w-[160px]" placeholder="Filter collections" value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} />
                        <select className="px-3 py-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={collectionSort} onChange={(e) => setCollectionSort(e.target.value)}>
                          <option value="default">Default</option>
                          <option value="name">Name</option>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="highestValue">Highest Value</option>
                          <option value="lowestValue">Lowest Value</option>
                        </select>
                      </>
                    ))}
                  </div>

                    {displaySelectedVault && !displaySelectedCollection && showCollectionForm && (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const ok = handleAddCollection(); if (ok) setShowCollectionForm(false); }}>
                      <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Collection name" value={newCollection.name} onChange={(e) => setNewCollection((p) => ({ ...p, name: e.target.value }))} />
                      <textarea className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={2} placeholder="Description (optional)" maxLength={100} value={newCollection.description} onChange={(e) => setNewCollection((p) => ({ ...p, description: e.target.value }))} />
                      
                      <div className="space-y-3">
                        <div className="flex flex-col items-start gap-1">
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                            onChange={async (e) => { await handleUploadImages(e.target.files, setNewCollection); e.target.value = ""; }}
                          />
                          <div className="pt-1">
                            <p className="text-sm text-neutral-400">Images (max 4)</p>
                          </div>
                        </div>

                        {newCollection.images?.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {newCollection.images.map((img, idx) => {
                              const isHero = newCollection.heroImage === img;
                              return (
                                <div key={idx} className="relative border border-neutral-800 rounded overflow-hidden">
                                  <img src={img} alt={`Upload ${idx + 1}`} className="w-full h-28 object-cover" />
                                  <div className="absolute top-2 right-2 flex gap-1 items-center">
                                    {!isHero && (
                                      <button type="button" className="px-2 py-1 text-xs rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700" onClick={() => handleSetHero(img, setNewCollection)}>☆</button>
                                    )}
                                    {isHero && <span className="px-2 py-1 text-xs rounded bg-neutral-900 text-amber-400">★</span>}
                                    <button type="button" className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700" onClick={() => handleRemoveImage(idx, setNewCollection)}>Delete</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Create</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setShowCollectionForm(false); setNewCollection(initialCollectionState); }}>Cancel</button>
                      </div>
                    </form>
                  )}

                    {displaySelectedCollection && showAssetForm && (
                    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const ok = await handleAddAsset(); if (ok) setShowAssetForm(false); }}>
                      <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Title" maxLength={30} value={newAsset.title} onChange={(e) => setNewAsset((p) => ({ ...p, title: e.target.value }))} />
                      <select className="w-full p-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={newAsset.type} onChange={(e) => setNewAsset((p) => ({ ...p, type: e.target.value, category: "" }))}>
                        <option value="">Select Type</option>
                        <option value="Vehicle">Vehicle</option>
                        <option value="Property">Property</option>
                        <option value="Collectables">Collectables</option>
                        <option value="Business">Business</option>
                        <option value="Materials">Materials</option>
                        <option value="Specialty">Specialty</option>
                        <option value="Digital">Digital</option>
                        <option value="Equipment">Equipment</option>
                        <option value="Machinery">Machinery</option>
                        <option value="Other">Other</option>
                      </select>
                      <select className="w-full p-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={newAsset.category} onChange={(e) => setNewAsset((p) => ({ ...p, category: e.target.value }))} disabled={!newAsset.type}>
                        <option value="">Select Category</option>
                        {newAsset.type && categoryOptions[newAsset.type]?.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                          <textarea className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={3} placeholder="Description" maxLength={60} value={newAsset.description} onChange={(e) => setNewAsset((p) => ({ ...p, description: e.target.value }))} />
                          <div>
                            <label className="text-sm text-neutral-400">Manager</label>
                            <div className="relative">
                              <input autoComplete="off" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="manager name" value={newAsset.manager || ""} onChange={(e) => { setNewAsset((p) => ({ ...p, manager: e.target.value })); setShowShareSuggestions(false); }} onFocus={() => setShowShareSuggestions(false)} />
                            </div>
                          </div>
                          <div>
                            <label className="text-sm text-neutral-400">Quantity</label>
                            <input type="number" min={1} className="w-24 p-2 mt-1 rounded bg-neutral-950 border border-neutral-800" value={newAsset.quantity || 1} onChange={(e) => setNewAsset((p) => ({ ...p, quantity: e.target.value }))} />
                          </div>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                            <input 
                              className="w-full p-2 pl-7 rounded bg-neutral-950 border border-neutral-800" 
                              type="text" 
                              placeholder="0.00" 
                              value={formatCurrency(newAsset.value)} 
                              onChange={(e) => {
                                const cleaned = parseCurrency(e.target.value);
                                if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                                  setNewAsset((p) => ({ ...p, value: cleaned }));
                                }
                              }} 
                            />
                          </div>

                          <div>
                            <p className="text-sm text-neutral-400">Estimated value</p>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                              <input
                                className="w-full p-2 pl-7 rounded bg-neutral-950 border border-neutral-800"
                                type="text"
                                placeholder="0.00"
                                value={formatCurrency(newAsset.estimatedValue)}
                                onChange={(e) => {
                                  const cleaned = parseCurrency(e.target.value);
                                  if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                                    setNewAsset((p) => ({ ...p, estimatedValue: cleaned }));
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <p className="text-sm text-neutral-400">RRP</p>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                              <input
                                className="w-full p-2 pl-7 rounded bg-neutral-950 border border-neutral-800"
                                type="text"
                                placeholder="0.00"
                                value={formatCurrency(newAsset.rrp)}
                                onChange={(e) => {
                                  const cleaned = parseCurrency(e.target.value);
                                  if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                                    setNewAsset((p) => ({ ...p, rrp: cleaned }));
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <p className="text-sm text-neutral-400">Purchase Price</p>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                              <input
                                className="w-full p-2 pl-7 rounded bg-neutral-950 border border-neutral-800"
                                type="text"
                                placeholder="0.00"
                                value={formatCurrency(newAsset.purchasePrice)}
                                onChange={(e) => {
                                  const cleaned = parseCurrency(e.target.value);
                                  if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                                    setNewAsset((p) => ({ ...p, purchasePrice: cleaned }));
                                  }
                                }}
                              />
                            </div>
                          </div>

                      <div className="space-y-3">
                        <div className="flex flex-col items-start gap-1">
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                            onChange={async (e) => { await handleUploadImages(e.target.files, setNewAsset); e.target.value = ""; }}
                          />
                          <div className="pt-1">
                            <p className="text-sm text-neutral-400">Images (max 4)</p>
                          </div>
                        </div>

                        {newAsset.images?.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {newAsset.images.map((img, idx) => {
                              const isHero = newAsset.heroImage === img;
                              return (
                                <div key={idx} className="relative border border-neutral-800 rounded overflow-hidden">
                                  <img src={img} alt={`Upload ${idx + 1}`} className="w-full h-28 object-cover" />
                                  <div className="absolute top-2 right-2 flex gap-1 items-center">
                                    {!isHero && (
                                      <button type="button" className="px-2 py-1 text-xs rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700" onClick={() => handleSetHero(img, setNewAsset)}>☆</button>
                                    )}
                                    {isHero && <span className="px-2 py-1 text-xs rounded bg-neutral-900 text-amber-400">★</span>}
                                    <button type="button" className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700" onClick={() => handleRemoveImage(idx, setNewAsset)}>Delete</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Create</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setShowAssetForm(false); setNewAsset(initialAssetState); }}>Cancel</button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2">
                    {!displaySelectedVault ? (
                      <p className="text-neutral-500">Select a vault to view collections.</p>
                    ) : !displaySelectedCollection ? (
                      displaySortedCollections.length === 0 ? (
                        <p className="text-neutral-500">No collections yet. Add one to start.</p>
                      ) : (
                        <div data-tut="collection-list" className="grid gap-2">
                          {displaySortedCollections.map((collection, idx) => renderCollectionTile(collection, idx))}
                        </div>
                      )
                      ) : (
                      displaySortedAssets.length === 0 ? (
                        <div className="p-4 border border-neutral-800 rounded bg-neutral-900 text-neutral-400">No assets in this collection.</div>
                      ) : (
                        <div data-tut="asset-list" className="grid gap-2">
                          {displaySortedAssets.map((asset, idx) => {
                            const normalized = normalizeAsset(asset);
                            const hero = asset.heroImage || normalized.images[0] || DEFAULT_HERO;

                            return (
                              <div key={asset.id} data-tut={idx === 0 ? "asset-frame" : undefined} className="relative overflow-hidden p-3 rounded border border-neutral-800 bg-neutral-950 flex flex-col justify-between h-48">
                                <div className="flex gap-4">
                                  <div className="flex-shrink-0">
                                    <img src={hero} alt={asset.title} className="w-24 h-24 object-cover bg-neutral-800 cursor-pointer hover:opacity-90 transition-opacity rounded" onClick={() => openImageViewer(normalized.images, 0)} onError={(e) => { e.target.src = DEFAULT_HERO; }} />
                                    {sharedMode && (
                                      <p className="mt-2 text-xs text-neutral-300">Access: Delegate</p>
                                    )}
                                  </div>
                                  <div className="flex-1 flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold">{asset.title}</p>
                                        {permissionGrants.some((g) => g && g.scope_type === 'ASSET' && g.scope_id === asset.id) ? (
                                          <svg className="w-4 h-4 text-green-700" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.5 1.1 2.51 2.75 2.97 4.45h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                          </svg>
                                        ) : (
                                          <svg className="w-4 h-4 text-neutral-500" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.5 1.1 2.51 2.75 2.97 4.45h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                          </svg>
                                        )}
                                      </div>
                                      <div className="flex gap-2 items-center mt-1">
                                        <span className="text-xs px-2 py-1 rounded bg-emerald-900/50 border border-emerald-700 text-emerald-300">Asset</span>
                                      </div>
                                      <p className="text-xs text-neutral-400 mt-1">{asset.type || "No Type"} • {asset.category || "Uncategorized"}</p>
                                    </div>
                                    <div className="text-right text-xs text-white ml-4">
                                      <p>Created {new Date(asset.createdAt).toLocaleDateString()}</p>
                                      {asset.lastViewed && <p className="mt-0.5">Viewed {new Date(asset.lastViewed).toLocaleDateString()}</p>}
                                      {asset.lastEditedBy && <p className="mt-0.5">Edited by {(() => { const editor = users.find(u => u.username === asset.lastEditedBy) || {}; return editor.firstName ? `${editor.firstName} ${editor.lastName}` : (editor.username || asset.lastEditedBy); })()}</p>}
                                      <p className="mt-0.5">Manager: {(() => { const owner = users.find(u => u.id === asset.ownerId) || {}; const ownerName = owner.firstName ? `${owner.firstName} ${owner.lastName}` : (owner.username || 'Unknown'); return asset.manager || ownerName; })()}</p>
                                      <p className="mt-0.5 text-xs text-neutral-300 text-right">Quantity: {asset.quantity || 1}</p>
                                      {(() => { const v = parseFloat(asset.value); return Number.isFinite(v) ? <p className="mt-0.5 font-semibold">Value: ${v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p> : null; })()}
                                      
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2 mt-2">
                                  {(() => {
                                    const vault = getVaultForAsset(asset) || getVaultForCollection(displaySelectedCollection) || displaySelectedVault;
                                    const canEdit = hasAssetPermission(asset, 'Edit');
                                    const canDelete = hasAssetPermission(asset, 'Delete');
                                    const canMove = hasAssetPermission(asset, 'Move');
                                    const isOwner = vault && isOwnerOfVault(vault);
                                    return (
                                      <>
                                        <button
                                          className={`px-2 py-0.5 bg-blue-700 text-white rounded text-xs hover:bg-blue-800`}
                                          onClick={() => { openViewAsset(asset); }}
                                        >Edit</button>
                                        {!sharedMode && (
                                          <button
                                            className={`px-2 py-0.5 rounded text-xs ${isOwner ? "bg-green-700 text-white hover:bg-green-800" : "bg-neutral-800 text-neutral-400 cursor-not-allowed"}`}
                                            onClick={() => { if (!isOwner) return; openShareDialog('asset', asset); }}
                                            title={isOwner ? "" : "Only the vault owner can change sharing"}
                                          >Share</button>
                                        )}
                                        {canMove && (
                                          <button
                                            className="px-2 py-0.5 rounded text-xs bg-yellow-600 text-white hover:bg-yellow-700"
                                            onClick={(e) => { e.stopPropagation(); openMoveDialog(asset); }}
                                          >Move</button>
                                        )}
                                        {canDelete && (
                                          <button
                                            className="px-2 py-0.5 rounded text-xs bg-red-700 text-white hover:bg-red-800"
                                            onClick={() => { handleDeleteAsset(asset.id); }}
                                          >Delete</button>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                                
                              </div>
                            );
                          })}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-neutral-900 bg-neutral-950/90 backdrop-blur z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between text-xs text-neutral-400">
          <span>Liquid Asset Management Board</span>
          <span>{appVersion ? `v${appVersion}` : "Version unavailable"}</span>
        </div>
      </footer>

      {viewAsset && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={closeViewAsset}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 sm:p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-4 mb-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-400">Asset</p>
                <h3 className="text-xl font-semibold truncate">{viewAssetDraft.title || "Untitled"}</h3>
                <p className="text-sm text-neutral-500">{viewAssetDraft.category || "Uncategorized"}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800" onClick={closeViewAsset}>Close</button>
                <button disabled={!assetCanEdit} className={`px-3 py-1 rounded ${assetCanEdit ? 'bg-blue-600 hover:bg-blue-700' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`} onClick={handleUpdateViewAsset}>Save</button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <input disabled={!assetCanEdit} className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Title" maxLength={30} value={viewAssetDraft.title} onChange={(e) => setViewAssetDraft((p) => ({ ...p, title: e.target.value }))} />
                <select disabled={!assetCanEdit} className="w-full p-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={viewAssetDraft.type} onChange={(e) => setViewAssetDraft((p) => ({ ...p, type: e.target.value, category: "" }))}>
                  <option value="">Select Type</option>
                  <option value="Vehicle">Vehicle</option>
                  <option value="Property">Property</option>
                  <option value="Collectables">Collectables</option>
                  <option value="Business">Business</option>
                  <option value="Materials">Materials</option>
                  <option value="Specialty">Specialty</option>
                  <option value="Digital">Digital</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Machinery">Machinery</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <select className="w-full p-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={viewAssetDraft.category} onChange={(e) => setViewAssetDraft((p) => ({ ...p, category: e.target.value }))} disabled={!assetCanEdit || !viewAssetDraft.type}>
                <option value="">Select Category</option>
                {viewAssetDraft.type && categoryOptions[viewAssetDraft.type]?.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <textarea disabled={!assetCanEdit} className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={4} placeholder="Description" maxLength={60} value={viewAssetDraft.description} onChange={(e) => setViewAssetDraft((p) => ({ ...p, description: e.target.value }))} />
              <div>
                <label className="text-sm text-neutral-400">Manager</label>
                <div className="relative">
                  <input autoComplete="off" disabled={!assetCanEdit} className={`w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 ${!assetCanEdit ? 'opacity-60 cursor-not-allowed' : ''}`} placeholder="manager name" value={viewAssetDraft.manager || ""} onChange={(e) => { setViewAssetDraft((p) => ({ ...p, manager: e.target.value })); setShowShareSuggestions(false); }} onFocus={() => setShowShareSuggestions(false)} />
                </div>
              </div>
              <div>
                <p className="text-sm text-neutral-400 mb-2">Quantity</p>
                <input disabled={!assetCanEdit} type="number" min={1} className="w-24 p-2 rounded bg-neutral-950 border border-neutral-800" value={viewAssetDraft.quantity || 1} onChange={(e) => setViewAssetDraft((p) => ({ ...p, quantity: e.target.value }))} />
              </div>
              <div>
                <p className="text-sm text-neutral-400 mb-2">Value</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                  <input 
                    disabled={!assetCanEdit}
                    className="w-48 p-2 pl-7 rounded bg-neutral-950 border border-neutral-800" 
                    type="text" 
                    placeholder="0.00" 
                    value={formatCurrency(viewAssetDraft.value)} 
                    onChange={(e) => {
                      const cleaned = parseCurrency(e.target.value);
                      if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                        setViewAssetDraft((p) => ({ ...p, value: cleaned }));
                      }
                    }} 
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-neutral-400">Estimated value</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                  <input
                    disabled={!assetCanEdit}
                    className="w-48 p-2 pl-7 rounded bg-neutral-950 border border-neutral-800"
                    type="text"
                    placeholder="0.00"
                    value={formatCurrency(viewAssetDraft.estimatedValue)}
                    onChange={(e) => {
                      const cleaned = parseCurrency(e.target.value);
                      if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                        setViewAssetDraft((p) => ({ ...p, estimatedValue: cleaned }));
                      }
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-neutral-400">RRP</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                  <input
                    disabled={!assetCanEdit}
                    className="w-48 p-2 pl-7 rounded bg-neutral-950 border border-neutral-800"
                    type="text"
                    placeholder="0.00"
                    value={formatCurrency(viewAssetDraft.rrp)}
                    onChange={(e) => {
                      const cleaned = parseCurrency(e.target.value);
                      if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                        setViewAssetDraft((p) => ({ ...p, rrp: cleaned }));
                      }
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-neutral-400">Purchase Price</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                  <input
                    disabled={!assetCanEdit}
                    className="w-48 p-2 pl-7 rounded bg-neutral-950 border border-neutral-800"
                    type="text"
                    placeholder="0.00"
                    value={formatCurrency(viewAssetDraft.purchasePrice)}
                    onChange={(e) => {
                      const cleaned = parseCurrency(e.target.value);
                      if (cleaned === "" || !isNaN(parseFloat(cleaned))) {
                        setViewAssetDraft((p) => ({ ...p, purchasePrice: cleaned }));
                      }
                    }}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-neutral-400">Hero Image Preview</p>
                    <p className="text-xs text-neutral-500">Click to expand in viewer.</p>
                  </div>
                </div>
                <div className="w-full h-64 sm:h-80 md:h-96 max-h-[50vh] border-2 border-neutral-700 rounded-lg bg-neutral-950/50 flex items-center justify-center overflow-hidden">
                  <img src={viewAssetDraft.heroImage || viewAssetDraft.images?.[0] || DEFAULT_HERO} alt={viewAssetDraft.title} className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity" onClick={() => { const heroIdx = viewAssetDraft.images.indexOf(viewAssetDraft.heroImage); openImageViewer(viewAssetDraft.images, heroIdx >= 0 ? heroIdx : 0); }} onError={(e) => { e.target.src = DEFAULT_HERO; }} />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm text-neutral-400">Images (max 4)</p>
                  <p className="text-xs text-neutral-500">Upload, remove, and set hero.</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-4">
                  {viewAssetDraft.images?.sort((a, b) => {
                    if (a === viewAssetDraft.heroImage) return -1;
                    if (b === viewAssetDraft.heroImage) return 1;
                    return 0;
                  }).map((img, idx) => {
                    const isHero = viewAssetDraft.heroImage === img;
                    const originalIdx = viewAssetDraft.images.indexOf(img);
                    return (
                      <div key={originalIdx} className="relative border border-neutral-800 rounded overflow-hidden">
                        <img src={img} alt={`Edit ${idx + 1}`} className="w-full h-28 object-cover cursor-pointer hover:opacity-90 transition-opacity" onClick={() => openImageViewer(viewAssetDraft.images, originalIdx)} />
                        <div className="absolute top-2 right-2 flex gap-1 items-center">
                          {!isHero && (
                            <button disabled={!assetCanEdit} type="button" className={`px-2 py-1 text-xs rounded ${assetCanEdit ? 'bg-neutral-800 border border-neutral-700 hover:bg-neutral-700' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`} onClick={() => handleSetHero(img, setViewAssetDraft)}>☆</button>
                          )}
                          {isHero && <span className="px-2 py-1 text-xs rounded bg-neutral-900 text-amber-400">★</span>}
                          <button disabled={!assetCanEdit} type="button" className={`px-2 py-1 text-xs rounded ${assetCanEdit ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`} onClick={() => handleRemoveImage(originalIdx, setViewAssetDraft)}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                  
                  {(!viewAssetDraft.images || viewAssetDraft.images.length < 4) && (
                    <label className={`relative border-2 border-dashed border-neutral-700 rounded bg-neutral-800/50 ${assetCanEdit ? 'hover:bg-neutral-800 hover:border-neutral-600 cursor-pointer' : 'opacity-60 cursor-not-allowed' } transition-colors flex items-center justify-center h-28`}>
                      <span className="text-5xl text-neutral-500">+</span>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                          className="hidden"
                          disabled={!assetCanEdit}
                          onChange={async (e) => { await handleUploadImages(e.target.files, setViewAssetDraft); e.target.value = ""; }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {moveDialog.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-60 p-4" onClick={closeMoveDialog}>
          <div className="bg-neutral-900 border border-neutral-800 rounded p-4 text-sm text-neutral-200 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Move Asset</h3>
            <p className="text-xs text-neutral-400 mb-3">Choose a collection to move this asset into.</p>
            <div className="mb-3">
              <label className="block text-xs text-neutral-400 mb-1">Select Vault</label>
              <select
                value={moveDialog.targetVaultId || ""}
                onChange={(e) => setMoveDialog((d) => ({ ...d, targetVaultId: e.target.value ? String(e.target.value) : null, targetCollectionId: null }))}
                className="w-full p-2 pr-8 rounded bg-blue-600 text-white cursor-pointer"
                style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}}
              >
                <option value="">Select vault</option>
                {(() => {
                  const movingAsset = assets.find(a => a.id === moveDialog.assetId);
                  const ownerId = movingAsset ? (movingAsset.ownerId || getVaultOwnerId(getVaultForAsset(movingAsset))) : null;
                  return vaults
                    .filter(v => (!!ownerId ? String(getVaultOwnerId(v) || '') === String(ownerId) : true))
                    .map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ));
                })()}
              </select>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-neutral-400 mb-1">Select Collection</label>
              <select
                value={moveDialog.targetCollectionId || ""}
                onChange={(e) => setMoveDialog((d) => ({ ...d, targetCollectionId: e.target.value ? String(e.target.value) : null }))}
                className="w-full p-2 pr-8 rounded bg-blue-600 text-white cursor-pointer disabled:opacity-50"
                style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}}
                disabled={!moveDialog.targetVaultId}
              >
                <option value="">{moveDialog.targetVaultId ? "Select collection" : "Select a vault first"}</option>
                {(() => {
                  const movingAsset = assets.find(a => a.id === moveDialog.assetId);
                  const ownerId = movingAsset ? (movingAsset.ownerId || getVaultOwnerId(getVaultForAsset(movingAsset))) : null;
                  return collections
                    .filter(c => {
                      if (c.vaultId !== moveDialog.targetVaultId) return false;
                      if (c.id === (movingAsset?.collectionId)) return false;
                      if (!ownerId) return true;
                      const v = vaults.find(v => v && v.id === c.vaultId) || null;
                      const o = c.ownerId || getVaultOwnerId(v);
                      return String(o || '') === String(ownerId);
                    })
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ));
                })()}
              </select>
              {moveDialog.targetVaultId && collections.filter(c => c.vaultId === moveDialog.targetVaultId && c.id !== (assets.find(a => a.id === moveDialog.assetId)?.collectionId)).length === 0 && (
                <p className="text-xs text-neutral-500 mt-2">No other collections in this vault.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800" onClick={closeMoveDialog}>Cancel</button>
              <button className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700" onClick={handleMoveConfirm}>Move</button>
            </div>
          </div>
        </div>
      )}

      {collectionMoveDialog.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-60 p-4" onClick={closeCollectionMoveDialog}>
          <div className="bg-neutral-900 border border-neutral-800 rounded p-4 text-sm text-neutral-200 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Move Collection</h3>
            <p className="text-xs text-neutral-400 mb-3">Choose a vault to move this collection into.</p>
            <div className="mb-3">
              <label className="block text-xs text-neutral-400 mb-1">Select Vault</label>
              <select
                value={collectionMoveDialog.targetVaultId || ""}
                onChange={(e) => setCollectionMoveDialog((d) => ({ ...d, targetVaultId: e.target.value ? String(e.target.value) : null }))}
                className="w-full p-2 pr-8 rounded bg-blue-600 text-white cursor-pointer"
                style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}}
              >
                <option value="">Select vault</option>
                {(() => {
                  const movingCollection = collections.find(c => c.id === collectionMoveDialog.collectionId);
                  const ownerId = movingCollection ? (movingCollection.ownerId || getVaultOwnerId(getVaultForCollection(movingCollection))) : null;
                  return vaults
                    .filter(v => v.id !== (movingCollection?.vaultId) && (!!ownerId ? String(getVaultOwnerId(v) || '') === String(ownerId) : true))
                    .map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ));
                })()}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800" onClick={closeCollectionMoveDialog}>Cancel</button>
              <button className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700" onClick={handleCollectionMoveConfirm}>Move</button>
            </div>
          </div>
        </div>
      )}

      

      {confirmDialog.show && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setConfirmDialog({ show: false, title: "", message: "", onConfirm: null })}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-semibold mb-3">{confirmDialog.title}</h3>
            <p className="text-neutral-300 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button className="px-4 py-2 rounded border border-neutral-700 hover:bg-neutral-800" onClick={() => setConfirmDialog({ show: false, title: "", message: "", onConfirm: null })}>Cancel</button>
              <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700" onClick={confirmDialog.onConfirm}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {shareDialog.show && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeShareDialog}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-xl w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-semibold mb-3">{(() => {
              if (shareDialog.type === 'collection') return `Share ${collections.find(c => c.id === shareDialog.targetId)?.name || 'Collection'}`;
              if (shareDialog.type === 'asset') return `Share ${assets.find(a => a.id === shareDialog.targetId)?.title || 'Asset'}`;
              return `Share ${vaults.find(v => v.id === shareDialog.targetId)?.name || 'Vault'}`;
            })()}</h3>
            <p className="text-sm text-neutral-400 mb-4">{shareDialog.type === 'vault' ? 'Invite by email (paid feature; owners can revoke pending invites).' : 'Grant access to an existing vault member by uid/email/username.'}</p>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-neutral-400">User</label>
                <div className="relative">
                  <input autoComplete="off" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" placeholder={shareDialog.type === 'vault' ? 'email address' : 'member uid / email / username'} value={shareDialog.username} onChange={(e) => { setShareDialog((d) => ({ ...d, username: e.target.value })); setShowShareSuggestions(false); }} onFocus={() => setShowShareSuggestions(false)} />
                </div>
              </div>
              <div>
                <label className="text-sm text-neutral-400">Delegate permissions</label>
                <div className="mt-2 flex flex-wrap gap-3">
                  {PERMISSION_KEYS.map((key) => {
                    const isView = key === 'View';
                    const checked = isView ? true : !!shareDialog.permissions?.[key];
                    return (
                      <label key={key} className="flex items-center gap-2 text-sm text-neutral-300">
                        <input
                          type="checkbox"
                          disabled={isView}
                          checked={checked}
                          onChange={(e) => setShareDialog((d) => ({
                            ...d,
                            permissions: { ...(d.permissions || { View: true }), [key]: e.target.checked, View: true },
                          }))}
                        />
                        {key}
                      </label>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <h4 className="text-sm font-medium text-neutral-400 mb-2">Current Access</h4>
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {(() => {
                      let sharedUsers = [];
                      if (shareDialog.type === 'vault') {
                        sharedUsers = (vaultMemberships || [])
                          .filter(m => m && m.vault_id === shareDialog.targetId && m.status !== 'REVOKED')
                          .map(m => ({ userId: m.user_id, permissions: m.permissions }));
                      } else if (shareDialog.type === 'collection') {
                        sharedUsers = (permissionGrants || [])
                          .filter(g => g && g.scope_type === 'COLLECTION' && g.scope_id === shareDialog.targetId)
                          .map(g => ({ userId: g.user_id, permissions: g.permissions }));
                      } else if (shareDialog.type === 'asset') {
                        sharedUsers = (permissionGrants || [])
                          .filter(g => g && g.scope_type === 'ASSET' && g.scope_id === shareDialog.targetId)
                          .map(g => ({ userId: g.user_id, permissions: g.permissions }));
                      }

                      if (sharedUsers.length === 0) {
                        return <div className="text-sm text-neutral-500 py-2">No users have access yet.</div>;
                      }

                      return sharedUsers.map((share) => {
                        const label = share.userId === currentUser?.id
                          ? (currentUser?.username || currentUser?.email || 'You')
                          : (share.userId || 'Unknown');
                        const perms = normalizePermissions(share.permissions);
                        return (
                          <div key={share.userId} className="bg-neutral-950/40 p-3 rounded flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">{label}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {PERMISSION_KEYS.filter(k => k !== 'View').map((k) => (
                                <label key={k} className="flex items-center gap-1 text-xs text-neutral-200">
                                  <input
                                    type="checkbox"
                                    checked={!!perms[k]}
                                    onChange={(e) => updateAccessPermissionForUser(share.userId, k, e.target.checked)}
                                  />
                                  {k}
                                </label>
                              ))}
                              <button 
                                className="text-xs px-2 py-1 bg-red-700 hover:bg-red-800 rounded" 
                                onClick={() => {
                                  if (shareDialog.type === 'vault') {
                                    revokeVaultMembership(shareDialog.targetId, share.userId);
                                  } else if (shareDialog.type === 'collection') {
                                    const c = collections.find(x => x && x.id === shareDialog.targetId);
                                    if (c) revokePermissionGrant(c.vaultId, 'COLLECTION', c.id, share.userId);
                                  } else if (shareDialog.type === 'asset') {
                                    const a = assets.find(x => x && x.id === shareDialog.targetId);
                                    const c = a ? collections.find(x => x && x.id === a.collectionId) : null;
                                    if (a && c) revokePermissionGrant(c.vaultId, 'ASSET', a.id, share.userId);
                                  }
                                  showAlert(`Removed ${label} access`);
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {shareDialog.type === 'vault' && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-neutral-400 mb-2">Pending Invitations</h4>
                    {vaultInvitationsLoading && <div className="text-sm text-neutral-500 py-2">Loading invitations…</div>}
                    {!vaultInvitationsLoading && vaultInvitationsError && (
                      <div className="text-sm text-neutral-500 py-2">{vaultInvitationsError}</div>
                    )}
                    {!vaultInvitationsLoading && !vaultInvitationsError && (
                      (() => {
                        const pending = (vaultInvitations || []).filter((i) => i && i.status === 'PENDING');
                        if (pending.length === 0) return <div className="text-sm text-neutral-500 py-2">No pending invitations.</div>;
                        return (
                          <div className="space-y-2 max-h-40 overflow-auto">
                            {pending.map((inv) => (
                              <div key={inv.id} className="bg-neutral-950/40 p-3 rounded flex items-center justify-between">
                                <div>
                                  <div className="text-sm font-medium">{inv.invitee_email || inv.id}</div>
                                  <div className="text-xs text-neutral-500">{inv.expiresAt ? `Expires ${new Date(inv.expiresAt).toLocaleDateString()}` : ''}</div>
                                </div>
                                <button
                                  className="text-xs px-2 py-1 bg-red-700 hover:bg-red-800 rounded"
                                  onClick={async () => {
                                    try {
                                      await revokeVaultInvitation(shareDialog.targetId, inv.id);
                                      showAlert('Invitation revoked');
                                    } catch (err) {
                                      showAlert(err?.message ? String(err.message) : 'Failed to revoke invitation');
                                    }
                                  }}
                                >
                                  Revoke
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-4">
              <button className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800" onClick={closeShareDialog}>Close</button>
              <button className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700" onClick={handleShareConfirm}>Share</button>
            </div>
          </div>
        </div>
      )}

      

      {editDialog.show && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeEditDialog}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-semibold mb-3">{editDialog.type === "vault" ? "Edit Vault" : "Edit Collection"}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-neutral-400">Name</label>
                <input
                  disabled={!editCanEdit}
                  className={`w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 ${!editCanEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                  value={editDialog.name}
                  onChange={(e) => setEditDialog((prev) => ({ ...prev, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-neutral-400">Description</label>
                <textarea
                  disabled={!editCanEdit}
                  className={`w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 ${!editCanEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                  rows={3}
                  maxLength={100}
                  placeholder="Optional description"
                  value={editDialog.description}
                  onChange={(e) => setEditDialog((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-neutral-400">Manager</label>
                <div className="relative">
                  <input autoComplete="off" disabled={!editCanEdit} className={`w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 ${!editCanEdit ? 'opacity-60 cursor-not-allowed' : ''}`} placeholder="manager name" value={editDialog.manager} onChange={(e) => { setEditDialog((prev) => ({ ...prev, manager: e.target.value })); setShowShareSuggestions(false); }} onFocus={() => setShowShareSuggestions(false)} />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col items-start gap-1">
                  <input
                    disabled={!editCanEdit}
                    type="file"
                    multiple
                    accept="image/*"
                    className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                    onChange={async (e) => { await handleUploadImages(e.target.files, setEditDialog); e.target.value = ""; }}
                  />
                  <div className="pt-1">
                    <p className="text-sm text-neutral-400">Images (max 4)</p>
                  </div>
                </div>

                {editDialog.images?.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {editDialog.images.map((img, idx) => {
                      const isHero = editDialog.heroImage === img;
                      return (
                        <div key={idx} className="relative border border-neutral-800 rounded overflow-hidden">
                          <img src={img} alt={`Upload ${idx + 1}`} className="w-full h-28 object-cover" />
                          <div className="absolute top-2 right-2 flex gap-1 items-center">
                            {!isHero && (
                              <button disabled={!editCanEdit} type="button" title="Set as hero" className={`px-2 py-1 text-xs rounded ${editCanEdit ? 'bg-neutral-800 border border-neutral-700 hover:bg-neutral-700' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`} onClick={() => handleSetHero(img, setEditDialog)}>☆</button>
                            )}
                            {isHero && <span className="px-2 py-1 text-xs rounded bg-neutral-900 text-amber-400">★</span>}
                            <button disabled={!editCanEdit} type="button" title="Delete image" aria-label={`Delete image ${idx+1}`} className={`px-2 py-1 text-xs rounded ${editCanEdit ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`} onClick={() => handleRemoveImage(idx, setEditDialog)}>Delete</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <button className="px-4 py-2 rounded border border-neutral-700 hover:bg-neutral-800" onClick={closeEditDialog}>Cancel</button>
                <button disabled={!editCanEdit} className={`px-4 py-2 rounded ${editCanEdit ? 'bg-blue-600 hover:bg-blue-700' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`} onClick={saveEditDialog}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {imageViewer.show && imageViewer.images.length > 0 && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4" onClick={closeImageViewer}>
          <div className="flex flex-col items-center justify-center gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              <button className="absolute -top-12 right-0 px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-white z-10" onClick={closeImageViewer}>Close (Esc)</button>
              
              {imageViewer.images.length > 1 && (
                <>
                  <button className="absolute -left-16 top-1/2 -translate-y-1/2 px-4 py-8 rounded bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-600 text-white text-2xl z-10" onClick={prevImage}>‹</button>
                  <button className="absolute -right-16 top-1/2 -translate-y-1/2 px-4 py-8 rounded bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-600 text-white text-2xl z-10" onClick={nextImage}>›</button>
                </>
              )}

              <div className="w-[1000px] h-[700px] border-2 border-neutral-700 rounded-lg bg-neutral-950/50 flex items-center justify-center">
                <img src={imageViewer.images[imageViewer.currentIndex]} alt="" className="max-w-full max-h-full object-contain" onError={(e) => { e.target.src = DEFAULT_HERO; }} />
              </div>
            </div>
            
            {imageViewer.images.length > 1 && (
              <div className="flex gap-2 justify-center flex-wrap max-w-md">
                {imageViewer.images.map((img, idx) => (
                  <img key={idx} src={img} alt="" className={`w-16 h-16 object-cover rounded cursor-pointer border-2 transition-all ${idx === imageViewer.currentIndex ? 'border-blue-500 scale-110' : 'border-neutral-600 hover:border-blue-400 opacity-70 hover:opacity-100'}`} onClick={() => setImageViewer(prev => ({ ...prev, currentIndex: idx }))} onError={(e) => { e.target.style.display = "none"; }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
