import React, { useState } from 'react';
import SettingSwitch from './SettingSwitch';
import { requestNotificationPermission } from '../../services/notificationService';
import { webPushService } from '../../services/webPushService.ts';
import { useAuth } from '../../context/AuthContext';
import { isHapticsEnabled, setHapticsEnabled, triggerHaptic, HAPTIC_SUCCESS } from '../../hooks/useMessageTouch';

export default function NotificationsTab({ notif, setNotif, pending, error }) {
  const [haptics, setHaptics] = useState(() => isHapticsEnabled());
  const { currentUser } = useAuth();
  const [pushPending, setPushPending] = useState(false);
  const [pushError, setPushError] = useState('');
  return <div className="settings-section">
    <SettingSwitch id="notif-toggle" title="Уведомления" description="Звуковые и push-уведомления" checked={notif} disabled={pending || pushPending} error={error || pushError}
      onChange={async value => {
        // Ask while the click still has browser user activation.
        const permission = value ? requestNotificationPermission() : Promise.resolve('denied');
        setPushPending(true); setPushError('');
        try {
          const granted = await permission;
          if (value && webPushService.configured && granted !== 'granted') throw new Error('Разрешите уведомления в настройках браузера.');
          if (!value) await webPushService.sync(currentUser?.id, false);
          const saved = await setNotif(value);
          if (saved !== false && value) await webPushService.sync(currentUser?.id, true);
        } catch (failure) { setPushError(failure.message || 'Не удалось настроить уведомления.'); }
        finally { setPushPending(false); }
      }} />
    <SettingSwitch id="haptics-toggle" title="Тактильный отклик" description="Вибрация при нажатиях" checked={haptics}
      onChange={value => {
        setHaptics(value); setHapticsEnabled(value);
        if (value) triggerHaptic(HAPTIC_SUCCESS);
      }} />
  </div>;
}
