const $ = (id) => document.getElementById(id);

// URL Query params boot check (for middle-click new tab opening)
const urlParams = new URLSearchParams(window.location.search);
const qSymbol = urlParams.get("symbol");
const qLong = urlParams.get("long_ex");
const qShort = urlParams.get("short_ex");

let state = {
    longEx: qLong || "Ondo",
    shortEx: qShort || "RH_Lighter",
    symbol: qSymbol ? qSymbol.toUpperCase() : "BTC",
    minSpread: parseFloat(localStorage.getItem("minSpread")) || 0.01,
    minFunding: parseFloat(localStorage.getItem("minFunding")) || 0,
    globalSpreadAlert: localStorage.getItem("globalSpreadAlert") === "true",
    globalFundingAlert: localStorage.getItem("globalFundingAlert") === "true",
    globalCombinedAlert: localStorage.getItem("globalCombinedAlert") === "true",
    isRunning: true,
    entryAlert: null,
    exitAlert: null,
    lastAlertTime: 0
};

// Telegram Auth State & Sync
let currentUser = null;

function renderTgAuthUI() {
    const container = $("tgAuthContainer");
    if (!container) return;

    if (currentUser) {
        const usernameDisplay = currentUser.username ? `@${currentUser.username}` : (currentUser.first_name || 'User');
        const initial = (currentUser.first_name || currentUser.username || 'U')[0].toUpperCase();
        
        const avatarHtml = currentUser.photo_url 
            ? `<img src="${currentUser.photo_url}" class="user-avatar">`
            : `<div class="user-avatar-fallback">${initial}</div>`;

        container.innerHTML = `
            <div class="user-profile-badge" onclick="openUserCabinet()" style="cursor:pointer;" title="Відкрити Особистий Кабінет (${usernameDisplay})">
                ${avatarHtml}
                <span class="user-name">${usernameDisplay}</span>
                <button class="btn-logout" id="btnTgLogout" onclick="event.stopPropagation(); logoutTelegramUser();" title="Вийти з акаунту">🚪</button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <button class="btn-tg-login" id="btnTgLogin" onclick="openTgAuthModal()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.25.38-.51 1.07-.78 4.18-1.82 6.97-3.02 8.37-3.61 3.99-1.66 4.82-1.95 5.36-1.96.12 0 .38.03.55.17.14.12.18.28.2.45-.02.07-.02.16-.04.29z"/></svg>
                <span>Telegram</span>
            </button>
        `;
    }
}

window.openUserCabinet = function() {
    playTactileClick();
    if (!currentUser) {
        openTgAuthModal();
        return;
    }
    const modal = $("userCabinetModal");
    if (modal) {
        modal.style.display = "flex";
        renderCabinetData();
    }
};

window.closeUserCabinet = function() {
    playTactileClick();
    const modal = $("userCabinetModal");
    if (modal) modal.style.display = "none";
};

window.switchCabTab = function(tabName) {
    playTactileClick();
    ["settings", "pins", "account"].forEach(t => {
        const tabEl = $(`cabTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const btnEl = $(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (tabEl) tabEl.style.display = (t === tabName) ? "block" : "none";
        if (btnEl) {
            if (t === tabName) btnEl.classList.add("active");
            else btnEl.classList.remove("active");
        }
    });
};

function renderCabinetData() {
    if (!currentUser) return;
    const initial = (currentUser.first_name || currentUser.username || 'U')[0].toUpperCase();
    const avatarHtml = currentUser.photo_url 
        ? `<img src="${currentUser.photo_url}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:1px solid #2AABEE;">`
        : `<div style="width:36px; height:36px; border-radius:50%; background:#2AABEE; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:14px;">${initial}</div>`;
    
    if ($("cabAvatarContainer")) $("cabAvatarContainer").innerHTML = avatarHtml;
    if ($("cabUserName")) $("cabUserName").textContent = currentUser.first_name || currentUser.username || 'Користувач';
    if ($("cabUserId")) $("cabUserId").textContent = `ID: ${currentUser.user_id}`;
    if ($("cabTgUsername")) $("cabTgUsername").textContent = currentUser.username ? `@${currentUser.username}` : (currentUser.first_name || '--');
    
    if ($("cabMinSpread")) $("cabMinSpread").value = state.minSpread;
    if ($("cabEntryAlert")) $("cabEntryAlert").value = state.entryAlert !== null ? state.entryAlert : '';
    if ($("cabExitAlert")) $("cabExitAlert").value = state.exitAlert !== null ? state.exitAlert : '';

    if ($("cabPinCount")) $("cabPinCount").textContent = pinnedItems.length;
    const pinsList = $("cabPinsList");
    if (pinsList) {
        if (pinnedItems.length === 0) {
            pinsList.innerHTML = `<div style="font-size: 12px; color: #64748b; padding: 10px; text-align: center;">Немає закріплених монет</div>`;
        } else {
            pinsList.innerHTML = pinnedItems.map((p, idx) => `
                <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.04); padding:6px 12px; border-radius:6px; font-size:12px;">
                    <div><b style="color:#ffffff;">${p.symbol}</b> <span style="color:#94a3b8; font-size:11px;">(${p.long_ex || 'Ondo'} ➔ ${p.short_ex || 'RH_Lighter'})</span></div>
                    <button onclick="togglePin('${p.symbol}', '${p.long_ex}', '${p.short_ex}'); renderCabinetData();" style="background:none; border:none; color:#f6465d; cursor:pointer; font-size:12px;" title="Видалити">✕</button>
                </div>
            `).join('');
        }
    }
}

window.saveUserCabinetSettings = function() {
    playTactileClick();
    if ($("cabMinSpread")) {
        const val = parseFloat($("cabMinSpread").value);
        if (!isNaN(val)) state.minSpread = val;
    }
    if ($("cabEntryAlert")) {
        const val = parseFloat($("cabEntryAlert").value);
        state.entryAlert = isNaN(val) ? null : val;
    }
    if ($("cabExitAlert")) {
        const val = parseFloat($("cabExitAlert").value);
        state.exitAlert = isNaN(val) ? null : val;
    }
    saveUserSettings();
    scan();
    closeUserCabinet();
};

window.openTgAuthModal = function() {
    playTactileClick();
    if ($("tgAuthModal")) {
        $("tgAuthModal").style.display = "flex";
        if ($("tgInputUsername")) $("tgInputUsername").focus();
    }
};

window.onTelegramAuth = function(user) {
    if (!user) return;
    const userObj = {
        user_id: user.id,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        username: user.username || user.first_name,
        photo_url: user.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.first_name || 'User')}&background=2AABEE&color=fff`,
        auth_date: user.auth_date || Math.floor(Date.now() / 1000)
    };
    loginTelegramUser(userObj);
    if ($("tgAuthModal")) $("tgAuthModal").style.display = "none";
};

window.logoutTelegramUser = logoutTelegramUser;

window.resetTelegramAuthSession = function() {
    playTactileClick();
    const win = window.open("https://oauth.telegram.org/logout", "_blank", "width=550,height=420");
    setTimeout(() => {
        if (win && !win.closed) win.close();
        location.reload();
    }, 1200);
};

async function loginTelegramUser(userObj) {
    currentUser = userObj;
    localStorage.setItem("tg_user", JSON.stringify(currentUser));
    renderTgAuthUI();

    try {
        const r = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(userObj)
        });
        const data = await r.json();
        if (data.ok && data.settings && Object.keys(data.settings).length > 0) {
            applyUserSettings(data.settings);
        } else {
            saveUserSettings();
        }
    } catch (e) {
        console.error("Auth server sync error:", e);
    }
}

function logoutTelegramUser() {
    currentUser = null;
    localStorage.removeItem("tg_user");
    renderTgAuthUI();
}

async function saveUserSettings() {
    if (!currentUser) return;
    const settings = {
        pinnedItems: Array.from(pinnedItems),
        enabledExchanges: Array.from(enabledExchanges),
        minSpread: state.minSpread,
        entryAlert: state.entryAlert,
        exitAlert: state.exitAlert,
        longEx: state.longEx,
        shortEx: state.shortEx,
        symbol: state.symbol
    };

    try {
        await fetch('/api/user/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: currentUser.user_id,
                settings: settings
            })
        });
    } catch (e) {
        console.error("Save settings error:", e);
    }
}

