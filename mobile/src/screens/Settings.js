import React from 'react';
import { StyleSheet, View, Text, ScrollView } from 'react-native';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';
import SubscriptionManager from '../components/SubscriptionManager';

export default function Membership() {

  return (
    <View style={styles.wrapper}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <BackButton />
          <LambHeader />
        </View>
        <Text style={styles.title}>Membership</Text>
        
        <SubscriptionManager />

        <View style={styles.spacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12, paddingBottom: 100 },
  headerRow: { position: 'relative', width: '100%' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },
  spacer: { height: 40 },
});
