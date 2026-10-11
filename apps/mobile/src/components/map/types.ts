import type { ReactElement } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { MapArea } from './areas';
import type { Insets } from './projection';

/** An area plus what the screen hangs on it. */
export type AreaMapItem = MapArea & {
  /** Drawn at the area center, for example the member's initials. */
  badge?: ReactElement;
  onPress?: () => void;
  /** Read by screen readers for the tappable badge. */
  accessibilityLabel?: string;
};

export type AreaMapProps = {
  /** Generalized areas only. There is deliberately no pin or point prop. */
  areas: AreaMapItem[];
  style?: StyleProp<ViewStyle>;
  /**
   * Parts of the map covered by other UI (a header, a bottom sheet). Areas are
   * fitted inside, and the attribution sits just above `bottom`.
   */
  insets?: Partial<Insets>;
  /** Extra room kept clear only when fitting the areas, for example under a floating tag. */
  fitPadding?: Partial<Insets>;
  /** Smallest box (meters a side) the camera shows, so one area isn't street level. */
  minSpanM?: number;
  /** False for small preview maps inside scroll views: no pan or zoom. */
  interactive?: boolean;
  accessibilityLabel?: string;
};
