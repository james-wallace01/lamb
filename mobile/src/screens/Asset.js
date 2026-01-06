import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ScrollView, Image, Modal } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';
import LambHeader from '../components/LambHeader';

export default function Asset({ route, navigation }) {
  const { assetId } = route.params || {};
  const { loading, assets, users, currentUser, updateAsset, moveAsset, vaults, collections, getRoleForAsset, deleteAsset } = useData();
  const asset = useMemo(() => assets.find((a) => a.id === assetId), [assetId, assets]);
  const owner = useMemo(() => users.find((u) => u.id === asset?.ownerId), [users, asset]);
  const [moveVaultId, setMoveVaultId] = useState(asset?.vaultId || null);
  const [moveCollectionId, setMoveCollectionId] = useState(asset?.collectionId || null);
  const [showShare, setShowShare] = useState(false);
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editDraft, setEditDraft] = useState({
    title: '',
    type: '',
    category: '',
    quantity: 1,
    value: '',
    manager: '',
    images: [],
    heroImage: '',
  });
  const [previewImage, setPreviewImage] = useState(null);
  const draftPreviewImages = editDraft.heroImage
    ? [editDraft.heroImage, ...(editDraft.images || []).filter((img) => img !== editDraft.heroImage)]
    : editDraft.images || [];
  const limit20 = (value = '') => value.slice(0, 20);
  const role = getRoleForAsset(assetId, currentUser?.id);
  const canEdit = role === 'owner' || role === 'editor' || role === 'manager';
  const canMove = role === 'owner' || role === 'manager';
  const canShare = role === 'owner' || role === 'manager';
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
      manager: asset.manager || '',
      images: trimToFour(assetImages),
      heroImage: ensureHero(assetImages, heroImage),
    });
  }, [assetId, asset?.title, asset?.type, asset?.category, asset?.quantity, asset?.value, asset?.manager, heroImage, assetImages.join(',')]);

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
      const bytes = Math.ceil(assetPick.base64.length * 3 / 4);
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
      manager: asset.manager || '',
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
      manager: editDraft.manager,
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

  const ownerVaults = vaults.filter((v) => v.ownerId === asset?.ownerId);
  const ownerCollections = collections.filter((c) => c.ownerId === asset?.ownerId && c.vaultId === moveVaultId);

  if (loading) return <View style={styles.container}><Text style={styles.subtitle}>Loading…</Text></View>;
  if (!asset) return <View style={styles.container}><Text style={styles.subtitle}>Asset not found.</Text></View>;

  return (
    <>
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Asset</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalLabel}>Title</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Title"
                placeholderTextColor="#80869b"
                  value={editDraft.title}
                  onChangeText={(title) => setEditDraft((prev) => ({ ...prev, title: limit20(title) }))}
                editable={canEdit}
              />

              <Text style={styles.modalLabel}>Type</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Type"
                placeholderTextColor="#80869b"
                value={editDraft.type}
                onChangeText={(type) => setEditDraft((prev) => ({ ...prev, type }))}
                editable={canEdit}
              />

              <Text style={styles.modalLabel}>Category</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Category"
                placeholderTextColor="#80869b"
                value={editDraft.category}
                onChangeText={(category) => setEditDraft((prev) => ({ ...prev, category }))}
                editable={canEdit}
              />

              <Text style={styles.modalLabel}>Quantity</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Quantity"
                placeholderTextColor="#80869b"
                keyboardType="numeric"
                value={String(editDraft.quantity ?? 1)}
                onChangeText={(quantity) => setEditDraft((prev) => ({ ...prev, quantity }))}
                editable={canEdit}
              />

              <Text style={styles.modalLabel}>Value</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Value"
                placeholderTextColor="#80869b"
                keyboardType="numeric"
                value={editDraft.value}
                onChangeText={(value) => setEditDraft((prev) => ({ ...prev, value }))}
                editable={canEdit}
              />

              <Text style={styles.modalLabel}>Manager</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Manager"
                placeholderTextColor="#80869b"
                value={editDraft.manager}
                onChangeText={(manager) => setEditDraft((prev) => ({ ...prev, manager }))}
                editable={canEdit}
              />

                <View style={[styles.mediaCard, { marginTop: 12 }]}>
                  <View style={styles.mediaHeader}>
                    <Text style={styles.sectionLabel}>Images</Text>
                    <TouchableOpacity
                      style={[styles.addImageButton, !canEdit && styles.buttonDisabled]}
                      onPress={addImagesToDraft}
                      disabled={!canEdit}
                    >
                      <Text style={styles.addImageButtonText}>{(editDraft.images || []).length ? 'Add more' : 'Add images'}</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                    {draftPreviewImages.length === 0 ? (
                      <Text style={styles.subtitle}>No images yet.</Text>
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
                            <TouchableOpacity style={styles.removeImageBtn} onPress={() => removeDraftImage(img)} disabled={!canEdit}>
                              <Text style={styles.removeImageBtnText}>✕</Text>
                            </TouchableOpacity>
                            {!isHeroImg && (
                              <TouchableOpacity style={styles.makeHeroBtn} onPress={() => setDraftHero(img)} disabled={!canEdit}>
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
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={[styles.modalCard, { padding: 0 }]} activeOpacity={1} onPress={() => setPreviewImage(null)}>
            {previewImage ? (
              <Image source={{ uri: previewImage }} style={{ width: '100%', height: 360, borderRadius: 12 }} resizeMode="contain" />
            ) : null}
          </TouchableOpacity>
        </View>
      </Modal>

        <ScrollView contentContainerStyle={styles.container}>
          <LambHeader />
          <View style={styles.headerSection}>
            <View>
              <Text style={styles.title}>{asset.title}</Text>
            </View>
            <View style={[styles.typeBadge, styles.assetBadge]}>
              <Text style={styles.badgeText}>Asset</Text>
            </View>
          </View>
          <Text style={styles.roleBadge}>Role: {role || 'viewer'}</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.primaryButton, styles.actionButton, (!canEdit && styles.buttonDisabled)]}
            disabled={!canEdit}
            onPress={openEditModal}
          >
            <Text style={styles.primaryButtonText}>Edit</Text>
          </TouchableOpacity>
          {canShare && (
            <TouchableOpacity
              style={[styles.shareButton, styles.actionButton]}
              onPress={() => setShowShare(true)}
            >
              <Text style={styles.secondaryButtonText}>Share</Text>
            </TouchableOpacity>
          )}
          {canMove && (
            <TouchableOpacity style={[styles.moveButton, styles.actionButton]} onPress={() => setShowMoveBox(!showMoveBox)}>
              <Text style={styles.secondaryButtonText}>Move</Text>
            </TouchableOpacity>
          )}
          {canMove && (
            <TouchableOpacity
              style={[styles.dangerButton, styles.actionButton]}
              onPress={() => {
                Alert.alert('Delete Asset?', 'This action cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    onPress: () => {
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
        {asset && (
          <View style={styles.metadataSection}>
            <Text style={styles.metadataRow}>
              <Text style={styles.metadataLabel}>Viewed:</Text>{' '}
              {new Date(asset.viewedAt).toLocaleDateString()}
            </Text>
            <Text style={styles.metadataRow}>
              <Text style={styles.metadataLabel}>Edited:</Text>{' '}
              {new Date(asset.editedAt).toLocaleDateString()}
            </Text>
            <Text style={styles.metadataRow}>
              <Text style={styles.metadataLabel}>Manager:</Text>{' '}
              {asset.manager || 'Unassigned'}
            </Text>
            <Text style={styles.metadataRow}>
              <Text style={styles.metadataLabel}>Value:</Text>{' '}
              {(() => {
                const v = parseFloat(asset.value);
                return Number.isFinite(v)
                  ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '$0.00';
              })()}
            </Text>
          </View>
        )}
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
                  <TouchableOpacity key={img} style={[styles.thumbCard, isHeroImg && styles.heroThumbCard]} onPress={() => setPreviewImage(img)}>
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
          <View style={styles.moveBox}>
            <Text style={styles.sectionLabel}>Move Asset</Text>
            <Text style={styles.helper}>Select a vault:</Text>
            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => setVaultDropdownOpen(!vaultDropdownOpen)}
            >
              <Text style={styles.dropdownButtonText}>
                {moveVaultId ? ownerVaults.find((v) => v.id === moveVaultId)?.name || 'Select vault...' : 'Select vault...'}
              </Text>
              <Text style={styles.dropdownArrow}>{vaultDropdownOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {vaultDropdownOpen && (
              <ScrollView
                style={styles.dropdownList}
                nestedScrollEnabled={true}
                bounces={true}
                alwaysBounceVertical={true}
                showsVerticalScrollIndicator={true}
                scrollEventThrottle={16}
              >
                {ownerVaults.length === 0 ? (
                  <Text style={styles.helper}>No owner vaults</Text>
                ) : (
                  ownerVaults.map((v) => (
                    <TouchableOpacity
                      key={v.id}
                      style={[styles.dropdownItem, moveVaultId === v.id && styles.dropdownItemActive]}
                      onPress={() => {
                        setMoveVaultId(v.id);
                        setMoveCollectionId(null);
                        setVaultDropdownOpen(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{v.name || v.id}</Text>
                      {moveVaultId === v.id && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}
            <Text style={styles.helper}>Select a collection:</Text>
            <TouchableOpacity
              style={[styles.dropdownButton, !moveVaultId && styles.buttonDisabled]}
              onPress={() => moveVaultId && setCollectionDropdownOpen(!collectionDropdownOpen)}
              disabled={!moveVaultId}
            >
              <Text style={styles.dropdownButtonText}>
                {moveCollectionId ? ownerCollections.find((c) => c.id === moveCollectionId)?.name || 'Select collection...' : 'Select collection...'}
              </Text>
              <Text style={styles.dropdownArrow}>{collectionDropdownOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {collectionDropdownOpen && (
              <ScrollView
                style={styles.dropdownList}
                nestedScrollEnabled={true}
                bounces={true}
                alwaysBounceVertical={true}
                showsVerticalScrollIndicator={true}
                scrollEventThrottle={16}
              >
                {ownerCollections.length === 0 ? (
                  <Text style={styles.helper}>Select a vault first</Text>
                ) : (
                  ownerCollections.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.dropdownItem, moveCollectionId === c.id && styles.dropdownItemActive]}
                      onPress={() => {
                        setMoveCollectionId(c.id);
                        setCollectionDropdownOpen(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{c.name || c.id}</Text>
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
        <ShareModal visible={showShare} onClose={() => setShowShare(false)} targetType="asset" targetId={assetId} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', flex: 1 },
  metadataSection: { backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, padding: 12, gap: 8 },
  metadataRow: { color: '#e5e7f0', fontSize: 13 },
  metadataLabel: { fontWeight: '700', color: '#9aa1b5' },
  mediaCard: { backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, padding: 12, gap: 10 },
  mediaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
  typeBadge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1 },
  assetBadge: { backgroundColor: '#1b6b2e', borderColor: '#16a34a' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  subtitle: { color: '#c5c5d0' },
  roleBadge: { color: '#9aa1b5', fontSize: 13 },
  field: { color: '#e5e7f0', fontSize: 15 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionButton: { flexGrow: 1, flexBasis: '24%', minWidth: '22%' },
  primaryButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondaryButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#374151' },
  addImageButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#16a34a' },
  addImageButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  shareButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  secondaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },  moveButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#eab308' },  dangerButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#dc2626' },
  dangerButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  buttonDisabled: { backgroundColor: '#1f2738' },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eab308' },
  buttonText: { color: '#fff', fontWeight: '700' },
  moveBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#0f111a', gap: 8 },
  sectionLabel: { color: '#e5e7f0', fontWeight: '700' },
  helper: { color: '#9aa1b5', fontSize: 12, marginBottom: 8 },
  dropdownButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8 },
  dropdownButtonText: { color: '#e5e7f0', fontSize: 14 },
  dropdownArrow: { color: '#9aa1b5', fontSize: 12 },
  dropdownList: { height: 150, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 8, marginBottom: 12 },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1f2738' },
  dropdownItemActive: { backgroundColor: '#172447' },
  dropdownItemText: { color: '#e5e7f0', fontSize: 14 },
  checkmark: { color: '#2563eb', fontSize: 16, fontWeight: 'bold' },
  choiceRow: { flexDirection: 'column', gap: 8 },
  chip: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#11121a' },
  chipActive: { borderColor: '#2563eb', backgroundColor: '#172447' },
  chipText: { color: '#e5e7f0' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, backgroundColor: '#0e0f17', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1f2738', maxHeight: '85%' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  modalLabel: { color: '#c5c5d0', marginTop: 10, marginBottom: 6, fontWeight: '700' },
  modalInput: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  modalTextarea: { minHeight: 90, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
});
