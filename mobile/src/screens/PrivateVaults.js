import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert as NativeAlert, Image, Keyboard, Modal, RefreshControl, ScrollView, SectionList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import LambHeader from '../components/LambHeader';
import ShareModal from '../components/ShareModal';
import PullToRefreshIndicator from '../components/PullToRefreshIndicator';
import { useData } from '../context/DataContext';
import { firestore } from '../firebase';
import { getAssetCapabilities, getCollectionCapabilities, getVaultCapabilities } from '../policies/capabilities';
import { runWithMinimumDuration } from '../utils/timing';
import { getInitials } from '../utils/user';

export default function PrivateVaults({ navigation, route }) {
  const {
    loading,
    vaults,
    collections,
    assets,
    currentUser,
    addVault,
    addCollection,
    addAsset,
    deleteVault,
    deleteCollection,
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
    permissionGrants,
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
  const [newVaultName, setNewVaultName] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newAssetTitle, setNewAssetTitle] = useState('');
  const [vaultCreateOpen, setVaultCreateOpen] = useState(false);
  const [collectionCreateOpen, setCollectionCreateOpen] = useState(false);
  const [assetCreateOpen, setAssetCreateOpen] = useState(false);
  const [vaultCreateBusy, setVaultCreateBusy] = useState(false);
  const [collectionCreateBusy, setCollectionCreateBusy] = useState(false);
  const [assetCreateBusy, setAssetCreateBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [remoteOwnedVaults, setRemoteOwnedVaults] = useState([]);
  const [optimisticVaults, setOptimisticVaults] = useState([]);
  const [optimisticCollections, setOptimisticCollections] = useState([]);
  const [optimisticAssets, setOptimisticAssets] = useState([]);
  const [optimisticDeletedAssetIds, setOptimisticDeletedAssetIds] = useState({});

  const listRef = useRef(null);
  const [showJumpToTop, setShowJumpToTop] = useState(false);
  const showJumpToTopRef = useRef(false);

  const scrollToTop = () => {
    const run = () => {
      try {
        // Preferred: absolute offset to the very top (includes ListHeaderComponent).
        if (listRef.current?.scrollToOffset) {
          listRef.current.scrollToOffset({ offset: 0, animated: true });
          return;
        }

        // Fallback: underlying scroll responder.
        const responder = listRef.current?.getScrollResponder?.();
        if (responder?.scrollTo) {
          responder.scrollTo({ y: 0, animated: true });
          return;
        }

        // Last resort: scroll to first section/item (may not include the header).
        if (listRef.current?.scrollToLocation) {
          listRef.current.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true, viewPosition: 0 });
        }
      } catch {
        // ignore
      }
    };

    // Run twice: the first call can be ignored while layouts settle.
    run();
    setTimeout(run, 50);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [vaultTypeQuery, setVaultTypeQuery] = useState('');
  const [collectionTypeQuery, setCollectionTypeQuery] = useState('');
  const [assetTypeQuery, setAssetTypeQuery] = useState('');
  const [vaultSortMode, setVaultSortMode] = useState('az');
  const [collectionSortMode, setCollectionSortMode] = useState('az');
  const [assetSortMode, setAssetSortMode] = useState('az');

  const [selectedVaultId, setSelectedVaultId] = useState(route?.params?.selectedVaultId ? String(route.params.selectedVaultId) : null);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState(false);

  const [shareVisible, setShareVisible] = useState(false);
  const [shareTargetType, setShareTargetType] = useState(null);
  const [shareTargetId, setShareTargetId] = useState(null);

  const [vaultEditVisible, setVaultEditVisible] = useState(false);
  const [vaultEditName, setVaultEditName] = useState('');
  const [vaultEditSaving, setVaultEditSaving] = useState(false);
  const vaultEditSavingRef = useRef(false);

  const [collectionEditVisible, setCollectionEditVisible] = useState(false);
  const [collectionEditName, setCollectionEditName] = useState('');

  const [collectionMoveVisible, setCollectionMoveVisible] = useState(false);
  const [moveVaultId, setMoveVaultId] = useState(null);
  const [moveVaultDropdownOpen, setMoveVaultDropdownOpen] = useState(false);

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

  const uid = currentUser?.id ? String(currentUser.id) : null;

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

  const closeVaultEditModal = () => {
    if (vaultEditSavingRef.current) return;
    Keyboard.dismiss();
    setVaultEditVisible(false);
  };

  useEffect(() => {
    if (vaultEditVisible) return;
    vaultEditSavingRef.current = false;
    setVaultEditSaving(false);
    Keyboard.dismiss();
  }, [vaultEditVisible]);

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

  const normalizeVaultDoc = ({ docId, data }) => {
    const raw = data || {};
    const id = String(docId);
    return {
      ...raw,
      id,
      ownerId: raw.activeOwnerId || raw.ownerId || null,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : (raw.createdAt?.toMillis ? raw.createdAt.toMillis() : raw.createdAt) || Date.now(),
    };
  };

  const loadOwnedVaults = async () => {
    if (!uid) return;
    if (!firestore) return;

    try {
      const ownedByOwnerIdQuery = query(collection(firestore, 'vaults'), where('ownerId', '==', uid));
      const ownedByActiveOwnerQuery = query(collection(firestore, 'vaults'), where('activeOwnerId', '==', uid));
      const [snapOwner, snapActive] = await Promise.all([getDocs(ownedByOwnerIdQuery), getDocs(ownedByActiveOwnerQuery)]);
      const combined = [...snapOwner.docs, ...snapActive.docs]
        .map((d) => normalizeVaultDoc({ docId: d.id, data: d.data() }))
        .filter(Boolean);

      const seen = new Set();
      const deduped = [];
      for (const v of combined) {
        const id = v?.id ? String(v.id) : null;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        deduped.push(v);
      }
      setRemoteOwnedVaults(deduped);
    } catch {
      // ignore; realtime listeners are preferred
    }
  };

  useEffect(() => {
    loadOwnedVaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const myVaults = useMemo(() => {
    if (!uid) return [];
    const combined = [...(vaults || []), ...(remoteOwnedVaults || []), ...(optimisticVaults || [])];
    const owned = combined.filter((v) => v?.ownerId != null && String(v.ownerId) === uid);

    const seen = new Set();
    const deduped = [];
    for (const v of owned) {
      const id = v?.id ? String(v.id) : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      deduped.push(v);
    }
    return deduped;
  }, [vaults, remoteOwnedVaults, optimisticVaults, uid]);

  const sortedMyVaults = useMemo(() => {
    const list = (myVaults || []).slice();
    const dir = vaultSortMode === 'za' ? -1 : 1;
    list.sort((a, b) => dir * String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [myVaults, vaultSortMode]);

  const filteredMyVaults = useMemo(() => {
    const list = sortedMyVaults || [];
    const q1 = searchQuery;
    const q2 = vaultTypeQuery;
    if (!String(q1 || '').trim() && !String(q2 || '').trim()) return list;
    return list.filter((v) => matchesAllQueries(v?.name, [q1, q2]));
  }, [sortedMyVaults, searchQuery, vaultTypeQuery]);

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
      const v = (myVaults || []).find((x) => String(x?.id) === String(vId)) || (vaults || []).find((x) => String(x?.id) === String(vId)) || null;
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
    if (selectedVaultId) return;
    if (!sortedMyVaults.length) return;
    setSelectedVaultId(String(sortedMyVaults[0].id));
  }, [selectedVaultId, sortedMyVaults]);

  useEffect(() => {
    if (!selectedVaultId) return;
    if (isTempId(selectedVaultId)) return;
    const vId = String(selectedVaultId);
    retainVaultCollections?.(vId);
    retainVaultAssets?.(vId);
    return () => {
      releaseVaultCollections?.(vId);
      releaseVaultAssets?.(vId);
    };
  }, [selectedVaultId, retainVaultCollections, releaseVaultCollections, retainVaultAssets, releaseVaultAssets]);

  useEffect(() => {
    const realIds = new Set([...(vaults || []), ...(remoteOwnedVaults || [])].map((v) => String(v?.id)).filter(Boolean));
    setOptimisticVaults((prev) => (prev || []).filter((v) => !realIds.has(String(v?.id))));
  }, [vaults, remoteOwnedVaults]);

  useEffect(() => {
    const realIds = new Set((collections || []).map((c) => String(c?.id)).filter(Boolean));
    setOptimisticCollections((prev) => (prev || []).filter((c) => !realIds.has(String(c?.id))));
  }, [collections]);

  useEffect(() => {
    const realIds = new Set((assets || []).map((a) => String(a?.id)).filter(Boolean));
    setOptimisticAssets((prev) => (prev || []).filter((a) => !realIds.has(String(a?.id))));
  }, [assets]);

  const selectedVault = useMemo(
    () => (selectedVaultId ? (myVaults || []).find((v) => String(v?.id) === String(selectedVaultId)) : null),
    [myVaults, selectedVaultId]
  );

  const vaultCaps = useMemo(() => {
    if (!selectedVaultId || !currentUser?.id) return getVaultCapabilities({ role: null, canCreateCollections: false });
    const role = getRoleForVault?.(String(selectedVaultId), String(currentUser.id));
    const canCreateCollections = canCreateCollectionsInVault?.(String(selectedVaultId), String(currentUser.id));
    return getVaultCapabilities({ role, canCreateCollections });
  }, [selectedVaultId, currentUser?.id, getRoleForVault, canCreateCollectionsInVault]);

  const canVaultEditOnline = vaultCaps.canEdit && !isOffline;
  const canVaultShareOnline = vaultCaps.canShare && !isOffline;
  const canVaultCloneOnline = vaultCaps.canClone && !isOffline;
  const canVaultDeleteOnline = vaultCaps.canDelete && !isOffline;
  const canCreateCollectionsOnline = vaultCaps.canCreateCollections && !isOffline;

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
    const q1 = searchQuery;
    const q2 = collectionTypeQuery;
    if (!String(q1 || '').trim() && !String(q2 || '').trim()) return list;
    return list.filter((c) => matchesAllQueries(c?.name, [q1, q2]));
  }, [vaultCollections, searchQuery, collectionTypeQuery]);

  useEffect(() => {
    if (!selectedVaultId) return;
    const stillValid = vaultCollections.find((c) => String(c?.id) === String(selectedCollectionId));
    if (stillValid) return;
    if (vaultCollections.length) setSelectedCollectionId(String(vaultCollections[0].id));
    else setSelectedCollectionId(null);
  }, [selectedVaultId, vaultCollections, selectedCollectionId]);

  const selectedCollection = useMemo(
    () => {
      if (!selectedCollectionId) return null;
      const real = (collections || []).find((c) => String(c?.id) === String(selectedCollectionId));
      if (real) return real;
      return (optimisticCollections || []).find((c) => String(c?.id) === String(selectedCollectionId)) || null;
    },
    [collections, optimisticCollections, selectedCollectionId]
  );

  const ownerVaultsForMove = useMemo(() => {
    const ownerId = selectedCollection?.ownerId != null ? String(selectedCollection.ownerId) : null;
    if (!ownerId) return [];
    const list = (vaults || []).filter((v) => v?.ownerId != null && String(v.ownerId) === ownerId);
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [vaults, selectedCollection?.ownerId]);

  const collectionCaps = useMemo(() => {
    if (!selectedCollectionId || !currentUser?.id) return getCollectionCapabilities({ role: null, canCreateAssets: false });
    const role = getRoleForCollection?.(String(selectedCollectionId), String(currentUser.id));
    const canCreateAssets = canCreateAssetsInCollection?.(String(selectedCollectionId), String(currentUser.id));
    return getCollectionCapabilities({ role, canCreateAssets });
  }, [selectedCollectionId, currentUser?.id, getRoleForCollection, canCreateAssetsInCollection]);

  const canCollectionEditOnline = collectionCaps.canEdit && !isOffline;
  const canCollectionShareOnline = collectionCaps.canShare && !isOffline;
  const canCollectionMoveOnline = collectionCaps.canMove && !isOffline;
  const canCollectionCloneOnline = collectionCaps.canClone && !isOffline;
  const canCollectionDeleteOnline = collectionCaps.canDelete && !isOffline;
  const canCreateAssetsOnline = (collectionCaps.canCreateAssets || isTempId(selectedCollectionId)) && !isOffline;

  const anyCreateOpen = vaultCreateOpen || collectionCreateOpen || assetCreateOpen;

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

      // If a matching real asset exists, hide the optimistic temp row.
      return !match;
    });

    const allAssets = dedupeById([...(prunedOptimistic || []), ...(assets || [])]);
    const queries = [searchQuery, assetTypeQuery].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
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
  }, [assets, optimisticAssets, optimisticDeletedAssetIds, selectedCollectionId, searchQuery, assetTypeQuery, assetSortMode]);

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
    const list = (myVaults || []).filter((v) => v?.ownerId != null && String(v.ownerId) === ownerId);
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [assetMoveAsset?.ownerId, myVaults]);

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

  useEffect(() => {
    setSelectedAssetId(null);
    setAssetEditVisible(false);
  }, [selectedVaultId, selectedCollectionId]);

  const getDelegateCountForVault = (vaultId) => {
    const vId = String(vaultId);
    return (vaultMemberships || []).filter((m) => m?.vault_id === vId && m?.status === 'ACTIVE' && m?.role === 'DELEGATE').length;
  };

  const getCollectionShareCount = (collectionId) => {
    if (!selectedVaultId) return 0;
    const vId = String(selectedVaultId);
    const cId = String(collectionId);
    const ids = new Set(
      (permissionGrants || [])
        .filter((g) => String(g?.vault_id) === vId && g?.scope_type === 'COLLECTION' && String(g?.scope_id) === cId)
        .map((g) => String(g.user_id))
    );
    return ids.size;
  };

  const getAssetShareCount = (assetId) => {
    if (!selectedVaultId) return 0;
    const vId = String(selectedVaultId);
    const aId = String(assetId);
    const ids = new Set(
      (permissionGrants || [])
        .filter((g) => String(g?.vault_id) === vId && g?.scope_type === 'ASSET' && String(g?.scope_id) === aId)
        .map((g) => String(g.user_id))
    );
    return ids.size;
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await loadOwnedVaults();
        await refreshData?.();
      }, 800);
      showNotice?.('Refresh complete.', { durationMs: 1200 });
    } finally {
      setRefreshing(false);
    }
  };

  const onSelectVault = (vaultId) => {
    const vId = vaultId ? String(vaultId) : null;
    setSelectedVaultId(vId);
    setSelectedCollectionId(null);
    setCollectionTypeQuery('');
    setAssetTypeQuery('');
    setVaultDropdownOpen(false);
    setCollectionDropdownOpen(false);
  };

  const onSelectCollection = (collectionId) => {
    setSelectedCollectionId(collectionId ? String(collectionId) : null);
    setAssetTypeQuery('');
    setCollectionDropdownOpen(false);
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
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
              onPress={() => setAssetSortMode((m) => (m === 'az' ? 'za' : 'az'))}
            >
              <Text style={[styles.actionButtonText, { color: theme.text }]}>{assetSortMode === 'az' ? 'A–Z' : 'Z–A'}</Text>
            </TouchableOpacity>

            {!assetCreateOpen ? (
              <TouchableOpacity
                style={[styles.addButton, (!canCreateAssetsOnline || assetCreateBusy) && styles.buttonDisabled]}
                disabled={!canCreateAssetsOnline || assetCreateBusy}
                onPress={() => setAssetCreateOpen(true)}
              >
                <Text style={styles.addButtonText}>+</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {!anyCreateOpen ? (
          <TextInput
            style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text, marginTop: 8 }]}
            placeholder="Type to search assets"
            placeholderTextColor={theme.placeholder}
            value={assetTypeQuery}
            onChangeText={setAssetTypeQuery}
            {...noAutoCorrect}
          />
        ) : null}

        {assetCreateOpen ? (
          <View style={styles.createRow}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder="New asset title"
              placeholderTextColor={theme.placeholder}
              value={newAssetTitle}
              editable={canCreateAssetsOnline && !assetCreateBusy}
              onChangeText={(text) => setNewAssetTitle(limit35(text || ''))}
              {...noAutoCorrect}
            />
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
              onPress={() => {
                setNewAssetTitle('');
                setAssetCreateOpen(false);
              }}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addButton, (!newAssetTitle.trim() || !canCreateAssetsOnline || assetCreateBusy) && styles.buttonDisabled]}
              disabled={!newAssetTitle.trim() || !canCreateAssetsOnline || assetCreateBusy}
              onPress={() => {
                if (!canCreateAssetsOnline) return Alert.alert('Internet connection required. Please reconnect and try again.');
                if (assetCreateBusy) return;

                const title = limit35(newAssetTitle.trim());
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
              <Text style={styles.addButtonText}>Done</Text>
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
          <Text style={[styles.subtitle, { color: theme.textSecondary, paddingVertical: 10 }]}>No assets in this collection.</Text>
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
            <View style={styles.nameRow}>
              <View
                style={[
                  styles.sharedDot,
                  {
                    backgroundColor: getAssetShareCount(a.id) > 0 ? theme.success : theme.textMuted,
                    borderColor: getAssetShareCount(a.id) > 0 ? theme.success : theme.border,
                  },
                ]}
              />
              <Text style={[styles.assetTitle, { color: theme.text }]}>{a.title || 'Untitled'}</Text>
            </View>
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
          // Use a ref so we only set state when crossing thresholds.
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
              <Text style={[styles.title, { color: theme.text }]}>Private Vaults</Text>
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

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <TextInput
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Search vaults, collections, assets"
                placeholderTextColor={theme.placeholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                {...noAutoCorrect}
              />
            </View>

            {shareVisible ? (
              <ShareModal
                visible
                onClose={() => {
                  setShareVisible(false);
                  setShareTargetType(null);
                  setShareTargetId(null);
                }}
                targetType={shareTargetType || 'vault'}
                targetId={shareTargetId || selectedVaultId}
              />
            ) : null}

            {assetEditVisible ? (
              <Modal visible transparent animationType="fade" onRequestClose={() => setAssetEditVisible(false)}>
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
                        <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Close</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          { backgroundColor: theme.primary, borderColor: theme.primary },
                          (!selectedAssetId || !canAssetEditOnline) && styles.buttonDisabled,
                        ]}
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
                        style={[
                          styles.dangerButton,
                          { backgroundColor: theme.dangerBg, borderColor: theme.dangerBorder },
                          (!selectedAssetId || !canAssetDeleteOnline) && styles.buttonDisabled,
                        ]}
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

                                  // Cleanup: remove the optimistic hide flag; realtime listeners should also remove the asset.
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
            ) : null}

            {vaultEditVisible ? (
              <Modal
                visible
                transparent
                animationType="fade"
                onRequestClose={() => {
                  closeVaultEditModal();
                }}
              >
                <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeVaultEditModal}>
                  <TouchableOpacity
                    activeOpacity={1}
                    style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  >
                    <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Vault</Text>
                    <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Name</Text>
                    <TextInput
                      value={vaultEditName}
                      onChangeText={(t) => setVaultEditName(limit35(t || ''))}
                      placeholder="Vault name"
                      placeholderTextColor={theme.placeholder}
                      style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                      {...noAutoCorrect}
                      editable={!vaultEditSaving}
                    />

                    <View style={styles.modalActions}>
                      <TouchableOpacity
                        style={[styles.secondaryButton, { borderColor: theme.border }, vaultEditSaving && styles.buttonDisabled]}
                        onPress={closeVaultEditModal}
                        disabled={vaultEditSaving}
                      >
                        <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Close</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          { backgroundColor: theme.primary, borderColor: theme.primary },
                          (!selectedVaultId || !canVaultEditOnline || vaultEditSaving) && styles.buttonDisabled,
                        ]}
                        disabled={!selectedVaultId || !canVaultEditOnline || vaultEditSaving}
                        onPress={() => {
                          if (!selectedVaultId || !selectedVault) return;
                          if (vaultEditSavingRef.current) return;
                          vaultEditSavingRef.current = true;
                          const expectedEditedAt = selectedVault?.editedAt ?? null;
                          (async () => {
                            setVaultEditSaving(true);
                            try {
                              const res = await updateVault?.(String(selectedVaultId), { name: limit35((vaultEditName || '').trim()) }, { expectedEditedAt });
                              if (!res || res.ok === false) {
                                if (res?.code === 'conflict') {
                                  Alert.alert('Updated elsewhere', 'This vault changed on another device. Reload and try again.', [
                                    { text: 'Reload', onPress: () => setVaultEditVisible(false) },
                                    { text: 'Cancel', style: 'cancel' },
                                  ]);
                                  return;
                                }
                                Alert.alert('Save failed', res?.message || 'Unable to update vault');
                                return;
                              }
                              setVaultEditVisible(false);
                              setTimeout(() => {
                                showNotice?.('Vault saved.', { durationMs: 1200 });
                              }, 0);
                            } catch (e) {
                              Alert.alert('Save failed', e?.message || 'Unable to update vault');
                            } finally {
                              vaultEditSavingRef.current = false;
                              setVaultEditSaving(false);
                            }
                          })();
                        }}
                      >
                        <Text style={[styles.primaryButtonText, { color: theme.onAccentText }]}>{vaultEditSaving ? 'Saving…' : 'Save'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.dangerButton,
                          { backgroundColor: theme.dangerBg, borderColor: theme.dangerBorder },
                          (!selectedVaultId || !canVaultDeleteOnline || vaultEditSaving) && styles.buttonDisabled,
                        ]}
                        disabled={!selectedVaultId || !canVaultDeleteOnline || vaultEditSaving}
                        onPress={() => {
                          if (!selectedVaultId) return;
                          Alert.alert('Delete Vault?', 'This action cannot be undone.', [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: () => {
                                (async () => {
                                  try {
                                    const res = await deleteVault?.(String(selectedVaultId));
                                    if (!res || res.ok === false) {
                                      Alert.alert('Delete failed', res?.message || 'Unable to delete vault');
                                      return;
                                    }
                                    setVaultEditVisible(false);
                                    setSelectedVaultId(null);
                                    setSelectedCollectionId(null);
                                  } catch (e) {
                                    Alert.alert('Delete failed', e?.message || 'Unable to delete vault');
                                  }
                                })();
                              },
                            },
                          ]);
                        }}
                      >
                        <Text style={[styles.dangerButtonText, { color: theme.dangerText }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                </TouchableOpacity>
              </Modal>
            ) : null}

        {assetMoveVisible ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setAssetMoveVisible(false)}>
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
                  <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Close</Text>
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
        ) : null}

        {collectionEditVisible ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setCollectionEditVisible(false)}>
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Collection</Text>
              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Name</Text>
              <TextInput
                value={collectionEditName}
                onChangeText={(t) => setCollectionEditName(limit35(t || ''))}
                placeholder="Collection name"
                placeholderTextColor={theme.placeholder}
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                {...noAutoCorrect}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.secondaryButton, { borderColor: theme.border }]} onPress={() => setCollectionEditVisible(false)}>
                  <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: theme.primary, borderColor: theme.primary }, (!selectedCollectionId || !canCollectionEditOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !canCollectionEditOnline}
                  onPress={() => {
                    if (!selectedCollectionId || !selectedCollection) return;
                    const expectedEditedAt = selectedCollection?.editedAt ?? null;
                    (async () => {
                      const res = await updateCollection?.(String(selectedCollectionId), { name: limit35((collectionEditName || '').trim()) }, { expectedEditedAt });
                      if (!res || res.ok === false) {
                        Alert.alert('Save failed', res?.message || 'Unable to update collection');
                        return;
                      }
                      setCollectionEditVisible(false);
                    })();
                  }}
                >
                  <Text style={[styles.primaryButtonText, { color: theme.onAccentText }]}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dangerButton, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBorder }, (!selectedCollectionId || !canCollectionDeleteOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !canCollectionDeleteOnline}
                  onPress={() => {
                    if (!selectedCollectionId) return;
                    Alert.alert('Delete Collection?', 'This action cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          (async () => {
                            const res = await deleteCollection?.(String(selectedCollectionId));
                            if (!res || res.ok === false) {
                              Alert.alert('Delete failed', res?.message || 'Unable to delete collection');
                              return;
                            }
                            setCollectionEditVisible(false);
                            setSelectedCollectionId(null);
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
        ) : null}

        {collectionMoveVisible ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setCollectionMoveVisible(false)}>
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Move Collection</Text>
              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Destination Vault</Text>

              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => setMoveVaultDropdownOpen((v) => !v)}
                disabled={!canCollectionMoveOnline}
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
                  onPress={() => setCollectionMoveVisible(false)}
                >
                  <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: theme.primary, borderColor: theme.primary }, (!selectedCollectionId || !moveVaultId || !canCollectionMoveOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !moveVaultId || !canCollectionMoveOnline}
                  onPress={() => {
                    if (!selectedCollectionId || !moveVaultId) return;
                    (async () => {
                      const res = await moveCollection?.({ collectionId: String(selectedCollectionId), targetVaultId: String(moveVaultId) });
                      if (!res || res.ok === false) {
                        Alert.alert('Move failed', res?.message || 'Unable to move collection');
                        return;
                      }
                      setCollectionMoveVisible(false);
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
        ) : null}

        {!loading ? (
          <>
            <View style={[styles.card, styles.vaultAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.primary }]}> 
              <View style={styles.cardRow}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Vaults</Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
                    onPress={() => setVaultSortMode((m) => (m === 'az' ? 'za' : 'az'))}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>{vaultSortMode === 'az' ? 'A–Z' : 'Z–A'}</Text>
                  </TouchableOpacity>

                  {!vaultCreateOpen ? (
                    <TouchableOpacity
                      style={[styles.addButton, (isOffline || vaultCreateBusy) && styles.buttonDisabled]}
                      disabled={isOffline || vaultCreateBusy}
                      onPress={() => {
                        if (isOffline) return;
                        setVaultCreateOpen(true);
                      }}
                    >
                      <Text style={styles.addButtonText}>+</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {vaultCreateOpen ? (
                <View style={styles.createRow}>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="New vault name"
                    placeholderTextColor={theme.placeholder}
                    value={newVaultName}
                    editable={!isOffline}
                    onChangeText={(text) => setNewVaultName(limit35(text || ''))}
                    {...noAutoCorrect}
                  />
                  <TouchableOpacity
                    style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                    onPress={() => {
                      setNewVaultName('');
                      setVaultCreateOpen(false);
                    }}
                  >
                    <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addButton, (!newVaultName.trim() || isOffline || vaultCreateBusy) && styles.buttonDisabled]}
                    disabled={!newVaultName.trim() || isOffline || vaultCreateBusy}
                    onPress={() => {
                      if (isOffline) return;
                      const name = newVaultName.trim();
                      if (!name) return;

                      const tempId = makeTempId();
                      const optimistic = {
                        id: tempId,
                        name,
                        ownerId: uid,
                        createdAt: Date.now(),
                        editedAt: Date.now(),
                      };

                      setOptimisticVaults((prev) => [...(prev || []), optimistic]);
                      onSelectVault(tempId);

                      setNewVaultName('');
                      setVaultCreateOpen(false);
                      setVaultCreateBusy(true);

                      (async () => {
                        const res = await addVault({ name });
                        if (!res || res.ok === false) {
                          Alert.alert('Create vault failed', res?.message || 'Unable to create vault');
                          setOptimisticVaults((prev) => (prev || []).filter((v) => String(v?.id) !== String(tempId)));
                          setNewVaultName(name);
                          setVaultCreateOpen(true);
                          setVaultCreateBusy(false);
                          return;
                        }
                        if (res.vaultId) {
                          const realId = String(res.vaultId);
                          setOptimisticVaults((prev) =>
                            (prev || []).map((v) => {
                              if (String(v?.id) !== String(tempId)) return v;
                              return { ...v, id: realId };
                            })
                          );
                          markRecentVaultById(realId, { titleOverride: name });
                          onSelectVault(realId);
                        }
                        setVaultCreateBusy(false);
                        // Let realtime listeners update global state; optimistic UI already shows instantly.
                      })();
                    }}
                  >
                    <Text style={styles.addButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => {
                  if (anyCreateOpen) return;
                  setVaultDropdownOpen((v) => !v);
                }}
                disabled={sortedMyVaults.length === 0 || anyCreateOpen}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    {selectedVaultId ? (
                      <View
                        style={[
                          styles.sharedDot,
                          {
                            backgroundColor: getDelegateCountForVault(selectedVaultId) > 0 ? theme.success : theme.textMuted,
                            borderColor: getDelegateCountForVault(selectedVaultId) > 0 ? theme.success : theme.border,
                          },
                        ]}
                      />
                    ) : null}
                    <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                      {sortedMyVaults.length === 0 ? 'None' : (selectedVault?.name || 'Select vault…')}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{vaultDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {vaultDropdownOpen && !anyCreateOpen && (
                <ScrollView
                  style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                >
                  <View style={{ padding: 10, paddingBottom: 0 }}>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text, flex: 0 }]}
                      placeholder="Type to search vaults"
                      placeholderTextColor={theme.placeholder}
                      value={vaultTypeQuery}
                      onChangeText={setVaultTypeQuery}
                      autoFocus
                      {...noAutoCorrect}
                    />
                  </View>
                  {filteredMyVaults.map((v) => {
                    const active = selectedVaultId != null && String(v?.id) === String(selectedVaultId);
                    const delegated = getDelegateCountForVault(v.id) > 0;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[styles.dropdownItem, { borderBottomColor: theme.border }, active && styles.dropdownItemActive]}
                        onPress={() => onSelectVault(v.id)}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={styles.nameRow}>
                            <View
                              style={[
                                styles.sharedDot,
                                {
                                  backgroundColor: delegated ? theme.success : theme.textMuted,
                                  borderColor: delegated ? theme.success : theme.border,
                                },
                              ]}
                            />
                            <Text style={[styles.dropdownItemText, { color: theme.text }]}>{v.name || v.id}</Text>
                          </View>
                          <Text style={[styles.dropdownItemMeta, { color: theme.textMuted }]}>Vault • {new Date(v.createdAt).toLocaleDateString()}</Text>
                        </View>
                        {active && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {!vaultDropdownOpen ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedVaultId || !canVaultEditOnline) && styles.buttonDisabled]}
                    disabled={!selectedVaultId || !canVaultEditOnline}
                    onPress={() => {
                      if (!selectedVaultId) return;
                      markRecentVaultById(String(selectedVaultId), { titleOverride: selectedVault?.name || 'Vault' });
                      setVaultEditName(limit35(selectedVault?.name || ''));
                      setVaultEditVisible(true);
                    }}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedVaultId || !canVaultShareOnline) && styles.buttonDisabled]}
                    disabled={!selectedVaultId || !canVaultShareOnline}
                    onPress={() => {
                      if (!selectedVaultId) return;
                      markRecentVaultById(String(selectedVaultId), { titleOverride: selectedVault?.name || 'Vault' });
                      setShareTargetType('vault');
                      setShareTargetId(String(selectedVaultId));
                      setShareVisible(true);
                    }}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>Delegate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedVaultId || !canVaultCloneOnline) && styles.buttonDisabled]}
                    disabled={!selectedVaultId || !canVaultCloneOnline}
                    onPress={() => {
                      if (!selectedVaultId) return;
                      markRecentVaultById(String(selectedVaultId), { titleOverride: selectedVault?.name || 'Vault' });
                      const baseName = selectedVault?.name ? String(selectedVault.name) : 'Vault';
                      const copyName = limit35(`${baseName} (Copy)`);
                      (async () => {
                        const res = await addVault({
                          name: copyName,
                          images: Array.isArray(selectedVault?.images) ? selectedVault.images : [],
                          heroImage: selectedVault?.heroImage || null,
                        });
                        if (!res || res.ok === false) {
                          Alert.alert('Clone failed', res?.message || 'Unable to clone vault');
                          return;
                        }
                        if (res.vaultId) {
                          const realId = String(res.vaultId);
                          markRecentVaultById(realId, { titleOverride: copyName });
                          onSelectVault(realId);
                        }
                      })();
                    }}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>Clone</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <View style={[styles.card, styles.collectionAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.clone }]}>
              <View style={styles.cardRow}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Collections</Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
                    onPress={() => setCollectionSortMode((m) => (m === 'az' ? 'za' : 'az'))}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>{collectionSortMode === 'az' ? 'A–Z' : 'Z–A'}</Text>
                  </TouchableOpacity>

                  {!collectionCreateOpen ? (
                    <TouchableOpacity
                      style={[styles.addButton, (!selectedVaultId || !canCreateCollectionsOnline || collectionCreateBusy) && styles.buttonDisabled]}
                      disabled={!selectedVaultId || !canCreateCollectionsOnline || collectionCreateBusy}
                      onPress={() => setCollectionCreateOpen(true)}
                    >
                      <Text style={styles.addButtonText}>+</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {collectionCreateOpen ? (
                <View style={styles.createRow}>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="New collection name"
                    placeholderTextColor={theme.placeholder}
                    value={newCollectionName}
                    editable={!!selectedVaultId && canCreateCollectionsOnline && !collectionCreateBusy}
                    onChangeText={(text) => setNewCollectionName(limit35(text || ''))}
                    {...noAutoCorrect}
                  />
                  <TouchableOpacity
                    style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                    onPress={() => {
                      setNewCollectionName('');
                      setCollectionCreateOpen(false);
                    }}
                  >
                    <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addButton, (!selectedVaultId || !newCollectionName.trim() || !canCreateCollectionsOnline || collectionCreateBusy) && styles.buttonDisabled]}
                    disabled={!selectedVaultId || !newCollectionName.trim() || !canCreateCollectionsOnline || collectionCreateBusy}
                    onPress={() => {
                      if (!selectedVaultId) return;
                      if (!canCreateCollectionsOnline) return Alert.alert('Internet connection required. Please reconnect and try again.');
                      if (isTempId(selectedVaultId)) return Alert.alert('Please wait', 'Vault is still being created.');
                      const name = limit35(newCollectionName.trim());
                      if (!name) return;

                      const tempId = makeTempId();
                      const optimistic = {
                        id: tempId,
                        name,
                        vaultId: String(selectedVaultId),
                        ownerId: uid,
                        createdAt: Date.now(),
                        editedAt: Date.now(),
                      };

                      setOptimisticCollections((prev) => [...(prev || []), optimistic]);
                      onSelectCollection(tempId);

                      setNewCollectionName('');
                      setCollectionCreateOpen(false);
                      setCollectionCreateBusy(true);

                      (async () => {
                        const res = await addCollection?.({ vaultId: String(selectedVaultId), name });
                        if (!res || res.ok === false) {
                          Alert.alert('Create failed', res?.message || 'Unable to create collection');
                          setOptimisticCollections((prev) => (prev || []).filter((c) => String(c?.id) !== String(tempId)));
                          setOptimisticAssets((prev) =>
                            (prev || []).filter((a) => !a?.__pendingCollectionTempId || String(a.__pendingCollectionTempId) !== String(tempId))
                          );
                          setNewCollectionName(name);
                          setCollectionCreateOpen(true);
                          setCollectionCreateBusy(false);
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
                        setCollectionCreateBusy(false);
                        // Let realtime listeners update global state; optimistic UI already shows instantly.
                      })();
                    }}
                  >
                    <Text style={styles.addButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }, (!selectedVaultId || vaultCollections.length === 0) && styles.buttonDisabled]}
                onPress={() => {
                  if (anyCreateOpen) return;
                  if (selectedVaultId && vaultCollections.length > 0) setCollectionDropdownOpen((v) => !v);
                }}
                disabled={!selectedVaultId || vaultCollections.length === 0 || anyCreateOpen}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    {selectedCollectionId ? (
                      <View
                        style={[
                          styles.sharedDot,
                          {
                            backgroundColor: getCollectionShareCount(selectedCollectionId) > 0 ? theme.success : theme.textMuted,
                            borderColor: getCollectionShareCount(selectedCollectionId) > 0 ? theme.success : theme.border,
                          },
                        ]}
                      />
                    ) : null}
                    <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                      {selectedVaultId ? (vaultCollections.length === 0 ? 'None' : (selectedCollection?.name || 'Select collection…')) : 'Select a vault first…'}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{collectionDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {collectionDropdownOpen && !anyCreateOpen && (
                <ScrollView
                  style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                >
                  <View style={{ padding: 10, paddingBottom: 0 }}>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text, flex: 0 }]}
                      placeholder="Type to search collections"
                      placeholderTextColor={theme.placeholder}
                      value={collectionTypeQuery}
                      onChangeText={setCollectionTypeQuery}
                      autoFocus
                      {...noAutoCorrect}
                    />
                  </View>
                  {filteredVaultCollections.length === 0 ? (
                    <Text style={[styles.subtitle, { color: theme.textSecondary, padding: 12 }]}>None</Text>
                  ) : (
                    filteredVaultCollections.map((c) => {
                      const active = selectedCollectionId != null && String(c?.id) === String(selectedCollectionId);
                      const delegated = getCollectionShareCount(c.id) > 0;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.dropdownItem, { borderBottomColor: theme.border }, active && styles.dropdownItemActive]}
                          onPress={() => onSelectCollection(c.id)}
                        >
                          <View style={styles.nameRow}>
                            <View
                              style={[
                                styles.sharedDot,
                                {
                                  backgroundColor: delegated ? theme.success : theme.textMuted,
                                  borderColor: delegated ? theme.success : theme.border,
                                },
                              ]}
                            />
                            <Text style={[styles.dropdownItemText, { color: theme.text }]}>{c.name || c.id}</Text>
                          </View>
                          {active && <Text style={styles.checkmark}>✓</Text>}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              )}

              {!collectionDropdownOpen ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionEditOnline) && styles.buttonDisabled]}
                    disabled={!selectedCollectionId || !canCollectionEditOnline}
                    onPress={() => {
                      if (!selectedCollectionId) return;
                      markRecentCollectionById(String(selectedCollectionId), { titleOverride: selectedCollection?.name || 'Collection' });
                      setCollectionEditName(limit35(selectedCollection?.name || ''));
                      setCollectionEditVisible(true);
                    }}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionShareOnline) && styles.buttonDisabled]}
                    disabled={!selectedCollectionId || !canCollectionShareOnline}
                    onPress={() => {
                      if (!selectedCollectionId) return;
                      markRecentCollectionById(String(selectedCollectionId), { titleOverride: selectedCollection?.name || 'Collection' });
                      setShareTargetType('collection');
                      setShareTargetId(String(selectedCollectionId));
                      setShareVisible(true);
                    }}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>Delegate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionMoveOnline) && styles.buttonDisabled]}
                    disabled={!selectedCollectionId || !canCollectionMoveOnline}
                    onPress={() => {
                      if (!selectedCollectionId) return;
                      markRecentCollectionById(String(selectedCollectionId), { titleOverride: selectedCollection?.name || 'Collection' });
                      setMoveVaultId(String(selectedCollection?.vaultId || selectedVaultId || ''));
                      setMoveVaultDropdownOpen(false);
                      setCollectionMoveVisible(true);
                    }}
                  >
                    <Text style={[styles.actionButtonText, { color: theme.text }]}>Move</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionCloneOnline) && styles.buttonDisabled]}
                    disabled={!selectedCollectionId || !canCollectionCloneOnline}
                    onPress={() => {
                      if (!selectedVaultId || !selectedCollectionId) return;
                      markRecentCollectionById(String(selectedCollectionId), { titleOverride: selectedCollection?.name || 'Collection' });
                      const baseName = selectedCollection?.name ? String(selectedCollection.name) : 'Collection';
                      const copyName = limit35(`${baseName} (Copy)`);
                      (async () => {
                        const res = await addCollection?.({
                          vaultId: String(selectedVaultId),
                          name: copyName,
                          images: Array.isArray(selectedCollection?.images) ? selectedCollection.images : [],
                          heroImage: selectedCollection?.heroImage || null,
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
              ) : null}
            </View>
          </>
        ) : null}

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
  totalValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  totalValueLabel: { fontWeight: '700' },
  totalValueAmount: { fontWeight: '800', fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },

  sectionHeader: { marginTop: 8, marginBottom: 8 },
  sectionTitle: { color: '#e5e7f0', fontSize: 18, fontWeight: '700' },
  sectionItem: { marginBottom: 10 },

  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  vaultAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  collectionAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  assetAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  actionButtonText: { fontWeight: '700', fontSize: 13 },
  dangerButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sharedDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  modalCard: { borderRadius: 14, borderWidth: 1, padding: 16, maxHeight: '80%' },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  modalLabel: { fontWeight: '800', marginTop: 8, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12 },
  modalActions: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  primaryButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  primaryButtonText: { fontWeight: '800' },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  secondaryButtonText: { fontWeight: '700' },
  dangerButtonText: { fontWeight: '800' },
  assetInlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },

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
