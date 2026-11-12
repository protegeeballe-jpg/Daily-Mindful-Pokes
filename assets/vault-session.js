import {
  createVaultAccount, deriveVaultLoginMaterial, finishVaultLogin,
  deriveLegacyVaultCredentials, createLegacyVaultUpgrade,
  prepareVaultPassphraseReset, recoverVaultMasterKey,
  validateVaultUsername, validateVaultPassphrase, validateRecoveryAnswers,
  encodeBase64Url, wipeWriteToken
} from './vault-crypto.js';
import { startVaultSync, stopVaultSync } from './vault-sync.js';
import {
  adoptVaultEncryptionKey, clearVaultEncryptionKey,
  flushAndSaveCurrentPrivateWriting, stopRegisteredVoiceNoteRecording
} from './writing-security.js';

const WORKER_ORIGIN = 'https://faith-focus-proxy.nine-westhigh.workers.dev';
const APP_CLIENT = 'faith-focus-daily-armor-web/1';
const SESSION_INACTIVITY_MS = 15 * 60 * 1000;
let activeCredentials = null;
let inactivityTimer = null;
let loginInProgress = false;
let locking = false;
let recoverySession = null;
let pendingLegacyAccount = null;

const byId = id => document.getElementById(id);

function setStatus(targetId, message, state = 'info') {
  const element = byId(targetId);
  if (element) {
    element.textContent = message;
    element.dataset.state = state;
    element.setAttribute('role', state === 'error' ? 'alert' : 'status');
    element.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
  }
}

function clearRecoverySession() {
  if (recoverySession?.masterBytes instanceof Uint8Array) recoverySession.masterBytes.fill(0);
  recoverySession = null;
}

