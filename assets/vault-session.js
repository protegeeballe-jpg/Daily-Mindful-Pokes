import {
  SECURITY_QUESTIONS,
  createNewVaultAccount,
  deriveLegacyVaultCredentials,
  deriveVaultCredentialsFromMaster,
  unlockVaultAccount,
  unwrapMasterKeyWithRecovery,
  wrapMasterKeyWithRecovery,
  createPassphraseEnvelope,
  validateVaultUsername,
  validateVaultPassphrase,
  validateSecuritySetup,
  wipeVaultCredentials
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
let pendingLegacyEnrollment = null;
let pendingRecovery = null;
let inactivityTimer = null;
let accountBusy = false;
let locking = false;

const byId = id => document.getElementById(id);

function setStatus(elementId, message, state = 'info') {
  const element = byId(elementId);
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

async function accountRequest(path, payload) {
  const response = await fetch(WORKER_ORIGIN + path, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-App-Client': APP_CLIENT
    },
    body: JSON.stringify(payload)
  });
  let data = {};
  try { data = await response.json(); }
  catch { throw new Error('The account service returned an unreadable response.'); }
  if (!response.ok) {
    const error = new Error(data.error || 'The account request could not be completed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function setBusy(buttonId, busy, label, idleLabel) {
  const button = byId(buttonId);
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? label : idleLabel;
}

function showPanel(panel) {
  byId('vault-auth-login-panel')?.classList.toggle('hidden', panel !== 'login');
  byId('vault-auth-signup-panel')?.classList.toggle('hidden', panel !== 'signup');
  byId('vault-auth-recovery-panel')?.classList.toggle('hidden', panel !== 'recovery');
  if (panel === 'login') byId('vault-username')?.focus();
  if (panel === 'signup') byId('vault-signup-username')?.focus();
  if (panel === 'recovery') byId('recovery-question-1')?.focus();
}

function showApplication() {
  byId('view-pin')?.classList.add('hidden');
  window.dispatchEvent(new Event('faith-focus:app-unlocked'));
}

function showLogin(message = 'Sign in once to access your entire account.') {
  byId('view-pin')?.classList.remove('hidden');
  showPanel('login');
  const passphrase = byId('vault-passphrase');
  if (passphrase) passphrase.value = '';
  setStatus('vault-login-message', message, 'info');
}

function populateSecurityQuestions(prefix) {
  for (let index = 1; index <= 3; index += 1) {
    const select = byId(prefix + '-question-' + index);
    if (!select || select.dataset.populated === 'true') continue;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a question…';
    select.append(placeholder);
    SECURITY_QUESTIONS.forEach((question, questionIndex) => {
      const option = document.createElement('option');
      option.value = String(questionIndex + 1);
      option.textContent = (questionIndex + 1) + '. ' + question;
      select.append(option);
    });
    select.dataset.populated = 'true';
  }
}

function readSecurityAnswers(prefix) {
  const questionIds = [];
  const answers = [];
  for (let index = 1; index <= 3; index += 1) {
    questionIds.push(Number(byId(prefix + '-question-' + index)?.value || 0));
    answers.push(byId(prefix + '-answer-' + index)?.value || '');
  }
  const validation = validateSecuritySetup(questionIds, answers);
  if (!validation.valid) throw new Error(validation.message);
  return { questionIds, answers };
}

function clearSecurityAnswers(prefix) {
  for (let index = 1; index <= 3; index += 1) {
    const question = byId(prefix + '-question-' + index);
    const answer = byId(prefix + '-answer-' + index);
    if (question) question.value = '';
    if (answer) answer.value = '';
  }
}

function resetRecoveryState() {
  if (pendingRecovery?.masterKeyBytes instanceof Uint8Array) pendingRecovery.masterKeyBytes.fill(0);
  pendingRecovery = null;
  clearSecurityAnswers('recovery');
  byId('vault-recovery-reset-fields')?.classList.add('hidden');
  byId('recovery-new-username').value = '';
  byId('recovery-new-passphrase').value = '';
  byId('recovery-new-passphrase-confirm').value = '';
}

function resetSignupState() {
  clearSecurityAnswers('signup');
  byId('vault-signup-username').value = '';
  byId('vault-signup-passphrase').value = '';
  byId('vault-signup-passphrase-confirm').value = '';
  byId('vault-legacy-confirm-passphrase').value = '';
  byId('vault-signup-identity-fields')?.classList.remove('hidden');
  byId('vault-signup-legacy-passphrase')?.classList.add('hidden');
  byId('vault-signup-legacy-note')?.classList.add('hidden');
  pendingLegacyEnrollment = null;
}

async function finishApplication(credentials, successMessage) {
  await startVaultSync(credentials);
  const migration = await adoptVaultEncryptionKey(credentials.encryptionKey);
  activeCredentials = credentials;
  showApplication();
  resetInactivityTimer();
  window.dispatchEvent(new CustomEvent('faith-focus:account-ready', {
    detail: { username: credentials.username, vaultId: credentials.vaultId }
  }));
  if (migration.legacyMigrationRequired) {
    setStatus('vault-login-message', 'Your account is open. This device has older encrypted Diary records that need a one-time migration.', 'info');
  } else {
    setStatus('vault-login-message', successMessage, 'success');
  }
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
  window.addEventListener('faith-focus:lock-account', () => lockAccount('Your account is locked.'));
}

async function startLegacyEnrollment(username, passphrase) {
  const credentials = await deriveLegacyVaultCredentials(username, passphrase);
  try {
    await startVaultSync(credentials);
    await adoptVaultEncryptionKey(credentials.encryptionKey);
    pendingLegacyEnrollment = credentials;
    byId('vault-signup-identity-fields')?.classList.add('hidden');
    byId('vault-signup-legacy-passphrase')?.classList.remove('hidden');
    byId('vault-signup-legacy-note')?.classList.remove('hidden');
    setStatus('vault-signup-message', 'Your existing vault has been verified. Add three recovery questions and confirm a passphrase to finish the one-time account upgrade. Your Vault ID and encrypted packets will be preserved.', 'info');
    showPanel('signup');
  } catch (error) {
    try { await stopVaultSync(); } catch { /* Keep the first failure. */ }
    clearVaultEncryptionKey();
    wipeVaultCredentials(credentials);
    throw error;
  }
}

async function submitVaultLogin(event) {
  event.preventDefault();
  if (accountBusy || activeCredentials) return;
  const username = byId('vault-username')?.value || '';
  const passphraseField = byId('vault-passphrase');
  let passphrase = passphraseField?.value || '';
  const usernameResult = validateVaultUsername(username);
  const passphraseResult = validateVaultPassphrase(passphrase);
  if (!usernameResult.valid) {
    setStatus('vault-login-message', 'Choose a 3–32 character username using letters, numbers, dots, hyphens, or underscores.', 'error');
    byId('vault-username')?.focus();
    return;
  }
  if (!passphraseResult.valid) {
    setStatus('vault-login-message', passphraseResult.message, 'error');
    passphraseField?.focus();
    return;
  }
  if (!window.isSecureContext || !window.crypto?.subtle || !window.crypto?.getRandomValues) {
    setStatus('vault-login-message', 'Secure browser encryption is unavailable. Open Faith & Focus over HTTPS.', 'error');
    return;
  }

  accountBusy = true;
  setBusy('vault-login-submit', true, 'Signing in…', 'Sign In');
  setStatus('vault-login-message', 'Verifying your account…');
  let credentials = null;
  try {
    let accountInfo;
    try {
      accountInfo = await accountRequest('/account/signin', { username: usernameResult.normalized });
    } catch (error) {
      if (error.status === 404 && error.data?.legacyAccount) {
        passphrase = passphraseField?.value || passphrase;
        passphraseField.value = '';
        await startLegacyEnrollment(usernameResult.normalized, passphrase);
        return;
      }
      throw error;
    }
    credentials = await unlockVaultAccount(
      usernameResult.normalized, passphrase,
      accountInfo.vaultId, accountInfo.passphraseEnvelope
    );
    passphrase = '';
    if (passphraseField) passphraseField.value = '';
    setStatus('vault-login-message', 'Opening your Checklist, Diary and Garden…');
    await finishApplication(credentials, 'You are signed in. Your entire account is ready on this device.');
    credentials = null;
  } catch (error) {
    try { await stopVaultSync(); } catch { /* Preserve the original error. */ }
    clearVaultEncryptionKey();
    if (credentials) wipeVaultCredentials(credentials);
    setStatus('vault-login-message', error?.message || 'The account could not be opened.', 'error');
    passphraseField?.focus();
  } finally {
    passphrase = '';
    accountBusy = false;
    setBusy('vault-login-submit', false, 'Signing in…', 'Sign In');
  }
}

async function submitVaultSignup(event) {
  event.preventDefault();
  if (accountBusy || activeCredentials) return;
  accountBusy = true;
  setBusy('vault-signup-submit', true, 'Creating your account…', 'Create Account');
  let credentials = null;
  let passphrase = '';
  try {
    const { questionIds, answers } = readSecurityAnswers('signup');
    if (pendingLegacyEnrollment) {
      passphrase = byId('vault-legacy-confirm-passphrase')?.value || '';
      const passphraseResult = validateVaultPassphrase(passphrase);
      if (!passphraseResult.valid) throw new Error(passphraseResult.message);
      credentials = pendingLegacyEnrollment;
      const passphraseEnvelope = await createPassphraseEnvelope(credentials.masterKeyBytes, passphrase);
      const recoveryEnvelope = await wrapMasterKeyWithRecovery(credentials.masterKeyBytes, questionIds, answers);
      await accountRequest('/account/signup', {
        username: credentials.username, vaultId: credentials.vaultId,
        passphraseEnvelope, recoveryEnvelope, questionIds, answers
      });
      pendingLegacyEnrollment = null;
      clearSecurityAnswers('signup');
      byId('vault-legacy-confirm-passphrase').value = '';
      await finishLegacyApplication(credentials);
      credentials = null;
      return;
    }

    const username = byId('vault-signup-username')?.value || '';
    const passphraseField = byId('vault-signup-passphrase');
    const confirmField = byId('vault-signup-passphrase-confirm');
    passphrase = passphraseField?.value || '';
    const usernameResult = validateVaultUsername(username);
    if (!usernameResult.valid) throw new Error('Choose a 3–32 character username using letters, numbers, dots, hyphens, or underscores.');
    const passphraseResult = validateVaultPassphrase(passphrase);
    if (!passphraseResult.valid) throw new Error(passphraseResult.message);
    if (passphrase !== (confirmField?.value || '')) throw new Error('The passphrases do not match.');

    credentials = await createNewVaultAccount(usernameResult.normalized, passphrase, questionIds, answers);
    await accountRequest('/account/signup', {
      username: credentials.username,
      vaultId: credentials.vaultId,
      passphraseEnvelope: credentials.passphraseEnvelope,
      recoveryEnvelope: credentials.recoveryEnvelope,
      questionIds,
      answers
    });
    passphrase = '';
    if (passphraseField) passphraseField.value = '';
    if (confirmField) confirmField.value = '';
    clearSecurityAnswers('signup');
    await finishApplication(credentials, 'Your account is ready. Your Checklist, Diary and Garden share one sign-in.');
    credentials = null;
    resetSignupState();
  } catch (error) {
    if (credentials && credentials !== pendingLegacyEnrollment) wipeVaultCredentials(credentials);
    setStatus('vault-signup-message', error?.message || 'The account could not be created.', 'error');
  } finally {
    passphrase = '';
    accountBusy = false;
    setBusy('vault-signup-submit', false, 'Creating your account…', 'Create Account');
  }
}

async function finishLegacyApplication(credentials) {
  // The existing vault sync was established during legacy authentication.
  activeCredentials = credentials;
  showApplication();
  resetInactivityTimer();
  window.dispatchEvent(new CustomEvent('faith-focus:account-ready', {
    detail: { username: credentials.username, vaultId: credentials.vaultId }
  }));
}

async function submitRecoveryLookup(event) {
  event.preventDefault();
  if (accountBusy || pendingRecovery) return;
  accountBusy = true;
  setBusy('vault-recovery-verify', true, 'Verifying…', 'Verify Answers');
  try {
    const { questionIds, answers } = readSecurityAnswers('recovery');
    const result = await accountRequest('/account/recovery/lookup', { questionIds, answers });
    const masterKeyBytes = await unwrapMasterKeyWithRecovery(result.recoveryEnvelope, questionIds, answers);
    pendingRecovery = {
      vaultId: result.vaultId,
      username: result.username,
      questionIds,
      answers,
      masterKeyBytes
    };
    byId('vault-recovered-username').textContent = result.username;
    byId('recovery-new-username').value = '';
    byId('vault-recovery-reset-fields')?.classList.remove('hidden');
    setStatus('vault-recovery-message', 'Your account is verified. You may keep your username and passphrase, or change either one now.', 'success');
  } catch (error) {
    setStatus('vault-recovery-message', error?.message || 'Account recovery could not be completed.', 'error');
  } finally {
    accountBusy = false;
    setBusy('vault-recovery-verify', false, 'Verifying…', 'Verify Answers');
  }
}

async function continueRecoveredAccount() {
  if (!pendingRecovery || accountBusy) return;
  accountBusy = true;
  try {
    const credentials = await deriveVaultCredentialsFromMaster(
      pendingRecovery.vaultId, pendingRecovery.masterKeyBytes, pendingRecovery.username
    );
    await finishApplication(credentials, 'Your account has been recovered and opened.');
    resetRecoveryState();
  } catch (error) {
    setStatus('vault-recovery-message', error?.message || 'Your account could not be opened on this device.', 'error');
  } finally {
    accountBusy = false;
  }
}

async function saveRecoveryChanges() {
  if (!pendingRecovery || accountBusy) return;
  accountBusy = true;
  setBusy('vault-recovery-save', true, 'Saving changes…', 'Save Changes & Sign In');
  try {
    const requestedUsername = byId('recovery-new-username')?.value || pendingRecovery.username;
    const newPassphrase = byId('recovery-new-passphrase')?.value || '';
    const confirmation = byId('recovery-new-passphrase-confirm')?.value || '';
    if (newPassphrase && newPassphrase !== confirmation) throw new Error('The new passphrases do not match.');
    if (!newPassphrase && confirmation) throw new Error('Enter a new passphrase or clear the confirmation field.');
    let passphraseEnvelope = null;
    if (newPassphrase) {
      const validation = validateVaultPassphrase(newPassphrase);
      if (!validation.valid) throw new Error(validation.message);
      passphraseEnvelope = await createPassphraseEnvelope(pendingRecovery.masterKeyBytes, newPassphrase);
    }
    const normalizedNewUsername = requestedUsername.trim() ? requestedUsername : pendingRecovery.username;
    if (normalizedNewUsername === pendingRecovery.username && !passphraseEnvelope) {
      throw new Error('No changes were entered. Use “Continue with this account” instead.');
    }
    const update = await accountRequest('/account/recovery/update', {
      questionIds: pendingRecovery.questionIds,
      answers: pendingRecovery.answers,
      vaultId: pendingRecovery.vaultId,
      newUsername: normalizedNewUsername,
      passphraseEnvelope
    });
    const credentials = await deriveVaultCredentialsFromMaster(
      pendingRecovery.vaultId, pendingRecovery.masterKeyBytes, update.username
    );
    byId('recovery-new-passphrase').value = '';
    byId('recovery-new-passphrase-confirm').value = '';
    await finishApplication(credentials, 'Your account details have been updated and your Diary is ready.');
    resetRecoveryState();
  } catch (error) {
    setStatus('vault-recovery-message', error?.message || 'Your recovery changes could not be saved.', 'error');
  } finally {
    accountBusy = false;
    setBusy('vault-recovery-save', false, 'Saving changes…', 'Save Changes & Sign In');
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
  wipeVaultCredentials(activeCredentials);
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
  const signupForm = byId('vault-signup-form');
  const recoveryForm = byId('vault-recovery-form');
  if (!loginForm || !signupForm || !recoveryForm) return;

  populateSecurityQuestions('signup');
  populateSecurityQuestions('recovery');
  loginForm.addEventListener('submit', submitVaultLogin);
  signupForm.addEventListener('submit', submitVaultSignup);
  recoveryForm.addEventListener('submit', submitRecoveryLookup);
  byId('vault-show-signup')?.addEventListener('click', () => {
    resetSignupState();
    setStatus('vault-signup-message', 'Choose a username, a passphrase and three different security questions.', 'info');
    showPanel('signup');
  });
  byId('vault-show-recovery')?.addEventListener('click', () => {
    resetRecoveryState();
    setStatus('vault-recovery-message', 'Choose the same three questions and enter your exact one-word answers.', 'info');
    showPanel('recovery');
  });
  byId('vault-signup-back')?.addEventListener('click', () => {
    if (pendingLegacyEnrollment) {
      stopVaultSync().catch(() => {});
      clearVaultEncryptionKey();
      wipeVaultCredentials(pendingLegacyEnrollment);
      pendingLegacyEnrollment = null;
    }
    showLogin();
  });
  byId('vault-recovery-back')?.addEventListener('click', () => {
    resetRecoveryState();
    showLogin();
  });
  byId('vault-recovery-save')?.addEventListener('click', saveRecoveryChanges);
  byId('vault-recovery-continue')?.addEventListener('click', continueRecoveredAccount);
  byId('vault-lock-button')?.addEventListener('click', () => lockAccount());
  installSessionActivityListeners();
  showLogin();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeVaultSession, { once: true });
} else {
  initializeVaultSession();
}
