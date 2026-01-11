import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  Modal,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';
import { getAssetCapabilities } from '../policies/capabilities';

function formatCurrency(val) {
  if (!val) return '';
  const num = parseFloat(val.toString().replace(/[^\d.]/g, ''));
  if (Number.isNaN(num)) return '';
  return `$${num.toLocaleString()}`;
}

function unformatCurrency(val) {
  if (!val) return '';
  return val.replace(/[^\d.]/g, '');
}

export default function Asset({ route, navigation }) {
  const { assetId } = route.params || {};
  const {
    loading,
    assets,
    users,
    currentUser,
    updateAsset,
    moveAsset,
    addAsset,
    vaults,
    collections,
    getRoleForAsset,
    deleteAsset,
    refreshData,
    theme,
  } = useData();

  const asset = useMemo(() => assets.find((a) => a.id === assetId), [assetId, assets]);
  const owner = useMemo(() => users.find((u) => u.id === asset?.ownerId), [users, asset]);

  const [moveVaultId, setMoveVaultId] = useState(asset?.vaultId || null);
  const [moveCollectionId, setMoveCollectionId] = useState(asset?.collectionId || null);
  const [showShare, setShowShare] = useState(false);
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      await refreshData?.();
    } finally {
      const elapsed = Date.now() - startedAt;
      const minMs = 800;
      if (elapsed < minMs) {
        await new Promise((r) => setTimeout(r, minMs - elapsed));
      }
      setRefreshing(false);
    }
  };

  const [editDraft, setEditDraft] = useState({
    title: '',
    type: '',
    category: '',
    quantity: 1,
    value: '',
    estimateValue: '',
    rrp: '',
    purchasePrice: '',
    manager: '',
    description: '',
    images: [],
    heroImage: '',
  });
  const [previewImage, setPreviewImage] = useState(null);

  const draftPreviewImages = editDraft.heroImage
    ? [editDraft.heroImage, ...(editDraft.images || []).filter((img) => img !== editDraft.heroImage)]
    : editDraft.images || [];

  const limit20 = (value = '') => value.slice(0, 20);
  const role = getRoleForAsset(assetId, currentUser?.id);
  const accessType = asset?.ownerId === currentUser?.id
    ? 'Owner'
    : role
      ? `${role.charAt(0).toUpperCase()}${role.slice(1)}`
      : 'Shared';
  const caps = getAssetCapabilities({ role });
  const canEdit = caps.canEdit;
  const canMove = caps.canMove;
  const canShare = caps.canShare;
  const canClone = caps.canClone;
  const canDelete = caps.canDelete;

  const assetImages = asset?.images || [];
  const heroImage = asset?.heroImage || 'https://via.placeholder.com/900x600?text=Image';
  const previewImages = heroImage ? [heroImage, ...assetImages.filter((img) => img !== heroImage)] : assetImages;

  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const MAX_IMAGES = 4;
  const mediaTypes = ImagePicker.MediaType?.Images || ImagePicker.MediaTypeOptions.Images;
  const trimToFour = (arr = []) => arr.filter(Boolean).slice(0, MAX_IMAGES);

  const ensureHero = (images, currentHero) => {
    if (currentHero && images.includes(currentHero)) return currentHero;
    return images[0] || 'https://via.placeholder.com/900x600?text=Image';
  };

  useEffect(() => {
    if (!asset) return;
    setEditDraft({
      title: limit20(asset.title || ''),
      type: asset.type || '',
      category: asset.category || '',
      quantity: asset.quantity ?? 1,
      value: asset.value ? String(asset.value) : '',
      estimateValue: asset.estimateValue ? String(asset.estimateValue) : '',
      rrp: asset.rrp ? String(asset.rrp) : '',
      purchasePrice: asset.purchasePrice ? String(asset.purchasePrice) : '',
      manager: asset.manager || '',
      description: asset.description || '',
      images: trimToFour(assetImages),
      heroImage: ensureHero(assetImages, heroImage),
    });
  }, [
    assetId,
    asset?.title,
    asset?.type,
    asset?.category,
    asset?.quantity,
    asset?.value,
    asset?.estimateValue,
    asset?.rrp,
    asset?.purchasePrice,
    asset?.manager,
    asset?.description,
    heroImage,
    assetImages.join(','),
  ]);

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
    const pickedAssets = result.assets || [];
    const newImages = [];
    const skipped = [];

    pickedAssets.forEach((assetPick) => {
      if (!assetPick?.base64) return;
      const bytes = Math.ceil((assetPick.base64.length * 3) / 4);
      const uri = `data:${assetPick.mimeType || 'image/jpeg'};base64,${assetPick.base64}`;
      if (bytes > MAX_IMAGE_BYTES) {
        skipped.push(assetPick.fileName || 'image');
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
    if (!asset) return;
    setEditDraft({
      title: limit20(asset.title || ''),
      type: asset.type || '',
      category: asset.category || '',
      quantity: asset.quantity ?? 1,
      value: asset.value ? String(asset.value) : '',
      estimateValue: asset.estimateValue ? String(asset.estimateValue) : '',
      rrp: asset.rrp ? String(asset.rrp) : '',
      purchasePrice: asset.purchasePrice ? String(asset.purchasePrice) : '',
      manager: asset.manager || '',
      description: asset.description || '',
      images: trimToFour(assetImages),
      heroImage: ensureHero(assetImages, heroImage),
    });
    setEditVisible(true);
  };

  const handleSaveDraft = () => {
    if (!canEdit || !asset) return;
    const images = trimToFour(editDraft.images || []);
    const hero = ensureHero(images, editDraft.heroImage);
    const title = limit20(editDraft.title || 'Untitled');

    updateAsset(asset.id, {
      title,
      type: editDraft.type || '',
      category: editDraft.category || '',
      quantity: Number(editDraft.quantity) || 1,
      value: editDraft.value,
      estimateValue: editDraft.estimateValue,
      rrp: editDraft.rrp,
      purchasePrice: editDraft.purchasePrice,
      manager: editDraft.manager,
      description: editDraft.description,
      images,
      heroImage: hero,
    });

    setEditVisible(false);
    Alert.alert('Saved');
  };

  const handleMove = () => {
    if (!canMove || !asset) return;
    if (!moveVaultId || !moveCollectionId) {
      Alert.alert('Select vault and collection');
      return;
    }
    moveAsset({ assetId: asset.id, targetVaultId: moveVaultId, targetCollectionId: moveCollectionId });
    navigation.goBack();
  };

  const handleCloneAsset = () => {
    if (!canEdit || !asset) return;
    if (typeof addAsset !== 'function') {
      Alert.alert('Clone not supported');
      return;
    }

    const copyTitle = asset.title ? `${asset.title} (Copy)` : 'Untitled (Copy)';
    addAsset({
      vaultId: asset.vaultId,
      collectionId: asset.collectionId,
      title: copyTitle,
      type: asset.type,
      category: asset.category,
      images: asset.images,
      heroImage: asset.heroImage,
    });
    Alert.alert('Cloned', 'Asset has been cloned.');
  };

  const ownerVaults = vaults.filter((v) => v.ownerId === asset?.ownerId);
  const ownerCollections = collections.filter((c) => c.ownerId === asset?.ownerId && c.vaultId === moveVaultId);

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>Loading…</Text>
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Asset not found.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Asset</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Title</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Title"
                placeholderTextColor={theme.placeholder}
                value={editDraft.title}
                onChangeText={(title) => setEditDraft((prev) => ({ ...prev, title: limit20(title) }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Type</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Type"
                placeholderTextColor={theme.placeholder}
                value={editDraft.type}
                onChangeText={(type) => setEditDraft((prev) => ({ ...prev, type }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Category</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Category"
                placeholderTextColor={theme.placeholder}
                value={editDraft.category}
                onChangeText={(category) => setEditDraft((prev) => ({ ...prev, category }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Quantity</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Quantity"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={String(editDraft.quantity ?? 1)}
                onChangeText={(quantity) => setEditDraft((prev) => ({ ...prev, quantity }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Value</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Value"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={formatCurrency(editDraft.value)}
                onChangeText={(value) => setEditDraft((prev) => ({ ...prev, value: unformatCurrency(value) }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Estimate Value</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Estimate Value"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={formatCurrency(editDraft.estimateValue)}
                onChangeText={(value) => setEditDraft((prev) => ({ ...prev, estimateValue: unformatCurrency(value) }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>RRP</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="RRP"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={formatCurrency(editDraft.rrp)}
                onChangeText={(value) => setEditDraft((prev) => ({ ...prev, rrp: unformatCurrency(value) }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Purchase Price</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Purchase Price"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={formatCurrency(editDraft.purchasePrice)}
                onChangeText={(value) => setEditDraft((prev) => ({ ...prev, purchasePrice: unformatCurrency(value) }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Manager</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Manager"
                placeholderTextColor={theme.placeholder}
                value={editDraft.manager}
                onChangeText={(manager) => setEditDraft((prev) => ({ ...prev, manager }))}
                editable={canEdit}
              />

              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>Description</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextarea, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Description"
                placeholderTextColor={theme.placeholder}
                value={editDraft.description}
                onChangeText={(description) => setEditDraft((prev) => ({ ...prev, description }))}
                editable={canEdit}
                multiline
              />

              <View style={[styles.mediaCard, { marginTop: 12, backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={styles.mediaHeader}>
                  <Text style={[styles.sectionLabel, { color: theme.text }]}>Images</Text>
                  <TouchableOpacity
                    style={[styles.addImageButton, !canEdit && styles.buttonDisabled]}
                    onPress={addImagesToDraft}
                    disabled={!canEdit}
                  >
                    <Text style={styles.addImageButtonText}>
                      {(editDraft.images || []).length ? 'Add more' : 'Add images'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                  {draftPreviewImages.length === 0 ? (
                    <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No images yet.</Text>
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
                          <Image source={{ uri: img }} style={styles.thumb} />
                          <TouchableOpacity
                            style={styles.removeImageBtn}
                            onPress={() => removeDraftImage(img)}
                            disabled={!canEdit}
                          >
                            <Text style={styles.removeImageBtnText}>✕</Text>
                          </TouchableOpacity>
                          {!isHeroImg && (
                            <TouchableOpacity
                              style={styles.makeHeroBtn}
                              onPress={() => setDraftHero(img)}
                              disabled={!canEdit}
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
                style={[styles.primaryButton, !canEdit && styles.buttonDisabled]}
                disabled={!canEdit}
                onPress={handleSaveDraft}
              >
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
              {canDelete && (
                <TouchableOpacity
                  style={styles.dangerButton}
                  onPress={() => {
                    Alert.alert('Delete Asset?', 'This action cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        onPress: () => {
                          setEditVisible(false);
                          deleteAsset(assetId);
                          navigation.goBack();
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

      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={[styles.modalCard, { padding: 0 }]}
            activeOpacity={1}
            onPress={() => setPreviewImage(null)}
          >
            {previewImage ? (
              <Image
                source={{ uri: previewImage }}
                style={{ width: '100%', height: 360, borderRadius: 12 }}
                resizeMode="contain"
              />
            ) : null}
          </TouchableOpacity>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
        bounces
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.isDark ? '#fff' : '#111827'} progressViewOffset={24} />}
      >
        <View style={styles.headerRow}>
          <BackButton />
          <LambHeader />
        </View>

        <View style={styles.headerSection}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>{asset.title}</Text>
          </View>
          <TouchableOpacity style={styles.infoButton} onPress={() => setInfoVisible(true)}>
            <Text style={styles.infoButtonText}>ℹ</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.roleBadge, { color: theme.textMuted }]}>Access Type: {accessType}</Text>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.primaryButton, styles.actionButton, !canEdit && styles.buttonDisabled]}
            disabled={!canEdit}
            onPress={openEditModal}
          >
            <Text style={styles.primaryButtonText}>Edit</Text>
          </TouchableOpacity>

          {canShare && (
            <TouchableOpacity style={[styles.shareButton, styles.actionButton]} onPress={() => setShowShare(true)}>
              <Text style={styles.secondaryButtonText}>Share</Text>
            </TouchableOpacity>
          )}

          {canMove && (
            <TouchableOpacity style={[styles.moveButton, styles.actionButton]} onPress={() => setShowMoveBox(!showMoveBox)}>
              <Text style={styles.secondaryButtonText}>Move</Text>
            </TouchableOpacity>
          )}

          {canClone && (
            <TouchableOpacity style={[styles.cloneButton, styles.actionButton]} onPress={handleCloneAsset}>
              <Text style={styles.cloneButtonText}>Clone</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.mediaCard}>
          <View style={styles.mediaHeader}>
            <Text style={styles.sectionLabel}>Images</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
            {previewImages.length === 0 ? (
              <Text style={styles.subtitle}>No images yet.</Text>
            ) : (
              previewImages.map((img) => {
                const isHeroImg = heroImage === img;
                return (
                  <TouchableOpacity
                    key={img}
                    style={[styles.thumbCard, isHeroImg && styles.heroThumbCard]}
                    onPress={() => setPreviewImage(img)}
                  >
                    {isHeroImg && (
                      <View style={styles.heroBadge}>
                        <Text style={styles.heroBadgeText}>★</Text>
                      </View>
                    )}
                    <Image source={{ uri: img }} style={styles.thumb} />
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>

        {showMoveBox && canMove && (
          <View style={[styles.moveBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.sectionLabel, { color: theme.text }]}>Move Asset</Text>

            <Text style={[styles.helper, { color: theme.textMuted }]}>Select a vault:</Text>
            <TouchableOpacity
              style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
              onPress={() => setVaultDropdownOpen(!vaultDropdownOpen)}
            >
              <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                {moveVaultId ? ownerVaults.find((v) => v.id === moveVaultId)?.name || 'Select vault...' : 'Select vault...'}
              </Text>
              <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{vaultDropdownOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {vaultDropdownOpen && (
              <ScrollView style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]} nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
                {ownerVaults.length === 0 ? (
                  <Text style={[styles.helper, { color: theme.textMuted }]}>No owner vaults</Text>
                ) : (
                  ownerVaults.map((v) => (
                    <TouchableOpacity
                      key={v.id}
                      style={[
                        styles.dropdownItem,
                        { borderBottomColor: theme.border },
                        moveVaultId === v.id && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setMoveVaultId(v.id);
                        setMoveCollectionId(null);
                        setVaultDropdownOpen(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, { color: theme.text }]}>{v.name || v.id}</Text>
                      {moveVaultId === v.id && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}

            <Text style={[styles.helper, { color: theme.textMuted }]}>Select a collection:</Text>
            <TouchableOpacity
              style={[
                styles.dropdownButton,
                { backgroundColor: theme.inputBg, borderColor: theme.border },
                !moveVaultId && styles.buttonDisabled,
              ]}
              onPress={() => moveVaultId && setCollectionDropdownOpen(!collectionDropdownOpen)}
              disabled={!moveVaultId}
            >
              <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                {moveCollectionId
                  ? ownerCollections.find((c) => c.id === moveCollectionId)?.name || 'Select collection...'
                  : 'Select collection...'}
              </Text>
              <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{collectionDropdownOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {collectionDropdownOpen && (
              <ScrollView style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]} nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
                {ownerCollections.length === 0 ? (
                  <Text style={[styles.helper, { color: theme.textMuted }]}>Select a vault first</Text>
                ) : (
                  ownerCollections.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[
                        styles.dropdownItem,
                        { borderBottomColor: theme.border },
                        moveCollectionId === c.id && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setMoveCollectionId(c.id);
                        setCollectionDropdownOpen(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, { color: theme.text }]}>{c.name || c.id}</Text>
                      {moveCollectionId === c.id && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.button, (!moveVaultId || !moveCollectionId) && styles.buttonDisabled]}
              onPress={handleMove}
              disabled={!moveVaultId || !moveCollectionId}
            >
              <Text style={styles.buttonText}>Move</Text>
            </TouchableOpacity>
          </View>
        )}

        <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
          <TouchableOpacity style={styles.modalOverlay} onPress={() => setInfoVisible(false)} activeOpacity={1}>
            <View style={[styles.infoModalContent, { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
              <View style={[styles.infoModalHeader, { borderBottomColor: theme.border }]}>
                <Text style={[styles.infoModalTitle, { color: theme.text }]}>Information</Text>
                <TouchableOpacity onPress={() => setInfoVisible(false)}>
                  <Text style={[styles.infoModalClose, { color: theme.textMuted }]}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.infoModalBody}>
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Created</Text>
                  <Text style={[styles.infoValue, { color: theme.text }]}>{asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : '-'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Viewed</Text>
                  <Text style={[styles.infoValue, { color: theme.text }]}>{asset.viewedAt ? new Date(asset.viewedAt).toLocaleDateString() : '-'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Edited</Text>
                  <Text style={[styles.infoValue, { color: theme.text }]}>{asset.editedAt ? new Date(asset.editedAt).toLocaleDateString() : '-'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Manager</Text>
                  <Text style={[styles.infoValue, { color: theme.text }]}>{owner?.username || asset.manager || 'Unknown'}</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>

        <ShareModal visible={showShare} onClose={() => setShowShare(false)} targetType="asset" targetId={assetId} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { flexGrow: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { position: 'relative', width: '100%' },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', flex: 1, lineHeight: 32 },
  subtitle: { color: '#c5c5d0' },
  roleBadge: { color: '#9aa1b5', fontSize: 13 },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionButton: { flexGrow: 1, flexBasis: '24%', minWidth: '22%' },

  primaryButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondaryButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#374151' },
  secondaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  shareButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  moveButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#eab308' },
  cloneButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#a21caf' },
  cloneButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  dangerButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#dc2626' },
  dangerButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  buttonDisabled: { backgroundColor: '#1f2738' },

  infoButton: { padding: 8, marginLeft: 8, alignSelf: 'flex-start' },
  infoButtonText: { fontSize: 20, color: '#22c55e', fontWeight: '600', lineHeight: 24 },

  mediaCard: { backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, padding: 12, gap: 10 },
  mediaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { color: '#e5e7f0', fontWeight: '700' },
  thumbRow: { marginTop: 8 },
  thumbCard: { marginRight: 10, width: 120, position: 'relative' },
  thumb: { width: '100%', height: 90, borderRadius: 8, backgroundColor: '#0d111a' },
  heroBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, zIndex: 1 },
  heroBadgeText: { color: '#fcd34d', fontWeight: '800', fontSize: 14 },
  heroThumbCard: { borderWidth: 2, borderColor: '#2563eb', borderRadius: 10 },
  removeImageBtn: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: '#dc2626', justifyContent: 'center', alignItems: 'center' },
  removeImageBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  makeHeroBtn: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, zIndex: 1 },
  makeHeroBtnText: { color: '#fcd34d', fontWeight: '800', fontSize: 14 },

  addImageButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#16a34a' },
  addImageButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  moveBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#0f111a', gap: 8 },
  helper: { color: '#9aa1b5', fontSize: 12, marginBottom: 8 },

  dropdownButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8 },
  dropdownButtonText: { color: '#e5e7f0', fontSize: 14 },
  dropdownArrow: { color: '#9aa1b5', fontSize: 12 },
  dropdownList: { height: 150, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 8, marginBottom: 12 },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1f2738' },
  dropdownItemActive: { backgroundColor: '#172447' },
  dropdownItemText: { color: '#e5e7f0', fontSize: 14 },
  checkmark: { color: '#2563eb', fontSize: 16, fontWeight: 'bold' },

  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eab308' },
  buttonText: { color: '#fff', fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, backgroundColor: '#0e0f17', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1f2738', maxHeight: '85%' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  modalLabel: { color: '#c5c5d0', marginTop: 10, marginBottom: 6, fontWeight: '700' },
  modalInput: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  modalTextarea: { minHeight: 90, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },

  infoModalContent: { backgroundColor: '#0b0b0f', borderRadius: 12, padding: 20, width: '85%', maxHeight: '70%' },
  infoModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1f2738', paddingBottom: 12 },
  infoModalTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  infoModalClose: { fontSize: 24, color: '#999', fontWeight: '300' },
  infoModalBody: { gap: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  infoLabel: { fontSize: 14, color: '#999', fontWeight: '500', lineHeight: 20 },
  infoValue: { fontSize: 14, color: '#22c55e', fontWeight: '600', lineHeight: 20 },
});
