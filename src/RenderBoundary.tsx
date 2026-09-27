import { Component, type ReactNode } from 'react';

// Retrying only remounts the view; it must never resubmit an execution request.
export class RenderBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error) { console.error('Freelancer view failed', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="render-recovery" role="alert">
      <h2>This view couldn’t be displayed</h2>
      <p>Your saved conversation is still available. Recovering the view won’t resend your message.</p>
      <button type="button" className="button" onClick={() => this.setState({ error: false })}>Try this view again</button>
      <button type="button" className="button" onClick={() => window.location.reload()}>Reload Freelancer</button>
    </section>;
  }
}
