/* ═══════════════════════════════════════════════════════════════
   FlowCast v2.1 — TomTom Migration
   Modules: Auth | EventStore | AdminMap | PublicMap | Routing | Countdown | UI
═══════════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const ADMIN_PIN          = '1234';
const POLL_INTERVAL_MS   = 5_000;   // Refresh events every 5 s
const COUNTDOWN_TICK_MS  = 1_000;    // Countdown every 1 s
const ROUTE_FETCH_DELAY  = 800;      // Debounce for geocoder suggestions
const DEFAULT_CENTER     = [77.5946, 12.9716]; // Bengaluru [lng, lat] for TomTom
let TOMTOM_API_KEY       = '';       // Loaded from /api/config

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let currentRole    = null;   // 'admin' | 'public'
let activeEvents   = [];     // Live events
let pendingEvents  = [];     // Pending events (Admin only)
let adminMap       = null;
let publicMap      = null;
let adminPinMarker = null;   
let publicPinMarker= null;
let adminLat       = null;
let adminLng       = null;
let publicLat      = null;
let publicLng      = null;
let eventMarkers   = { admin: {}, public: {} }; // eventId → tt.Marker
let countdownTimer = null;
let pollTimer      = null;
let sourceLatLng   = null; // {lat, lng}
let destLatLng     = null; // {lat, lng}
let currentRouteLayer = null; // Store route drawn on public map
let cardCountdownTimer  = null; // Live ticker inside commander detail card
let _lastRoutes         = [];   // Cache of last fetched routes

// ─────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─────────────────────────────────────────────
// ══════ BOOTSTRAP ══════
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        TOMTOM_API_KEY = config.TOMTOM_API_KEY || '';
        if (!TOMTOM_API_KEY) {
            console.warn('TomTom API Key not set. Map features may not work.');
        }
    } catch (e) {
        console.error('Failed to load config', e);
    }
});

// ─────────────────────────────────────────────
// ══════ AUTH MODULE ══════
// ─────────────────────────────────────────────
function loginAsAdmin() {
    const pin = $('adminPinInput').value.trim();
    if (pin !== ADMIN_PIN) {
        shakeElement($('adminPinInput'));
        showToast('❌ Incorrect PIN. Try 1234', 'error');
        return;
    }
    currentRole = 'admin';
    showApp('admin');
    initAdminMap();
    startPolling();
    startCountdown();
}

function loginAsPublic() {
    currentRole = 'public';
    showApp('public');
    initPublicMap();
    startPolling();
    startCountdown();
}

function switchRole() {
    // Teardown
    clearInterval(pollTimer);
    clearInterval(countdownTimer);
    
    // Clear route
    if (currentRouteLayer && publicMap) {
        publicMap.removeLayer(currentRouteLayer);
        publicMap.removeSource('route');
        currentRouteLayer = null;
    }
    
    activeEvents = [];
    pendingEvents = [];
    eventMarkers = { admin: {}, public: {} };
    adminPinMarker = null;
    publicPinMarker = null;
    adminLat = null; adminLng = null;
    publicLat = null; publicLng = null;
    sourceLatLng = null; destLatLng = null;

    // Return to landing
    $('app-shell').classList.add('hidden');
    $('landing-page').classList.remove('hidden');
    $('adminPinInput').value = '';

    $('admin-view').classList.add('hidden');
    $('public-view').classList.add('hidden');
}

// ─────────────────────────────────────────────
// ══════ UI HELPERS ══════
// ─────────────────────────────────────────────
function showApp(role) {
    $('landing-page').classList.add('hidden');
    $('app-shell').classList.remove('hidden');

    const badge = $('roleBadge');
    if (role === 'admin') {
        $('admin-view').classList.remove('hidden');
        $('public-view').classList.add('hidden');
        badge.textContent = '🚔 Traffic Command';
        badge.className = 'role-badge badge-admin';
    } else {
        $('public-view').classList.remove('hidden');
        $('admin-view').classList.add('hidden');
        badge.textContent = '🗺️ Navigation';
        badge.className = 'role-badge badge-public';
    }
}

function showToast(msg, type = 'info') {
    const toast = $('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.style.borderColor = type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function closeModal(id) {
    $(id).classList.add('hidden');
}

function shakeElement(el) {
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'shake 0.4s ease';
    el.addEventListener('animationend', () => el.style.animation = '', { once: true });
}

function formatDuration(hours) {
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatCountdown(expiresAt) {
    const remaining = new Date(expiresAt) - Date.now();
    if (remaining <= 0) return '⏱ Expired';
    const totalSec = Math.floor(remaining / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `⏱ ${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    return `⏱ ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}

function causeName(cause) {
    const map = {
        vehicle_breakdown: 'Vehicle Breakdown',
        tree_fall: 'Tree Fall',
        water_logging: 'Water Logging',
        pot_holes: 'Pot Holes',
        public_event: 'Public Event',
        construction: 'Construction',
        accident: 'Accident',
        others: 'Other Incident'
    };
    return map[cause] || cause;
}

function causeEmoji(cause) {
    const map = {
        vehicle_breakdown: '🚗', tree_fall: '🌳', water_logging: '💧',
        pot_holes: '🕳️', public_event: '🎉', construction: '🏗️',
        accident: '🚨', others: '•'
    };
    return map[cause] || '⚠️';
}

function updateActiveCount() {
    const n = activeEvents.length;
    // Update sidebar badges only (header count element removed)
    const sidebarBadgeAdmin = $('sidebarEventCount');
    const sidebarBadgePublic = $('publicEventCount');
    if (sidebarBadgeAdmin) { sidebarBadgeAdmin.textContent = n; sidebarBadgeAdmin.dataset.count = n; }
    if (sidebarBadgePublic) { sidebarBadgePublic.textContent = n; sidebarBadgePublic.dataset.count = n; }
}

function updatePendingCount() {
    const n = pendingEvents.length;
    const badge = $('sidebarPendingCount');
    if (badge) { badge.textContent = n; badge.dataset.count = n; }
    // Auto-highlight the Queue tab if new items arrive
    if (n > 0) {
        const queueBtn = document.querySelector('[data-tab="adminTabQueue"]');
        if (queueBtn && !queueBtn.classList.contains('active')) {
            queueBtn.style.color = '#f59e0b';
        }
    }
}

// ─────────────────────────────────────────────
// ══════ TAB NAVIGATION ══════
// ─────────────────────────────────────────────
function switchTab(view, tabId, clickedBtn) {
    // Get all panels and buttons within this view
    const navId   = view === 'admin' ? 'adminTabNav' : 'publicTabNav';
    const navEl   = $(navId);
    const sidebar = navEl ? navEl.closest('aside') : null;
    if (!sidebar) return;

    // Hide all panels
    sidebar.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    // Deactivate all buttons and reset highlight
    navEl.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.color = '';
    });

    // Show selected
    const panel = $(tabId);
    if (panel) panel.classList.remove('hidden');
    if (clickedBtn) clickedBtn.classList.add('active');
}

// ─────────────────────────────────────────────
// ══════ MAP MARKER HELPERS (TOMTOM) ══════
// ─────────────────────────────────────────────
function createImpactDot(severity, status, cause) {
    const div = document.createElement('div');
    const icon = causeEmoji(cause) || '';
    if (status === 'pending') {
        div.className = `impact-dot impact-dot-pending`;
        div.style.borderColor = `var(--sev-${severity.toLowerCase()})`;
        div.innerHTML = `<span style="font-size: 13px; line-height:1;">${icon}</span>`;
    } else {
        div.className = `impact-dot impact-dot-${severity.toLowerCase()}`;
        const iconSize = severity === 'High' ? '20px' : severity === 'Medium' ? '16px' : '13px';
        div.innerHTML = `<span style="font-size: ${iconSize}; line-height:1;">${icon}</span>`;
    }
    return div;
}

function buildPopupHtml(ev, role) {
    if (ev.status === 'pending') {
        return `
          <div class="popup-content">
            <div class="popup-header">
              <span class="popup-cause">${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}</span>
              <span class="popup-sev-chip popup-sev-pending">PENDING</span>
            </div>
            <div class="popup-row"><span>Reported</span><span>Just now</span></div>
          </div>`;
    }

    if (role === 'public') {
        return `
          <div class="popup-content">
            <div class="popup-header">
              <span class="popup-cause">${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}</span>
            </div>
            <div class="popup-row"><span>Closure</span><span>${ev.requires_road_closure ? 'Yes' : 'No'}</span></div>
            <div class="popup-countdown" id="popup-cd-${role}-${ev.id}">${formatCountdown(ev.expires_at)}</div>
          </div>`;
    }

    return `
      <div class="popup-content">
        <div class="popup-header">
          <span class="popup-cause">${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}</span>
          <span class="popup-sev-chip popup-sev-${ev.severity}">${ev.severity}</span>
        </div>
        <div class="popup-row"><span>Priority</span><span>${ev.priority}</span></div>
        <div class="popup-row"><span>ETR</span><span>${formatDuration(ev.etr_hours)}</span></div>
        <div class="popup-row"><span>Closure</span><span>${ev.requires_road_closure ? 'Yes' : 'No'}</span></div>
        <div class="popup-countdown" id="popup-cd-${role}-${ev.id}">${formatCountdown(ev.expires_at)}</div>
      </div>`;
}

// ─────────────────────────────────────────────
// ══════ EVENT STORE MODULE ══════
// ─────────────────────────────────────────────
async function fetchActiveEvents() {
    try {
        const res = await fetch('/api/events');
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        activeEvents = data.events || [];
        renderAllEventMarkers();
        smartRenderFeed('eventsFeed', 'admin', activeEvents);
        smartRenderFeed('publicEventsFeed', 'public', activeEvents);
        updateActiveCount();
    } catch (err) {
        console.warn('Could not fetch active events:', err);
    }
}

async function fetchPendingEvents() {
    if (currentRole !== 'admin') return;
    try {
        const res = await fetch('/api/events/pending');
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        pendingEvents = data.events || [];
        // Only re-render if the pending feed is not the active focused area
        const focused = document.activeElement;
        const pendingFeed = $('pendingEventsFeed');
        if (!pendingFeed || !pendingFeed.contains(focused)) {
            renderPendingFeed();
        }
        renderMarkersOnMap('admin', adminMap);
        updatePendingCount();
    } catch (err) {
        console.warn('Could not fetch pending events:', err);
    }
}

function startPolling() {
    fetchActiveEvents();
    fetchPendingEvents();
    pollTimer = setInterval(() => {
        fetchActiveEvents();
        fetchPendingEvents();
    }, POLL_INTERVAL_MS);
}

// ─────────────────────────────────────────────
// ══════ MARKER RENDERING (TOMTOM) ══════
// ─────────────────────────────────────────────
function renderAllEventMarkers() {
    if (currentRole === 'admin') renderMarkersOnMap('admin', adminMap);
    if (currentRole === 'public') renderMarkersOnMap('public', publicMap);
}

function renderMarkersOnMap(role, map) {
    if (!map) return;

    // Combine active + pending (pending only for admin); public sees ONLY live events
    const displayEvents = role === 'admin'
        ? [...activeEvents, ...pendingEvents]
        : activeEvents.filter(e => e.status === 'live' || e.status === 'active');
    const currentIds = new Set(displayEvents.map(e => e.id));
    const existingIds = new Set(Object.keys(eventMarkers[role]));

    // Remove expired/deleted markers
    existingIds.forEach(id => {
        if (!currentIds.has(id)) {
            eventMarkers[role][id].remove();
            delete eventMarkers[role][id];
        }
    });

    // Add/Update markers
    displayEvents.forEach(ev => {
        if (!eventMarkers[role][ev.id]) {
            const el = createImpactDot(ev.severity, ev.status, ev.event_cause);
            const marker = new tt.Marker({ element: el })
                .setLngLat([ev.lng, ev.lat])
                .addTo(map);

            if (role === 'public') {
                const popup = new tt.Popup({ offset: 15 }).setHTML(buildPopupHtml(ev, role));
                marker.setPopup(popup);
            } else {
                // Admin gets full info slide-out card instead of basic popup
                marker.getElement().style.cursor = 'pointer';
                marker.getElement().addEventListener('click', () => {
                    const liveEv = activeEvents.find(e => e.id === ev.id) || pendingEvents.find(e => e.id === ev.id) || ev;
                    showCommanderDetailCard(liveEv);
                });
            }

            eventMarkers[role][ev.id] = marker;
        } else {
            // Check if status changed (e.g. pending to live)
            const m = eventMarkers[role][ev.id];
            const oldEl = m.getElement();
            const newClass = ev.status === 'pending' ? 'impact-dot impact-dot-pending' : `impact-dot impact-dot-${ev.severity.toLowerCase()}`;
            if (oldEl.className !== newClass) {
                oldEl.className = newClass;
            }
            if (role === 'public' && m.getPopup() && m.getPopup().isOpen()) {
                m.getPopup().setHTML(buildPopupHtml(ev, role));
            }
        }
    });
}

// ─────────────────────────────────────────────
// ══════ COMMANDER DETAIL CARD ══════
// ─────────────────────────────────────────────
function showCommanderDetailCard(ev) {
    const card = $('commanderDetailCard');
    if (!card) return;

    // ── Clear any existing countdown ticker to prevent leaks ──
    if (cardCountdownTimer) { clearInterval(cardCountdownTimer); cardCountdownTimer = null; }

    const statusColor = ev.status === 'pending' ? '#f59e0b' : '#10b981';
    const statusLabel = ev.status === 'pending' ? '🟡 Pending' : '🟢 Active';
    const rec = ev.recommendations || {};

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
            <div style="font-weight:700; font-size:1.05rem; color:var(--dark-text);">${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}</div>
            <button onclick="closeCommanderCard()" style="background:none; border:none; font-size:1.2rem; cursor:pointer; color:var(--dark-muted);">&times;</button>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:15px; align-items:center; flex-wrap:wrap;">
            <span class="severity-chip chip-${ev.severity}">${ev.severity}</span>
            <span style="font-size:0.72rem; color:var(--dark-muted); font-weight:600; background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:10px;">PRIORITY: ${(ev.priority || '—').toUpperCase()}</span>
            <span style="font-size:0.72rem; font-weight:700; color:${statusColor}; background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:10px;">${statusLabel}</span>
        </div>
        <div style="font-size:0.85rem; margin-bottom:8px; display:flex; justify-content:space-between;">
            <strong style="color:var(--dark-muted)">Location:</strong> 
            <span>[${ev.lng.toFixed(5)}, ${ev.lat.toFixed(5)}]</span>
        </div>
        <div style="font-size:0.85rem; margin-bottom:15px; display:flex; justify-content:space-between;">
            <strong style="color:var(--dark-muted)">Road closure:</strong> 
            <span>${ev.requires_road_closure ? '<span style="color:#ef4444;font-weight:600;">Yes</span>' : 'No'}</span>
        </div>
        
        <div class="event-feed-resources" style="background:var(--dark-surface-2); border:1px solid var(--dark-border); padding:12px; border-radius:8px; font-size: 0.85rem; color: var(--dark-text);">
            <div style="margin-bottom:6px; display:flex; justify-content:space-between;">
                <span>👮 <strong>Manpower</strong></span>
                <span>${ev.recommendations.Manpower}</span>
            </div>
            <div style="margin-bottom:6px; display:flex; justify-content:space-between;">
                <span>🚧 <strong>Barricading</strong></span>
                <span>${ev.recommendations.Barricading}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <span style="white-space:nowrap; margin-right:10px;">🔀 <strong>Diversion</strong></span>
                <span style="text-align:right;">${ev.recommendations.DiversionPlan}</span>
            </div>
        </div>
        <div style="margin-top:15px; font-size:0.8rem; color:var(--dark-muted); text-align:right;">
            Remaining Duration: <strong id="card-cd-${ev.id}">${formatCountdown(ev.expires_at)}</strong>
        </div>
    `;
    card.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// ══════ EVENTS FEED UI ══════
// ─────────────────────────────────────────────
function renderEventFeeds() {
    renderFeed('eventsFeed', 'admin', activeEvents);
    renderFeed('publicEventsFeed', 'public', activeEvents);
}

function renderFeed(feedId, role, eventsArray) {
    const feed = $(feedId);
    if (!feed) return;

    if (eventsArray.length === 0) {
        feed.innerHTML = '<div class="empty-feed">No active incidents reported</div>';
        return;
    }

    feed.innerHTML = eventsArray.map(ev => {
        let adminDetails = '';
        if (role === 'admin' && ev.recommendations) {
            adminDetails = `
              <div class="event-feed-resources" style="font-size: 0.75rem; color: var(--dark-muted); margin-top: 8px; border-top: 1px solid var(--dark-border); padding-top: 8px;">
                <div>👮 <strong>Manpower:</strong> ${ev.recommendations.Manpower}</div>
                <div>🚧 <strong>Barricading:</strong> ${ev.recommendations.Barricading}</div>
                <div>🔀 <strong>Diversion:</strong> ${ev.recommendations.DiversionPlan}</div>
              </div>
            `;
        }

        // Click-to-fly: sidebar card → map marker
        const flyFn = role === 'admin'
            ? `flyToIncident(${ev.lng}, ${ev.lat}, '${ev.id}', 'admin')`
            : `flyToIncident(${ev.lng}, ${ev.lat}, '${ev.id}', 'public')`;

        const html = `
          <div class="event-feed-card sev-${ev.severity}" id="feed-${role}-${ev.id}" style="cursor:pointer;" onclick="${flyFn}">
            <div class="event-feed-top">
              <span class="event-feed-cause">${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}</span>
              <span class="event-feed-sev sev-chip-${ev.severity}">${ev.severity}</span>
            </div>
            <div class="event-feed-countdown" id="feed-cd-${role}-${ev.id}">${formatCountdown(ev.expires_at)}</div>
            ${adminDetails}
            ${role === 'admin' ? `<button class="event-feed-dismiss" onclick="event.stopPropagation(); dismissEvent('${ev.id}')">✕ Dismiss</button>` : ''}
          </div>
        `;
        return html;
    }).join('');
}

// ─────────────────────────────────────────────
// Focus-safe smart feed renderer ─ only updates changed cards
// ─────────────────────────────────────────────
function smartRenderFeed(feedId, role, eventsArray) {
    // If a search/route input has focus, skip entirely to avoid blur
    const focused = document.activeElement;
    const isSearchFocused = focused && (
        focused.id === 'sourceInput' ||
        focused.id === 'destInput'   ||
        focused.classList.contains('route-input')
    );
    if (isSearchFocused) return;

    // Delegate to normal renderer
    renderFeed(feedId, role, eventsArray);
}

// ─────────────────────────────────────────────
// ══════ SIDEBAR → MAP SYNC (flyTo) ══════
// ─────────────────────────────────────────────
function flyToIncident(lng, lat, eventId, role) {
    const map = role === 'admin' ? adminMap : publicMap;
    if (!map) return;

    map.easeTo({ center: [lng, lat], zoom: 15, pitch: 40, duration: 750 });

    setTimeout(() => {
        if (role === 'admin') {
            const ev = activeEvents.find(e => e.id === eventId) || pendingEvents.find(e => e.id === eventId);
            if (ev) showCommanderDetailCard(ev);
        } else {
            const m = eventMarkers['public'][eventId];
            if (m && m.getPopup) m.togglePopup();
        }
    }, 800);
}

function renderPendingFeed() {
    const feed = $('pendingEventsFeed');
    if (!feed) return;

    if (pendingEvents.length === 0) {
        feed.innerHTML = '<div class="empty-feed">No pending reports</div>';
        return;
    }

    feed.innerHTML = pendingEvents.map(ev => `
      <div class="event-feed-card sev-pending" id="pending-feed-${ev.id}">
        <div class="event-feed-top">
          <span class="event-feed-cause">${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}</span>
          <span class="badge-pending" style="font-size:0.65rem; padding: 2px 6px; border-radius:10px;">Pending</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--dark-muted); margin-top: 4px;">Awaiting Verification</div>
        <div class="pending-actions" style="margin-top: 12px;">
            <button class="submit-btn" style="width:100%; padding: 6px; font-size: 0.8rem;" onclick="reviewPendingEvent('${ev.id}')">Verify Report</button>
        </div>
      </div>
    `).join('');
}

async function dismissEvent(eventId) {
    try {
        await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
        activeEvents = activeEvents.filter(e => e.id !== eventId);
        renderAllEventMarkers();
        renderEventFeeds();
        updateActiveCount();
        showToast('✅ Incident dismissed');
    } catch (err) {
        showToast('⚠️ Could not dismiss event', 'error');
    }
}

// ─────────────────────────────────────────────
// ══════ COMMANDER APPROVAL FLOW ══════
// ─────────────────────────────────────────────
let currentClosureValue = false;  // replaces old currentSliderValue

function reviewPendingEvent(eventId) {
    const ev = pendingEvents.find(e => e.id === eventId);
    if (!ev) return;

    $('resultModalCause').textContent = `${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)} (Pending)`;
    const chip = $('severityChip');
    chip.textContent = `Awaiting Verification`;
    chip.className = `severity-chip badge-pending`;
    $('etrChip').textContent = `ETR: —`;

    currentClosureValue = false;

    const recGrid = $('recGrid');
    if (recGrid) {
        recGrid.innerHTML = `
            <div style="grid-column: 1/-1; margin-bottom: 12px;">
                <div style="font-size:0.75rem; font-weight:600; color:var(--dark-muted); margin-bottom:4px;">📍 Reported Location</div>
                <div style="font-size:0.85rem; font-weight:600; color:var(--dark-text); background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.2); border-radius:6px; padding:8px;">
                    Lat: ${ev.lat.toFixed(5)} &nbsp;|&nbsp; Lng: ${ev.lng.toFixed(5)}
                </div>
            </div>
            <div style="grid-column: 1/-1; margin-bottom: 15px;">
                <label style="font-size: 0.75rem; font-weight: 600; color: var(--dark-muted);">Physically Verified Priority</label>
                <select id="verify_priority" style="width:100%; padding:8px; margin-top:4px; border:1px solid var(--dark-border); border-radius:6px; background:var(--dark-surface); color:var(--dark-text); font-family:'Inter',sans-serif;">
                    <option value="Low">🟢 Low</option>
                    <option value="Medium">🟡 Medium</option>
                    <option value="High">🔴 High</option>
                </select>
            </div>
            <div style="grid-column: 1/-1;">
                <div style="font-size:0.75rem; font-weight:600; color:var(--dark-muted); margin-bottom:8px;">Road Closure Required?</div>
                <div style="display:flex; gap:8px;">
                    <button id="closureBtnNo" onclick="setClosure(false)" class="closure-toggle-btn closure-active"
                        style="flex:1; padding:9px; border-radius:8px; border:2px solid #10b981; background:rgba(16,185,129,0.15); color:#10b981; font-weight:700; font-size:0.85rem; cursor:pointer;">
                        ✔ No
                    </button>
                    <button id="closureBtnYes" onclick="setClosure(true)" class="closure-toggle-btn"
                        style="flex:1; padding:9px; border-radius:8px; border:2px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:var(--dark-muted); font-weight:700; font-size:0.85rem; cursor:pointer;">
                        ⚠ Yes
                    </button>
                </div>
            </div>
        `;
    }

    $('resultModalIcon').textContent = '📋';

    $('modalFooterAction').innerHTML = `
        <div style="display:flex; gap:10px; width:100%; margin-top:10px;">
            <button class="submit-btn" style="background:#10b981; flex:1; padding:10px; border-radius:8px; cursor:pointer; color:white; font-weight:600;" onclick="approveEvent('${ev.id}')">Verify &amp; Predict</button>
            <button class="submit-btn" style="background:#ef4444; flex:0.4; padding:10px; border-radius:8px; cursor:pointer; color:white; font-weight:600;" onclick="rejectEvent('${ev.id}'); closeModal('resultModal');">Reject</button>
        </div>
    `;

    $('resultModal').classList.remove('hidden');

    // ── Pan admin map to the pending marker ──
    if (adminMap) adminMap.easeTo({ center: [ev.lng, ev.lat], zoom: 16, pitch: 30, duration: 700 });
}

function setClosure(value) {
    currentClosureValue = value;
    const btnNo  = $('closureBtnNo');
    const btnYes = $('closureBtnYes');
    if (!btnNo || !btnYes) return;
    if (value) {
        // Yes is active
        btnYes.style.border      = '2px solid #ef4444';
        btnYes.style.background  = 'rgba(239,68,68,0.15)';
        btnYes.style.color       = '#ef4444';
        btnNo.style.border       = '2px solid rgba(255,255,255,0.1)';
        btnNo.style.background   = 'rgba(255,255,255,0.04)';
        btnNo.style.color        = 'var(--dark-muted)';
        btnYes.textContent       = '✔ Yes';
        btnNo.textContent        = '⚠ No';
    } else {
        // No is active
        btnNo.style.border       = '2px solid #10b981';
        btnNo.style.background   = 'rgba(16,185,129,0.15)';
        btnNo.style.color        = '#10b981';
        btnYes.style.border      = '2px solid rgba(255,255,255,0.1)';
        btnYes.style.background  = 'rgba(255,255,255,0.04)';
        btnYes.style.color       = 'var(--dark-muted)';
        btnNo.textContent        = '✔ No';
        btnYes.textContent       = '⚠ Yes';
    }
}

async function approveEvent(eventId) {
    const priority = $('verify_priority').value;
    const requires_road_closure = currentClosureValue;

    const btn = event.target;
    btn.textContent = 'Processing…';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/events/${eventId}/approve`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ priority, requires_road_closure })
        });
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        const ev = data.event;

        // Remove from pending, add to active
        pendingEvents = pendingEvents.filter(e => e.id !== eventId);
        activeEvents.push(ev);

        renderPendingFeed();
        renderAllEventMarkers();
        renderEventFeeds();
        updateActiveCount();
        updatePendingCount();

        // ── Render prediction results inline (replace recGrid + footer) ──
        const rec = ev.recommendations || {};
        const recGrid = $('recGrid');
        if (recGrid) {
            recGrid.innerHTML = `
                <div style="grid-column:1/-1; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:10px; padding:14px;">
                    <div style="font-size:0.75rem; font-weight:700; color:#10b981; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:10px;">
                        ✅ Prediction Complete — Now Live
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.82rem;">
                        <div style="background:var(--dark-surface-2); padding:8px 10px; border-radius:7px;">
                            <div style="color:var(--dark-muted); font-size:0.7rem;">Severity</div>
                            <div style="font-weight:700; color:var(--dark-text);">${ev.severity}</div>
                        </div>
                        <div style="background:var(--dark-surface-2); padding:8px 10px; border-radius:7px;">
                            <div style="color:var(--dark-muted); font-size:0.7rem;">ETR</div>
                            <div style="font-weight:700; color:var(--dark-text);">${formatDuration(ev.etr_hours)}</div>
                        </div>
                        <div style="background:var(--dark-surface-2); padding:8px 10px; border-radius:7px;">
                            <div style="color:var(--dark-muted); font-size:0.7rem;">👮 Manpower</div>
                            <div style="font-weight:600; color:var(--dark-text); font-size:0.78rem;">${rec.Manpower || '—'}</div>
                        </div>
                        <div style="background:var(--dark-surface-2); padding:8px 10px; border-radius:7px;">
                            <div style="color:var(--dark-muted); font-size:0.7rem;">🚧 Barricading</div>
                            <div style="font-weight:600; color:var(--dark-text); font-size:0.78rem;">${rec.Barricading || '—'}</div>
                        </div>
                        <div style="grid-column:1/-1; background:var(--dark-surface-2); padding:8px 10px; border-radius:7px;">
                            <div style="color:var(--dark-muted); font-size:0.7rem;">🔀 Diversion Plan</div>
                            <div style="font-weight:600; color:var(--dark-text); font-size:0.78rem;">${rec.DiversionPlan || '—'}</div>
                        </div>
                    </div>
                </div>
            `;
        }
        // Update modal header
        $('resultModalCause').textContent = `${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}`;
        const chip = $('severityChip');
        chip.textContent = `${ev.severity} Severity`;
        chip.className = `severity-chip chip-${ev.severity}`;
        $('etrChip').textContent = `ETR: ${formatDuration(ev.etr_hours)}`;
        $('resultModalIcon').textContent = ev.severity === 'High' ? '🚨' : ev.severity === 'Medium' ? '⚠️' : '✅';
        $('modalFooterAction').innerHTML = `
            <div style="display:flex; justify-content:flex-end; gap:8px; width:100%; margin-top:10px;">
                <button class="submit-btn" style="background:#6366f1; padding:9px 20px; border-radius:8px; cursor:pointer; color:white; font-weight:600; width:auto;" onclick="closeModal('resultModal')">
                    📊 Done
                </button>
            </div>`;
        showToast('✅ Verification Complete! Event is now Live.');
    } catch (err) {
        showToast('⚠️ Could not approve event', 'error');
        btn.textContent = 'Verify & Predict';
        btn.disabled = false;
    }
}

async function rejectEvent(eventId) {
    try {
        await fetch(`/api/events/${eventId}/reject`, { method: 'PUT' });
        pendingEvents = pendingEvents.filter(e => e.id !== eventId);
        renderPendingFeed();
        renderAllEventMarkers();
        updatePendingCount();
        showToast('✅ Event Rejected');
    } catch (err) {
        showToast('⚠️ Could not reject event', 'error');
    }
}

// ─────────────────────────────────────────────
// ══════ COUNTDOWN MODULE ══════
// ─────────────────────────────────────────────
function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(tickCountdowns, COUNTDOWN_TICK_MS);
}

function tickCountdowns() {
    const expired = [];
    activeEvents.forEach(ev => {
        const remaining = new Date(ev.expires_at) - Date.now();
        const label = formatCountdown(ev.expires_at);

        ['admin', 'public'].forEach(role => {
            const el = $(`feed-cd-${role}-${ev.id}`);
            if (el) el.textContent = label;
        });

        const popupEl = $(`popup-cd-${role}-${ev.id}`);
        if (popupEl) popupEl.textContent = label;
        
        const cardCd = $(`card-cd-${ev.id}`);
        if (cardCd) cardCd.textContent = label;

        if (remaining <= 0) expired.push(ev.id);
    });

    if (expired.length > 0) {
        expired.forEach(id => {
            activeEvents = activeEvents.filter(e => e.id !== id);
            ['admin', 'public'].forEach(role => {
                if (eventMarkers[role][id]) {
                    eventMarkers[role][id].remove();
                    delete eventMarkers[role][id];
                }
            });
        });
        renderEventFeeds();
        updateActiveCount();
        showToast(`${expired.length} incident(s) resolved`);
    }
}

// ─────────────────────────────────────────────
// ══════ ADMIN MAP MODULE (TOMTOM) ══════
// ─────────────────────────────────────────────
function initAdminMap() {
    if (adminMap) {
        adminMap.resize();
        return;
    }

    if (!TOMTOM_API_KEY) return;

    adminMap = tt.map({
        key: TOMTOM_API_KEY,
        container: 'admin-map',
        center: DEFAULT_CENTER,
        zoom: 12
    });

    adminMap.addControl(new tt.NavigationControl(), 'top-left');

    adminMap.on('click', e => placeAdminPin(e.lngLat.lat, e.lngLat.lng));

    renderMarkersOnMap('admin', adminMap);

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    $('admin_start_datetime').value = now.toISOString().slice(0, 16);

    $('adminEventForm').addEventListener('submit', handleAdminFormSubmit);
}

function placeAdminPin(lat, lng) {
    if (adminPinMarker) adminPinMarker.remove();
    adminLat = lat;
    adminLng = lng;
    
    const el = document.createElement('div');
    el.className = 'marker-pin-temp';
    el.style.width = '20px'; el.style.height = '20px'; el.style.background = 'white'; el.style.borderRadius = '50%';
    
    adminPinMarker = new tt.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(adminMap);

    const coordEl = $('adminCoordDisplay');
    coordEl.innerHTML = `<span>Lat: ${lat.toFixed(5)}</span><span>Lng: ${lng.toFixed(5)}</span>`;
}

async function handleAdminFormSubmit(e) {
    e.preventDefault();

    if (!adminLat || !adminLng) {
        showToast('📍 Please click on the map to set a location first', 'error');
        return;
    }

    const btn     = $('adminSubmitBtn');
    const btnText = $('adminBtnText');
    const spinner = $('adminBtnSpinner');

    btn.disabled = true;
    btnText.textContent = 'Analyzing…';
    spinner.classList.remove('hidden');

    const payload = {
        event_cause:          $('admin_event_cause').value,
        event_type:           $('admin_event_type').value,
        priority:             $('admin_priority').value,
        requires_road_closure: $('admin_road_closure').checked,
        start_datetime:       $('admin_start_datetime').value.replace('T', ' ') + ':00',
        latitude:             adminLat,
        longitude:            adminLng
    };

    try {
        const res = await fetch('/api/report-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Server error');
        const ev = await res.json();
        
        activeEvents.push(ev);
        renderAllEventMarkers();
        renderEventFeeds();
        updateActiveCount();

        if (adminPinMarker) { adminPinMarker.remove(); adminPinMarker = null; }
        adminLat = null; adminLng = null;
        $('adminCoordDisplay').innerHTML = '<span>Lat: —</span><span>Lng: —</span>';

        showResultModal(ev);
        $('adminEventForm').reset();
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        $('admin_start_datetime').value = now.toISOString().slice(0, 16);

        showToast('✅ Incident reported successfully!');

    } catch (err) {
        showToast(`❌ ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btnText.textContent = '🔍 Analyze & Report';
        spinner.classList.add('hidden');
    }
}

function showResultModal(ev) {
    const recGrid = $('recGrid');
    if (recGrid) {
        recGrid.innerHTML = `
            <div class="rec-item">
                <div class="rec-icon">👮</div>
                <div class="rec-text">
                    <div class="rec-label">Manpower</div>
                    <div class="rec-value" id="recManpower">${ev.recommendations.Manpower}</div>
                </div>
            </div>
            <div class="rec-item">
                <div class="rec-icon">🚧</div>
                <div class="rec-text">
                    <div class="rec-label">Barricading</div>
                    <div class="rec-value" id="recBarricading">${ev.recommendations.Barricading}</div>
                </div>
            </div>
            <div class="rec-item" style="grid-column: 1/-1;">
                <div class="rec-icon">🔀</div>
                <div class="rec-text">
                    <div class="rec-label">Diversion Plan</div>
                    <div class="rec-value" id="recDiversion">${ev.recommendations.DiversionPlan}</div>
                </div>
            </div>
        `;
    }

    $('resultModalCause').textContent = `${causeEmoji(ev.event_cause)} ${causeName(ev.event_cause)}`;
    const chip = $('severityChip');
    chip.textContent = `${ev.severity} Severity`;
    chip.className = `severity-chip chip-${ev.severity}`;
    $('etrChip').textContent = `ETR: ${formatDuration(ev.etr_hours)}`;
    $('resultModalIcon').textContent = ev.severity === 'High' ? '🚨' : ev.severity === 'Medium' ? '⚠️' : '📋';
    
    $('modalFooterAction').innerHTML = `✅ Incident marked on map — expires in <strong>${formatDuration(ev.etr_hours)}</strong>`;
    $('resultModal').classList.remove('hidden');
}

// ─────────────────────────────────────────────
// ══════ PUBLIC MAP MODULE (TOMTOM) ══════
// ─────────────────────────────────────────────
function initPublicMap() {
    if (publicMap) {
        publicMap.resize();
        return;
    }
    if (!TOMTOM_API_KEY) return;

    publicMap = tt.map({
        key: TOMTOM_API_KEY,
        container: 'public-map',
        center: DEFAULT_CENTER,
        zoom: 12
    });
    
    publicMap.addControl(new tt.NavigationControl(), 'top-left');

    publicMap.on('click', e => {
        placePublicPin(e.lngLat.lat, e.lngLat.lng);
    });

    renderMarkersOnMap('public', publicMap);
    setupGeocodeInputs();

    $('locateMeBtn').addEventListener('click', () => {
        if (!navigator.geolocation) { showToast('Geolocation not supported'); return; }
        navigator.geolocation.getCurrentPosition(pos => {
            sourceLatLng = {lat: pos.coords.latitude, lng: pos.coords.longitude};
            $('sourceInput').value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        }, () => showToast('Could not get location', 'error'));
    });

    $('swapBtn').addEventListener('click', () => {
        const tmp = $('sourceInput').value;
        $('sourceInput').value = $('destInput').value;
        $('destInput').value = tmp;
        const tmpLL = sourceLatLng;
        sourceLatLng = destLatLng;
        destLatLng = tmpLL;
    });
    
    // Setup Public Report Form
    $('publicReportForm').addEventListener('submit', handlePublicReportSubmit);
}

function placePublicPin(lat, lng) {
    if (publicPinMarker) publicPinMarker.remove();
    publicLat = lat;
    publicLng = lng;
    
    publicPinMarker = new tt.Marker()
        .setLngLat([lng, lat])
        .addTo(publicMap);

    $('publicCoordDisplay').innerHTML = `<span>Lat: ${lat.toFixed(5)}</span><span>Lng: ${lng.toFixed(5)}</span>`;
    $('publicReportForm').classList.remove('hidden');
}

async function handlePublicReportSubmit(e) {
    e.preventDefault();
    if (!publicLat || !publicLng) return;
    
    const btn = $('publicSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    
    const payload = {
        event_cause: $('public_event_cause').value,
        event_type: 'unplanned',
        priority: 'Low',
        requires_road_closure: false,
        start_datetime: now.toISOString().slice(0, 16).replace('T', ' ') + ':00',
        latitude: publicLat,
        longitude: publicLng
    };

    try {
        const res = await fetch('/api/public-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to submit report');
        
        showToast('✅ Report submitted! Pending Commander approval.');
        $('publicReportForm').reset();
        $('publicReportForm').classList.add('hidden');
        if (publicPinMarker) { publicPinMarker.remove(); publicPinMarker = null; }
        
    } catch (err) {
        showToast('❌ Error submitting report', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Send Report to Commander';
    }
}

// ─────────────────────────────────────────────
// ══════ GEOCODING (TomTom) ══════
// ─────────────────────────────────────────────
function setupGeocodeInputs() {
    setupGeocodeInput('sourceInput', 'sourceSuggestions', ll => { sourceLatLng = ll; });
    setupGeocodeInput('destInput', 'destSuggestions', ll => { destLatLng = ll; });
}

function setupGeocodeInput(inputId, suggestionsId, onSelect) {
    const input = $(inputId);
    const box   = $(suggestionsId);

    input.addEventListener('input', () => {
        clearTimeout(input._timer);
        const q = input.value.trim();
        if (q.length < 3) { box.classList.add('hidden'); return; }
        input._timer = setTimeout(() => geocodeSuggest(q, box, input, onSelect), ROUTE_FETCH_DELAY);
    });

    document.addEventListener('click', e => {
        if (!box.contains(e.target) && e.target !== input) box.classList.add('hidden');
    });
}

async function geocodeSuggest(query, box, input, onSelect) {
    try {
        // TomTom Search API
        const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?key=${TOMTOM_API_KEY}&limit=5`;
        const res = await fetch(url);
        const data = await res.json();
        const results = data.results || [];

        if (!results.length) { box.classList.add('hidden'); return; }

        box.innerHTML = results.map(r => `
          <div class="suggestion-item" data-lat="${r.position.lat}" data-lng="${r.position.lon}">
            ${r.address.freeformAddress}
          </div>`).join('');

        box.classList.remove('hidden');

        const parent = input.closest('.route-input-group') || input.parentElement;
        box.style.top  = (parent.offsetTop + parent.offsetHeight + 4) + 'px';
        box.style.left = parent.offsetLeft + 'px';
        box.style.width = parent.offsetWidth + 'px';
        box.style.position = 'absolute';

        box.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                onSelect({ lat: parseFloat(item.dataset.lat), lng: parseFloat(item.dataset.lng) });
                input.value = item.textContent.trim();
                box.classList.add('hidden');
            });
        });
    } catch (err) {
        box.classList.add('hidden');
    }
}

// ─────────────────────────────────────────────
// ══════ ROUTING MODULE (TOMTOM) ══════
// ─────────────────────────────────────────────
async function planRoute() {
    if (!sourceLatLng || !destLatLng) {
        showToast('📍 Please select both Source and Destination', 'error');
        return;
    }

    showToast('🗺️ Fetching smart routes…');
    $('routeResultsSection').style.display = 'block';
    $('routeCards').innerHTML = '<div class="empty-feed">Calculating routes…</div>';

    try {
        // Build JSON body for avoidAreas
        let avoidAreasBody = null;
        let avoidRectangles = [];
        
        activeEvents.forEach(ev => {
            if (ev.severity === 'High' || ev.severity === 'Medium') {
                const offset = ev.severity === 'High' ? 0.002 : 0.001; 
                avoidRectangles.push({
                    southWestCorner: { latitude: ev.lat - offset, longitude: ev.lng - offset },
                    northEastCorner: { latitude: ev.lat + offset, longitude: ev.lng + offset }
                });
            }
        });

        if (avoidRectangles.length > 0) {
            avoidAreasBody = JSON.stringify({
                avoidAreas: { rectangles: avoidRectangles }
            });
        }

        // TomTom REST API requires latitude,longitude for the URL path
        // while the JSON body and SDK use longitude,latitude strictly.
        const url = `https://api.tomtom.com/routing/1/calculateRoute/${sourceLatLng.lat},${sourceLatLng.lng}:${destLatLng.lat},${destLatLng.lng}/json?key=${TOMTOM_API_KEY}&traffic=true&maxAlternatives=2&computeBestOrder=false&routeRepresentation=polyline&instructionsType=text&alternativeType=anyRoute`;
        
        const fetchOptions = {
            method: avoidAreasBody ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json' }
        };
        
        if (avoidAreasBody) {
            fetchOptions.body = avoidAreasBody;
        }

        const res = await fetch(url, fetchOptions);
        
        if (!res.ok) {
            let errDetails = "No details";
            try {
                const errObj = await res.json();
                errDetails = JSON.stringify(errObj);
            } catch(e) {
                errDetails = await res.text();
            }
            console.error(`🚨 TomTom Routing API Error [Status: ${res.status}]:`, errDetails);
            throw new Error(`Routing failed with status ${res.status}`);
        }

        const data = await res.json();

        if (data.error || !data.routes || data.routes.length === 0) {
            $('routeCards').innerHTML = '<div class="empty-feed">No routes found. Try different locations.</div>';
            return;
        }

        renderRouteCards(data.routes);
        drawRouteOnMap(data.routes, 0);
        highlightRouteCard(0);

    } catch (err) {
        console.error('Routing error:', err);
        $('routeCards').innerHTML = '<div class="empty-feed">Routing failed. Check your connection.</div>';
        showToast('⚠️ Could not calculate routes', 'error');
    }
}

function renderRouteCards(routes) {
    $('routeCards').innerHTML = routes.map((r, rank) => {
        const isFirst   = rank === 0;
        const label     = isFirst ? 'Best Smart Route' : `Alternative ${rank}`;
        const badgeCls  = isFirst ? 'badge-recommended' : 'badge-alternative';
        const badgeTxt  = isFirst ? '✅ Fastest' : `🔵 Alt ${rank}`;

        const durSeconds = r.summary.travelTimeInSeconds;
        const distMeters = r.summary.lengthInMeters;
        const trafficDelay = r.summary.trafficDelayInSeconds || 0;
        const dur    = fmtSeconds(durSeconds);
        const dist   = (distMeters / 1000).toFixed(1) + ' km';
        const delay  = trafficDelay > 60 ? `⚠️ +${fmtSeconds(trafficDelay)} delay` : '✅ No delay';

        return `
          <div class="route-card ${isFirst ? 'route-recommended' : ''}" onclick="drawRouteOnMap(null, ${rank}); highlightRouteCard(${rank})" data-rank="${rank}" style="cursor:pointer;">
            <div class="route-card-header">
              <span class="route-card-label">${label}</span>
              <span class="route-status-badge ${badgeCls}">${badgeTxt}</span>
            </div>
            <div class="route-card-meta">
              <span>🕐 <strong>${dur}</strong></span>
              <span>📏 <strong>${dist}</strong></span>
              <span style="color:${trafficDelay > 60 ? '#f59e0b' : '#10b981'}; font-size:0.72rem;">${delay}</span>
            </div>
          </div>`;
    }).join('');
}

function highlightRouteCard(selectedIdx) {
    document.querySelectorAll('.route-card').forEach((el, i) => {
        el.style.boxShadow = i === selectedIdx ? '0 0 0 2px #6366f1' : '';
        el.style.opacity   = i === selectedIdx ? '1' : '0.6';
    });
}

function drawRouteOnMap(routes, selectedIdx) {
    if (routes) _lastRoutes = routes;
    const rts = _lastRoutes;
    if (!rts || rts.length === 0) return;

    // ── Clear ALL previous route layers/sources ──
    rts.forEach((_, i) => {
        const casId    = `route-layer-${i}-casing`;
        const layerId  = `route-layer-${i}`;
        const sourceId = `route-source-${i}`;
        if (publicMap.getLayer(casId))    publicMap.removeLayer(casId);
        if (publicMap.getLayer(layerId))  publicMap.removeLayer(layerId);
        if (publicMap.getSource(sourceId)) publicMap.removeSource(sourceId);
    });
    if (publicMap.getLayer('route-layer'))  publicMap.removeLayer('route-layer');
    if (publicMap.getSource('route'))        publicMap.removeSource('route');
    currentRouteLayer = null;

    let primaryBounds = null;

    rts.forEach((r, i) => {
        const isSelected = i === selectedIdx;
        const sourceId   = `route-source-${i}`;
        const layerId    = `route-layer-${i}`;
        const casId      = `route-layer-${i}-casing`;

        const coords = r.legs.flatMap(leg => leg.points.map(p => [p.longitude, p.latitude]));

        publicMap.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
        });

        // Casing (thicker underline for readability)
        publicMap.addLayer({
            id: casId,
            type: 'line',
            source: sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': isSelected ? '#1d4ed8' : '#374151',
                'line-width': isSelected ? 11 : 7,
                'line-opacity': isSelected ? 0.5 : 0.3
            }
        });

        // Main line
        publicMap.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': isSelected ? '#0ea5e9' : '#94a3b8',
                'line-width': isSelected ? 7 : 4,
                'line-opacity': isSelected ? 0.97 : 0.6
            }
        });

        // Click handler on BOTH casing and main layer
        const onRouteClick = () => {
            drawRouteOnMap(null, i);
            highlightRouteCard(i);
            // FlyTo source on route switch
            if (sourceLatLng) {
                publicMap.flyTo({ center: [sourceLatLng.lng, sourceLatLng.lat], zoom: 14, pitch: 45, duration: 700 });
            }
        };
        publicMap.on('click', layerId, onRouteClick);
        publicMap.on('click', casId,   onRouteClick);
        publicMap.on('mouseenter', layerId, () => { publicMap.getCanvas().style.cursor = 'pointer'; });
        publicMap.on('mouseleave', layerId, () => { publicMap.getCanvas().style.cursor = ''; });

        if (isSelected) {
            primaryBounds = new tt.LngLatBounds();
            coords.forEach(c => primaryBounds.extend(c));
        }
        currentRouteLayer = layerId;
    });

    // Fit to primary route bounds
    if (primaryBounds) {
        publicMap.fitBounds(primaryBounds, { padding: 50, duration: 500 });
    }

    // FlyTo source location so user sees journey start
    if (sourceLatLng) {
        setTimeout(() => {
            publicMap.flyTo({ center: [sourceLatLng.lng, sourceLatLng.lat], zoom: 14, pitch: 45, duration: 800 });
        }, 600);
    }

    // Sync sidebar card highlights
    highlightRouteCard(selectedIdx);
}

function fmtSeconds(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m/60)}h ${m%60}min`;
}
