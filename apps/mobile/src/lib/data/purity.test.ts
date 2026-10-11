// Enforces the data layer's purity rule (spec: "Purity enforcement").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const DATA_DIR = __dirname;
const SRC_DIR = resolve(DATA_DIR, '../..');
const SUPABASE_FILE = resolve(SRC_DIR, 'lib/supabase');
const STATE_DIR = resolve(SRC_DIR, 'state');
const CORE_BINDINGS = ['hooks', 'backend', 'index'];
const PLATFORM_PACKAGE = /^(react|react-native|react-native-.+|expo|expo-.+|@expo\/.+)$/;

type ImportRef = { specifier: string; typeOnly: boolean };

function importsOf(source: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const fromClause = /^\s*(?:import|export)\s+(type\s+)?([^;=()]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of source.matchAll(fromClause)) {
    const clause = m[2].trim();
    const braces = /^\{([^}]*)\}$/.exec(clause);
    const allInlineTypes =
      braces !== null &&
      braces[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .every((part) => part.startsWith('type '));
    refs.push({ specifier: m[3], typeOnly: Boolean(m[1]) || allInlineTypes });
  }
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) refs.push({ specifier: m[1], typeOnly: false });
  return refs;
}

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listTs(path);
    return name.endsWith('.ts') || name.endsWith('.tsx') ? [path] : [];
  });
}

function isBindingModule(path: string): boolean {
  if (dirname(path) !== DATA_DIR) return false;
  const base = basename(path).replace(/\.tsx?$/, '');
  return CORE_BINDINGS.includes(base) || (!base.includes('.') && existsSync(join(DATA_DIR, `${base}.api.ts`)));
}

function resolveImport(file: string, specifier: string): string | null {
  return specifier.startsWith('.') ? resolve(dirname(file), specifier).replace(/\.tsx?$/, '') : null;
}

const touchesAppState = (target: string) => target === SUPABASE_FILE || target === STATE_DIR || target.startsWith(STATE_DIR + sep);

function violations(file: string): string[] {
  const found: string[] = [];
  const binding = isBindingModule(file);
  const name = relative(DATA_DIR, file);
  for (const ref of importsOf(readFileSync(file, 'utf8'))) {
    if (ref.typeOnly) continue;
    const target = resolveImport(file, ref.specifier);
    if (!binding) {
      if (PLATFORM_PACKAGE.test(ref.specifier)) found.push(`${name} imports ${ref.specifier}`);
      if (target && touchesAppState(target)) found.push(`${name} imports ${ref.specifier}`);
      if (target && isBindingModule(`${target}.ts`)) found.push(`${name} imports binding module ${ref.specifier}`);
    } else if (basename(file) !== 'backend.ts' && target && touchesAppState(target)) {
      found.push(`${name} imports ${ref.specifier}; only backend.ts may`);
    }
  }
  return found;
}

test('the import scanner sees value, type, inline-type, re-export and side-effect imports', () => {
  const source = [
    "import { a } from 'react-native';",
    "import type { B } from '../supabase';",
    "import { type C, type D } from 'expo';",
    "import { type E, f } from 'expo-sqlite';",
    "import {\n  g,\n  h,\n} from './backend';",
    "export * from './profile';",
    "import 'react-native-url-polyfill/auto';",
  ].join('\n');
  assert.deepEqual(importsOf(source), [
    { specifier: 'react-native', typeOnly: false },
    { specifier: '../supabase', typeOnly: true },
    { specifier: 'expo', typeOnly: true },
    { specifier: 'expo-sqlite', typeOnly: false },
    { specifier: './backend', typeOnly: false },
    { specifier: './profile', typeOnly: false },
    { specifier: 'react-native-url-polyfill/auto', typeOnly: false },
  ]);
});

test('the scan classifies the sample files (guards against a vacuous pass)', () => {
  const files = listTs(DATA_DIR).map((path) => [relative(DATA_DIR, path), isBindingModule(path)] as const);
  const kinds = new Map(files);
  assert.equal(kinds.get('profile.ts'), true);
  assert.equal(kinds.get('backend.ts'), true);
  assert.equal(kinds.get('hooks.ts'), true);
  assert.equal(kinds.get('index.ts'), true);
  assert.equal(kinds.get('profile.mock.ts'), false);
  assert.equal(kinds.get('profile.supabase.ts'), false);
  assert.equal(kinds.get('store.ts'), false);
  assert.equal(kinds.get(join('testing', 'fakeSupabase.ts')), false);
});

test('pure files import no React, React Native, Expo, Supabase client, app state or binding module', () => {
  assert.deepEqual(listTs(DATA_DIR).flatMap(violations), []);
});

test('backend.ts is the one file that imports the Supabase client', () => {
  const importers = listTs(DATA_DIR).filter((file) =>
    importsOf(readFileSync(file, 'utf8')).some((ref) => !ref.typeOnly && resolveImport(file, ref.specifier) === SUPABASE_FILE),
  );
  assert.deepEqual(importers.map((file) => relative(DATA_DIR, file)), ['backend.ts']);
});
