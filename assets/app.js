
        let celebrationCanvas=null,celebrationContext=null,celebrationParticles=[],celebrationFrame=null;
        function confetti(options={}){
            if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
            celebrationCanvas=document.getElementById('celebration-canvas');
            if(!celebrationCanvas)return;
            if(!celebrationContext){
                try{celebrationContext=celebrationCanvas.getContext('2d');}catch(error){celebrationContext=null;}
            }
            if(!celebrationContext)return;
            const width=window.innerWidth,height=window.innerHeight,dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
            celebrationCanvas.width=Math.max(1,Math.round(width*dpr));
            celebrationCanvas.height=Math.max(1,Math.round(height*dpr));
            celebrationContext.setTransform(dpr,0,0,dpr,0,0);
            const origin=options.origin||{x:.5,y:.6};
            const cx=Math.max(0,Math.min(1,Number(origin.x??.5)))*width;
            const cy=Math.max(0,Math.min(1,Number(origin.y??.6)))*height;
            const count=Math.max(0,Math.min(140,Number(options.particleCount)||30));
            const colors=['#81c784','#ff80ab','#ffd54f','#64b5f6'];
            for(let i=0;i<count&&celebrationParticles.length<180;i++){
                const angle=-Math.PI/2+(Math.random()-.5)*(Math.PI*Math.min(1.8,(Number(options.spread)||50)/50));
                const speed=2+Math.random()*3.2;
                celebrationParticles.push({x:cx,y:cy,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-1,
                    color:colors[i%4],size:3+Math.random()*3,rotation:Math.random()*Math.PI,spin:(Math.random()-.5)*.16,life:1});
            }
            if(celebrationFrame===null)celebrationFrame=requestAnimationFrame(renderConfetti);
        }
        function renderConfetti(){
            celebrationFrame=null;
            if(!celebrationCanvas||!celebrationContext)return;
            const ctx=celebrationContext,w=window.innerWidth,h=window.innerHeight;
            ctx.clearRect(0,0,w,h);
            celebrationParticles=celebrationParticles.filter(p=>p.life>.04&&p.y<h+24);
            for(const p of celebrationParticles){
                p.x+=p.vx;p.y+=p.vy;p.vy+=.075;p.vx*=.993;p.rotation+=p.spin;p.life-=.018;
                ctx.save();ctx.globalAlpha=Math.max(0,p.life);ctx.translate(p.x,p.y);ctx.rotate(p.rotation);
                ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*.65);ctx.restore();
            }
            if(celebrationParticles.length)celebrationFrame=requestAnimationFrame(renderConfetti);
            else ctx.clearRect(0,0,w,h);
        }

