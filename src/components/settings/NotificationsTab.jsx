import React, { useState } from 'react';
import SettingSwitch from './SettingSwitch';
import { requestNotificationPermission } from '../../services/notificationService';
import { isHapticsEnabled, setHapticsEnabled, triggerHaptic, HAPTIC_SUCCESS } from '../../hooks/useMessageTouch';

export default function NotificationsTab({ notif, setNotif, pending, error }) {
  const [haptics, setHaptics] = useState(() => isHapticsEnabled());
  return <div className="settings-section">
    <SettingSwitch id="notif-toggle" title="Уведомления" description="Звуковые и push-уведомления" checked={notif} disabled={pending} error={error}
      onChange={value => {
        // Ask while the click still has browser user activation.
        if (value) void requestNotificationPermission();
        void setNotif(value);
      }} />
    <SettingSwitch id="haptics-toggle" title="Тактильный отклик" description="Вибрация при нажатиях" checked={haptics}
      onChange={value => {
        setHaptics(value); setHapticsEnabled(value);
        if (value) triggerHaptic(HAPTIC_SUCCESS);
      }} />
  </div>;
}
