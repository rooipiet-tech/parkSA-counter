import { Component, type ComponentChildren } from 'preact';

/**
 * Always-visible failure surface. The app must NEVER be a silent blank #root
 * (the iOS Safari symptom): if boot or a render throws, show a styled message
 * PLUS the real error text/stack so the underlying WebKit error is visible on
 * the device. Preact escapes text children, so message/stack render safely.
 *
 * Styling is INLINE on purpose so this shows even if the stylesheet failed to
 * load. Colours are light-on-dark to stay legible over the #101418 background.
 */
export function BootError({
  title = 'ParkSA Counter failed to start',
  error
}: {
  title?: string;
  error: unknown;
}) {
  const err = error as { message?: string; stack?: string } | null;
  const message = err?.message ?? String(error ?? 'Unknown error');
  const stack = err?.stack ?? '';
  const detail = stack ? `${message}\n\n${stack}` : message;
  return (
    <div
      class="boot-error"
      data-testid="boot-error"
      role="alert"
      style="max-width:40rem;margin:2rem auto;padding:1rem 1.2rem;color:#f2f4f7;background:#3a1414;border:1px solid #a83232;border-radius:8px;font-family:system-ui,sans-serif;"
    >
      <h1 style="font-size:1.1rem;margin:0 0 .5rem;">{title}</h1>
      <p style="margin:0 0 .75rem;line-height:1.4;">
        Something went wrong while loading the app. Please reload; if it keeps
        happening, send this error text to support.
      </p>
      <pre
        data-testid="boot-error-detail"
        style="white-space:pre-wrap;word-break:break-word;font-size:.8rem;background:#000;color:#ff9c9c;padding:.6rem;border-radius:6px;overflow-x:auto;margin:0;"
      >
        {detail}
      </pre>
    </div>
  );
}

interface BoundaryProps {
  children: ComponentChildren;
}
interface BoundaryState {
  error: Error | null;
}

/**
 * Preact error boundary: a render-time throw anywhere in the app tree shows the
 * BootError surface instead of unmounting to a blank #root.
 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('Render error caught by ErrorBoundary:', error);
  }

  render() {
    if (this.state.error) {
      return <BootError title="Something went wrong" error={this.state.error} />;
    }
    return this.props.children;
  }
}
