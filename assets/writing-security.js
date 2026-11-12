import {
    saveEncryptedVoiceNote, loadEncryptedVoiceNotes,
    exportEncryptedVoiceNotes, restoreEncryptedVoiceNotes,
    validateEncryptedVoiceNoteBackup, encryptVoiceNoteBlob, decryptVoiceNoteRecord
} from './voice-note-store.js';

        const WRITING_CONFIG_KEY='dmp_private_writing_crypto_v1';
        const WRITING_DIARY_PREFIX='dmp_diary_cipher_v1_';
        const WRITING_NOTES_PREFIX='dmp_notes_cipher_v1_';
        const WRITING_KDF_ITERATIONS=600000;
        const WRITING_CHECK_TEXT='Daily Mindful Pokes private writing key check v1';
        const PRIVATE_NOTE_IDS=['note-success','note-priorities','note-gratitude-others','note-gratitude-god'];
        let writingCryptoKey=null,writingLoadedDate=null,writingSaveTimer=null,writingSavePromise=Promise.resolve();
        let vaultPrimaryKey=null,legacyMigrationRequired=false;
        let voiceNoteSavePromise=Promise.resolve();
        let voiceNoteStopHandler=async()=>{};

        function hasWritingCrypto(){return !!(window.isSecureContext&&window.crypto&&window.crypto.subtle&&window.crypto.getRandomValues);}
        function hasLegacyEncryptedPrivateRecords(){
            for(let i=0;i<localStorage.length;i++){
                const key=localStorage.key(i);
                if(/^dmp_(?:diary|notes)_cipher_v1_\d{4}-\d{2}-\d{2}$/.test(key||''))return true;
            }
            return false;
        }

        function hasLegacyPrivateRecords(){
            for(let i=0;i<localStorage.length;i++){
                const key=localStorage.key(i);
                if(/^dmp_(?:diary|notes)_cipher_v1_\d{4}-\d{2}-\d{2}$/.test(key||''))return true;
                if(/^private_diary_\d{4}-\d{2}-\d{2}$/.test(key||''))return true;
                if(/^mindful_pokes_data_\d{4}-\d{2}-\d{2}$/.test(key||'')){
                    try{
                        const data=JSON.parse(localStorage.getItem(key)||'{}');
                        if(PRIVATE_NOTE_IDS.some(id=>typeof data?.[id]==='string'&&data[id].length>0))return true;
                    }catch(error){return true;}
                }
            }
            return false;
        }

        export async function adoptVaultEncryptionKey(key){
            if(!key)throw new TypeError('A vault encryption key is required.');
            vaultPrimaryKey=key;
            const voiceNotes=await exportEncryptedVoiceNotes();
            legacyMigrationRequired=hasLegacyEncryptedPrivateRecords()||voiceNotes.length>0;
            if(legacyMigrationRequired){
                writingCryptoKey=null;
                writingLoadedDate=null;
                updatePrivateWritingAccess();
                setWritingSecurityStatus('This device has older encrypted Diary data. Enter its previous Diary passphrase once to migrate it to your new account. The original entries are preserved until migration succeeds.','info');
                return {legacyMigrationRequired:true};
            }
            writingCryptoKey=vaultPrimaryKey;
            writingLoadedDate=null;
            localStorage.removeItem(WRITING_CONFIG_KEY);
            await migrateLegacyPrivateWriting(writingCryptoKey);
            updatePrivateWritingAccess();
            return {legacyMigrationRequired:false};
        }

        export function clearVaultEncryptionKey(){
            vaultPrimaryKey=null;
            writingCryptoKey=null;
            writingLoadedDate=null;
            legacyMigrationRequired=false;
            updatePrivateWritingAccess();
        }

        async function migrateEncryptedPrivateRecords(sourceKey,targetKey){
            const dates=new Set();
            for(let i=0;i<localStorage.length;i++){
                const key=localStorage.key(i);
                let match=key&&key.match(/^dmp_diary_cipher_v1_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
                match=key&&key.match(/^dmp_notes_cipher_v1_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
            }
            const migrated=[];
            for(const dateStr of dates){
                const diaryKey=getSecureWritingStorageKey('diary',dateStr);
                const notesKey=getSecureWritingStorageKey('notes',dateStr);
                const diaryRecord=localStorage.getItem(diaryKey);
                const notesRecord=localStorage.getItem(notesKey);
                const nextDiary=diaryRecord===null?null:await encryptPrivatePayload('diary',dateStr,await decryptPrivatePayload('diary',dateStr,diaryRecord,sourceKey),targetKey);
                const nextNotes=notesRecord===null?null:await encryptPrivatePayload('notes',dateStr,await decryptPrivatePayload('notes',dateStr,notesRecord,sourceKey),targetKey);
                migrated.push({diaryKey,notesKey,nextDiary,nextNotes});
            }

            const voiceRecords=await exportEncryptedVoiceNotes();
            const nextVoiceRecords=[];
            for(const record of voiceRecords){
                const blob=await decryptVoiceNoteRecord(record,sourceKey);
                nextVoiceRecords.push(await encryptVoiceNoteBlob(blob,targetKey,record.dateString,record.id,record.capturedAt));
            }

            migrated.forEach(item=>{
                if(item.nextDiary!==null)localStorage.setItem(item.diaryKey,item.nextDiary);
                if(item.nextNotes!==null)localStorage.setItem(item.notesKey,item.nextNotes);
            });
            if(voiceRecords.length)await restoreEncryptedVoiceNotes(nextVoiceRecords);
            localStorage.removeItem(WRITING_CONFIG_KEY);
            writingCryptoKey=targetKey;
            writingLoadedDate=null;
            legacyMigrationRequired=false;
        }

        function bytesToBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
        function base64ToBytes(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
        async function derivePrivateWritingKey(passphrase,salt,iterations=WRITING_KDF_ITERATIONS){
            const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
            return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
        }
        function getSecureWritingStorageKey(kind,dateStr){return (kind==='diary'?WRITING_DIARY_PREFIX:WRITING_NOTES_PREFIX)+dateStr;}
        function getWritingAad(kind,dateStr){return new TextEncoder().encode('Daily Mindful Pokes|private-writing|'+kind+'|v1|'+dateStr);}
        async function encryptPrivatePayload(kind,dateStr,value,key=writingCryptoKey){
            if(!key)throw new Error('Private writing is locked.');
            const iv=crypto.getRandomValues(new Uint8Array(12));
            const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:getWritingAad(kind,dateStr),tagLength:128},key,new TextEncoder().encode(JSON.stringify(value)));
            return JSON.stringify({version:1,algorithm:'AES-256-GCM',iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(ciphertext))});
        }
        async function decryptPrivatePayload(kind,dateStr,record,key=writingCryptoKey){
            if(!key)throw new Error('Private writing is locked.');
            const encrypted=typeof record==='string'?JSON.parse(record):record;
            if(!encrypted||encrypted.version!==1||encrypted.algorithm!=='AES-256-GCM')throw new Error('Unsupported encrypted writing format.');
            const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(encrypted.iv),additionalData:getWritingAad(kind,dateStr),tagLength:128},key,base64ToBytes(encrypted.ciphertext));
            return JSON.parse(new TextDecoder().decode(plaintext));
        }
        function getCurrentWritingDate(){
            const input=document.getElementById('currentDate');
            if(input&&input.value)return input.value;
            const now=new Date();
            return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
        }
        function setWritingSecurityStatus(message,state='info'){
            const status=document.getElementById('diary-security-status');
            if(status){status.textContent=message;status.dataset.state=state;}
            const saveStatus=document.getElementById('writing-save-status');
            if(saveStatus&&state==='error')saveStatus.textContent=message;
        }
        function renderDiarySecurityUI(){
            const configured=!!localStorage.getItem(WRITING_CONFIG_KEY);
            const heading=document.getElementById('diary-lock-heading'),intro=document.getElementById('diary-lock-intro');
            const confirmWrap=document.getElementById('diary-confirm-wrap'),button=document.getElementById('diary-key-action');
            if(writingCryptoKey){document.getElementById('diary-lock-panel')?.classList.add('hidden');document.getElementById('diary-editor-panel')?.classList.remove('hidden');return;}
            document.getElementById('diary-lock-panel')?.classList.remove('hidden');
            document.getElementById('diary-editor-panel')?.classList.add('hidden');
            if(heading)heading.textContent=legacyMigrationRequired?'One-time Diary migration':configured?'Unlock your private writing':'Create your private writing key';
            if(intro)intro.textContent=legacyMigrationRequired
                ?'This device contains Diary entries encrypted before your unified account was created. Enter the old Diary passphrase once to migrate them to your account key. Your old records will remain untouched unless migration succeeds.'
                :configured?'Enter your passphrase to decrypt your diary and checklist reflections on this device.':'Private writing is protected by your unified account passphrase.';
            confirmWrap?.classList.toggle('hidden',configured||legacyMigrationRequired||!!vaultPrimaryKey);
            if(button)button.textContent=legacyMigrationRequired?'Migrate existing Diary':configured?'Unlock private writing':'Continue';
            const pass=document.getElementById('diary-passphrase');
            if(pass){pass.autocomplete='current-password';pass.placeholder=legacyMigrationRequired?'Enter your previous Diary passphrase':'Diary is protected by your account login';}
        }
        function updatePrivateWritingAccess(){
            const unlocked=!!writingCryptoKey;
            document.querySelectorAll('#private-diary-entry,.text-input').forEach(field=>{field.disabled=!unlocked;if(!unlocked)field.value='';});
            document.getElementById('writing-lock-hint')?.classList.toggle('hidden',unlocked);
            const lockButton=document.querySelector('#diary-editor-panel [data-action="lockPrivateWriting"]');
            if(lockButton)lockButton.classList.toggle('hidden',!unlocked);
            renderDiarySecurityUI();
            if(unlocked){const status=document.getElementById('writing-save-status');if(status)status.textContent='Private writing and voice notes are encrypted on this device.';}
            else document.dispatchEvent(new CustomEvent('private-writing:locked'));
        }
        async function migrateLegacyPrivateWriting(key){
            const dates=new Set();
            for(let i=0;i<localStorage.length;i++){
                const storageKey=localStorage.key(i);
                let match=storageKey&&storageKey.match(/^private_diary_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
                match=storageKey&&storageKey.match(/^mindful_pokes_data_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
            }
            for(const dateStr of dates){
                const oldDiaryKey='private_diary_'+dateStr,oldDiary=localStorage.getItem(oldDiaryKey);
                const appDataKey='mindful_pokes_data_'+dateStr,rawAppData=localStorage.getItem(appDataKey);
                let appData={},valid=true;
                if(rawAppData){try{appData=JSON.parse(rawAppData)||{};}catch(error){valid=false;}}
                const secureDiaryKey=getSecureWritingStorageKey('diary',dateStr);
                if(oldDiary!==null&&!localStorage.getItem(secureDiaryKey))localStorage.setItem(secureDiaryKey,await encryptPrivatePayload('diary',dateStr,oldDiary,key));
                if(oldDiary!==null)localStorage.removeItem(oldDiaryKey);
                if(valid&&rawAppData){
                    const hadFields=PRIVATE_NOTE_IDS.some(id=>Object.prototype.hasOwnProperty.call(appData,id));
                    const legacyNotes={};let hasContent=false;
                    PRIVATE_NOTE_IDS.forEach(id=>{if(typeof appData[id]==='string'){legacyNotes[id]=appData[id];hasContent=hasContent||appData[id].length>0;}delete appData[id];});
                    const secureNotesKey=getSecureWritingStorageKey('notes',dateStr);
                    if(hasContent&&!localStorage.getItem(secureNotesKey))localStorage.setItem(secureNotesKey,await encryptPrivatePayload('notes',dateStr,legacyNotes,key));
                    if(hadFields)localStorage.setItem(appDataKey,JSON.stringify(appData));
                }
            }
        }
        async function handleDiaryKeyAction(){
            const passInput=document.getElementById('diary-passphrase'),confirmInput=document.getElementById('diary-passphrase-confirm'),button=document.getElementById('diary-key-action');
            const passphrase=passInput.value,configText=localStorage.getItem(WRITING_CONFIG_KEY);
            if(!hasWritingCrypto()){setWritingSecurityStatus('Secure browser encryption is unavailable. Open this app over HTTPS in a modern browser.','error');return;}
            if(!passphrase||passphrase.length<16){setWritingSecurityStatus('Please use a passphrase with at least 16 characters. Several unrelated words work well.','error');return;}
            button.disabled=true;button.textContent='Securing private writing…';
            try{
                let key;
                if(!configText){
                    if(passphrase!==confirmInput.value)throw new Error('The two passphrases do not match.');
                    const salt=crypto.getRandomValues(new Uint8Array(16));
                    key=await derivePrivateWritingKey(passphrase,salt,WRITING_KDF_ITERATIONS);
                    const verifyIv=crypto.getRandomValues(new Uint8Array(12));
                    const verifier=await crypto.subtle.encrypt({name:'AES-GCM',iv:verifyIv,additionalData:new TextEncoder().encode('Daily Mindful Pokes|key-verifier|v1'),tagLength:128},key,new TextEncoder().encode(WRITING_CHECK_TEXT));
                    localStorage.setItem(WRITING_CONFIG_KEY,JSON.stringify({version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-HMAC-SHA-256',iterations:WRITING_KDF_ITERATIONS,salt:bytesToBase64(salt),verifierIv:bytesToBase64(verifyIv),verifierCiphertext:bytesToBase64(new Uint8Array(verifier))}));
                }else{
                    const config=JSON.parse(configText);
                    if(config.version!==1||config.algorithm!=='AES-256-GCM'||config.kdf!=='PBKDF2-HMAC-SHA-256'||config.iterations!==WRITING_KDF_ITERATIONS)throw new Error('The saved encryption settings are unsupported or have been changed.');
                    key=await derivePrivateWritingKey(passphrase,base64ToBytes(config.salt),config.iterations);
                    let verified;
                    try{verified=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(config.verifierIv),additionalData:new TextEncoder().encode('Daily Mindful Pokes|key-verifier|v1'),tagLength:128},key,base64ToBytes(config.verifierCiphertext));}
                    catch(error){throw new Error('The passphrase did not match.');}
                    if(new TextDecoder().decode(verified)!==WRITING_CHECK_TEXT)throw new Error('The passphrase did not match.');
                }
                if(vaultPrimaryKey&&legacyMigrationRequired){
                    await migrateLegacyPrivateWriting(key);
                    await migrateEncryptedPrivateRecords(key,vaultPrimaryKey);
                }else if(vaultPrimaryKey){
                    writingCryptoKey=vaultPrimaryKey;
                }else{
                    writingCryptoKey=key;
                    await migrateLegacyPrivateWriting(key);
                }
                await loadPrivateWritingForDate(getCurrentWritingDate());
                updatePrivateWritingAccess();
                const saveStatus=document.getElementById('writing-save-status');
                if(saveStatus)saveStatus.textContent='Encrypted writing is unlocked for this session.';
            }catch(error){
                writingCryptoKey=null;writingLoadedDate=null;updatePrivateWritingAccess();
                const message=error?.message==='The passphrase did not match.'
                    ?'That passphrase did not unlock this writing. Please check it and try again.'
                    :error?.message==='The two passphrases do not match.'
                        ?error.message
                        :'Could not unlock or migrate private writing. Existing entries were left in place. '+(error?.message||'');
                setWritingSecurityStatus(message,'error');
            }finally{passInput.value='';confirmInput.value='';button.disabled=false;renderDiarySecurityUI();}
        }
        function getPrivateWritingPayload(){
            const diary=document.getElementById('private-diary-entry')?.value||'',notes={};
            PRIVATE_NOTE_IDS.forEach(id=>{notes[id]=document.getElementById(id)?.value||'';});
            return {diary,notes};
        }
        async function savePrivateWritingForDate(dateStr=writingLoadedDate){
            if(!writingCryptoKey||!dateStr||writingLoadedDate!==dateStr)return;
            const key=writingCryptoKey,payload=getPrivateWritingPayload();
            const task=async()=>{
                const diary=await encryptPrivatePayload('diary',dateStr,payload.diary,key);
                const notes=await encryptPrivatePayload('notes',dateStr,payload.notes,key);
                localStorage.setItem(getSecureWritingStorageKey('diary',dateStr),diary);
                localStorage.setItem(getSecureWritingStorageKey('notes',dateStr),notes);
                window.dispatchEvent(new Event('faith-focus:local-data-changed'));
                const status=document.getElementById('writing-save-status');
                if(status&&writingCryptoKey)status.textContent='Saved securely on this device.';
            };
            writingSavePromise=writingSavePromise.then(task,task);
            return writingSavePromise;
        }
        function schedulePrivateWritingSave(){
            if(!writingCryptoKey||!writingLoadedDate)return;
            if(writingSaveTimer)clearTimeout(writingSaveTimer);
            writingSaveTimer=setTimeout(()=>{
                writingSaveTimer=null;
                savePrivateWritingForDate(writingLoadedDate).catch(error=>setWritingSecurityStatus('Encrypted autosave failed. Your text is still visible; do not lock or close the page until saving succeeds. '+(error?.message||''),'error'));
            },500);
        }
        export async function readPrivateDiaryEntryForDate(dateStr){
            if(!writingCryptoKey)throw new Error('Unlock your Diary to read archived entries.');
            if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr))throw new TypeError('The archive date is invalid.');
            const record=localStorage.getItem(getSecureWritingStorageKey('diary',dateStr));
            if(!record)return '';
            const value=await decryptPrivatePayload('diary',dateStr,record,writingCryptoKey);
            return typeof value==='string'?value:'';
        }

        async function loadPrivateWritingForDate(dateStr){
            if(!writingCryptoKey)return;
            if(writingSaveTimer){clearTimeout(writingSaveTimer);writingSaveTimer=null;}
            await writingSavePromise;
            let diaryText='',notes={};
            const diaryRecord=localStorage.getItem(getSecureWritingStorageKey('diary',dateStr)),notesRecord=localStorage.getItem(getSecureWritingStorageKey('notes',dateStr));
            if(diaryRecord)diaryText=await decryptPrivatePayload('diary',dateStr,diaryRecord,writingCryptoKey);
            if(notesRecord)notes=await decryptPrivatePayload('notes',dateStr,notesRecord,writingCryptoKey);
            document.getElementById('private-diary-entry').value=typeof diaryText==='string'?diaryText:'';
            PRIVATE_NOTE_IDS.forEach(id=>{const field=document.getElementById(id);if(field)field.value=typeof notes[id]==='string'?notes[id]:'';});
            writingLoadedDate=dateStr;
        }
        async function lockPrivateWriting(){
            if(vaultPrimaryKey){
                window.dispatchEvent(new Event('faith-focus:lock-account'));
                return;
            }
            if(!writingCryptoKey)return;
            if(writingSaveTimer){clearTimeout(writingSaveTimer);writingSaveTimer=null;}
            try{
                await stopRegisteredVoiceNoteRecording();
                await flushPrivateVoiceNoteQueue();
                await savePrivateWritingForDate(writingLoadedDate);
                await writingSavePromise;
                writingCryptoKey=null;writingLoadedDate=null;updatePrivateWritingAccess();
                setWritingSecurityStatus('Locked. Your saved private writing and voice notes remain encrypted on this device.','info');
            }catch(error){setWritingSecurityStatus('Could not finish encrypted saving, so the writing remains unlocked. '+(error?.message||''),'error');}
        }



export function registerVoiceNoteStopHandler(handler){
    voiceNoteStopHandler=typeof handler==='function'?handler:async()=>{};
}
export async function stopRegisteredVoiceNoteRecording(){
    await voiceNoteStopHandler();
}
export function savePrivateVoiceNoteForDate(dateStr,blob){
    if(!writingCryptoKey) return Promise.reject(new Error('Unlock your Diary before saving a voice note.'));
    const key=writingCryptoKey;
    const task=()=>saveEncryptedVoiceNote(dateStr,blob,key);
    voiceNoteSavePromise=voiceNoteSavePromise.then(task,task).then(result=>{
        window.dispatchEvent(new Event('faith-focus:local-data-changed'));
        return result;
    });
    return voiceNoteSavePromise;
}
export async function loadPrivateVoiceNotesForDate(dateStr){
    await voiceNoteSavePromise;
    if(!writingCryptoKey)throw new Error('Unlock your Diary to play saved voice notes.');
    return loadEncryptedVoiceNotes(dateStr,writingCryptoKey);
}
export async function flushPrivateVoiceNoteQueue(){
    await voiceNoteSavePromise;
}
export async function exportPrivateVoiceNotes(){
    return exportEncryptedVoiceNotes();
}
export async function restorePrivateVoiceNotes(records){
    if(!validateEncryptedVoiceNoteBackup(records))throw new Error('The backup contains invalid encrypted voice-note records.');
    await restoreEncryptedVoiceNotes(records);
}
export function validatePrivateVoiceNoteBackup(records){
    return validateEncryptedVoiceNoteBackup(records);
}

export async function flushPrivateWritingQueue(){
    await stopRegisteredVoiceNoteRecording();
    await flushPrivateVoiceNoteQueue();
    if(writingSaveTimer){
        clearTimeout(writingSaveTimer);
        writingSaveTimer=null;
        if(writingCryptoKey&&writingLoadedDate)await savePrivateWritingForDate(writingLoadedDate);
    }
    await writingSavePromise;
}
export async function flushAndSaveCurrentPrivateWriting(){
    await flushPrivateWritingQueue();
    if(writingCryptoKey&&writingLoadedDate)await savePrivateWritingForDate(writingLoadedDate);
    await writingSavePromise;
}
export {
    WRITING_CONFIG_KEY,WRITING_DIARY_PREFIX,WRITING_NOTES_PREFIX,PRIVATE_NOTE_IDS,
    writingCryptoKey,writingLoadedDate,hasWritingCrypto,getSecureWritingStorageKey,getCurrentWritingDate,
    setWritingSecurityStatus,renderDiarySecurityUI,updatePrivateWritingAccess,
    handleDiaryKeyAction,lockPrivateWriting,savePrivateWritingForDate,loadPrivateWritingForDate,schedulePrivateWritingSave
};
