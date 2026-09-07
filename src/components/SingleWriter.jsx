import React from 'react';

/** Browser-managed lock is released on crash/close. Never expire a live writer. */
export function SingleWriter({ children }) {
  const [state, setState] = React.useState('waiting');
  React.useEffect(() => {
    if (!navigator.locks) {
      setState('unsupported');
      return;
    }
    let release,
      cancelled = false;
    const controller = new AbortController();
    navigator.locks
      .request(
        'diamond-lineup-writer',
        { signal: controller.signal },
        async () => {
          if (cancelled) return;
          setState('ready');
          await new Promise((resolve) => {
            release = resolve;
          });
        },
      )
      .catch((e) => {
        if (e.name !== 'AbortError') setState('unsupported');
      });
    return () => {
      cancelled = true;
      controller.abort();
      release?.();
    };
  }, []);
  if (state === 'ready') return children;
  return (
    <main className="container">
      <h2>Diamond Lineup</h2>
      <p>
        {state === 'waiting'
          ? 'Another tab may be editing Diamond Lineup. Close that tab to continue here.'
          : 'This browser cannot safely coordinate local editing. Open Diamond Lineup in a current browser.'}
      </p>
    </main>
  );
}