async function accountRequest(route, body, extraHeaders = {}) {
  const response = await fetch(WORKER_ORIGIN + route, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Client': APP_CLIENT,
      ...extraHeaders
    },
    body: JSON.stringify(body || {})
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('The account service returned an unreadable response. Please try again.'); }
  if (!response.ok) {
    const error = new Error(result?.error || 'The account request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function setBusy(buttonId, busy, idleText, busyText) {
  const button = byId(buttonId);
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

function showAccountPanel(panelId, focusId) {
  ['vault-signin-panel', 'vault-signup-panel', 'vault-recovery-panel', 'vault-legacy-upgrade-panel'].forEach(id => {
    byId(id)?.classList.toggle('hidden', id !== panelId);
  });
  if (focusId) byId(focusId)?.focus();
}

function showApplication() {
  byId('view-pin')?.classList.add('hidden');
  window.dispatchEvent(new Event('faith-focus:app-unlocked'));
}

function clearPendingLegacyAccount() {
  if (pendingLegacyAccount?.credentials?.masterKeyBytes instanceof Uint8Array) {
    pendingLegacyAccount.credentials.masterKeyBytes.fill(0);
  }
  if (pendingLegacyAccount?.credentials?.writeToken instanceof Uint8Array) {
    wipeWriteToken(pendingLegacyAccount.credentials.writeToken);
  }
  pendingLegacyAccount = null;
}

function showLogin(message = 'Sign in to open your account and all of its features.') {
  clearRecoverySession();
  clearPendingLegacyAccount();
  byId('view-pin')?.classList.remove('hidden');
  showAccountPanel('vault-signin-panel', 'vault-username');
  const passphrase = byId('vault-passphrase');
  if (passphrase) passphrase.value = '';
  setStatus('vault-login-message', message, 'info');
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
  window.addEventListener('faith-focus:lock-account', () => {
    lockAccount('Your account is locked.');
  });
}

function collectAnswers(prefix) {
  return [1, 2, 3].map(index => ({
    questionId: Number(byId(prefix + '-question-' + index)?.value),
    answer: byId(prefix + '-answer-' + index)?.value || ''
  }));
}

function clearAnswerFields(prefix) {
  [1, 2, 3].forEach(index => {
    const answer = byId(prefix + '-answer-' + index);
    if (answer) answer.value = '';
  });
}

async function submitVaultLogin(event) {
  event.preventDefault();
  if (loginInProgress || activeCredentials) return;

  const usernameField = byId('vault-username');
  const passphraseField = byId('vault-passphrase');
  const username = usernameField?.value || '';
  let passphrase = passphraseField?.value || '';
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase);

  if (!usernameResult.valid) {
    setStatus('vault-login-message', 'Enter a valid username (3–32 letters, numbers, dots, hyphens, or underscores).', 'error');
    usernameField?.focus();
    return;
  }
  if (!passphraseResult.valid) {
    setStatus('vault-login-message', passphraseResult.message, 'error');
    passphraseField?.focus();
    return;
  }
  if (!window.isSecureContext || !window.crypto?.subtle || !window.crypto?.getRandomValues) {
    setStatus('vault-login-message', 'Secure Web Crypto is unavailable. Open Faith & Focus over HTTPS in a modern browser.', 'error');
    return;
  }

  loginInProgress = true;
  setBusy('vault-login-submit', true, 'SIGN IN', 'Unlocking account…');
  setStatus('vault-login-message', 'Looking up your account…');
  let loginMaterial = null;
  let credentials = null;

  try {
    let account;
    try {
      account = await accountRequest('/account/signin', { username: usernameResult.normalized });
    } catch (lookupError) {
      if (lookupError.status !== 401) throw lookupError;
      setStatus('vault-login-message', 'Checking whether this is an existing vault that needs a one-time security upgrade…');
      const legacy = await deriveLegacyVaultCredentials(usernameResult.normalized, passphrase);
      try {
        const legacyClaim = await fetch(WORKER_ORIGIN + '/vault/' + legacy.vaultId + '/claim', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Client': APP_CLIENT,
            'X-Write-Token': encodeBase64Url(legacy.writeToken)
          },
          body: '{}'
        });
        if (!legacyClaim.ok) throw new Error('The username or passphrase was not accepted.');
      } catch (legacyError) {
        wipeWriteToken(legacy.writeToken);
        legacy.masterKeyBytes.fill(0);
        throw legacyError;
      }
      pendingLegacyAccount = {
        username: usernameResult.normalized,
        passphrase,
        credentials: legacy
      };
      passphrase = '';
      passphraseField.value = '';
      byId('legacy-upgrade-username').textContent = usernameResult.normalized;
      showAccountPanel('vault-legacy-upgrade-panel', 'legacy-question-1');
      setStatus('vault-legacy-upgrade-message', 'We verified your existing vault. Choose three recovery questions to keep your current encrypted records and complete the account upgrade.', 'success');
      return;
    }

    setStatus('vault-login-message', 'Checking your passphrase securely on this device…');
    loginMaterial = await deriveVaultLoginMaterial(account, passphrase);
    passphrase = '';
    passphraseField.value = '';

    setStatus('vault-login-message', 'Unlocking your encrypted account…');
    const unlocked = await accountRequest('/account/unlock', { vaultId: account.vaultId }, {
      'X-Write-Token': encodeBase64Url(loginMaterial.writeToken)
    });
    credentials = await finishVaultLogin(account, loginMaterial, unlocked.passphraseEnvelope);
    loginMaterial = null;

    setStatus('vault-login-message', 'Connecting your Checklist, Diary and Garden…');
    await startVaultSync(credentials);
    const migration = await adoptVaultEncryptionKey(credentials.encryptionKey);
    activeCredentials = credentials;
    if (usernameField) usernameField.value = credentials.username;
    showApplication();
    resetInactivityTimer();

    if (migration.legacyMigrationRequired) {
      setStatus('vault-login-message', 'Your account is open. This device has older Diary records that need a one-time migration using the previous Diary passphrase.', 'info');
    } else {
      setStatus('vault-login-message', 'Your account is open. Your Checklist, Diary and Garden share one account.', 'success');
    }
  } catch (error) {
    try { await stopVaultSync(); } catch { /* Preserve the original login error. */ }
    clearVaultEncryptionKey();
    if (loginMaterial) wipeWriteToken(loginMaterial.writeToken);
    if (credentials) wipeWriteToken(credentials.writeToken);
    setStatus('vault-login-message', error?.message || 'The account could not be opened. Your local records were not changed.', 'error');
    passphraseField?.focus();
  } finally {
    passphrase = '';
    loginInProgress = false;
    setBusy('vault-login-submit', false, 'SIGN IN', 'Unlocking account…');
  }
}

