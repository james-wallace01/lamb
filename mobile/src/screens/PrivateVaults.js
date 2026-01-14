import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { firestore } from '../firebase';
import { runWithMinimumDuration } from '../utils/timing';

export default function PrivateVaults({ navigation }) {
  const { loading, vaults, currentUser, addVault, refreshData, theme, vaultMemberships, backendReachable, showAlert } = useData();
  const Alert = { alert: showAlert };
  const isOffline = backendReachable === false;
  const [newVaultName, setNewVaultName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);
  const [remoteOwnedVaults, setRemoteOwnedVaults] = useState([]);

  const limit35 = (value = '') => String(value).slice(0, 35);

  const uid = currentUser?.id ? String(currentUser.id) : null;

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
    const combined = [...(vaults || []), ...(remoteOwnedVaults || [])];
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
  }, [vaults, remoteOwnedVaults, uid]);

  const getDelegateCountForVault = (vaultId) => {
    const vId = String(vaultId);
    return (vaultMemberships || []).filter((m) => m?.vault_id === vId && m?.status === 'ACTIVE' && m?.role === 'DELEGATE').length;
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await loadOwnedVaults();
        await refreshData?.();
      }, 800);
    } finally {
      setRefreshing(false);
    }
  };

  const renderVault = (item) => (
    <TouchableOpacity
      style={[styles.card, styles.vaultAccent, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={() => navigation.navigate('Vault', { vaultId: item.id })}
    >
      <View style={styles.cardRow}>
        <View>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name}</Text>
            <View
              style={[
                styles.sharedDot,
                currentUser?.id != null && item?.ownerId != null && String(item.ownerId) === String(currentUser.id) && getDelegateCountForVault(item.id) > 0
                  ? styles.sharedDotOn
                  : styles.sharedDotOff,
              ]}
            />
          </View>
          <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>Vault • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}> 
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
        bounces
        alwaysBounceVertical
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.isDark ? '#fff' : '#111827'}
            progressViewOffset={24}
          />
        }
      >
        <LambHeader />
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.text }]}>Private Vaults</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Create a vault</Text>
        </View>
        <View style={styles.createRow}>
          <TextInput
            style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
            placeholder="New vault name"
            placeholderTextColor={theme.placeholder}
            value={newVaultName}
            onChangeText={(text) => setNewVaultName(limit35(text || ''))}
          />
          <TouchableOpacity
            style={[styles.addButton, isOffline && styles.buttonDisabled]}
            disabled={isOffline}
            onPress={() => {
              if (!newVaultName.trim()) return;
              (async () => {
                const res = await addVault({ name: newVaultName.trim() });
                if (!res || res.ok === false) {
                  Alert.alert('Create vault failed', res?.message || 'Unable to create vault');
                  return;
                }
                setNewVaultName('');
              })();
            }}
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>My Vaults</Text>
        </View>

        {loading ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Loading…</Text>
        ) : myVaults.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No vaults yet.</Text>
        ) : (
          myVaults.map((v) => (
            <View key={v.id} style={styles.sectionItem}>
              {renderVault(v)}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },

  sectionHeader: { marginTop: 8, marginBottom: 8 },
  sectionTitle: { color: '#e5e7f0', fontSize: 18, fontWeight: '700' },
  sectionItem: { marginBottom: 10 },

  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  vaultAccent: { borderLeftWidth: 4, borderLeftColor: '#2563eb', paddingLeft: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  sharedDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#0f172a' },
  sharedDotOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  sharedDotOff: { backgroundColor: '#475569', borderColor: '#475569' },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },
});
