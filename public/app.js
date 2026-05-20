// ZYVENOX T-MAIL — Premium Frontend Script

let currentAddress = null;
let activeDomains = [];
let pollingInterval = null;
let countdownInterval = null;
let selectedEmailId = null;
let loadedEmails = [];
let inboxEtag = null;

// Polling cadence: faster when tab visible, slower when hidden to reduce server load.
const POLL_FAST_MS = 5000;
const POLL_SLOW_MS = 30000;
function currentPollMs() {
    return document.visibilityState === 'visible' ? POLL_FAST_MS : POLL_SLOW_MS;
}

// UI Selectors
const els = {
    // Theme & Header Controls
    html: document.documentElement,
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleIcon: document.getElementById('theme-toggle-icon'),
    syncDot: document.getElementById('sync-dot'),
    syncText: document.getElementById('sync-text'),
    manualSync: document.getElementById('manual-sync'),
    clearBox: document.getElementById('clear-box'),
    toastContainer: document.getElementById('toast-container'),

    // Sidebar Customization Panel
    customPrefix: document.getElementById('custom-prefix'),
    customDomain: document.getElementById('custom-domain'),
    mailboxDuration: document.getElementById('mailbox-duration'),
    createCustomBtn: document.getElementById('create-custom-btn'),
    addressManualInput: document.getElementById('address-manual-input'),
    recentInboxes: document.getElementById('recent-inboxes'),

    // Main Address Card
    emailDisplayCard: document.getElementById('email-display-card'),
    copyEmailBtn: document.getElementById('copy-email-btn'),
    copyIcon: document.getElementById('copy-icon'),
    copyText: document.getElementById('copy-text'),
    generateRandomBtn: document.getElementById('generate-random-btn'),
    countdownContainer: document.getElementById('countdown-container'),
    countdownTimer: document.getElementById('countdown-timer'),
    extendTimeBtn: document.getElementById('extend-time-btn'),

    // Main Workspace Rows
    inboxCount: document.getElementById('inbox-count'),
    emailList: document.getElementById('email-list'),
    emptyState: document.getElementById('empty-state'),
    detailPanel: document.getElementById('email-detail-panel'),
    closeEmailDetail: document.getElementById('close-email-detail'),

    // Detailed viewer panel
    detailSubject: document.getElementById('detail-subject'),
    detailFromName: document.getElementById('detail-from-name'),
    detailFromAddr: document.getElementById('detail-from-addr'),
    detailDate: document.getElementById('detail-date'),
    detailIframe: document.getElementById('detail-iframe'),
    detailDelete: document.getElementById('detail-delete'),
    detailCopy: document.getElementById('detail-copy'),

    // Mobile nav drawer
    mobileNav: document.getElementById('mobile-nav'),
    openMobileNav: document.getElementById('open-mobile-nav'),
    closeMobileNav: document.getElementById('close-mobile-nav')
};

// Initialize Application
async function init() {
    setupTheme();
    setupEventListeners();
    setupVisibilityPolling();
    enhanceSelects();
    await fetchActiveDomains();
    loadRecentAddresses();

    // Auto-select or Auto-generate email address
    const recents = getRecentAddresses();
    if (recents.length > 0) {
        selectEmailAddress(recents[0]);
    } else {
        autoGenerateEmailAddress(true); // silent initial generation
    }
}

// Adapt polling cadence to tab visibility — slow it down 6x when hidden,
// poll once immediately on return so the user sees fresh state instantly.
function setupVisibilityPolling() {
    document.addEventListener('visibilitychange', () => {
        if (!pollingInterval || !currentAddress) return;
        clearInterval(pollingInterval);
        pollingInterval = setInterval(pollEmails, currentPollMs());
        if (document.visibilityState === 'visible') pollEmails();
    });
}

