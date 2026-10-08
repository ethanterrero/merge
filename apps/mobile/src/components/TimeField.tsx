import React, { useState } from 'react';
import { FlatList, Modal, Platform, Pressable, SafeAreaView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { colors, radius, space, TOUCH, type } from '../theme';
import { SLOT_STEP_MINUTES, dateToDeparture, departureSlots, departureToDate, slotsWith } from '../lib/timeSlots';
import { Button } from './Button';
import { Icon } from './Icon';

type Props = {
  /** Caption above the value, e.g. 'Leave around'. Also the picker's title. */
  label: string;
  /** A picker time like '7:45 AM'. */
  value: string;
  onChange: (value: string) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * A tappable tile showing a time. Tapping opens the system time picker on
 * Android, a spinner in a bottom sheet on iOS, and a list of 5-minute morning
 * slots on the web build (which has no native picker). Times move in 5-minute
 * steps and come back in the same '7:45 AM' format.
 */
export function TimeField({ label, value, onChange, style }: Props) {
  const [open, setOpen] = useState(false);

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: departureToDate(value, new Date()),
        mode: 'time',
        is24Hour: false,
        minuteInterval: SLOT_STEP_MINUTES,
        onChange: (event, date) => {
          if (event.type === 'set' && date) onChange(dateToDeparture(date));
        },
      });
    } else {
      setOpen(true);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
        accessibilityHint="Opens a time picker"
        onPress={openPicker}
        style={({ pressed }) => [styles.tile, style, pressed && styles.tilePressed]}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
        <View style={styles.valueRow}>
          <Text style={type.stat}>{value}</Text>
          <Icon name="time" size={18} color={colors.accent} />
        </View>
      </Pressable>
      {Platform.OS === 'android' ? null : (
        <TimeSheet
          visible={open}
          title={label}
          value={value}
          onClose={() => setOpen(false)}
          onPick={(picked) => {
            setOpen(false);
            if (picked !== value) onChange(picked);
          }}
        />
      )}
    </>
  );
}

function TimeSheet({
  visible,
  title,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onPick: (value: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close time picker" />
      <View style={styles.sheet} accessibilityViewIsModal>
        <SafeAreaView>
          <View style={styles.sheetBody}>
            <Text style={type.heading} accessibilityRole="header">
              {title}
            </Text>
            {Platform.OS === 'web' ? (
              <SlotList value={value} onPick={onPick} onCancel={onClose} />
            ) : (
              // Mounted only while visible, so each opening starts from the saved value.
              visible && <SpinnerPicker title={title} value={value} onPick={onPick} onCancel={onClose} />
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** iOS: the system wheel, committed with Done. */
function SpinnerPicker({ title, value, onPick, onCancel }: { title: string; value: string; onPick: (v: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(() => departureToDate(value, new Date()));
  return (
    <>
      <DateTimePicker
        value={draft}
        mode="time"
        display="spinner"
        minuteInterval={SLOT_STEP_MINUTES}
        themeVariant="light"
        textColor={colors.textPrimary}
        accessibilityLabel={title}
        onChange={(_event, date) => {
          if (date) setDraft(date);
        }}
        style={styles.spinner}
      />
      <View style={styles.actions}>
        <Button label="Cancel" variant="secondary" size="md" style={{ flex: 1 }} onPress={onCancel} />
        <Button label="Done" size="md" style={{ flex: 1 }} onPress={() => onPick(dateToDeparture(draft))} />
      </View>
    </>
  );
}

const SLOT_HEIGHT = TOUCH + space.xs;
const MORNING_SLOTS = departureSlots();

/** Web: a scrollable list of 5-minute morning slots. Tapping one picks it. */
function SlotList({ value, onPick, onCancel }: { value: string; onPick: (v: string) => void; onCancel: () => void }) {
  const slots = slotsWith(MORNING_SLOTS, value);
  const selectedIndex = slots.indexOf(value);
  return (
    <>
      <FlatList
        data={slots}
        keyExtractor={(slot) => slot}
        style={styles.slotList}
        getItemLayout={(_data, index) => ({ length: SLOT_HEIGHT, offset: SLOT_HEIGHT * index, index })}
        initialScrollIndex={Math.max(0, selectedIndex - 2)}
        renderItem={({ item }) => {
          const selected = item === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={item}
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.slot, selected && styles.slotSelected, pressed && !selected && styles.slotPressed]}
            >
              <Text style={[type.subheading, { color: selected ? colors.deep : colors.textPrimary }]}>{item}</Text>
              {selected ? <Icon name="checkmark" size={20} color={colors.primary} /> : null}
            </Pressable>
          );
        }}
      />
      <Button label="Cancel" variant="secondary" size="md" onPress={onCancel} />
    </>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: 14, gap: 2, minHeight: TOUCH },
  tilePressed: { backgroundColor: colors.background },
  valueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  scrim: { flex: 1, backgroundColor: colors.maroonZone },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
  sheetBody: { padding: space.xl, gap: space.md },
  spinner: { alignSelf: 'stretch' },
  actions: { flexDirection: 'row', gap: space.md },
  slotList: { maxHeight: SLOT_HEIGHT * 6 },
  slot: {
    height: TOUCH,
    marginBottom: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slotSelected: { backgroundColor: colors.tint },
  slotPressed: { backgroundColor: colors.background },
});
