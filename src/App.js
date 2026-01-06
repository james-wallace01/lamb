import React, { useEffect, useRef, useState } from "react";

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

export default function App() {
  const storedUser = safeParse("currentUser", null);
  const initialPathView = pathToView(window.location.pathname);
  const initialView = (() => {
    if ((initialPathView === "vault" || initialPathView === "profile") && !storedUser) return "login";
    if (storedUser && (initialPathView === "login" || initialPathView === "landing")) return "home";
    return initialPathView;
  })();

  const [users, setUsers] = useState(() => safeParse("users", []));
  const [currentUser, setCurrentUser] = useState(() => storedUser);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!storedUser);
  const [view, setView] = useState(initialView);
  const [previousView, setPreviousView] = useState(null);
  const [vaults, setVaults] = useState(() => safeParse("vaults", []));
  const [collections, setCollections] = useState(() => safeParse("collections", []));
  const [assets, setAssets] = useState(() => safeParse("assets", []));

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
  const [shareDialog, setShareDialog] = useState({ show: false, type: 'vault', targetId: null, username: "", role: 'viewer', canCreateCollections: false, canCreateAssets: false });
  const [showShareSuggestions, setShowShareSuggestions] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  const ROLES = ['viewer', 'editor', 'manager'];

  const updateUserRole = (userId, newRole) => {
    if (shareDialog.type === 'vault') {
      setVaults(prev => prev.map(v => v.id === shareDialog.targetId ? { ...v, sharedWith: (v.sharedWith || []).map(sw => sw.userId === userId ? { ...sw, role: newRole } : sw) } : v));
    } else if (shareDialog.type === 'collection') {
      setCollections(prev => prev.map(c => c.id === shareDialog.targetId ? { ...c, sharedWith: (c.sharedWith || []).map(sw => sw.userId === userId ? { ...sw, role: newRole } : sw) } : c));
    } else if (shareDialog.type === 'asset') {
      setAssets(prev => prev.map(a => a.id === shareDialog.targetId ? { ...a, sharedWith: (a.sharedWith || []).map(sw => sw.userId === userId ? { ...sw, role: newRole } : sw) } : a));
    }
    showAlert(`Updated role to ${newRole}`);
  };

  const updateCreatePermission = (userId, field, value) => {
    if (shareDialog.type === 'vault' && field === 'canCreateCollections') {
      setVaults(prev => prev.map(v => v.id === shareDialog.targetId ? { ...v, sharedWith: (v.sharedWith || []).map(sw => sw.userId === userId ? { ...sw, [field]: !!value } : sw) } : v));
    } else if (shareDialog.type === 'collection' && field === 'canCreateAssets') {
      setCollections(prev => prev.map(c => c.id === shareDialog.targetId ? { ...c, sharedWith: (c.sharedWith || []).map(sw => sw.userId === userId ? { ...sw, [field]: !!value } : sw) } : c));
    }
  };
  const [viewAsset, setViewAsset] = useState(null);
  const [viewAssetDraft, setViewAssetDraft] = useState(initialAssetState);
  const [imageViewer, setImageViewer] = useState({ show: false, images: [], currentIndex: 0 });
  const [editDialog, setEditDialog] = useState({ show: false, type: null, item: null, name: "", description: "", manager: "", images: [], heroImage: "" });

  const openShareDialog = (type, target) => {
    setShareDialog({ show: true, type: type || 'vault', targetId: target?.id || null, username: "", role: 'viewer', canCreateCollections: false, canCreateAssets: false });
    setShowShareSuggestions(false);
  };

  const openManagerDialog = (type, item) => {
    setManagerDialog({ show: true, type, id: item.id, username: item.manager || "" });
    setShowShareSuggestions(false);
  };

  const closeManagerDialog = () => setManagerDialog({ show: false, type: null, id: null, username: "" });

  const handleManagerConfirm = () => {
    if (!managerDialog.username) return showAlert("Enter a username or email to assign.");
    const user = users.find(u => u.username === managerDialog.username || `${u.firstName} ${u.lastName}` === managerDialog.username || u.email === managerDialog.username);
    if (!user) return showAlert("User not found.");
    const fullName = (user.firstName || user.lastName) ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : user.username;
    if (managerDialog.type === 'vault') {
      setVaults((prev) => prev.map(v => v.id === managerDialog.id ? { ...v, manager: fullName } : v));
    } else if (managerDialog.type === 'collection') {
      setCollections((prev) => prev.map(c => c.id === managerDialog.id ? { ...c, manager: fullName } : c));
    } else if (managerDialog.type === 'asset') {
      setAssets((prev) => prev.map(a => a.id === managerDialog.id ? { ...a, manager: fullName } : a));
    }
    showAlert(`Assigned manager ${fullName}`);
    closeManagerDialog();
  };

  const closeShareDialog = () => { setShareDialog({ show: false, type: 'vault', targetId: null, username: "", role: 'viewer', canCreateCollections: false, canCreateAssets: false }); setShowShareSuggestions(false); };

  const handleShareConfirm = () => {
    if (!shareDialog.username) return showAlert("Enter a username to share with.");
    const user = users.find(u => u.username === shareDialog.username || `${u.firstName} ${u.lastName}` === shareDialog.username || u.email === shareDialog.username);
    if (!user) return showAlert("User not found.");
    if (currentUser && user.id === currentUser.id) {
      showAlert("You cannot share with yourself.");
      return;
    }
    
    const role = shareDialog.role || 'viewer';
    const canCreateCollections = !!shareDialog.canCreateCollections;
    const canCreateAssets = !!shareDialog.canCreateAssets;

    if (shareDialog.type === 'vault') {
      setVaults((prev) => prev.map(v => {
        if (v.id !== shareDialog.targetId) return v;
        const existing = v.sharedWith || [];
        if (existing.find(s => s.userId === user.id)) return v;
        return { ...v, sharedWith: [...existing, { userId: user.id, username: user.username, role, canCreateCollections }] };
      }));
      showAlert(`Shared vault with ${user.username}`);
    } else if (shareDialog.type === 'collection') {
      setCollections((prev) => prev.map(c => {
        if (c.id !== shareDialog.targetId) return c;
        const existing = c.sharedWith || [];
        if (existing.find(s => s.userId === user.id)) return c;
        return { ...c, sharedWith: [...existing, { userId: user.id, username: user.username, role, canCreateAssets }] };
      }));
      showAlert(`Shared collection with ${user.username}`);
    } else if (shareDialog.type === 'asset') {
      setAssets((prev) => prev.map(a => {
        if (a.id !== shareDialog.targetId) return a;
        const existing = a.sharedWith || [];
        if (existing.find(s => s.userId === user.id)) return a;
        return { ...a, sharedWith: [...existing, { userId: user.id, username: user.username, role }] };
      }));
      showAlert(`Shared asset with ${user.username}`);
    }

    setShareDialog((d) => ({ ...d, username: "", role: 'viewer' }));
    setShowShareSuggestions(false);
  };

  const [alert, setAlert] = useState("");
  const alertTimeoutRef = useRef(null);

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

  // Permission helpers: check role-based permissions
  const getRoleForVault = (vault) => {
    if (!vault || !currentUser) return null;
    if (vault.ownerId === currentUser.id) return "owner";
    const shared = vault.sharedWith || [];
    const entry = shared.find(s => s.userId === currentUser.id || s.username === currentUser.username || s.email === currentUser.email);
    return entry ? entry.role : null;
  };

  const canCreateCollectionInVault = (vault) => {
    if (!vault || !currentUser) return false;
    if (vault.ownerId === currentUser.id) return true;
    const entry = (vault.sharedWith || []).find(s => s.userId === currentUser.id || s.username === currentUser.username || s.email === currentUser.email);
    return !!entry?.canCreateCollections;
  };

  const canCreateAssetInCollection = (collection) => {
    if (!collection || !currentUser) return false;
    if (collection.ownerId === currentUser.id) return true;
    const entry = (collection.sharedWith || []).find(s => s.userId === currentUser.id || s.username === currentUser.username || s.email === currentUser.email);
    return !!entry?.canCreateAssets;
  };

  const canEditInVault = (vault) => {
    if (!vault) return false;
    const role = getRoleForVault(vault);
    return role === "owner" || role === "editor" || role === "manager";
  };

  const canMoveInVault = (vault) => {
    if (!vault) return false;
    const role = getRoleForVault(vault);
    return role === "owner" || role === "manager";
  };

  const canDeleteInVault = (vault) => {
    if (!vault) return false;
    const role = getRoleForVault(vault);
    return role === "owner";
  };

  const getVaultForCollection = (collection) => (collection ? vaults.find(v => v.id === collection.vaultId) || null : null);
  const getVaultForAsset = (asset) => {
    const col = asset ? collections.find(c => c.id === asset.collectionId) : null;
    return col ? vaults.find(v => v.id === col.vaultId) || null : null;
  };

  const getRoleForCollection = (collection) => {
    if (!collection || !currentUser) return null;
    if (collection.ownerId === currentUser.id) return "owner";
    const entry = (collection.sharedWith || []).find(s => s.userId === currentUser.id || s.username === currentUser.username || s.email === currentUser.email);
    return entry ? entry.role : null;
  };

  const getRoleForAsset = (asset) => {
    if (!asset || !currentUser) return null;
    if (asset.ownerId === currentUser.id) return "owner";
    const entry = (asset.sharedWith || []).find(s => s.userId === currentUser.id || s.username === currentUser.username || s.email === currentUser.email);
    return entry ? entry.role : null;
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

  const ensureDefaultVaultForUser = (user) => {
    if (!user) return null;
    // If the user previously deleted their default example vault, don't recreate it.
    try {
      const deletedFlag = localStorage.getItem(`defaultVaultDeleted_${user.id}`);
      if (deletedFlag === "true") return null;
    } catch (e) {
      // ignore storage errors
    }

    // Check if default vault already exists
    const existingVault = vaults.find((v) => v.ownerId === user.id && v.isDefault);
    if (existingVault) return existingVault;

    // Create vault
    const vaultId = Date.now();
    const vault = {
      id: vaultId,
      ownerId: user.id,
      name: "Example Vault",
      description: "Your first vault for organizing collections",
      isPrivate: true,
      isDefault: true,
      createdAt: user.createdAt || new Date().toISOString(),
      lastViewed: user.createdAt || new Date().toISOString(),
      lastEditedBy: user.username,
      heroImage: DEFAULT_HERO,
      images: [],
    };
    setVaults((prev) => [vault, ...prev]);

    // Create collection
    const collectionId = vaultId + 1;
    const collection = {
      id: collectionId,
      ownerId: user.id,
      vaultId: vaultId,
      name: "Example Collection",
      description: "Your first collection for storing assets",
      isPrivate: true,
      isDefault: true,
      createdAt: user.createdAt || new Date().toISOString(),
      lastViewed: user.createdAt || new Date().toISOString(),
      lastEditedBy: user.username,
      heroImage: DEFAULT_HERO,
      images: [],
    };
    setCollections((prev) => [collection, ...prev]);

    // Create asset
    const asset = {
      id: vaultId + 2,
      ownerId: user.id,
      collectionId: collectionId,
      title: "Example Asset",
      type: "Collectables",
      category: "Art",
      description: "This is an example asset to get you started",
      value: 1000,
      heroImage: DEFAULT_HERO,
      images: [],
      createdAt: user.createdAt || new Date().toISOString(),
      lastViewed: user.createdAt || new Date().toISOString(),
      lastEditedBy: user.username,
    };
    setAssets((prev) => [asset, ...prev]);

    return vault;
  };

  const openEditVault = (vault) => setEditDialog({ show: true, type: "vault", item: vault, name: vault.name, description: vault.description || "", manager: vault.manager || "", images: vault.images || [], heroImage: vault.heroImage || "" });
  const openEditCollection = (collection) => setEditDialog({ show: true, type: "collection", item: collection, name: collection.name, description: collection.description || "", manager: collection.manager || "", images: collection.images || [], heroImage: collection.heroImage || "" });
  const closeEditDialog = () => setEditDialog({ show: false, type: null, item: null, name: "", description: "" });

  const saveEditDialog = () => {
    const name = (editDialog.name || "").trim();
    if (!name) {
      showAlert("Name is required.");
      return;
    }
    if (editDialog.type === "vault" && editDialog.item) {
      // enforce vault-level edit permission
      const vault = editDialog.item;
      const permOk = (vault.ownerId === currentUser?.id) || canEditInVault(vault);
      if (!permOk) {
        showAlert("You don't have permission to edit this vault.");
        closeEditDialog();
        return;
      }
      const description = (editDialog.description || "").trim();
      const manager = (editDialog.manager || "").trim();
      const images = trimToFour(editDialog.images || []);
      const heroImage = editDialog.heroImage || images[0] || DEFAULT_HERO;
      setVaults((prev) => prev.map((v) => (v.id === editDialog.item.id ? { ...v, name, description, manager, images, heroImage, lastEditedBy: currentUser?.username || 'Unknown' } : v)));
      if (selectedVaultId === editDialog.item.id) {
        setSelectedVaultId(editDialog.item.id);
      }
    }
    if (editDialog.type === "collection" && editDialog.item) {
      // enforce collection-level edit permission via vault
      const vault = getVaultForCollection(editDialog.item);
      const permOk = (editDialog.item.ownerId === currentUser?.id) || (vault && (vault.ownerId === currentUser?.id || canEditInVault(vault)));
      if (!permOk) {
        showAlert("You don't have permission to edit this collection.");
        closeEditDialog();
        return;
      }
      const description = (editDialog.description || "").trim();
      const manager = (editDialog.manager || "").trim();
      const images = trimToFour(editDialog.images || []);
      const heroImage = editDialog.heroImage || images[0] || DEFAULT_HERO;
      setCollections((prev) => prev.map((c) => (c.id === editDialog.item.id ? { ...c, name, description, manager, images, heroImage, lastEditedBy: currentUser?.username || 'Unknown' } : c)));
      if (selectedCollectionId === editDialog.item.id) {
        setSelectedCollectionId(editDialog.item.id);
      }
    }
    closeEditDialog();
    showAlert("Updated.");
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

  const logout = () => {
    setIsLoggedIn(false);
    setCurrentUser(null);
    setSelectedVaultId(null);
    setSelectedCollectionId(null);
    setShowVaultForm(false);
    setShowCollectionForm(false);
    setShowAssetForm(false);
    navigateTo("landing", { replace: true });
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const username = loginForm.username.trim();
    const password = loginForm.password.trim();
    const user = users.find((u) => u.username === username && u.password === password);
    if (!user) {
      showAlert("Invalid credentials.");
      return;
    }
    setCurrentUser(user);
    setIsLoggedIn(true);
    ensureDefaultVaultForUser(user);
    setSelectedVaultId(null);
    setSelectedCollectionId(null);
    setShowVaultForm(false);
    setShowCollectionForm(false);
    setShowAssetForm(false);
    navigateTo("home");
  };

  const handleRegister = (e) => {
    e.preventDefault();
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
    if (users.some((u) => u.username === username)) {
      showAlert("Username already taken.");
      return;
    }
    if (users.some((u) => u.email === email)) {
      showAlert("Email already in use.");
      return;
    }

    const newUser = { id: Date.now(), firstName, lastName, email, username, password, profileImage: registerForm.profileImage || DEFAULT_AVATAR, createdAt: new Date().toISOString() };
    const updatedUsers = [...users, newUser];
    setUsers(updatedUsers);
    setCurrentUser(newUser);
    setIsLoggedIn(true);
    ensureDefaultVaultForUser(newUser);
    setSelectedVaultId(null);
    setSelectedCollectionId(null);
    setShowVaultForm(false);
    setShowCollectionForm(false);
    setShowAssetForm(false);
    navigateTo("home");
    setRegisterForm(initialRegisterForm);
  };

  useEffect(() => {
    localStorage.setItem("users", JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
    } else {
      localStorage.removeItem("currentUser");
    }
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem("vaults", JSON.stringify(vaults));
  }, [vaults]);

  useEffect(() => {
    localStorage.setItem("collections", JSON.stringify(collections));
  }, [collections]);

  useEffect(() => {
    safeSetItem("assets", JSON.stringify(assets));
  }, [assets]);

  useEffect(() => {
    let isMounted = true;
    fetch('/version.json')
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

  // One-time migration to recompress stored images to smaller size/quality to save storage
  useEffect(() => {
    const migrate = async () => {
      const migratedFlag = localStorage.getItem("assetsCompressedV1");
      if (migratedFlag === "true") return;
      if (!assets || assets.length === 0) {
        localStorage.setItem("assetsCompressedV1", "true");
        return;
      }
      try {
        const updated = [];
        for (const asset of assets) {
          const images = asset.images || [];
          const newImages = [];
          for (const img of images) {
            try {
              const recompressed = await recompressDataUrl(img);
              newImages.push(recompressed || img);
            } catch (err) {
              newImages.push(img);
            }
          }
          const hero = asset.heroImage && images.includes(asset.heroImage)
            ? newImages[images.indexOf(asset.heroImage)] || newImages[0] || asset.heroImage
            : newImages[0] || asset.heroImage;
          updated.push({ ...asset, images: newImages, heroImage: hero });
        }
        setAssets(updated);
        localStorage.setItem("assetsCompressedV1", "true");
      } catch (err) {
        console.warn("Asset recompression failed", err);
      }
    };
    migrate();
  }, []);

  useEffect(() => {
    if (isLoggedIn && currentUser) ensureDefaultVaultForUser(currentUser);
  }, [isLoggedIn, currentUser]);

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

      const defaultVault = vaults.find((v) => v.ownerId === currentUser.id && v.isDefault);
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

  const handleAddVault = () => {
    // Block vault creation while viewing shared vaults
    if (sharedMode) {
      showAlert("You can't create a vault while viewing a shared vault.");
      return false;
    }
    if (!newVault.name.trim()) {
      showAlert("Vault name is required.");
      return false;
    }
    if (!currentUser) return false;
    const images = trimToFour(newVault.images || []);
    const heroImage = newVault.heroImage || images[0] || DEFAULT_HERO;
    // If we're in shared mode and an owner has been chosen, create the vault under that owner.
    // Only allow this if the current user has been granted 'create' permission by that owner.
    const ownerId = (sharedMode && sharedOwnerId) ? sharedOwnerId : currentUser.id;

    if (ownerId !== currentUser.id) {
      // Gather all shared entries from the chosen owner's existing vaults
      const ownerVaults = vaults.filter(v => v.ownerId === ownerId);
      const sharedEntries = ownerVaults.flatMap(v => (v.sharedWith || []).map(s => ({ ...s, vaultId: v.id })));
      const entry = sharedEntries.find(s => s.userId === currentUser.id || s.username === currentUser.username || s.email === currentUser.email);
      if (!entry) {
        showAlert("You don't have permission to create a vault for that user.");
        return false;
      }
      // Use the role from the owner's existing share entry when sharing the new vault back
      const sharedRole = entry.role || "viewer";
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
      setVaults((prev) => [vault, ...prev]);
      setNewVault(initialVaultState);
      return true;
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
    setVaults((prev) => [vault, ...prev]);
    setNewVault(initialVaultState);
    return true;
  };

  const handleAddCollection = () => {
    if (!selectedVaultId) {
      showAlert("Select a vault first.");
      return false;
    }
    if (!newCollection.name.trim()) {
      showAlert("Collection name is required.");
      return false;
    }
    if (!currentUser) return false;
    const images = trimToFour(newCollection.images || []);
    const heroImage = newCollection.heroImage || images[0] || DEFAULT_HERO;
    
    
    
    const vault = vaults.find(v => v.id === selectedVaultId);
    const ownerId = (vault && vault.ownerId) ? vault.ownerId : ((sharedMode && sharedOwnerId) ? sharedOwnerId : currentUser.id);

    if (ownerId !== currentUser.id) {
      // Require explicit create permission on the target vault
      if (!canCreateCollectionInVault(vault)) {
        showAlert("You don't have permission to create a collection in this vault.");
        return false;
      }
    }

    const baseCollection = { id: Date.now(), ownerId: ownerId, vaultId: selectedVaultId, name: newCollection.name.trim(), description: newCollection.description.trim(), manager: (newCollection.manager || "").trim(), isPrivate: true, isDefault: false, createdAt: new Date().toISOString(), lastViewed: new Date().toISOString(), lastEditedBy: currentUser.username, heroImage, images };
    const collection = (ownerId === currentUser.id)
      ? baseCollection
      : { ...baseCollection, sharedWith: [{ userId: currentUser.id, username: currentUser.username, role: 'manager' }] };
    setCollections((prev) => [collection, ...prev]);
    setNewCollection(initialCollectionState);
    return true;
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

    const collection = collections.find(c => c.id === selectedCollectionId);
    const ownerId = (collection && collection.ownerId) ? collection.ownerId : ((sharedMode && sharedOwnerId) ? sharedOwnerId : currentUser.id);

    if (ownerId !== currentUser.id) {
      // Require explicit create permission on the target collection
      if (!canCreateAssetInCollection(collection)) {
        showAlert("You don't have permission to create an asset in this collection.");
        return false;
      }
    }

    const baseAsset = { 
      id: Date.now(), 
      ownerId: ownerId, 
      collectionId: selectedCollectionId, 
      title: newAsset.title.trim(), 
      type: newAsset.type.trim(),
      category: newAsset.category.trim(), 
      description: newAsset.description.trim(), 
      manager: (newAsset.manager || "").trim(),
      value: parseFloat(newAsset.value) || 0,
      estimatedValue: parseFloat(newAsset.estimatedValue) || 0,
      rrp: parseFloat(newAsset.rrp) || 0,
      purchasePrice: parseFloat(newAsset.purchasePrice) || 0,
      quantity: parseInt(newAsset.quantity) || 1,
      heroImage,
      images,
      createdAt: new Date().toISOString(),
      lastViewed: new Date().toISOString(),
      lastEditedBy: currentUser.username
    };
    const asset = (ownerId === currentUser.id)
      ? baseAsset
      : { ...baseAsset, sharedWith: [{ userId: currentUser.id, username: currentUser.username, role: 'manager', canCreateAssets: true }] };
    setAssets((prev) => [asset, ...prev]);
    setNewAsset(initialAssetState);
    return true;
  };

  const updateAssetQuantity = (id, qty) => {
    const n = parseInt(qty) || 1;
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, quantity: n } : a)));
    if (viewAsset && viewAsset.id === id) {
      setViewAsset((v) => ({ ...v, quantity: n }));
      setViewAssetDraft((d) => ({ ...d, quantity: n }));
    }
  };

  const handleDeleteAsset = (id) => {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;
    
    setConfirmDialog({
      show: true,
      title: "Delete Asset",
      message: `Are you sure you want to delete "${asset.title}"? This action cannot be undone.`,
      onConfirm: () => {
        setAssets((prev) => prev.filter((a) => a.id !== id));
        setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
      }
    });
  };

  const handleDeleteVault = (vault) => {
    setConfirmDialog({
      show: true,
      title: "Delete Vault",
      message: `Are you sure you want to delete "${vault.name}"? This will also delete all collections and assets within it.`,
      onConfirm: () => {
        const collectionsToDelete = collections.filter(c => c.vaultId === vault.id);
        const collectionIds = collectionsToDelete.map(c => c.id);
        
        setAssets((prev) => prev.filter((a) => !collectionIds.includes(a.collectionId)));
        setCollections((prev) => prev.filter((c) => c.vaultId !== vault.id));
        setVaults((prev) => prev.filter((v) => v.id !== vault.id));
        // If the user deleted their default/example vault, remember this so we don't recreate it on login
        try {
          if (vault.isDefault && vault.ownerId) {
            localStorage.setItem(`defaultVaultDeleted_${vault.ownerId}`, "true");
          }
        } catch (e) {
          // ignore storage errors
        }
        
        if (selectedVaultId === vault.id) {
          setSelectedVaultId(null);
          setSelectedCollectionId(null);
        }
        
        setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
      }
    });
  };

  const handleDeleteCollection = (collection) => {
    setConfirmDialog({
      show: true,
      title: "Delete Collection",
      message: `Are you sure you want to delete "${collection.name}"? This will also delete all assets within it.`,
      onConfirm: () => {
        setAssets((prev) => prev.filter((a) => a.collectionId !== collection.id));
        setCollections((prev) => prev.filter((c) => c.id !== collection.id));
        
        if (selectedCollectionId === collection.id) {
          setSelectedCollectionId(null);
        }
        
        setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
      }
    });
  };

  const openMoveDialog = (asset) => {
    const currentCollectionId = asset.collectionId;
    const currentVaultId = collections.find(c => c.id === currentCollectionId)?.vaultId || null;
    setMoveDialog({ show: true, assetId: asset.id, targetVaultId: null, targetCollectionId: null, sourceCollectionId: currentCollectionId, sourceVaultId: currentVaultId });
  };

  const closeMoveDialog = () => setMoveDialog({ show: false, assetId: null, targetVaultId: null, targetCollectionId: null });

  const handleMoveConfirm = () => {
    const targetId = moveDialog.targetCollectionId;
    if (!targetId) {
      showAlert("Select a collection to move to.");
      return;
    }
    setAssets((prev) => prev.map((a) => (a.id === moveDialog.assetId ? { ...a, collectionId: targetId, lastEditedBy: currentUser?.username || 'Unknown' } : a)));
    closeMoveDialog();
    showAlert("Asset moved.");
  };

  const openCollectionMoveDialog = (collection) => {
    const sourceVaultId = collection.vaultId || null;
    setCollectionMoveDialog({ show: true, collectionId: collection.id, targetVaultId: null, sourceVaultId });
  };

  const closeCollectionMoveDialog = () => setCollectionMoveDialog({ show: false, collectionId: null, targetVaultId: null });

  const handleCollectionMoveConfirm = () => {
    const targetVault = collectionMoveDialog.targetVaultId;
    if (!targetVault) {
      showAlert("Select a vault to move this collection into.");
      return;
    }
    setCollections((prev) => prev.map((c) => (c.id === collectionMoveDialog.collectionId ? { ...c, vaultId: targetVault, lastEditedBy: currentUser?.username || 'Unknown' } : c)));
    // if the moved collection is currently selected, switch view to the destination vault
    setSelectedVaultId(targetVault);
    setSelectedCollectionId(collectionMoveDialog.collectionId);
    closeCollectionMoveDialog();
    showAlert("Collection moved.");
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
    setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, lastViewed: new Date().toISOString() } : a)));
  };
  const closeViewAsset = () => {
    setViewAsset(null);
    setViewAssetDraft(initialAssetState);
  };

  const handleUpdateViewAsset = async () => {
    if (!viewAsset) return false;
    // enforce asset edit permission via vault
    const vault = getVaultForAsset(viewAsset);
    const permOk = (viewAsset.ownerId === currentUser?.id) || (vault && (vault.ownerId === currentUser?.id || canEditInVault(vault)));
    if (!permOk) {
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

    setAssets((prev) =>
      prev.map((a) =>
        a.id === viewAsset.id
          ? { ...a, title: viewAssetDraft.title.trim(), type: viewAssetDraft.type.trim(), category: viewAssetDraft.category.trim(), description: viewAssetDraft.description.trim(), manager: (viewAssetDraft.manager || "").trim(), value: parseFloat(viewAssetDraft.value) || 0, estimatedValue: parseFloat(viewAssetDraft.estimatedValue) || 0, rrp: parseFloat(viewAssetDraft.rrp) || 0, purchasePrice: parseFloat(viewAssetDraft.purchasePrice) || 0, quantity: parseInt(viewAssetDraft.quantity) || 1, heroImage, images, lastEditedBy: currentUser?.username || 'Unknown' }
          : a
      )
    );

    setViewAsset({ ...viewAsset, title: viewAssetDraft.title.trim(), type: viewAssetDraft.type.trim(), category: viewAssetDraft.category.trim(), description: viewAssetDraft.description.trim(), manager: (viewAssetDraft.manager || "").trim(), value: parseFloat(viewAssetDraft.value) || 0, estimatedValue: parseFloat(viewAssetDraft.estimatedValue) || 0, rrp: parseFloat(viewAssetDraft.rrp) || 0, purchasePrice: parseFloat(viewAssetDraft.purchasePrice) || 0, quantity: parseInt(viewAssetDraft.quantity) || 1, heroImage, images, lastEditedBy: currentUser?.username || 'Unknown' });
    showAlert("Asset updated.");
    return true;
  };

  const handleClearData = () => {
    localStorage.clear();
    setUsers([]);
    setAssets([]);
    setVaults([]);
    setCollections([]);
    setSelectedVaultId(null);
    setSelectedCollectionId(null);
    setShowVaultForm(false);
    setShowCollectionForm(false);
    setShowAssetForm(false);
    setCurrentUser(null);
    setIsLoggedIn(false);
    navigateTo("landing", { replace: true });
    setLoginForm({ username: "", password: "" });
    setRegisterForm({ firstName: "", lastName: "", email: "", username: "", password: "", profileImage: DEFAULT_AVATAR });
  };

  const handleProfileUpdate = (e) => {
    e.preventDefault();
    if (!currentUser) return;

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

    const emailTaken = users.some((u) => u.id !== currentUser.id && u.email === email);
    const usernameTaken = users.some((u) => u.id !== currentUser.id && u.username === username);
    if (emailTaken) errors.email = "Email already in use.";
    if (usernameTaken) errors.username = "Username already in use.";

    // Validate password change if user is changing password
    if (isChangingPassword) {
      if (!profileForm.currentPassword) errors.currentPassword = "Current password is required.";
      if (profileForm.currentPassword && profileForm.currentPassword !== currentUser.password) errors.currentPassword = "Current password is incorrect.";
      if (!profileForm.newPassword) errors.newPassword = "New password is required.";
      if (profileForm.newPassword && profileForm.newPassword.length < 6) errors.newPassword = "Password must be at least 6 characters.";
      if (!profileForm.confirmPassword) errors.confirmPassword = "Please confirm your new password.";
      if (profileForm.newPassword && profileForm.confirmPassword && profileForm.newPassword !== profileForm.confirmPassword) errors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(errors).length > 0) {
      setProfileErrors(errors);
      return;
    }

    const updatedUser = { ...currentUser, firstName, lastName, email, username };
    // Update password if user is changing it
    if (isChangingPassword && profileForm.newPassword) {
      updatedUser.password = profileForm.newPassword;
    }

    setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? updatedUser : u)));
    setCurrentUser(updatedUser);
    setProfileErrors({});
    setIsEditingProfile(false);
    setIsChangingPassword(false);
    setProfileForm({ ...profileForm, currentPassword: "", newPassword: "", confirmPassword: "" });
    showAlert(isChangingPassword && profileForm.newPassword ? "Profile and password updated." : "Profile updated.");
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
      const updatedUser = { ...currentUser, profileImage: resized };
      setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? updatedUser : u)));
      setCurrentUser(updatedUser);
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
      onConfirm: () => {
        setUsers((prev) => prev.filter((u) => u.id !== currentUser.id));
        setVaults((prev) => prev.filter((v) => v.ownerId !== currentUser.id));
        setCollections((prev) => prev.filter((c) => c.ownerId !== currentUser.id));
        setAssets((prev) => prev.filter((a) => a.ownerId !== currentUser.id));
        setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
        logout();
      }
    });
  };

  const handleSelectVault = (vaultId) => {
    setSelectedVaultId(vaultId);
    setSelectedCollectionId(null);
    setShowCollectionForm(false);
    setShowAssetForm(false);
    setVaults((prev) => prev.map((v) => (v.id === vaultId ? { ...v, lastViewed: new Date().toISOString() } : v)));
  };

  const handleSelectCollection = (collectionId) => {
    setSelectedCollectionId(collectionId);
    const col = collections.find((c) => c.id === collectionId);
    if (col && col.vaultId) {
      setSelectedVaultId(col.vaultId);
    }
    setShowAssetForm(false);
    setCollections((prev) => prev.map((c) => (c.id === collectionId ? { ...c, lastViewed: new Date().toISOString() } : c)));
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
    const userVaultList = vaults.filter(v => v.ownerId === userId);
    const userCollectionIds = userVaultList.flatMap(v => collections.filter(c => c.vaultId === v.id).map(c => c.id));
    const userAssets = assets.filter(a => userCollectionIds.includes(a.collectionId));
    return userAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
  };

  const userVaults = currentUser ? vaults.filter((v) => v.ownerId === currentUser.id) : [];
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
    return vault && vault.ownerId === currentUser.id && (!selectedVaultId || c.vaultId === selectedVaultId);
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

  // Datasets for Shared mode (items shared with current user)
  // Only include vaults that were shared to the current user by another owner
  const sharedVaultsList = currentUser ? vaults.filter(v => (
    (v.sharedWith || []).some(s => s.userId === currentUser.id) && // shared to me
    v.ownerId !== currentUser.id && // not my own vault
    (!sharedOwnerId || v.ownerId === sharedOwnerId)
  )) : [];
  const filteredSharedVaults = sharedVaultsList.filter((v) => v.name.toLowerCase().includes(normalizeFilter(vaultFilter)));
  const sortedSharedVaults = [...filteredSharedVaults].sort((a, b) => {
    if (vaultSort === "name") return a.name.localeCompare(b.name);
    if (vaultSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (vaultSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (vaultSort === "highestValue") return getVaultTotalValue(b.id) - getVaultTotalValue(a.id);
    if (vaultSort === "lowestValue") return getVaultTotalValue(a.id) - getVaultTotalValue(b.id);
    return sortByDefaultThenDate(a, b);
  });

  // Only include collections where the user is directly shared (not inherited from vault)
  // Exclude collections owned by the current user (they are the owner's own items)
  const sharedCollectionsList = currentUser ? collections.filter(c => {
    if (c.ownerId === currentUser.id) return false; // skip own collections
    const sharedDirectly = (c.sharedWith || []).some(s => s.userId === currentUser.id);
    return sharedDirectly;
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

  // Only include assets where the user is directly shared (not inherited from collection or vault)
  const sharedAssetsList = currentUser && selectedSharedCollection ? assets.filter(a => {
    if (a.collectionId !== selectedSharedCollection.id) return false;
    if (a.ownerId === currentUser.id) return false;
    // Only asset directly shared
    const assetShared = (a.sharedWith || []).some(s => s.userId === currentUser.id);
    return assetShared;
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
    const colRole = getRoleForCollection(collection);
    const canEdit = (collection.ownerId === currentUser?.id) || colRole === 'editor' || colRole === 'manager';
    const canDelete = (collection.ownerId === currentUser?.id);
    const canMove = (collection.ownerId === currentUser?.id) || colRole === 'manager';
    const isOwner = vault && vault.ownerId === currentUser?.id;

    return (
      <div key={collection.id} data-tut={idx === 0 ? "collection-frame" : undefined} className={`relative overflow-hidden p-3 rounded border ${collection.id === selectedCollectionId ? "border-blue-700 bg-blue-950/40" : "border-neutral-800 bg-neutral-950"} flex flex-col justify-between h-48`}>
        <button className="w-full text-left hover:opacity-80" onClick={() => handleSelectCollection(collection.id)}>
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <img src={hero} alt={collection.name} className="w-24 h-24 object-cover bg-neutral-800 cursor-pointer hover:opacity-90 transition-opacity rounded" onClick={(e) => { e.stopPropagation(); openImageViewer(collectionImages, 0); }} onError={(e) => { e.target.src = DEFAULT_HERO; }} />
              {sharedMode && (
                <p className="mt-2 text-xs text-neutral-300">Your role: {(() => { const r = getRoleForCollection(collection); return r === 'owner' ? 'Owner' : r ? r.charAt(0).toUpperCase() + r.slice(1) : 'Viewer'; })()}</p>
              )}
            </div>
            <div className="flex-1 flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{collection.name}</p>
                  {collection.sharedWith && collection.sharedWith.length > 0 ? (
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
  const assetCanEdit = viewAsset ? ((viewAsset.ownerId === currentUser?.id) || (getVaultForAsset(viewAsset) && (getVaultForAsset(viewAsset).ownerId === currentUser?.id || canEditInVault(getVaultForAsset(viewAsset)))) || ['editor', 'manager'].includes(getRoleForAsset(viewAsset))) : true;
  const editCanEdit = (editDialog && editDialog.show && editDialog.item) ? (() => {
    if (editDialog.type === "vault") {
      const vault = editDialog.item;
      return (vault.ownerId === currentUser?.id) || canEditInVault(vault);
    }
    if (editDialog.type === "collection") {
      const vault = getVaultForCollection(editDialog.item);
      return (editDialog.item.ownerId === currentUser?.id) || (vault && (vault.ownerId === currentUser?.id || canEditInVault(vault)));
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
        <div className={`${shouldCenter ? "max-w-3xl w-full mx-auto" : "max-w-6xl mx-auto"} px-4 py-10`}>
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
                  const ownerIds = Array.from(new Set(vaults.filter(v => (v.sharedWith || []).some(s => s.userId === currentUser.id)).map(v => v.ownerId)));
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
                      const sharedByMe = vaults.filter(v => v.ownerId === currentUser.id && (v.sharedWith || []).length > 0);
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
                            <div className="text-xs text-neutral-400">{(v.sharedWith || []).length} users</div>
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
                      const sharedWithMe = vaults.filter(v => (v.sharedWith || []).some(s => s.userId === currentUser.id));
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
                        const share = (v.sharedWith || []).find(s => s.userId === currentUser.id);
                        const owner = users.find(u => u.id === v.ownerId) || { username: 'Unknown' };
                        const role = getRoleForVault(v);
                        const effective = role === 'owner' ? 'Owner' : role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Viewer';
                        return (
                          <div key={v.id} className="p-3 rounded border border-neutral-800 bg-neutral-950/30 flex items-center justify-between">
                            <div>
                              <div className="font-medium">{v.name}</div>
                              <div className="text-xs text-neutral-400">Shared by {owner.username} · {effective}</div>
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
                                      <p className="mt-2 text-xs text-neutral-300">Your role: {(() => { const r = getRoleForVault(vault); return r === 'owner' ? 'Owner' : r ? r.charAt(0).toUpperCase() + r.slice(1) : 'Viewer'; })()}</p>
                                    )}
                                  </div>
                                  <div className="flex-1 flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold">{vault.name}</p>
                                        {vault.sharedWith && vault.sharedWith.length > 0 ? (
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
                                      <p className="mt-0.5">Manager: {(() => { const owner = users.find(u => u.id === vault.ownerId) || {}; const ownerName = owner.firstName ? `${owner.firstName} ${owner.lastName}` : (owner.username || 'Unknown'); return vault.manager || ownerName; })()} {(() => {
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
                                  const canDel = (vault.ownerId === currentUser?.id) || canDeleteInVault(vault);
                                  return canDel ? (
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
                              <input autoComplete="off" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="username or email" value={newAsset.manager || ""} onChange={(e) => { setNewAsset((p) => ({ ...p, manager: e.target.value })); setShowShareSuggestions(true); }} onFocus={() => setShowShareSuggestions(true)} />
                              {newAsset.manager && showShareSuggestions && (
                                (() => {
                                  const q = (newAsset.manager || "").toLowerCase();
                                  const matches = (users || []).filter(u => {
                                    const full = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
                                    return (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || full.includes(q);
                                  }).slice(0, 6);
                                  if (matches.length === 0) return null;
                                  return (
                                    <div className="absolute left-0 right-0 mt-1 bg-neutral-900 border border-neutral-800 rounded max-h-40 overflow-auto z-30">
                                        {matches.map((u) => (
                                        <button key={u.id} type="button" className="w-full text-left px-3 py-2 hover:bg-neutral-800 flex justify-between items-start" onClick={() => { const full = (u.firstName || u.lastName) ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : u.username; setNewAsset((d) => ({ ...d, manager: full })); setShowShareSuggestions(false); }}>
                                          <div>
                                            <div className="font-medium">{(u.firstName || u.lastName) ? `${u.firstName} ${u.lastName}` : u.username}</div>
                                            <div className="text-xs text-neutral-400">{u.email || `${u.firstName || ""} ${u.lastName || ""}`}</div>
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  );
                                })()
                              )}
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
                                      <p className="mt-2 text-xs text-neutral-300">Your role: {(() => { const r = getRoleForAsset(asset); return r === 'owner' ? 'Owner' : r ? r.charAt(0).toUpperCase() + r.slice(1) : 'Viewer'; })()}</p>
                                    )}
                                  </div>
                                  <div className="flex-1 flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold">{asset.title}</p>
                                        {asset.sharedWith && asset.sharedWith.length > 0 ? (
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
                                    const assetRole = getRoleForAsset(asset);
                                    const canEdit = (asset.ownerId === currentUser?.id) || assetRole === 'editor' || assetRole === 'manager';
                                    const canDelete = (asset.ownerId === currentUser?.id);
                                    const canMove = (asset.ownerId === currentUser?.id) || assetRole === 'manager';
                                    const isOwner = vault && vault.ownerId === currentUser?.id;
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

      <footer className="border-t border-neutral-900 bg-neutral-950/80">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between text-xs text-neutral-500">
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
                  <input autoComplete="off" disabled={!assetCanEdit} className={`w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 ${!assetCanEdit ? 'opacity-60 cursor-not-allowed' : ''}`} placeholder="username or email" value={viewAssetDraft.manager || ""} onChange={(e) => { setViewAssetDraft((p) => ({ ...p, manager: e.target.value })); setShowShareSuggestions(true); }} onFocus={() => setShowShareSuggestions(true)} />
                  {viewAssetDraft.manager && showShareSuggestions && (
                    (() => {
                      const q = (viewAssetDraft.manager || "").toLowerCase();
                      const matches = (users || []).filter(u => {
                        const full = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
                        return (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || full.includes(q);
                      }).slice(0, 6);
                      if (matches.length === 0) return null;
                      return (
                        <div className="absolute left-0 right-0 mt-1 bg-neutral-900 border border-neutral-800 rounded max-h-40 overflow-auto z-30">
                          {matches.map((u) => (
                            <button key={u.id} type="button" className="w-full text-left px-3 py-2 hover:bg-neutral-800 flex justify-between items-start" onClick={() => { const full = (u.firstName || u.lastName) ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : u.username; setViewAssetDraft((d) => ({ ...d, manager: full })); setShowShareSuggestions(false); }}>
                              <div>
                                <div className="font-medium">{(u.firstName || u.lastName) ? `${u.firstName} ${u.lastName}` : u.username}</div>
                                <div className="text-xs text-neutral-400">{u.email || `${u.firstName || ""} ${u.lastName || ""}`}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })()
                  )}
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
                onChange={(e) => setMoveDialog((d) => ({ ...d, targetVaultId: e.target.value ? parseInt(e.target.value) : null, targetCollectionId: null }))}
                className="w-full p-2 pr-8 rounded bg-blue-600 text-white cursor-pointer"
                style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}}
              >
                <option value="">Select vault</option>
                {(() => {
                  const movingAsset = assets.find(a => a.id === moveDialog.assetId);
                  const ownerId = movingAsset ? movingAsset.ownerId : null;
                  return vaults
                    .filter(v => (!!ownerId ? v.ownerId === ownerId : true))
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
                onChange={(e) => setMoveDialog((d) => ({ ...d, targetCollectionId: e.target.value ? parseInt(e.target.value) : null }))}
                className="w-full p-2 pr-8 rounded bg-blue-600 text-white cursor-pointer disabled:opacity-50"
                style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}}
                disabled={!moveDialog.targetVaultId}
              >
                <option value="">{moveDialog.targetVaultId ? "Select collection" : "Select a vault first"}</option>
                {(() => {
                  const movingAsset = assets.find(a => a.id === moveDialog.assetId);
                  const ownerId = movingAsset ? movingAsset.ownerId : null;
                  return collections
                    .filter(c => c.vaultId === moveDialog.targetVaultId && c.id !== (movingAsset?.collectionId) && (!!ownerId ? c.ownerId === ownerId : true))
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
                onChange={(e) => setCollectionMoveDialog((d) => ({ ...d, targetVaultId: e.target.value ? parseInt(e.target.value) : null }))}
                className="w-full p-2 pr-8 rounded bg-blue-600 text-white cursor-pointer"
                style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}}
              >
                <option value="">Select vault</option>
                {(() => {
                  const movingCollection = collections.find(c => c.id === collectionMoveDialog.collectionId);
                  const ownerId = movingCollection ? movingCollection.ownerId : null;
                  return vaults
                    .filter(v => v.id !== (movingCollection?.vaultId) && (!!ownerId ? v.ownerId === ownerId : true))
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
            <p className="text-sm text-neutral-400 mb-4">Share this vault with another LAMB user by username, email, or full name.</p>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-neutral-400">User</label>
                <div className="relative">
                  <input autoComplete="off" className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="username or email" value={shareDialog.username} onChange={(e) => { setShareDialog((d) => ({ ...d, username: e.target.value })); setShowShareSuggestions(true); }} onFocus={() => setShowShareSuggestions(true)} />
                  {shareDialog.username && showShareSuggestions && (
                    (() => {
                      const q = shareDialog.username.toLowerCase();
                      // determine already-shared users depending on dialog type
                      let sharedIds = [];
                      if (shareDialog.type === 'vault') {
                        const currentVault = vaults.find(v => v.id === shareDialog.targetId);
                        sharedIds = (currentVault?.sharedWith || []).map(s => s.userId);
                      } else if (shareDialog.type === 'collection') {
                        const currentCollection = collections.find(c => c.id === shareDialog.targetId);
                        sharedIds = (currentCollection?.sharedWith || []).map(s => s.userId);
                      } else if (shareDialog.type === 'asset') {
                        const currentAsset = assets.find(a => a.id === shareDialog.targetId);
                        sharedIds = (currentAsset?.sharedWith || []).map(s => s.userId);
                      }
                      const selfId = currentUser?.id;
                      const matches = (users || []).filter(u => {
                        if (!u) return false;
                        if (u.id === selfId) return false; // do not suggest yourself as a share target
                        if (sharedIds.includes(u.id)) return false; // exclude already-shared users for this target
                        const full = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
                        return (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || full.includes(q);
                      }).slice(0, 6);
                      if (matches.length === 0) return null;
                      return (
                        <div className="absolute left-0 right-0 mt-1 bg-neutral-900 border border-neutral-800 rounded max-h-40 overflow-auto z-30">
                          {matches.map((u) => (
                            <button key={u.id} type="button" className="w-full text-left px-3 py-2 hover:bg-neutral-800 flex justify-between items-start" onClick={() => { setShareDialog((d) => ({ ...d, username: u.username })); setShowShareSuggestions(false); }}>
                              <div>
                                <div className="font-medium">{u.username}</div>
                                <div className="text-xs text-neutral-400">{u.email || `${u.firstName || ""} ${u.lastName || ""}`}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm text-neutral-400">Role</label>
                <div className="mt-2">
                  <select
                    className="w-full p-2 pr-8 rounded bg-neutral-950 border border-neutral-800"
                    style={{
                      backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")',
                      backgroundPosition: 'right 0.5rem center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '1.5em 1.5em',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none'
                    }}
                    value={shareDialog.role}
                    onChange={(e) => setShareDialog(d => ({ ...d, role: e.target.value }))}
                  >
                    <option value="viewer">Reviewer - Review only</option>
                    <option value="editor">Editor - Review and edit</option>
                    <option value="manager">
                      {shareDialog.type === 'vault' 
                        ? 'Manager - Review, edit, and move' 
                        : 'Manager - Review, edit, and move'}
                    </option>
                  </select>
                  {shareDialog.type === 'vault' && (
                    <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={shareDialog.canCreateCollections}
                        onChange={(e) => setShareDialog(d => ({ ...d, canCreateCollections: e.target.checked }))}
                      />
                      Allow creating collections in this vault
                    </label>
                  )}
                  {shareDialog.type === 'collection' && (
                    <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={shareDialog.canCreateAssets}
                        onChange={(e) => setShareDialog(d => ({ ...d, canCreateAssets: e.target.checked }))}
                      />
                      Allow creating assets in this collection
                    </label>
                  )}
                </div>
                <div className="mt-3">
                  <h4 className="text-sm font-medium text-neutral-400 mb-2">Current Access</h4>
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {(() => {
                      let sharedUsers = [];
                      if (shareDialog.type === 'vault') {
                        const currentVault = vaults.find(v => v.id === shareDialog.targetId);
                        sharedUsers = (currentVault?.sharedWith || []);
                      } else if (shareDialog.type === 'collection') {
                        const currentCollection = collections.find(c => c.id === shareDialog.targetId);
                        sharedUsers = (currentCollection?.sharedWith || []);
                      } else if (shareDialog.type === 'asset') {
                        const currentAsset = assets.find(a => a.id === shareDialog.targetId);
                        sharedUsers = (currentAsset?.sharedWith || []);
                      }

                      if (sharedUsers.length === 0) {
                        return <div className="text-sm text-neutral-500 py-2">No users have access yet.</div>;
                      }

                      return sharedUsers.map((share) => {
                        const u = users.find(user => user.id === share.userId) || { username: share.username };
                        return (
                          <div key={share.userId} className="bg-neutral-950/40 p-3 rounded flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">{u.username}</div>
                              <div className="text-xs text-neutral-400">{u.email || (u.firstName ? `${u.firstName} ${u.lastName}` : '')}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                className="text-xs bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-1 border-none"
                                value={share.role || 'viewer'}
                                onChange={(e) => updateUserRole(share.userId, e.target.value)}
                              >
                                <option value="viewer">Reviewer - Review only</option>
                                <option value="editor">Editor - Review and edit</option>
                                <option value="manager">
                                  {shareDialog.type === 'vault'
                                    ? 'Manager - Review, edit, and move'
                                    : 'Manager - Review, edit, and move'}
                                </option>
                              </select>
                              {shareDialog.type === 'vault' && (
                                <label className="flex items-center gap-1 text-xs text-neutral-200">
                                  <input
                                    type="checkbox"
                                    checked={!!share.canCreateCollections}
                                    onChange={(e) => updateCreatePermission(share.userId, 'canCreateCollections', e.target.checked)}
                                  />
                                  Can create collections
                                </label>
                              )}
                              {shareDialog.type === 'collection' && (
                                <label className="flex items-center gap-1 text-xs text-neutral-200">
                                  <input
                                    type="checkbox"
                                    checked={!!share.canCreateAssets}
                                    onChange={(e) => updateCreatePermission(share.userId, 'canCreateAssets', e.target.checked)}
                                  />
                                  Can create assets
                                </label>
                              )}
                              <button 
                                className="text-xs px-2 py-1 bg-red-700 hover:bg-red-800 rounded" 
                                onClick={() => {
                                  if (shareDialog.type === 'vault') {
                                    setVaults(prev => prev.map(v => v.id === shareDialog.targetId ? { ...v, sharedWith: (v.sharedWith || []).filter(x => x.userId !== share.userId) } : v));
                                  } else if (shareDialog.type === 'collection') {
                                    setCollections(prev => prev.map(c => c.id === shareDialog.targetId ? { ...c, sharedWith: (c.sharedWith || []).filter(x => x.userId !== share.userId) } : c));
                                  } else if (shareDialog.type === 'asset') {
                                    setAssets(prev => prev.map(a => a.id === shareDialog.targetId ? { ...a, sharedWith: (a.sharedWith || []).filter(x => x.userId !== share.userId) } : a));
                                  }
                                  showAlert(`Removed ${u.username} access`);
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
                  <input autoComplete="off" disabled={!editCanEdit} className={`w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800 ${!editCanEdit ? 'opacity-60 cursor-not-allowed' : ''}`} placeholder="username or email" value={editDialog.manager} onChange={(e) => { setEditDialog((prev) => ({ ...prev, manager: e.target.value })); setShowShareSuggestions(true); }} onFocus={() => setShowShareSuggestions(true)} />
                  {editDialog.manager && showShareSuggestions && (
                    (() => {
                      const q = (editDialog.manager || "").toLowerCase();
                      const matches = (users || []).filter(u => {
                        const full = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
                        return (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || full.includes(q);
                      }).slice(0, 6);
                      if (matches.length === 0) return null;
                      return (
                        <div className="absolute left-0 right-0 mt-1 bg-neutral-900 border border-neutral-800 rounded max-h-40 overflow-auto z-30">
                          {matches.map((u) => (
                            <button key={u.id} type="button" className="w-full text-left px-3 py-2 hover:bg-neutral-800 flex justify-between items-start" onClick={() => { const full = (u.firstName || u.lastName) ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : u.username; setEditDialog((d) => ({ ...d, manager: full })); setShowShareSuggestions(false); }}>
                              <div>
                                <div className="font-medium">{(u.firstName || u.lastName) ? `${u.firstName} ${u.lastName}` : u.username}</div>
                                <div className="text-xs text-neutral-400">{u.email || `${u.firstName || ""} ${u.lastName || ""}`}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })()
                  )}
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