function applyUserSettings(s) {
    if (s.pinnedItems) {
        pinnedItems = Array.isArray(s.pinnedItems) ? s.pinnedItems : [];
        localStorage.setItem("pinnedItems", JSON.stringify(pinnedItems));
    }
    if (s.enabledExchanges) {
        enabledExchanges = Array.isArray(s.enabledExchanges) ? s.enabledExchanges : [];
        localStorage.setItem("enabledExchanges", JSON.stringify(enabledExchanges));
    }
    if (s.minSpread !== undefined) {
        state.minSpread = s.minSpread;
        if ($("minSpreadInput")) $("minSpreadInput").value = s.minSpread;
    }
    if (s.entryAlert !== undefined) state.entryAlert = s.entryAlert;
    if (s.exitAlert !== undefined) state.exitAlert = s.exitAlert;
    if (s.longEx) setCustomSelectValue("longEx", s.longEx);
    if (s.shortEx) setCustomSelectValue("shortEx", s.shortEx);
    
    scan();
}

function initTgAuth() {
    const saved = localStorage.getItem("tg_user");
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
        } catch (e) {}
    }
    renderTgAuthUI();

    if ($("tgSubmitAuth")) {
        $("tgSubmitAuth").onclick = () => {
            const inputVal = ($("tgInputUsername").value || "").trim();
            if (!inputVal) return;
            
            const cleanUsername = inputVal.replace(/^@/, '');
            let hash = 0;
            for (let i = 0; i < cleanUsername.length; i++) {
                hash = ((hash << 5) - hash) + cleanUsername.charCodeAt(i);
                hash |= 0;
            }
            const userId = Math.abs(hash) || 100000;

            const userObj = {
                user_id: userId,
                first_name: cleanUsername,
                username: cleanUsername,
                photo_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanUsername)}&background=2AABEE&color=fff`,
                auth_date: Math.floor(Date.now() / 1000)
            };

            loginTelegramUser(userObj);
            if ($("tgAuthModal")) $("tgAuthModal").style.display = "none";
        };
    }

    if ($("tgCloseAuth")) {
        $("tgCloseAuth").onclick = () => {
            if ($("tgAuthModal")) $("tgAuthModal").style.display = "none";
        };
    }
}

let chart, inSeries, outSeries;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTactileClick() {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t = audioCtx.currentTime;

        // Ultra-creamy, silky iPhone key tap synth
        const bufferSize = Math.floor(audioCtx.sampleRate * 0.012);
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(750, t);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.035, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        noise.start(t);

        // Deep warm cream thud pop
        const osc = audioCtx.createOscillator();
        const oscGain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.010);
        oscGain.gain.setValueAtTime(0.03, t);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.010);

        osc.connect(oscGain);
        oscGain.connect(audioCtx.destination);

        osc.start(t);
        osc.stop(t + 0.012);
    } catch (e) {}
}

function playSwooshSound(reverse = false) {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        const startFreq = reverse ? 200 : 400;
        const endFreq = reverse ? 400 : 200;
        osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {}
}

function playAlertSound() {
    // Не грати звук частіше ніж раз на 5 секунд
    if (Date.now() - state.lastAlertTime < 5000) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
    state.lastAlertTime = Date.now();
}

function initChart() {
    if (!$("chart")) return;
    chart = LightweightCharts.createChart($("chart"), {
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#848e9c' },
        grid: { vertLines: { color: '#2b2f36' }, horzLines: { color: '#2b2f36' } },
        timeScale: { timeVisible: true, secondsVisible: true },
    });
    inSeries = chart.addLineSeries({ color: '#2ebd85', lineWidth: 2 });
    outSeries = chart.addLineSeries({ color: '#f6465d', lineWidth: 2 });
}

let allSymbols = [];
let selectedIndex = -1;

async function loadSymbols() {
    try {
        const r = await fetch('/api/symbols');
        const d = await r.json();
        allSymbols = d.symbols || [];
        // Optional: set default symbol if not set
        if (!state.symbol && allSymbols.length > 0) {
            state.symbol = allSymbols[0];
        }
    } catch (e) {
        console.error("Failed to load symbols", e);
        allSymbols = ["BTC", "ETH", "SOL"]; // Fallback
    }
}

const CRYPTO_ALIASES = {
    'БТК': 'BTC',
    'ЕТХ': 'ETH',
    'ЕФІР': 'ETH',
    'СОЛ': 'SOL',
    'КУУ': 'QQQ',
    'СПЙ': 'SPY',
    'МОРФО': 'MORPHO',
    'РЕНДЕР': 'RENDER',
    'ААВЕ': 'AAVE',
    'ЗРО': 'ZRO',
    'ВВВ': 'VVV',
    'ГРАСС': 'GRASS',
    'АВАКС': 'AVAX'
};

const PHONETIC_MAP = {
    'а':'a', 'б':'b', 'в':'v', 'г':'g', 'ґ':'g', 'д':'d', 'е':'e', 'є':'e', 'ж':'zh', 'з':'z', 'и':'i', 'і':'i', 'ї':'i',
    'й':'y', 'к':'k', 'л':'l', 'м':'m', 'н':'n', 'о':'o', 'п':'p', 'р':'r', 'с':'s', 'т':'t', 'у':'u', 'ф':'f', 'х':'h',
    'ц':'c', 'ч':'ch', 'ш':'sh', 'щ':'sh', 'ь':'', 'ю':'u', 'я':'a', 'ы':'y', 'э':'e', 'ъ':'', 'ё':'yo'
};

const QWERTY_MAP = {
    'й':'q', 'ц':'w', 'у':'e', 'к':'r', 'е':'t', 'н':'y', 'г':'u', 'ш':'i', 'щ':'o', 'з':'p', 'х':'[', 'ї':']',
    'ф':'a', 'і':'s', 'в':'d', 'а':'f', 'п':'g', 'р':'h', 'о':'j', 'л':'k', 'д':'l', 'ж':';', 'є':"'",
    'я':'z', 'ч':'x', 'с':'c', 'м':'v', 'и':'b', 'т':'n', 'ь':'m', 'б':'b', 'ю':'u', 'ы':'s', 'э':"'", 'ъ':']'
};

function convertCyrillicToLatin(str) {
    if (!str) return '';
    const upperStr = str.trim().toUpperCase();
    if (CRYPTO_ALIASES[upperStr]) {
        return CRYPTO_ALIASES[upperStr];
    }
    
    // Convert phonetically first
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const lower = char.toLowerCase();
        if (PHONETIC_MAP[lower] !== undefined) {
            const converted = PHONETIC_MAP[lower];
            result += (char === char.toUpperCase() && char !== char.toLowerCase()) ? converted.toUpperCase() : converted;
        } else {
            result += char;
        }
    }
    return result;
}

function convertQWERTYLayout(str) {
    if (!str) return '';
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const lower = char.toLowerCase();
        if (QWERTY_MAP[lower] !== undefined) {
            const converted = QWERTY_MAP[lower];
            result += (char === char.toUpperCase() && char !== char.toLowerCase()) ? converted.toUpperCase() : converted;
        } else {
            result += char;
        }
    }
    return result;
}

function filterSymbols(query) {
    if (!query) return allSymbols;
    const qRaw = query.trim();
    const qUpper = qRaw.toUpperCase();
    const qPhonetic = convertCyrillicToLatin(qRaw).toUpperCase();
    const qQwerty = convertQWERTYLayout(qRaw).toUpperCase();

    return allSymbols.filter(s => {
        const sUpper = s.toUpperCase();
        return sUpper.startsWith(qUpper) || sUpper.startsWith(qPhonetic) || sUpper.startsWith(qQwerty) ||
               sUpper.includes(qUpper) || sUpper.includes(qPhonetic) || sUpper.includes(qQwerty);
    });
}

function showDropdown(symbols) {
    const dropdown = $("symbolDropdown");
    if (!dropdown) return;

    dropdown.innerHTML = "";
    selectedIndex = -1;

    if (!symbols || symbols.length === 0) {
        dropdown.classList.remove("show");
        return;
    }

    symbols.forEach((sym, idx) => {
        const opt = document.createElement("div");
        opt.className = "symbol-option";
        opt.innerHTML = `<span class="symbol-name">${sym}</span>`;
        opt.onmouseenter = () => playTactileClick();
        opt.onclick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            playTactileClick();
            window.selectSymbol(sym);
        };
        opt.dataset.index = idx;
        dropdown.appendChild(opt);
    });

    dropdown.classList.add("show");
}

function updateSelection(direction) {
    const dropdown = $("symbolDropdown");
    if (!dropdown) return;

    const options = dropdown.querySelectorAll(".symbol-option");
    if (options.length === 0) return;

    options.forEach(o => o.classList.remove("selected"));

    if (direction === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
    } else if (direction === "up") {
        selectedIndex = selectedIndex <= 0 ? options.length - 1 : selectedIndex - 1;
    }

    if (options[selectedIndex]) {
        playTactileClick();
        options[selectedIndex].classList.add("selected");
        options[selectedIndex].scrollIntoView({ block: "nearest" });
    }
}

const searchInput = $("symbolSearch");
if (searchInput) {
    searchInput.onmouseenter = () => playTactileClick();
    searchInput.onclick = () => playTactileClick();
    searchInput.oninput = (e) => {
        playTactileClick();
        let query = e.target.value;
        const converted = convertCyrillicToLatin(query).toUpperCase();
        // If user typed Cyrillic characters, auto-convert input field value to Latin!
        if (/[а-щьюяїієґыэъё]/i.test(query)) {
            e.target.value = converted;
            query = converted;
        }
        const filtered = filterSymbols(query);
        showDropdown(filtered);
    };

    searchInput.onfocus = (e) => {
        playTactileClick();
        const query = e.target.value;
        const filtered = filterSymbols(query);
        showDropdown(filtered);
    };

    searchInput.onkeydown = (e) => {
        const dropdown = $("symbolDropdown");
        if (!dropdown || !dropdown.classList.contains("show")) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            updateSelection("down");
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            updateSelection("up");
        } else if (e.key === "Enter") {
            e.preventDefault();
            const options = dropdown.querySelectorAll(".symbol-option");
            if (selectedIndex >= 0 && selectedIndex < options.length) {
                const sym = options[selectedIndex].querySelector(".symbol-name").textContent;
                window.selectSymbol(sym);
            } else if (options.length > 0) {
                const sym = options[0].querySelector(".symbol-name").textContent;
                window.selectSymbol(sym);
            } else {
                const typed = e.target.value.toUpperCase();
                if (typed) window.selectSymbol(typed);
            }
        } else if (e.key === "Escape") {
            dropdown.classList.remove("show");
        }
    };
}

document.addEventListener("click", (e) => {
    if (!e.target.closest(".symbol-search-wrapper")) {
        const dropdown = $("symbolDropdown");
        if (dropdown) dropdown.classList.remove("show");
    }
});

let lastExStatus = {};

function updateExchangeStatusUI(statusMap) {
    if (!statusMap) return;
    lastExStatus = statusMap;

    const statusTitles = {
        "ok": "Біржа працює стабільно",
        "degraded": "Невелика затримка підключення",
        "offline": "Помилка підключення / Відключено"
    };

    const statusClasses = {
        "ok": "dot-green",
        "degraded": "dot-yellow",
        "offline": "dot-red"
    };

    Object.keys(statusMap).forEach(ex => {
        const st = statusMap[ex] || "offline";
        const cls = statusClasses[st] || "dot-red";
        const title = statusTitles[st] || "Помилка / Відключено";

        document.querySelectorAll(`.custom-dropdown-option[data-value="${ex}"] .ex-status-dot`).forEach(dot => {
            dot.className = `ex-status-dot ${cls}`;
            dot.title = title;
        });

        if (state.longEx === ex) {
            const longDot = $("longExStatusDot");
            if (longDot) {
                longDot.className = `ex-status-dot ${cls}`;
                longDot.title = title;
            }
        }
        if (state.shortEx === ex) {
            const shortDot = $("shortExStatusDot");
            if (shortDot) {
                shortDot.className = `ex-status-dot ${cls}`;
                shortDot.title = title;
            }
        }
    });
}

async function fetchExchangesStatus() {
    try {
        const r = await fetch('/api/exchanges_status');
        const d = await r.json();
        if (d.ok && d.status) {
            updateExchangeStatusUI(d.status);
        }
    } catch (e) {
        console.error("Fetch exchanges status error:", e);
    }
}

async function poll() {
    if (!state.isRunning) return;
    try {
        const r = await fetch(`/api/poll?symbol=${state.symbol}&long_ex=${state.longEx}&short_ex=${state.shortEx}`);
        const data = await r.json();
        if (data.ok) {
            if (data.exchanges_status) {
                updateExchangeStatusUI(data.exchanges_status);
            }
            if ($("inVal")) $("inVal").textContent = (data.entry_pct >= 0 ? '+' : '') + data.entry_pct.toFixed(4) + "%";
            if ($("outVal")) $("outVal").textContent = (data.exit_pct >= 0 ? '+' : '') + data.exit_pct.toFixed(4) + "%";
            if ($("lat")) $("lat").textContent = data.latency_ms;
            if ($("dot")) $("dot").className = "dot ok";

            if ($("longExName")) $("longExName").textContent = state.longEx;
            if ($("shortExName")) $("shortExName").textContent = state.shortEx;

            const lfr = (data.long_funding !== undefined && data.long_funding !== null) ? data.long_funding : 0.0;
            const sfr = (data.short_funding !== undefined && data.short_funding !== null) ? data.short_funding : 0.0;
            const nfr = (data.net_funding !== undefined) ? data.net_funding : (sfr - lfr);

            if ($("longFundingVal")) {
                $("longFundingVal").textContent = (lfr >= 0 ? "+" : "") + lfr.toFixed(4) + "%";
                $("longFundingVal").style.color = lfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("shortFundingVal")) {
                $("shortFundingVal").textContent = (sfr >= 0 ? "+" : "") + sfr.toFixed(4) + "%";
                $("shortFundingVal").style.color = sfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("netFundingVal")) {
                $("netFundingVal").textContent = (nfr >= 0 ? "+" : "") + nfr.toFixed(4) + "% APR";
                $("netFundingVal").style.color = nfr >= 0 ? "var(--green)" : "var(--red)";
            }

            const t = Math.floor(Date.now() / 1000);
            if (t > lastChartTimestamp) {
                if (inSeries) inSeries.update({ time: t, value: data.entry_pct });
                if (outSeries) outSeries.update({ time: t, value: data.exit_pct });
                lastChartTimestamp = t;
            }

            let shouldPlay = false;
            if (state.entryAlert !== null && data.entry_pct >= state.entryAlert) shouldPlay = true;
            if (state.exitAlert !== null && data.exit_pct >= state.exitAlert) shouldPlay = true;

            if (shouldPlay) playAlertSound();

            renderMainTitle();
        } else {
            if ($("dot")) $("dot").className = "dot err";
        }
    } catch (e) {
        if ($("dot")) $("dot").className = "dot err";
    }
}

let pinnedItems = [];
try {
    const raw = localStorage.getItem("pinnedItems");
    if (raw) {
        pinnedItems = JSON.parse(raw);
    } else {
        const oldSyms = JSON.parse(localStorage.getItem("pinnedSymbols") || "[]");
        pinnedItems = oldSyms.map(s => ({ symbol: s, long_ex: "Ondo", short_ex: "RH_Lighter" }));
    }
} catch (e) {
    pinnedItems = [];
}
let enabledExchanges;
try {
    enabledExchanges = JSON.parse(localStorage.getItem("enabledExchanges") || '["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"]');
} catch (e) {
    enabledExchanges = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"];
}
if (!Array.isArray(enabledExchanges) || enabledExchanges.length < 2) {
    enabledExchanges = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"];
    localStorage.setItem("enabledExchanges", JSON.stringify(enabledExchanges));
}
let scannerSortBy = localStorage.getItem("scannerSortBy") || "spread";

function updateSortHeaderUI() {
    const spreadHeader = $("sortSpread");
    const netAprHeader = $("sortNetApr");
    if (spreadHeader && netAprHeader) {
        if (scannerSortBy === "net_apr") {
            spreadHeader.classList.remove("active");
            spreadHeader.innerHTML = "Spread ↕";
            netAprHeader.classList.add("active");
            netAprHeader.innerHTML = "Net APR 🔽";
        } else {
            spreadHeader.classList.add("active");
            spreadHeader.innerHTML = "Spread 🔽";
            netAprHeader.classList.remove("active");
            netAprHeader.innerHTML = "Net APR ↕";
        }
    }
}

let expandedSymbols = new Set();
let activeSignalsMap = {}; // symbol -> { symbol, type: 'ENTRY'|'EXIT', spread }
let symbolAlerts = JSON.parse(localStorage.getItem("symbolAlerts") || "{}");
let alertAudioInterval = null;
let lastScanItems = [];

function updateAlertBellUI() {
    const bellBtn = $("openAlerts");
    if (!bellBtn) return;
    const cfg = symbolAlerts[state.symbol];
    if (cfg && (cfg.entry !== null || cfg.exit !== null)) {
        bellBtn.style.color = "#f59e0b";
        bellBtn.style.textShadow = "0 0 10px rgba(245, 158, 11, 0.8)";
        bellBtn.title = `Активний алерт для ${state.symbol}: IN >= ${cfg.entry !== null ? cfg.entry : '--'}%`;
    } else {
        bellBtn.style.color = "";
        bellBtn.style.textShadow = "";
        bellBtn.title = `Налаштувати звуковий алерт для ${state.symbol}`;
    }
}

function startContinuousAlertAudio() {
    if (alertAudioInterval) return;
    playAlertSound();
    alertAudioInterval = setInterval(() => {
        if (Object.keys(activeSignalsMap).length > 0) {
            playAlertSound();
        } else {
            stopContinuousAlertAudio();
        }
    }, 1800);
}

function stopContinuousAlertAudio() {
    if (alertAudioInterval) {
        clearInterval(alertAudioInterval);
        alertAudioInterval = null;
    }
}

window.muteActiveSignal = function(symToMute = null) {
    playTactileClick();
    if (symToMute && typeof symToMute === 'string') {
        delete symbolAlerts[symToMute];
        delete activeSignalsMap[symToMute];
    } else {
        Object.keys(activeSignalsMap).forEach(sym => {
            delete symbolAlerts[sym];
        });
        activeSignalsMap = {};
    }
    localStorage.setItem("symbolAlerts", JSON.stringify(symbolAlerts));

    // Disable Global Alert Toggles upon muting signals
    state.globalSpreadAlert = false;
    state.globalFundingAlert = false;
    state.globalCombinedAlert = false;
    localStorage.setItem("globalSpreadAlert", "false");
    localStorage.setItem("globalFundingAlert", "false");
    localStorage.setItem("globalCombinedAlert", "false");

    if ($("globalSpreadAlertToggle")) $("globalSpreadAlertToggle").checked = false;
    if ($("globalFundingAlertToggle")) $("globalFundingAlertToggle").checked = false;
    if ($("globalCombinedAlertToggle")) $("globalCombinedAlertToggle").checked = false;
    
    if (Object.keys(activeSignalsMap).length === 0) {
        stopContinuousAlertAudio();
    }
    renderMuteSignalUI();
    updateAlertBellUI();
    renderScanItems(lastScanItems);
};

function renderMuteSignalUI() {
    const container = $("muteSignalBtnContainer");
    if (!container) return;
    const activeKeys = Object.keys(activeSignalsMap);
    if (activeKeys.length === 1) {
        const sym = activeKeys[0];
        container.innerHTML = `
            <button class="btn-mute-signal" onclick="muteActiveSignal('${sym}')" title="Зупинити сигнал для ${sym} (або натисніть Пробіл)">
                🔕 ЗУПИНИТИ СИГНАЛ (${sym})
            </button>
        `;
    } else if (activeKeys.length > 1) {
        container.innerHTML = `
            <button class="btn-mute-signal" onclick="muteActiveSignal()" title="Зупинити всі ${activeKeys.length} активні сигнали (${activeKeys.join(', ')}) (або натисніть Пробіл)">
                🔕 ЗУПИНИТИ ВСІ СИГНАЛИ (${activeKeys.length})
            </button>
        `;
    } else {
        container.innerHTML = '';
    }
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && activeSignal && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        muteActiveSignal();
    }
});

let hiddenSymbols = [];
try {
    hiddenSymbols = JSON.parse(localStorage.getItem("hiddenSymbols") || "[]");
    if (!Array.isArray(hiddenSymbols)) hiddenSymbols = [];
} catch (e) {
    hiddenSymbols = [];
}

window.toggleHideSymbol = (sym, event) => {
    if (event) event.stopPropagation();
    playTactileClick();
    if (!sym) return;

    if (hiddenSymbols.includes(sym)) {
        hiddenSymbols = hiddenSymbols.filter(s => s !== sym);
    } else {
        hiddenSymbols.push(sym);
    }
    localStorage.setItem("hiddenSymbols", JSON.stringify(hiddenSymbols));
    renderScanItems(lastScanItems);
    renderHiddenCoinsSettingsUI();
};

window.unhideAllCoins = () => {
    playTactileClick();
    hiddenSymbols = [];
    localStorage.setItem("hiddenSymbols", "[]");
    renderScanItems(lastScanItems);
    renderHiddenCoinsSettingsUI();
};

function renderHiddenCoinsSettingsUI() {
    const listEl = $("hiddenCoinsList");
    const countEl = $("hiddenCoinsCount");
    const unhideBtn = $("unhideAllCoinsBtn");
    if (!listEl) return;

    if (countEl) countEl.textContent = hiddenSymbols.length;
    if (unhideBtn) unhideBtn.style.display = hiddenSymbols.length > 0 ? "inline-block" : "none";

    if (hiddenSymbols.length === 0) {
        listEl.innerHTML = `<span class="no-hidden-txt">Немає прихованих монет</span>`;
        return;
    }

    listEl.innerHTML = hiddenSymbols.map(sym => `
        <span class="hidden-coin-chip">
            <b>${sym}</b>
            <button class="btn-chip-remove" onclick="toggleHideSymbol('${sym}', event)" title="Повернути ${sym} у відстежування">✕</button>
        </span>
    `).join("");
}

window.toggleVariations = (sym, event) => {
    if (event) event.stopPropagation();
    playTactileClick();
    if (expandedSymbols.has(sym)) {
        expandedSymbols.delete(sym);
    } else {
        expandedSymbols.add(sym);
    }
    renderScanItems(lastScanItems);
};

function renderScanItems(rawItems) {
    const body = $("topSpreads") || $("scanBody");
    if (!body) return;

    let itemsMap = {};
    (rawItems || []).forEach(it => {
        itemsMap[it.symbol] = it;
    });

    const pinnedSymbols = pinnedItems.map(p => p.symbol);

    let allSymbols = new Set([
        ...pinnedSymbols,
        ...(rawItems || []).map(it => it.symbol)
    ]);

    let items = Array.from(allSymbols).map(sym => {
        if (itemsMap[sym]) {
            return itemsMap[sym];
        } else {
            const pInfo = pinnedItems.find(p => p.symbol === sym) || {};
            return {
                symbol: sym,
                long_ex: pInfo.long_ex || state.longEx || "Ondo",
                net_funding: 0.0,
                is_missing: true
            };
        }
    });

    items = items.filter(it => {
        if (hiddenSymbols.includes(it.symbol)) return false;
        const isPinned = pinnedSymbols.includes(it.symbol);
        const isSignaling = !!activeSignalsMap[it.symbol];
        if (isPinned || isSignaling) return true;

        const sprPass = (it.entry_pct !== undefined) ? (it.entry_pct >= state.minSpread) : true;
        const netFrVal = (it.net_funding !== undefined) ? it.net_funding : ((it.short_funding || 0) - (it.long_funding || 0));
        const fundPass = (state.minFunding === 0) || (netFrVal >= state.minFunding);

        return sprPass && fundPass;
    });

    items.sort((a, b) => {
        const aSignaling = !!activeSignalsMap[a.symbol];
        const bSignaling = !!activeSignalsMap[b.symbol];
        if (aSignaling && !bSignaling) return -1;
        if (!aSignaling && bSignaling) return 1;

        const aPinned = pinnedSymbols.includes(a.symbol);
        const bPinned = pinnedSymbols.includes(b.symbol);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;

        if (scannerSortBy === "net_apr") {
            const aNfr = (a.net_funding !== undefined) ? a.net_funding : ((a.short_funding || 0) - (a.long_funding || 0));
            const bNfr = (b.net_funding !== undefined) ? b.net_funding : ((b.short_funding || 0) - (b.long_funding || 0));
            return bNfr - aNfr;
        } else {
            return b.entry_pct - a.entry_pct;
        }
    });

    updateSortHeaderUI();

    body.innerHTML = "";
    items.forEach((it, idx) => {
        const tr = document.createElement("tr");
        const isPinned = pinnedItems.some(p => p.symbol === it.symbol);
        const isExpanded = expandedSymbols.has(it.symbol);
        const isActiveSignalRow = !!activeSignalsMap[it.symbol];
        const isLastPinned = isPinned && (idx === items.length - 1 || !pinnedItems.some(p => p.symbol === items[idx + 1].symbol));
        
        if (isActiveSignalRow) {
            tr.classList.add("active-signal-pulse");
        } else if (isPinned) {
            tr.classList.add("pinned-row");
        }

        const lfr = it.long_funding || 0.0;
        const sfr = it.short_funding || 0.0;
        const nfr = (it.net_funding !== undefined) ? it.net_funding : (sfr - lfr);
        const sepClass = isLastPinned ? 'pin-separator-td' : '';
        const l_ex = it.long_ex || state.longEx;
        const s_ex = it.short_ex || state.shortEx;
        const exTag = it.is_missing 
            ? `<span class="ex-pair-tag" style="opacity:0.6;" title="Монета відсутня у топі спредів">Немає спреду</span>` 
            : `<span class="ex-pair-tag" title="Краща пара: LONG ${l_ex} / SHORT ${s_ex}">${l_ex} ➔ ${s_ex}</span>`;

        const spreadTxt = it.is_missing ? `<span style="color:#848e9c;">--</span>` : `${it.entry_pct.toFixed(3)}%`;
        const fundingTxt = it.is_missing 
            ? `<span style="color:#848e9c;">-- / --</span>` 
            : `<span class="${lfr >= 0 ? 'green' : 'red'}">${lfr >= 0 ? '+' : ''}${lfr.toFixed(2)}%</span> / <span class="${sfr >= 0 ? 'green' : 'red'}">${sfr >= 0 ? '+' : ''}${sfr.toFixed(2)}%</span>`;
        const netFundingTxt = it.is_missing
            ? `<span style="color:#848e9c;">--</span>`
            : `${nfr >= 0 ? '+' : ''}${nfr.toFixed(2)}%`;

        tr.innerHTML = `
            <td class="${sepClass}">
                <button class="btn-pin ${isPinned ? 'pinned' : ''}" onclick="togglePin('${it.symbol}', '${l_ex}', '${s_ex}', event)" title="${isPinned ? 'Відкріпити монету' : 'Закріпити точну пару монети вгорі'}">📌</button>
                <span class="sym-link" onclick="selectSymbol('${it.symbol}', '${l_ex}', '${s_ex}')" title="Клікніть для аналізу монети ${it.symbol}">${it.symbol}</span>
                <button class="btn-hide-coin" onclick="toggleHideSymbol('${it.symbol}', event)" title="Приховати монету ${it.symbol} з відстежування 👁️">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
                ${exTag}
            </td>
            <td class="${sepClass} ${it.is_missing ? '' : (it.entry_pct > 0 ? 'green' : 'red')}">${spreadTxt}</td>
            <td class="${sepClass}" style="font-size:11px; white-space:nowrap;">${fundingTxt}</td>
            <td class="${sepClass} ${it.is_missing ? '' : (nfr >= 0 ? 'green' : 'red')}" style="font-size:11px; font-weight:bold; white-space:nowrap;">${netFundingTxt}</td>
        `;
        body.appendChild(tr);

        const pinBtn = tr.querySelector('.btn-pin');
        if (pinBtn) pinBtn.onmouseenter = () => playTactileClick();

        const symLink = tr.querySelector('.sym-link');
        if (symLink) {
            symLink.onmouseenter = () => playTactileClick();
            symLink.onauxclick = (e) => {
                if (e.button === 1) {
                    playTactileClick();
                    window.openSymbolInNewTab(it.symbol, l_ex, s_ex, e);
                }
            };
            symLink.onmousedown = (e) => {
                if (e.button === 1) e.preventDefault();
            };
        }

        const expandBtn = tr.querySelector('.btn-expand');
        if (expandBtn) expandBtn.onmouseenter = () => playTactileClick();

        // Render accordion row if expanded
        if (isExpanded) {
            const varTr = document.createElement("tr");
            varTr.className = "variations-row";
            const varsList = it.variations || [];
            
            let varsHtml = "";
            if (varsList.length === 0) {
                varsHtml = `<div style="font-size:11px; color:#848e9c; padding:4px;">Немає додаткових варіацій для цієї монети</div>`;
            } else {
                varsHtml = varsList.map(v => {
                    const vNfr = v.net_funding;
                    const isCurrentPair = (v.long_ex === l_ex && v.short_ex === s_ex);
                    return `
                        <div class="var-item" data-sym="${it.symbol}" data-long="${v.long_ex}" data-short="${v.short_ex}" style="${isCurrentPair ? 'background: rgba(55, 115, 245, 0.1); border-left: 2px solid #3773f5;' : ''}">
                            <div class="var-pair">
                                <span style="font-size:10px; color:#94a3b8;">${v.long_ex} ➔ ${v.short_ex}</span>
                                ${isCurrentPair ? '<span style="font-size:9px; background:#3773f5; color:#fff; padding:1px 4px; border-radius:3px;">Активна</span>' : ''}
                            </div>
                            <div class="var-metrics">
                                <span class="${v.entry_pct > 0 ? 'green' : 'red'}" style="font-weight:600;">${v.entry_pct.toFixed(3)}%</span>
                                <span style="font-size:10px; color:#94a3b8;">${v.long_funding.toFixed(2)}% / ${v.short_funding.toFixed(2)}%</span>
                                <span class="${vNfr >= 0 ? 'green' : 'red'}" style="font-weight:bold;">${vNfr >= 0 ? '+' : ''}${vNfr.toFixed(2)}%</span>
                                <button class="var-action-btn" onclick="selectSymbol('${it.symbol}', '${v.long_ex}', '${v.short_ex}')" title="Переглянути на графіку">📊</button>
                            </div>
                        </div>
                    `;
                }).join("");
            }

            varTr.innerHTML = `
                <td colspan="4">
                    <div class="variations-box">
                        <div class="variations-title">
                            <span>🔀 Варіації спредів по ${it.symbol} на інших біржах (клікніть колесиком для нової вкладки):</span>
                        </div>
                        ${varsHtml}
                    </div>
                </td>
            `;
            
            varTr.querySelectorAll('.var-item').forEach(vItem => {
                const vSym = vItem.dataset.sym;
                const vLong = vItem.dataset.long;
                const vShort = vItem.dataset.short;
                if (vSym && vLong && vShort) {
                    vItem.onauxclick = (e) => {
                        if (e.button === 1) {
                            playTactileClick();
                            window.openSymbolInNewTab(vSym, vLong, vShort, e);
                        }
                    };
                    vItem.onmousedown = (e) => {
                        if (e.button === 1) e.preventDefault();
                    };
                }
            });

            body.appendChild(varTr);
        }
    });
}

window.openSymbolInNewTab = (sym, longEx, shortEx, event) => {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const targetLong = longEx || state.longEx;
    const targetShort = shortEx || state.shortEx;
    const newUrl = `${window.location.origin}${window.location.pathname}?symbol=${encodeURIComponent(sym)}&long_ex=${encodeURIComponent(targetLong)}&short_ex=${encodeURIComponent(targetShort)}`;
    window.open(newUrl, '_blank');
};

window.selectSymbol = (sym, longEx, shortEx) => {
    state.symbol = sym;
    const searchInput = $("symbolSearch");
    if (searchInput) searchInput.value = sym;
    const dropdown = $("symbolDropdown");
    if (dropdown) dropdown.classList.remove("show");

    if (longEx && $("longEx")) {
        setCustomSelectValue("longEx", longEx);
        state.longEx = longEx;
    }
    if (shortEx && $("shortEx")) {
        setCustomSelectValue("shortEx", shortEx);
        state.shortEx = shortEx;
    }
    updateTradeButtons();
    updateAlertBellUI();
    updateDashboard();
};

window.togglePin = (sym, longEx, shortEx, event) => {
    if (event) event.stopPropagation();
    playTactileClick();
    
    const existingIdx = pinnedItems.findIndex(p => p.symbol === sym);
    if (existingIdx !== -1) {
        pinnedItems.splice(existingIdx, 1);
    } else {
        pinnedItems.push({ symbol: sym, long_ex: longEx || state.longEx, short_ex: shortEx || state.shortEx });
    }
    localStorage.setItem("pinnedItems", JSON.stringify(pinnedItems));
    renderScanItems(lastScanItems);
    scan();
};

async function scan() {
    try {
        const exParam = (enabledExchanges && enabledExchanges.length >= 2) ? enabledExchanges.join(",") : "Ondo,RH_Lighter,Variational";
        const pinParam = JSON.stringify(pinnedItems);
        const r = await fetch(`/api/scan_top?long_ex=${encodeURIComponent(state.longEx)}&short_ex=${encodeURIComponent(state.shortEx)}&exchanges=${encodeURIComponent(exParam)}&min_spread=${state.minSpread}&min_funding=${state.minFunding}&pinned_pairs=${encodeURIComponent(pinParam)}`);
        const data = await r.json();
        if (data.ok && data.items) {
            lastScanItems = data.items;

            // Alert signal auto-detection (PER SYMBOL + GLOBAL ALERTS)
            let newPinAdded = false;
            lastScanItems.forEach(it => {
                const spr = it.entry_pct;
                const netFrVal = (it.net_funding !== undefined) ? it.net_funding : ((it.short_funding || 0) - (it.long_funding || 0));
                let triggeredType = null;

                // 1. Per-symbol Alert
                const cfg = symbolAlerts[it.symbol];
                if (cfg) {
                    if (cfg.entry !== null && cfg.entry !== undefined && spr >= cfg.entry) {
                        triggeredType = 'ENTRY';
                    } else if (cfg.exit !== null && cfg.exit !== undefined && it.exit_pct >= cfg.exit) {
                        triggeredType = 'EXIT';
                    }
                }

                // 2. Global Alerts (Spread, Funding, Combined)
                if (!triggeredType) {
                    if (state.globalCombinedAlert) {
                        const sprOk = (state.minSpread > 0) ? (spr >= state.minSpread) : true;
                        const fundOk = (state.minFunding > 0) ? (netFrVal >= state.minFunding) : true;
                        if (sprOk && fundOk && (state.minSpread > 0 || state.minFunding > 0)) {
                            triggeredType = 'COMBINED';
                        }
                    } else {
                        const sprOk = state.globalSpreadAlert && (state.minSpread > 0) && (spr >= state.minSpread);
                        const fundOk = state.globalFundingAlert && (state.minFunding > 0) && (netFrVal >= state.minFunding);
                        if (sprOk || fundOk) {
                            triggeredType = sprOk ? 'SPREAD' : 'FUNDING';
                        }
                    }
                }

                if (triggeredType) {
                    if (!activeSignalsMap[it.symbol]) {
                        activeSignalsMap[it.symbol] = { symbol: it.symbol, type: triggeredType, spread: spr };
                        // Auto-pin signal coin at top if not already pinned
                        if (!pinnedItems.some(p => p.symbol === it.symbol)) {
                            pinnedItems.unshift({
                                symbol: it.symbol,
                                long_ex: it.long_ex || state.longEx,
                                short_ex: it.short_ex || state.shortEx
                            });
                            newPinAdded = true;
                        }
                    }
                }
            });

            if (newPinAdded) {
                localStorage.setItem("pinnedItems", JSON.stringify(pinnedItems));
            }

            if (Object.keys(activeSignalsMap).length > 0) {
                startContinuousAlertAudio();
                renderMuteSignalUI();
            } else {
                stopContinuousAlertAudio();
                renderMuteSignalUI();
            }

            renderScanItems(lastScanItems);
        }
    } catch (e) {
        console.error("Scan error:", e);
    }
}

let lastChartTimestamp = 0;

async function loadChartHistory() {
    if (!inSeries || !outSeries) return;
    try {
        const url = `/api/history?symbol=${encodeURIComponent(state.symbol)}&long_ex=${encodeURIComponent(state.longEx)}&short_ex=${encodeURIComponent(state.shortEx)}&limit=1000`;
        const r = await fetch(url);
        const d = await r.json();
        if (d.ok && d.items && d.items.length > 0) {
            const latest = d.items[0];
            const lfr = latest.long_funding || 0.0;
            const sfr = latest.short_funding || 0.0;
            const nfr = sfr - lfr;

            if ($("longFundingVal")) {
                $("longFundingVal").textContent = (lfr >= 0 ? "+" : "") + lfr.toFixed(4) + "%";
                $("longFundingVal").style.color = lfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("shortFundingVal")) {
                $("shortFundingVal").textContent = (sfr >= 0 ? "+" : "") + sfr.toFixed(4) + "%";
                $("shortFundingVal").style.color = sfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("netFundingVal")) {
                $("netFundingVal").textContent = (nfr >= 0 ? "+" : "") + nfr.toFixed(4) + "% APR";
                $("netFundingVal").style.color = nfr >= 0 ? "var(--green)" : "var(--red)";
            }

            const sorted = d.items.slice().sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
            const inData = [];
            const outData = [];
            let prevTime = 0;

            sorted.forEach(it => {
                const t = Number(it.timestamp);
                if (t > prevTime) {
                    inData.push({ time: t, value: Number(it.entry_pct) });
                    outData.push({ time: t, value: Number(it.exit_pct) });
                    prevTime = t;
                }
            });

            inSeries.setData(inData);
            outSeries.setData(outData);
            lastChartTimestamp = prevTime;

            if (chart) {
                chart.timeScale().fitContent();
            }
        } else {
            inSeries.setData([]);
            outSeries.setData([]);
            lastChartTimestamp = 0;
        }
    } catch (e) {
        console.error("Failed to load chart history", e);
        inSeries.setData([]);
        outSeries.setData([]);
        lastChartTimestamp = 0;
    }
}

function renderMainTitle() {
    if (!$("mainTitle")) return;
    $("mainTitle").innerHTML = `
        <div class="chart-header-left">
            <div class="chart-symbol-badge">
                <span class="symbol-badge-text">${state.symbol}</span>
            </div>
        </div>
    `;
}

// Single Coin Selector Drawer Modal Logic
window.openCoinSelectorModal = function() {
    playTactileClick();
    renderCoinSelectorGrid();
    const modal = $("coinSelectorModal");
    if (modal) {
        modal.style.display = "flex";
        modal.offsetHeight;
        modal.classList.add("open");
        setTimeout(() => {
            if ($("coinSelectorSearch")) {
                $("coinSelectorSearch").value = "";
                $("coinSelectorSearch").focus();
            }
        }, 100);
    }
};

window.closeCoinSelectorModal = function() {
    playTactileClick();
    const modal = $("coinSelectorModal");
    if (modal) {
        modal.classList.remove("open");
        setTimeout(() => {
            if (!modal.classList.contains("open")) {
                modal.style.display = "none";
            }
        }, 350);
    }
};

function renderCoinSelectorGrid() {
    const container = $("coinGridList");
    if (!container) return;

    const coins = (typeof availableSymbols !== "undefined" && availableSymbols && availableSymbols.length > 0) 
        ? availableSymbols 
        : ["BTC", "ETH", "SOL", "LIT", "CASHCAT", "ARM", "FARTCOIN", "GRVT", "MOVE", "AAVE", "PUMP", "DOGE", "SUI"];

    const searchInput = $("coinSelectorSearch");
    const query = searchInput ? searchInput.value.trim().toUpperCase() : "";

    const filtered = coins.filter(c => c.toUpperCase().includes(query));

    if (filtered.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #848e9c; padding: 20px;">Монет за запитом "${query}" не знайдено</div>`;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const isSelected = c === state.symbol;
        return `
            <div class="coin-grid-card ${isSelected ? 'active-ticker' : ''}" onclick="pickCoinAndClose('${c}')">
                <span class="coin-ticker-name">${c}</span>
                ${isSelected ? '<span class="coin-active-dot"></span>' : ''}
            </div>
        `;
    }).join("");
}