// 🌓 System Themes Management (Dark/Light Switcher)
function setupTheme() {
    const savedTheme = localStorage.getItem('cfmail_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'light') {
        els.html.classList.remove('dark');
        els.themeToggleIcon.textContent = 'dark_mode';
    } else if (savedTheme === 'dark' || prefersDark) {
        els.html.classList.add('dark');
        els.themeToggleIcon.textContent = 'light_mode';
    } else {
        els.html.classList.remove('dark');
        els.themeToggleIcon.textContent = 'dark_mode';
    }

    els.themeToggle.addEventListener('click', () => {
        if (els.html.classList.contains('dark')) {
            els.html.classList.remove('dark');
            els.themeToggleIcon.textContent = 'dark_mode';
            localStorage.setItem('cfmail_theme', 'light');
            showToast('☀️ Light Mode activated');
        } else {
            els.html.classList.add('dark');
            els.themeToggleIcon.textContent = 'light_mode';
            localStorage.setItem('cfmail_theme', 'dark');
            showToast('🌙 Dark Mode activated');
        }
        // Force refresh active email details (especially sandboxed scrollbars) if selected
        if (selectedEmailId) {
            openEmail(selectedEmailId);
        }
    });
}

// Global Event Listeners Setup
function setupEventListeners() {
    // Copy active email address
    els.copyEmailBtn.addEventListener('click', copyEmailToClipboard);

    // Refresh inbox manually
    els.manualSync.addEventListener('click', () => {
        if (!currentAddress) return;
        pollEmails();
        showToast('Refreshing inbox...');
    });

    // Auto-generate random email
    els.generateRandomBtn.addEventListener('click', () => autoGenerateEmailAddress(false));

    // Create custom prefix email
    els.createCustomBtn.addEventListener('click', createCustomEmailAddress);

    // Extend mailbox lifetime
    els.extendTimeBtn.addEventListener('click', extendMailboxTime);

    // Manual typing email address switcher
    els.addressManualInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = e.target.value.trim().toLowerCase();
            if (validateEmailFormat(val)) {
                selectEmailAddress(val);
                els.addressManualInput.value = '';
                showToast(`Switched to inbox: ${val}`);
            } else {
                showToast('Invalid email address format', 'error');
            }
        }
    });

    // Clear whole inbox
    els.clearBox.addEventListener('click', clearInbox);

    // Close detail panel
    els.closeEmailDetail.addEventListener('click', closeEmailDetail);

    // Mobile nav drawer events
    els.openMobileNav.addEventListener('click', () => els.mobileNav.classList.remove('-translate-x-full'));
    els.closeMobileNav.addEventListener('click', () => els.mobileNav.classList.add('-translate-x-full'));
}

// 🌐 Load Domain Options from Backend
async function fetchActiveDomains() {
    try {
        const res = await fetch('/api/domains');
        const data = await res.json();
        if (data.domains && data.domains.length > 0) {
            activeDomains = data.domains;
            els.customDomain.innerHTML = activeDomains.map(d => `<option value="${d}">${d}</option>`).join('');
        } else {
            els.customDomain.innerHTML = '<option value="">No domains active</option>';
        }
    } catch (err) {
        console.error('Failed to load domains', err);
        showToast('Failed to fetch active domains from server', 'error');
    }
}

// ⚙️ Auto-Generate Email Address
async function autoGenerateEmailAddress(isSilent = false) {
    try {
        if (!isSilent) {
            els.generateRandomBtn.disabled = true;
            els.generateRandomBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">sync</span> Generating...`;
        }

        const duration = els.mailboxDuration.value || 60;

        const res = await fetch('/api/mailboxes/generate/auto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration })
        });
        if (!res.ok) throw new Error('Auto-generation failed');
        const data = await res.json();
        
        selectEmailAddress(data.address);
        if (!isSilent) showToast('Generated new random email address');

    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        els.generateRandomBtn.disabled = false;
        els.generateRandomBtn.innerHTML = `<span class="material-symbols-outlined text-sm">autorenew</span> <span>New Random</span>`;
    }
}

