// Public API of the data layer (docs/superpowers/specs/2026-10-10-data-layer-design.md).
// Screens import from here or from a feature entry. Tests never import this file:
// it pulls in React Native through backend.ts.
//
// Append-only: each wiring task adds one `export * from './<feature>';` line at
// the end. Export names must be unique across features (TS2308 catches clashes).

export * from './types';
export {
  GENERIC_ERROR,
  OFFLINE_ERROR,
  RATE_LIMITED_ERROR,
  SESSION_ENDED_ERROR,
  settle,
  toDataError,
  type ErrorOverrides,
} from './errors';
export { findById, mockResult, type MockOptions } from './mockUtil';
export { queryStore, useMutation, useQuery, type MutationHandle, type QueryOptions } from './hooks';
export {
  defineBackends,
  useBackendApi,
  useDataContext,
  useDataMutation,
  useDataQuery,
  type Backends,
  type DataContext,
} from './backend';

export * from './profile';
