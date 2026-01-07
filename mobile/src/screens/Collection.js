import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, Alert, ScrollView, Image, Modal } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';

export default function Collection({ navigation, route }) {
  const { collectionId } = route.params || {};
  const { loading, collections, assets, addAsset, currentUser, getRoleForCollection, canCreateAssetsInCollection, vaults, moveCollection, users, deleteCollection, updateCollection } = useData();
  const [newTitle, setNewTitle] = useState('');
  const [shareVisible, setShareVisible] = useState(false);
  const [shareTargetType, setShareTargetType] = useState(null);
  const [shareTargetId, setShareTargetId] = useState(null);
  const [moveVaultId, setMoveVaultId] = useState(collection?.vaultId || null);
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [editDraft, setEditDraft] = useState({ name: '', description: '', manager: '', images: [], heroImage: '' });
  const [previewImage, setPreviewImage] = useState(null);
  const draftPreviewImages = editDraft.heroImage
    ? [editDraft.heroImage, ...(editDraft.images || []).filter((img) => img !== editDraft.heroImage)]
    : editDraft.images || [];
  const limit20 = (value = '') => value.slice(0, 20);

  const collection = useMemo(() => collections.find((c) => c.id === collectionId), [collectionId, collections]);
  const collectionAssets = useMemo(() => assets.filter((a) => a.collectionId === collectionId), [assets, collectionId]);
  const role = getRoleForCollection(collectionId, currentUser?.id);
  const isOwner = role === 'owner';
  const canCreate = canCreateAssetsInCollection(collectionId, currentUser?.id);
  const canMove = role === 'owner' || role === 'manager';
  const ownerVaults = vaults.filter(v => v.ownerId === collection?.ownerId);
  const collectionImages = collection?.images || [];
  const heroImage = collection?.heroImage || 'https://via.placeholder.com/900x600?text=Image';
  const previewImages = heroImage ? [heroImage, ...collectionImages.filter((img) => img !== heroImage)] : collectionImages;

  const ensureHero = (images, currentHero) => {
    if (currentHero && images.includes(currentHero)) return currentHero;
    return images[0] || 'https://via.placeholder.com/900x600?text=Image';
  };

  const handleAddImages = async () => {
    if (!collection) return;
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

    const merged = trimToFour([...collectionImages, ...newImages]);
    const nextHero = ensureHero(merged, heroImage);
    updateCollection(collectionId, { images: merged, heroImage: nextHero });

    if (skipped.length) {
      Alert.alert('Skipped large files', `Images over 30MB were skipped: ${skipped.join(', ')}`);
    }
  };

  const handleSetHero = (img) => {
    if (!collection) return;
    const reordered = trimToFour([img, ...collectionImages.filter((i) => i !== img)]);
    updateCollection(collectionId, { images: reordered, heroImage: img });
  };

  const handleRemoveImage = (img) => {
    if (!collection) return;
    const remaining = collectionImages.filter((i) => i !== img);
    const nextHero = ensureHero(remaining, heroImage === img ? remaining[0] : heroImage);
    updateCollection(collectionId, { images: remaining, heroImage: nextHero });
  };
  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const MAX_IMAGES = 4;
  const mediaTypes = ImagePicker.MediaType?.Images || ImagePicker.MediaTypeOptions.Images;
  const trimToFour = (arr = []) => arr.filter(Boolean).slice(0, MAX_IMAGES);

  useEffect(() => {
    setEditDraft({
      name: limit20(collection?.name || ''),
      description: collection?.description || '',
      manager: collection?.manager || '',
      images: trimToFour(collectionImages),
      heroImage: ensureHero(collectionImages, heroImage),
    });
  }, [collectionId, collection?.name, collection?.description, collection?.manager, heroImage, collectionImages.join(',')]);

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
    if (!collection) return;
    setEditDraft({
      name: limit20(collection?.name || ''),
      description: collection?.description || '',
      manager: collection?.manager || '',
      images: trimToFour(collectionImages),
      heroImage,
    });
    setEditVisible(true);
  };

  const handleSaveDraft = () => {
    if (!collection) return;
    const images = trimToFour(editDraft.images || []);
    const hero = ensureHero(images, editDraft.heroImage);
    updateCollection(collectionId, {
      name: limit20((editDraft.name || '').trim() || collection.name || ''),
      description: (editDraft.description || '').trim(),
      manager: (editDraft.manager || '').trim(),
      images,
      heroImage: hero,
    });
    setEditVisible(false);
  };

  const openShare = (targetType, targetId) => {
    setShareTargetType(targetType);
    setShareTargetId(targetId);
    setShareVisible(true);
  };

  useEffect(() => {
    setMoveVaultId(collection?.vaultId || null);
  }, [collection?.vaultId]);

  const renderAsset = ({ item }) => (
    <TouchableOpacity style={[styles.card, styles.assetStripe]} onPress={() => navigation.navigate('Asset', { assetId: item.id })}>
      <View style={styles.cardRow}>
        <View>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <View style={[styles.sharedDot, (item.sharedWith || []).length > 0 ? styles.sharedDotOn : styles.sharedDotOff]} />
          </View>
          <Text style={styles.cardSubtitle}>{item.type || 'Asset'} • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          {isOwner && (
            <TouchableOpacity
              style={styles.sharePill}
              onPress={(e) => {
                e.stopPropagation();
                openShare('asset', item.id);
              }}
            >
              <Text style={styles.sharePillText}>Share</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.chevron}>›</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>Loading…</Text>
      </View>
    );
  }

  const header = (
    <>
      <LambHeader />
      <BackButton />
      <View style={styles.headerArea}>
      <View style={styles.headerSection}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{collection?.name || 'Collection'}</Text>
        </View>
        <TouchableOpacity style={styles.infoButton} onPress={() => setInfoVisible(true)}>
          <Text style={styles.infoButtonText}>ℹ</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.subtitleDim, role === 'owner' ? styles.visuallyHidden : null]}>{role ? role : 'Shared'}</Text>
      {isOwner && (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.primaryButton, styles.actionButton]} onPress={openEditModal}>
            <Text style={styles.primaryButtonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.shareButton, styles.actionButton]} onPress={() => openShare('collection', collectionId)}>
            <Text style={styles.secondaryButtonText}>Share</Text>
          </TouchableOpacity>
          {canMove && (
            <TouchableOpacity
              style={[styles.moveButton, styles.actionButton]}
              onPress={() => setShowMoveBox(!showMoveBox)}
            >
              <Text style={styles.secondaryButtonText}>Move</Text>
            </TouchableOpacity>
          )}
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
      <View style={styles.divider} />
      <View style={styles.createRow}>
        <TextInput
          style={styles.input}
          placeholder="New asset title"
          placeholderTextColor="#80869b"
          value={newTitle}
          onChangeText={(text) => setNewTitle(limit20(text))}
        />
        <TouchableOpacity
          style={[styles.addButton, !canCreate && styles.buttonDisabled]}
          onPress={() => {
            if (!canCreate) return Alert.alert('No permission to add assets');
              const title = limit20(newTitle.trim());
              if (!title) return;
              addAsset({ vaultId: collection?.vaultId, collectionId, title });
            setNewTitle('');
          }}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      {showMoveBox && canMove && (
        <View style={styles.moveBox}>
          <Text style={styles.sectionLabel}>Move Collection</Text>
          <Text style={styles.helper}>Select a destination vault:</Text>
          <TouchableOpacity
            style={styles.dropdownButton}
            onPress={() => setDropdownOpen(!dropdownOpen)}
          >
            <Text style={styles.dropdownButtonText}>
              {moveVaultId ? ownerVaults.find(v => v.id === moveVaultId)?.name || 'Select vault...' : 'Select vault...'}
            </Text>
            <Text style={styles.dropdownArrow}>{dropdownOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {dropdownOpen && (
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
                ownerVaults.map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.dropdownItem, moveVaultId === v.id && styles.dropdownItemActive]}
                    onPress={() => {
                      setMoveVaultId(v.id);
                      setDropdownOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{v.name || v.id}</Text>
                    {moveVaultId === v.id && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          )}
          <TouchableOpacity
            style={[styles.button, !moveVaultId && styles.buttonDisabled]}
            disabled={!moveVaultId}
            onPress={() => {
              if (!moveVaultId) return Alert.alert('Select a vault');
              moveCollection({ collectionId, targetVaultId: moveVaultId });
              Alert.alert('Moved');
              setShowMoveBox(false);
              setDropdownOpen(false);
            }}
          >
            <Text style={styles.buttonText}>Move</Text>
          </TouchableOpacity>
        </View>
      )}
      </View>
    </>
  );

  return (
    <>
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Collection</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalLabel}>Title</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Collection title"
                placeholderTextColor="#80869b"
                  value={editDraft.name}
                  onChangeText={(name) => setEditDraft((prev) => ({ ...prev, name: limit20(name) }))}
              />

              <Text style={styles.modalLabel}>Manager</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Manager"
                placeholderTextColor="#80869b"
                value={editDraft.manager}
                onChangeText={(manager) => setEditDraft((prev) => ({ ...prev, manager }))}
              />

              <Text style={styles.modalLabel}>Description</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextarea]}
                placeholder="Description"
                placeholderTextColor="#80869b"
                value={editDraft.description}
                onChangeText={(description) => setEditDraft((prev) => ({ ...prev, description }))}
                multiline
              />

                <View style={[styles.mediaCard, { marginTop: 12 }]}>
                  <View style={styles.mediaHeader}>
                    <Text style={styles.sectionLabel}>Images</Text>
                  <TouchableOpacity style={styles.addImageButton} onPress={addImagesToDraft}>
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
                            <TouchableOpacity style={styles.removeImageBtn} onPress={() => removeDraftImage(img)}>
                              <Text style={styles.removeImageBtnText}>✕</Text>
                            </TouchableOpacity>
                            {!isHeroImg && (
                              <TouchableOpacity style={styles.makeHeroBtn} onPress={() => setDraftHero(img)}>
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
              <TouchableOpacity style={styles.primaryButton} onPress={handleSaveDraft}>
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
              {isOwner && (
                <TouchableOpacity
                  style={styles.dangerButton}
                  onPress={() => {
                    Alert.alert('Delete Collection?', 'This action cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        onPress: () => {
                          setEditVisible(false);
                          deleteCollection(collectionId);
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
      
      <ScrollView contentContainerStyle={styles.container}>
        {header}
        {/* Images section, actions, etc. remain unchanged */}
        {/* Render assets */}
        {collectionAssets.length === 0 ? (
          <Text style={styles.subtitle}>No assets yet.</Text>
        ) : (
          collectionAssets.map((asset, idx) => (
            <View key={asset.id}>
              {renderAsset({ item: asset })}
              {idx < collectionAssets.length - 1 && <View style={styles.separator} />}
            </View>
          ))
        )}
        <ShareModal
          visible={shareVisible}
          onClose={() => { setShareVisible(false); setShareTargetId(null); setShareTargetType(null); }}
          targetType={shareTargetType || 'collection'}
          targetId={shareTargetId || collectionId}
        />
      </ScrollView>
      {collection && (
        <Modal
          visible={infoVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setInfoVisible(false)}
        >
            <TouchableOpacity style={styles.modalOverlay} onPress={() => setInfoVisible(false)} activeOpacity={1}>
              <View style={styles.infoModalContent}>
                <Text style={styles.infoModalTitle}>Information</Text>
                <View style={styles.infoModalMetadata}>
                  <Text style={styles.infoModalRow}>
                    <Text style={styles.infoModalLabel}>Created:</Text>{' '}
                    {new Date(collection.createdAt).toLocaleDateString()}
                  </Text>
                  <Text style={styles.infoModalRow}>
                    <Text style={styles.infoModalLabel}>Viewed:</Text>{' '}
                    {new Date(collection.viewedAt).toLocaleDateString()}
                  </Text>
                  <Text style={styles.infoModalRow}>
                    <Text style={styles.infoModalLabel}>Edited:</Text>{' '}
                    {new Date(collection.editedAt).toLocaleDateString()}
                  </Text>
                  <Text style={styles.infoModalRow}>
                    <Text style={styles.infoModalLabel}>Manager:</Text>{' '}
                    <Text style={styles.visuallyHidden}>{users.find((u) => u.id === collection.ownerId)?.username || 'Unknown'}</Text>
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
        </Modal>
      )}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={[styles.modalCard, { padding: 0 }]} activeOpacity={1} onPress={() => setPreviewImage(null)}>
            {previewImage ? (
              <Image source={{ uri: previewImage }} style={{ width: '100%', height: 360, borderRadius: 12 }} resizeMode="contain" />
            ) : null}
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerArea: { gap: 12 },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', lineHeight: 32 },
  infoButton: { padding: 8, marginLeft: 8 },
  infoButtonText: { color: '#e5e7f0', fontSize: 20, fontWeight: '700' },
  infoModalContent: { backgroundColor: '#1a1b24', borderRadius: 12, padding: 16, marginHorizontal: 16, maxWidth: '90%' },
  infoModalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  infoModalMetadata: { gap: 8 },
  infoModalRow: { color: '#e5e7f0', fontSize: 13, lineHeight: 18 },
  infoModalLabel: { color: '#9aa1b5', fontWeight: '600' },
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
  subtitle: { color: '#c5c5d0' },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  assetStripe: { borderLeftWidth: 4, borderLeftColor: '#16a34a', paddingLeft: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sharePill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#16a34a' },
  sharePillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  sharedDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#0f172a' },
  sharedDotOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  sharedDotOff: { backgroundColor: '#475569', borderColor: '#475569' },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },
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
  separator: { height: 12 },
  divider: { height: 1, backgroundColor: '#1f2738', marginVertical: 12 },
  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eab308' },
  buttonDisabled: { backgroundColor: '#1f2738' },
  buttonText: { color: '#fff', fontWeight: '700' },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
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
  modalInput: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  modalTextarea: { minHeight: 90, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
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
