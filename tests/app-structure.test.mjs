import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const writing=readFileSync(new URL('../assets/writing-security.js',import.meta.url),'utf8');
const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
test('HTML uses a local app module and no inline handlers or scripts',()=>{
 assert.match(html,/type="module" src="\.\/assets\/app\.js"/);
 assert.doesNotMatch(html,/\son(?:click|change|input|submit)\s*=/i);
 assert.doesNotMatch(html,/<script\s*>/i);
 assert.match(html,/id="app-pin-form"/);
 assert.doesNotMatch(app,/defaultPin\s*=\s*["']1234["']/);
});
test('CSP limits script execution to same-origin files and blocks objects',()=>{
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/script-src 'self'/);
 assert.match(html,/object-src 'none'/);
 assert.match(html,/base-uri 'self'/);
 assert.doesNotMatch(html,/cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com/);
 assert.match(html,/assets\/tailwind\.generated\.css/);
 assert.match(readme,/Content Security Policy/i);
});
test('private-writing encryption remains separate and preserved',()=>{
 assert.match(writing,/AES-GCM/);
 assert.match(writing,/PBKDF2/);
 assert.match(writing,/WRITING_KDF_ITERATIONS=600000/);
 assert.match(writing,/tagLength:128/);
 assert.match(writing,/PRIVATE_NOTE_IDS/);
 assert.match(app,/handleDiaryKeyAction/);
});
test('ordinary progress storage is documented as not encrypted',()=>{
 assert.match(app,/mindful_pokes_data_/);
 assert.match(readme,/Checklist checkboxes/i);
 assert.match(readme,/not encrypted/i);
});
test('all existing checklist, cloud and ecosystem features remain',()=>{
 assert.equal((html.match(/class="[^"]*app-chk/g)||[]).length,23);
 assert.equal((html.match(/data-cloud="(?:cumulus|stratus|stratocumulus)"/g)||[]).length,3);
 for(const feature of ['finishChecklist','guide-launch','ecosystem-canvas'])assert.ok(html.includes(feature)||app.includes(feature),feature);
});

test('Onnea garden is a separate local module and does not replace existing features',()=>{
 assert.match(html,/id="onnea-garden"/);
 assert.match(html,/data-garden-action="open-garden"/);
 assert.match(html,/assets\/garden\.css/);
 assert.match(html,/type="module" src="\.\/assets\/garden\.js"/);
 assert.match(html,/aria-modal="true"/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(html,/<script\\s*>/i);
 assert.match(readFileSync(new URL('../assets/garden.js',import.meta.url),'utf8'),/GARDEN_STORAGE_KEY/);
});