window.pickCoinAndClose = function(sym) {
    playTactileClick();
    selectSymbol(sym);
    closeCoinSelectorModal();
};

function updateDashboard() {
    if ($("longEx")) state.longEx = $("longEx").value;
    if ($("shortEx")) state.shortEx = $("shortEx").value;

    renderMainTitle();
    if ($("longExName")) $("longExName").textContent = state.longEx;
    if ($("shortExName")) $("shortExName").textContent = state.shortEx;

    state.isRunning = true;

    if (audioCtx.state === 'suspended') audioCtx.resume();

    loadChartHistory();
    poll();
    scan();
}

const EXCHANGE_NAMES = {
    "Ondo": "Ondo Perps",
    "RH_Lighter": "Robinhood Lighter",
    "Variational": "Variational Omni",
    "Extended": "Extended DEX",
    "Lighter": "Lighter DEX",
    "RiseX": "RiseX",
    "Bullet": "Bullet DEX"
};

const EXCHANGE_ICONS = {
    "Ondo": "/static/images/ondo.png",
    "RH_Lighter": "/static/images/lighter.png",
    "Variational": "/static/images/variational.jpg",
    "Extended": "/static/images/extended.png",
    "Lighter": "/static/images/lighter_dex.png",
    "RiseX": "/static/images/risex.png",
    "Bullet": "/static/images/bullet.png"
};

