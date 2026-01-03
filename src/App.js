import React, { useEffect, useRef, useState } from "react";

const DEFAULT_AVATAR = "/images/default-avatar.png";
const DEFAULT_HERO = "/images/collection_default.jpg";
const MAX_IMAGE_SIZE = 30 * 1024 * 1024; // 30MB limit per image

const VIEW_TO_PATH = {
  landing: "/",
  login: "/login",
  register: "/sign-up",
  vault: "/vault",
  profile: "/profile",
};

const PATH_TO_VIEW = {
  "/": "landing",
  "/login": "login",
  "/sign-up": "register",
  "/register": "register",
  "/vault": "vault",
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
    if (storedUser && (initialPathView === "login" || initialPathView === "landing")) return "vault";
    return initialPathView;
  })();

  const [users, setUsers] = useState(() => safeParse("users", []));
  const [currentUser, setCurrentUser] = useState(() => storedUser);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!storedUser);
  const [view, setView] = useState(initialView);
  const [vaults, setVaults] = useState(() => safeParse("vaults", []));
  const [collections, setCollections] = useState(() => safeParse("collections", []));
  const [assets, setAssets] = useState(() => safeParse("assets", []));

  const [selectedVaultId, setSelectedVaultId] = useState(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [newVaultName, setNewVaultName] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const initialAssetState = { title: "", type: "", category: "", description: "", heroImage: "", images: [] };
  const [newAsset, setNewAsset] = useState(initialAssetState);

  const categoryOptions = {
    Vehicle: ["Automobile", "Motorcycle", "Aircraft", "Watercraft", "Recreational Vehicle"],
    Property: ["Residential", "Commercial", "Land", "Farmland", "Construction"],
    Collectables: ["Watch", "Jewellery", "Art", "Antique"],
    Business: ["Company", "Partnership", "Trust", "Co-operative", "Patent", "Trademark"],
    Materials: ["Precious Metal", "Precious Stone"],
    Specialty: ["Livestock", "Alcohol"],
    Digital: ["Cryptocurrency", "Website/Domain"],
    Other: ["Other"]
  };

  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const initialRegisterForm = { firstName: "", lastName: "", email: "", username: "", password: "", profileImage: DEFAULT_AVATAR };
  const [registerForm, setRegisterForm] = useState(initialRegisterForm);
  const [vaultSort, setVaultSort] = useState("default");
  const [vaultFilter, setVaultFilter] = useState("");
  const [collectionSort, setCollectionSort] = useState("default");
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

  const [confirmDialog, setConfirmDialog] = useState({ show: false, title: "", message: "", onConfirm: null });
  const [viewAsset, setViewAsset] = useState(null);
  const [viewAssetDraft, setViewAssetDraft] = useState(initialAssetState);
  const [imageViewer, setImageViewer] = useState({ show: false, images: [], currentIndex: 0 });
  const [editDialog, setEditDialog] = useState({ show: false, type: null, item: null, name: "" });

  const [alert, setAlert] = useState("");
  const alertTimeoutRef = useRef(null);

  const showAlert = (message, duration = 2400) => {
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
    setAlert(message);
    if (message) {
      alertTimeoutRef.current = setTimeout(() => setAlert(""), duration);
    }
  };

  const ensureDefaultVaultForUser = (user) => {
    if (!user) return null;
    let defaultVault = null;

    setVaults((prev) => {
      const existing = prev.find((v) => v.ownerId === user.id && v.isDefault);
      if (existing) {
        defaultVault = existing;
        return prev;
      }
      const created = {
        id: Date.now(),
        ownerId: user.id,
        name: "Private Vault",
        isPrivate: true,
        isDefault: true,
        createdAt: new Date().toISOString(),
      };
      defaultVault = created;
      return [created, ...prev];
    });

    if (!defaultVault) return null;

    setCollections((prev) => {
      const existingCollection = prev.find(
        (c) => c.ownerId === user.id && c.vaultId === defaultVault.id && c.isDefault
      );
      if (existingCollection) return prev;
      const created = {
        id: Date.now() + 1,
        ownerId: user.id,
        vaultId: defaultVault.id,
        name: "Private Collection",
        isPrivate: true,
        isDefault: true,
        createdAt: new Date().toISOString(),
      };
      return [created, ...prev];
    });

    return defaultVault;
  };

  const openEditVault = (vault) => setEditDialog({ show: true, type: "vault", item: vault, name: vault.name });
  const openEditCollection = (collection) => setEditDialog({ show: true, type: "collection", item: collection, name: collection.name });
  const closeEditDialog = () => setEditDialog({ show: false, type: null, item: null, name: "" });

  const saveEditDialog = () => {
    const name = (editDialog.name || "").trim();
    if (!name) {
      showAlert("Name is required.");
      return;
    }
    if (editDialog.type === "vault" && editDialog.item) {
      setVaults((prev) => prev.map((v) => (v.id === editDialog.item.id ? { ...v, name } : v)));
      if (selectedVaultId === editDialog.item.id) {
        setSelectedVaultId(editDialog.item.id);
      }
    }
    if (editDialog.type === "collection" && editDialog.item) {
      setCollections((prev) => prev.map((c) => (c.id === editDialog.item.id ? { ...c, name } : c)));
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
    const nextPath = viewToPath(nextView);
    if (replace) {
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.pushState(null, "", nextPath);
    }
    setView(nextView);
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
    navigateTo("vault");
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

    const newUser = { id: Date.now(), firstName, lastName, email, username, password, profileImage: registerForm.profileImage || DEFAULT_AVATAR };
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
    navigateTo("vault");
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
    if (!newVaultName.trim()) {
      showAlert("Vault name is required.");
      return false;
    }
    if (!currentUser) return false;
    const vault = { id: Date.now(), ownerId: currentUser.id, name: newVaultName.trim(), isPrivate: true, isDefault: false, createdAt: new Date().toISOString() };
    setVaults((prev) => [vault, ...prev]);
    setNewVaultName("");
    return true;
  };

  const handleAddCollection = () => {
    if (!selectedVaultId) {
      showAlert("Select a vault first.");
      return false;
    }
    if (!newCollectionName.trim()) {
      showAlert("Collection name is required.");
      return false;
    }
    if (!currentUser) return false;
    const collection = { id: Date.now(), ownerId: currentUser.id, vaultId: selectedVaultId, name: newCollectionName.trim(), isPrivate: true, isDefault: false, createdAt: new Date().toISOString() };
    setCollections((prev) => [collection, ...prev]);
    setNewCollectionName("");
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

    const asset = { 
      id: Date.now(), 
      ownerId: currentUser.id, 
      collectionId: selectedCollectionId, 
      title: newAsset.title.trim(), 
      type: newAsset.type.trim(),
      category: newAsset.category.trim(), 
      description: newAsset.description.trim(), 
      heroImage,
      images,
      createdAt: new Date().toISOString() 
    };
    setAssets((prev) => [asset, ...prev]);
    setNewAsset(initialAssetState);
    return true;
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
    if (vault.isDefault) {
      showAlert("Cannot delete the Private Vault.");
      return;
    }
    
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
        
        if (selectedVaultId === vault.id) {
          setSelectedVaultId(null);
          setSelectedCollectionId(null);
        }
        
        setConfirmDialog({ show: false, title: "", message: "", onConfirm: null });
      }
    });
  };

  const handleDeleteCollection = (collection) => {
    if (collection.isDefault) {
      showAlert("Cannot delete the Private Collection.");
      return;
    }
    
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

  const openViewAsset = (asset) => {
    const normalized = normalizeAsset(asset);
    setViewAsset(normalized);
    setViewAssetDraft({
      title: normalized.title || "",
      type: normalized.type || "",
      category: normalized.category || "",
      description: normalized.description || "",
      heroImage: normalized.heroImage || normalized.images[0] || "",
      images: trimToFour(normalized.images || []),
    });
  };
  const closeViewAsset = () => {
    setViewAsset(null);
    setViewAssetDraft(initialAssetState);
  };

  const handleUpdateViewAsset = async () => {
    if (!viewAsset) return false;
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
          ? { ...a, title: viewAssetDraft.title.trim(), type: viewAssetDraft.type.trim(), category: viewAssetDraft.category.trim(), description: viewAssetDraft.description.trim(), heroImage, images }
          : a
      )
    );

    setViewAsset({ ...viewAsset, title: viewAssetDraft.title.trim(), type: viewAssetDraft.type.trim(), category: viewAssetDraft.category.trim(), description: viewAssetDraft.description.trim(), heroImage, images });
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

  const handleSelectVault = (vaultId) => {
    setSelectedVaultId(vaultId);
    setSelectedCollectionId(null);
    setShowCollectionForm(false);
    setShowAssetForm(false);
  };

  const handleSelectCollection = (collectionId) => {
    setSelectedCollectionId(collectionId);
    setShowAssetForm(false);
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
      // Add unique identifier to ensure duplicate images are treated as separate entities
      const uniqueImage = resized + `#${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      converted.push(uniqueImage);
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

  const handleSetHero = (image, setter) => setter((prev) => ({ ...prev, heroImage: image }));

  const sortByDefaultThenDate = (a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  };

  const normalizeFilter = (value) => value.trim().toLowerCase();

  const userVaults = currentUser ? vaults.filter((v) => v.ownerId === currentUser.id) : [];
  const filteredVaults = userVaults.filter((v) => v.name.toLowerCase().includes(normalizeFilter(vaultFilter)));
  const sortedVaults = [...filteredVaults].sort((a, b) => {
    if (vaultSort === "name") return a.name.localeCompare(b.name);
    if (vaultSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (vaultSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    return sortByDefaultThenDate(a, b);
  });
  const selectedVault = userVaults.find((v) => v.id === selectedVaultId) || null;

  const userCollections = currentUser ? collections.filter((c) => c.ownerId === currentUser.id && (!selectedVaultId || c.vaultId === selectedVaultId)) : [];
  const filteredCollections = userCollections.filter((c) => c.name.toLowerCase().includes(normalizeFilter(collectionFilter)));
  const sortedCollections = [...filteredCollections].sort((a, b) => {
    if (collectionSort === "name") return a.name.localeCompare(b.name);
    if (collectionSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (collectionSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    return sortByDefaultThenDate(a, b);
  });
  const selectedCollection = userCollections.find((c) => c.id === selectedCollectionId) || null;

  const userAssets = currentUser && selectedCollection ? assets.filter((a) => a.ownerId === currentUser.id && a.collectionId === selectedCollection.id) : [];
  const filteredAssets = userAssets.filter((a) => {
    const term = normalizeFilter(assetFilter);
    if (!term) return true;
    return (a.title || "").toLowerCase().includes(term) || (a.category || "").toLowerCase().includes(term);
  });
  const sortedAssets = [...filteredAssets].sort((a, b) => {
    if (assetSort === "name") return (a.title || "").localeCompare(b.title || "");
    if (assetSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    return new Date(b.createdAt) - new Date(a.createdAt); // default newest
  });

  const isAuthView = !isLoggedIn && (view === "login" || view === "register");
  const isLanding = !isLoggedIn && view === "landing";
  const activeCenteredView = isLanding ? "landing" : (isAuthView ? view : "other");
  const shouldCenter = isAuthView || isLanding;

  const breadcrumb = [
    { label: "Home", onClick: () => navigateTo(isLoggedIn ? "vault" : "landing") },
    { label: "Vault", onClick: isLoggedIn ? () => navigateTo("vault") : null },
    selectedVault ? { label: selectedVault.name } : null,
    selectedCollection ? { label: selectedCollection.name } : null,
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

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {alert && (
        <div className="fixed top-4 inset-x-0 flex justify-center z-[60]">
          <div className="px-4 py-2 bg-blue-700 text-white rounded shadow">{alert}</div>
        </div>
      )}

      {!shouldCenter && (
        <header className="border-b border-neutral-900 bg-neutral-950/70 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="font-semibold text-lg tracking-[0.15em]">LAMB</p>
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
              <button className="text-sm text-neutral-400 hover:text-neutral-200" onClick={() => navigateTo("vault")}>← Back to vault</button>
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

                  <div className="p-5 rounded-xl border border-neutral-900 bg-neutral-900/60 space-y-4">
                    <div>
                      <p className="text-sm text-neutral-400">Security</p>
                      <h3 className="text-lg font-semibold">Change password</h3>
                    </div>
                    <div className="mb-4">
                      <button className="text-sm text-blue-400 hover:underline" type="button" onClick={() => setIsChangingPassword(!isChangingPassword)}>
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
                            {profileErrors.confirmPassword && <p className="text-xs text-red-400 mt-1">{profileErrors.confirmPassword}</p>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Update password</button>
                          <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setIsChangingPassword(false); setProfileErrors({}); setProfileForm({ ...profileForm, currentPassword: "", newPassword: "", confirmPassword: "" }); }}>Cancel</button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">{selectedVault ? selectedVault.name : "Vault"}</h1>
                </div>
                <button className="text-xs text-neutral-500 hover:text-neutral-300" onClick={handleClearData}>Clear local data</button>
              </div>

              <div className="grid gap-4 md:grid-cols-2 transition-all duration-300">
                <div className="p-4 border border-neutral-900 rounded-xl bg-neutral-900/50 space-y-4 min-h-[500px] transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-400">{selectedCollection ? "Collections" : "Vaults"}</p>
                      <h3 className="text-lg font-semibold truncate">{selectedCollection ? (selectedVault?.name || "Vault") : "Create or select a Vault"}</h3>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {selectedCollection && (
                        <button className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 whitespace-nowrap text-sm" onClick={() => { setSelectedCollectionId(null); setShowCollectionForm(false); setShowAssetForm(false); }}>
                          ← Vaults
                        </button>
                      )}
                      <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 w-10 h-10 flex items-center justify-center" onClick={() => {
                        if (selectedCollection) {
                          setShowCollectionForm((v) => !v);
                          setShowVaultForm(false);
                        } else {
                          setShowVaultForm((v) => !v);
                        }
                        setShowAssetForm(false);
                      }}>+</button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-sm">
                    {selectedCollection ? (
                      <>
                        <input className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 flex-1 min-w-[160px]" placeholder="Filter collections" value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} />
                        <select className="px-3 py-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={collectionSort} onChange={(e) => setCollectionSort(e.target.value)}>
                          <option value="default">Default</option>
                          <option value="name">Name</option>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                        </select>
                      </>
                    ) : (
                      <>
                        <input className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 flex-1 min-w-[160px]" placeholder="Filter vaults" value={vaultFilter} onChange={(e) => setVaultFilter(e.target.value)} />
                        <select className="px-3 py-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={vaultSort} onChange={(e) => setVaultSort(e.target.value)}>
                          <option value="default">Default</option>
                          <option value="name">Name</option>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                        </select>
                      </>
                    )}
                  </div>

                  {!selectedCollection && showVaultForm && (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const ok = handleAddVault(); if (ok) setShowVaultForm(false); }}>
                      <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Vault name" value={newVaultName} onChange={(e) => setNewVaultName(e.target.value)} />
                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Create</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setShowVaultForm(false); setNewVaultName(""); }}>Cancel</button>
                      </div>
                    </form>
                  )}

                  {selectedCollection && showCollectionForm && (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const ok = handleAddCollection(); if (ok) setShowCollectionForm(false); }}>
                      <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Collection name" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} />
                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Create</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setShowCollectionForm(false); setNewCollectionName(""); }}>Cancel</button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2">
                    {!selectedCollection ? (
                      sortedVaults.length === 0 ? (
                        <p className="text-neutral-500">No vaults yet. Add one to start.</p>
                      ) : (
                        <div className="grid gap-2">
                          {sortedVaults.map((vault) => (
                            <div key={vault.id} className={`flex items-center gap-2 p-3 rounded border ${vault.id === selectedVaultId ? "border-blue-700 bg-blue-950/40" : "border-neutral-800 bg-neutral-950"}`}>
                              <button className="flex-1 text-left hover:opacity-80" onClick={() => handleSelectVault(vault.id)}>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-semibold">{vault.name}</p>
                                    <p className="text-xs text-neutral-500">Created {new Date(vault.createdAt).toLocaleDateString()}</p>
                                  </div>
                                  {vault.isDefault && <span className="text-xs px-2 py-1 rounded bg-neutral-800 border border-neutral-700">Hidden</span>}
                                </div>
                              </button>
                              {!vault.isDefault && (
                                <>
                                  <button className="px-2 py-1 text-xs text-blue-300 border border-blue-800 rounded hover:bg-blue-900/40" onClick={(e) => { e.stopPropagation(); openEditVault(vault); }}>View / Edit</button>
                                  <button className="px-2 py-1 text-xs text-green-400 border border-green-800 rounded hover:bg-green-900/50" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`Vault: ${vault.name}\nCreated: ${new Date(vault.createdAt).toLocaleDateString()}`); showAlert('Vault details copied to clipboard!'); }}>Share</button>
                                  <button className="px-2 py-1 text-xs text-red-400 border border-red-800 rounded hover:bg-red-900/50" onClick={(e) => { e.stopPropagation(); handleDeleteVault(vault); }}>Delete</button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      sortedCollections.length === 0 ? (
                        <p className="text-neutral-500">No collections yet. Add one to start.</p>
                      ) : (
                        <div className="grid gap-2">
                          {sortedCollections.map((collection) => (
                            <div key={collection.id} className={`flex items-center gap-2 p-3 rounded border ${collection.id === selectedCollectionId ? "border-blue-700 bg-blue-950/40" : "border-neutral-800 bg-neutral-950"}`}>
                              <button className="flex-1 text-left hover:opacity-80" onClick={() => handleSelectCollection(collection.id)}>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-semibold">{collection.name}</p>
                                    <p className="text-xs text-neutral-500">Collection · Created {new Date(collection.createdAt).toLocaleDateString()}</p>
                                  </div>
                                  {collection.isDefault && <span className="text-xs px-2 py-1 rounded bg-neutral-800 border border-neutral-700">Hidden</span>}
                                </div>
                              </button>
                              {!collection.isDefault && (
                                <>
                                  <button className="px-2 py-1 text-xs text-blue-300 border border-blue-800 rounded hover:bg-blue-900/40" onClick={(e) => { e.stopPropagation(); openEditCollection(collection); }}>View / Edit</button>
                                  <button className="px-2 py-1 text-xs text-green-400 border border-green-800 rounded hover:bg-green-900/50" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`Collection: ${collection.name}`); showAlert('Collection details copied to clipboard!'); }}>Share</button>
                                  <button className="px-2 py-1 text-xs text-red-400 border border-red-800 rounded hover:bg-red-900/50" onClick={(e) => { e.stopPropagation(); handleDeleteCollection(collection); }}>Delete</button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="p-4 border border-neutral-900 rounded-xl bg-neutral-900/50 space-y-4 min-h-[500px] transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-neutral-400">{selectedCollection ? "Assets" : "Collections"}</p>
                      <h3 className="text-lg font-semibold">{selectedCollection ? selectedCollection.name : (selectedVault ? selectedVault.name : "Organize within a vault")}</h3>
                    </div>
                    {selectedCollection ? (
                      <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700" onClick={() => { setShowAssetForm((v) => !v); setShowVaultForm(false); setShowCollectionForm(false); }}>+</button>
                    ) : selectedVault ? (
                      <button className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700" onClick={() => { setShowCollectionForm((v) => !v); setShowVaultForm(false); setShowAssetForm(false); }}>+</button>
                    ) : (
                      <button className="px-3 py-2 rounded bg-blue-600/40 cursor-not-allowed" disabled>+</button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 text-sm">
                    {selectedCollection ? (
                      <>
                        <input className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 flex-1 min-w-[160px]" placeholder="Filter assets" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} />
                        <select className="px-3 py-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={assetSort} onChange={(e) => setAssetSort(e.target.value)}>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="name">Name</option>
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
                        </select>
                      </>
                    )}
                  </div>

                  {selectedVault && !selectedCollection && showCollectionForm && (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const ok = handleAddCollection(); if (ok) setShowCollectionForm(false); }}>
                      <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Collection name" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} />
                      <div className="flex gap-2">
                        <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" type="submit">Create</button>
                        <button className="px-4 py-2 rounded border border-neutral-800 hover:bg-neutral-800" type="button" onClick={() => { setShowCollectionForm(false); setNewCollectionName(""); }}>Cancel</button>
                      </div>
                    </form>
                  )}

                  {selectedCollection && showAssetForm && (
                    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const ok = await handleAddAsset(); if (ok) setShowAssetForm(false); }}>
                      <div className="grid gap-3 md:grid-cols-2">
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
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <select className="w-full p-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={newAsset.category} onChange={(e) => setNewAsset((p) => ({ ...p, category: e.target.value }))} disabled={!newAsset.type}>
                        <option value="">Select Category</option>
                        {newAsset.type && categoryOptions[newAsset.type]?.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      <textarea className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={3} placeholder="Description" maxLength={60} value={newAsset.description} onChange={(e) => setNewAsset((p) => ({ ...p, description: e.target.value }))} />

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
                              const displayImg = img.split('#')[0];
                              return (
                                <div key={idx} className="relative border border-neutral-800 rounded overflow-hidden">
                                  <img src={displayImg} alt={`Upload ${idx + 1}`} className="w-full h-28 object-cover" />
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
                    {!selectedVault ? (
                      <p className="text-neutral-500">Select a vault to view collections.</p>
                    ) : !selectedCollection ? (
                      sortedCollections.length === 0 ? (
                        <p className="text-neutral-500">No collections yet. Add one to start.</p>
                      ) : (
                        <div className="grid gap-2">
                          {sortedCollections.map((collection) => (
                            <div key={collection.id} className={`flex items-center gap-2 p-3 rounded border ${collection.id === selectedCollectionId ? "border-blue-700 bg-blue-950/40" : "border-neutral-800 bg-neutral-950"}`}>
                              <button className="flex-1 text-left hover:opacity-80" onClick={() => handleSelectCollection(collection.id)}>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-semibold">{collection.name}</p>
                                    <p className="text-xs text-neutral-500">Collection · Created {new Date(collection.createdAt).toLocaleDateString()}</p>
                                  </div>
                                  {collection.isDefault && <span className="text-xs px-2 py-1 rounded bg-neutral-800 border border-neutral-700">Hidden</span>}
                                </div>
                              </button>
                              {!collection.isDefault && (
                                <>
                                  <button className="px-2 py-1 text-xs text-blue-300 border border-blue-800 rounded hover:bg-blue-900/40" onClick={(e) => { e.stopPropagation(); openEditCollection(collection); }}>View / Edit</button>
                                  <button className="px-2 py-1 text-xs text-green-400 border border-green-800 rounded hover:bg-green-900/50" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`Collection: ${collection.name}`); showAlert('Collection details copied to clipboard!'); }}>Share</button>
                                  <button className="px-2 py-1 text-xs text-red-400 border border-red-800 rounded hover:bg-red-900/50" onClick={(e) => { e.stopPropagation(); handleDeleteCollection(collection); }}>Delete</button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      sortedAssets.length === 0 ? (
                        <div className="p-4 border border-neutral-800 rounded bg-neutral-900 text-neutral-400">No assets in this collection.</div>
                      ) : (
                        <div className="space-y-3">
                          {sortedAssets.map((asset) => {
                            const normalized = normalizeAsset(asset);
                            const hero = asset.heroImage || normalized.images[0] || DEFAULT_HERO;
                            const displayHero = hero.split('#')[0];

                            return (
                              <div key={asset.id} className="border border-neutral-800 rounded bg-neutral-900 overflow-hidden flex flex-row gap-4 p-3">
                                <img src={displayHero} alt={asset.title} className="w-32 h-32 flex-shrink-0 object-cover bg-neutral-800 cursor-pointer hover:opacity-90 transition-opacity rounded" onClick={() => openImageViewer(normalized.images, 0)} onError={(e) => { e.target.src = DEFAULT_HERO; }} />
                                <div className="flex-1 flex flex-col justify-between min-w-0 max-h-32">
                                  <div className="space-y-0.5">
                                    <p className="text-base font-semibold truncate">{asset.title}</p>
                                    <p className="text-xs text-neutral-400">{asset.type || "No Type"} • {asset.category || "Uncategorized"}</p>
                                    {asset.description && <p className="text-xs text-neutral-300 line-clamp-1">{asset.description}</p>}
                                  </div>

                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-neutral-500">Added {new Date(asset.createdAt).toLocaleDateString()}</p>
                                    <div className="flex gap-2 flex-shrink-0">
                                      <button className="px-2 py-0.5 bg-blue-700 text-white rounded text-xs hover:bg-blue-800" onClick={() => openViewAsset(asset)}>View / Edit</button>
                                      <button className="px-2 py-0.5 bg-green-700 text-white rounded text-xs hover:bg-green-800" onClick={() => { navigator.clipboard.writeText(`Asset: ${asset.title}\nCategory: ${asset.category || 'Uncategorized'}\nDescription: ${asset.description || 'No description'}`); showAlert('Asset details copied to clipboard!'); }}>Share</button>
                                      <button className="px-2 py-0.5 bg-red-700 text-white rounded text-xs hover:bg-red-800" onClick={() => handleDeleteAsset(asset.id)}>Delete</button>
                                    </div>
                                  </div>
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
                <button className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700" onClick={handleUpdateViewAsset}>Save</button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <input className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" placeholder="Title" maxLength={30} value={viewAssetDraft.title} onChange={(e) => setViewAssetDraft((p) => ({ ...p, title: e.target.value }))} />
                <select className="w-full p-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={viewAssetDraft.type} onChange={(e) => setViewAssetDraft((p) => ({ ...p, type: e.target.value, category: "" }))}>
                  <option value="">Select Type</option>
                  <option value="Vehicle">Vehicle</option>
                  <option value="Property">Property</option>
                  <option value="Collectables">Collectables</option>
                  <option value="Business">Business</option>
                  <option value="Materials">Materials</option>
                  <option value="Specialty">Specialty</option>
                  <option value="Digital">Digital</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <select className="w-full p-2 pr-8 rounded bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', appearance: 'none'}} value={viewAssetDraft.category} onChange={(e) => setViewAssetDraft((p) => ({ ...p, category: e.target.value }))} disabled={!viewAssetDraft.type}>
                <option value="">Select Category</option>
                {viewAssetDraft.type && categoryOptions[viewAssetDraft.type]?.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <textarea className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={4} placeholder="Description" maxLength={60} value={viewAssetDraft.description} onChange={(e) => setViewAssetDraft((p) => ({ ...p, description: e.target.value }))} />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-neutral-400">Hero Image Preview</p>
                    <p className="text-xs text-neutral-500">Click to expand in viewer.</p>
                  </div>
                </div>
                <div className="w-full h-64 sm:h-80 md:h-96 max-h-[50vh] border-2 border-neutral-700 rounded-lg bg-neutral-950/50 flex items-center justify-center overflow-hidden">
                  <img src={(viewAssetDraft.heroImage || viewAssetDraft.images?.[0] || DEFAULT_HERO).split('#')[0]} alt={viewAssetDraft.title} className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity" onClick={() => { const heroIdx = viewAssetDraft.images.indexOf(viewAssetDraft.heroImage); openImageViewer(viewAssetDraft.images, heroIdx >= 0 ? heroIdx : 0); }} onError={(e) => { e.target.src = DEFAULT_HERO; }} />
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
                    const displayImg = img.split('#')[0];
                    return (
                      <div key={originalIdx} className="relative border border-neutral-800 rounded overflow-hidden">
                        <img src={displayImg} alt={`Edit ${idx + 1}`} className="w-full h-28 object-cover cursor-pointer hover:opacity-90 transition-opacity" onClick={() => openImageViewer(viewAssetDraft.images, originalIdx)} />
                        <div className="absolute top-2 right-2 flex gap-1 items-center">
                          {!isHero && (
                            <button type="button" className="px-2 py-1 text-xs rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700" onClick={() => handleSetHero(img, setViewAssetDraft)}>☆</button>
                          )}
                          {isHero && <span className="px-2 py-1 text-xs rounded bg-neutral-900 text-amber-400">★</span>}
                          <button type="button" className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700" onClick={() => handleRemoveImage(originalIdx, setViewAssetDraft)}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                  
                  {(!viewAssetDraft.images || viewAssetDraft.images.length < 4) && (
                    <label className="relative border-2 border-dashed border-neutral-700 rounded bg-neutral-800/50 hover:bg-neutral-800 hover:border-neutral-600 cursor-pointer transition-colors flex items-center justify-center h-28">
                      <span className="text-5xl text-neutral-500">+</span>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        className="hidden"
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

      {editDialog.show && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeEditDialog}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-semibold mb-3">{editDialog.type === "vault" ? "Edit Vault" : "Edit Collection"}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-neutral-400">Name</label>
                <input
                  className="w-full mt-1 p-2 rounded bg-neutral-950 border border-neutral-800"
                  value={editDialog.name}
                  onChange={(e) => setEditDialog((prev) => ({ ...prev, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button className="px-4 py-2 rounded border border-neutral-700 hover:bg-neutral-800" onClick={closeEditDialog}>Cancel</button>
                <button className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700" onClick={saveEditDialog}>Save</button>
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
                <img src={imageViewer.images[imageViewer.currentIndex]?.split('#')[0]} alt="" className="max-w-full max-h-full object-contain" onError={(e) => { e.target.src = DEFAULT_HERO; }} />
              </div>
            </div>
            
            {imageViewer.images.length > 1 && (
              <div className="flex gap-2 justify-center flex-wrap max-w-md">
                {imageViewer.images.map((img, idx) => (
                  <img key={idx} src={img.split('#')[0]} alt="" className={`w-16 h-16 object-cover rounded cursor-pointer border-2 transition-all ${idx === imageViewer.currentIndex ? 'border-blue-500 scale-110' : 'border-neutral-600 hover:border-blue-400 opacity-70 hover:opacity-100'}`} onClick={() => setImageViewer(prev => ({ ...prev, currentIndex: idx }))} onError={(e) => { e.target.style.display = "none"; }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
