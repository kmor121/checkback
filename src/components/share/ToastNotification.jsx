import React from 'react';

/**
 * ShareView用 トースト通知
 * toast: { show: boolean, message: string, type: 'success'|'error'|'info' }
 */
export default function ToastNotification({ toast }) {
  if (!toast?.show) return null;
  const cls =
    toast.type === 'error' ? 'bg-red-600 text-white' :
    toast.type === 'info' ? 'bg-blue-600 text-white' :
    'bg-green-600 text-white';
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className={`px-6 py-3 rounded-lg shadow-lg ${cls}`}>
        {toast.message}
      </div>
    </div>
  );
}