function getExchangeTradeUrl(ex, symbol) {
    const s = (symbol || "BTC").toUpperCase();
    if (ex === "Ondo") {
        const ondoSym = (s === "SPY" || s === "SP500_INDEX") ? "US500" : s;
        return `https://app.ondoperps.xyz/trade/perps/${ondoSym}-USD.P`;
    } else if (ex === "RH_Lighter") {
        return `https://robinhoodchain.lighter.xyz/trade/${s}`;
    } else if (ex === "Lighter") {
        return `https://app.lighter.xyz/trade/${s}`;
    } else if (ex === "Variational") {
        const vSym = (s === "SPY") ? "US500" : (s === "QQQ" ? "US100" : s);
        return `https://omni.variational.io/perpetual/${vSym}-USD`;
    } else if (ex === "Extended" || ex === "EXTENDET") {
        return `https://app.extended.exchange/trade/${s}-USD`;
    } else if (ex === "RiseX") {
        return `https://www.rise.trade/en/trade`;
    } else if (ex === "Bullet") {
        const bSym = (s === "SPY") ? "US500" : s;
        return `https://app.bullet.xyz/trade/${bSym}-USD`;
    }
    return "#";
}

function updateTradeButtons() {
    const longEx = $("longEx") ? $("longEx").value : "Ondo";
    const shortEx = $("shortEx") ? $("shortEx").value : "RH_Lighter";
    const currentSym = state.symbol || "BTC";

    const entryContainer = $("entryTradeBtns");
    const exitContainer = $("exitTradeBtns");

    if (entryContainer) {
        const longUrl = getExchangeTradeUrl(longEx, currentSym);
        const longIcon = EXCHANGE_ICONS[longEx] || "/static/images/ondo.png";
        const longName = EXCHANGE_NAMES[longEx] || longEx;

        entryContainer.innerHTML = `
            <a class="ex-trade-card-btn" href="${longUrl}" target="_blank" title="Перейти на торгівлю ${currentSym} на ${longName}">
                <span class="badge-card-side badge-card-long">LONG</span>
                <img src="${longIcon}" class="big-ex-icon">
                <span class="ex-card-title">${longName} ↗</span>
            </a>
        `;
        const entryBtn = entryContainer.querySelector(".ex-trade-card-btn");
        if (entryBtn) {
            entryBtn.onmouseenter = () => playTactileClick();
            entryBtn.onmousedown = () => playTactileClick();
            entryBtn.onclick = () => playTactileClick();
        }
    }

    if (exitContainer) {
        const shortUrl = getExchangeTradeUrl(shortEx, currentSym);
        const shortIcon = EXCHANGE_ICONS[shortEx] || "/static/images/lighter.png";
        const shortName = EXCHANGE_NAMES[shortEx] || shortEx;

        exitContainer.innerHTML = `
            <a class="ex-trade-card-btn" href="${shortUrl}" target="_blank" title="Перейти на торгівлю ${currentSym} на ${shortName}">
                <span class="badge-card-side badge-card-short">SHORT</span>
                <img src="${shortIcon}" class="big-ex-icon">
                <span class="ex-card-title">${shortName} ↗</span>
            </a>
        `;
        const exitBtn = exitContainer.querySelector(".ex-trade-card-btn");
        if (exitBtn) {
            exitBtn.onmouseenter = () => playTactileClick();
            exitBtn.onmousedown = () => playTactileClick();
            exitBtn.onclick = () => playTactileClick();
        }
    }
}

