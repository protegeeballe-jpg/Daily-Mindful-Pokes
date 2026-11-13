import {
    saveEncryptedVoiceNote, loadEncryptedVoiceNotes,
    exportEncryptedVoiceNotes, restoreEncryptedVoiceNotes,
    validateEncryptedVoiceNoteBackup, encryptVoiceNoteBlob, decryptVoiceNoteRecord,
    quarantineLegacyWritingRecords
} from './voice-note-store.js';
import { isRecordReadableWithKey, migrateRecordToTargetKey } from './private-writing-migration.js';
import { mergePrivateWritingText } from './daily-merge.js';

        const WRITING_CONFIG_KEY='dmp_private_writing_crypto_v1';
        const WRITING_DIARY_PREFIX='dmp_diary_cipher_v1_';
        const WRITING_NOTES_PREFIX='dmp_notes_cipher_v1_';
        const WRITING_KDF_ITERATIONS=600000;
        const WRITING_CHECK_TEXT='Daily Mindful Pokes private writing key check v1';
        const PRIVATE_NOTE_IDS=['note-success','note-priorities','note-gratitude-others','note-gratitude-god'];
        const PRIVATE_NOTE_META_KEY='__privateNoteUpdatedAt';
        let writingCryptoKey=null,writingLoadedDate=null,writingSaveTimer=null,writingSavePromise=Promise.resolve();
        let writingLoadedNoteValues=null,writingLoadedNoteMeta={};
        let vaultPrimaryKey=null,legacyMigrationRequired=false,legacyKeyUnavailable=false;
        let voiceNoteSavePromise=Promise.resolve();
        let voiceNoteStopHandler=async()=>{};

        function hasWritingCrypto(){return !!(window.isSecureContext&&window.crypto&&window.crypto.subtle&&window.crypto.getRandomValues);}
        async function hasEncryptedRecordsOutsideKey(accountKey,voiceNotes){
            for(let index=0;index<localStorage.length;index++){
                const storageKey=localStorage.key(index);
                const match=storageKey&&storageKey.match(/^dmp_(diary|notes)_cipher_v1_(\d{4}-\d{2}-\d{2})$/);
                if(!match)continue;
                const kind=match[1],dateString=match[2],record=localStorage.getItem(storageKey);
                if(!await isRecordReadableWithKey(record,value=>decryptPrivatePayload(kind,dateString,value,accountKey)))return true;
            }
            for(const record of voiceNotes){
                if(!await isRecordReadableWithKey(record,value=>decryptVoiceNoteRecord(value,accountKey)))return true;
            }
            return false;
        }

        async function hasLegacyEncryptedRecordReadableWithKey(key){
            for(let index=0;index<localStorage.length;index++){
                const storageKey=localStorage.key(index);
                const match=storageKey&&storageKey.match(/^dmp_(diary|notes)_cipher_v1_(\d{4}-\d{2}-\d{2})$/);
                if(!match)continue;
                const kind=match[1],dateString=match[2],record=localStorage.getItem(storageKey);
                if(await isRecordReadableWithKey(record,value=>decryptPrivatePayload(kind,dateString,value,key)))return true;
            }
            const voiceNotes=await exportEncryptedVoiceNotes();
            for(const record of voiceNotes){
                if(await isRecordReadableWithKey(record,value=>decryptVoiceNoteRecord(value,key)))return true;
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
            const legacyConfigExists=Boolean(localStorage.getItem(WRITING_CONFIG_KEY));
            const encryptedRecordsNeedPreviousKey=await hasEncryptedRecordsOutsideKey(vaultPrimaryKey,voiceNotes);
            legacyMigrationRequired=encryptedRecordsNeedPreviousKey;
            legacyKeyUnavailable=!legacyConfigExists&&encryptedRecordsNeedPreviousKey;
            if(legacyMigrationRequired){
                writingCryptoKey=null;
                writingLoadedDate=null;
                updatePrivateWritingAccess();
                setWritingSecurityStatus('Some Diary records still use this device’s previous writing key. Enter the previous Diary passphrase once to migrate only those records. Entries already protected by your account key will be kept as they are.','info');
                return {legacyMigrationRequired:true};
            }
            if(legacyKeyUnavailable){
                writingCryptoKey=null;
                writingLoadedDate=null;
                updatePrivateWritingAccess();
                setWritingSecurityStatus('Some encrypted Diary entries still need the previous Diary key, and its saved settings are missing on this device. Enter your previous Diary passphrase to try recovery. Your original encrypted entries remain untouched unless the correct key can open them.','info');
                return {legacyMigrationRequired:false,legacyKeyUnavailable:true};
            }
            writingCryptoKey=vaultPrimaryKey;
            writingLoadedDate=null;
            await migrateLegacyPrivateWriting(writingCryptoKey);
            await loadPrivateWritingForDate(getCurrentWritingDate());
            // Remove the obsolete verifier only after current-key records and
            // legacy plaintext have both been loaded successfully.
            localStorage.removeItem(WRITING_CONFIG_KEY);
            legacyKeyUnavailable=false;
            updatePrivateWritingAccess();
            return {legacyMigrationRequired:false,legacyKeyUnavailable:false};
        }

        export function clearVaultEncryptionKey(){
            vaultPrimaryKey=null;
            writingCryptoKey=null;
            writingLoadedDate=null;
            writingLoadedNoteValues=null;
            writingLoadedNoteMeta={};
            legacyMigrationRequired=false;
            legacyKeyUnavailable=false;
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
            const quarantined=[];
            const quarantine=(kind,id,dateString,record,error)=>{
                const reason=String(error?.message||error||'Unspecified conversion error');
                quarantined.push({kind,id,dateString,record,reason});
                console.error('[Diary migration] Record quarantined in local IndexedDB; original ciphertext preserved.',{
                    kind,id,dateString,reason,error
                });
            };

            for(const dateStr of dates){
                const diaryKey=getSecureWritingStorageKey('diary',dateStr);
                const notesKey=getSecureWritingStorageKey('notes',dateStr);
                const diaryRecord=localStorage.getItem(diaryKey);
                const notesRecord=localStorage.getItem(notesKey);
                let nextDiary=diaryRecord,nextNotes=notesRecord;
                let quarantineDiary=false,quarantineNotes=false;

                if(diaryRecord!==null){
                    try{
                        nextDiary=await migrateRecordToTargetKey(diaryRecord,{
                            decryptTarget:value=>decryptPrivatePayload('diary',dateStr,value,targetKey),
                            decryptLegacy:value=>decryptPrivatePayload('diary',dateStr,value,sourceKey),
                            encryptTarget:value=>encryptPrivatePayload('diary',dateStr,value,targetKey)
                        });
                    }catch(error){
                        quarantine('diary',dateStr,dateStr,diaryRecord,error);
                        nextDiary=null;
                        quarantineDiary=true;
                    }
                }
                if(notesRecord!==null){
                    try{
                        nextNotes=await migrateRecordToTargetKey(notesRecord,{
                            decryptTarget:value=>decryptPrivatePayload('notes',dateStr,value,targetKey),
                            decryptLegacy:value=>decryptPrivatePayload('notes',dateStr,value,sourceKey),
                            encryptTarget:value=>encryptPrivatePayload('notes',dateStr,value,targetKey)
                        });
                    }catch(error){
                        quarantine('notes',dateStr,dateStr,notesRecord,error);
                        nextNotes=null;
                        quarantineNotes=true;
                    }
                }
                migrated.push({
                    diaryKey,notesKey,nextDiary,nextNotes,
                    originalDiary:diaryRecord,originalNotes:notesRecord,
                    quarantineDiary,quarantineNotes
                });
            }

            const voiceRecords=await exportEncryptedVoiceNotes();
            const nextVoiceRecords=[];
            for(let index=0;index<voiceRecords.length;index+=1){
                const record=voiceRecords[index];
                try{
                    nextVoiceRecords.push(await migrateRecordToTargetKey(record,{
                        decryptTarget:value=>decryptVoiceNoteRecord(value,targetKey),
                        decryptLegacy:value=>decryptVoiceNoteRecord(value,sourceKey),
                        encryptTarget:blob=>encryptVoiceNoteBlob(blob,targetKey,record.dateString,record.id,record.capturedAt)
                    }));
                }catch(error){
                    quarantine('voice',record?.id||index,record?.dateString,record,error);
                }
            }

            const affectedDates=new Set([
                ...dates,
                ...voiceRecords.map(record=>record?.dateString).filter(value=>typeof value==='string')
            ]);
            window.__faithFocusVaultMigration=true;
            try{
                // Store unreadable ciphertext in a separate IndexedDB quarantine
                // object store before removing it from active Diary records. This
                // avoids localStorage quota limits for large encrypted voice notes.
                await quarantineLegacyWritingRecords(quarantined);
                migrated.forEach(item=>{
                    if(item.quarantineDiary)localStorage.removeItem(item.diaryKey);
                    else if(item.nextDiary!==null)localStorage.setItem(item.diaryKey,item.nextDiary);
                    if(item.quarantineNotes)localStorage.removeItem(item.notesKey);
                    else if(item.nextNotes!==null)localStorage.setItem(item.notesKey,item.nextNotes);
                });

                // This IndexedDB replacement is transactional. Invalid legacy voice
                // records have already been preserved in quarantine; valid records
                // continue under the unified account key.
                if(voiceRecords.length)await restoreEncryptedVoiceNotes(nextVoiceRecords);

                writingCryptoKey=targetKey;
                writingLoadedDate=null;
                legacyMigrationRequired=false;
            }catch(error){
                migrated.forEach(item=>{
                    if(item.originalDiary===null)localStorage.removeItem(item.diaryKey);
                    else localStorage.setItem(item.diaryKey,item.originalDiary);
                    if(item.originalNotes===null)localStorage.removeItem(item.notesKey);
                    else localStorage.setItem(item.notesKey,item.originalNotes);
                });
                throw error;
            }finally{
                window.__faithFocusVaultMigration=false;
            }
            affectedDates.forEach(dateString=>{
                window.dispatchEvent(new CustomEvent('faith-focus:local-data-changed',{detail:{dateString}}));
            });
            return {quarantinedCount:quarantined.length};
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

        function unpackPrivateWritingNotes(value){
            if(!value||typeof value!=='object'||Array.isArray(value)){
                throw new Error('The encrypted reflection record has an unsupported format.');
            }
            const notes={};
            Object.entries(value).forEach(([id,note])=>{
                if(id===PRIVATE_NOTE_META_KEY)return;
                if(typeof note!=='string')throw new Error('A private reflection field has an unsupported format.');
                notes[id]=note;
            });
            const rawMeta=value[PRIVATE_NOTE_META_KEY];
            if(rawMeta!==undefined&&(!rawMeta||typeof rawMeta!=='object'||Array.isArray(rawMeta))){
                throw new Error('The private reflection revision metadata has an unsupported format.');
            }
            const meta={};
            Object.entries(rawMeta||{}).forEach(([id,revision])=>{
                if(!Number.isSafeInteger(revision)||revision<0){
                    throw new Error('A private reflection revision is invalid.');
                }
                meta[id]=revision;
            });
            return {notes,meta};
        }

        export function buildPrivateWritingNotesPayload(notes,previousValues={},previousMeta={},updatedAt=Date.now()){
            if(!notes||typeof notes!=='object'||Array.isArray(notes)
                ||!Number.isSafeInteger(updatedAt)||updatedAt<0){
                throw new TypeError('A valid private reflection payload and revision time are required.');
            }
            const meta={...(previousMeta&&typeof previousMeta==='object'&&!Array.isArray(previousMeta)?previousMeta:{})};
            PRIVATE_NOTE_IDS.forEach(id=>{
                const current=typeof notes[id]==='string'?notes[id]:'';
                const previous=typeof previousValues?.[id]==='string'?previousValues[id]:'';
                if(current!==previous){
                    const previousRevision=Number.isSafeInteger(meta[id])&&meta[id]>=0?meta[id]:0;
                    meta[id]=Math.max(updatedAt,previousRevision+1);
                }
            });
            return {...notes,[PRIVATE_NOTE_META_KEY]:meta};
        }

        function samePrivateWritingValue(left,right){
            const stable=value=>{
                if(Array.isArray(value))return value.map(stable);
                if(value&&typeof value==='object'){
                    const sorted={};
                    Object.keys(value).sort().forEach(key=>{sorted[key]=stable(value[key]);});
                    return sorted;
                }
                return value;
            };
            return JSON.stringify(stable(left))===JSON.stringify(stable(right));
        }
        function mergePrivateWritingNotes(localValue,remoteValue){
            const local=unpackPrivateWritingNotes(localValue);
            const remote=unpackPrivateWritingNotes(remoteValue);
            const merged={},mergedMeta={};
            const ids=[...new Set([...Object.keys(local.notes),...Object.keys(remote.notes)])].sort();
            for(const id of ids){
                const hasLocal=Object.prototype.hasOwnProperty.call(local.notes,id);
                const hasRemote=Object.prototype.hasOwnProperty.call(remote.notes,id);
                const leftRevision=Number.isSafeInteger(local.meta[id])?local.meta[id]:0;
                const rightRevision=Number.isSafeInteger(remote.meta[id])?remote.meta[id]:0;
                if(!hasLocal){merged[id]=remote.notes[id];mergedMeta[id]=rightRevision;continue;}
                if(!hasRemote){merged[id]=local.notes[id];mergedMeta[id]=leftRevision;continue;}
                if(local.notes[id]===remote.notes[id]){
                    merged[id]=remote.notes[id];
                    mergedMeta[id]=Math.max(leftRevision,rightRevision);
                    continue;
                }
                // Reflection fields are editable values, not append-only writing.
                // A cleared string is a real update and must beat an older value.
                // Legacy records without revision metadata are revision 0; when both
                // legacy values conflict, the remote copy is the stable fallback.
                if(leftRevision>rightRevision){
                    merged[id]=local.notes[id];
                    mergedMeta[id]=leftRevision;
                }else{
                    merged[id]=remote.notes[id];
                    mergedMeta[id]=rightRevision;
                }
            }
            return {...merged,[PRIVATE_NOTE_META_KEY]:mergedMeta};
        }
        export async function mergeEncryptedPrivateWritingRecords(dateStr,localRecords,remoteRecords,key=writingCryptoKey){
            const mergeRecord=async(kind,localRecord,remoteRecord)=>{
                if(localRecord==null)return remoteRecord??null;
                if(remoteRecord==null)return localRecord;
                if(localRecord===remoteRecord)return remoteRecord;
                if(!key)throw new Error('The account encryption key is unavailable. Both device copies remain preserved.');
                let localValue,remoteValue;
                try{
                    localValue=await decryptPrivatePayload(kind,dateStr,localRecord,key);
                    remoteValue=await decryptPrivatePayload(kind,dateStr,remoteRecord,key);
                }catch(error){
                    throw new Error('A private '+(kind==='diary'?'Diary':'reflection')+' record could not be decrypted for a safe merge. Both device copies remain preserved.');
                }
                const mergedValue=kind==='diary'
                    ?(typeof localValue==='string'&&typeof remoteValue==='string'
                        ?mergePrivateWritingText(localValue,remoteValue)
                        :(()=>{throw new Error('The encrypted Diary entry has an unsupported format. Both device copies remain preserved.');})())
                    :mergePrivateWritingNotes(localValue,remoteValue);
                if(samePrivateWritingValue(mergedValue,remoteValue))return remoteRecord;
                if(samePrivateWritingValue(mergedValue,localValue))return localRecord;
                return encryptPrivatePayload(kind,dateStr,mergedValue,key);
            };
            const local=localRecords||{},remote=remoteRecords||{};
            const [diary,notes]=await Promise.all([
                mergeRecord('diary',local.diary,remote.diary),
                mergeRecord('notes',local.notes,remote.notes)
            ]);
            return {diary,notes};
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
            if(legacyKeyUnavailable){
                if(heading)heading.textContent='One-time Diary migration';
                if(intro)intro.textContent='The previous Diary key settings are missing on this device. Enter the passphrase you used before to try unlocking the older encrypted entries. Your original encrypted entries will remain untouched unless the correct key opens them.';
                confirmWrap?.classList.add('hidden');
                if(button){button.disabled=false;button.textContent='Try previous Diary passphrase';}
                const pass=document.getElementById('diary-passphrase');
                if(pass){pass.autocomplete='current-password';pass.placeholder='Enter your previous Diary passphrase';}
                return;
            }
            if(heading)heading.textContent=legacyMigrationRequired?'One-time Diary migration':configured?'Unlock your private writing':'Create your private writing key';
            if(intro)intro.textContent=legacyMigrationRequired
                ?'Some entries still use your previous Diary key. Enter its passphrase once to migrate those entries. Entries already protected by your account key will remain unchanged.'
                :configured?'Enter your passphrase to decrypt your diary and checklist reflections on this device.':'Private writing is protected by your unified account key.';
            confirmWrap?.classList.toggle('hidden',configured||legacyMigrationRequired||!!vaultPrimaryKey);
            if(button){button.disabled=false;button.textContent=legacyMigrationRequired?'Migrate existing Diary':configured?'Unlock private writing':'Continue';}
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
        async function migrateLegacyPrivateWriting(key,{preserveSource=false}={}){
            const dates=new Set();
            for(let i=0;i<localStorage.length;i++){
                const storageKey=localStorage.key(i);
                let match=storageKey&&storageKey.match(/^private_diary_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
                match=storageKey&&storageKey.match(/^mindful_pokes_data_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
            }

            const plans=[];
            for(const dateStr of dates){
                const oldDiaryKey='private_diary_'+dateStr;
                const appDataKey='mindful_pokes_data_'+dateStr;
                const oldDiary=localStorage.getItem(oldDiaryKey);
                const rawAppData=localStorage.getItem(appDataKey);
                let appData={},valid=true;
                if(rawAppData){try{appData=JSON.parse(rawAppData)||{};}catch(error){valid=false;}}
                const secureDiaryKey=getSecureWritingStorageKey('diary',dateStr);
                const secureNotesKey=getSecureWritingStorageKey('notes',dateStr);
                const originalSecureDiary=localStorage.getItem(secureDiaryKey);
                const originalSecureNotes=localStorage.getItem(secureNotesKey);
                const nextDiary=oldDiary!==null&&!originalSecureDiary
                    ?await encryptPrivatePayload('diary',dateStr,oldDiary,key)
                    :originalSecureDiary;
                const legacyNotes={};
                let hasContent=false,hadFields=false;
                if(valid&&rawAppData){
                    PRIVATE_NOTE_IDS.forEach(id=>{
                        if(Object.prototype.hasOwnProperty.call(appData,id))hadFields=true;
                        if(typeof appData[id]==='string'){
                            legacyNotes[id]=appData[id];
                            hasContent=hasContent||appData[id].length>0;
                        }
                    });
                }
                const nextNotes=hasContent&&!originalSecureNotes
                    ?await encryptPrivatePayload('notes',dateStr,legacyNotes,key)
                    :originalSecureNotes;
                const cleanedAppData={...appData};
                if(valid&&rawAppData&&!preserveSource){
                    PRIVATE_NOTE_IDS.forEach(id=>delete cleanedAppData[id]);
                }
                plans.push({
                    dateStr,oldDiaryKey,appDataKey,secureDiaryKey,secureNotesKey,
                    oldDiary,rawAppData,originalSecureDiary,originalSecureNotes,
                    nextDiary,nextNotes,hadFields,valid,cleanedAppData
                });
            }

            try{
                plans.forEach(item=>{
                    if(item.nextDiary!==null&&item.nextDiary!==item.originalSecureDiary){
                        localStorage.setItem(item.secureDiaryKey,item.nextDiary);
                    }
                    if(item.nextNotes!==null&&item.nextNotes!==item.originalSecureNotes){
                        localStorage.setItem(item.secureNotesKey,item.nextNotes);
                    }
                    if(!preserveSource){
                        if(item.oldDiary!==null)localStorage.removeItem(item.oldDiaryKey);
                        if(item.valid&&item.rawAppData&&item.hadFields){
                            localStorage.setItem(item.appDataKey,JSON.stringify(item.cleanedAppData));
                        }
                    }
                });
            }catch(error){
                plans.forEach(item=>{
                    if(item.originalSecureDiary===null)localStorage.removeItem(item.secureDiaryKey);
                    else localStorage.setItem(item.secureDiaryKey,item.originalSecureDiary);
                    if(item.originalSecureNotes===null)localStorage.removeItem(item.secureNotesKey);
                    else localStorage.setItem(item.secureNotesKey,item.originalSecureNotes);
                    if(item.oldDiary===null)localStorage.removeItem(item.oldDiaryKey);
                    else localStorage.setItem(item.oldDiaryKey,item.oldDiary);
                    if(item.rawAppData===null)localStorage.removeItem(item.appDataKey);
                    else localStorage.setItem(item.appDataKey,item.rawAppData);
                });
                throw error;
            }
        }

        function cleanupLegacyPlaintextPrivateWriting(){
            const dates=new Set();
            for(let i=0;i<localStorage.length;i++){
                const storageKey=localStorage.key(i);
                let match=storageKey&&storageKey.match(/^private_diary_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
                match=storageKey&&storageKey.match(/^mindful_pokes_data_(\d{4}-\d{2}-\d{2})$/);
                if(match)dates.add(match[1]);
            }
            dates.forEach(dateStr=>{
                localStorage.removeItem('private_diary_'+dateStr);
                const appDataKey='mindful_pokes_data_'+dateStr;
                const raw=localStorage.getItem(appDataKey);
                if(!raw)return;
                try{
                    const data=JSON.parse(raw)||{};
                    let changed=false;
                    PRIVATE_NOTE_IDS.forEach(id=>{
                        if(Object.prototype.hasOwnProperty.call(data,id)){
                            delete data[id];
                            changed=true;
                        }
                    });
                    if(changed)localStorage.setItem(appDataKey,JSON.stringify(data));
                }catch(error){
                    // Preserve malformed source data instead of risking deletion.
                }
            });
        }
        async function handleDiaryKeyAction(){
            const passInput=document.getElementById('diary-passphrase'),confirmInput=document.getElementById('diary-passphrase-confirm'),button=document.getElementById('diary-key-action');
            const passphrase=passInput.value,configText=localStorage.getItem(WRITING_CONFIG_KEY);
            let previousPassphraseVerified=false,quarantinedRecordCount=0;
            if(!hasWritingCrypto()){setWritingSecurityStatus('Secure browser encryption is unavailable. Open this app over HTTPS in a modern browser.','error');return;}
            if(!passphrase||passphrase.length<16){setWritingSecurityStatus('Please use a passphrase with at least 16 characters. Several unrelated words work well.','error');return;}
            button.disabled=true;button.textContent='Securing private writing…';
            try{
                let key;
                if(!configText){
                    if(vaultPrimaryKey&&legacyMigrationRequired){
                        throw new Error('The previous Diary key settings are unavailable on this device. Sign in on the device that still has the previous Diary settings and let it sync first. Your encrypted entries remain untouched.');
                    }
                    if(passphrase!==confirmInput.value)throw new Error('The two passphrases do not match.');
                    const salt=crypto.getRandomValues(new Uint8Array(16));
                    key=await derivePrivateWritingKey(passphrase,salt,WRITING_KDF_ITERATIONS);
                    const verifyIv=crypto.getRandomValues(new Uint8Array(12));
                    const verifier=await crypto.subtle.encrypt({name:'AES-GCM',iv:verifyIv,additionalData:new TextEncoder().encode('Daily Mindful Pokes|key-verifier|v1'),tagLength:128},key,new TextEncoder().encode(WRITING_CHECK_TEXT));
                    localStorage.setItem(WRITING_CONFIG_KEY,JSON.stringify({version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-HMAC-SHA-256',iterations:WRITING_KDF_ITERATIONS,salt:bytesToBase64(salt),verifierIv:bytesToBase64(verifyIv),verifierCiphertext:bytesToBase64(new Uint8Array(verifier))}));
                }else{
                    const config=JSON.parse(configText);
                    if(config.version!==1||config.algorithm!=='AES-256-GCM'||config.kdf!=='PBKDF2-HMAC-SHA-256'||config.iterations!==WRITING_KDF_ITERATIONS||typeof config.salt!=='string')throw new Error('The saved previous Diary key settings are incomplete.');
                    key=await derivePrivateWritingKey(passphrase,base64ToBytes(config.salt),config.iterations);
                    const hasVerifier=typeof config.verifierIv==='string'&&typeof config.verifierCiphertext==='string';
                    if(hasVerifier){
                        let verified;
                        try{verified=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(config.verifierIv),additionalData:new TextEncoder().encode('Daily Mindful Pokes|key-verifier|v1'),tagLength:128},key,base64ToBytes(config.verifierCiphertext));}
                        catch(error){throw new Error('Incorrect previous Diary passphrase.');}
                        if(new TextDecoder().decode(verified)!==WRITING_CHECK_TEXT)throw new Error('Incorrect previous Diary passphrase.');
                    }else{
                        // Test the derived key directly against original encrypted entries.
                        const openedLegacyRecord=await hasLegacyEncryptedRecordReadableWithKey(key);
                        if(!openedLegacyRecord)throw new Error('Incorrect previous Diary passphrase.');
                    }
                    previousPassphraseVerified=true;
                }
                if(vaultPrimaryKey&&legacyMigrationRequired){
                    // Stage plaintext migration first but keep every original source
                    // record until encrypted Diary and voice-note migration succeeds.
                    await migrateLegacyPrivateWriting(key,{preserveSource:true});
                    const migrationResult=await migrateEncryptedPrivateRecords(key,vaultPrimaryKey);
                    quarantinedRecordCount=migrationResult.quarantinedCount;
                    if(migrationResult.quarantinedCount){
                        console.warn('[Diary migration] Completed with '+migrationResult.quarantinedCount+' unreadable record(s) preserved in local quarantine. Valid Diary records were migrated.');
                    }
                    cleanupLegacyPlaintextPrivateWriting();
                    legacyMigrationRequired=false;
                    legacyKeyUnavailable=false;
                }else if(vaultPrimaryKey){
                    writingCryptoKey=vaultPrimaryKey;
                }else{
                    writingCryptoKey=key;
                    await migrateLegacyPrivateWriting(key);
                }
                await loadPrivateWritingForDate(getCurrentWritingDate());
                if(vaultPrimaryKey) localStorage.removeItem(WRITING_CONFIG_KEY);
                legacyMigrationRequired=false;
                legacyKeyUnavailable=false;
                updatePrivateWritingAccess();
                setWritingSecurityStatus(quarantinedRecordCount
                    ?'Your Diary is unlocked. '+quarantinedRecordCount+' unreadable legacy record(s) were preserved in local quarantine; all readable entries were migrated. See the browser console for record-level details.'
                    :'Your Diary is unlocked and its readable legacy entries were migrated to your unified account key.', quarantinedRecordCount?'info':'success');
                const saveStatus=document.getElementById('writing-save-status');
                if(saveStatus)saveStatus.textContent='Encrypted writing is unlocked for this session.';
            }catch(error){
                writingCryptoKey=null;writingLoadedDate=null;updatePrivateWritingAccess();
                console.error('[Diary migration] Migration failed after passphrase verification or during conversion:',error);
                const message=previousPassphraseVerified
                    ?'Your previous Diary passphrase was accepted, but the migration could not finish safely. Original encrypted entries remain preserved. See the browser console for the exact failure reason.'
                    :error?.message==='Incorrect previous Diary passphrase.'
                        ?'Incorrect previous Diary passphrase. No encrypted entries were changed.'
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
                const notesPayload=buildPrivateWritingNotesPayload(
                    payload.notes,writingLoadedNoteValues||{},writingLoadedNoteMeta
                );
                const diary=await encryptPrivatePayload('diary',dateStr,payload.diary,key);
                const notes=await encryptPrivatePayload('notes',dateStr,notesPayload,key);
                localStorage.setItem(getSecureWritingStorageKey('diary',dateStr),diary);
                localStorage.setItem(getSecureWritingStorageKey('notes',dateStr),notes);
                writingLoadedNoteValues={...payload.notes};
                writingLoadedNoteMeta={...notesPayload[PRIVATE_NOTE_META_KEY]};
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
            let diaryText='',notes={},noteMeta={};
            const diaryRecord=localStorage.getItem(getSecureWritingStorageKey('diary',dateStr)),notesRecord=localStorage.getItem(getSecureWritingStorageKey('notes',dateStr));
            if(diaryRecord)diaryText=await decryptPrivatePayload('diary',dateStr,diaryRecord,writingCryptoKey);
            if(notesRecord){
                const unpacked=unpackPrivateWritingNotes(
                    await decryptPrivatePayload('notes',dateStr,notesRecord,writingCryptoKey)
                );
                notes=unpacked.notes;
                noteMeta=unpacked.meta;
            }
            document.getElementById('private-diary-entry').value=typeof diaryText==='string'?diaryText:'';
            PRIVATE_NOTE_IDS.forEach(id=>{const field=document.getElementById(id);if(field)field.value=typeof notes[id]==='string'?notes[id]:'';});
            writingLoadedNoteValues={...notes};
            writingLoadedNoteMeta={...noteMeta};
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
                writingCryptoKey=null;writingLoadedDate=null;writingLoadedNoteValues=null;writingLoadedNoteMeta={};updatePrivateWritingAccess();
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
    voiceNoteSavePromise=voiceNoteSavePromise.then(task,task);
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
