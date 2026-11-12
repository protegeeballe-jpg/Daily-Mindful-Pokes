const DATABASE_NAME = 'faith_focus_vault_packets_v1';
const DATABASE_VERSION = 1;
const PACKET_STORE = 'dailyPackets';

let databasePromise = null;

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('This browser does not support IndexedDB. Local encrypted vault packets cannot be stored.'));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PACKET_STORE)) {
        const store = database.createObjectStore(PACKET_STORE, { keyPath: 'dateString' });
        store.createIndex('dirty', 'dirty', { unique: false });
        store.createIndex('remoteUpdatedAt', 'remoteUpdatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error('Could not open local encrypted vault storage.'));
    };
    request.onblocked = () => reject(new Error('Local vault storage is busy in another tab.'));
  });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local vault storage request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Local vault storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local vault storage transaction was interrupted.'));
  });
}

export async function getLocalDailyPacket(dateString) {
  const database = await openDatabase();
  const transaction = database.transaction(PACKET_STORE, 'readonly');
  const done = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(PACKET_STORE).get(dateString));
  await done;
  return result || null;
}

export async function listLocalDailyPackets() {
  const database = await openDatabase();
  const transaction = database.transaction(PACKET_STORE, 'readonly');
  const done = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(PACKET_STORE).getAll());
  await done;
  return result;
}

export async function putLocalDailyPacket(record) {
  if (!record || !/^\d{4}-\d{2}-\d{2}$/.test(record.dateString)
      || !record.packet || typeof record.packet !== 'object'
      || !Number.isFinite(record.localUpdatedAt)
      || typeof record.dirty !== 'boolean') {
    throw new TypeError('Invalid local daily packet record.');
  }
  const database = await openDatabase();
  const transaction = database.transaction(PACKET_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(PACKET_STORE).put({
    dateString: record.dateString,
    packet: record.packet,
    localUpdatedAt: record.localUpdatedAt,
    remoteUpdatedAt: record.remoteUpdatedAt || null,
    dirty: record.dirty
  });
  await done;
}

export async function markLocalDailyPacketSynced(dateString, remoteUpdatedAt, packet = null, { requirePacketMatch = false } = {}) {
  const existing = await getLocalDailyPacket(dateString);
  if (!existing) throw new Error('The local daily packet no longer exists.');
  const stillMatchesUploadedSnapshot = !requirePacketMatch
    || (packet && JSON.stringify(existing.packet) === JSON.stringify(packet));
  await putLocalDailyPacket({
    ...existing,
    packet: requirePacketMatch && !stillMatchesUploadedSnapshot ? existing.packet : (packet || existing.packet),
    localUpdatedAt: existing.localUpdatedAt,
    remoteUpdatedAt,
    // A newer local packet may have been saved while the upload was in flight.
    // Preserve its dirty state so the newer packet is uploaded against this version.
    dirty: stillMatchesUploadedSnapshot ? false : true
  });
  return { stillMatchesUploadedSnapshot };
}

export async function importLocalDailyPackets(records) {
  if (!Array.isArray(records) || records.length > 5000
      || records.some(record => !record || !record.packet || !/^\d{4}-\d{2}-\d{2}$/.test(record.dateString))) {
    throw new TypeError('The local vault export contains invalid daily packets.');
  }
  const database = await openDatabase();
  const transaction = database.transaction(PACKET_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(PACKET_STORE);
  records.forEach(record => store.put({
    dateString: record.dateString,
    packet: record.packet,
    localUpdatedAt: Date.now(),
    remoteUpdatedAt: typeof record.remoteUpdatedAt === 'string' ? record.remoteUpdatedAt : null,
    dirty: true
  }));
  await done;
}

export async function clearLocalDailyPackets() {
  const database = await openDatabase();
  const transaction = database.transaction(PACKET_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(PACKET_STORE).clear();
  await done;
}
