import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { dataService } from '../services/dataLayer';
import {
  generateE2EEKeyPair, 
  exportPublicKey, 
  backupPrivateKey, 
  restorePrivateKey, 
  generateRecoveryCode,
  importPrivateKey
} from '../utils/e2eeHelper';
import {
  savePrivateKey,
  getPrivateKey,
  deletePrivateKey,
  isPrivateKeyRecordCurrent,
  getCurrentE2EEDeviceId,
  saveCurrentE2EEDeviceId,
  commitConversationCryptoTransition
} from '../utils/indexedDbHelper';
import { isE2EEV2Enabled, e2eeV2ReleaseChannel, requireE2EEV2Enabled } from '../config/e2eeV2';
import { e2eeV2Client } from '../crypto/e2eeV2Client';
import { e2eeV2Service } from '../services/e2eeV2Service';

const E2EEContext = createContext();

export const E2EEProvider = ({ children }) => {
  const { currentUser, setCurrentUser } = useAuth();
  const [e2eePrivateKey, setE2eePrivateKey] = useState(null);
  const [sharedKeysCache, setSharedKeysCache] = useState({});
  const [isE2EESetupRequired, setIsE2EESetupRequired] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState(null);

  // Monitor currentUser E2EE setup requirements
  useEffect(() => {
    if (currentUser) {
      if (dataService.isLive()) {
        if (!currentUser.has_e2ee || !currentUser.public_key) {
          setIsE2EESetupRequired(true);
        } else {
          setIsE2EESetupRequired(false);
        }
      }
    } else {
      setIsE2EESetupRequired(false);
      setE2eePrivateKey(null);
      setSharedKeysCache({});
    }
  }, [currentUser]);

  // Load secure E2EE private key from IndexedDB on startup
  useEffect(() => {
    const tryRestorePrivateKey = async () => {
      if (currentUser && currentUser.has_e2ee && !e2eePrivateKey) {
        try {
          // 1. Try IndexedDB first
          const storedKeyRecord = await getPrivateKey(currentUser.id);
          let restoredKey = isPrivateKeyRecordCurrent(storedKeyRecord, currentUser.public_key)
            ? storedKeyRecord.key
            : null;

          if (storedKeyRecord && !restoredKey) {
            console.warn('Stored E2EE key does not match the current profile key. Unlock is required.');
          }
          
          // 2. Fallback to localStorage/sessionStorage (migration)
          const cacheKey = `coingram-e2ee-key-${currentUser.id}`;
          if (!restoredKey && !dataService.isLive()) {
            let cachedJwk = sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey);
            if (cachedJwk) {
              // Import key with extractable = false for runtime security
              restoredKey = await importPrivateKey(cachedJwk, false);
              
              // Migrate to IndexedDB
              await savePrivateKey(currentUser.id, restoredKey, currentUser.public_key);
              
              // Clean up legacy plaintext storage
              sessionStorage.removeItem(cacheKey);
              localStorage.removeItem(cacheKey);
              console.log("Migrated E2EE Private Key from localStorage to IndexedDB.");
            }
          }

          if (restoredKey) {
            setE2eePrivateKey(restoredKey);
            console.log("E2EE Private Key loaded securely from IndexedDB.");
          }
        } catch (e) {
          console.warn("Failed to restore E2EE key from IndexedDB:", e);
        }
      }
    };
    tryRestorePrivateKey();
  }, [currentUser, e2eePrivateKey]);

  useEffect(() => {
    let active = true;
    if (!currentUser || !isE2EEV2Enabled) {
      setCurrentDeviceId(null);
      return undefined;
    }
    getCurrentE2EEDeviceId(currentUser.id)
      .then((deviceId) => { if (active) setCurrentDeviceId(deviceId || null); })
      .catch(() => { if (active) setCurrentDeviceId(null); });
    return () => { active = false; };
  }, [currentUser]);

  const setupE2EE = useCallback(async (password) => {
    if (!currentUser) return null;
    try {
      // 1. Generate keys (extractable = true for backup phase)
      const keyPair = await generateE2EEKeyPair();
      const recoveryCode = generateRecoveryCode();
      const encryptedPrivKeyStr = await backupPrivateKey(keyPair.privateKey, password, recoveryCode);
      const pubKeyStr = await exportPublicKey(keyPair.publicKey);

      // 2. Write backup to secure user_private_keys table
      await dataService.saveE2EEBackup(currentUser.id, encryptedPrivKeyStr);

      // 3. Update profile public key
      await dataService.updateProfile(currentUser.id, {
        public_key: pubKeyStr,
        has_e2ee: true
      });

      // 4. Create secure non-extractable instance of private key for memory & IndexedDB
      const jwkStr = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
      const securePrivKey = await window.crypto.subtle.importKey(
        'jwk',
        jwkStr,
        { name: 'ECDH', namedCurve: 'P-256' },
        false, // non-extractable
        ['deriveKey', 'deriveBits']
      );

      // 5. Store securely
      await savePrivateKey(currentUser.id, securePrivKey, pubKeyStr);
      setE2eePrivateKey(securePrivKey);
      setIsE2EESetupRequired(false);

      setCurrentUser(prev => ({
        ...prev,
        has_e2ee: true,
        public_key: pubKeyStr
      }));
      return { success: true, recoveryCode };
    } catch (e) {
      console.error("E2EE Setup failed:", e);
      alert("Не удалось настроить шифрование: " + e.message);
      return null;
    }
  }, [currentUser, setCurrentUser]);

  const unlockE2EE = useCallback(async (passwordOrCode, isRecovery = false) => {
    if (!currentUser) return false;
    try {
      const encryptedPrivKeyStr = await dataService.getE2EEBackup(currentUser.id);
      if (!encryptedPrivKeyStr) return false;

      // 1. Decrypt private key
      const decryptedKey = await restorePrivateKey(encryptedPrivKeyStr, passwordOrCode, isRecovery);
      
      // 2. Import it as non-extractable for security
      const jwkStr = await window.crypto.subtle.exportKey('jwk', decryptedKey);
      const securePrivKey = await window.crypto.subtle.importKey(
        'jwk',
        jwkStr,
        { name: 'ECDH', namedCurve: 'P-256' },
        false, // non-extractable
        ['deriveKey', 'deriveBits']
      );

      // 3. Store securely in IndexedDB and memory
      await savePrivateKey(currentUser.id, securePrivKey, currentUser.public_key);
      setE2eePrivateKey(securePrivKey);
      return true;
    } catch (e) {
      console.error("E2EE Unlock failed (wrong password/recovery code?):", e);
      return false;
    }
  }, [currentUser]);

  const changePasswordAfterRecovery = useCallback(async (recoveryCode, newPassword) => {
    if (!currentUser || !e2eePrivateKey) return false;
    try {
      // Temporarily import private key as extractable to build the new backup
      // Wait, e2eePrivateKey in memory is non-extractable, we cannot export it!
      // But wait: if we did recovery, we already entered the recoveryCode and unlocked it.
      // So we have the decrypted key at that moment!
      // Let's pass the raw decrypted key or decrypt it again from backup using recoveryCode.
      const encryptedPrivKeyStr = await dataService.getE2EEBackup(currentUser.id);
      const decryptedKey = await restorePrivateKey(encryptedPrivKeyStr, recoveryCode, true);
      
      const newBackupStr = await backupPrivateKey(decryptedKey, newPassword, recoveryCode);
      await dataService.saveE2EEBackup(currentUser.id, newBackupStr);
      return true;
    } catch (e) {
      console.error("Failed to change password after E2EE recovery:", e);
      return false;
    }
  }, [currentUser, e2eePrivateKey]);

  const resetE2EE = useCallback(async () => {
    if (!currentUser) return false;
    try {
      await dataService.deleteE2EEBackup(currentUser.id);
      await dataService.updateProfile(currentUser.id, {
        public_key: null,
        has_e2ee: false
      });
      await deletePrivateKey(currentUser.id);

      setE2eePrivateKey(null);
      setSharedKeysCache({});
      setIsE2EESetupRequired(true);

      setCurrentUser(prev => ({
        ...prev,
        has_e2ee: false,
        public_key: null
      }));
      return true;
    } catch (e) {
      console.error("E2EE Reset failed:", e);
      alert("Не удалось сбросить шифрование: " + e.message);
      return false;
    }
  }, [currentUser, setCurrentUser]);

  const registerDevice = useCallback(async (deviceName) => {
    requireE2EEV2Enabled();
    if (!currentUser) throw new Error('Authentication is required.');
    await e2eeV2Client.initialize();
    const registration = await e2eeV2Client.call('register_device', {
      userId: currentUser.id,
      deviceName
    });
    const device = await e2eeV2Service.registerDevice(currentUser.id, {
      deviceName,
      ...registration
    });
    await saveCurrentE2EEDeviceId(currentUser.id, device.deviceId);
    setCurrentDeviceId(device.deviceId);
    return device;
  }, [currentUser]);

  const approveDevice = useCallback(async (deviceId) => {
    requireE2EEV2Enabled();
    if (!currentUser || !currentDeviceId) throw new Error('An active local device is required.');
    await e2eeV2Client.call('approve_device', { approverDeviceId: currentDeviceId, targetDeviceId: deviceId });
    await e2eeV2Service.approveDevice(currentDeviceId, deviceId);
  }, [currentDeviceId, currentUser]);

  const revokeDevice = useCallback(async (deviceId) => {
    requireE2EEV2Enabled();
    if (!currentUser || !currentDeviceId) throw new Error('An active local device is required.');
    // The worker must create removal commits for every conversation before the
    // server marks the device revoked. Any failure leaves the device active.
    await e2eeV2Client.call('remove_device_from_all_conversations', {
      approverDeviceId: currentDeviceId,
      targetDeviceId: deviceId
    });
    await e2eeV2Service.revokeDevice(currentDeviceId, deviceId);
  }, [currentDeviceId, currentUser]);

  const encryptEvent = useCallback(async (chatId, eventType, payload) => {
    requireE2EEV2Enabled();
    if (!currentUser || !currentDeviceId) throw new Error('An active local device is required.');
    return e2eeV2Client.encryptEvent(currentUser.id, currentDeviceId, chatId, eventType, payload);
  }, [currentDeviceId, currentUser]);

  const decryptEvent = useCallback(async (envelope) => {
    requireE2EEV2Enabled();
    if (!currentUser) throw new Error('Authentication is required.');
    return e2eeV2Client.decryptEvent(currentUser.id, envelope.chatId, envelope);
  }, [currentUser]);

  const migrateConversation = useCallback(async (chatId) => {
    requireE2EEV2Enabled();
    if (!currentUser || !currentDeviceId) throw new Error('An active local device is required.');
    const transition = await e2eeV2Client.call('migrate_conversation', {
      chatId,
      userId: currentUser.id,
      deviceId: currentDeviceId
    });
    await commitConversationCryptoTransition(currentUser.id, chatId, transition.state.serializedState, {
      id: crypto.randomUUID(),
      chatId,
      type: 'mls-commit',
      encryptedPayload: transition.initialCommit
    });
    await e2eeV2Service.activateConversation(transition.state, currentUser.id, transition.initialCommit);
    return transition.state;
  }, [currentDeviceId, currentUser]);

  const exportHistoryTransfer = useCallback(async (toDeviceId) => {
    requireE2EEV2Enabled();
    if (!currentUser || !currentDeviceId) throw new Error('An active local device is required.');
    const transfer = await e2eeV2Client.call('export_history_transfer', {
      userId: currentUser.id,
      fromDeviceId: currentDeviceId,
      toDeviceId
    });
    await e2eeV2Service.createHistoryTransfer(
      currentUser.id,
      transfer.manifest,
      transfer.encryptedManifest,
      transfer.objectPrefix
    );
    return transfer.manifest;
  }, [currentDeviceId, currentUser]);

  const importHistoryTransfer = useCallback(async (manifest) => {
    requireE2EEV2Enabled();
    if (!currentUser || !currentDeviceId || manifest.toDeviceId !== currentDeviceId) {
      throw new Error('History transfer is not addressed to this device.');
    }
    await e2eeV2Client.call('import_history_transfer', { manifest, userId: currentUser.id });
  }, [currentDeviceId, currentUser]);

  return (
    <E2EEContext.Provider value={{
      e2eePrivateKey,
      setE2eePrivateKey,
      sharedKeysCache,
      setSharedKeysCache,
      isE2EESetupRequired,
      setupE2EE,
      unlockE2EE,
      changePasswordAfterRecovery,
      resetE2EE,
      isE2EEV2Enabled,
      e2eeV2ReleaseChannel,
      currentDeviceId,
      registerDevice,
      approveDevice,
      revokeDevice,
      encryptEvent,
      decryptEvent,
      migrateConversation,
      exportHistoryTransfer,
      importHistoryTransfer
    }}>
      {children}
    </E2EEContext.Provider>
  );
};

export const useE2EE = () => useContext(E2EEContext);
