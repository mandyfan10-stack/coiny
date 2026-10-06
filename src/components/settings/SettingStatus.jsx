import React from 'react';

export default function SettingStatus({ status, error }) {
  const text = error || status?.text;
  if (!text) return null;
  const isError = Boolean(error || status?.type === 'error');
  return <p className={`settings-status ${isError ? 'is-error' : 'is-success'}`} role={isError ? 'alert' : 'status'}>{text}</p>;
}