async function submitVaultSignup(event) {
  event.preventDefault();
  if (loginInProgress || activeCredentials) return;

  const username = byId('signup-username')?.value || '';
  const passphraseField = byId('signup-passphrase');
  const confirmField = byId('signup-passphrase-confirm');
  let passphrase = passphraseField?.value || '';
  const confirmation = confirmField?.value || '';
  const answers = collectAnswers('signup');
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase, { creating: true });
  const answerResult = validateRecoveryAnswers(answers);

  if (!usernameResult.valid) {
    setStatus('vault-signup-message', 'Choose a valid username (3–32 letters, numbers, dots, hyphens, or underscores).', 'error');
    byId('signup-username')?.focus();
    return;
  }
  if (!passphraseResult.valid) {
    setStatus('vault-signup-message', passphraseResult.message, 'error');
    passphraseField?.focus();
    return;
  }
  if (passphrase !== confirmation) {
    setStatus('vault-signup-message', 'The passphrases do not match.', 'error');
    confirmField?.focus();
    return;
  }
  if (!answerResult.valid) {
    setStatus('vault-signup-message', answerResult.message, 'error');
    return;
  }
  if (!window.isSecureContext || !window.crypto?.subtle || !window.crypto?.getRandomValues) {
    setStatus('vault-signup-message', 'Secure Web Crypto is unavailable. Open Faith & Focus over HTTPS in a modern browser.', 'error');
    return;
  }

  loginInProgress = true;
  setBusy('vault-signup-submit', true, 'CREATE ACCOUNT', 'Creating your private account…');
  let signupStage = 'preparing your account on this device';
  setStatus('vault-signup-message', 'Creating your account…');
  let credentials = null;
  let accountCreated = false;
  try {
    credentials = await createVaultAccount(usernameResult.normalized, passphrase, answers);
    passphrase = '';

    const payload = {
      ...credentials.accountRecord,
      writeToken: encodeBase64Url(credentials.writeToken)
    };
    signupStage = 'registering your account with the account service';
    setStatus('vault-signup-message', 'Registering your account and recovery questions…');
    await accountRequest('/account/signup', payload);
    accountCreated = true;

    // Only clear the form after the server confirms that registration succeeded.
    credentials.accountRecord.questionAnswers.forEach(item => { item.answer = ''; });
    passphraseField.value = '';
    confirmField.value = '';
    clearAnswerFields('signup');

    signupStage = 'opening your new account on this device';
    setStatus('vault-signup-message', 'Opening your new account…');
    await startVaultSync(credentials);
    const migration = await adoptVaultEncryptionKey(credentials.encryptionKey);
    activeCredentials = credentials;
    byId('vault-username').value = credentials.username;
    showApplication();
    resetInactivityTimer();
    setStatus('vault-login-message', migration.legacyMigrationRequired
      ? 'Your account is open. Older Diary records on this device need one-time migration.'
      : 'Your account is ready. Your Checklist, Diary and Garden now share one account.', 'success');
  } catch (error) {
    try { await stopVaultSync(); } catch { /* Keep the original account-creation error. */ }
    clearVaultEncryptionKey();
    if (credentials) {
      credentials.accountRecord?.questionAnswers?.forEach(item => { item.answer = ''; });
      wipeWriteToken(credentials.writeToken);
    }
    if (accountCreated) {
      showLogin('Your account was created, but this device could not finish opening it. Sign in using the username and passphrase you just created.');
      setStatus('vault-login-message',
        'Your account was created, but this device could not finish opening it. ' +
        (error?.message || 'Sign in using the username and passphrase you just created.'), 'error');
    } else {
      const detail = error?.message || 'The account service did not complete the request.';
      setStatus('vault-signup-message',
        'We could not finish ' + signupStage + '. ' + detail +
        ' Your entries are still here; check the message and try again.', 'error');
      const status = byId('vault-signup-message');
      status?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
      status?.focus?.({ preventScroll: true });
    }
  } finally {
    passphrase = '';
    loginInProgress = false;
    setBusy('vault-signup-submit', false, 'CREATE ACCOUNT', 'Creating your private account…');
  }
}
async function submitLegacyUpgrade(event) {
  event.preventDefault();
  if (loginInProgress || !pendingLegacyAccount) return;
  const answers = collectAnswers('legacy');
  const validation = validateRecoveryAnswers(answers);
  if (!validation.valid) {
    setStatus('vault-legacy-upgrade-message', validation.message, 'error');
    return;
  }

  loginInProgress = true;
  setBusy('vault-legacy-upgrade-submit', true, 'SECURE EXISTING ACCOUNT', 'Securing your account…');
  setStatus('vault-legacy-upgrade-message', 'Wrapping your existing account key with your passphrase and recovery answers…');
  let credentials = null;
  try {
    credentials = await createLegacyVaultUpgrade(
      pendingLegacyAccount.username,
      pendingLegacyAccount.passphrase,
      answers,
      pendingLegacyAccount.credentials
    );
    pendingLegacyAccount.passphrase = '';
    const payload = {
      ...credentials.accountRecord,
      writeToken: encodeBase64Url(credentials.writeToken),
      legacyWriteToken: encodeBase64Url(credentials.legacyWriteToken)
    };
    await accountRequest('/account/migrate-legacy', payload);
    wipeWriteToken(credentials.legacyWriteToken);
    delete credentials.legacyWriteToken;
    credentials.accountRecord.questionAnswers.forEach(item => { item.answer = ''; });
    clearPendingLegacyAccount();

    setStatus('vault-legacy-upgrade-message', 'Your existing account is now protected by the new recovery system. Opening your original vault…', 'success');
    await startVaultSync(credentials);
    const migration = await adoptVaultEncryptionKey(credentials.encryptionKey);
    activeCredentials = credentials;
    if (byId('vault-username')) byId('vault-username').value = credentials.username;
    showApplication();
    resetInactivityTimer();
    setStatus('vault-login-message', migration.legacyMigrationRequired
      ? 'Your account is open. Older local Diary entries need a one-time legacy Diary migration.'
      : 'Your existing account is open. Your original Checklist, Diary and Garden remain in the same vault.', 'success');
  } catch (error) {
    try { await stopVaultSync(); } catch { /* Keep the original migration error. */ }
    if (credentials) {
      wipeWriteToken(credentials.writeToken);
      wipeWriteToken(credentials.legacyWriteToken);
      credentials.accountRecord?.questionAnswers?.forEach(item => { item.answer = ''; });
    }
    setStatus('vault-legacy-upgrade-message', error?.message || 'The existing account could not be upgraded. Your previous vault credentials remain unchanged.', 'error');
  } finally {
    clearAnswerFields('legacy');
    loginInProgress = false;
    setBusy('vault-legacy-upgrade-submit', false, 'SECURE EXISTING ACCOUNT', 'Securing your account…');
  }
}