function setCustomSelectValue(selectId, val) {
    const isLong = selectId === "longEx";
    const textId = isLong ? "longExText" : "shortExText";
    const iconId = isLong ? "longExIcon" : "shortExIcon";
    const dropdownId = isLong ? "longExDropdown" : "shortExDropdown";
    const nativeSelect = $(selectId);
    const textSpan = $(textId);
    const iconImg = $(iconId);
    const dropdown = $(dropdownId);

    if (nativeSelect) nativeSelect.value = val;
    if (isLong) state.longEx = val;
    else state.shortEx = val;

    if (textSpan) textSpan.innerText = EXCHANGE_NAMES[val] || val;
    if (iconImg) iconImg.src = EXCHANGE_ICONS[val] || '';

    if (dropdown) {
        dropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
            if (opt.getAttribute('data-value') === val) {
                opt.classList.add('active');
            } else {
                opt.classList.remove('active');
            }
        });
    }
    updateTradeButtons();
}

function initCustomSelects() {
    ['longEx', 'shortEx'].forEach(selectId => {
        const isLong = selectId === "longEx";
        const wrapper = $(isLong ? "longExWrapper" : "shortExWrapper");
        const trigger = $(isLong ? "longExTrigger" : "shortExTrigger");
        const dropdown = $(isLong ? "longExDropdown" : "shortExDropdown");

        if (wrapper && trigger && dropdown) {
            trigger.onmouseenter = () => playTactileClick();

            trigger.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                playTactileClick();

                const wasOpen = wrapper.classList.contains('open');
                document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));

                if (!wasOpen) {
                    wrapper.classList.add('open');
                }
            };

            dropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
                opt.onmouseenter = () => playTactileClick();
                opt.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    playTactileClick();

                    const val = opt.getAttribute('data-value');
                    setCustomSelectValue(selectId, val);
                    wrapper.classList.remove('open');
                    updateDashboard();
                };
            });
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select-wrapper')) {
            document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
        }
    });
}

