import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View, Text, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';

export default function Vault({ navigation, route }) {
  const { vaultId } = route.params || {};
  const { loading, vaults, collections, addCollection, currentUser, getRoleForVault, canCreateCollectionsInVault, users, deleteVault } = useData();
  const [newName, setNewName] = useState('');
  const [shareVisible, setShareVisible] = useState(false);
  const [shareTargetType, setShareTargetType] = useState(null);
  const [shareTargetId, setShareTargetId] = useState(null);

  const vault = useMemo(() => vaults.find((v) => v.id === vaultId), [vaultId, vaults]);
  const vaultCollections = useMemo(() => collections.filter((c) => c.vaultId === vaultId), [collections, vaultId]);
  const role = getRoleForVault(vaultId, currentUser?.id);
  const isOwner = role === 'owner';
  const canCreate = canCreateCollectionsInVault(vaultId, currentUser?.id);

  const openShare = (targetType, targetId) => {
    setShareTargetType(targetType);
    setShareTargetId(targetId);
    setShareVisible(true);
  };

  const renderCollection = ({ item }) => (
    <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Collection', { collectionId: item.id })}>
      <View style={styles.cardRow}>
        <View>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardSubtitle}>Collection • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          <View style={[styles.typeBadge, styles.collectionBadge]}>
            <Text style={styles.badgeText}>Collection</Text>
          </View>
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
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.title}>{vault?.name || 'Vault'}</Text>
        <View style={[styles.typeBadge, styles.vaultBadge]}>
          <Text style={styles.badgeText}>Vault</Text>
        </View>
      </View>
      <Text style={styles.subtitleDim}>{role ? role : 'Shared'}</Text>
      {vault && (
        <View style={styles.metadataSection}>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Created:</Text>{' '}
            {new Date(vault.createdAt).toLocaleDateString()}
          </Text>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Viewed:</Text>{' '}
            {new Date(vault.viewedAt).toLocaleDateString()}
          </Text>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Edited:</Text>{' '}
            {new Date(vault.editedAt).toLocaleDateString()}
          </Text>
          <Text style={styles.metadataRow}>
            <Text style={styles.metadataLabel}>Manager:</Text>{' '}
            {users.find(u => u.id === vault.ownerId)?.username || 'Unknown'}
          </Text>
        </View>
      )}
      {isOwner && (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>View / Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dangerButton}
            onPress={() => {
              Alert.alert('Delete Vault?', 'This action cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  onPress: () => {
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
        </View>
      )}
      <View style={styles.createRow}>
        <TextInput
          style={styles.input}
          placeholder="New collection name"
          placeholderTextColor="#80869b"
          value={newName}
          onChangeText={setNewName}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
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
  dangerButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#dc2626' },
  dangerButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  separator: { height: 12 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  buttonDisabled: { backgroundColor: '#1f2738' },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
});