async function submitRecoveryAnswers(event) {
  event.preventDefault();
  if (loginInProgress || activeCredentials) return;
  const answers = collectAnswers('recovery');
  const validation = validateRecoveryAnswers(answers);
  if (!validation.valid) {
    setStatus('vault-recovery-message', validation.message, 'error');
    return;
  }

  loginInProgress = true;
  setBusy('vault-recovery-verify', true, 'VERIFY ANSWERS', 'Verifying answers…');
  setStatus('vault-recovery-message', 'Checking your selected questions and answers securely…');
  try {
    const result = await accountRequest('/account/recover', { questionAnswers: answers });
    const masterBytes = await recoverVaultMasterKey(result, answers);
    clearRecoverySession();
    recoverySession = { ...result, masterBytes };
    byId('recovery-current-username').textContent = result.username;
    byId('vault-recovery-form')?.classList.add('hidden');
    byId('vault-recovery-result')?.classList.remove('hidden');
    setStatus('vault-recovery-message', 'Your answers were verified. You can now recover your username, reset your passphrase, or do both.', 'success');
    byId('recovery-new-username')?.focus();
  } catch (error) {
    setStatus('vault-recovery-message', error?.message || 'The answers could not be verified.', 'error');
  } finally {
    clearAnswerFields('recovery');
    loginInProgress = false;
    setBusy('vault-recovery-verify', false, 'VERIFY ANSWERS', 'Verifying answers…');
  }
}

