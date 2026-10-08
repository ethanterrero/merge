import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

const milestones = ['Create your commute', 'Discover compatible routes', 'Invite commuters', 'Confirm seats and cargo'];

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>merge.</Text>
        <Text style={styles.heading}>Find your way together.</Text>
        <Text style={styles.description}>A better Bay Bridge commute starts with people already going your way.</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your morning commute</Text>
          <Text style={styles.route}>East Bay → San Francisco</Text>
          <Text style={styles.note}>Route discovery is coming next. This is an initial app shell, not a live booking service.</Text>
        </View>
        <Text style={styles.section}>How Merge works</Text>
        {milestones.map((step, i) => <View key={step} style={styles.step}><Text style={styles.stepText}>{i + 1}. {step}</Text></View>)}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8F7' },
  content: { padding: 24, gap: 18 },
  brand: { fontSize: 34, fontWeight: '800', color: '#173B36' },
  heading: { fontSize: 28, fontWeight: '700', color: '#132B28' },
  description: { fontSize: 16, lineHeight: 24, color: '#536B66' },
  card: { padding: 22, borderRadius: 18, backgroundColor: '#E1EEE9', gap: 12 },
  cardTitle: { fontSize: 14, color: '#46635C' },
  route: { fontSize: 20, fontWeight: '700', color: '#173B36' },
  note: { fontSize: 13, lineHeight: 19, color: '#536B66' },
  section: { fontSize: 18, fontWeight: '700', color: '#173B36' },
  step: { padding: 16, backgroundColor: '#FFFFFF', borderRadius: 12 },
  stepText: { fontSize: 15, color: '#173B36' },
});
