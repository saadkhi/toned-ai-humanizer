import { Component } from 'react';
import { Button } from '@/components/ui/button';

/** Keep an unexpected render failure from replacing the whole app with a blank page. */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-8">
          <p className="eyebrow">Humanizer</p>
          <h1 className="text-2xl">This page could not be displayed</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">Reload to try again. Saved history in this browser will be kept; an unsaved draft may need to be pasted again.</p>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </main>
    );
  }
}