async function completeRecovery(event) {
  event.preventDefault();
  if (loginInProgress || !recoverySession) return;

  const newUsernameRaw = byId('recovery-new-username')?.value || '';
  const newUsername = newUsernameRaw ? validateVaultUsername(newUsernameRaw) : { valid: true, normalized: '' };
  const newPassphraseField = byId('recovery-new-passphrase');
  const confirmField = byId('recovery-new-passphrase-confirm');
  let newPassphrase = newPassphraseField?.value || '';
  const confirmation = confirmField?.value || '';

  if (!newUsername.valid) {
    setStatus('vault-recovery-message', 'The new username must contain 3–32 letters, numbers, dots, hyphens, or underscores.', 'error');
    byId('recovery-new-username')?.focus();
    return;
  }
  if (newPassphrase) {
    const validation = validateVaultPassphrase(newPassphrase, { creating: true });
    if (!validation.valid) {
      setStatus('vault-recovery-message', validation.message, 'error');
      newPassphraseField?.focus();
      return;
    }
    if (newPassphrase !== confirmation) {
      setStatus('vault-recovery-message', 'The new passphrases do not match.', 'error');
      confirmField?.focus();
      return;
    }
  } else if (confirmation) {
    setStatus('vault-recovery-message', 'Enter a new passphrase in both fields, or leave both fields blank.', 'error');
    newPassphraseField?.focus();
    return;
  }

  const usernameChanged = Boolean(newUsername.normalized && newUsername.normalized !== recoverySession.username);
  const passphraseChanged = Boolean(newPassphrase);
  if (!usernameChanged && !passphraseChanged) {
    setStatus('vault-recovery-message', 'Your verified username is shown above. Enter a new username or passphrase to make changes.', 'info');
    return;
  }

  loginInProgress = true;
  setBusy('vault-recovery-save', true, 'SAVE ACCOUNT CHANGES', 'Updating account…');
  try {
    const payload = { grant: recoverySession.grant };
    if (usernameChanged) payload.newUsername = newUsername.normalized;
    if (passphraseChanged) {
      const reset = await prepareVaultPassphraseReset(
        { vaultId: recoverySession.vaultId, username: recoverySession.username },
        recoverySession.masterBytes,
        newPassphrase
      );
      payload.passphraseSalt = reset.passphraseSalt;
      payload.passphraseIterations = reset.passphraseIterations;
      payload.passphraseEnvelope = reset.passphraseEnvelope;
      payload.writeToken = encodeBase64Url(reset.writeToken);
      wipeWriteToken(reset.writeToken);
    }
    const saved = await accountRequest('/account/complete-recovery', payload);
    const recoveredUsername = saved.username;
    clearRecoverySession();
    if (byId('vault-username')) byId('vault-username').value = recoveredUsername;
    if (newPassphraseField) newPassphraseField.value = '';
    if (confirmField) confirmField.value = '';
    showLogin('Account recovery completed. Sign in using ' + recoveredUsername + (passphraseChanged
      ? ' and your new passphrase.' : ' and your existing passphrase.'));
  } catch (error) {
    setStatus('vault-recovery-message', error?.message || 'The account could not be updated. Your current account credentials remain unchanged.', 'error');
  } finally {
    newPassphrase = '';
    loginInProgress = false;
    setBusy('vault-recovery-save', false, 'SAVE ACCOUNT CHANGES', 'Updating account…');
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
    setStatus('vault-login-message', 'The account remains open because a final local save could not be completed. ' + (error?.message || ''), 'error');
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
  const loginForm = byId('vault-login-form');
  if (!loginForm) return;
  loginForm.addEventListener('submit', submitVaultLogin);
  byId('vault-signup-form')?.addEventListener('submit', submitVaultSignup);
  byId('vault-legacy-upgrade-form')?.addEventListener('submit', submitLegacyUpgrade);
  byId('vault-recovery-form')?.addEventListener('submit', submitRecoveryAnswers);
  byId('vault-recovery-update-form')?.addEventListener('submit', completeRecovery);
  byId('vault-show-signup')?.addEventListener('click', () => {
    showAccountPanel('vault-signup-panel', 'signup-username');
    setStatus('vault-signup-message', 'Create your username, passphrase, and three account-recovery answers.');
  });
  byId('vault-show-recovery')?.addEventListener('click', () => {
    clearRecoverySession();
    byId('vault-recovery-form')?.classList.remove('hidden');
    byId('vault-recovery-result')?.classList.add('hidden');
    showAccountPanel('vault-recovery-panel', 'recovery-question-1');
    setStatus('vault-recovery-message', 'Select the same three questions you chose during sign-up. Answers are case-sensitive and must contain no spaces.');
  });
  byId('vault-back-to-signin-from-legacy')?.addEventListener('click', () => showLogin());
  byId('vault-back-to-signin-from-signup')?.addEventListener('click', () => {
    showAccountPanel('vault-signin-panel', 'vault-username');
  });
  byId('vault-back-to-signin-from-recovery')?.addEventListener('click', () => showLogin());
  byId('vault-lock-button')?.addEventListener('click', () => lockAccount());
  installSessionActivityListeners();
  showLogin();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeVaultSession, { once: true });
} else {
  initializeVaultSession();
}
