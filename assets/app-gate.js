export const APP_PIN_CONFIG_KEY='dmp_app_gate_v1';
export const LEGACY_APP_PIN_KEY='user_pin';
export const APP_PIN_KDF_ITERATIONS=600000;
export function isValidAppPin(pin){return typeof pin==='string'&&/^[0-9]{6,12}$/.test(pin);}
function isLegacyPin(pin){return typeof pin==='string'&&/^[0-9]{4,12}$/.test(pin);}
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s);}
function fromBase64(value){const s=atob(value),bytes=new Uint8Array(s.length);for(let i=0;i<s.length;i++)bytes[i]=s.charCodeAt(i);return bytes;}
async function derive(pin,salt,cryptoApi){
    const material=await cryptoApi.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
    return new Uint8Array(await cryptoApi.subtle.deriveBits({name:'PBKDF2',salt,iterations:APP_PIN_KDF_ITERATIONS,hash:'SHA-256'},material,256));
}
export async function createAppPinRecord(pin,cryptoApi=globalThis.crypto,options={}){
    const legacy=options.allowLegacy===true;
    if(!(legacy?isLegacyPin(pin):isValidAppPin(pin)))throw new Error('App PIN must contain 6–12 digits.');
    if(!cryptoApi?.subtle||!cryptoApi?.getRandomValues)throw new Error('Web Crypto unavailable.');
    const salt=cryptoApi.getRandomValues(new Uint8Array(16));
    const verifier=await derive(pin,salt,cryptoApi);
    return {version:1,kdf:'PBKDF2-HMAC-SHA-256',iterations:APP_PIN_KDF_ITERATIONS,salt:toBase64(salt),verifier:toBase64(verifier),requiresUpgrade:pin.length<6};
}
function validRecord(record){
    if(!record||record.version!==1||record.kdf!=='PBKDF2-HMAC-SHA-256'||record.iterations!==APP_PIN_KDF_ITERATIONS)return false;
    try{return fromBase64(record.salt).length===16&&fromBase64(record.verifier).length===32&&typeof record.requiresUpgrade==='boolean';}
    catch(error){return false;}
}
export async function verifyAppPin(pin,record,cryptoApi=globalThis.crypto){
    if(!isLegacyPin(pin)||!validRecord(record)||!cryptoApi?.subtle)return false;
    try{
        const expected=fromBase64(record.verifier);
        const actual=await derive(pin,fromBase64(record.salt),cryptoApi);
        let diff=expected.length^actual.length;
        for(let i=0;i<Math.min(expected.length,actual.length);i++)diff|=expected[i]^actual[i];
        return diff===0;
    }catch(error){return false;}
}
export async function migrateLegacyAppPin(storage=globalThis.localStorage,cryptoApi=globalThis.crypto){
    const stored=storage.getItem(APP_PIN_CONFIG_KEY);
    if(stored!==null){
        let record;
        try{record=JSON.parse(stored);}catch(error){throw new Error('Saved PIN record is invalid.');}
        if(!validRecord(record))throw new Error('Saved PIN record is unsupported or damaged.');
        return record;
    }
    const legacy=storage.getItem(LEGACY_APP_PIN_KEY);
    if(legacy===null)return null;
    const record=await createAppPinRecord(legacy,cryptoApi,{allowLegacy:true});
    storage.setItem(APP_PIN_CONFIG_KEY,JSON.stringify(record));
    storage.removeItem(LEGACY_APP_PIN_KEY);
    return record;
}
