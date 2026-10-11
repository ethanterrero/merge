import React from 'react';
import { redactKey } from './provider';
import { MAP_KEY } from './shared';

/** Swaps in the stylized map if the real one throws, so the screen still works. */
export class MapErrorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Map errors can quote request URLs, which carry the key.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Map failed to render (${redactKey(message, MAP_KEY)}); showing the stylized map instead.`);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
