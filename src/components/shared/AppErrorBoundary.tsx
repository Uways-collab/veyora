import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Veyora workspace render failure:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
          <section role="alert" className="w-full max-w-lg rounded-lg border border-amber-200 bg-white p-6 space-y-3">
            <h1 className="text-lg font-semibold text-slate-900">Veyora could not display this workspace</h1>
            <p className="text-sm leading-relaxed text-slate-600">
              A page component encountered an unexpected error. Your business data has not been changed.
              Refresh the page to try again. If this continues, share the browser console error with support.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Refresh workspace
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