const swapBtn = $("swapExchanges");
if (swapBtn) {
    swapBtn.onmouseenter = () => playTactileClick();
    swapBtn.onclick = () => {
        playTactileClick();
        const longSel = $("longEx");
        const shortSel = $("shortEx");
        if (longSel && shortSel) {
            const tmpLong = longSel.value;
            const tmpShort = shortSel.value;
            setCustomSelectValue("longEx", tmpShort);
            setCustomSelectValue("shortEx", tmpLong);
            updateDashboard();
        }
    };
}

// Table Sorting Handlers
if ($("sortSpread")) {
    $("sortSpread").onmouseenter = () => playTactileClick();
    $("sortSpread").onclick = () => {
        playTactileClick();
        scannerSortBy = "spread";
        localStorage.setItem("scannerSortBy", "spread");
        renderScanItems(lastScanItems);
    };
}
if ($("sortNetApr")) {
    $("sortNetApr").onmouseenter = () => playTactileClick();
    $("sortNetApr").onclick = () => {
        playTactileClick();
        scannerSortBy = "net_apr";
        localStorage.setItem("scannerSortBy", "net_apr");
        renderScanItems(lastScanItems);
    };
}

// Settings Modal
function updateSettingsModalUI() {
    if ($("exOndo")) $("exOndo").checked = enabledExchanges.includes("Ondo");
    if ($("exRHLighter")) $("exRHLighter").checked = enabledExchanges.includes("RH_Lighter");
    if ($("exVariational")) $("exVariational").checked = enabledExchanges.includes("Variational");
    if ($("exExtended")) $("exExtended").checked = enabledExchanges.includes("Extended");
    if ($("exLighter")) $("exLighter").checked = enabledExchanges.includes("Lighter");
    if ($("exRiseX")) $("exRiseX").checked = enabledExchanges.includes("RiseX");
    if ($("exBullet")) $("exBullet").checked = enabledExchanges.includes("Bullet");
    if ($("minSpreadInput")) $("minSpreadInput").value = state.minSpread;
    if ($("minFundingInput")) $("minFundingInput").value = state.minFunding;

    if ($("globalSpreadAlertToggle")) $("globalSpreadAlertToggle").checked = state.globalSpreadAlert;
    if ($("globalFundingAlertToggle")) $("globalFundingAlertToggle").checked = state.globalFundingAlert;
    if ($("globalCombinedAlertToggle")) $("globalCombinedAlertToggle").checked = state.globalCombinedAlert;

    renderHiddenCoinsSettingsUI();
}

