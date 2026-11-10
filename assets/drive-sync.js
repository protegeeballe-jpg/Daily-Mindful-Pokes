import { compressData, decompressData } from './compressor.js';

// TODO: Replace with your actual Google OAuth 2.0 Client ID from Google Cloud Console
const CLIENT_ID = '717523562646-lht84sbcpfnn6q330nd5683pjc59dhdh.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let accessToken = null;

document.addEventListener('DOMContentLoaded', () => {
  initGoogleIdentityService();
  setupUIEventListeners();
});

function initGoogleIdentityService() {
  if (typeof google === 'undefined' || !google.accounts) {
    console.warn('Google Identity Services script not loaded yet.');
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        accessToken = tokenResponse.access_token;
        document.getElementById('drive-sync-status').textContent = 'Connected to Google Drive successfully!';
        
        // Reveal the backup/restore action buttons
        document.getElementById('drive-sync-actions').classList.remove('hidden');
        document.getElementById('drive-connect-button').textContent = 'Connected (Google Drive)';

        // Run local auto-compression and caching on successful login (NO cloud sync)
        await handleSuccessfulLogin();
      }
    },
  });
}

function setupUIEventListeners() {
  const connectBtn = document.getElementById('drive-connect-button');
  const backupBtn = document.getElementById('drive-backup-button');
  const restoreBtn = document.getElementById('drive-restore-button');

  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      if (!tokenClient) {
        initGoogleIdentityService();
      }
      if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: '' });
      } else {
        alert('Google Identity service failed to initialize. Check your internet connection.');
      }
    });
  }

  if (backupBtn) {
    backupBtn.addEventListener('click', () => backupToDrive());
  }

  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => restoreFromDrive());
  }
}

/**
 * Automatically compresses and saves local state to device storage on login.
 * Google Drive upload is NOT triggered here.
 */
async function handleSuccessfulLogin() {
  console.log('Login successful! Running local auto-compression pipeline...');
  try {
    const rawChecklist = localStorage.getItem('checklist_data') || '{}';
    const rawDiary = localStorage.getItem('private_diary_data') || '{}';
    
    let parsedChecklist = {};
    try {
      parsedChecklist = JSON.parse(rawChecklist);
    } catch (e) {
      console.warn('Malformed checklist data found, defaulting to empty.');
    }

    const payload = JSON.stringify({
      checklist: parsedChecklist,
      diary: rawDiary,
      timestamp: new Date().toISOString()
    });

    // Compress payload for low-memory storage footprint
    const compressedPayload = await compressData(payload);

    // Save compressed string locally on device
    localStorage.setItem('faith_focus_compressed_backup', compressedPayload);
    console.log('Data successfully compressed and saved locally.');
  } catch (err) {
    console.error('Local auto-compression on login failed:', err);
  }
}

/**
 * Manual Google Drive Backup triggered by clicking "Back Up This Device"
 */
async function backupToDrive() {
  if (!accessToken) {
    alert('Please connect to Google Drive first.');
    return;
  }

  const statusEl = document.getElementById('drive-sync-status');
  statusEl.textContent = 'Backing up to Google Drive...';

  try {
    let compressedPayload = localStorage.getItem('faith_focus_compressed_backup');
    
    if (!compressedPayload) {
      const rawChecklist = localStorage.getItem('checklist_data') || '{}';
      const rawDiary = localStorage.getItem('private_diary_data') || '{}';
      const payload = JSON.stringify({
        checklist: JSON.parse(rawChecklist),
        diary: rawDiary,
        timestamp: new Date().toISOString()
      });
      compressedPayload = await compressData(payload);
      localStorage.setItem('faith_focus_compressed_backup', compressedPayload);
    }

    const fileMetadata = { name: 'faith-focus-armor-backup.gz', parents: ['appDataFolder'] };
    const file = new Blob([compressedPayload], { type: 'application/gzip' });

    // Search existing backup in hidden appDataFolder
    const searchRes = await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'faith-focus-armor-backup.gz'+and+trashed%3Dfalse", {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    
    if (!searchRes.ok) {
      throw new Error(`Drive search failed (HTTP ${searchRes.status})`);
    }
    
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      const fileId = searchData.files[0].id;
      const patchRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/gzip'
        },
        body: file
      });
      if (!patchRes.ok) throw new Error(`Drive update failed (HTTP ${patchRes.status})`);
    } else {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json; charset=UTF-8' }));
      form.append('file', file);
      
      const postRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
        body: form
      });
      if (!postRes.ok) throw new Error(`Drive upload failed (HTTP ${postRes.status})`);
    }

    statusEl.textContent = 'Backup completed successfully! ☁️✨';
  } catch (err) {
    console.error('Backup failed:', err);
    statusEl.textContent = 'Backup failed. Please reconnect and try again.';
  }
}

/**
 * Manual Restore triggered by clicking "Restore From Drive"
 */
async function restoreFromDrive() {
  if (!accessToken) {
    alert('Please connect to Google Drive first.');
    return;
  }

  const statusEl = document.getElementById('drive-sync-status');
  statusEl.textContent = 'Restoring from Google Drive...';

  try {
    const searchRes = await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'faith-focus-armor-backup.gz'+and+trashed%3Dfalse", {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    
    if (!searchRes.ok) {
      throw new Error(`Drive search failed (HTTP ${searchRes.status})`);
    }

    const searchData = await searchRes.json();

    if (!searchData.files || searchData.files.length === 0) {
      statusEl.textContent = 'No backup file found in Google Drive app data.';
      return;
    }

    const fileId = searchData.files[0].id;
    const fileRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    
    if (!fileRes.ok) {
      throw new Error(`Failed to download backup (HTTP ${fileRes.status})`);
    }

    const compressedText = await fileRes.text();
    const decompressedJsonString = await decompressData(compressedText);
    const parsedData = JSON.parse(decompressedJsonString);

    if (parsedData.checklist) {
      localStorage.setItem('checklist_data', JSON.stringify(parsedData.checklist));
    }
    if (parsedData.diary) {
      localStorage.setItem('private_diary_data', parsedData.diary);
    }

    statusEl.textContent = 'Restore completed successfully! Refreshing app...';
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    console.error('Restore failed:', err);
    statusEl.textContent = 'Restore failed. Check console for details.';
  }
}