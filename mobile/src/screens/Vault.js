import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View, Text, TouchableOpacity, TextInput, Alert, Image, ScrollView, Modal } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';
import LambHeader from '../components/LambHeader';

export default function Vault({ navigation, route }) {
  const { vaultId } = route.params || {};
  const { loading, vaults, collections, addCollection, currentUser, getRoleForVault, canCreateCollectionsInVault, users, deleteVault, updateVault } = useData();
  const [newName, setNewName] = useState('');
  const [shareVisible, setShareVisible] = useState(false);
  const [shareTargetType, setShareTargetType] = useState(null);
  const [shareTargetId, setShareTargetId] = useState(null);
  const [editVisible, setEditVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [editDraft, setEditDraft] = useState({ name: '', description: '', manager: '', images: [], heroImage: '' });
  const [previewImage, setPreviewImage] = useState(null);
  const draftPreviewImages = editDraft.heroImage
    ? [editDraft.heroImage, ...(editDraft.images || []).filter((img) => img !== editDraft.heroImage)]
    : editDraft.images || [];
  const limit20 = (value = '') => value.slice(0, 20);

  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const MAX_IMAGES = 4;
  const DEFAULT_MEDIA_IMAGE = 'https://via.placeholder.com/900x600?text=Image';
  const mediaTypes = ImagePicker.MediaType?.Images || ImagePicker.MediaTypeOptions.Images;
  const trimToFour = (arr = []) => arr.filter(Boolean).slice(0, MAX_IMAGES);

  const vault = useMemo(() => vaults.find((v) => v.id === vaultId), [vaultId, vaults]);
  const vaultCollections = useMemo(() => collections.filter((c) => c.vaultId === vaultId), [collections, vaultId]);
  const role = getRoleForVault(vaultId, currentUser?.id);
  const isOwner = role === 'owner';
  const canCreate = canCreateCollectionsInVault(vaultId, currentUser?.id);
  const vaultImages = vault?.images || [];
  const heroImage = vault?.heroImage || DEFAULT_MEDIA_IMAGE;
  const previewImages = heroImage ? [heroImage, ...vaultImages.filter((img) => img !== heroImage)] : vaultImages;

  const ensureHero = (images, currentHero) => {
    if (currentHero && images.includes(currentHero)) return currentHero;
    return images[0] || DEFAULT_MEDIA_IMAGE;
  };

  useEffect(() => {
    setEditDraft({
      name: limit20(vault?.name || ''),
      description: vault?.description || '',
      manager: vault?.manager || '',
      images: trimToFour(vaultImages),
      heroImage: ensureHero(vaultImages, heroImage),
    });
  }, [vaultId, vault?.name, vault?.description, vault?.manager, heroImage, vaultImages.join(',')]);

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
    updateVault(vaultId, { images: merged, heroImage: nextHero });

    if (skipped.length) {
      Alert.alert('Skipped large files', `Images over 30MB were skipped: ${skipped.join(', ')}`);
    }
  };

  const handleSetHero = (img) => {
    if (!vault) return;
    const reordered = trimToFour([img, ...vaultImages.filter((i) => i !== img)]);
    updateVault(vaultId, { images: reordered, heroImage: img });
  };

  const handleRemoveImage = (img) => {
    if (!vault) return;
    const remaining = vaultImages.filter((i) => i !== img);
    const nextHero = ensureHero(remaining, heroImage === img ? remaining[0] : heroImage);
    updateVault(vaultId, { images: remaining, heroImage: nextHero });
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

  const handleSaveDraft = () => {
    if (!vault) return;
    const images = trimToFour(editDraft.images || []);
    const hero = ensureHero(images, editDraft.heroImage);
    updateVault(vaultId, {
      name: limit20((editDraft.name || '').trim() || vault.name || ''),
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

  const renderCollection = ({ item }) => (
    <TouchableOpacity style={[styles.card, styles.collectionStripe]} onPress={() => navigation.navigate('Collection', { collectionId: item.id })}>
      <View style={styles.cardRow}>
        <View>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <View style={[styles.sharedDot, (item.sharedWith || []).length > 0 ? styles.sharedDotOn : styles.sharedDotOff]} />
          </View>
          <Text style={styles.cardSubtitle}>Collection • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          {isOwner && (
            <TouchableOpacity
              style={styles.sharePill}
              onPress={(e) => {
                e.stopPropagation();
                openShare('collection', item.id);
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

  return (
    <>
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Edit Vault</Text>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={styles.modalLabel}>Title</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Vault title"
                    placeholderTextColor="#80869b"
                    value={editDraft.name}
                    onChangeText={(name) => setEditDraft((prev) => ({ ...prev, name: limit20(name || '') }))}
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
                        Alert.alert('Delete Vault?', 'This action cannot be undone.', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            onPress: () => {
                              setEditVisible(false);
                              deleteVault(vaultId);
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
          <View style={styles.container}>
        <LambHeader />
      <View style={styles.headerArea}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>{vault?.name || 'Vault'}</Text>
          <TouchableOpacity style={styles.infoButton} onPress={() => setInfoVisible(true)}>
            <Text style={styles.infoButtonText}>ℹ</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitleDim}>{role ? role : 'Shared'}</Text>
      </View>
      {isOwner && (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.primaryButton, styles.actionButton]} onPress={openEditModal}>
            <Text style={styles.primaryButtonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.shareButton, styles.actionButton]} onPress={() => openShare('vault', vaultId)}>
            <Text style={styles.secondaryButtonText}>Share</Text>
          </TouchableOpacity>
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
          placeholder="New collection name"
          placeholderTextColor="#80869b"
          value={newName}
          onChangeText={(text) => setNewName(limit20(text || ''))}
        />
        <TouchableOpacity
          style={[styles.addButton, !canCreate && styles.buttonDisabled]}
          onPress={() => {
            if (!canCreate) return Alert.alert('No permission to add collections');
            if (!newName.trim()) return;
            addCollection({ vaultId, name: newName.trim() });
            setNewName('');
          }}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <Text style={styles.subtitle}>Loading…</Text>
      ) : vaultCollections.length === 0 ? (
        <Text style={styles.subtitle}>No collections yet.</Text>
      ) : (
        <FlatList
          data={vaultCollections}
          keyExtractor={(c) => c.id}
          renderItem={renderCollection}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
      <ShareModal
        visible={shareVisible}
        onClose={() => { setShareVisible(false); setShareTargetId(null); setShareTargetType(null); }}
        targetType={shareTargetType || 'vault'}
        targetId={shareTargetId || vaultId}
      />
      <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setInfoVisible(false)} activeOpacity={1}>
          <View style={styles.infoModalContent}>
            <Text style={styles.infoModalTitle}>Information</Text>
            <View style={styles.infoModalMetadata}>
              <Text style={styles.infoModalRow}>
                <Text style={styles.infoModalLabel}>Created:</Text>{' '}
                {new Date(vault.createdAt).toLocaleDateString()}
              </Text>
              <Text style={styles.infoModalRow}>
                <Text style={styles.infoModalLabel}>Viewed:</Text>{' '}
                {new Date(vault.viewedAt).toLocaleDateString()}
              </Text>
              <Text style={styles.infoModalRow}>
                <Text style={styles.infoModalLabel}>Edited:</Text>{' '}
                {new Date(vault.editedAt).toLocaleDateString()}
              </Text>
              <Text style={styles.infoModalRow}>
                <Text style={styles.infoModalLabel}>Manager:</Text>{' '}
                {users.find(u => u.id === vault.ownerId)?.username || 'Unknown'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
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
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
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
  collectionStripe: { borderLeftWidth: 4, borderLeftColor: '#9333ea', paddingLeft: 12 },
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
});