import {
    APP_PIN_CONFIG_KEY,createAppPinRecord,isValidAppPin,migrateLegacyAppPin,verifyAppPin
} from './app-gate.js';
import {
    writingCryptoKey,writingLoadedDate,getSecureWritingStorageKey,getCurrentWritingDate,
    setWritingSecurityStatus,renderDiarySecurityUI,updatePrivateWritingAccess,
    handleDiaryKeyAction,lockPrivateWriting,savePrivateWritingForDate,
    loadPrivateWritingForDate,schedulePrivateWritingSave,flushPrivateWritingQueue,flushAndSaveCurrentPrivateWriting
} from './writing-security.js';


        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let currentStep = 1;
        let activeModalType = null;
        let activeTargetCheckboxId = null;
        let mediaRecorder, audioChunks = [];

        // The four-digit PIN is only an app gate; private writing uses a separate encryption key.

        let appPinRecord=null,appPinMode='setup',appPinFailures=0,appPinLockedUntil=0,appPinSubmitting=false;

        function setAppPinMessage(message,state='info'){
            const el=document.getElementById('app-pin-message');
            if(el){el.textContent=message;el.dataset.state=state;}
        }
        function setAppPinMode(mode,message=''){
            appPinMode=mode;
            const heading=document.getElementById('app-pin-heading');
            const intro=document.getElementById('app-pin-intro');
            const confirmWrap=document.getElementById('app-pin-confirm-wrap');
            const input=document.getElementById('app-pin-input');
            const button=document.getElementById('app-pin-submit');
            if(!heading||!intro||!confirmWrap||!input||!button)return;
            const setup=mode==='setup'||mode==='upgrade';
            heading.textContent=mode==='setup'?'Create your app PIN':mode==='upgrade'?'Update your app PIN':'Mindful Safe Gate';
            intro.textContent=mode==='setup'?'Create a personal 6–12 digit PIN to open this app on this device.':
                mode==='upgrade'?'Your previous PIN was verified. Replace it with a 6–12 digit PIN.':'Enter your personal app PIN to continue.';
            confirmWrap.classList.toggle('hidden',!setup);
            input.autocomplete=setup?'new-password':'current-password';
            input.minLength=setup?6:4;
            input.placeholder=setup?'6–12 digits':'Enter your PIN';
            button.textContent=mode==='setup'?'Set PIN & Continue':mode==='upgrade'?'Save New PIN & Continue':'Unlock App';
            input.value='';
            const confirm=document.getElementById('app-pin-confirm');
            if(confirm)confirm.value='';
            setAppPinMessage(message||(mode==='setup'?'Choose a personal PIN. It is separate from your private-writing passphrase.':
                mode==='upgrade'?'Please choose a stronger PIN to finish signing in.':'Your checklist progress remains stored on this device.'),'info');
            input.focus();
        }
        async function initializeAppGate(){
            if(!document.getElementById('app-pin-form'))return;
            try{
                if(!window.isSecureContext||!window.crypto?.subtle||!window.crypto?.getRandomValues){
                    setAppPinMessage('Secure browser cryptography is unavailable. Open the app over HTTPS in a modern browser.','error');
                    const button=document.getElementById('app-pin-submit');
                    if(button)button.disabled=true;
                    return;
                }
                appPinRecord=await migrateLegacyAppPin(localStorage,window.crypto);
                setAppPinMode(appPinRecord?'unlock':'setup');
            }catch(error){
                setAppPinMessage('The saved app-gate settings could not be read. Nothing was reset. '+(error?.message||''),'error');
                const button=document.getElementById('app-pin-submit');
                if(button)button.disabled=true;
            }
        }
        async function submitAppPin(){
            if(appPinSubmitting)return;
            const input=document.getElementById('app-pin-input');
            const confirm=document.getElementById('app-pin-confirm');
            const button=document.getElementById('app-pin-submit');
            if(!input||!button)return;
            appPinSubmitting=true;
            button.disabled=true;
            const pin=input.value;
            try{
                if(appPinMode==='unlock'){
                    if(Date.now()<appPinLockedUntil){
                        setAppPinMessage('Too many attempts. Please wait a little before trying again.','error');
                        return;
                    }
                    const valid=await verifyAppPin(pin,appPinRecord,window.crypto);
                    input.value='';
                    if(!valid){
                        appPinFailures++;
                        if(appPinFailures>=5){
                            appPinFailures=0;
                            appPinLockedUntil=Date.now()+15000;
                            setAppPinMessage('Too many incorrect attempts. Please wait 15 seconds before trying again.','error');
                        }else{
                            setAppPinMessage('That PIN did not match. Please try again.','error');
                        }
                        return;
                    }
                    appPinFailures=0;
                    if(appPinRecord.requiresUpgrade){
                        setAppPinMode('upgrade','Your previous PIN was verified. Choose a 6–12 digit replacement.');
                        return;
                    }
                    finishAppGateUnlock();
                    return;
                }
                if(!isValidAppPin(pin)){
                    setAppPinMessage('Choose a PIN containing 6–12 digits.','error');
                    return;
                }
                if(pin!==confirm?.value){
                    setAppPinMessage('The two PIN entries do not match. Please try again.','error');
                    if(confirm)confirm.value='';
                    return;
                }
                appPinRecord=await createAppPinRecord(pin,window.crypto);
                localStorage.setItem(APP_PIN_CONFIG_KEY,JSON.stringify(appPinRecord));
                finishAppGateUnlock();
            }catch(error){
                setAppPinMessage('The app PIN could not be saved or checked. Your other app data was not changed. '+(error?.message||''),'error');
            }finally{
                appPinSubmitting=false;
                button.disabled=false;
                if(input)input.focus();
            }
        }
        function finishAppGateUnlock(){
            document.getElementById('app-pin-form')?.reset();
            document.getElementById('view-pin')?.classList.add('hidden');
            showPage('garden');
        }

        function showPage(pageId) {
            // The garden room is now the app's home. Checklist and diary remain
            // separate feature views, presented inside that shared environment.
            if (pageId === 'launcher') pageId = 'garden';

            ['view-launcher', 'view-diary', 'view-checklist'].forEach(id => {
                document.getElementById(id)?.classList.add('hidden');
            });

            if (['garden', 'checklist', 'diary'].includes(pageId)) {
                const garden = document.getElementById('onnea-garden');
                garden?.classList.remove('hidden');
                if (pageId === 'garden') {
                    document.dispatchEvent(new CustomEvent('garden:open'));
                } else {
                    document.dispatchEvent(new CustomEvent('garden:show-scene', { detail: { scene: pageId } }));
                }
            } else {
                document.getElementById('view-' + pageId)?.classList.remove('hidden');
            }

            if (pageId === 'checklist') {
                resizeEcosystemCanvas();
                updateEcosystemTree();
                replayEcosystemWelcome();
            }
            if (pageId === 'garden') updateScoreDisplay();
            if (pageId === 'diary') {
                renderDiarySecurityUI();
                if (writingCryptoKey && writingLoadedDate !== getCurrentWritingDate()) {
                    loadPrivateWritingForDate(getCurrentWritingDate()).catch(error => setWritingSecurityStatus('Could not decrypt this date’s private writing. ' + (error?.message || ''),'error'));
                }
            }
        }

        function changeStep(direction) {
            const nextStep = currentStep + direction;
            if (nextStep >= 1 && nextStep <= 6) {
                document.getElementById('card-step-' + currentStep).classList.add('hidden');
                currentStep = nextStep;
                document.getElementById('card-step-' + currentStep).classList.remove('hidden');

                document.getElementById('current-step-num').innerText = currentStep;
                
                for (let i = 1; i <= 6; i++) {
                    const dot = document.getElementById('dot-' + i);
                    if (i <= currentStep) dot.classList.remove('opacity-30');
                    else dot.classList.add('opacity-30');
                }

                document.getElementById('btn-prev').disabled = (currentStep === 1);
                document.getElementById('btn-prev').classList.toggle('opacity-50', currentStep === 1);
                document.getElementById('btn-prev').classList.toggle('cursor-not-allowed', currentStep === 1);

                document.getElementById('btn-next').innerText = (currentStep === 6) ? "Finish Checklist 🏆" : "Next Card ➔";
                document.getElementById('finish-status')?.classList.add('hidden');
            }
        }

        function handleNextStep() {
            if (currentStep === 6) {
                finishChecklist();
                return;
            }
            changeStep(1);
        }

        function isSectionComplete(sectionNumber) {
            const checks = Array.from(document.querySelectorAll('.sec-' + sectionNumber));
            if (!checks.length) return false;
            // Card 1 is a location choice: one selected place completes that card.
            return sectionNumber === 1
                ? checks.some(check => check.checked)
                : checks.every(check => check.checked);
        }

        function finishChecklist() {
            const firstIncomplete = Array.from({length:6},(_,index)=>index+1).find(section => !isSectionComplete(section));
            const status = document.getElementById('finish-status');

            if (firstIncomplete) {
                if (currentStep !== firstIncomplete) {
                    changeStep(firstIncomplete - currentStep);
                }
                status.textContent = firstIncomplete === 6
                    ? "Almost there! Release all three cloud types, then tick the completion checkbox."
                    : "Almost there! Please complete the remaining activity or activities on Card " + firstIncomplete + ".";
                status.classList.remove('hidden');
                document.getElementById('card-step-' + firstIncomplete)?.scrollIntoView({behavior:'smooth',block:'start'});
                return;
            }

            status.classList.add('hidden');
            checkSectionCompletion();
            document.getElementById('trophy-banner').classList.remove('hidden');
            document.getElementById('grand-finale-overlay').classList.remove('hidden');
        }


        let breathingTimer = null;
        let breathingTimeout = null;
        let breathingCycle = 0;
        let breathingPhaseIndex = 0;
        let breathingSecondsLeft = 0;
        const breathingPhases = [
            {name:"Breathe in",seconds:4,tip:"Gently breathe in through your nose."},
            {name:"Hold softly",seconds:2,tip:"Pause softly. No straining."},
            {name:"Breathe out",seconds:6,tip:"Slowly breathe out. Let your shoulders soften."}
        ];

        const guideContent = {
            "loc-home":{title:"Find your place",line:"Pause and look around. Are you at home? Choose the place that describes where you are.",person:"🧒",prop:"🏡",action:"Take a moment to notice your surroundings."},
            "loc-office":{title:"Check in at work",line:"Take one calm look around. Are you at work right now? Choose your location when you're ready.",person:"🧑‍💻",prop:"💼",action:"Notice where you are."},
            "loc-house":{title:"A guest today",line:"Are you visiting someone else's home? Look around and choose the place that fits.",person:"👧",prop:"🏠",action:"Notice your surroundings."},
            "loc-out":{title:"Out and about",line:"You're out somewhere. Take a breath, notice your surroundings, and choose this option if it fits.",person:"🧍",prop:"🌳",action:"Pause and orient yourself."},
            "start-1":{title:"Three grateful things",line:"Let's find three small things to appreciate. They can be as simple as a safe moment, a kind word, or a warm drink.",person:"🐻",prop:"🌼",action:"Think of three things. You can jot them down mentally or in your own words."},
            "start-2":{title:"Prayer and intention",line:"Let's pause together. Set a kind intention for yourself and the people you care about. Take the moment in your own way.",person:"🐰",prop:"🙏",action:"Take a quiet moment for prayer or a positive intention."},
            "start-3":{title:"Gentle movement",line:"Let's loosen up. Roll your shoulders gently, stretch your arms, and move only within a comfortable range.",person:"🐱",prop:"🙆",action:"Try a few gentle stretches. Stop if anything hurts."},
            "start-4":{title:"A little hydration",line:"I brought my glass! Watch me take a refreshing sip. Now it's your turn—enjoy some water at a comfortable pace.",person:"👧",prop:"🥛",action:"Drink your water. No need to rush.",drink:true},
            "mid-1":{title:"Posture and stretch",line:"Let's reset our posture. Unclench your jaw, relax your shoulders, sit or stand comfortably, then stretch gently.",person:"🐼",prop:"🧘",action:"Take a comfortable posture and stretch gently."},
            "mid-2":{title:"Breathe with me",line:"We'll do five gentle 4–2–6 cycles: breathe in for 4, pause softly for 2, and breathe out for 6. Keep it comfortable—never force or hold if uncomfortable.",person:"🐨",prop:"🌬️",action:"Start the five guided breathing cycles.",breathing:true},
            "mid-3":{title:"Midday water break",line:"A tiny water break can help you pause. Watch me take a sip, then have some water if it's available.",person:"👧",prop:"💧",action:"Drink some water at your own pace.",drink:true},
            "mid-4":{title:"Check how you feel",line:"Let's gently check in. What emotion is here right now? What thought is asking for your attention? You don't have to judge or fix it.",person:"🦊",prop:"💗",action:"Name what you're feeling, even if the answer is 'not sure'."},
            "mid-5":{title:"Let a thought drift by",line:"Imagine a thought floating past like a cloud. You can notice it without holding on. Let it drift away in its own time.",person:"🐣",prop:"☁️",action:"Notice one thought and practice letting it pass."},
            "end-1":{title:"Three wins today",line:"Let's celebrate three things you managed today. Tiny wins count: showing up, trying again, or taking a pause.",person:"🐻",prop:"🏆",action:"Write or think of three things you feel good about."},
            "end-2":{title:"Tomorrow's priorities",line:"Let's make tomorrow feel lighter. Choose up to three priorities that matter most. They don't need to be perfect.",person:"🐱",prop:"📝",action:"Write three realistic priorities for tomorrow."},
            "end-3":{title:"Evening hydration",line:"One more gentle reminder from me: have some water if you'd like and if it suits your needs. Sip comfortably.",person:"👧",prop:"🥛",action:"Drink some water at a comfortable pace.",drink:true},
            "end-4":{title:"Give yourself a GOOD JOB poke",line:"You made it through another day. Give yourself a gentle little nose boop and say, 'Good job. I kept going.'",person:"🐰",prop:"👃✨",action:"Give yourself a gentle nose poke and a kind word."},
            "sleep-1":{title:"Gratitude for others",line:"Think of three things someone did that you appreciated today. They can be very small moments.",person:"🐼",prop:"💛",action:"Write or remember three gratitude points about others."},
            "sleep-2":{title:"Gratitude for blessings",line:"Take a quiet moment to remember three blessings or things you're thankful for today, in your own words.",person:"🐰",prop:"✨",action:"Write or remember three gratitude points."},
            "sleep-3":{title:"Screen sunset",line:"Let's give your eyes and mind a gentle break. Put your device aside for the last 30 minutes before sleep when you can.",person:"🦉",prop:"🌙📵",action:"Begin your screen-free wind-down."},
            "sleep-4":{title:"A peaceful intention",line:"Before sleep, pause for a prayer or a gentle intention. Let the day settle; you can pick things up tomorrow.",person:"🐻",prop:"🙏",action:"Take a quiet moment for prayer or intention."},
            "sleep-5":{title:"Bedtime water reminder",line:"If you're thirsty, have a comfortable sip of water. No need to drink more than feels right before bed.",person:"👧",prop:"💧",action:"Have water if you need it, at a comfortable pace.",drink:true},
            "cloud-checked":{title:"Cloud check",line:"Choose a thought or feeling you want to release. Tap one of the clouds on your card and watch it drift away. You can leave any thought alone if you're not ready.",person:"🐥",prop:"☁️💨",action:"Release a cloud thought when you're ready."}
        };

        function stopBreathingTimer() {
            if (breathingTimer) { clearInterval(breathingTimer); breathingTimer = null; }
            if (breathingTimeout) { clearTimeout(breathingTimeout); breathingTimeout = null; }
        }


        function buildStretchingCartoon(mini = false) {
            const label = 'Two people, a man and a woman, raising their arms overhead for a gentle stretch.';
            return '<div class="stretch-demo-wrap'+(mini?' stretch-demo-preview':'')+'" role="img" aria-label="'+label+'">' +
                '<svg class="stretch-demo-svg" viewBox="0 0 320 190" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
                '<defs>' +
                    '<linearGradient id="stretch-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5fbff"/><stop offset="1" stop-color="#fff8ec"/></linearGradient>' +
                    '<linearGradient id="stretch-man-shirt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#76b9a7"/><stop offset="1" stop-color="#3f8778"/></linearGradient>' +
                    '<linearGradient id="stretch-woman-shirt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb0a8"/><stop offset="1" stop-color="#e77e91"/></linearGradient>' +
                '</defs>' +
                '<rect x="4" y="4" width="312" height="180" rx="22" fill="url(#stretch-sky)"/>' +
                '<circle class="stretch-demo-sun" cx="160" cy="26" r="11" fill="#f5cf72" opacity=".8"/>' +
                '<path d="M145 26 H133 M187 26 H175 M160 11 V3 M160 49 V41 M148 14 L142 8 M178 44 L172 38 M148 38 L142 44 M178 8 L172 14" stroke="#e8bd58" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>' +
                '<path d="M23 166 Q160 158 297 166" fill="none" stroke="#d7e7dc" stroke-width="3" stroke-linecap="round"/>' +
                '<ellipse cx="95" cy="168" rx="34" ry="5" fill="#a9c3b7" opacity=".3"/><ellipse cx="225" cy="168" rx="34" ry="5" fill="#a9c3b7" opacity=".3"/>' +

                /* Man: short dark hair, teal top and navy trousers. */
                '<g class="stretch-man">' +
                    '<path d="M78 117 Q72 137 72 160 M106 117 Q112 137 116 160" fill="none" stroke="#344b63" stroke-width="12" stroke-linecap="round"/>' +
                    '<path d="M58 161 Q71 155 81 162 Q84 168 69 170 Q56 171 58 161Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<path d="M106 162 Q118 155 130 162 Q132 169 117 170 Q105 171 106 162Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<g class="stretch-man-upper">' +
                        '<path d="M84 59 Q95 55 106 59 L116 118 Q95 127 74 118 Z" fill="url(#stretch-man-shirt)" stroke="#3a756b" stroke-width="2.3" stroke-linejoin="round"/>' +
                        '<path d="M88 64 Q95 70 102 64" fill="none" stroke="#d6f1e7" stroke-width="2" stroke-linecap="round"/>' +
                        '<path d="M95 72 V116" stroke="#3e8276" stroke-width="2" opacity=".35"/>' +
                        '<path d="M86 112 Q95 116 104 112" fill="none" stroke="#a8d8c9" stroke-width="2" opacity=".75"/>' +
                        '<path d="M87 42 L87 59 M103 42 L103 59" stroke="#bd805f" stroke-width="6" stroke-linecap="round"/>' +
                        '<circle cx="95" cy="37" r="16" fill="#d99b78" stroke="#a86e50" stroke-width="2"/>' +
                        '<path d="M79 37 Q77 17 95 17 Q112 17 112 36 Q103 28 94 30 Q86 29 79 37Z" fill="#493a36" stroke="#302b2b" stroke-width="2" stroke-linejoin="round"/>' +
                        '<path d="M86 39 Q88 41 90 39 M100 39 Q102 41 104 39" fill="none" stroke="#3b302c" stroke-width="2" stroke-linecap="round"/>' +
                        '<path d="M91 48 Q95 51 100 48" fill="none" stroke="#864e45" stroke-width="2" stroke-linecap="round"/>' +
                    '</g>' +
                    '<g class="stretch-arm stretch-man-left"><path d="M80 75 Q66 84 60 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="60" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                    '<g class="stretch-arm stretch-man-right"><path d="M110 75 Q124 84 130 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="130" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                '</g>' +

                /* Woman: long dark hair, coral top and plum leggings. */
                '<g class="stretch-woman">' +
                    '<path d="M208 117 Q202 137 199 160 M238 117 Q244 137 248 160" fill="none" stroke="#58445f" stroke-width="12" stroke-linecap="round"/>' +
                    '<path d="M184 161 Q197 155 207 162 Q210 168 195 170 Q182 171 184 161Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<path d="M238 162 Q250 155 262 162 Q264 169 249 170 Q237 171 238 162Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<g class="stretch-woman-upper">' +
                        '<path d="M214 59 Q225 55 236 59 L246 118 Q225 127 204 118 Z" fill="url(#stretch-woman-shirt)" stroke="#bd6477" stroke-width="2.3" stroke-linejoin="round"/>' +
                        '<path d="M218 65 Q225 71 232 65" fill="none" stroke="#ffe4df" stroke-width="2" stroke-linecap="round"/>' +
                        '<path d="M225 72 V116" stroke="#bd6477" stroke-width="2" opacity=".3"/>' +
                        '<path d="M216 112 Q225 116 234 112" fill="none" stroke="#ffe2df" stroke-width="2" opacity=".75"/>' +
                        '<path d="M217 42 L217 59 M233 42 L233 59" stroke="#d99b78" stroke-width="6" stroke-linecap="round"/>' +
                        '<path d="M208 38 Q205 13 226 13 Q246 14 243 42 L243 65 Q238 75 234 61 L237 39 Q226 28 216 39 L216 62 Q209 70 205 59Z" fill="#493a36" stroke="#302b2b" stroke-width="2" stroke-linejoin="round"/>' +
                        '<circle cx="225" cy="37" r="16" fill="#d99b78" stroke="#a86e50" stroke-width="2"/>' +
                        '<path d="M209 36 Q208 19 225 19 Q242 19 241 36 Q231 27 223 30 Q215 29 209 36Z" fill="#493a36"/>' +
                        '<ellipse cx="219" cy="38" rx="1.8" ry="2.5" fill="#3b302c"/><ellipse cx="231" cy="38" rx="1.8" ry="2.5" fill="#3b302c"/>' +
                        '<path d="M220 48 Q225 52 230 48" fill="none" stroke="#864e45" stroke-width="2" stroke-linecap="round"/>' +
                        '<circle cx="211" cy="46" r="3" fill="#ee9b9b" opacity=".65"/><circle cx="239" cy="46" r="3" fill="#ee9b9b" opacity=".65"/>' +
                    '</g>' +
                    '<g class="stretch-arm stretch-woman-left"><path d="M210 75 Q196 84 190 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="190" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                    '<g class="stretch-arm stretch-woman-right"><path d="M240 75 Q254 84 260 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="260" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                '</g>' +
                '<g fill="#7aa99a" opacity=".8"><path d="M35 135 Q43 119 51 135 Q43 132 35 135Z"/><path d="M272 135 Q280 119 288 135 Q280 132 272 135Z"/></g>' +
                '</svg></div>';
        }

        function openModal(type, checkboxId) {
            stopBreathingTimer();
            activeModalType = type;
            activeTargetCheckboxId = checkboxId;
            const guide = guideContent[checkboxId] || {
                title:"Let's do this together",line:"Take a gentle moment for this activity. Go at your own pace.",person:"🐻",prop:"✨",action:"When you're ready, tell me you've completed the activity."
            };
            const target = document.getElementById('modal-animation-target');
            const instructions = document.getElementById('modal-instructions');
            const button = document.getElementById('modal-complete-btn');
            document.querySelector('#modal-content-box h2')?.remove();
            target.innerHTML = '';
            instructions.innerHTML = '';
            button.disabled = false;
            button.classList.remove('opacity-50','cursor-not-allowed');
            button.style.display = 'block';

            const heading = document.createElement('h2');
            heading.className = 'text-2xl font-bold text-amber-900 handwriting mb-2';
            heading.textContent = guide.title;
            document.getElementById('modal-content-box').insertBefore(heading,target);

            if (type === 'clouds') {
                target.innerHTML = '<div class="cloud-intro-gallery">' +
                    '<div class="cloud-intro-item cloud-cumulus"><span class="cloud-art" aria-hidden="true">☁️</span><span>Cumulus</span></div>' +
                    '<div class="cloud-intro-item cloud-stratus"><span class="cloud-art" aria-hidden="true">🌫️</span><span>Stratus</span></div>' +
                    '<div class="cloud-intro-item cloud-stratocumulus"><span class="cloud-art" aria-hidden="true">🌥️<span class="cloud-rain">💧💧</span></span><span>Stratocumulus</span></div>' +
                    '</div><div class="guide-speech cloud-intro-copy">Meet the three clouds. Tap each one on your card and watch it drift away. After all three have been released, your completion checkbox will appear.</div>';
                instructions.textContent = 'Notice each feeling gently. You can release a cloud when you feel ready.';
                button.textContent = 'Let’s release the clouds';
                button.onclick = closeModal;
            } else if (guide.breathing) {
                target.innerHTML = '<div class="flex flex-col items-center gap-3 w-full"><div id="breathing-orb" class="guide-breath-orb"></div><div id="breathing-phase" class="text-xl font-bold text-blue-800">Ready?</div><div id="breathing-tip" class="text-sm text-slate-600">We will take five gentle cycles together.</div><div id="breathing-count" class="guide-timer">5 cycles</div><div id="breathing-clock" class="text-xs text-blue-700 font-semibold">12 seconds per cycle</div></div>';
                instructions.textContent = guide.line;
                button.textContent = 'Start 5 breathing cycles';
                button.onclick = startBreathingExercise;
            } else {
                let motionClass = '';
                if (guide.drink) motionClass = 'drinking';
                else if (['start-3','mid-1'].includes(checkboxId)) motionClass = 'stretching';
                else if (['start-2','sleep-4'].includes(checkboxId)) motionClass = 'praying';
                else if (['start-1','end-1','sleep-1','sleep-2'].includes(checkboxId)) motionClass = 'thinking';
                else if (['end-2'].includes(checkboxId)) motionClass = 'writing';
                else if (['mid-5','cloud-checked'].includes(checkboxId)) motionClass = 'floating';
                else if (['end-4'].includes(checkboxId)) motionClass = 'boop';
                else if (['sleep-3'].includes(checkboxId)) motionClass = 'thinking';
                const propMotion = ['end-2'].includes(checkboxId) ? 'writing' : (['mid-5','cloud-checked'].includes(checkboxId) ? 'floating' : (checkboxId === 'sleep-3' ? 'screen-away' : ''));
                target.innerHTML = (['start-3','mid-1'].includes(checkboxId) ? buildStretchingCartoon(false) : '<div class="guide-scene"><span class="guide-person '+motionClass+'">'+guide.person+'</span><span class="guide-prop '+(guide.drink?'guide-cup ':'')+propMotion+'">'+guide.prop+'</span></div>') + '<div class="guide-speech" id="guide-speech"></div><p class="text-xs text-slate-500 mt-3" id="guide-action"></p>';
                document.getElementById('guide-speech').textContent = guide.line;
                document.getElementById('guide-action').textContent = guide.action;
                instructions.textContent = guide.drink ? "My turn... sip! Your turn next. Take your time." : "Let's do it at your own pace.";
                button.textContent = guide.drink ? "I'm done drinking—show my checkbox" : "I've done it—show my checkbox";
                button.onclick = completeAnimation;
                if (guide.drink) {
                    button.disabled = true;
                    button.classList.add('opacity-50','cursor-not-allowed');
                    breathingTimeout = setTimeout(() => {
                        button.disabled = false;
                        button.classList.remove('opacity-50','cursor-not-allowed');
                        instructions.textContent = "Your turn! Are you done with your water?";
                        document.getElementById('guide-speech').textContent = "Your turn! Are you done drinking your water?";
                    }, 2200);
                }
            }
            document.getElementById('anim-modal').classList.remove('hidden');
        }

        function startBreathingExercise() {
            stopBreathingTimer();
            breathingCycle = 1;
            breathingPhaseIndex = 0;
            breathingSecondsLeft = breathingPhases[0].seconds;
            const button = document.getElementById('modal-complete-btn');
            button.disabled = true;
            button.classList.add('opacity-50','cursor-not-allowed');
            button.textContent = 'Breathing with you...';
            updateBreathingDisplay();
            breathingTimer = setInterval(() => {
                breathingSecondsLeft--;
                if (breathingSecondsLeft <= 0) {
                    breathingPhaseIndex++;
                    if (breathingPhaseIndex >= breathingPhases.length) {
                        breathingPhaseIndex = 0;
                        breathingCycle++;
                    }
                    if (breathingCycle > 5) {
                        stopBreathingTimer();
                        document.getElementById('breathing-phase').textContent = 'Amazing work!';
                        document.getElementById('breathing-tip').textContent = 'Five gentle cycles complete. Take a normal, comfortable breath.';
                        document.getElementById('breathing-count').textContent = '5 / 5 cycles';
                        document.getElementById('breathing-clock').textContent = 'You did it!';
                        document.getElementById('breathing-orb').style.animation = 'none';
                        const doneButton = document.getElementById('modal-complete-btn');
                        doneButton.disabled = false;
                        doneButton.classList.remove('opacity-50','cursor-not-allowed');
                        doneButton.textContent = 'Good job! Show my checkbox';
                        doneButton.onclick = completeAnimation;
                        document.getElementById('modal-instructions').textContent = 'Good job! You are doing amazing!';
                        playPopSound();
                        return;
                    }
                    breathingSecondsLeft = breathingPhases[breathingPhaseIndex].seconds;
                }
                updateBreathingDisplay();
            },1000);
        }

        function updateBreathingDisplay() {
            const phase = breathingPhases[breathingPhaseIndex];
            const phaseEl = document.getElementById('breathing-phase');
            if (!phaseEl) return;
            phaseEl.textContent = phase.name;
            document.getElementById('breathing-tip').textContent = phase.tip;
            document.getElementById('breathing-count').textContent = 'Cycle ' + breathingCycle + ' of 5';
            document.getElementById('breathing-clock').textContent = breathingSecondsLeft + ' seconds';
            const orb = document.getElementById('breathing-orb');
            if (phase.name === 'Breathe in') {
                orb.style.animation = 'guide-breath-in 4s ease-in-out 1 forwards';
            } else if (phase.name === 'Hold softly') {
                orb.style.animation = 'none';
                orb.style.transform = 'scale(1.2)';
            } else {
                orb.style.animation = 'guide-breath-out 6s ease-in-out 1 forwards';
            }
        }

        function closeModal() {
            stopBreathingTimer();
            document.getElementById('anim-modal').classList.add('hidden');
        }

        function completeAnimation() {
            const chk = activeTargetCheckboxId
                ? (document.getElementById('chk-' + activeTargetCheckboxId) || document.querySelector('[data-id="' + activeTargetCheckboxId + '"]'))
                : null;
            closeModal();
            playPopSound();
            if (chk) {
                chk.disabled = false;
                chk.dataset.guideUnlocked = 'true';
                chk.classList.remove('guide-hidden');
                const row = chk.closest('.guided-task-row');
                const label = row?.querySelector('.guide-checkbox-label');
                if (label) label.classList.add('is-unlocked');
                // Leave Show me visible so the user can replay the demonstration.
                saveData();
            }
        }

        function restoreCloudProgress(data) {
            document.querySelectorAll('.cloud-item[data-cloud]').forEach(item => {
                const released = data['cloud_' + item.dataset.cloud] === true;
                item.dataset.released = released ? 'true' : 'false';
                item.disabled = released;
                item.setAttribute('aria-pressed',released ? 'true' : 'false');
                item.classList.toggle('cloud-released',released);
                item.classList.toggle('is-restored',released);
                const status = item.querySelector('.cloud-status');
                if (status) status.textContent = released ? 'Released ✓' : 'Tap to release';
            });
            updateCloudProgress();
        }

        function updateCloudProgress() {
            const items = Array.from(document.querySelectorAll('.cloud-item[data-cloud]'));
            const releasedCount = items.filter(item => item.dataset.released === 'true').length;
            const progress = document.getElementById('cloud-progress');
            if (progress) {
                progress.textContent = releasedCount === items.length
                    ? '3 of 3 clouds released. Lovely work! Your completion checkbox is ready below.'
                    : releasedCount + ' of ' + items.length + ' clouds released. Tap each cloud to let it drift away.';
            }

            const cloudChk = document.getElementById('chk-cloud-checked');
            if (!cloudChk) return;
            const allReleased = items.length > 0 && releasedCount === items.length;

            if (allReleased) {
                cloudChk.disabled = false;
                cloudChk.dataset.guideUnlocked = 'true';
                cloudChk.classList.remove('guide-hidden');
                cloudChk.closest('.guided-task-row')?.querySelector('.guide-checkbox-label')?.classList.add('is-unlocked');
            } else if (!cloudChk.checked) {
                cloudChk.disabled = true;
                cloudChk.dataset.guideUnlocked = 'false';
                cloudChk.classList.add('guide-hidden');
                cloudChk.closest('.guided-task-row')?.querySelector('.guide-checkbox-label')?.classList.remove('is-unlocked');
            }
        }

        function releaseCloud(el) {
            if (!el || !el.dataset.cloud || el.dataset.released === 'true') return;
            el.dataset.released = 'true';
            el.disabled = true;
            el.setAttribute('aria-pressed','true');
            el.classList.add('cloud-released');
            const status = el.querySelector('.cloud-status');
            if (status) status.textContent = 'Released ✓';
            playPopSound();
            confetti({ particleCount: 15, spread: 40, origin: { y: 0.6 } });
            updateCloudProgress();
            saveData();
            updateEcosystemTree({trunk:true});
        }

        function speakProudCue() {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance("I am so proud of you!");
                utterance.pitch = 1.2;
                utterance.rate = 0.95;
                window.speechSynthesis.speak(utterance);
            }
        }

        function playPopSound() {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(850, audioCtx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.08);
        }

        function playFanfareSound() {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, index) => {
                setTimeout(() => {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start();
                    osc.stop(audioCtx.currentTime + 0.35);
                }, index * 130);
            });
        }

        function attachChecklistCartoons() {
            document.querySelectorAll('.app-chk').forEach(chk => {
                const label = chk.closest('label');
                if (!label || label.closest('.guided-task-row')) return;
                const row = document.createElement('div');
                row.className = 'guided-task-row';
                label.parentNode.insertBefore(row,label);
                row.appendChild(label);
                label.classList.add('guide-checkbox-label');
                chk.classList.add('guide-hidden');
                const id = chk.dataset.id;
                // Card 6 is guided by its three individually animated cloud buttons.
                if (id === 'cloud-checked') return;
                const guideButton = document.createElement('button');
                guideButton.type = 'button';
                guideButton.className = 'guide-launch';
                const buddy = guideContent[id];
                guideButton.innerHTML = (['start-3','mid-1'].includes(id) ? buildStretchingCartoon(true) : '<span class="guide-buddy '+(buddy?.drink?'drink':'')+'" aria-hidden="true">'+(buddy?.person || '🐻')+'</span>') + '<span>Show me</span>';
                guideButton.setAttribute('aria-label','Show animated guide for '+id);
                guideButton.addEventListener('click',() => openModal('guided',id));
                row.insertBefore(guideButton,label);
            });
            document.querySelectorAll('button[onclick^="openModal("]').forEach(button => {
                // Hide only the old inline guide button; never hide its task heading or row.
                // Card 6 keeps its dedicated cloud-animation launcher.
                if (!button.closest('#card-step-6')) button.classList.add('legacy-guide-button');
            });
            syncChecklistCartoons();
        }

        function syncChecklistCartoons() {
            document.querySelectorAll('.app-chk').forEach(chk => {
                const row = chk.closest('.guided-task-row');
                const label = row?.querySelector('.guide-checkbox-label');
                const launch = row?.querySelector('.guide-launch');
                const unlocked = chk.dataset.guideUnlocked === 'true' || chk.checked;
                chk.classList.toggle('guide-hidden',!unlocked);
                if (unlocked) {
                    chk.disabled = false;
                    label?.classList.add('is-unlocked');
                    chk.dataset.guideUnlocked = 'true';
                } else {
                    label?.classList.remove('is-unlocked');
                }
                // Keep "Show me" available so the user can replay the demonstration anytime.
                launch?.classList.remove('is-hidden');
            });
        }

        function getStorageKey(dateStr) { return 'mindful_pokes_data_' + dateStr; }

        function updateScoreDisplay() {
            let totalScore = parseInt(localStorage.getItem('user_confidence_score') || '0');
            document.getElementById('launcher-score').innerText = totalScore;
        }

        function updateDailyActivityProgress() {
            let total=1,completed=isSectionComplete(1)?1:0;
            for(let section=2;section<=6;section++){
                const checks=Array.from(document.querySelectorAll('.sec-'+section));
                total+=checks.length;completed+=checks.filter(check=>check.checked).length;
            }
            const label=document.getElementById('daily-progress-count'),bar=document.getElementById('daily-progress-bar'),track=document.getElementById('daily-progress-track');
            const percent=total?Math.round((completed/total)*100):0;
            if(label)label.textContent=completed+' of '+total+' steps';
            if(bar)bar.style.width=percent+'%';
            if(track)track.setAttribute('aria-valuenow',String(completed));
        }


        function replayEcosystemEffect(selector,className){
            const element=document.querySelector(selector);
            if(!element)return;
            element.classList.remove(className);
            void element.getBoundingClientRect();
            element.classList.add(className);
        }

        const ecosystemCanvasMotion={roots:0,clouds:0,flowers:0,seedDrop:0};
        const ecosystemCanvasTargets={roots:0,clouds:0,flowers:0,seedDrop:0};
        let ecosystemCanvasParticles=[];
        let ecosystemCanvasContext=null;
        let ecosystemCanvasFrame=null;

        function ecosystemCanvasReducedMotion(){
            return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }

        function resizeEcosystemCanvas(){
            const canvas=document.getElementById('ecosystem-canvas');
            const fallback=document.getElementById('ecosystem-tree-art');
            if(!canvas)return;
            if(!ecosystemCanvasContext){
                try{ecosystemCanvasContext=canvas.getContext('2d');}catch(error){ecosystemCanvasContext=null;}
            }
            if(!ecosystemCanvasContext){
                canvas.style.display='none';
                if(fallback)fallback.style.display='block';
                return;
            }
            if(fallback)fallback.style.display='none';
            canvas.style.display='block';
            const rect=canvas.getBoundingClientRect();
            if(rect.width<1||rect.height<1)return;
            const dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
            const pixelWidth=Math.max(1,Math.round(rect.width*dpr));
            const pixelHeight=Math.max(1,Math.round(rect.height*dpr));
            if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
            if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
            const scale=Math.min(rect.width/320,rect.height/240);
            const offsetX=(rect.width-320*scale)/2;
            const offsetY=(rect.height-240*scale)/2;
            try{ecosystemCanvasContext.setTransform(scale*dpr,0,0,scale*dpr,offsetX*dpr,offsetY*dpr);}
            catch(error){
                ecosystemCanvasContext=null;
                canvas.style.display='none';
                if(fallback)fallback.style.display='block';
                return;
            }
            drawEcosystemCanvas();
        }

        function traceEcosystemRoot(ctx,x0,y0,cx,cy,x1,y1,progress){
            const amount=Math.max(0,Math.min(1,progress));
            if(amount<=0)return;
            const steps=28;
            const last=Math.max(1,Math.ceil(steps*amount));
            ctx.beginPath();
            ctx.moveTo(x0,y0);
            for(let i=1;i<=last;i++){
                const t=Math.min(amount,i/steps);
                const inverse=1-t;
                ctx.lineTo(inverse*inverse*x0+2*inverse*t*cx+t*t*x1,inverse*inverse*y0+2*inverse*t*cy+t*t*y1);
            }
            ctx.stroke();
        }

        function drawEcosystemFlower(ctx,x,y,scale){
            if(scale<=0.01)return;
            ctx.save();
            ctx.translate(x,y);
            ctx.scale(scale,scale);
            ctx.fillStyle='#f48fb1';
            ctx.strokeStyle='#d5799a';
            ctx.lineWidth=1;
            for(let i=0;i<5;i++){
                ctx.save();
                ctx.rotate((Math.PI*2*i)/5);
                ctx.beginPath();
                ctx.ellipse(0,-5.2,3.2,5.8,0,0,Math.PI*2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
            ctx.beginPath();
            ctx.fillStyle='#fff1a8';
            ctx.arc(0,0,2.7,0,Math.PI*2);
            ctx.fill();
            ctx.restore();
        }

        function drawEcosystemCanvas(){
            const ctx=ecosystemCanvasContext;
            if(!ctx)return;
            const roots=Math.max(0,Math.min(1,ecosystemCanvasMotion.roots));
            const clouds=Math.max(0,Math.min(3,ecosystemCanvasMotion.clouds));
            const flowers=Math.max(0,Math.min(1,ecosystemCanvasMotion.flowers));
            const seedDrop=Math.max(0,ecosystemCanvasMotion.seedDrop);
            const centerX=160;
            const groundY=184;
            ctx.clearRect(0,0,320,240);

            const sky=ctx.createRadialGradient(160,84,8,160,104,150);
            sky.addColorStop(0,'rgba(255,255,245,.88)');
            sky.addColorStop(1,'rgba(220,235,220,0)');
            ctx.fillStyle=sky;
            ctx.fillRect(8,4,304,210);

            const soil=ctx.createLinearGradient(0,groundY,0,240);
            soil.addColorStop(0,'#a77b4f');
            soil.addColorStop(1,'#705034');
            ctx.fillStyle=soil;
            ctx.fillRect(12,groundY,296,56);
            ctx.beginPath();
            ctx.moveTo(18,groundY+1);
            ctx.quadraticCurveTo(78,groundY-5,128,groundY+1);
            ctx.quadraticCurveTo(190,groundY+6,244,groundY);
            ctx.quadraticCurveTo(279,groundY-3,302,groundY+1);
            ctx.strokeStyle='#9dbd91';
            ctx.lineWidth=4;
            ctx.lineCap='round';
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(24,groundY+8);
            ctx.quadraticCurveTo(160,groundY+14,296,groundY+7);
            ctx.strokeStyle='rgba(231,238,213,.45)';
            ctx.lineWidth=1.5;
            ctx.setLineDash([3,5]);
            ctx.stroke();
            ctx.setLineDash([]);

            if(roots>0.001){
                ctx.save();
                ctx.strokeStyle='#6f5037';
                ctx.lineCap='round';
                ctx.lineJoin='round';
                ctx.lineWidth=5;
                traceEcosystemRoot(ctx,centerX,groundY,158,groundY+20,160,groundY+51,roots);
                ctx.lineWidth=3.8;
                traceEcosystemRoot(ctx,159,groundY+13,143,groundY+23,112,groundY+37,roots);
                traceEcosystemRoot(ctx,161,groundY+13,179,groundY+23,207,groundY+39,roots);
                ctx.lineWidth=2.5;
                traceEcosystemRoot(ctx,128,groundY+29,111,groundY+43,87,groundY+48,roots);
                traceEcosystemRoot(ctx,192,groundY+30,209,groundY+43,233,groundY+49,roots);
                ctx.restore();
            }

            // Each existing cloud release increases trunk width by exactly five percent.
            const trunkX=1+clouds*0.05;
            const trunkY=0.82+clouds*0.06;
            ctx.save();
            ctx.translate(centerX,groundY);
            ctx.scale(trunkX,trunkY);
            ctx.lineCap='round';
            ctx.lineJoin='round';
            ctx.beginPath();
            ctx.moveTo(-3,-56);
            ctx.quadraticCurveTo(-25,-78,-42,-91);
            ctx.moveTo(3,-58);
            ctx.quadraticCurveTo(27,-79,43,-92);
            ctx.strokeStyle='#866347';
            ctx.lineWidth=7;
            ctx.stroke();

            const bark=ctx.createLinearGradient(-14,0,14,0);
            bark.addColorStop(0,'#806044');
            bark.addColorStop(.48,'#b58b60');
            bark.addColorStop(1,'#76573d');
            ctx.beginPath();
            ctx.moveTo(-13,0);
            ctx.quadraticCurveTo(-8,-35,-7,-94);
            ctx.lineTo(7,-94);
            ctx.quadraticCurveTo(8,-38,13,0);
            ctx.closePath();
            ctx.fillStyle=bark;
            ctx.fill();
            ctx.strokeStyle='#75583e';
            ctx.lineWidth=2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-1,-12);
            ctx.quadraticCurveTo(3,-48,0,-85);
            ctx.strokeStyle='rgba(236,207,165,.65)';
            ctx.lineWidth=3;
            ctx.stroke();
            ctx.restore();

            const topY=groundY-94*trunkY;
            const leafClusters=[
                {x:centerX,y:topY-17,r:27,c:'#81ad78'},
                {x:centerX-32,y:topY-4,r:22,c:'#8fbd83'},
                {x:centerX+32,y:topY-5,r:22,c:'#6fa46f'},
                {x:centerX-17,y:topY-34,r:18,c:'#a8c995'},
                {x:centerX+18,y:topY-35,r:18,c:'#a4c48e'}
            ];
            leafClusters.forEach((leaf,index)=>{
                ctx.beginPath();
                ctx.fillStyle=leaf.c;
                ctx.arc(leaf.x,leaf.y,leaf.r,0,Math.PI*2);
                ctx.fill();
                ctx.beginPath();
                ctx.strokeStyle=index%2?'rgba(240,248,225,.75)':'rgba(231,244,218,.8)';
                ctx.lineWidth=1.1;
                ctx.moveTo(leaf.x,leaf.y+leaf.r*.55);
                ctx.lineTo(leaf.x,leaf.y-leaf.r*.55);
                ctx.stroke();
            });
            [
                [centerX-33,topY-15],[centerX+28,topY-18],[centerX,topY-45],
                [centerX-48,topY+7],[centerX+47,topY+5]
            ].forEach((point,index)=>drawEcosystemFlower(ctx,point[0],point[1],flowers*(index===2?1:.88)));

            const seedY=groundY-2-seedDrop*42;
            ctx.save();
            ctx.globalAlpha=Math.max(.28,1-roots*.72);
            const seedGlow=ctx.createRadialGradient(centerX,seedY,1,centerX,seedY,16);
            seedGlow.addColorStop(0,'rgba(255,236,151,.55)');
            seedGlow.addColorStop(1,'rgba(255,236,151,0)');
            ctx.fillStyle=seedGlow;
            ctx.beginPath();
            ctx.arc(centerX,seedY,16,0,Math.PI*2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(centerX,seedY,7,4.7,Math.PI/7,0,Math.PI*2);
            ctx.fillStyle='#d4b18a';
            ctx.fill();
            ctx.strokeStyle='#7e5d42';
            ctx.lineWidth=1.3;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(centerX-2,seedY-1);
            ctx.quadraticCurveTo(centerX+1,seedY-5,centerX+3,seedY-2);
            ctx.strokeStyle='#f5dfbd';
            ctx.lineWidth=1.1;
            ctx.stroke();
            ctx.restore();

            ecosystemCanvasParticles.forEach(particle=>{
                ctx.save();
                ctx.globalAlpha=Math.max(0,particle.life);
                ctx.fillStyle=particle.color;
                ctx.beginPath();
                ctx.arc(particle.x,particle.y,particle.radius*Math.max(.25,particle.life),0,Math.PI*2);
                ctx.fill();
                ctx.restore();
            });
        }

        function scheduleEcosystemCanvasFrame(){
            const canvas=document.getElementById('ecosystem-canvas');
            if(!canvas||!ecosystemCanvasContext)return;
            const rect=canvas.getBoundingClientRect();
            if(rect.width<1||rect.height<1)return;
            if(ecosystemCanvasFrame!==null)return;
            if(ecosystemCanvasReducedMotion()){
                ecosystemCanvasMotion.roots=ecosystemCanvasTargets.roots;
                ecosystemCanvasMotion.clouds=ecosystemCanvasTargets.clouds;
                ecosystemCanvasMotion.flowers=ecosystemCanvasTargets.flowers;
                ecosystemCanvasMotion.seedDrop=ecosystemCanvasTargets.seedDrop;
                ecosystemCanvasParticles=[];
                drawEcosystemCanvas();
                return;
            }
            ecosystemCanvasFrame=requestAnimationFrame(runEcosystemCanvasFrame);
        }

        function runEcosystemCanvasFrame(){
            ecosystemCanvasFrame=null;
            if(ecosystemCanvasReducedMotion()){
                ecosystemCanvasMotion.roots=ecosystemCanvasTargets.roots;
                ecosystemCanvasMotion.clouds=ecosystemCanvasTargets.clouds;
                ecosystemCanvasMotion.flowers=ecosystemCanvasTargets.flowers;
                ecosystemCanvasMotion.seedDrop=ecosystemCanvasTargets.seedDrop;
                ecosystemCanvasParticles=[];
                drawEcosystemCanvas();
                return;
            }
            const lerp=(start,end,factor)=>start+(end-start)*factor;
            ecosystemCanvasMotion.roots=lerp(ecosystemCanvasMotion.roots,ecosystemCanvasTargets.roots,.105);
            ecosystemCanvasMotion.clouds=lerp(ecosystemCanvasMotion.clouds,ecosystemCanvasTargets.clouds,.105);
            ecosystemCanvasMotion.flowers=lerp(ecosystemCanvasMotion.flowers,ecosystemCanvasTargets.flowers,.105);
            ecosystemCanvasMotion.seedDrop=lerp(ecosystemCanvasMotion.seedDrop,ecosystemCanvasTargets.seedDrop,.16);
            ecosystemCanvasParticles=ecosystemCanvasParticles.filter(particle=>{
                particle.x+=particle.vx;
                particle.y+=particle.vy;
                particle.vy+=.025;
                particle.life-=.035;
                return particle.life>.04;
            });
            drawEcosystemCanvas();
            const moving=['roots','clouds','flowers','seedDrop'].some(key=>Math.abs(ecosystemCanvasMotion[key]-ecosystemCanvasTargets[key])>.002);
            if(moving||ecosystemCanvasParticles.length)ecosystemCanvasFrame=requestAnimationFrame(runEcosystemCanvasFrame);
        }

        function updateEcosystemCanvas(rootCount,cloudCount,canopyBloomed,animate={}){
            const canvas=document.getElementById('ecosystem-canvas');
            if(!canvas)return;
            ecosystemCanvasTargets.roots=Math.max(0,Math.min(1,rootCount/6));
            ecosystemCanvasTargets.clouds=Math.max(0,Math.min(3,cloudCount));
            ecosystemCanvasTargets.flowers=canopyBloomed?1:0;
            const reduced=ecosystemCanvasReducedMotion();
            if(animate.roots)spawnEcosystemCanvasParticles(160,190);
            if(animate.trunk)spawnEcosystemCanvasParticles(160,100);
            if(animate.flower)spawnEcosystemCanvasParticles(206,64);
            if(reduced){
                ecosystemCanvasMotion.roots=ecosystemCanvasTargets.roots;
                ecosystemCanvasMotion.clouds=ecosystemCanvasTargets.clouds;
                ecosystemCanvasMotion.flowers=ecosystemCanvasTargets.flowers;
                ecosystemCanvasParticles=[];
                drawEcosystemCanvas();
                return;
            }
            const changed=['roots','clouds','flowers'].some(key=>Math.abs(ecosystemCanvasMotion[key]-ecosystemCanvasTargets[key])>.002);
            if(changed||ecosystemCanvasParticles.length)scheduleEcosystemCanvasFrame();
            else drawEcosystemCanvas();
        }

        function spawnEcosystemCanvasParticles(x,y){
            const colors=['#8fbd83','#f48fb1','#f5d37c','#a7c8df'];
            for(let i=0;i<12&&ecosystemCanvasParticles.length<36;i++){
                const angle=(Math.PI*2*i)/12;
                const speed=.55+Math.random()*1.05;
                ecosystemCanvasParticles.push({
                    x:x+(Math.random()-.5)*9,y:y+(Math.random()-.5)*7,
                    vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-.35,
                    color:colors[i%colors.length],radius:1.4+Math.random()*1.4,life:.9+Math.random()*.1
                });
            }
        }

        function replayEcosystemWelcome(){
            const panel=document.getElementById('ecosystem-panel');
            if(panel&&!panel.classList.contains('has-roots')){
                ecosystemCanvasMotion.seedDrop=1;
                ecosystemCanvasTargets.seedDrop=0;
                scheduleEcosystemCanvasFrame();
                replayEcosystemEffect('#ecosystem-seed','is-arriving');
            }
        }

        function updateEcosystemTree(animate = {}) {
            const dateStr=document.getElementById('currentDate')?.value;
            if(!dateStr)return;
            let data={};
            try{data=JSON.parse(localStorage.getItem(getStorageKey(dateStr))||'{}')||{};}catch(error){data={};}

            const rootActions=['start-2','sleep-4','start-4','mid-3','end-3','sleep-5'];
            const rootCount=rootActions.filter(id=>data[id]===true).length;
            const cloudCount=['cumulus','stratus','stratocumulus'].filter(name=>data['cloud_'+name]===true).length;
            const canopyBloomed=data['sleep-3']===true;

            const panel=document.getElementById('ecosystem-panel');
            const seed=document.getElementById('ecosystem-seed');
            const roots=document.getElementById('ecosystem-roots');
            const trunk=document.getElementById('ecosystem-trunk');
            const canopy=document.getElementById('ecosystem-canopy');
            const rootStatus=document.getElementById('ecosystem-root-status');
            const trunkStatus=document.getElementById('ecosystem-trunk-status');
            const canopyStatus=document.getElementById('ecosystem-canopy-status');
            const intro=document.getElementById('ecosystem-intro-copy');

            panel?.classList.toggle('has-roots',rootCount>0);
            if(rootCount>0)seed?.classList.remove('is-arriving');
            if(roots){
                const rootProgress=rootCount/rootActions.length;
                roots.style.setProperty('--root-scale',(1+rootCount*.065).toFixed(3));
                roots.querySelectorAll('path').forEach(path=>{
                    let length=Number(path.dataset.ecoLength||0);
                    if(!length){
                        try{
                            length=path.getTotalLength();
                            path.dataset.ecoLength=String(length);
                            path.style.strokeDasharray=length.toFixed(2);
                        }catch(error){length=0;}
                    }
                    if(length)path.style.strokeDashoffset=(length*(1-rootProgress)).toFixed(2);
                });
            }
            if(trunk){
                trunk.style.setProperty('--trunk-x',(1+cloudCount*.05).toFixed(3));
                trunk.style.setProperty('--trunk-y',(0.82+cloudCount*.06).toFixed(3));
            }
            canopy?.classList.toggle('has-flower',canopyBloomed);

            if(rootStatus)rootStatus.textContent=rootCount
                ?rootCount+' of 6 prayer and water actions completed · roots reaching farther'
                :'0 of 6 actions · plant the seed with prayer or water';
            if(trunkStatus)trunkStatus.textContent=(cloudCount*5)+'% growth · '+cloudCount+' of 3 clouds released';
            if(canopyStatus)canopyStatus.textContent=canopyBloomed
                ?'1 of 1 · a flower has bloomed'
                :'0 of 1 · waiting for Screen Curfew';
            if(intro)intro.textContent=rootCount
                ?'Your small, steady actions are helping the roots reach farther. The trunk and canopy grow in their own time.'
                :'A fresh day begins with a seed. Choose one small prayer or water action to help it take root.';

            const updateMeter=(trackId,fillId,value,max)=>{
                const track=document.getElementById(trackId);
                const fill=document.getElementById(fillId);
                if(track)track.setAttribute('aria-valuenow',String(value));
                if(fill)fill.style.width=(max?Math.round((value/max)*100):0)+'%';
            };
            updateMeter('ecosystem-root-meter','ecosystem-root-meter-fill',rootCount,6);
            updateMeter('ecosystem-trunk-meter','ecosystem-trunk-meter-fill',cloudCount,3);
            updateMeter('ecosystem-canopy-meter','ecosystem-canopy-meter-fill',canopyBloomed?1:0,1);
            updateEcosystemCanvas(rootCount,cloudCount,canopyBloomed,animate);

            if(animate.roots&&rootCount)replayEcosystemEffect('#ecosystem-roots','is-pulsing');
            if(animate.trunk&&cloudCount)replayEcosystemEffect('#ecosystem-trunk','is-growing');
            if(animate.flower&&canopyBloomed)replayEcosystemEffect('#ecosystem-canopy','has-flower');
        }

        function checkSectionCompletion() {
            updateDailyActivityProgress();
            let completedCards = 0;
            for (let i = 1; i <= 6; i++) {
                const chks = document.querySelectorAll('.sec-' + i);
                const allChecked = isSectionComplete(i);
                
                const trophy = document.getElementById('trophy-' + i);
                if (allChecked && chks.length > 0) {
                    trophy.classList.remove('opacity-30');
                    trophy.classList.add('scale-125', 'opacity-100');
                    completedCards++;
                } else {
                    trophy.classList.add('opacity-30');
                    trophy.classList.remove('scale-125', 'opacity-100');
                }
            }

            const trophyBanner = document.getElementById('trophy-banner');
            const dateStr = document.getElementById('currentDate').value;
            const scoreAwardedKey = 'score_awarded_' + dateStr;

            if (completedCards === 6) {
                if (trophyBanner.classList.contains('hidden')) {
                    trophyBanner.classList.remove('hidden');
                    playFanfareSound();
                    setTimeout(speakProudCue, 400);
                    confetti({ particleCount: 120, spread: 90, origin: { y: 0.3 } });
                    
                    document.getElementById('grand-finale-overlay').classList.remove('hidden');

                    if (!localStorage.getItem(scoreAwardedKey)) {
                        let currentScore = parseInt(localStorage.getItem('user_confidence_score') || '0');
                        localStorage.setItem('user_confidence_score', currentScore + 100);
                        localStorage.setItem(scoreAwardedKey, 'true');
                        updateScoreDisplay();
                    }
                }
            } else {
                trophyBanner.classList.add('hidden');
            }
        }

        function closeGrandFinale() {
            document.getElementById('grand-finale-overlay').classList.add('hidden');
        }

        function loadData() {
            const dateStr = document.getElementById('currentDate').value;
            const saved = localStorage.getItem(getStorageKey(dateStr));
            const data = saved ? JSON.parse(saved) : {};

            // Older versions marked the cloud task complete after only one click.
            // Clear that legacy completion before restoring the checkbox state.
            if (data.cloud_flow_version !== 1 && data['cloud-checked'] === true) {
                data['cloud-checked'] = false;
                data['cloud-checked__guided'] = false;
            }

            document.querySelectorAll('.app-chk').forEach(chk => {
                const id = chk.dataset.id;
                const isChecked = data[id] !== undefined ? data[id] : false;
                chk.checked = isChecked;
                const guided = data[id + '__guided'] === true || isChecked;
                chk.dataset.guideUnlocked = guided ? 'true' : 'false';
                if (guided) chk.disabled = false;
            });

            // Private diary and reflections are loaded only after the passphrase unlocks them.
            restoreCloudProgress(data);
            syncChecklistCartoons();
            updateEcosystemTree();

            checkSectionCompletion();
            updateScoreDisplay();
        }

        function saveData(e) {
            if(e?.target&&(e.target.id==='private-diary-entry'||e.target.id==='diary-passphrase'||e.target.id==='diary-passphrase-confirm'||e.target.classList?.contains('text-input')))return;
            const dateStr=document.getElementById('currentDate').value;
            // Preserve old note values until they have been encrypted during first-time setup.
            let data={};
            try{data=JSON.parse(localStorage.getItem(getStorageKey(dateStr))||'{}')||{};}catch(error){data={};}

            document.querySelectorAll('.app-chk').forEach(chk => {
                data[chk.dataset.id] = chk.checked;
                data[chk.dataset.id + '__guided'] = chk.dataset.guideUnlocked === 'true' || chk.checked;
            });

            // Private reflection text is saved separately using AES-256-GCM.
            data.cloud_flow_version = 1;
            document.querySelectorAll('.cloud-item[data-cloud]').forEach(item => {
                data['cloud_' + item.dataset.cloud] = item.dataset.released === 'true';
            });

            localStorage.setItem(getStorageKey(dateStr), JSON.stringify(data));

            const changedId=e?.type==='change'&&e.target?.type==='checkbox'&&e.target.checked?e.target.dataset.id:null;
            updateEcosystemTree({
                roots:['start-2','sleep-4','start-4','mid-3','end-3','sleep-5'].includes(changedId),
                flower:changedId==='sleep-3'
            });

            if (e && e.target && e.target.type === 'checkbox' && e.target.checked) {
                playPopSound();
                confetti({ particleCount: 30, spread: 50, origin: { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight } });
            }

            checkSectionCompletion();
        }

        async function handleDateChange() {
            await flushPrivateWritingQueue();
            const previousDate=writingLoadedDate;
            if(writingCryptoKey&&previousDate)await savePrivateWritingForDate(previousDate);
            loadData();
            if(writingCryptoKey){
                try{await loadPrivateWritingForDate(getCurrentWritingDate());}
                catch(error){setWritingSecurityStatus('Could not decrypt this date’s private writing. Nothing was overwritten. '+(error?.message||''),'error');}
            }
        }

        async function resetDayData() {
            const dateStr=document.getElementById('currentDate').value;
            if(confirm("Reset today's checklist?")){
                await flushPrivateWritingQueue();
                localStorage.removeItem(getStorageKey(dateStr));
                localStorage.removeItem(getSecureWritingStorageKey('notes',dateStr));
                loadData();
                if(writingCryptoKey){
                    try{await loadPrivateWritingForDate(dateStr);}
                    catch(error){setWritingSecurityStatus('Checklist reset, but saved private writing could not be read. '+(error?.message||''),'error');}
                }
            }
        }

        async function toggleVoiceRecording() {
            const recordBtn = document.getElementById('record-btn');
            const recordText = document.getElementById('record-text');

            if (!mediaRecorder || mediaRecorder.state === 'inactive') {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    audioChunks = [];
                    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
                    mediaRecorder.onstop = () => {
                        const blob = new Blob(audioChunks, { type: 'audio/mp3' });
                        const audioUrl = URL.createObjectURL(blob);
                        const audioEl = document.getElementById('diary-audio');
                        audioEl.src = audioUrl;
                        document.getElementById('audio-container').classList.remove('hidden');
                    };
                    mediaRecorder.start();
                    recordText.innerText = "Stop Recording";
                    recordBtn.classList.replace('bg-rose-400', 'bg-red-600');
                } catch (err) {
                    alert("Microphone access denied or unavailable.");
                }
            } else {
                mediaRecorder.stop();
                recordText.innerText = "Record Voice Note";
                recordBtn.classList.replace('bg-red-600', 'bg-rose-400');
            }
        }

        window.addEventListener('load',async function() {
            const now=new Date();
            const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
            document.getElementById('currentDate').value=today;
            attachChecklistCartoons();
            loadData();
            updatePrivateWritingAccess();
            await initializeAppGate();
        });


        const delegatedClickActions={
            showPage:el=>showPage(el.dataset.page),
            openModal:el=>openModal(el.dataset.modal,el.dataset.target),
            changeStep:el=>changeStep(Number(el.dataset.direction)),
            releaseCloud:el=>releaseCloud(el),
            closeGrandFinale:()=>closeGrandFinale(),
            closeModal:()=>closeModal(),
            completeAnimation:()=>completeAnimation(),
            handleDiaryKeyAction:()=>handleDiaryKeyAction(),
            handleNextStep:()=>handleNextStep(),
            lockPrivateWriting:()=>lockPrivateWriting(),
            resetDayData:()=>resetDayData(),
            toggleVoiceRecording:()=>toggleVoiceRecording()
        };
        document.addEventListener('click',event=>{
            const trigger=event.target.closest('[data-action]');
            if(!trigger)return;
            const action=delegatedClickActions[trigger.dataset.action];
            if(action){event.preventDefault();action(trigger);}
        });
        document.addEventListener('keydown',event=>{
            if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-action][role="button"]')){
                event.preventDefault();
                event.target.click();
            }
        });
        document.addEventListener('change',event=>{
            const trigger=event.target.closest('[data-change-action]');
            if(trigger&&trigger.dataset.changeAction==='handleDateChange')handleDateChange();
        },true);
        document.getElementById('app-pin-form')?.addEventListener('submit',event=>{
            event.preventDefault();
            submitAppPin();
        });
        ['app-pin-input','app-pin-confirm'].forEach(id=>{
            document.getElementById(id)?.addEventListener('input',event=>{
                event.target.value=event.target.value.replace(/[^0-9]/g,'').slice(0,12);
            });
        });

        window.addEventListener('resize',resizeEcosystemCanvas,{passive:true});
        document.addEventListener('change',saveData);
        document.addEventListener('input',saveData);
        document.querySelectorAll('#private-diary-entry,.text-input').forEach(field=>{
            field.addEventListener('input',schedulePrivateWritingSave);
            field.addEventListener('change',schedulePrivateWritingSave);
        });
        document.addEventListener('visibilitychange',()=>{
            if(document.visibilityState==='hidden'){
                flushAndSaveCurrentPrivateWriting().catch(error=>setWritingSecurityStatus('Encrypted save failed. '+(error?.message||''),'error'));
            }
        });
    