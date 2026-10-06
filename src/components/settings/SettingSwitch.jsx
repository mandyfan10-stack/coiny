import React from 'react';
import SettingStatus from './SettingStatus';

export default function SettingSwitch({ id, title, description, checked, onChange, disabled, error }) {
  return <div>
    <label className="settings-switch-row" htmlFor={id}>
      <span className="settings-row-text"><span>{title}</span>{description && <small>{description}</small>}</span>
      <span className="settings-switch">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
        <span className="settings-switch-track" aria-hidden="true" />
      </span>
    </label>
    <SettingStatus error={error} />
  </div>;
}
