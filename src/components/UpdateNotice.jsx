import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Sync } from '../services/sync';

export function UpdateNotice() {
  const [registration, setRegistration] = React.useState(null);
  const {
    needRefresh: [refresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      setRegistration(registration || null);
    },
  });
  React.useEffect(() => {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine && document.visibilityState === 'visible')
        void registration.update().catch(() => undefined);
    };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 60000);
    check();
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [registration]);
  if (!refresh) return null;
  return (
    <div className="no-print" style={{ padding: '4px 16px' }}>
      {refresh && (
        <p role="status">
          An update is available. Finish open forms before updating.{' '}
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await Sync.flushBeforeSignOut();
              await updateServiceWorker(true);
            }}
          >
            Update App
          </button>
        </p>
      )}
    </div>
  );
}