window.openSettingsDrawer = function() {
    playTactileClick();
    updateSettingsModalUI();
    const modal = $("modal");
    if (modal) {
        modal.style.display = "flex";
        // Trigger reflow for smooth slide-in CSS animation
        modal.offsetHeight;
        modal.classList.add("open");
    }
};

window.closeSettingsDrawer = function() {
    playTactileClick();
    const modal = $("modal");
    if (modal) {
        modal.classList.remove("open");
        setTimeout(() => {
            if (!modal.classList.contains("open")) {
                modal.style.display = "none";
            }
        }, 350);
    }
};

if ($("openSettings")) $("openSettings").onclick = openSettingsDrawer;
if ($("closeSettings")) $("closeSettings").onclick = closeSettingsDrawer;
if ($("closeSettingsX")) $("closeSettingsX").onclick = closeSettingsDrawer;

if ($("modal")) {
    $("modal").onclick = (e) => {
        if (e.target === $("modal")) {
            closeSettingsDrawer();
        }
    };
}

if ($("saveSettings")) $("saveSettings").onclick = () => {
    const rawVal = $("minSpreadInput") ? $("minSpreadInput").value.replace(",", ".") : "-100.0";
    const minVal = parseFloat(rawVal);
    state.minSpread = !isNaN(minVal) ? minVal : -100.0;
    localStorage.setItem("minSpread", state.minSpread);

    const rawFunding = $("minFundingInput") ? $("minFundingInput").value.replace(",", ".") : "0";
    const minFund = parseFloat(rawFunding);
    state.minFunding = !isNaN(minFund) ? minFund : 0;
    localStorage.setItem("minFunding", state.minFunding);

    state.globalSpreadAlert = $("globalSpreadAlertToggle") ? $("globalSpreadAlertToggle").checked : false;
    state.globalFundingAlert = $("globalFundingAlertToggle") ? $("globalFundingAlertToggle").checked : false;
    state.globalCombinedAlert = $("globalCombinedAlertToggle") ? $("globalCombinedAlertToggle").checked : false;

    localStorage.setItem("globalSpreadAlert", state.globalSpreadAlert);
    localStorage.setItem("globalFundingAlert", state.globalFundingAlert);
    localStorage.setItem("globalCombinedAlert", state.globalCombinedAlert);
    
    const newEx = [];
    if ($("exOndo") && $("exOndo").checked) newEx.push("Ondo");
    if ($("exRHLighter") && $("exRHLighter").checked) newEx.push("RH_Lighter");
    if ($("exVariational") && $("exVariational").checked) newEx.push("Variational");
    if ($("exExtended") && $("exExtended").checked) newEx.push("Extended");
    if ($("exLighter") && $("exLighter").checked) newEx.push("Lighter");
    if ($("exRiseX") && $("exRiseX").checked) newEx.push("RiseX");
    if ($("exBullet") && $("exBullet").checked) newEx.push("Bullet");
    
    if (newEx.length >= 2) {
        enabledExchanges = newEx;
    } else {
        enabledExchanges = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"];
    }
    localStorage.setItem("enabledExchanges", JSON.stringify(enabledExchanges));
    
    closeSettingsDrawer();
    scan();
};

