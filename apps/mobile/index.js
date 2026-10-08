import { registerRootComponent } from 'expo';
import App from './App';

// With npm workspaces, expo is hoisted to the repo root, so the default
// "expo/AppEntry" entry would resolve ../../App against the root. Register the
// app from here instead.
registerRootComponent(App);
