import React from 'react';
import SettingStatus from './SettingStatus';
import Switch from '../ui/Switch';

export default function SettingSwitch({ id, title, description, checked, onChange, disabled, error }) {
  return <div>
    <label className="settings-switch-row" htmlFor={id}>
      <span className="settings-row-text"><span>{title}</span>{description && <small>{description}</small>}</span>
      <Switch id={id} checked={checked} disabled={disabled} onChange={onChange} />
    </label>
    <SettingStatus error={error} />
  </div>;
}
