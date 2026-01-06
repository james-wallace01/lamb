import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, Alert, Image } from 'react-native';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';
import LambHeader from '../components/LambHeader';

export default function Home({ navigation }) {
  const { loading, vaults, currentUser, addVault, logout } = useData();
  const [newVaultName, setNewVaultName] = useState('');
  const [shareVaultId, setShareVaultId] = useState(null);
  const scrollRef = useRef(null);
  const [mySectionY, setMySectionY] = useState(0);
  const [sharedSectionY, setSharedSectionY] = useState(0);

  const myVaults = useMemo(() => vaults.filter((v) => v.ownerId === currentUser?.id), [vaults, currentUser]);
  const sharedVaults = useMemo(() => vaults.filter((v) => v.ownerId !== currentUser?.id && (v.sharedWith || []).some(sw => sw.userId === currentUser?.id)), [vaults, currentUser]);

  const renderVault = (item) => (
    <TouchableOpacity style={[styles.card, styles.vaultStripe]} onPress={() => navigation.navigate('Vault', { vaultId: item.id })}>
      <View style={styles.cardRow}>
        <View>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <View style={[styles.sharedDot, (item.sharedWith || []).length > 0 ? styles.sharedDotOn : styles.sharedDotOff]} />
          </View>
          <Text style={styles.cardSubtitle}>Vault • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          {item.ownerId === currentUser?.id && (
            <TouchableOpacity
              style={styles.sharePill}
              onPress={(e) => {
                e.stopPropagation();
                setShareVaultId(item.id);
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
        <LambHeader />
        <View style={styles.headerRow}>
          <Text style={styles.title}>Home</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
              {currentUser?.profileImage ? (
                <Image source={{ uri: currentUser.profileImage }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarFallbackText}>?</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={logout}>
              <Text style={styles.secondaryText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quickCard} onPress={() => scrollRef.current?.scrollTo({ y: mySectionY, animated: true })}>
            <Text style={styles.quickTitle}>My Vaults</Text>
            <Text style={styles.quickMeta}>{myVaults.length} total</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={() => scrollRef.current?.scrollTo({ y: sharedSectionY, animated: true })}>
            <Text style={styles.quickTitle}>Shared Vaults</Text>
            <Text style={styles.quickMeta}>{sharedVaults.length} total</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.quickTitle}>Settings</Text>
            <Text style={styles.quickMeta}>Preferences</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.quickTitle}>Profile</Text>
            <Text style={styles.quickMeta}>Account</Text>
          </TouchableOpacity>
        </View>
      {loading ? (
        <Text style={styles.subtitle}>Loading…</Text>
      ) : (
          <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollGap}>
            <View onLayout={(e) => setMySectionY(e.nativeEvent.layout.y)}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Vaults</Text>
            </View>
            <View style={styles.createRow}>
              <TextInput
                style={styles.input}
                placeholder="New vault name"
                placeholderTextColor="#80869b"
                value={newVaultName}
                onChangeText={setNewVaultName}
              />
              <TouchableOpacity style={styles.addButton} onPress={() => {
                if (!newVaultName.trim()) return;
                addVault({ name: newVaultName.trim() });
                setNewVaultName('');
              }}>
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
              {myVaults.length === 0 ? (
                <Text style={styles.subtitle}>No vaults yet.</Text>
              ) : (
                myVaults.map((v) => (
                  <View key={v.id} style={styles.sectionItem}>
                    {renderVault(v)}
                  </View>
                ))
              )}
          </View>

            <View onLayout={(e) => setSharedSectionY(e.nativeEvent.layout.y)}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Shared Vaults</Text>
            </View>
              {sharedVaults.length === 0 ? (
                <Text style={styles.subtitle}>No shared vaults.</Text>
              ) : (
                sharedVaults.map((v) => (
                  <View key={v.id} style={styles.sectionItem}>
                    {renderVault(v)}
                  </View>
                ))
              )}
          </View>

        </ScrollView>
      )}
        <ShareModal visible={!!shareVaultId} onClose={() => setShareVaultId(null)} targetType="vault" targetId={shareVaultId} />
      </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1f2738' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: '#9aa1b5', fontWeight: '700' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  quickCard: { flexBasis: '48%', padding: 12, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', gap: 4 },
  quickTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16 },
  quickMeta: { color: '#9aa1b5', fontSize: 12 },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  vaultStripe: { borderLeftWidth: 4, borderLeftColor: '#2563eb', paddingLeft: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  sharedDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#0f172a' },
  sharedDotOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  sharedDotOff: { backgroundColor: '#475569', borderColor: '#475569' },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },
  separator: { height: 12 },
  secondaryButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#26344a', backgroundColor: '#1b2535' },
  secondaryText: { color: '#d3dcf2', fontWeight: '700' },
  sharePill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#16a34a' },
  sharePillText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  scrollGap: { gap: 16 },
  sectionHeader: { marginTop: 8, marginBottom: 8 },
  sectionTitle: { color: '#e5e7f0', fontSize: 18, fontWeight: '700' },
  sectionItem: { marginBottom: 10 },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
});
