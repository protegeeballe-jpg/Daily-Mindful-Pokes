import {
  deriveVaultCredentials, validateVaultUsername, validateVaultPassphrase, wipeWriteToken
} from './vault-crypto.js';
import { startVaultSync, stopVaultSync } from './vault-sync.js';
import {
  adoptVaultEncryptionKey, clearVaultEncryptionKey,
  flushAndSaveCurrentPrivateWriting, stopRegisteredVoiceNoteRecording
} from './writing-security.js';

const SESSION_INACTIVITY_MS = 15 * 60 * 1000;
let activeCredentials = null;
let inactivityTimer = null;
let loginInProgress = false;
let locking = false;

const byId = id => document.getElementById(id);

function setLoginStatus(message, state = 'info') {
  const element = byId('vault-login-message');
  if (element) {
    element.textContent = message;
    element.dataset.state = state;
  }
}

function setLoginBusy(busy) {
  const button = byId('vault-login-submit');
  if (button) {
    button.disabled = busy;
    button.textContent = busy ? 'Securing your vault…' : 'Continue';
  }
}

function showApplication() {
  byId('view-pin')?.classList.add('hidden');
  window.dispatchEvent(new Event('faith-focus:app-unlocked'));
}

function showLogin(message = 'Sign in or create an account. A new username creates its vault the first time it is used.') {
  byId('view-pin')?.classList.remove('hidden');
  const passphrase = byId('vault-passphrase');
  if (passphrase) passphrase.value = '';
  setLoginStatus(message, 'info');
  passphrase?.focus();
}

function resetInactivityTimer() {
  if (!activeCredentials || locking) return;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = window.setTimeout(() => {
    lockAccount('Your account was locked after 15 minutes of inactivity.');
  }, SESSION_INACTIVITY_MS);
}

function installSessionActivityListeners() {
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(eventName => {
    document.addEventListener(eventName, resetInactivityTimer, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && activeCredentials) {
      window.dispatchEvent(new Event('faith-focus:vault-flush-request'));
    }
  });
  window.addEventListener('faith-focus:lock-account', () => {
    lockAccount('Your account is locked.');
  });
}

async function submitVaultLogin(event) {
  event.preventDefault();
  if (loginInProgress || activeCredentials) return;

  const usernameField = byId('vault-username');
  const passphraseField = byId('vault-passphrase');
  const username = usernameField?.value || '';
  const passphrase = passphraseField?.value || '';
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase, { creating: true });

  if (!usernameResult.valid) {
    setLoginStatus('Choose a 3–32 character username using letters, numbers, dots, hyphens, or underscores. It must begin and end with a letter or number.', 'error');
    usernameField?.focus();
    return;
  }
  if (!passphraseResult.valid) {
    setLoginStatus(passphraseResult.message, 'error');
    passphraseField?.focus();
    return;
  }
  if (!window.isSecureContext || !window.crypto?.subtle || !window.crypto?.getRandomValues) {
    setLoginStatus('Secure Web Crypto is unavailable. Open Faith & Focus over HTTPS in a modern browser.', 'error');
    return;
  }

  loginInProgress = true;
  setLoginBusy(true);
  setLoginStatus('Deriving your private account keys on this device…');
  let credentials = null;

  try {
    credentials = await deriveVaultCredentials(username, passphrase);
    passphraseField.value = '';

    setLoginStatus('Connecting to your encrypted vault…');
    await startVaultSync(credentials);

    const migration = await adoptVaultEncryptionKey(credentials.encryptionKey);
    activeCredentials = credentials;
    if (usernameField) usernameField.value = credentials.username;
    showApplication();
    resetInactivityTimer();

    if (migration.legacyMigrationRequired) {
      setLoginStatus('Your account is open. This device has older encrypted Diary entries; the Diary will offer a one-time migration when you open it.', 'info');
    } else {
      setLoginStatus('Your account is open. Daily packets are saved locally and synchronized automatically.', 'success');
    }
  } catch (error) {
    if (credentials) wipeWriteToken(credentials.writeToken);
    setLoginStatus(error?.message || 'The account could not be opened. Your local records were not changed.', 'error');
    passphraseField?.focus();
  } finally {
    loginInProgress = false;
    setLoginBusy(false);
  }
}

export async function lockAccount(message = 'Your account is locked.') {
  if (!activeCredentials || locking) return;
  locking = true;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  try {
    await stopRegisteredVoiceNoteRecording();
    await flushAndSaveCurrentPrivateWriting();
    await stopVaultSync();
  } catch (error) {
    locking = false;
    resetInactivityTimer();
    setLoginStatus('The account remains open because a final local save could not be completed. ' + (error?.message || ''), 'error');
    return;
  }

  wipeWriteToken(activeCredentials.writeToken);
  activeCredentials = null;
  clearVaultEncryptionKey();
  locking = false;
  showLogin(message);
}

export function isVaultAccountUnlocked() {
  return Boolean(activeCredentials);
}

function initializeVaultSession() {
  const form = byId('vault-login-form');
  if (!form) return;
  form.addEventListener('submit', submitVaultLogin);
  byId('vault-lock-button')?.addEventListener('click', () => lockAccount());
  installSessionActivityListeners();
  showLogin();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeVaultSession, { once: true });
} else {
  initializeVaultSession();
}
