import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert as NativeAlert, Animated, Image, Modal, RefreshControl, ScrollView, SectionList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import LambHeader from '../components/LambHeader';
import ShareModal from '../components/ShareModal';
import PullToRefreshIndicator from '../components/PullToRefreshIndicator';
import { useData } from '../context/DataContext';
import { getAssetCapabilities, getCollectionCapabilities, getVaultCapabilities } from '../policies/capabilities';
import { runWithMinimumDuration } from '../utils/timing';
import { getInitials } from '../utils/user';
import { useDebouncedValue } from '../utils/useDebouncedValue';

export default function SharedVaults({ navigation, route }) {
  const {
    loading,
    vaults,
    collections,
    assets,
    currentUser,
    addCollection,
    addAsset,
    updateAsset,
    deleteAsset,
    getRoleForVault,
    canCreateCollectionsInVault,
    getRoleForCollection,
    canCreateAssetsInCollection,
    getRoleForAsset,
    updateVault,
    updateCollection,
    moveCollection,
    moveAsset,
    refreshData,
    theme,
    vaultMemberships,
    acceptInvitationCode,
    denyInvitationCode,
    listMyInvitations,
    retainVaultCollections,
    releaseVaultCollections,
    retainVaultAssets,
    releaseVaultAssets,
    backendReachable,
    showAlert,
    showNotice,
    showVaultTotalValue,
    formatCurrencyValue,
    setRecentlyAccessedEntry,
  } = useData();
  const Alert = { alert: showAlert };
  const isOffline = backendReachable === false;
  const isOnProfile = route?.name === 'Profile';
  const goProfile = () => {
    if (isOnProfile) return;
    navigation?.navigate?.('Profile');
  };
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [invitations, setInvitations] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newAssetTitle, setNewAssetTitle] = useState('');
  const [collectionCreateOpen, setCollectionCreateOpen] = useState(false);
  const [assetCreateOpen, setAssetCreateOpen] = useState(false);
  const [collectionCreateBusy, setCollectionCreateBusy] = useState(false);
  const [assetCreateBusy, setAssetCreateBusy] = useState(false);
  const [optimisticCollections, setOptimisticCollections] = useState([]);
  const [optimisticAssets, setOptimisticAssets] = useState([]);
  const [optimisticDeletedAssetIds, setOptimisticDeletedAssetIds] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const listRef = useRef(null);
  const [showJumpToTop, setShowJumpToTop] = useState(false);
  const showJumpToTopRef = useRef(false);

  const scrollToTop = () => {
    const run = () => {
      try {
        if (listRef.current?.scrollToOffset) {
          listRef.current.scrollToOffset({ offset: 0, animated: true });
          return;
        }

        const responder = listRef.current?.getScrollResponder?.();
        if (responder?.scrollTo) {
          responder.scrollTo({ y: 0, animated: true });
          return;
        }

        if (listRef.current?.scrollToLocation) {
          listRef.current.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true, viewPosition: 0 });
        }
      } catch {
        // ignore
      }
    };

    run();
    setTimeout(run, 50);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 180);
  const [vaultTypeQuery, setVaultTypeQuery] = useState('');
  const [collectionTypeQuery, setCollectionTypeQuery] = useState('');
  const [vaultSortMode, setVaultSortMode] = useState('az');
  const [collectionSortMode, setCollectionSortMode] = useState('az');
  const [assetSortMode, setAssetSortMode] = useState('az');

  const [assetEditVisible, setAssetEditVisible] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [assetEditTitle, setAssetEditTitle] = useState('');
  const [assetEditCategory, setAssetEditCategory] = useState('');

  const [assetMoveVisible, setAssetMoveVisible] = useState(false);
  const [assetMoveAssetId, setAssetMoveAssetId] = useState(null);
  const [assetMoveVaultId, setAssetMoveVaultId] = useState(null);
  const [assetMoveCollectionId, setAssetMoveCollectionId] = useState(null);
  const [assetMoveVaultDropdownOpen, setAssetMoveVaultDropdownOpen] = useState(false);
  const [assetMoveCollectionDropdownOpen, setAssetMoveCollectionDropdownOpen] = useState(false);
  const [assetMoveBusy, setAssetMoveBusy] = useState(false);

  const limit35 = (value = '') => String(value).slice(0, 35);
  const makeTempId = () => `temp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const isTempId = (id) => String(id || '').startsWith('temp_');
  const noAutoCorrect = { autoCorrect: false, spellCheck: false, autoComplete: 'off' };
  const matchesAllQueries = (text, queries) => {
    const hay = String(text || '').toLowerCase();
    const list = (queries || []).map((q) => String(q || '').trim().toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    return list.every((q) => hay.includes(q));
  };
  const dedupeById = (items = []) => {
    const map = new Map();
    for (const item of items || []) {
      const id = item?.id != null ? String(item.id) : null;
      if (!id) continue;
      map.set(id, item);
    }
    return Array.from(map.values());
  };

  const [selectedVaultId, setSelectedVaultId] = useState(route?.params?.selectedVaultId ? String(route.params.selectedVaultId) : null);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState(false);

  const STEP = { vault: 'vault', collection: 'collection', assets: 'assets' };
  const getDesiredStep = ({ vaultId, collectionId }) => {
    if (collectionId) return STEP.assets;
    if (vaultId) return STEP.collection;
    return STEP.vault;
  };
  const [browseStep, setBrowseStep] = useState(() => getDesiredStep({ vaultId: selectedVaultId, collectionId: null }));
  const browseStepRef = useRef(browseStep);
  useEffect(() => {
    browseStepRef.current = browseStep;
  }, [browseStep]);

  const [renderPanels, setRenderPanels] = useState(() => ({
    vault: browseStep === STEP.vault,
    collection: browseStep === STEP.collection,
    assets: browseStep === STEP.assets,
  }));

  const vaultPanelAnim = useRef(new Animated.Value(browseStep === STEP.vault ? 0 : 1)).current;
  const collectionPanelAnim = useRef(new Animated.Value(browseStep === STEP.collection ? 0 : 1)).current;
  const assetsPanelAnim = useRef(new Animated.Value(browseStep === STEP.assets ? 0 : 1)).current;
  const transitioningStepRef = useRef(false);

  const panelStyle = (anim) => {
    const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -26] });
    const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
    return { transform: [{ translateY }], opacity };
  };

  const snapToStep = (nextStep) => {
    setBrowseStep(nextStep);
    setRenderPanels({
      vault: nextStep === STEP.vault,
      collection: nextStep === STEP.collection,
      assets: nextStep === STEP.assets,
    });
    vaultPanelAnim.setValue(nextStep === STEP.vault ? 0 : 1);
    collectionPanelAnim.setValue(nextStep === STEP.collection ? 0 : 1);
    assetsPanelAnim.setValue(nextStep === STEP.assets ? 0 : 1);
  };

  const transitionToStep = (nextStep, { after } = {}) => {
    if (transitioningStepRef.current) return;
    const from = browseStepRef.current;
    if (from === nextStep) {
      after?.();
      return;
    }
    transitioningStepRef.current = true;

    setRenderPanels((prev) => ({
      ...prev,
      [from]: true,
      [nextStep]: true,
    }));

    if (nextStep === STEP.vault) vaultPanelAnim.setValue(1);
    if (nextStep === STEP.collection) collectionPanelAnim.setValue(1);
    if (nextStep === STEP.assets) assetsPanelAnim.setValue(1);

    const animations = [];
    if (from === STEP.vault) animations.push(Animated.timing(vaultPanelAnim, { toValue: 1, duration: 180, useNativeDriver: true }));
    if (from === STEP.collection) animations.push(Animated.timing(collectionPanelAnim, { toValue: 1, duration: 180, useNativeDriver: true }));
    if (from === STEP.assets) animations.push(Animated.timing(assetsPanelAnim, { toValue: 1, duration: 180, useNativeDriver: true }));

    if (nextStep === STEP.vault) animations.push(Animated.timing(vaultPanelAnim, { toValue: 0, duration: 180, useNativeDriver: true }));
    if (nextStep === STEP.collection) animations.push(Animated.timing(collectionPanelAnim, { toValue: 0, duration: 180, useNativeDriver: true }));
    if (nextStep === STEP.assets) animations.push(Animated.timing(assetsPanelAnim, { toValue: 0, duration: 180, useNativeDriver: true }));

    Animated.parallel(animations).start(() => {
      transitioningStepRef.current = false;
      setBrowseStep(nextStep);
      setRenderPanels({
        vault: nextStep === STEP.vault,
        collection: nextStep === STEP.collection,
        assets: nextStep === STEP.assets,
      });
      after?.();
    });
  };

  const [shareVisible, setShareVisible] = useState(false);
  const [shareTargetType, setShareTargetType] = useState(null);
  const [shareTargetId, setShareTargetId] = useState(null);

  const [vaultEditVisible, setVaultEditVisible] = useState(false);
  const [vaultEditName, setVaultEditName] = useState('');
  const [vaultEditTargetId, setVaultEditTargetId] = useState(null);

  const [collectionEditVisible, setCollectionEditVisible] = useState(false);
  const [collectionEditName, setCollectionEditName] = useState('');
  const [collectionEditTargetId, setCollectionEditTargetId] = useState(null);

  const [collectionMoveVisible, setCollectionMoveVisible] = useState(false);
  const [collectionMoveTargetId, setCollectionMoveTargetId] = useState(null);
  const [moveVaultId, setMoveVaultId] = useState(null);
  const [moveVaultDropdownOpen, setMoveVaultDropdownOpen] = useState(false);

  const markRecentVaultById = (vaultId, { titleOverride } = {}) => {
    const vId = vaultId != null ? String(vaultId) : '';
    if (!vId) return;
    const title = titleOverride != null ? String(titleOverride) : 'Vault';
    Promise.resolve(
      setRecentlyAccessedEntry?.({
        screen: 'Vault',
        params: { vaultId: vId },
        title,
        kind: 'Vault',
      })
    ).catch(() => {});
  };

  const markRecentVault = (vault) => {
    const vId = vault?.id != null ? String(vault.id) : '';
    if (!vId) return;
    const title = vault?.name ? String(vault.name) : 'Vault';
    markRecentVaultById(vId, { titleOverride: title });
  };

  const markRecentCollectionById = (collectionId, { titleOverride } = {}) => {
    const cId = collectionId != null ? String(collectionId) : '';
    if (!cId) return;
    const title = titleOverride != null ? String(titleOverride) : 'Collection';
    Promise.resolve(
      setRecentlyAccessedEntry?.({
        screen: 'Collection',
        params: { collectionId: cId },
        title,
        kind: 'Collection',
      })
    ).catch(() => {});
  };

  const markRecentCollection = (collectionItem) => {
    const cId = collectionItem?.id != null ? String(collectionItem.id) : '';
    if (!cId) return;
    const title = collectionItem?.name ? String(collectionItem.name) : 'Collection';
    markRecentCollectionById(cId, { titleOverride: title });
  };

  const markRecentAsset = (assetItem, { titleOverride } = {}) => {
    const aId = assetItem?.id != null ? String(assetItem.id) : '';
    if (!aId) return;
    const vId = assetItem?.vaultId != null ? String(assetItem.vaultId) : (selectedVaultId ? String(selectedVaultId) : '');
    const title = titleOverride != null ? String(titleOverride) : (assetItem?.title ? String(assetItem.title) : 'Asset');
    Promise.resolve(
      setRecentlyAccessedEntry?.({
        screen: 'Asset',
        params: vId ? { assetId: aId, vaultId: vId } : { assetId: aId },
        title,
        kind: 'Asset',
      })
    ).catch(() => {});
  };

  const selectedVaultAssetsForTotal = useMemo(() => {
    if (!selectedVaultId) return [];
    const vId = String(selectedVaultId);
    const deletedMap = optimisticDeletedAssetIds || {};
    const all = dedupeById([...(optimisticAssets || []), ...(assets || [])]);
    return (all || []).filter((a) => a && String(a?.vaultId || '') === vId && !deletedMap[String(a?.id)]);
  }, [assets, optimisticAssets, optimisticDeletedAssetIds, selectedVaultId]);

  const selectedVaultTotalValue = useMemo(() => {
    let sum = 0;
    for (const a of selectedVaultAssetsForTotal || []) {
      if (!a || a.__empty) continue;
      const qtyRaw = Number(a?.quantity);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      const raw = a?.estimateValue ?? a?.value ?? a?.purchasePrice;
      const n = typeof raw === 'number' ? raw : Number(String(raw || '').replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(n)) continue;
      sum += qty * n;
    }
    return sum;
  }, [selectedVaultAssetsForTotal]);

  const selectedVaultTotalValueLabel = useMemo(() => {
    if (!formatCurrencyValue) return String(selectedVaultTotalValue || 0);
    return formatCurrencyValue(selectedVaultTotalValue || 0);
  }, [formatCurrencyValue, selectedVaultTotalValue]);

  const sharedVaults = useMemo(() => {
    const uid = currentUser?.id ? String(currentUser.id) : null;
    if (!uid) return [];
    const activeVaultIds = new Set(
      (vaultMemberships || [])
        .filter((m) => m?.user_id === uid && m?.status === 'ACTIVE')
        .map((m) => String(m.vault_id))
    );
    return vaults.filter((v) => v?.ownerId !== uid && activeVaultIds.has(String(v.id)));
  }, [vaults, currentUser, vaultMemberships]);

  const sortedSharedVaults = useMemo(() => {
    const list = (sharedVaults || []).slice();
    const dir = vaultSortMode === 'za' ? -1 : 1;
    list.sort((a, b) => dir * String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [sharedVaults, vaultSortMode]);

  const filteredSharedVaults = useMemo(() => {
    const list = sortedSharedVaults || [];
    const q1 = debouncedSearchQuery;
    const q2 = vaultTypeQuery;
    if (!String(q1 || '').trim() && !String(q2 || '').trim()) return list;
    return list.filter((v) => matchesAllQueries(v?.name, [q1, q2]));
  }, [sortedSharedVaults, debouncedSearchQuery, vaultTypeQuery]);

  useEffect(() => {
    const routeSelected = route?.params?.selectedVaultId ? String(route.params.selectedVaultId) : null;
    if (!routeSelected) return;
    setSelectedVaultId(routeSelected);
    setSelectedCollectionId(null);
    setVaultDropdownOpen(false);
    setCollectionDropdownOpen(false);
  }, [route?.params?.selectedVaultId]);

  useEffect(() => {
    const token = route?.params?.openEditToken;
    const openEdit = route?.params?.openEdit;
    if (!token) return;
    if (!openEdit || typeof openEdit !== 'object') return;

    const kind = openEdit?.kind ? String(openEdit.kind) : '';
    const vId = openEdit?.vaultId != null ? String(openEdit.vaultId) : null;
    const cId = openEdit?.collectionId != null ? String(openEdit.collectionId) : null;
    const aId = openEdit?.assetId != null ? String(openEdit.assetId) : null;

    if (vId) {
      setSelectedVaultId(String(vId));
      setVaultDropdownOpen(false);
      setCollectionDropdownOpen(false);
    }

    if (kind === 'Vault' && vId) {
      setSelectedCollectionId(null);
      const v = (sharedVaults || []).find((x) => String(x?.id) === String(vId)) || (vaults || []).find((x) => String(x?.id) === String(vId)) || null;
      setVaultEditName(limit35(v?.name || ''));
      setTimeout(() => setVaultEditVisible(true), 0);
      return;
    }

    if (kind === 'Collection' && vId && cId) {
      setSelectedCollectionId(String(cId));
      const all = dedupeById([...(optimisticCollections || []), ...(collections || [])]);
      const c = all.find((x) => String(x?.id) === String(cId)) || null;
      setCollectionEditName(String(c?.name || '').slice(0, 35));
      setTimeout(() => setCollectionEditVisible(true), 0);
      return;
    }

    if (kind === 'Asset' && vId && aId) {
      if (cId) setSelectedCollectionId(String(cId));
      setTimeout(() => {
        setSelectedAssetId(String(aId));
        const all = dedupeById([...(optimisticAssets || []), ...(assets || [])]);
        const a = all.find((x) => String(x?.id) === String(aId)) || null;
        setAssetEditTitle(limit35(a?.title || ''));
        setAssetEditCategory(limit35(a?.category || ''));
        setAssetEditVisible(true);
      }, 0);
    }
  }, [route?.params?.openEditToken]);

  useEffect(() => {
    const desired = getDesiredStep({ vaultId: selectedVaultId, collectionId: selectedCollectionId });
    if (transitioningStepRef.current) return;
    if (desired === browseStepRef.current) return;
    snapToStep(desired);
  }, [selectedVaultId, selectedCollectionId]);

  useEffect(() => {
    if (!selectedVaultId) return;
    const vId = String(selectedVaultId);
    retainVaultCollections?.(vId);
    retainVaultAssets?.(vId);
    return () => {
      releaseVaultCollections?.(vId);
      releaseVaultAssets?.(vId);
    };
  }, [selectedVaultId, retainVaultCollections, releaseVaultCollections, retainVaultAssets, releaseVaultAssets]);

  const selectedVault = useMemo(
    () => (selectedVaultId ? (sharedVaults || []).find((v) => String(v?.id) === String(selectedVaultId)) : null),
    [sharedVaults, selectedVaultId]
  );

  const vaultForEdit = useMemo(() => {
    const id = vaultEditTargetId != null ? String(vaultEditTargetId) : null;
    if (!id) return null;
    return (sharedVaults || []).find((v) => String(v?.id) === id) || null;
  }, [sharedVaults, vaultEditTargetId]);

  const vaultCaps = useMemo(() => {
    if (!selectedVaultId || !currentUser?.id) return getVaultCapabilities({ role: null, canCreateCollections: false });
    const role = getRoleForVault?.(String(selectedVaultId), String(currentUser.id));
    const canCreateCollections = canCreateCollectionsInVault?.(String(selectedVaultId), String(currentUser.id));
    return getVaultCapabilities({ role, canCreateCollections });
  }, [selectedVaultId, currentUser?.id, getRoleForVault, canCreateCollectionsInVault]);

  const getVaultCapsForId = (vaultId) => {
    if (!vaultId || !currentUser?.id) return getVaultCapabilities({ role: null, canCreateCollections: false });
    const vId = String(vaultId);
    const role = getRoleForVault?.(vId, String(currentUser.id));
    const canCreateCollections = canCreateCollectionsInVault?.(vId, String(currentUser.id));
    return getVaultCapabilities({ role, canCreateCollections });
  };

  const canVaultEditOnline = vaultCaps.canEdit && !isOffline;
  const canVaultShareOnline = vaultCaps.canShare && !isOffline;
  const canCreateCollectionsOnline = vaultCaps.canCreateCollections && !isOffline;

  const vaultEditIdResolved = vaultEditTargetId != null ? String(vaultEditTargetId) : (selectedVaultId != null ? String(selectedVaultId) : null);
  const vaultForEditResolved = vaultForEdit || selectedVault;
  const canVaultEditOnlineForEditModal = vaultEditIdResolved ? (getVaultCapsForId(vaultEditIdResolved).canEdit && !isOffline) : false;

  const vaultCollections = useMemo(() => {
    if (!selectedVaultId) return [];
    const allCollections = dedupeById([...(optimisticCollections || []), ...(collections || [])]);
    const list = allCollections.filter((c) => String(c?.vaultId) === String(selectedVaultId));
    const dir = collectionSortMode === 'za' ? -1 : 1;
    list.sort((a, b) => dir * String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [collections, optimisticCollections, selectedVaultId, collectionSortMode]);

  const filteredVaultCollections = useMemo(() => {
    const list = vaultCollections || [];
    const q1 = debouncedSearchQuery;
    const q2 = collectionTypeQuery;
    if (!String(q1 || '').trim() && !String(q2 || '').trim()) return list;
    return list.filter((c) => matchesAllQueries(c?.name, [q1, q2]));
  }, [vaultCollections, debouncedSearchQuery, collectionTypeQuery]);

  useEffect(() => {
    if (!selectedVaultId) return;
    const stillValid = vaultCollections.find((c) => String(c?.id) === String(selectedCollectionId));
    if (stillValid) return;
    setSelectedCollectionId(null);
  }, [selectedVaultId, vaultCollections, selectedCollectionId]);

  useEffect(() => {
    setCollectionCreateOpen(false);
    setNewCollectionName('');
  }, [selectedVaultId]);

  useEffect(() => {
    setAssetCreateOpen(false);
    setNewAssetTitle('');
  }, [selectedCollectionId]);

  useEffect(() => {
    setSelectedAssetId(null);
    setAssetEditVisible(false);
  }, [selectedVaultId, selectedCollectionId]);

  useEffect(() => {
    const realIds = new Set((collections || []).map((c) => String(c?.id)).filter(Boolean));
    setOptimisticCollections((prev) => (prev || []).filter((c) => !realIds.has(String(c?.id))));
  }, [collections]);

  useEffect(() => {
    const realIds = new Set((assets || []).map((a) => String(a?.id)).filter(Boolean));
    setOptimisticAssets((prev) => (prev || []).filter((a) => !realIds.has(String(a?.id))));
  }, [assets]);

  const selectedCollection = useMemo(
    () => {
      if (!selectedCollectionId) return null;
      const real = (collections || []).find((c) => String(c?.id) === String(selectedCollectionId));
      if (real) return real;
      return (optimisticCollections || []).find((c) => String(c?.id) === String(selectedCollectionId)) || null;
    },
    [collections, optimisticCollections, selectedCollectionId]
  );

  const collectionForEdit = useMemo(() => {
    const id = collectionEditTargetId != null ? String(collectionEditTargetId) : null;
    if (!id) return null;
    const all = dedupeById([...(optimisticCollections || []), ...(collections || [])]);
    return all.find((c) => String(c?.id) === id) || null;
  }, [collections, optimisticCollections, collectionEditTargetId]);

  const collectionForMove = useMemo(() => {
    const id = collectionMoveTargetId != null ? String(collectionMoveTargetId) : null;
    if (!id) return null;
    const all = dedupeById([...(optimisticCollections || []), ...(collections || [])]);
    return all.find((c) => String(c?.id) === id) || null;
  }, [collections, optimisticCollections, collectionMoveTargetId]);

  const ownerVaultsForMove = useMemo(() => {
    const src = collectionForMove || selectedCollection;
    const ownerId = src?.ownerId != null ? String(src.ownerId) : null;
    if (!ownerId) return [];
    const list = (vaults || []).filter((v) => v?.ownerId != null && String(v.ownerId) === ownerId);
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [vaults, selectedCollection?.ownerId, collectionForMove]);

  const collectionCaps = useMemo(() => {
    if (!selectedCollectionId || !currentUser?.id) return getCollectionCapabilities({ role: null, canCreateAssets: false });
    const role = getRoleForCollection?.(String(selectedCollectionId), String(currentUser.id));
    const canCreateAssets = canCreateAssetsInCollection?.(String(selectedCollectionId), String(currentUser.id));
    return getCollectionCapabilities({ role, canCreateAssets });
  }, [selectedCollectionId, currentUser?.id, getRoleForCollection, canCreateAssetsInCollection]);

  const getCollectionCapsForId = (collectionId) => {
    if (!collectionId || !currentUser?.id) return getCollectionCapabilities({ role: null, canCreateAssets: false });
    const cId = String(collectionId);
    const role = getRoleForCollection?.(cId, String(currentUser.id));
    const canCreateAssets = canCreateAssetsInCollection?.(cId, String(currentUser.id));
    return getCollectionCapabilities({ role, canCreateAssets });
  };

  const canCollectionEditOnline = collectionCaps.canEdit && !isOffline;
  const canCollectionShareOnline = collectionCaps.canShare && !isOffline;
  const canCollectionMoveOnline = collectionCaps.canMove && !isOffline;
  const canCollectionCloneOnline = collectionCaps.canClone && !isOffline;
  const canCreateAssetsOnline = (collectionCaps.canCreateAssets || isTempId(selectedCollectionId)) && !isOffline;

  const collectionEditIdResolved = collectionEditTargetId != null ? String(collectionEditTargetId) : (selectedCollectionId != null ? String(selectedCollectionId) : null);
  const collectionForEditResolved = collectionForEdit || selectedCollection;
  const canCollectionEditOnlineForEditModal = collectionEditIdResolved ? (getCollectionCapsForId(collectionEditIdResolved).canEdit && !isOffline) : false;

  const collectionMoveIdResolved = collectionMoveTargetId != null ? String(collectionMoveTargetId) : (selectedCollectionId != null ? String(selectedCollectionId) : null);
  const canCollectionMoveOnlineForMoveModal = collectionMoveIdResolved ? (getCollectionCapsForId(collectionMoveIdResolved).canMove && !isOffline) : false;

  const anyCreateOpen = collectionCreateOpen || assetCreateOpen;

  useEffect(() => {
    if (!anyCreateOpen) return;
    setVaultDropdownOpen(false);
    setCollectionDropdownOpen(false);
  }, [anyCreateOpen]);

  const collectionAssets = useMemo(() => {
    if (!selectedCollectionId) return [];
    const selectedIdStr = String(selectedCollectionId);
    const realAssets = (assets || []).filter((a) => String(a?.collectionId) === selectedIdStr);
    const getTs = (a) => {
      const t = a?.createdAt ?? a?.editedAt;
      if (typeof t === 'number') return t;
      if (t && typeof t.toMillis === 'function') return t.toMillis();
      return null;
    };

    const prunedOptimistic = (optimisticAssets || []).filter((a) => {
      if (!a) return false;
      if (String(a?.collectionId) !== selectedIdStr) return true;
      const isOptimistic = isTempId(a?.id) || !!a?.__pendingCollectionTempId;
      if (!isOptimistic) return true;

      const aTitle = String(a?.title || '').trim().toLowerCase();
      if (!aTitle) return true;

      const aVault = a?.vaultId != null ? String(a.vaultId) : null;
      const aTs = getTs(a);
      if (aTs == null) return true;

      const match = realAssets.find((r) => {
        if (!r) return false;
        if (isTempId(r?.id)) return false;
        if (String(r?.collectionId) !== selectedIdStr) return false;
        if (aVault != null && r?.vaultId != null && String(r.vaultId) !== aVault) return false;
        const rTitle = String(r?.title || '').trim().toLowerCase();
        if (!rTitle || rTitle !== aTitle) return false;
        const rTs = getTs(r);
        if (rTs == null) return false;
        return Math.abs(rTs - aTs) <= 15000;
      });

      return !match;
    });

    const allAssets = dedupeById([...(prunedOptimistic || []), ...(assets || [])]);
    const queries = [debouncedSearchQuery].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
    let list = allAssets.filter((a) => String(a?.collectionId) === selectedIdStr);
    const deletedMap = optimisticDeletedAssetIds || {};
    list = list.filter((a) => !deletedMap[String(a?.id)]);
    if (queries.length) {
      list = list.filter((a) => {
        const t = String(a?.title || '').toLowerCase();
        const c = String(a?.category || '').toLowerCase();
        return queries.every((q) => t.includes(q) || c.includes(q));
      });
    }
    const dir = assetSortMode === 'za' ? -1 : 1;
    list.sort((a, b) => dir * String(a?.title || '').localeCompare(String(b?.title || '')));
    return list;
  }, [assets, optimisticAssets, optimisticDeletedAssetIds, selectedCollectionId, debouncedSearchQuery, assetSortMode]);

  const selectedAsset = useMemo(
    () => {
      if (!selectedAssetId) return null;
      const real = (assets || []).find((a) => String(a?.id) === String(selectedAssetId));
      if (real) return real;
      return (optimisticAssets || []).find((a) => String(a?.id) === String(selectedAssetId)) || null;
    },
    [assets, optimisticAssets, selectedAssetId]
  );

  const assetCaps = useMemo(() => {
    if (!selectedAssetId || !currentUser?.id) return getAssetCapabilities({ role: null });
    const role = getRoleForAsset?.(String(selectedAssetId), String(currentUser.id));
    return getAssetCapabilities({ role });
  }, [selectedAssetId, currentUser?.id, getRoleForAsset]);

  const canAssetEditOnline = assetCaps.canEdit && !isOffline;
  const canAssetShareOnline = assetCaps.canShare && !isOffline;
  const canAssetDeleteOnline = assetCaps.canDelete && !isOffline;

  const assetMoveAsset = useMemo(
    () => {
      if (!assetMoveAssetId) return null;
      return (assets || []).find((a) => String(a?.id) === String(assetMoveAssetId)) || null;
    },
    [assets, assetMoveAssetId]
  );

  const assetMoveOwnerVaults = useMemo(() => {
    const ownerId = assetMoveAsset?.ownerId != null ? String(assetMoveAsset.ownerId) : null;
    if (!ownerId) return [];
    const list = (vaults || []).filter((v) => v?.ownerId != null && String(v.ownerId) === ownerId);
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [assetMoveAsset?.ownerId, vaults]);

  const assetMoveOwnerCollections = useMemo(() => {
    const ownerId = assetMoveAsset?.ownerId != null ? String(assetMoveAsset.ownerId) : null;
    if (!ownerId || !assetMoveVaultId) return [];
    const vId = String(assetMoveVaultId);
    const all = dedupeById([...(optimisticCollections || []), ...(collections || [])]);
    const list = all.filter((c) => c?.ownerId != null && String(c.ownerId) === ownerId && String(c?.vaultId) === vId);
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [assetMoveAsset?.ownerId, assetMoveVaultId, collections, optimisticCollections]);

  useEffect(() => {
    if (!assetMoveVisible) return;
    if (!assetMoveVaultId || isTempId(assetMoveVaultId)) return;
    const vId = String(assetMoveVaultId);
    retainVaultCollections?.(vId);
    return () => releaseVaultCollections?.(vId);
  }, [assetMoveVisible, assetMoveVaultId, retainVaultCollections, releaseVaultCollections]);

  useEffect(() => {
    if (!assetMoveVisible) return;
    const valid = assetMoveOwnerCollections.some((c) => String(c?.id) === String(assetMoveCollectionId));
    if (valid) return;
    setAssetMoveCollectionId(assetMoveOwnerCollections.length ? String(assetMoveOwnerCollections[0].id) : null);
  }, [assetMoveVisible, assetMoveOwnerCollections, assetMoveCollectionId]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await refreshData?.();
        await loadInvitations();
      }, 800);
      showNotice?.('Refresh complete.', { durationMs: 1200 });
    } finally {
      setRefreshing(false);
    }
  };

  const getInviteStatusPresentation = (rawStatus) => {
    const status = String(rawStatus || '').toUpperCase();
    if (status === 'PENDING') {
      return { label: 'Pending', bg: theme.warning, border: theme.warningBorder, text: theme.isDark ? '#111827' : theme.text };
    }
    if (status === 'ACCEPTED') {
      return { label: 'Active', bg: theme.success, border: theme.successBorder, text: theme.onAccentText };
    }
    if (status === 'DENIED') {
      return { label: 'Denied', bg: theme.danger, border: theme.dangerBorder, text: theme.onAccentText };
    }
    return { label: status || 'Pending', bg: theme.surfaceAlt, border: theme.border, text: theme.textSecondary };
  };

  const loadInvitations = async () => {
    if (invitesLoading) return;
    if (isOffline) {
      setInvitesError('Internet connection required.');
      setInvitations([]);
      return;
    }
    setInvitesLoading(true);
    setInvitesError('');
    try {
      const res = await listMyInvitations?.();
      if (!res || res.ok === false) {
        setInvitations([]);
        setInvitesError(res?.message || 'Unable to load invitations');
        return;
      }
      setInvitations(Array.isArray(res?.invitations) ? res.invitations : []);
    } finally {
      setInvitesLoading(false);
    }
  };

  useEffect(() => {
    loadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAcceptInvitation = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return false;
    const res = await acceptInvitationCode?.(raw);
    if (!res || res.ok === false) {
      Alert.alert('Invite failed', res?.message || 'Unable to accept invite');
      return false;
    }
    Alert.alert('Joined', 'You now have access to the shared vault.');
    if (res.vaultId) {
      setSelectedVaultId(String(res.vaultId));
      setSelectedCollectionId(null);
      setVaultDropdownOpen(false);
      setCollectionDropdownOpen(false);
    }
    await loadInvitations();
    return true;
  };

  const handleDenyInvitation = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return false;
    const res = await denyInvitationCode?.(raw);
    if (!res || res.ok === false) {
      Alert.alert('Invite failed', res?.message || 'Unable to deny invite');
      return false;
    }
    Alert.alert('Denied', 'Invitation denied.');
    await loadInvitations();
    return true;
  };

  const onSelectVault = (vaultId) => {
    const vId = vaultId ? String(vaultId) : null;
    setSelectedVaultId(vId);
    setSelectedCollectionId(null);
    setCollectionTypeQuery('');
    setVaultDropdownOpen(false);
    setCollectionDropdownOpen(false);

    // Keep Total Value + Search in view after selecting.
    scrollToTop();

    // Advance to collection selection after choosing a vault.
    if (vId) transitionToStep(STEP.collection);
    else transitionToStep(STEP.vault);
  };

  const onSelectCollection = (collectionId) => {
    const cId = collectionId ? String(collectionId) : null;
    setSelectedCollectionId(cId);
    setCollectionDropdownOpen(false);

    // Keep Total Value + Search in view after selecting.
    scrollToTop();

    setNewCollectionName('');
    setCollectionCreateOpen(false);
    if (cId) transitionToStep(STEP.assets);
  };

  const goBackToVaultSelection = () => {
    if (transitioningStepRef.current) return;
    setVaultDropdownOpen(false);
    setCollectionDropdownOpen(false);
    setNewCollectionName('');
    setCollectionCreateOpen(false);
    transitionToStep(STEP.vault, {
      after: () => {
        setSelectedCollectionId(null);
        setSelectedVaultId(null);
        setCollectionTypeQuery('');
      },
    });
  };

  const goBackToCollectionSelection = () => {
    if (transitioningStepRef.current) return;
    setCollectionDropdownOpen(false);
    transitionToStep(STEP.collection, {
      after: () => {
        setSelectedCollectionId(null);
        setCollectionTypeQuery('');
      },
    });
  };

  const flushPendingAssetsForCollection = async (tempCollectionId, realCollectionId) => {
    const tempIdStr = String(tempCollectionId);
    const realIdStr = String(realCollectionId);

    const pending = (optimisticAssets || []).filter(
      (a) => a && a.__pendingCollectionTempId && String(a.__pendingCollectionTempId) === tempIdStr
    );
    if (!pending.length) return;

    for (const a of pending) {
      const tempAssetId = String(a.id);
      const title = limit35(String(a.title || '').trim());
      if (!title) {
        setOptimisticAssets((prev) => (prev || []).filter((x) => String(x?.id) !== tempAssetId));
        continue;
      }

      try {
        const res = await addAsset?.({ vaultId: String(selectedVaultId), collectionId: realIdStr, title });
        if (!res || res.ok === false || !res.assetId) {
          Alert.alert('Create failed', res?.message || 'Unable to create asset');
          setOptimisticAssets((prev) => (prev || []).filter((x) => String(x?.id) !== tempAssetId));
          continue;
        }

        const realAssetId = String(res.assetId);
        setOptimisticAssets((prev) =>
          (prev || []).map((x) => {
            if (String(x?.id) !== tempAssetId) return x;
            const { __pendingCollectionTempId, ...rest } = x;
            return { ...rest, id: realAssetId, collectionId: realIdStr };
          })
        );
      } catch (e) {
        Alert.alert('Create failed', 'Unable to create asset');
        setOptimisticAssets((prev) => (prev || []).filter((x) => String(x?.id) !== tempAssetId));
      }
    }
  };

  const assetSections = useMemo(() => {
    if (!selectedVaultId || !selectedCollectionId) return [];
    const data = (collectionAssets || []).length ? collectionAssets : [{ id: '__empty_assets__', __empty: true }];
    return [{ key: 'assets', data }];
  }, [selectedVaultId, selectedCollectionId, collectionAssets]);

  const renderAssetsSectionHeader = () => {
    if (!selectedVaultId || !selectedCollectionId) return null;
    return (
      <View
        style={[
          styles.card,
          styles.assetAccent,
          {
            marginTop: 12,
            backgroundColor: theme.surface,
            borderColor: theme.border,
            borderLeftColor: theme.success,
          },
        ]}
      >
        <View style={styles.cardRow}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Assets</Text>
        </View>

        {assetCreateOpen ? (
          <View style={styles.createRow}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder="New asset title"
              placeholderTextColor={theme.placeholder}
              value={newAssetTitle}
              editable={canCreateAssetsOnline && !assetCreateBusy}
              onChangeText={(t) => setNewAssetTitle(String(t || '').slice(0, 35))}
              {...noAutoCorrect}
            />
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
              onPress={() => {
                setNewAssetTitle('');
                setAssetCreateOpen(false);
              }}
            >
              <Text style={[styles.secondaryText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addButton,
                { backgroundColor: theme.success, borderColor: theme.success },
                (!newAssetTitle.trim() || !canCreateAssetsOnline || assetCreateBusy) && styles.buttonDisabled,
              ]}
              disabled={!newAssetTitle.trim() || !canCreateAssetsOnline || assetCreateBusy}
              onPress={() => {
                if (!canCreateAssetsOnline) return Alert.alert('Internet connection required. Please reconnect and try again.');
                if (assetCreateBusy) return;
                const title = String(newAssetTitle || '').trim().slice(0, 35);
                if (!title) return;

                const tempId = makeTempId();
                const optimistic = {
                  id: tempId,
                  title,
                  vaultId: String(selectedVaultId),
                  collectionId: String(selectedCollectionId),
                  category: '',
                  createdAt: Date.now(),
                  editedAt: Date.now(),
                };

                if (isTempId(selectedCollectionId)) {
                  setOptimisticAssets((prev) => [
                    ...(prev || []),
                    { ...optimistic, __pendingCollectionTempId: String(selectedCollectionId) },
                  ]);
                  setNewAssetTitle('');
                  setAssetCreateOpen(false);
                  return;
                }

                setOptimisticAssets((prev) => [...(prev || []), optimistic]);

                setNewAssetTitle('');
                setAssetCreateOpen(false);

                setAssetCreateBusy(true);
                (async () => {
                  try {
                    const res = await addAsset?.({ vaultId: String(selectedVaultId), collectionId: String(selectedCollectionId), title });
                    if (!res || res.ok === false) {
                      Alert.alert('Create failed', res?.message || 'Unable to create asset');
                      setOptimisticAssets((prev) => (prev || []).filter((a) => String(a?.id) !== String(tempId)));
                      setNewAssetTitle(title);
                      setAssetCreateOpen(true);
                      return;
                    }
                    if (res.assetId) {
                      const realId = String(res.assetId);
                      setOptimisticAssets((prev) =>
                        (prev || []).map((a) => {
                          if (String(a?.id) !== String(tempId)) return a;
                          return { ...a, id: realId };
                        })
                      );
                      Promise.resolve(
                        setRecentlyAccessedEntry?.({
                          screen: 'Asset',
                          params: { assetId: realId, vaultId: String(selectedVaultId) },
                          title,
                          kind: 'Asset',
                        })
                      ).catch(() => {});
                    }
                    // Let realtime listeners update global state; optimistic UI already shows instantly.
                  } finally {
                    setAssetCreateBusy(false);
                  }
                })();
              }}
            >
              <Text style={[styles.addButtonText, { color: theme.onAccentText }]}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  const renderAssetsItem = ({ item }) => {
    if (!selectedVaultId || !selectedCollectionId) return null;
    const outerStyle = {
      marginTop: 10,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderLeftColor: theme.success,
      borderLeftWidth: 4,
      borderWidth: 1,
      borderRadius: 10,
      paddingLeft: 12,
      paddingRight: 14,
      paddingBottom: 10,
    };

    if (item?.__empty) {
      return (
        <View style={outerStyle}>
          <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 0, paddingVertical: 10 }]}>No assets in this collection.</Text>
        </View>
      );
    }

    const a = item;
    const canMoveCloneRole = currentUser?.id ? getRoleForAsset?.(String(a.id), String(currentUser.id)) : null;
    const moveCloneCaps = getAssetCapabilities({ role: canMoveCloneRole });
    const canAssetEditOnlineForRow = moveCloneCaps.canEdit && !isOffline;
    const canAssetMoveOnlineForRow = moveCloneCaps.canMove && !isOffline;
    const canAssetCloneOnlineForRow = moveCloneCaps.canClone && !isOffline && typeof addAsset === 'function';

    return (
      <View style={outerStyle}>
        <TouchableOpacity
          style={[styles.assetRow, { borderBottomWidth: 0 }]}
          onPress={() => {
            if (isTempId(a?.id)) return;
            markRecentAsset(a);
            setSelectedAssetId(String(a.id));
            setAssetEditTitle(limit35(a?.title || ''));
            setAssetEditCategory(limit35(a?.category || ''));
            setAssetEditVisible(true);
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.assetTitle, { color: theme.text }]}>{a.title || 'Untitled'}</Text>
            {a.category ? <Text style={[styles.assetMeta, { color: theme.textMuted }]}>{a.category}</Text> : null}
          </View>
          <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
        </TouchableOpacity>

        {!isTempId(a?.id) ? (
          <View style={styles.assetInlineActions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, !canAssetEditOnlineForRow && styles.buttonDisabled]}
              disabled={!canAssetEditOnlineForRow}
              onPress={() => {
                markRecentAsset(a);
                setSelectedAssetId(String(a.id));
                setAssetEditTitle(limit35(a?.title || ''));
                setAssetEditCategory(limit35(a?.category || ''));
                setAssetEditVisible(true);
              }}
            >
              <Text style={[styles.actionButtonText, { color: theme.text }]}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, !canAssetMoveOnlineForRow && styles.buttonDisabled]}
              disabled={!canAssetMoveOnlineForRow}
              onPress={() => {
                markRecentAsset(a);
                setAssetMoveAssetId(String(a.id));
                setAssetMoveVaultId(String(a?.vaultId || selectedVaultId || ''));
                setAssetMoveCollectionId(String(a?.collectionId || selectedCollectionId || ''));
                setAssetMoveVaultDropdownOpen(false);
                setAssetMoveCollectionDropdownOpen(false);
                setAssetMoveVisible(true);
              }}
            >
              <Text style={[styles.actionButtonText, { color: theme.text }]}>Move</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, !canAssetCloneOnlineForRow && styles.buttonDisabled]}
              disabled={!canAssetCloneOnlineForRow}
              onPress={() => {
                const baseTitle = a?.title ? String(a.title) : 'Untitled';
                const copyTitle = limit35(`${baseTitle} (Copy)`);
                const tempId = makeTempId();
                markRecentAsset({ ...a, id: tempId }, { titleOverride: copyTitle });
                const optimistic = {
                  id: tempId,
                  title: copyTitle,
                  vaultId: String(a?.vaultId || selectedVaultId || ''),
                  collectionId: String(a?.collectionId || selectedCollectionId || ''),
                  category: a?.category ? String(a.category) : '',
                  createdAt: Date.now(),
                  editedAt: Date.now(),
                };
                setOptimisticAssets((prev) => [...(prev || []), optimistic]);
                (async () => {
                  const res = await addAsset?.({
                    vaultId: String(a?.vaultId || selectedVaultId || ''),
                    collectionId: String(a?.collectionId || selectedCollectionId || ''),
                    title: copyTitle,
                    type: a?.type,
                    category: a?.category,
                    images: a?.images,
                    heroImage: a?.heroImage,
                  });
                  if (!res || res.ok === false) {
                    Alert.alert('Clone failed', res?.message || 'Unable to clone asset');
                    setOptimisticAssets((prev) => (prev || []).filter((x) => String(x?.id) !== String(tempId)));
                    return;
                  }
                  if (res.assetId) {
                    const realId = String(res.assetId);
                    markRecentAsset({ ...a, id: realId }, { titleOverride: copyTitle });
                    setOptimisticAssets((prev) =>
                      (prev || []).map((x) => (String(x?.id) === String(tempId) ? { ...x, id: realId } : x))
                    );
                  }
                })();
              }}
            >
              <Text style={[styles.actionButtonText, { color: theme.text }]}>Clone</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  const renderAssetsSectionFooter = () => {
    return null;
  };

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}> 
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} theme={theme} />
      <SectionList
        ref={listRef}
        contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
        bounces
        alwaysBounceVertical
        stickySectionHeadersEnabled={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const y = e?.nativeEvent?.contentOffset?.y ?? 0;
          if (y < 0) {
            setPullDistance(Math.min(60, -y));
          } else {
            setPullDistance(0);
          }
          const shouldShow = y > 300;
          if (shouldShow !== showJumpToTopRef.current) {
            showJumpToTopRef.current = shouldShow;
            setShowJumpToTop(shouldShow);
          }
        }}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.isDark ? '#fff' : '#111827'}
            progressViewOffset={24}
          />
        }
        sections={assetSections}
        keyExtractor={(item, index) => String(item?.id ?? index)}
        renderSectionHeader={renderAssetsSectionHeader}
        renderItem={renderAssetsItem}
        renderSectionFooter={renderAssetsSectionFooter}
        ListFooterComponent={<View style={{ height: 24 }} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <LambHeader />
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: theme.text }]}>Shared Vaults</Text>
              {currentUser ? (
                <TouchableOpacity
                  onPress={goProfile}
                  disabled={isOnProfile}
                  accessibilityRole="button"
                  accessibilityLabel="Profile"
                >
                  {!avatarFailed && currentUser?.profileImage ? (
                    <Image source={{ uri: currentUser.profileImage }} style={styles.avatar} onError={() => setAvatarFailed(true)} />
                  ) : (
                    <View
                      style={[
                        styles.avatar,
                        {
                          backgroundColor: theme.primary,
                          borderColor: theme.primary,
                          borderWidth: 1,
                          alignItems: 'center',
                          justifyContent: 'center',
                        },
                      ]}
                    >
                      <Text style={[styles.avatarFallbackText, { color: theme.onAccentText || '#fff' }]}>{getInitials(currentUser)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>

            {showVaultTotalValue !== false && selectedVaultId ? (
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={styles.totalValueRow}>
                  <Text style={[styles.totalValueLabel, { color: theme.textSecondary }]}>Total Value</Text>
                  <Text style={[styles.totalValueAmount, { color: theme.text }]}>{selectedVaultTotalValueLabel}</Text>
                </View>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
              <TextInput
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Search vaults, collections, assets"
                placeholderTextColor={theme.placeholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                {...noAutoCorrect}
              />
            </View>

            {!loading ? (
              <View style={styles.globalControlsRow}>
                {browseStep !== STEP.vault ? (
                  <TouchableOpacity
                    style={[styles.stepBackButton, { borderColor: theme.border, backgroundColor: theme.surface }, anyCreateOpen && styles.buttonDisabled]}
                    onPress={browseStep === STEP.collection ? goBackToVaultSelection : goBackToCollectionSelection}
                    disabled={anyCreateOpen}
                  >
                    <Ionicons name="chevron-back" size={18} color={theme.text} />
                    <Text style={[styles.secondaryText, { color: theme.text }]}>Back</Text>
                  </TouchableOpacity>
                ) : (
                  <View />
                )}

                <View style={styles.globalControlsRight}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
                    onPress={() => {
                      if (browseStep === STEP.vault) setVaultSortMode((m) => (m === 'az' ? 'za' : 'az'));
                      else if (browseStep === STEP.collection) setCollectionSortMode((m) => (m === 'az' ? 'za' : 'az'));
                      else setAssetSortMode((m) => (m === 'az' ? 'za' : 'az'));
                    }}
                    disabled={(browseStep === STEP.collection && !selectedVaultId) || (browseStep === STEP.assets && !selectedCollectionId)}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>
                      {browseStep === STEP.vault
                        ? (vaultSortMode === 'az' ? 'A–Z' : 'Z–A')
                        : browseStep === STEP.collection
                          ? (collectionSortMode === 'az' ? 'A–Z' : 'Z–A')
                          : (assetSortMode === 'az' ? 'A–Z' : 'Z–A')}
                    </Text>
                  </TouchableOpacity>

                  {browseStep === STEP.collection ? (
                    !collectionCreateOpen ? (
                      <TouchableOpacity
                        style={[
                          styles.addButton,
                          { backgroundColor: theme.success, borderColor: theme.success },
                          (!selectedVaultId || !canCreateCollectionsOnline || collectionCreateBusy) && styles.buttonDisabled,
                        ]}
                        disabled={!selectedVaultId || !canCreateCollectionsOnline || collectionCreateBusy}
                        onPress={() => setCollectionCreateOpen(true)}
                      >
                        <Text style={[styles.addButtonText, { color: theme.onAccentText }]}>+</Text>
                      </TouchableOpacity>
                    ) : null
                  ) : browseStep === STEP.assets ? (
                    !assetCreateOpen ? (
                      <TouchableOpacity
                        style={[
                          styles.addButton,
                          { backgroundColor: theme.success, borderColor: theme.success },
                          (!canCreateAssetsOnline || assetCreateBusy) && styles.buttonDisabled,
                        ]}
                        disabled={!canCreateAssetsOnline || assetCreateBusy}
                        onPress={() => setAssetCreateOpen(true)}
                      >
                        <Text style={[styles.addButtonText, { color: theme.onAccentText }]}>+</Text>
                      </TouchableOpacity>
                    ) : null
                  ) : null}
                </View>
              </View>
            ) : null}

            <ShareModal
              visible={shareVisible}
              onClose={() => {
                setShareVisible(false);
                setShareTargetType(null);
                setShareTargetId(null);
              }}
              targetType={shareTargetType || 'vault'}
              targetId={shareTargetId || selectedVaultId}
            />

        <Modal visible={assetEditVisible} transparent animationType="fade" onRequestClose={() => setAssetEditVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Asset</Text>

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Title</Text>
              <TextInput
                value={assetEditTitle}
                onChangeText={(t) => setAssetEditTitle(limit35(t || ''))}
                placeholder="Asset title"
                placeholderTextColor={theme.placeholder}
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                {...noAutoCorrect}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Category</Text>
              <TextInput
                value={assetEditCategory}
                onChangeText={(t) => setAssetEditCategory(limit35(t || ''))}
                placeholder="Category"
                placeholderTextColor={theme.placeholder}
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                {...noAutoCorrect}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  onPress={() => setAssetEditVisible(false)}
                >
                  <Text style={[styles.secondaryText, { color: theme.text }]}>Close</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: theme.primary, borderColor: theme.primary }, (!selectedAssetId || !canAssetEditOnline) && styles.buttonDisabled]}
                  disabled={!selectedAssetId || !canAssetEditOnline}
                  onPress={() => {
                    if (!selectedAssetId) return;
                    const expectedEditedAt = selectedAsset?.editedAt ?? null;
                    const patch = {
                      title: limit35(String(assetEditTitle || '').trim()),
                      category: limit35(String(assetEditCategory || '').trim()),
                    };
                    (async () => {
                      const res = await updateAsset?.(String(selectedAssetId), patch, { expectedEditedAt });
                      if (!res || res.ok === false) {
                        NativeAlert.alert('Save failed', res?.message || 'Unable to update asset');
                        return;
                      }
                      setAssetEditVisible(false);
                    })();
                  }}
                >
                  <Text style={[styles.primaryButtonText, { color: theme.onAccentText }]}>Save</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.dangerButton, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBorder }, (!selectedAssetId || !canAssetDeleteOnline) && styles.buttonDisabled]}
                  disabled={!selectedAssetId || !canAssetDeleteOnline}
                  onPress={() => {
                    if (!selectedAssetId) return;
                    NativeAlert.alert('Delete Asset?', 'This action cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          (async () => {
                            const assetIdToDelete = String(selectedAssetId);
                            // Optimistic UX: hide immediately so the user can't interact with it while the backend completes.
                            setOptimisticDeletedAssetIds((prev) => ({ ...(prev || {}), [assetIdToDelete]: true }));
                            setAssetEditVisible(false);
                            setSelectedAssetId(null);

                            const res = await deleteAsset?.(assetIdToDelete);
                            if (!res || res.ok === false) {
                              setOptimisticDeletedAssetIds((prev) => {
                                const next = { ...(prev || {}) };
                                delete next[assetIdToDelete];
                                return next;
                              });
                              NativeAlert.alert('Delete failed', res?.message || 'Unable to delete asset');
                              return;
                            }

                            setOptimisticDeletedAssetIds((prev) => {
                              const next = { ...(prev || {}) };
                              delete next[assetIdToDelete];
                              return next;
                            });
                          })();
                        },
                      },
                    ]);
                  }}
                >
                  <Text style={[styles.dangerButtonText, { color: theme.dangerText }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={assetMoveVisible} transparent animationType="fade" onRequestClose={() => setAssetMoveVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Move Asset</Text>

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Destination Vault</Text>
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => {
                  setAssetMoveVaultDropdownOpen((v) => !v);
                  setAssetMoveCollectionDropdownOpen(false);
                }}
                disabled={isOffline || assetMoveBusy}
              >
                <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                  {assetMoveVaultId ? (assetMoveOwnerVaults.find((v) => String(v.id) === String(assetMoveVaultId))?.name || 'Select vault…') : 'Select vault…'}
                </Text>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{assetMoveVaultDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {assetMoveVaultDropdownOpen ? (
                <ScrollView style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]} nestedScrollEnabled>
                  {assetMoveOwnerVaults.map((v) => {
                    const active = assetMoveVaultId != null && String(v.id) === String(assetMoveVaultId);
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[styles.dropdownItem, { borderBottomColor: theme.border }, active && styles.dropdownItemActive]}
                        onPress={() => {
                          setAssetMoveVaultId(String(v.id));
                          setAssetMoveVaultDropdownOpen(false);
                        }}
                      >
                        <Text style={[styles.dropdownItemText, { color: theme.text }]}>{v.name || v.id}</Text>
                        {active && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : null}

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Destination Collection</Text>
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => {
                  setAssetMoveCollectionDropdownOpen((v) => !v);
                  setAssetMoveVaultDropdownOpen(false);
                }}
                disabled={isOffline || assetMoveBusy || !assetMoveVaultId}
              >
                <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                  {assetMoveCollectionId
                    ? (assetMoveOwnerCollections.find((c) => String(c.id) === String(assetMoveCollectionId))?.name || 'Select collection…')
                    : 'Select collection…'}
                </Text>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{assetMoveCollectionDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {assetMoveCollectionDropdownOpen ? (
                <ScrollView style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]} nestedScrollEnabled>
                  {assetMoveOwnerCollections.map((c) => {
                    const active = assetMoveCollectionId != null && String(c.id) === String(assetMoveCollectionId);
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.dropdownItem, { borderBottomColor: theme.border }, active && styles.dropdownItemActive]}
                        onPress={() => {
                          setAssetMoveCollectionId(String(c.id));
                          setAssetMoveCollectionDropdownOpen(false);
                        }}
                      >
                        <Text style={[styles.dropdownItemText, { color: theme.text }]}>{c.name || c.id}</Text>
                        {active && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : null}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  onPress={() => {
                    setAssetMoveVisible(false);
                    setAssetMoveAssetId(null);
                    setAssetMoveVaultDropdownOpen(false);
                    setAssetMoveCollectionDropdownOpen(false);
                  }}
                >
                  <Text style={[styles.secondaryText, { color: theme.text }]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: theme.primary, borderColor: theme.primary },
                    (isOffline || assetMoveBusy || !assetMoveAssetId || !assetMoveVaultId || !assetMoveCollectionId) && styles.buttonDisabled,
                  ]}
                  disabled={isOffline || assetMoveBusy || !assetMoveAssetId || !assetMoveVaultId || !assetMoveCollectionId}
                  onPress={() => {
                    if (!assetMoveAssetId || !assetMoveVaultId || !assetMoveCollectionId) return;
                    if (assetMoveBusy) return;
                    setAssetMoveBusy(true);
                    (async () => {
                      try {
                        const res = await moveAsset?.({
                          assetId: String(assetMoveAssetId),
                          targetVaultId: String(assetMoveVaultId),
                          targetCollectionId: String(assetMoveCollectionId),
                        });
                        if (!res || res.ok === false) {
                          Alert.alert('Move failed', res?.message || 'Unable to move asset');
                          return;
                        }
                        setAssetMoveVisible(false);
                        setAssetMoveAssetId(null);
                        setAssetMoveVaultDropdownOpen(false);
                        setAssetMoveCollectionDropdownOpen(false);
                        await refreshData?.();
                      } finally {
                        setAssetMoveBusy(false);
                      }
                    })();
                  }}
                >
                  <Text style={[styles.primaryButtonText, { color: theme.onAccentText }]}>Move</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={vaultEditVisible} transparent animationType="fade" onRequestClose={() => setVaultEditVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Vault</Text>
              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Name</Text>
              <TextInput
                value={vaultEditName}
                onChangeText={(t) => setVaultEditName(String(t || '').slice(0, 35))}
                placeholder="Vault name"
                placeholderTextColor={theme.placeholder}
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                {...noAutoCorrect}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  onPress={() => {
                    setVaultEditVisible(false);
                    setVaultEditTargetId(null);
                  }}
                >
                  <Text style={[styles.secondaryText, { color: theme.text }]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: theme.primary, borderColor: theme.primary },
                    (!vaultEditIdResolved || !vaultForEditResolved || !canVaultEditOnlineForEditModal) && styles.buttonDisabled,
                  ]}
                  disabled={!vaultEditIdResolved || !vaultForEditResolved || !canVaultEditOnlineForEditModal}
                  onPress={() => {
                    if (!vaultEditIdResolved || !vaultForEditResolved) return;
                    const expectedEditedAt = vaultForEditResolved?.editedAt ?? null;
                    (async () => {
                      const res = await updateVault?.(
                        String(vaultEditIdResolved),
                        { name: String((vaultEditName || '')).trim().slice(0, 35) },
                        { expectedEditedAt }
                      );
                      if (!res || res.ok === false) {
                        Alert.alert('Save failed', res?.message || 'Unable to update vault');
                        return;
                      }
                      setVaultEditVisible(false);
                      setVaultEditTargetId(null);
                    })();
                  }}
                >
                  <Text style={[styles.primaryButtonText, { color: theme.onAccentText }]}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={collectionEditVisible} transparent animationType="fade" onRequestClose={() => setCollectionEditVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Collection</Text>
              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Name</Text>
              <TextInput
                value={collectionEditName}
                onChangeText={(t) => setCollectionEditName(String(t || '').slice(0, 35))}
                placeholder="Collection name"
                placeholderTextColor={theme.placeholder}
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                {...noAutoCorrect}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  onPress={() => {
                    setCollectionEditVisible(false);
                    setCollectionEditTargetId(null);
                  }}
                >
                  <Text style={[styles.secondaryText, { color: theme.text }]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: theme.primary, borderColor: theme.primary },
                    (!collectionEditIdResolved || !collectionForEditResolved || !canCollectionEditOnlineForEditModal) && styles.buttonDisabled,
                  ]}
                  disabled={!collectionEditIdResolved || !collectionForEditResolved || !canCollectionEditOnlineForEditModal}
                  onPress={() => {
                    if (!collectionEditIdResolved || !collectionForEditResolved) return;
                    const expectedEditedAt = collectionForEditResolved?.editedAt ?? null;
                    (async () => {
                      const res = await updateCollection?.(
                        String(collectionEditIdResolved),
                        { name: String((collectionEditName || '')).trim().slice(0, 35) },
                        { expectedEditedAt }
                      );
                      if (!res || res.ok === false) {
                        Alert.alert('Save failed', res?.message || 'Unable to update collection');
                        return;
                      }
                      setCollectionEditVisible(false);
                      setCollectionEditTargetId(null);
                    })();
                  }}
                >
                  <Text style={[styles.primaryButtonText, { color: theme.onAccentText }]}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={collectionMoveVisible} transparent animationType="fade" onRequestClose={() => setCollectionMoveVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Move Collection</Text>
              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Destination Vault</Text>

              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => setMoveVaultDropdownOpen((v) => !v)}
                disabled={!canCollectionMoveOnlineForMoveModal}
              >
                <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                  {moveVaultId ? (ownerVaultsForMove.find((v) => String(v.id) === String(moveVaultId))?.name || 'Select vault…') : 'Select vault…'}
                </Text>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{moveVaultDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {moveVaultDropdownOpen && (
                <ScrollView style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]} nestedScrollEnabled>
                  {ownerVaultsForMove.map((v) => {
                    const active = moveVaultId != null && String(v.id) === String(moveVaultId);
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[styles.dropdownItem, { borderBottomColor: theme.border }, active && styles.dropdownItemActive]}
                        onPress={() => {
                          setMoveVaultId(String(v.id));
                          setMoveVaultDropdownOpen(false);
                        }}
                      >
                        <Text style={[styles.dropdownItemText, { color: theme.text }]}>{v.name || v.id}</Text>
                        {active && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  onPress={() => {
                    setCollectionMoveVisible(false);
                    setCollectionMoveTargetId(null);
                  }}
                >
                  <Text style={[styles.secondaryText, { color: theme.text }]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: theme.primary, borderColor: theme.primary },
                    (!collectionMoveIdResolved || !moveVaultId || !canCollectionMoveOnlineForMoveModal) && styles.buttonDisabled,
                  ]}
                  disabled={!collectionMoveIdResolved || !moveVaultId || !canCollectionMoveOnlineForMoveModal}
                  onPress={() => {
                    if (!collectionMoveIdResolved || !moveVaultId) return;
                    (async () => {
                      const res = await moveCollection?.({ collectionId: String(collectionMoveIdResolved), targetVaultId: String(moveVaultId) });
                      if (!res || res.ok === false) {
                        Alert.alert('Move failed', res?.message || 'Unable to move collection');
                        return;
                      }
                      setCollectionMoveVisible(false);
                      setCollectionMoveTargetId(null);
                      setSelectedVaultId(String(moveVaultId));
                      await refreshData?.();
                    })();
                  }}
                >
                  <Text style={[styles.primaryButtonText, { color: theme.onAccentText }]}>Move</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Invitations</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 6 }]}>Review invitations to shared vaults.</Text>
          {invitesError ? <Text style={[styles.subtitle, { color: theme.danger, marginTop: 6 }]}>{invitesError}</Text> : null}

          {invitesLoading ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 10 }]}>Loading…</Text>
          ) : invitations.length === 0 ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 10 }]}>No invitations.</Text>
          ) : (
            <View style={{ gap: 10, marginTop: 10 }}>
              {invitations.map((inv) => {
                const pres = getInviteStatusPresentation(inv?.status);
                const vaultName = inv?.vault?.name || 'Shared Vault';
                const isPending = String(inv?.status || '').toUpperCase() === 'PENDING';
                return (
                  <View key={String(inv?.id)} style={[styles.card, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, marginTop: 0 }]}>
                    <View style={[styles.cardRow, { gap: 10 }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                          {vaultName}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: pres.bg, borderColor: pres.border }]}>
                        <Text style={[styles.statusText, { color: pres.text }]}>{pres.label}</Text>
                      </View>
                    </View>

                    {isPending ? (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <TouchableOpacity
                          style={[styles.secondaryButton, { borderColor: theme.successBorder, backgroundColor: theme.success, flex: 1 }]}
                          onPress={() => handleAcceptInvitation(String(inv.id))}
                          disabled={isOffline}
                        >
                          <Text style={[styles.secondaryText, { color: theme.onAccentText, textAlign: 'center' }]}>Accept</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.secondaryButton, { borderColor: theme.dangerBorder, backgroundColor: theme.danger, flex: 1 }]}
                          onPress={() => handleDenyInvitation(String(inv.id))}
                          disabled={isOffline}
                        >
                          <Text style={[styles.secondaryText, { color: theme.onAccentText, textAlign: 'center' }]}>Deny</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.sectionHeader} />

        {loading ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Loading…</Text>
        ) : sortedSharedVaults.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No shared vaults.</Text>
        ) : (
          <>
            {renderPanels.vault ? (
            <Animated.View style={panelStyle(vaultPanelAnim)}>
            <View style={[styles.card, styles.vaultAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.primary }]}>
              <View style={styles.cardRow}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Vaults</Text>
              </View>

              <ScrollView
                style={[styles.selectorList, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {filteredSharedVaults.map((v) => {
                  const active = selectedVaultId != null && String(v?.id) === String(selectedVaultId);
                  const caps = getVaultCapsForId(v?.id);
                  const canEditOnlineForRow = caps.canEdit && !isOffline;
                  const canShareOnlineForRow = caps.canShare && !isOffline;
                  return (
                    <TouchableOpacity
                      key={String(v?.id)}
                      style={[styles.selectorRow, { borderBottomColor: theme.border }, active && styles.selectorRowActive]}
                      onPress={() => {
                        if (anyCreateOpen) return;
                        onSelectVault(v.id);
                      }}
                      disabled={anyCreateOpen}
                    >
                      <View style={styles.selectorTitleWrap}>
                        <Text style={[styles.selectorTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                          {v?.name || v?.id}
                        </Text>
                        <Text style={[styles.selectorMeta, { color: theme.textMuted }]}>Vault</Text>
                      </View>

                      <View style={styles.selectorRowActions}>
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: theme.surface, borderColor: theme.border }, !canEditOnlineForRow && styles.buttonDisabled]}
                          disabled={!canEditOnlineForRow}
                          onPress={() => {
                            if (!v?.id) return;
                            markRecentVaultById(String(v.id), { titleOverride: v?.name || 'Vault' });
                            setVaultEditTargetId(String(v.id));
                            setVaultEditName(String(v?.name || '').slice(0, 35));
                            setVaultEditVisible(true);
                          }}
                        >
                          <Text style={[styles.actionButtonText, { color: theme.text }]}>Edit</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: theme.surface, borderColor: theme.border }, !canShareOnlineForRow && styles.buttonDisabled]}
                          disabled={!canShareOnlineForRow}
                          onPress={() => {
                            if (!v?.id) return;
                            markRecentVaultById(String(v.id), { titleOverride: v?.name || 'Vault' });
                            setShareTargetType('vault');
                            setShareTargetId(String(v.id));
                            setShareVisible(true);
                          }}
                        >
                          <Text style={[styles.actionButtonText, { color: theme.text }]}>Delegate</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            </Animated.View>
            ) : null}

            {renderPanels.collection ? (
            <Animated.View style={panelStyle(collectionPanelAnim)}>

            <View style={[styles.card, styles.collectionAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.clone }]}>
              <View style={styles.cardRow}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Collections</Text>
              </View>

              {collectionCreateOpen ? (
                <View style={styles.createRow}>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="New collection name"
                    placeholderTextColor={theme.placeholder}
                    {...noAutoCorrect}
                    value={newCollectionName}
                    editable={!!selectedVaultId && canCreateCollectionsOnline && !collectionCreateBusy}
                    onChangeText={(t) => setNewCollectionName(String(t || '').slice(0, 35))}
                  />
                  <TouchableOpacity
                    style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                    onPress={() => {
                      setNewCollectionName('');
                      setCollectionCreateOpen(false);
                    }}
                  >
                    <Text style={[styles.secondaryText, { color: theme.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.addButton,
                      { backgroundColor: theme.success, borderColor: theme.success },
                      (!selectedVaultId || !newCollectionName.trim() || !canCreateCollectionsOnline || collectionCreateBusy) && styles.buttonDisabled,
                    ]}
                    disabled={!selectedVaultId || !newCollectionName.trim() || !canCreateCollectionsOnline || collectionCreateBusy}
                    onPress={() => {
                      if (!selectedVaultId) return;
                      if (!canCreateCollectionsOnline) return Alert.alert('Internet connection required. Please reconnect and try again.');
                      if (collectionCreateBusy) return;
                      const name = String(newCollectionName || '').trim().slice(0, 35);
                      if (!name) return;

                      const tempId = makeTempId();
                      const optimistic = {
                        id: tempId,
                        name,
                        vaultId: String(selectedVaultId),
                        createdAt: Date.now(),
                        editedAt: Date.now(),
                      };

                      setOptimisticCollections((prev) => [...(prev || []), optimistic]);
                      onSelectCollection(tempId);

                      setNewCollectionName('');
                      setCollectionCreateOpen(false);

                      setCollectionCreateBusy(true);
                      (async () => {
                        try {
                          const res = await addCollection?.({ vaultId: String(selectedVaultId), name });
                          if (!res || res.ok === false) {
                            Alert.alert('Create failed', res?.message || 'Unable to create collection');
                            setOptimisticCollections((prev) => (prev || []).filter((c) => String(c?.id) !== String(tempId)));
                            setOptimisticAssets((prev) =>
                              (prev || []).filter((a) => !a?.__pendingCollectionTempId || String(a.__pendingCollectionTempId) !== String(tempId))
                            );
                            setNewCollectionName(name);
                            setCollectionCreateOpen(true);
                            return;
                          }
                          if (res.collectionId) {
                            const realId = String(res.collectionId);
                            setOptimisticCollections((prev) =>
                              (prev || []).map((c) => {
                                if (String(c?.id) !== String(tempId)) return c;
                                return { ...c, id: realId };
                              })
                            );

                            setOptimisticAssets((prev) =>
                              (prev || []).map((a) => {
                                if (!a) return a;
                                if (a.__pendingCollectionTempId && String(a.__pendingCollectionTempId) === String(tempId)) {
                                  return { ...a, collectionId: realId };
                                }
                                if (!a.__pendingCollectionTempId && String(a?.collectionId) === String(tempId)) {
                                  return { ...a, collectionId: realId };
                                }
                                return a;
                              })
                            );

                            onSelectCollection(realId);
                            markRecentCollectionById(realId, { titleOverride: name });
                            await flushPendingAssetsForCollection(tempId, realId);
                          }
                          // Let realtime listeners update global state; optimistic UI already shows instantly.
                        } finally {
                          setCollectionCreateBusy(false);
                        }
                      })();
                    }}
                  >
                    <Text style={[styles.addButtonText, { color: theme.onAccentText }]}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <ScrollView
                style={[styles.selectorList, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, !selectedVaultId && styles.buttonDisabled]}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {!selectedVaultId ? (
                  <Text style={[styles.subtitle, { color: theme.textSecondary, paddingVertical: 10 }]}>Select a vault first.</Text>
                ) : filteredVaultCollections.length === 0 ? (
                  <Text style={[styles.subtitle, { color: theme.textSecondary, paddingVertical: 10 }]}>No collections in this vault.</Text>
                ) : (
                  filteredVaultCollections.map((c) => {
                    const active = selectedCollectionId != null && String(c?.id) === String(selectedCollectionId);
                    const caps = getCollectionCapsForId(c?.id);
                    const canEditOnlineForRow = caps.canEdit && !isOffline;
                    const canShareOnlineForRow = caps.canShare && !isOffline;
                    const canMoveOnlineForRow = caps.canMove && !isOffline;
                    const canCloneOnlineForRow = caps.canClone && !isOffline;
                    return (
                      <TouchableOpacity
                        key={String(c?.id)}
                        style={[styles.selectorRow, { borderBottomColor: theme.border }, active && styles.selectorRowActive]}
                        onPress={() => {
                          if (anyCreateOpen) return;
                          onSelectCollection(c.id);
                        }}
                        disabled={anyCreateOpen}
                      >
                        <View style={styles.selectorTitleWrap}>
                          <Text style={[styles.selectorTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                            {c?.name || c?.id}
                          </Text>
                          <Text style={[styles.selectorMeta, { color: theme.textMuted }]}>Collection</Text>
                        </View>

                        <View style={styles.selectorRowActions}>
                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.surface, borderColor: theme.border }, !canEditOnlineForRow && styles.buttonDisabled]}
                            disabled={!canEditOnlineForRow}
                            onPress={() => {
                              if (!c?.id) return;
                              markRecentCollectionById(String(c.id), { titleOverride: c?.name || 'Collection' });
                              setCollectionEditTargetId(String(c.id));
                              setCollectionEditName(String(c?.name || '').slice(0, 35));
                              setCollectionEditVisible(true);
                            }}
                          >
                            <Text style={[styles.actionButtonText, { color: theme.text }]}>Edit</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.surface, borderColor: theme.border }, !canShareOnlineForRow && styles.buttonDisabled]}
                            disabled={!canShareOnlineForRow}
                            onPress={() => {
                              if (!c?.id) return;
                              markRecentCollectionById(String(c.id), { titleOverride: c?.name || 'Collection' });
                              setShareTargetType('collection');
                              setShareTargetId(String(c.id));
                              setShareVisible(true);
                            }}
                          >
                            <Text style={[styles.actionButtonText, { color: theme.text }]}>Delegate</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.surface, borderColor: theme.border }, !canMoveOnlineForRow && styles.buttonDisabled]}
                            disabled={!canMoveOnlineForRow}
                            onPress={() => {
                              if (!c?.id) return;
                              markRecentCollectionById(String(c.id), { titleOverride: c?.name || 'Collection' });
                              setCollectionMoveTargetId(String(c.id));
                              setMoveVaultId(String(c?.vaultId || selectedVaultId || ''));
                              setMoveVaultDropdownOpen(false);
                              setCollectionMoveVisible(true);
                            }}
                          >
                            <Text style={[styles.actionButtonText, { color: theme.text }]}>Move</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.surface, borderColor: theme.border }, !canCloneOnlineForRow && styles.buttonDisabled]}
                            disabled={!canCloneOnlineForRow}
                            onPress={() => {
                              if (!selectedVaultId || !c?.id) return;
                              markRecentCollectionById(String(c.id), { titleOverride: c?.name || 'Collection' });
                              const baseName = c?.name ? String(c.name) : 'Collection';
                              const copyName = String(`${baseName} (Copy)`).slice(0, 35);
                              (async () => {
                                const res = await addCollection?.({
                                  vaultId: String(selectedVaultId),
                                  name: copyName,
                                  images: Array.isArray(c?.images) ? c.images : [],
                                  heroImage: c?.heroImage || null,
                                });
                                if (!res || res.ok === false) {
                                  Alert.alert('Clone failed', res?.message || 'Unable to clone collection');
                                  return;
                                }
                                if (res.collectionId) {
                                  const realId = String(res.collectionId);
                                  markRecentCollectionById(realId, { titleOverride: copyName });
                                  onSelectCollection(realId);
                                }
                              })();
                            }}
                          >
                            <Text style={[styles.actionButtonText, { color: theme.text }]}>Clone</Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>

            </Animated.View>
            ) : null}

            {renderPanels.assets ? (
              <Animated.View style={panelStyle(assetsPanelAnim)}>
              </Animated.View>
            ) : null}
          </>
        )}

          </View>
        }
      />

      {showJumpToTop ? (
        <View style={styles.floatingButtonWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.floatingButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
            onPress={() => {
              scrollToTop();
            }}
            accessibilityRole="button"
            accessibilityLabel="Scroll to top"
          >
            <Ionicons name="chevron-up" size={18} color={theme.text} />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, paddingBottom: 140, backgroundColor: '#0b0b0f' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallbackText: { fontWeight: '800', fontSize: 12 },
  stepBackButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 12 },
  totalValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  totalValueLabel: { fontWeight: '700' },
  totalValueAmount: { fontWeight: '800', fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },

  globalControlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  globalControlsRight: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },

  sectionHeader: { marginTop: 8, marginBottom: 8 },
  sectionTitle: { color: '#e5e7f0', fontSize: 18, fontWeight: '700' },
  sectionItem: { marginBottom: 10 },

  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  addButtonText: { fontWeight: '800' },
  secondaryButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#26344a', backgroundColor: '#1b2535' },
  secondaryText: { color: '#d3dcf2', fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  statusPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 12, fontWeight: '800' },

  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  vaultAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  collectionAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  assetAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  actionButtonText: { fontWeight: '700', fontSize: 13 },
  dangerButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },

  selectorList: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    maxHeight: 260,
  },
  selectorRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectorRowActive: { opacity: 0.92 },
  selectorTitleWrap: { flex: 1, minWidth: 0 },
  selectorTitle: { fontWeight: '800' },
  selectorMeta: { fontSize: 12, marginTop: 3 },
  selectorRowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },

  dropdownButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dropdownButtonText: { fontWeight: '700' },
  dropdownArrow: { fontSize: 12, fontWeight: '700' },
  dropdownList: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    maxHeight: 220,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dropdownItemActive: { opacity: 0.9 },
  dropdownItemText: { fontWeight: '700' },
  dropdownItemMeta: { fontSize: 12, marginTop: 3 },
  checkmark: { color: '#16a34a', fontWeight: '900' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  modalCard: { borderRadius: 14, borderWidth: 1, padding: 16, maxHeight: '80%' },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  modalLabel: { fontWeight: '800', marginTop: 8, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12 },
  modalActions: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  primaryButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  primaryButtonText: { fontWeight: '800' },
  dangerButtonText: { fontWeight: '800' },

  assetInlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },

  assetRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
  },
  assetTitle: { fontSize: 15, fontWeight: '700' },
  assetMeta: { fontSize: 12, marginTop: 3 },
  assetCount: { fontSize: 13, fontWeight: '700' },

  floatingButtonWrap: {
    position: 'absolute',
    right: 16,
    // Keep above the global VersionFooter (which overlays the bottom of the screen).
    bottom: 156,
    zIndex: 50,
    elevation: 50,
  },
  floatingButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  floatingButtonText: { fontWeight: '800', fontSize: 13 },
});
