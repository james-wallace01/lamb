import React, { useMemo, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';

export default function Asset({ route, navigation }) {
  const { assetId } = route.params || {};
  const { loading, assets, users, currentUser, updateAsset, moveAsset, vaults, collections, getRoleForAsset, deleteAsset } = useData();

  const asset = useMemo(() => assets.find((a) => a.id === assetId), [assetId, assets]);
  const owner = useMemo(() => users.find((u) => u.id === asset?.ownerId), [users, asset]);
  const [draft, setDraft] = useState(() => asset || {});
  const [moveVaultId, setMoveVaultId] = useState(asset?.vaultId || null);
  const [moveCollectionId, setMoveCollectionId] = useState(asset?.collectionId || null);
  const [showShare, setShowShare] = useState(false);
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState(false);
  const role = getRoleForAsset(assetId, currentUser?.id);
  const canEdit = role === 'owner' || role === 'editor' || role === 'manager';
  const canMove = role === 'owner' || role === 'manager';
  const canShare = role === 'owner' || role === 'manager';

  if (loading) return <View style={styles.container}><Text style={styles.subtitle}>Loading…</Text></View>;
  if (!asset) return <View style={styles.container}><Text style={styles.subtitle}>Asset not found.</Text></View>;

  const handleSave = () => {
    if (!canEdit) return;
    updateAsset(asset.id, {
      title: draft.title || 'Untitled',
      type: draft.type || '',
      category: draft.category || '',
      quantity: Number(draft.quantity) || 1,
      value: draft.value,
      manager: draft.manager,
    });
    Alert.alert('Saved');
  };

  const handleMove = () => {
    if (!canMove) return;
    if (!moveVaultId || !moveCollectionId) {
      Alert.alert('Select vault and collection');
      return;
    }
    moveAsset({ assetId: asset.id, targetVaultId: moveVaultId, targetCollectionId: moveCollectionId });
    navigation.goBack();
  };

  const ownerVaults = vaults.filter(v => v.ownerId === asset.ownerId);
  const ownerCollections = collections.filter(c => c.ownerId === asset.ownerId && c.vaultId === moveVaultId);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerSection}>
        <View>
          <Text style={styles.title}>{asset.title}</Text>
        </View>
        <View style={[styles.typeBadge, styles.assetBadge]}>
          <Text style={styles.badgeText}>Asset</Text>
        </View>
      </View>
      <Text style={styles.subtitle}>{asset.type || 'Asset'} • {asset.category || 'Uncategorized'}</Text>
      <Text style={styles.roleBadge}>Role: {role || 'viewer'}</Text>
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
            ${asset.value ? parseFloat(asset.value).toFixed(2) : '0.00'}
          </Text>
        </View>
      )}
      <Text style={styles.field}>Owner: {owner ? `${owner.firstName} ${owner.lastName}` : 'Unknown'}</Text>
      <Text style={styles.field}>Manager: {asset.manager || owner?.username || 'Unassigned'}</Text>

      <TextInput style={styles.input} placeholder="Title" placeholderTextColor="#80869b" value={draft.title || ''} onChangeText={(v) => setDraft({ ...draft, title: v })} editable={canEdit} />
      <TextInput style={styles.input} placeholder="Type" placeholderTextColor="#80869b" value={draft.type || ''} onChangeText={(v) => setDraft({ ...draft, type: v })} editable={canEdit} />
      <TextInput style={styles.input} placeholder="Category" placeholderTextColor="#80869b" value={draft.category || ''} onChangeText={(v) => setDraft({ ...draft, category: v })} editable={canEdit} />
      <TextInput style={styles.input} placeholder="Quantity" placeholderTextColor="#80869b" keyboardType="numeric" value={String(draft.quantity ?? 1)} onChangeText={(v) => setDraft({ ...draft, quantity: v })} editable={canEdit} />
      <TextInput style={styles.input} placeholder="Value" placeholderTextColor="#80869b" keyboardType="numeric" value={draft.value ? String(draft.value) : ''} onChangeText={(v) => setDraft({ ...draft, value: v })} editable={canEdit} />
      <TextInput style={styles.input} placeholder="Manager" placeholderTextColor="#80869b" value={draft.manager || ''} onChangeText={(v) => setDraft({ ...draft, manager: v })} editable={canEdit} />

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.primaryButton, !canEdit && styles.buttonDisabled]} disabled={!canEdit} onPress={handleSave}>
          <Text style={styles.primaryButtonText}>View / Edit</Text>
        </TouchableOpacity>
        {canMove && (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowMoveBox(!showMoveBox)}>
            <Text style={styles.secondaryButtonText}>Move</Text>
          </TouchableOpacity>
        )}
        {canMove && (
          <TouchableOpacity
            style={styles.dangerButton}
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

      {showMoveBox && canMove && (
        <View style={styles.moveBox}>
          <Text style={styles.sectionLabel}>Move Asset</Text>
          <Text style={styles.helper}>Select a vault:</Text>
          <TouchableOpacity
            style={styles.dropdownButton}
            onPress={() => setVaultDropdownOpen(!vaultDropdownOpen)}
          >
            <Text style={styles.dropdownButtonText}>
              {moveVaultId ? ownerVaults.find(v => v.id === moveVaultId)?.name || 'Select vault...' : 'Select vault...'}
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
                ownerVaults.map(v => (
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
              {moveCollectionId ? ownerCollections.find(c => c.id === moveCollectionId)?.name || 'Select collection...' : 'Select collection...'}
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
                ownerCollections.map(c => (
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
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', flex: 1 },
  metadataSection: { backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, padding: 12, gap: 8 },
  metadataRow: { color: '#e5e7f0', fontSize: 13 },
  metadataLabel: { fontWeight: '700', color: '#9aa1b5' },
  typeBadge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1 },
  assetBadge: { backgroundColor: '#1b6b2e', borderColor: '#16a34a' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  subtitle: { color: '#c5c5d0' },
  roleBadge: { color: '#9aa1b5', fontSize: 13 },
  field: { color: '#e5e7f0', fontSize: 15 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primaryButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondaryButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eab308' },
  secondaryButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  dangerButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#dc2626' },
  dangerButtonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  buttonDisabled: { backgroundColor: '#1f2738' },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
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
});
