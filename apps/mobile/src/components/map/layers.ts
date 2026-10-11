// MapLibre layer specs for the area circles, shared by the native and web
// maps. Pure (types only from maplibre-gl), so `npm test` runs it under Node.

import type { ExpressionSpecification, FillLayerSpecification, LineLayerSpecification } from 'maplibre-gl';

export const AREA_SOURCE_ID = 'merge-areas';

/** The layer a tap on an area hits. */
export const AREA_FILL_LAYER_ID = 'merge-area-fill';

export type AreaLayer = Omit<FillLayerSpecification, 'source'> | Omit<LineLayerSpecification, 'source'>;

/** Fill, solid outline and dashed outline. Line dashes can't be data-driven, hence two line layers. */
export function areaLayers(palette: { primary: string; deep: string }): AreaLayer[] {
  const toneColor: ExpressionSpecification = ['match', ['get', 'tone'], 'deep', palette.deep, palette.primary];
  const lineWidth: ExpressionSpecification = ['case', ['get', 'emphasis'], 3, 2];
  const lineOpacity: ExpressionSpecification = ['case', ['get', 'emphasis'], 1, 0.55];
  return [
    {
      id: AREA_FILL_LAYER_ID,
      type: 'fill',
      paint: {
        'fill-color': toneColor,
        'fill-opacity': ['case', ['==', ['get', 'tone'], 'deep'], 0.12, 0.2],
      },
    },
    {
      id: 'merge-area-line',
      type: 'line',
      filter: ['!=', ['get', 'dashed'], true],
      paint: { 'line-color': toneColor, 'line-width': lineWidth, 'line-opacity': lineOpacity },
    },
    {
      id: 'merge-area-line-dashed',
      type: 'line',
      filter: ['==', ['get', 'dashed'], true],
      paint: { 'line-color': toneColor, 'line-width': lineWidth, 'line-opacity': lineOpacity, 'line-dasharray': [2, 1.5] },
    },
  ];
}