// 🛠️ Create Custom Email Address
async function createCustomEmailAddress() {
    const prefix = els.customPrefix.value.trim().toLowerCase();
    const domain = els.customDomain.value;
    const duration = els.mailboxDuration.value || 60;
    
    if (!prefix) {
        showToast('Username prefix is required', 'error');
        return;
    }
    if (!/^[a-zA-Z0-9.\-_]+$/.test(prefix)) {
        showToast('Prefix contains invalid characters (letters, numbers, dot, dash, underscore only)', 'error');
        return;
    }
    if (!domain) {
        showToast('No active domain selected', 'error');
        return;
    }

    try {
        els.createCustomBtn.disabled = true;
        els.createCustomBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">sync</span> Creating...`;

        const res = await fetch('/api/mailboxes/custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, domain, duration })
        });
        
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to create custom email');
        }
        
        const data = await res.json();
        selectEmailAddress(data.address);
        els.customPrefix.value = '';
        showToast(`Registered custom inbox: ${data.address}`);

    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        els.createCustomBtn.disabled = false;
        els.createCustomBtn.innerHTML = `<span class="material-symbols-outlined text-sm">magic_button</span> Create Address`;
    }
}

// Select an active email address & load its states
function selectEmailAddress(address) {
    if (!address) return;
    currentAddress = address.toLowerCase().trim();

    // Visual card update
    els.emailDisplayCard.textContent = currentAddress;
    els.clearBox.removeAttribute('disabled');
    els.copyEmailBtn.removeAttribute('disabled');
    els.manualSync.removeAttribute('disabled');

    // Drawer close on mobile
    if (window.innerWidth < 768) {
        els.mobileNav.classList.add('-translate-x-full');
    }

    // Refresh Polling Context
    if (pollingInterval) clearInterval(pollingInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    els.countdownContainer.classList.add('hidden');
    els.extendTimeBtn.classList.add('hidden');
    
    closeEmailDetail();
    loadedEmails = [];
    inboxEtag = null;
    els.emailList.innerHTML = '';
    els.inboxCount.textContent = '0 emails';
    
    pollEmails();
    pollingInterval = setInterval(pollEmails, currentPollMs());

    // Save to recents stack
    saveRecentAddress(currentAddress);
}

// Continuous Inbox Polling Engine
async function pollEmails() {
    if (!currentAddress) return;

    // Animate sync icon/dot to show activity
    els.syncDot.classList.remove('hidden');
    els.syncText.textContent = 'Syncing...';

    try {
        const headers = {};
        if (inboxEtag) headers['If-None-Match'] = inboxEtag;
        const res = await fetch(`/api/mailboxes/address/${currentAddress}`, { headers });
        if (res.status === 404) {
            handleMailboxExpiredState();
            return;
        }
        // Inbox unchanged since last poll — server work is minimal, skip re-render.
        if (res.status === 304) {
            els.syncText.textContent = 'Up to date';
            return;
        }
        if (!res.ok) throw new Error('Inbox sync failed');
        const newEtag = res.headers.get('ETag');
        if (newEtag) inboxEtag = newEtag;
        const data = await res.json();
        
        if (data.expires_at) {
            if (new Date(data.expires_at) > new Date()) {
                // Synchronize countdown with backend expires_at
                if (!countdownInterval) {
                    startCountdown(data.expires_at);
                } else {
                    // Update timer target dynamically to keep accurate time
                    const updateTimerTarget = new Date(data.expires_at);
                    if (Math.abs(new Date(els.countdownTimer.dataset.expiry || 0).getTime() - updateTimerTarget.getTime()) > 5000) {
                        startCountdown(data.expires_at);
                    }
                }
            } else {
                handleMailboxExpiredState();
                return;
            }
        }
        
        if (data.emails) {
            // New mail arrived notification
            if (data.emails.length > loadedEmails.length && loadedEmails.length > 0) {
                const newEmail = data.emails[0];
                showToast(`📨 New mail from: ${newEmail.from_name || newEmail.from_addr}`);
            }

            loadedEmails = data.emails;
            els.inboxCount.textContent = `${data.count} emails`;
            renderEmailList(loadedEmails);
        }
    } catch (err) {
        console.error('Polling sync error', err);
        els.syncText.textContent = 'Sync Offline';
    } finally {
        setTimeout(() => {
            if (currentAddress) els.syncText.textContent = 'Live Syncing';
        }, 800);
    }
}

// Render dynamic card rows for email lists
function renderEmailList(emails) {
    if (emails.length === 0) {
        els.emailList.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 border border-dashed border-slate-200/10 rounded-2xl bg-slate-500/5 h-[300px] text-center w-full text-slate-400">
                <span class="material-symbols-outlined text-3xl animate-pulse mb-3 text-brand-500">mail</span>
                <p class="text-xs font-semibold">Waiting for messages...</p>
                <p class="text-[10px] opacity-60 mt-1 max-w-[200px]">Any mail sent to this address will arrive instantly.</p>
            </div>
        `;
        els.emptyState.classList.remove('hidden');
        els.emptyState.classList.add('flex');
        return;
    }

    els.emptyState.classList.add('hidden');
    els.emptyState.classList.remove('flex');
    
    els.emailList.innerHTML = '';
    emails.forEach(e => {
        const card = document.createElement('div');
        card.className = `glass-card rounded-xl p-4 flex flex-col gap-2.5 cursor-pointer relative overflow-hidden ${!e.read ? 'border-l-[3.5px] border-l-brand-500 bg-brand-500/5' : 'opacity-70'} ${selectedEmailId === e.id ? 'bg-slate-500/10 border-solid border-[1px] border-brand-500/50' : ''}`;
        card.addEventListener('click', () => openEmail(e.id));

        const row = document.createElement('div');
        row.className = 'flex justify-between items-baseline gap-4';

        const sender = document.createElement('span');
        sender.className = 'font-bold text-slate-200 dark:text-slate-100 truncate text-xs';
        sender.textContent = e.from_name || e.from_addr;

        const time = document.createElement('span');
        time.className = 'text-[10px] font-semibold text-brand-500 shrink-0 font-mono';
        time.textContent = formatTime(e.received_at);

        row.appendChild(sender);
        row.appendChild(time);

        const subject = document.createElement('span');
        subject.className = 'text-xs text-slate-400 dark:text-slate-300 font-semibold truncate leading-tight';
        subject.textContent = e.subject || '(No Subject)';

        card.appendChild(row);
        card.appendChild(subject);
        els.emailList.appendChild(card);
    });
}

// 📧 Open & securely render an email details
async function openEmail(id) {
    if (!currentAddress) return;
    selectedEmailId = id;
    
    // Reveal panel and show loading spinner inside iframe
    els.detailPanel.classList.remove('hidden');
    els.detailSubject.textContent = 'Opening Secure Viewer...';
    els.detailFromName.textContent = '...';
    els.detailFromAddr.textContent = '';
    els.detailDate.textContent = '...';
    els.detailIframe.srcdoc = `
      <body style="background:transparent;display:flex;align-items:center;justify-content:center;height:80vh;font-family:sans-serif;color:#6366f1;flex-direction:column;gap:12px;margin:0;">
          <svg width="35" height="35" viewBox="0 0 24 24" fill="none" style="animation: spin 1s linear infinite;">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.2" stroke-width="3.5"></circle>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"></path>
          </svg>
          <span style="font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Decrypting mail content...</span>
          <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
      </body>
    `;

    renderEmailList(loadedEmails);

    try {
        const res = await fetch(`/api/mailboxes/address/${currentAddress}/${id}`);
        if (!res.ok) throw new Error('Failed to load email details');
        const email = await res.json();

        els.detailSubject.textContent = email.subject || '(No Subject)';
        els.detailFromName.textContent = email.from_name || 'Sender';
        els.detailFromAddr.textContent = `<${email.from_addr}>`;

        const d = new Date(email.received_at);
        els.detailDate.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;

        const escapeHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        let htmlContent = email.body_html || `<pre style="white-space: pre-wrap; font-family: monospace; font-size: 13px; color: #334155; padding: 20px; line-height: 1.5;">${escapeHtml(email.body_text || 'No content')}</pre>`;
        
        // Iframe CSS Overrides & Dark/Light adaptations inside sandbox paper
        const paperOverrides = `
            <style>
                html, body {
                    background-color: #ffffff !important;
                    color: #1e293b !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                    line-height: 1.6 !important;
                    font-size: 14px !important;
                    margin: 20px !important;
                    padding: 0 !important;
                    word-wrap: break-word !important;
                }
                a { color: #4f46e5 !important; text-decoration: underline !important; }
                img { max-width: 100% !important; height: auto !important; border-radius: 8px !important; }
            </style>
        `;
        if (htmlContent.includes('<head>')) {
            htmlContent = htmlContent.replace('<head>', `<head>${paperOverrides}`);
        } else {
            htmlContent = paperOverrides + htmlContent;
        }

        els.detailIframe.srcdoc = htmlContent;

        // Button events binding
        els.detailDelete.onclick = () => deleteEmail(id);
        els.detailCopy.onclick = () => {
            navigator.clipboard.writeText(JSON.stringify(email, null, 2));
            showToast('Raw JSON email structure copied');
        };

        // Cache update to marked as read
        const emailItem = loadedEmails.find(e => e.id === id);
        if (emailItem) emailItem.read = 1;
        renderEmailList(loadedEmails);

    } catch (err) {
        showToast(err.message, 'error');
        closeEmailDetail();
    }
}

// Close email viewer panel
function closeEmailDetail() {
    selectedEmailId = null;
    els.detailPanel.classList.add('hidden');
    renderEmailList(loadedEmails);
}

// Delete single email
async function deleteEmail(id) {
    if (!currentAddress || !confirm('Permanently delete this email? This cannot be undone.')) return;
    try {
        const res = await fetch(`/api/mailboxes/address/${currentAddress}/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Deletion failed');
        closeEmailDetail();
        pollEmails();
        showToast('Email deleted successfully');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Clear whole inbox
async function clearInbox() {
    if (!currentAddress || !confirm('Wipe out and delete all emails in this mailbox?')) return;
    try {
        const res = await fetch(`/api/mailboxes/address/${currentAddress}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to wipe inbox');
        closeEmailDetail();
        loadedEmails = [];
        inboxEtag = null;
        renderEmailList([]);
        els.inboxCount.textContent = '0 emails';
        showToast('Inbox wiped out completely');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Clipboard copier wrapper
function copyEmailToClipboard() {
    if (!currentAddress) return;
    
    navigator.clipboard.writeText(currentAddress).then(() => {
        // Toggle copy micro-interactions
        els.copyIcon.textContent = 'check';
        els.copyText.textContent = 'Copied!';
        els.copyEmailBtn.classList.remove('bg-brand-500', 'hover:bg-brand-600');
        els.copyEmailBtn.classList.add('bg-emerald-500', 'hover:bg-emerald-600');
        
        showToast('Email address copied to clipboard');

        setTimeout(() => {
            els.copyIcon.textContent = 'content_copy';
            els.copyText.textContent = 'Copy Email';
            els.copyEmailBtn.classList.add('bg-brand-500', 'hover:bg-brand-600');
            els.copyEmailBtn.classList.remove('bg-emerald-500', 'hover:bg-emerald-600');
        }, 2000);
    });
}

// Premium Toast alert system
function showToast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `p-4 rounded-xl shadow-2xl backdrop-blur-md border text-xs font-semibold toast-slide-up pointer-events-auto flex items-center gap-2.5 max-w-sm border-solid ${
        type === 'error' 
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-500' 
            : 'bg-indigo-500/10 border-brand-500/20 text-indigo-500 dark:text-indigo-400'
    }`;
    
    const icon = type === 'error' ? 'error' : 'info';
    el.innerHTML = `
        <span class="material-symbols-outlined text-base">${icon}</span>
        <span>${msg}</span>
    `;
    
    els.toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(15px)';
        el.style.transition = 'all 0.35s ease';
        setTimeout(() => el.remove(), 350);
    }, 3500);
}

// Relative time calculator helper
function formatTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Email syntax validator helper
function validateEmailFormat(email) {
    const re = /^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,6}$/;
    return re.test(email);
}

// Local Storage Manager (Recents Inboxes addresses)
function getRecentAddresses() {
    try {
        return JSON.parse(localStorage.getItem('cfmail_addresses_v3') || '[]');
    } catch (e) {
        return [];
    }
}

function saveRecentAddress(addr) {
    if (!addr) return;
    let list = getRecentAddresses().filter(a => a !== addr);
    list.unshift(addr); // put at top of list
    if (list.length > 3) list = list.slice(0, 3); // cap at 3
    localStorage.setItem('cfmail_addresses_v3', JSON.stringify(list));
    loadRecentAddresses();
}

function loadRecentAddresses() {
    const list = getRecentAddresses();
    if (list.length === 0) {
        els.recentInboxes.innerHTML = '<span class="text-[10px] text-slate-500 font-mono p-1">No recent addresses</span>';
        return;
    }
    
    els.recentInboxes.innerHTML = '';
    list.forEach(addr => {
        const btn = document.createElement('button');
        btn.className = 'flex items-center gap-2.5 px-3 py-2 w-full text-left rounded-lg bg-slate-500/5 hover:bg-brand-500/10 border border-slate-200/5 text-slate-400 hover:text-brand-500 font-mono transition-all group overflow-hidden';
        btn.addEventListener('click', () => selectEmailAddress(addr));

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-xs shrink-0 opacity-40 group-hover:opacity-100 transition-opacity';
        icon.textContent = 'history';

        const label = document.createElement('span');
        label.className = 'text-[11px] truncate flex-1 leading-none font-bold';
        label.textContent = addr;

        btn.appendChild(icon);
        btn.appendChild(label);
        els.recentInboxes.appendChild(btn);
    });
}

// ⏳ Mailbox Lifetime Countdown Timer
function startCountdown(expiresAtStr) {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const expiresAt = new Date(expiresAtStr);
    els.countdownTimer.dataset.expiry = expiresAtStr;
    
    // Reveal components in UI
    els.countdownContainer.classList.remove('hidden');
    els.countdownContainer.classList.add('flex');
    els.extendTimeBtn.classList.remove('hidden');
    els.extendTimeBtn.classList.add('inline-flex');
    
    // Enable core action buttons just in case they were disabled
    els.copyEmailBtn.removeAttribute('disabled');
    els.manualSync.removeAttribute('disabled');

    const updateTimer = () => {
        const diff = expiresAt.getTime() - Date.now();
        
        if (diff <= 0) {
            clearInterval(countdownInterval);
            handleMailboxExpiredState();
            return;
        }

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        let formatted = '';
        if (hours > 0) {
            formatted += hours + ':';
        }
        formatted += String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        
        els.countdownTimer.textContent = formatted;

        // Visual warnings for less than 2 minutes sisa waktu
        if (diff < 2 * 60 * 1000) {
            els.countdownContainer.className = "flex items-center gap-1.5 text-[10px] font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 px-2.5 py-0.5 rounded-full shrink-0 max-w-max animate-pulse";
        } else {
            els.countdownContainer.className = "flex items-center gap-1.5 text-[10px] font-bold text-indigo-500 dark:text-indigo-400 bg-brand-500/10 dark:bg-brand-500/20 px-2.5 py-0.5 rounded-full shrink-0 max-w-max border border-brand-500/10";
        }
    };

    updateTimer();
    countdownInterval = setInterval(updateTimer, 1000);
}

// Mailbox Expired state handling
function handleMailboxExpiredState() {
    if (countdownInterval) clearInterval(countdownInterval);
    if (pollingInterval) clearInterval(pollingInterval);
    countdownInterval = null;
    pollingInterval = null;
    
    els.countdownTimer.textContent = "EXPIRED";
    els.countdownContainer.className = "flex items-center gap-1.5 text-[10px] font-bold text-rose-500 bg-rose-500/15 border border-rose-500/30 px-2.5 py-0.5 rounded-full shrink-0 max-w-max";
    
    // Disable action buttons to avoid errors on expired session
    els.copyEmailBtn.setAttribute('disabled', 'true');
    els.manualSync.setAttribute('disabled', 'true');
    els.extendTimeBtn.classList.add('hidden'); // hide extend on expired
    
    showToast('⚠️ Mailbox has expired! Please generate a new email address.', 'error');
}

// Call backend Extend Lifetime API
async function extendMailboxTime() {
    if (!currentAddress) return;
    try {
        els.extendTimeBtn.disabled = true;
        els.extendTimeBtn.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">sync</span> Extending...`;

        const res = await fetch(`/api/mailboxes/address/${currentAddress}/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration: 15 }) // extend by 15 minutes
        });

        if (!res.ok) throw new Error('Failed to extend mailbox');
        const data = await res.json();
        
        startCountdown(data.expires_at);
        showToast('➕ Inbox active time extended by +15 minutes!');
        
        // Force poll emails to keep backend and frontend in sync
        pollEmails();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        els.extendTimeBtn.disabled = false;
        els.extendTimeBtn.innerHTML = `<span class="material-symbols-outlined text-xs">add_circle</span> Extend +15m`;
    }
}

// ─── Custom themed dropdown ──────────────────────────────────────────────
// The native <select data-zv-select> stays as the source of truth (kept for
// .value reads, form semantics, accessibility); we hide it visually and
// render a themed popup that proxies clicks back into the select.
function enhanceSelects() {
    document.querySelectorAll('select[data-zv-select]').forEach(buildZvSelect);
}

function buildZvSelect(select) {
    if (select.dataset.zvBuilt) return;
    select.dataset.zvBuilt = '1';

    const wrap = document.createElement('div');
    wrap.className = 'zv-select-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'zv-select-trigger';
    trigger.innerHTML = `<span class="zv-value"></span><span class="material-symbols-outlined zv-chev">expand_more</span>`;
    wrap.appendChild(trigger);

    const pop = document.createElement('div');
    pop.className = 'zv-select-pop';
    pop.setAttribute('role', 'listbox');
    wrap.appendChild(pop);

    const refresh = () => {
        const opts = Array.from(select.options);
        const current = select.value;
        pop.innerHTML = '';

        if (opts.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'zv-option-empty';
            empty.textContent = 'No options available';
            pop.appendChild(empty);
        } else {
            opts.forEach((opt, idx) => {
                const item = document.createElement('div');
                item.className = 'zv-option';
                item.setAttribute('role', 'option');
                item.dataset.value = opt.value;
                item.textContent = opt.textContent;
                if (opt.value === current) item.setAttribute('aria-selected', 'true');
                item.addEventListener('click', () => {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    refresh();
                    closePop();
                });
                pop.appendChild(item);
            });
        }

        const selectedOpt = opts.find(o => o.value === current) || opts[0];
        const valueEl = trigger.querySelector('.zv-value');
        if (selectedOpt) {
            valueEl.textContent = selectedOpt.textContent;
            trigger.classList.remove('is-empty');
        } else {
            valueEl.textContent = 'No options available';
            trigger.classList.add('is-empty');
        }
    };

    const openPop = () => {
        document.querySelectorAll('.zv-select-wrap.open').forEach(w => w.classList.remove('open'));
        wrap.classList.add('open');
    };
    const closePop = () => wrap.classList.remove('open');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('open')) closePop();
        else openPop();
    });

    // Close on outside click / escape
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) closePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

    // Re-render whenever options change (e.g. domains fetched async) or value
    // is set programmatically.
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
    select.addEventListener('change', refresh);

    refresh();
}

// Trigger initial boot
init();
