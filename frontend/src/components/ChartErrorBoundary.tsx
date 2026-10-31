import { Component, type ReactNode } from "react";

export class ChartErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <>Graphique indisponible.</>;
    }
    return this.props.children;
  }
}
