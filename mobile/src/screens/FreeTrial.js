import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';

export default function FreeTrial({ navigation, route }) {
  const { theme } = useData();
  const { firstName, lastName, email, username, password } = route.params || {};

  const handleContinue = () => {
    navigation.navigate('ChooseSubscription', {
      firstName,
      lastName,
      email,
      username,
      password,
    });
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}>
      <LambHeader />
      <Text style={[styles.title, { color: theme.text }]}>Free Trial</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Start with a 14-day free trial.</Text>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          You’ll choose a membership next. You must add valid payment information to start your free trial.
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          You won’t be charged until the 14-day trial ends. After that, you’ll be billed monthly on the membership you selected unless you cancel before the trial ends.
        </Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleContinue}>
        <Text style={styles.buttonText}>Continue</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={[styles.link, { color: theme.link }]}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingVertical: 24,
    paddingHorizontal: 24,
    backgroundColor: '#0b0b0f',
    gap: 16,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginTop: 12,
  },
  subtitle: {
    color: '#c5c5d0',
  },
  card: {
    backgroundColor: '#11121a',
    borderColor: '#1f2738',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  body: {
    color: '#e5e7f0',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  link: {
    color: '#9ab6ff',
    marginTop: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
