import React from 'react';

/** Swaps in the stylized map if the real one throws, so the screen still works. */
export class MapErrorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Map failed to render; showing the stylized map instead.', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
