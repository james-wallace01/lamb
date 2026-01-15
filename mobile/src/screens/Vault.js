import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, Text, TouchableOpacity, TextInput, Image, ScrollView, Modal, RefreshControl } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';
import { getVaultCapabilities } from '../policies/capabilities';
import { runWithMinimumDuration } from '../utils/timing';

export default function Vault({ navigation, route }) {
  const { vaultId } = route.params || {};
  const { loading, vaults, collections, addCollection, currentUser, getRoleForVault, canCreateCollectionsInVault, users, deleteVault, updateVault, refreshData, theme, defaultHeroImage, permissionGrants, retainVaultCollections, releaseVaultCollections, backendReachable, showAlert, createAuditEvent } = useData();
  const Alert = { alert: showAlert };
  const isOffline = backendReachable === false;
  const [newName, setNewName] = useState('');
  const [shareVisible, setShareVisible] = useState(false);
  const [shareTargetType, setShareTargetType] = useState(null);
  const [shareTargetId, setShareTargetId] = useState(null);
  const [editVisible, setEditVisible] = useState(false);
  const [pendingReloadEditedAt, setPendingReloadEditedAt] = useState(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [editDraft, setEditDraft] = useState({ name: '', description: '', manager: '', images: [], heroImage: '' });
  const [previewImage, setPreviewImage] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await refreshData?.();
      }, 800);
    } finally {
      setRefreshing(false);
    }
  };
  const draftPreviewImages = editDraft.heroImage && (editDraft.images || []).includes(editDraft.heroImage)
    ? [editDraft.heroImage, ...(editDraft.images || []).filter((img) => img !== editDraft.heroImage)]
    : editDraft.images || [];
  const limit20 = (value = '') => value.slice(0, 20);
  const limit35 = (value = '') => String(value).slice(0, 35);

  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const MAX_IMAGES = 4;
  const mediaTypes = ImagePicker.MediaType?.Images || ImagePicker.MediaTypeOptions.Images;
  const trimToFour = (arr = []) => arr.filter(Boolean).slice(0, MAX_IMAGES);

  const vault = useMemo(() => vaults.find((v) => v.id === vaultId), [vaultId, vaults]);
  const vaultCollections = useMemo(() => collections.filter((c) => c.vaultId === vaultId), [collections, vaultId]);
  const role = getRoleForVault(vaultId, currentUser?.id);
  const accessType = vault?.ownerId != null && currentUser?.id != null && String(vault.ownerId) === String(currentUser.id)
    ? 'Owner'
    : role
      ? `${role.charAt(0).toUpperCase()}${role.slice(1)}`
      : 'Shared';
  const canCreate = canCreateCollectionsInVault(vaultId, currentUser?.id);
  const caps = getVaultCapabilities({ role, canCreateCollections: canCreate });
  const canEdit = caps.canEdit;
  const canShare = caps.canShare;
  const canDelete = caps.canDelete;
  const canCreateOnline = canCreate && !isOffline;
  const canEditOnline = canEdit && !isOffline;
  const canShareOnline = canShare && !isOffline;
  const canDeleteOnline = canDelete && !isOffline;
  const vaultImages = vault?.images || [];
  const storedHeroImage = vault?.heroImage || null;
  const heroImage = storedHeroImage || defaultHeroImage;
  const previewImages = heroImage ? [heroImage, ...vaultImages.filter((img) => img !== storedHeroImage)] : vaultImages;

  const didLogViewRef = useRef(false);

  useEffect(() => {
    if (didLogViewRef.current) return;
    if (isOffline) return;
    if (!currentUser?.id) return;
    const vId = vaultId ? String(vaultId) : null;
    if (!vId) return;
    didLogViewRef.current = true;
    createAuditEvent?.({
      vaultId: vId,
      type: 'VAULT_VIEWED',
      payload: { vault_id: vId, name: vault?.name || null },
    }).catch(() => {});
  }, [vaultId, currentUser?.id, isOffline, createAuditEvent, vault?.name]);

  const toImageSource = (value) => (typeof value === 'number' ? value : { uri: value });

  const ensureHero = (images, currentHero) => {
    if (currentHero && images.includes(currentHero)) return currentHero;
    return images[0] || null;
  };

  useEffect(() => {
    setEditDraft({
      name: limit20(vault?.name || ''),
      description: vault?.description || '',
      manager: vault?.manager || '',
      images: trimToFour(vaultImages),
      heroImage: ensureHero(vaultImages, storedHeroImage),
    });
  }, [vaultId, vault?.name, vault?.description, vault?.manager, storedHeroImage, vaultImages.join(',')]);

  useEffect(() => {
    const vId = vaultId ? String(vaultId) : null;
    if (!vId) return;
    retainVaultCollections?.(vId);
    return () => {
      releaseVaultCollections?.(vId);
    };
  }, [vaultId, retainVaultCollections, releaseVaultCollections]);

  const handleAddImages = async () => {
    if (!vault) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required to add images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES,
      quality: 0.75,
      base64: true,
    });

    if (result.canceled) return;
    const assets = result.assets || [];
    const newImages = [];
    const skipped = [];

    assets.forEach((asset) => {
      if (!asset?.base64) return;
      const bytes = Math.ceil(asset.base64.length * 3 / 4);
      const uri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      if (bytes > MAX_IMAGE_BYTES) {
        skipped.push(asset.fileName || 'image');
        return;
      }
      newImages.push(uri);
    });

    const merged = trimToFour([...vaultImages, ...newImages]);
    const nextHero = ensureHero(merged, heroImage);
    (async () => {
      const res = await updateVault(vaultId, { images: merged, heroImage: nextHero }, { expectedEditedAt: vault?.editedAt ?? null });
      if (!res || res.ok === false) {
        if (res?.code === 'conflict') {
          Alert.alert('Updated elsewhere', 'This vault changed on another device. Reload and try again.', [
            { text: 'Reload', onPress: () => setEditVisible(false) },
            { text: 'Cancel', style: 'cancel' },
          ]);
          return;
        }
        Alert.alert('Update failed', res?.message || 'Unable to update vault images');
      }
    })();

    if (skipped.length) {
      Alert.alert('Skipped large files', `Images over 30MB were skipped: ${skipped.join(', ')}`);
    }
  };

  const handleSetHero = (img) => {
    if (!vault) return;
    const reordered = trimToFour([img, ...vaultImages.filter((i) => i !== img)]);
    (async () => {
      const res = await updateVault(vaultId, { images: reordered, heroImage: img }, { expectedEditedAt: vault?.editedAt ?? null });
      if (!res || res.ok === false) {
        if (res?.code === 'conflict') {
          Alert.alert('Updated elsewhere', 'This vault changed on another device. Reload and try again.', [
            { text: 'Reload', onPress: () => setEditVisible(false) },
            { text: 'Cancel', style: 'cancel' },
          ]);
          return;
        }
        Alert.alert('Update failed', res?.message || 'Unable to update vault hero image');
      }
    })();
  };

  const handleRemoveImage = (img) => {
    if (!vault) return;
    const remaining = vaultImages.filter((i) => i !== img);
    const nextHero = ensureHero(remaining, heroImage === img ? remaining[0] : heroImage);
    (async () => {
      const res = await updateVault(vaultId, { images: remaining, heroImage: nextHero }, { expectedEditedAt: vault?.editedAt ?? null });
      if (!res || res.ok === false) {
        if (res?.code === 'conflict') {
          Alert.alert('Updated elsewhere', 'This vault changed on another device. Reload and try again.', [
            { text: 'Reload', onPress: () => setEditVisible(false) },
            { text: 'Cancel', style: 'cancel' },
          ]);
          return;
        }
        Alert.alert('Update failed', res?.message || 'Unable to remove vault image');
      }
    })();
  };

  const addImagesToDraft = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required to add images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES,
      quality: 0.75,
      base64: true,
    });

    if (result.canceled) return;
    const assets = result.assets || [];
    const newImages = [];
    const skipped = [];

    assets.forEach((asset) => {
      if (!asset?.base64) return;
      const bytes = Math.ceil(asset.base64.length * 3 / 4);
      const uri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      if (bytes > MAX_IMAGE_BYTES) {
        skipped.push(asset.fileName || 'image');
        return;
      }
      newImages.push(uri);
    });

    setEditDraft((prev) => {
      const merged = trimToFour([...(prev.images || []), ...newImages]);
      return { ...prev, images: merged, heroImage: ensureHero(merged, prev.heroImage) };
    });

    if (skipped.length) {
      Alert.alert('Skipped large files', `Images over 30MB were skipped: ${skipped.join(', ')}`);
    }
  };

  const setDraftHero = (img) => {
    setEditDraft((prev) => {
      const reordered = trimToFour([img, ...(prev.images || []).filter((i) => i !== img)]);
      return { ...prev, images: reordered, heroImage: img };
    });
  };

  const removeDraftImage = (img) => {
    setEditDraft((prev) => {
      const remaining = (prev.images || []).filter((i) => i !== img);
      const nextHero = ensureHero(remaining, prev.heroImage === img ? remaining[0] : prev.heroImage);
      return { ...prev, images: remaining, heroImage: nextHero };
    });
  };

  const openEditModal = () => {
    if (!canEdit) return;
    if (!vault) return;
    setEditDraft({
      name: vault?.name || '',
      description: vault?.description || '',
      manager: vault?.manager || '',
      images: trimToFour(vaultImages),
      heroImage,
    });
    setEditVisible(true);
  };

  useEffect(() => {
    if (pendingReloadEditedAt == null) return;
    if (editVisible) return;
    const current = vault?.editedAt ?? null;
    if (current == null) return;
    if (current === pendingReloadEditedAt) return;
    setPendingReloadEditedAt(null);
    setTimeout(() => {
      openEditModal();
    }, 0);
  }, [pendingReloadEditedAt, vault?.editedAt, editVisible]);

  const handleSaveDraft = () => {
    if (!canEdit) return;
    if (!vault) return;
    const expectedEditedAt = vault?.editedAt ?? null;
    const images = trimToFour(editDraft.images || []);
    const hero = ensureHero(images, editDraft.heroImage);
    (async () => {
      const res = await updateVault(vaultId, {
        name: limit35((editDraft.name || '').trim() || vault.name || ''),
        description: (editDraft.description || '').trim(),
        manager: (editDraft.manager || '').trim(),
        images,
        heroImage: hero,
      }, { expectedEditedAt });
      if (!res || res.ok === false) {
        if (res?.code === 'conflict') {
          Alert.alert('Updated elsewhere', 'This vault changed on another device. Reload and try again.', [
            { text: 'Reload', onPress: () => { setPendingReloadEditedAt(expectedEditedAt); setEditVisible(false); } },
            { text: 'Cancel', style: 'cancel' },
          ]);
          return;
        }
        Alert.alert('Save failed', res?.message || 'Unable to update vault');
        return;
      }
      setEditVisible(false);
    })();
  };

  const openShare = (targetType, targetId) => {
    setShareTargetType(targetType);
    setShareTargetId(targetId);
    setShareVisible(true);
  };

  useEffect(() => {
    const p = route?.params || {};
    if (p.openEdit) {
      openEditModal();
      navigation.setParams({ openEdit: undefined });
    }
    if (p.openShare) {
      openShare(p.shareTargetType || 'vault', p.shareTargetId || vaultId);
      navigation.setParams({ openShare: undefined, shareTargetType: undefined, shareTargetId: undefined });
    }
  }, [route?.params, navigation, openEditModal, vaultId]);

  const getCollectionShareCount = (collectionId) => {
    const vId = String(vaultId);
    const cId = String(collectionId);
    const ids = new Set(
      (permissionGrants || [])
        .filter((g) => g?.vault_id === vId && g?.scope_type === 'COLLECTION' && String(g?.scope_id) === cId)
        .map((g) => String(g.user_id))
    );
    return ids.size;
  };

  const renderCollection = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.card,
        styles.collectionAccent,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      onPress={() => navigation.navigate('Collection', { collectionId: item.id })}
    >
      <View style={styles.cardRow}>
        <View>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name}</Text>
            <View style={[styles.sharedDot, canShare && getCollectionShareCount(item.id) > 0 ? styles.sharedDotOn : styles.sharedDotOff]} />
          </View>
          <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>Collection • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          {canShare && (
            <TouchableOpacity
              style={[styles.sharePill, !canShareOnline && styles.buttonDisabled]}
              onPress={(e) => {
                e.stopPropagation();
                openShare('collection', item.id);
              }}
              disabled={!canShareOnline}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Share collection"
            >
              <Text style={styles.sharePillText}>Share</Text>
            </TouchableOpacity>
          )}
          <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <>
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Vault</Text>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Title</Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="Vault title"
                    placeholderTextColor={theme.placeholder}
                    value={editDraft.name}
                    onChangeText={(name) => setEditDraft((prev) => ({ ...prev, name: limit35(name || '') }))}
                    editable={canEditOnline}
                  />

                  <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Manager</Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="Manager"
                    placeholderTextColor={theme.placeholder}
                    value={editDraft.manager}
                    onChangeText={(manager) => setEditDraft((prev) => ({ ...prev, manager }))}
                    editable={canEditOnline}
                  />

                  <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Description</Text>
                  <TextInput
                    style={[styles.modalInput, styles.modalTextarea, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="Description"
                    placeholderTextColor={theme.placeholder}
                    value={editDraft.description}
                    onChangeText={(description) => setEditDraft((prev) => ({ ...prev, description }))}
                    editable={canEditOnline}
                    multiline
                  />

                    <View style={[styles.mediaCard, { marginTop: 12, backgroundColor: theme.surface, borderColor: theme.border }]}>
                      <View style={styles.mediaHeader}>
                        <Text style={[styles.sectionLabel, { color: theme.text }]}>Images</Text>
                        <TouchableOpacity style={[styles.addImageButton, !canEditOnline && styles.buttonDisabled]} onPress={addImagesToDraft} disabled={!canEditOnline}>
                          <Text style={styles.addImageButtonText}>{(editDraft.images || []).length ? 'Add more' : 'Add images'}</Text>
                        </TouchableOpacity>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                        {draftPreviewImages.length === 0 ? (
                          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No images yet. A default hero image will be used.</Text>
                        ) : (
                          draftPreviewImages.map((img) => {
                            const isHeroImg = editDraft.heroImage === img;
                            return (
                              <View key={img} style={[styles.thumbCard, isHeroImg && styles.heroThumbCard]}>
                                {isHeroImg && (
                                  <View style={styles.heroBadge}>
                                    <Text style={styles.heroBadgeText}>★</Text>
                                  </View>
                                )}
                                <Image source={toImageSource(img)} style={styles.thumb} />
                                <TouchableOpacity
                                  style={styles.removeImageBtn}
                                  onPress={() => removeDraftImage(img)}
                                  disabled={!canEditOnline}
                                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                  accessibilityRole="button"
                                  accessibilityLabel="Remove image"
                                >
                                  <Text style={styles.removeImageBtnText}>✕</Text>
                                </TouchableOpacity>
                                {!isHeroImg && (
                                  <TouchableOpacity
                                    style={styles.makeHeroBtn}
                                    onPress={() => setDraftHero(img)}
                                    disabled={!canEditOnline}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                    accessibilityRole="button"
                                    accessibilityLabel="Set as hero image"
                                  >
                                    <Text style={styles.makeHeroBtnText}>☆</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            );
                          })
                        )}
                      </ScrollView>
                    </View>
                </ScrollView>
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setEditVisible(false)}>
                    <Text style={styles.secondaryButtonText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, !canEditOnline && styles.buttonDisabled]}
                    disabled={!canEditOnline}
                    onPress={handleSaveDraft}
                  >
                    <Text style={styles.primaryButtonText}>Save</Text>
                  </TouchableOpacity>
                  {canDelete && (
                    <TouchableOpacity
                      style={[styles.dangerButton, !canDeleteOnline && styles.buttonDisabled]}
                      disabled={!canDeleteOnline}
                      onPress={() => {
                        Alert.alert('Delete Vault?', 'This action cannot be undone.', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            onPress: () => {
                              setEditVisible(false);
                              (async () => {
                                const res = await deleteVault(vaultId);
                                if (!res || res.ok === false) {
                                  Alert.alert('Delete failed', res?.message || 'Unable to delete vault');
                                  return;
                                }
                                navigation.goBack();
                              })();
                            },
                            style: 'destructive',
                          },
                        ]);
                      }}
                    >
                      <Text style={styles.dangerButtonText}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
            </Modal>
          <View style={[styles.container, { backgroundColor: theme.background }]}>
            <FlatList
              data={vaultCollections}
              keyExtractor={(c) => c.id}
              renderItem={renderCollection}
              contentContainerStyle={styles.listContent}
              ListHeaderComponentStyle={styles.listHeader}
              bounces
              alwaysBounceVertical
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.isDark ? '#fff' : '#111827'} progressViewOffset={24} />}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListHeaderComponent={
                <View style={{ position: 'relative' }}>
                  <BackButton />
                  <LambHeader />
                  <View style={styles.headerArea}>
                    <View style={styles.headerSection}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.title, { color: theme.text }]}>{vault?.name || 'Vault'}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.infoButton}
                        onPress={() => setInfoVisible(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Vault info"
                      >
                        <Text style={styles.infoButtonText}>ℹ</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.subtitleDim, { color: theme.textMuted }]}>Access Type: {accessType}</Text>

                    {(canEdit || canShare) && (
                      <View style={styles.actionsRow}>
                        <TouchableOpacity
                          style={[styles.primaryButton, styles.actionButton, !canEditOnline && styles.buttonDisabled]}
                          disabled={!canEditOnline}
                          onPress={openEditModal}
                        >
                          <Text style={styles.primaryButtonText}>Edit</Text>
                        </TouchableOpacity>
                        {canShare ? (
                          <TouchableOpacity
                            style={[styles.shareButton, styles.actionButton, !canShareOnline && styles.buttonDisabled]}
                            onPress={() => openShare('vault', vaultId)}
                            disabled={!canShareOnline}
                            accessibilityRole="button"
                            accessibilityLabel="Share vault"
                          >
                            <Text style={styles.secondaryButtonText}>Share</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.actionButton, { opacity: 0 }]} pointerEvents="none" />
                        )}
                        <View style={[styles.actionButton, { opacity: 0 }]} pointerEvents="none" />
                      </View>
                    )}

                    <View style={[styles.mediaCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
                      <View style={styles.mediaHeader}>
                        <Text style={[styles.sectionLabel, { color: theme.text }]}> 
                          Images
                        </Text>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                        {previewImages.length === 0 ? (
                          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No images yet. A default hero image will be used.</Text>
                        ) : (
                          previewImages.map((img) => {
                            const isHeroImg = heroImage === img;
                            return (
                              <TouchableOpacity key={img} style={[styles.thumbCard, isHeroImg && styles.heroThumbCard]} onPress={() => setPreviewImage(img)}>
                                {isHeroImg && (
                                  <View style={styles.heroBadge}>
                                    <Text style={styles.heroBadgeText}>★</Text>
                                  </View>
                                )}
                                <Image source={toImageSource(img)} style={styles.thumb} />
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </ScrollView>
                    </View>
                  </View>

                  <View style={styles.divider} />
                  <View style={styles.createRow}>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                      placeholder="New collection name"
                      placeholderTextColor={theme.placeholder}
                      value={newName}
                      editable={canCreateOnline}
                      onChangeText={(text) => setNewName(limit35(text || ''))}
                    />
                    <TouchableOpacity
                      style={[styles.addButton, !canCreateOnline && styles.buttonDisabled]}
                      disabled={!canCreateOnline}
                      onPress={() => {
                        if (!canCreateOnline) return Alert.alert('Internet connection required. Please reconnect and try again.');
                        if (!newName.trim()) return;
                        (async () => {
                          const res = await addCollection({ vaultId, name: newName.trim() });
                          if (!res || res.ok === false) {
                            Alert.alert('Create failed', res?.message || 'Unable to create collection');
                            return;
                          }
                          setNewName('');
                        })();
                      }}
                    >
                      <Text style={styles.addButtonText}>Add</Text>
                    </TouchableOpacity>
                  </View>

                  {loading ? (
                    <Text style={styles.subtitle}>Loading…</Text>
                  ) : vaultCollections.length === 0 ? (
                    <Text style={styles.subtitle}>No collections yet.</Text>
                  ) : null}

                  {vaultCollections.length > 0 ? <View style={styles.separator} /> : null}
                </View>
              }
              ListFooterComponent={<View style={{ height: 24 }} />}
            />
      <ShareModal
        visible={shareVisible}
        onClose={() => { setShareVisible(false); setShareTargetId(null); setShareTargetType(null); }}
        targetType={shareTargetType || 'vault'}
        targetId={shareTargetId || vaultId}
      />
      <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setInfoVisible(false)} activeOpacity={1}>
          <View style={[styles.infoModalContent, { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
            <Text style={[styles.infoModalTitle, { color: theme.text }]}>Information</Text>
            <View style={styles.infoModalMetadata}>
              <Text style={[styles.infoModalRow, { color: theme.textSecondary }]}>
                <Text style={[styles.infoModalLabel, { color: theme.textMuted }]}>Created:</Text>{' '}
                {new Date(vault.createdAt).toLocaleDateString()}
              </Text>
              <Text style={[styles.infoModalRow, { color: theme.textSecondary }]}>
                <Text style={[styles.infoModalLabel, { color: theme.textMuted }]}>Viewed:</Text>{' '}
                {new Date(vault.viewedAt).toLocaleDateString()}
              </Text>
              <Text style={[styles.infoModalRow, { color: theme.textSecondary }]}>
                <Text style={[styles.infoModalLabel, { color: theme.textMuted }]}>Edited:</Text>{' '}
                {new Date(vault.editedAt).toLocaleDateString()}
              </Text>
              <Text style={[styles.infoModalRow, { color: theme.textSecondary }]}>
                <Text style={[styles.infoModalLabel, { color: theme.textMuted }]}>Manager:</Text>{' '}
                <Text style={styles.visuallyHidden}>{users.find(u => u.id === vault.ownerId)?.username || 'Unknown'}</Text>
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={[styles.modalCard, { padding: 0 }]} activeOpacity={1} onPress={() => setPreviewImage(null)}>
            {previewImage ? (
              <Image source={toImageSource(previewImage)} style={{ width: '100%', height: 360, borderRadius: 12 }} resizeMode="contain" />
            ) : null}
          </TouchableOpacity>
        </View>
      </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  listContent: { paddingBottom: 24 },
  listHeader: { paddingBottom: 0 },
  headerArea: { gap: 12 },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', lineHeight: 32, flexShrink: 1 },
  metadataSection: { backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, padding: 12, gap: 8 },
  metadataRow: { color: '#e5e7f0', fontSize: 13 },
  metadataLabel: { fontWeight: '700', color: '#9aa1b5' },
  mediaCard: { backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, padding: 12, gap: 10 },
  mediaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { color: '#e5e7f0', fontWeight: '700', fontSize: 16 },
  heroImage: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#0d111a' },
  thumbRow: { marginTop: 8 },
  thumbCard: { marginRight: 10, width: 120, position: 'relative' },
  thumb: { width: '100%', height: 90, borderRadius: 8, backgroundColor: '#0d111a' },
  heroBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, zIndex: 1 },
  heroBadgeText: { color: '#fcd34d', fontWeight: '800', fontSize: 14 },
  heroThumbCard: { borderWidth: 2, borderColor: '#2563eb', borderRadius: 10 },
  thumbActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  thumbActionText: { color: '#8ab4ff', fontSize: 12 },
  removeImageBtn: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: '#dc2626', justifyContent: 'center', alignItems: 'center' },
  removeImageBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  makeHeroBtn: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, zIndex: 1 },
  makeHeroBtnText: { color: '#fcd34d', fontWeight: '800', fontSize: 14 },
  subtitleDim: { color: '#7d8497' },
  subtitle: { color: '#c5c5d0' },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  collectionAccent: { borderLeftWidth: 4, borderLeftColor: '#9333ea', paddingLeft: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  sharedDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#0f172a' },
  sharedDotOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  sharedDotOff: { backgroundColor: '#475569', borderColor: '#475569' },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionButton: { flexGrow: 1, flexBasis: '24%', minWidth: '22%' },
  sharePill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#16a34a' },
  sharePillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  primaryButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondaryButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#374151' },
  addImageButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#16a34a' },
  addImageButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  shareButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  secondaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  dangerButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#dc2626' },
  dangerButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  separator: { height: 12 },
  divider: { height: 1, backgroundColor: '#1f2738', marginVertical: 12 },
  buttonDisabled: { backgroundColor: '#1f2738' },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, backgroundColor: '#0e0f17', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1f2738', maxHeight: '85%' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  modalLabel: { color: '#c5c5d0', marginTop: 10, marginBottom: 6, fontWeight: '700' },
  modalInput: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  modalTextarea: { minHeight: 90, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  infoButton: { padding: 8, marginLeft: 8, alignSelf: 'flex-start' },
  infoButtonText: { color: '#e5e7f0', fontSize: 20, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', alignItems: 'center' },
  infoModalContent: { backgroundColor: '#1a1b24', borderRadius: 12, padding: 16, marginHorizontal: 16, maxWidth: '90%' },
  infoModalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  infoModalMetadata: { gap: 8 },
  infoModalRow: { color: '#e5e7f0', fontSize: 13, lineHeight: 18 },
  infoModalLabel: { color: '#9aa1b5', fontWeight: '600' },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: 'hidden',
    clipPath: 'inset(100%)',
    border: 0,
  },
});