// History Modal Logic
async function loadHistory() {
    try {
        const symInput = $("historySymbolFilter");
        const sym = symInput ? symInput.value.trim() : "";
        const url = sym ? `/api/history?symbol=${encodeURIComponent(sym)}&limit=50` : `/api/history?limit=50`;
        
        const r = await fetch(url);
        const data = await r.json();
        const body = $("historyTableBody");
        if (!body) return;

        body.innerHTML = "";
        if (!data.ok || !data.items || data.items.length === 0) {
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 10px; color: #888;">Немає збережених записів</td></tr>`;
            return;
        }

        data.items.forEach(it => {
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid #222";
            tr.innerHTML = `
                <td style="padding: 6px; color: #888;">${it.time_str}</td>
                <td style="padding: 6px;"><b>${it.symbol}</b></td>
                <td style="padding: 6px;">${it.long_ask.toFixed(2)}</td>
                <td style="padding: 6px;">${it.short_bid.toFixed(2)}</td>
                <td style="padding: 6px;" class="${it.entry_pct >= 0 ? 'green' : 'red'}">${it.entry_pct.toFixed(3)}%</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        console.error("Failed to load history", e);
    }
}

if ($("openHistory")) $("openHistory").onclick = () => {
    $("historyModal").style.display = "flex";
    loadHistory();
};
if ($("closeHistory")) $("closeHistory").onclick = () => $("historyModal").style.display = "none";
if ($("refreshHistory")) $("refreshHistory").onclick = () => loadHistory();
if ($("historySymbolFilter")) $("historySymbolFilter").oninput = () => loadHistory();

// Alerts Modal (PER SYMBOL)
if ($("openAlerts")) $("openAlerts").onclick = () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const modalTitle = $("alertModalTitle");
    if (modalTitle) modalTitle.innerHTML = `Звукове сповіщення для <b>${state.symbol}</b> 🔔`;
    const cfg = symbolAlerts[state.symbol] || {};
    if ($("entryAlertLevel")) $("entryAlertLevel").value = (cfg.entry !== undefined && cfg.entry !== null) ? cfg.entry : "";
    if ($("exitAlertLevel")) $("exitAlertLevel").value = (cfg.exit !== undefined && cfg.exit !== null) ? cfg.exit : "";
    $("alertModal").style.display = "flex";
};
if ($("closeAlerts")) $("closeAlerts").onclick = () => $("alertModal").style.display = "none";
if ($("saveAlerts")) $("saveAlerts").onclick = () => {
    const entryRaw = $("entryAlertLevel") ? $("entryAlertLevel").value.replace(",", ".") : "";
    const exitRaw = $("exitAlertLevel") ? $("exitAlertLevel").value.replace(",", ".") : "";
    const entryVal = entryRaw !== "" ? parseFloat(entryRaw) : null;
    const exitVal = exitRaw !== "" ? parseFloat(exitRaw) : null;

    const entry = (entryVal !== null && !isNaN(entryVal)) ? entryVal : null;
    const exit = (exitVal !== null && !isNaN(exitVal)) ? exitVal : null;

    if (entry !== null || exit !== null) {
        symbolAlerts[state.symbol] = { entry: entry, exit: exit };
    } else {
        delete symbolAlerts[state.symbol];
    }
    localStorage.setItem("symbolAlerts", JSON.stringify(symbolAlerts));
    updateAlertBellUI();
    $("alertModal").style.display = "none";
    scan();
};

// Start application
async function start() {
    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
    initChart();
    initCustomSelects();
    initTgAuth();
    updateTradeButtons();
    updateDashboard();
    fetchExchangesStatus();
    scan();
    await loadSymbols();
    await loadChartHistory();

    setInterval(poll, 500);
    setInterval(scan, 10000);
    setInterval(fetchExchangesStatus, 3000);
}

// Header buttons hover & click sounds
const openSettingsBtn = $("openSettings");
if (openSettingsBtn) {
    openSettingsBtn.onmouseenter = () => playTactileClick();
    openSettingsBtn.onclick = () => {
        openSettingsDrawer();
    };
}

// Sidebar toggle
const sidebarToggleBtn = $("sidebarToggle");
if (sidebarToggleBtn) {
    sidebarToggleBtn.onmouseenter = () => playTactileClick();
    sidebarToggleBtn.onclick = () => {
        playTactileClick();
        const sidebar = document.querySelector(".sidebar");
        if (sidebar) {
            const isCurrentlyCollapsed = sidebar.classList.contains("collapsed");
            playSwooshSound(isCurrentlyCollapsed);
            sidebar.classList.toggle("collapsed");
            const isCollapsedNow = sidebar.classList.contains("collapsed");
            sidebarToggleBtn.title = isCollapsedNow ? "Показати панель" : "Сховати панель";

            const startTime = performance.now();
            const animateResize = () => {
                if (chart && $("chart")) {
                    chart.resize($("chart").offsetWidth, 400);
                }
                if (performance.now() - startTime < 420) {
                    requestAnimationFrame(animateResize);
                } else if (chart) {
                    chart.timeScale().fitContent();
                }
            };
            requestAnimationFrame(animateResize);
        }
    };
}

let stepHoldTimer = null;
let stepHoldInterval = null;

window.startStepHold = function(inputId, delta) {
    stepInputValue(inputId, delta);
    clearStepHold();

    stepHoldTimer = setTimeout(() => {
        stepHoldInterval = setInterval(() => {
            stepInputValue(inputId, delta);
        }, 80);
    }, 320);
};

window.clearStepHold = function() {
    if (stepHoldTimer) {
        clearTimeout(stepHoldTimer);
        stepHoldTimer = null;
    }
    if (stepHoldInterval) {
        clearInterval(stepHoldInterval);
        stepHoldInterval = null;
    }
};

window.addEventListener('mouseup', clearStepHold);
window.addEventListener('mouseleave', clearStepHold);
window.addEventListener('touchend', clearStepHold);
window.addEventListener('touchcancel', clearStepHold);

window.stepInputValue = function(inputId, delta) {
    playTactileClick();
    const el = $(inputId);
    if (!el) return;
    let val = parseFloat(el.value.replace(",", "."));
    if (isNaN(val)) val = 0;
    val += delta;
    if (delta.toString().includes(".")) {
        val = Math.round(val * 100) / 100;
    }
    el.value = val;
};

// Universal button & interactive element click sound listener
document.addEventListener('click', (e) => {
    const clickable = e.target.closest('button, .btn-step-input, .btn-drawer-close, .ex-checkbox-card, .switch, input[type="checkbox"], .sort-btn');
    if (clickable) {
        playTactileClick();
    }
});

if ($("coinSelectorSearch")) {
    $("coinSelectorSearch").oninput = () => renderCoinSelectorGrid();
}
if ($("closeCoinSelectorX")) $("closeCoinSelectorX").onclick = closeCoinSelectorModal;
if ($("closeCoinSelectorBtn")) $("closeCoinSelectorBtn").onclick = closeCoinSelectorModal;
if ($("coinSelectorModal")) {
    $("coinSelectorModal").onclick = (e) => {
        if (e.target === $("coinSelectorModal")) {
            closeCoinSelectorModal();
        }
    };
}

start();