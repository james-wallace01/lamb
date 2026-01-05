import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View, Text, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';

export default function Collection({ navigation, route }) {
  const { collectionId } = route.params || {};
  const { loading, collections, assets, addAsset, currentUser, getRoleForCollection, canCreateAssetsInCollection, vaults, moveCollection, users, deleteCollection } = useData();
  const [newTitle, setNewTitle] = useState('');
  const [shareVisible, setShareVisible] = useState(false);
  const [shareTargetType, setShareTargetType] = useState(null);
  const [shareTargetId, setShareTargetId] = useState(null);
  const [moveVaultId, setMoveVaultId] = useState(collection?.vaultId || null);
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const collection = useMemo(() => collections.find((c) => c.id === collectionId), [collectionId, collections]);
  const collectionAssets = useMemo(() => assets.filter((a) => a.collectionId === collectionId), [assets, collectionId]);
  const role = getRoleForCollection(collectionId, currentUser?.id);
  const isOwner = role === 'owner';
  const canCreate = canCreateAssetsInCollection(collectionId, currentUser?.id);
  const canMove = role === 'owner' || role === 'manager';
  const ownerVaults = vaults.filter(v => v.ownerId === collection?.ownerId);

  const openShare = (targetType, targetId) => {
    setShareTargetType(targetType);
    setShareTargetId(targetId);
    setShareVisible(true);
  };

  useEffect(() => {
    setMoveVaultId(collection?.vaultId || null);
  }, [collection?.vaultId]);

  const renderAsset = ({ item }) => (
    <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Asset', { assetId: item.id })}>
      <View style={styles.cardRow}>
        <View>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardSubtitle}>{item.type || 'Asset'} • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          <View style={[styles.typeBadge, styles.assetBadge]}>
            <Text style={styles.badgeText}>Asset</Text>
          </View>
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
    <View style={styles.headerArea}>
      <View style={styles.headerSection}>
        <Text style={styles.title}>{collection?.name || 'Collection'}</Text>
        <View style={[styles.typeBadge, styles.collectionBadge]}>
          <Text style={styles.badgeText}>Collection</Text>
        </View>
      </View>
      <Text style={styles.subtitleDim}>{role ? role : 'Shared'}</Text>
      {collection && (
        <View style={styles.metadataSection}>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Created:</Text>{' '}
            {new Date(collection.createdAt).toLocaleDateString()}
          </Text>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Viewed:</Text>{' '}
            {new Date(collection.viewedAt).toLocaleDateString()}
          </Text>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Edited:</Text>{' '}
            {new Date(collection.editedAt).toLocaleDateString()}
          </Text>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Manager:</Text>{' '}
            {users.find(u => u.id === collection.ownerId)?.username || 'Unknown'}
          </Text>
        </View>
      )}
      <View style={styles.createRow}>
        <TextInput
          style={styles.input}
          placeholder="New asset title"
          placeholderTextColor="#80869b"
          value={newTitle}
          onChangeText={setNewTitle}
        />
        <TouchableOpacity
          style={[styles.addButton, !canCreate && styles.buttonDisabled]}
          onPress={() => {
            if (!canCreate) return Alert.alert('No permission to add assets');
            if (!newTitle.trim()) return;
            addAsset({ vaultId: collection?.vaultId, collectionId, title: newTitle.trim() });
            setNewTitle('');
          }}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      {isOwner && (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>View / Edit</Text>
          </TouchableOpacity>
          {canMove && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowMoveBox(!showMoveBox)}
            >
              <Text style={styles.secondaryButtonText}>Move</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.dangerButton}
            onPress={() => {
              Alert.alert('Delete Collection?', 'This action cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  onPress: () => {
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
        </View>
      )}
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
  );

  return (
    <FlatList
      data={collectionAssets}
      keyExtractor={(a) => a.id}
      renderItem={renderAsset}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={<Text style={styles.subtitle}>No assets yet.</Text>}
      contentContainerStyle={styles.container}
      ListHeaderComponent={header}
      ListFooterComponent={
        <ShareModal
          visible={shareVisible}
          onClose={() => { setShareVisible(false); setShareTargetId(null); setShareTargetType(null); }}
          targetType={shareTargetType || 'collection'}
          targetId={shareTargetId || collectionId}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerArea: { gap: 12 },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', flex: 1 },
  metadataSection: { backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, padding: 12, gap: 8 },
  metadataRow: { color: '#e5e7f0', fontSize: 13 },
  metadataLabel: { fontWeight: '700', color: '#9aa1b5' },
  subtitleDim: { color: '#7d8497' },
  subtitle: { color: '#c5c5d0' },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sharePill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: '#172447', borderWidth: 1, borderColor: '#2563eb' },
  sharePillText: { color: '#cde1ff', fontWeight: '700', fontSize: 13 },
  typeBadge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1 },
  vaultBadge: { backgroundColor: '#172466', borderColor: '#2563eb' },
  collectionBadge: { backgroundColor: '#552e9f', borderColor: '#9333ea' },
  assetBadge: { backgroundColor: '#1b6b2e', borderColor: '#16a34a' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primaryButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondaryButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eab308' },
  secondaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  dangerButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#dc2626' },
  dangerButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  separator: { height: 12 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
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
});
