(function() {
    'use strict';
    
    // API Configuration - Centralized endpoint management
    function getApiConfig() {
        // Check for global config object
        const config = window.ChatWidgetConfig || {};

        return {
            apiDomain: config.apiDomain || 'http://127.0.0.1:8000',
            apiBasePath: '/api/public/livechat',
            channelId: config.channelId || null,
            skipAllowedDomainsCheck: config.skipAllowedDomainsCheck === true,
            user: config.user || null,          // { external_id?, email?, name? }
            userHash: config.userHash || null,   // string (HMAC from your server)
            disableVisitorTracking: config.disableVisitorTracking === true,
          };
    }
    
    function cwLog() {}
    function cwWarn() {}
    function cwError() {}
    /** Optional host callback for user-visible errors (replaces alert in production). */
    function notifyUser(message) {
        if (window.ChatWidgetConfig && typeof window.ChatWidgetConfig.onNotify === 'function') {
            try {
                window.ChatWidgetConfig.onNotify(String(message || ''));
            } catch (e) {}
        }
    }

    function getKnowledgeBaseUrl() {
        const cfg = getApiConfig();
        // Optional config to support Knowledge Base click / auto-open.
        // Example: window.ChatWidgetConfig.knowledgebaseUrl = "https://help.yoursite.com"
        const url = cfg && cfg.knowledgebaseUrl ? String(cfg.knowledgebaseUrl).trim() : '';
        return url || null;
    }
    
    // Get API base URL (with domain)
    function getApiBaseUrl() {
        const config = getApiConfig();
        return config.apiDomain + config.apiBasePath;
    }
    
    // Get channel-specific API URL
    function getChannelApiUrl() {
        const config = getApiConfig();
        const channelId = config.channelId || getChannelId();
        return `${config.apiDomain}${config.apiBasePath}/${channelId}`;
    }
    
    // Get messages API URL (no channel ID)
    function getMessagesApiUrl(visitorId, opts) {
        opts = opts || {};
        const config = getApiConfig();
        const u = new URL(`${config.apiDomain}${config.apiBasePath}/message`);
        if (visitorId) u.searchParams.set('visitor_id', String(visitorId));
        if (opts.agentMetaOnly) {
            u.searchParams.set('agent_meta_only', '1');
        } else {
            u.searchParams.set('all', '1');
        }
        return u.toString();
    }

    /** Visitor-scoped livechat URL (e.g. message/edit, message/delete). */
    function getLivechatVisitorApiUrl(path, visitorId) {
        var config = getApiConfig();
        var u = new URL(config.apiDomain + config.apiBasePath + '/' + String(path || '').replace(/^\//, ''));
        if (visitorId) u.searchParams.set('visitor_id', String(visitorId));
        return u.toString();
    }
    
    // Get upload API URL
    function getUploadApiUrl(visitorId) {
        const config = getApiConfig();
        const channelId = config.channelId || getChannelId();
        return `${config.apiDomain}${config.apiBasePath}/${channelId}/upload?visitor_id=${visitorId}`;
    }

    function getVisitorPresenceApiUrl() {
        const config = getApiConfig();
        return `${config.apiDomain}${config.apiBasePath}/visitor-presence`;
    }

    function getVisitorTypingApiUrl() {
        const config = getApiConfig();
        return `${config.apiDomain}${config.apiBasePath}/message/typing`;
    }
    
    // Get channel ID from configuration
    function getChannelId() {
        // Check for global config object
        if (window.ChatWidgetConfig && window.ChatWidgetConfig.channelId) {
            return window.ChatWidgetConfig.channelId;
        }
        
        // Check for data attribute on script tag
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            if (script.src && script.src.includes('chat-widget.js')) {
                const channelId = script.getAttribute('data-channel-id');
                if (channelId) return channelId;
            }
            // Also check inline script with data attribute
            if (script.hasAttribute('data-channel-id')) {
                return script.getAttribute('data-channel-id');
            }
        }
        
        // Default fallback (can be removed if required)
        cwWarn('ChatWidget: No channel ID provided. Set ChatWidgetConfig.channelId or data-channel-id on the script tag.');
        return '1';
    }

    function getSecureUserQueryString() {
        const cfg = getApiConfig();
        const u = cfg.user || {};
        const userHash = cfg.userHash ? String(cfg.userHash).trim() : '';
      
        const externalId = (u.external_id || u.externalId || '').toString().trim();
        const email = (u.email || '').toString().trim();
        const name = (u.name || '').toString().trim();
      
        // Only send identity if a hash is provided (prevents spoofing)
        if (!userHash) return '';
      
        // Require at least one identifier
        if (!externalId && !email) return '';
      
        const qp = new URLSearchParams();
        if (externalId) qp.set('external_id', externalId);
        if (email) qp.set('email', email);
        if (name) qp.set('name', name);
        qp.set('user_hash', userHash);
      
        return '&' + qp.toString();
    }
    
    
    // Storage keys:
    // - include channel ID to avoid conflicts
    // - include an identity scope so logged-in users and guests never share state
    function getIdentityScopeKey() {
        const cfg = getApiConfig();
        const u = cfg.user || {};
        const userHash = cfg.userHash ? String(cfg.userHash).trim() : '';
        const externalId = (u.external_id || u.externalId || '').toString().trim();
        const email = (u.email || '').toString().trim().toLowerCase();

        // Only treat as an authenticated scope when we have a verified signature available.
        if (userHash && (externalId || email)) {
            const identifier = externalId || email;
            // Keep keys short-ish and safe in localStorage.
            return 'auth_' + encodeURIComponent(identifier);
        }

        return 'guest';
    }

    function getStorageKey(key) {
        const channelId = getChannelId();
        const scope = getIdentityScopeKey();
        return `chat_widget_${channelId}_${scope}_${key}`;
    }
    
    const STORAGE_VISITOR_ID_KEY = 'visitor_id';
    const STORAGE_SESSION_TOKEN_KEY = 'session_token';
    const STORAGE_SESSION_KEY = 'session_key';
    const STORAGE_WIDGET_SETTINGS_KEY = 'widget_settings_cache';
    const STORAGE_UNREAD_COUNT_KEY = 'unread_count';

    
    function getUnreadCount() {
        try {
            const raw = localStorage.getItem(getStorageKey(STORAGE_UNREAD_COUNT_KEY));
            const n = raw ? parseInt(raw, 10) : 0;
            return Number.isFinite(n) && n > 0 ? n : 0;
        } catch (e) {
            return 0;
        }
    }
    
    function setUnreadCount(n) {
        const v = Math.max(0, parseInt(String(n || 0), 10) || 0);
        try {
            localStorage.setItem(getStorageKey(STORAGE_UNREAD_COUNT_KEY), String(v));
        } catch (e) {}
        updateUnreadBadge(v);
    }
    
    function incrementUnreadCount(by) {
        const inc = Math.max(1, parseInt(String(by || 1), 10) || 1);
        setUnreadCount(getUnreadCount() + inc);
    }
    
    function clearUnreadCount() {
        setUnreadCount(0);
    }
    
    function updateUnreadBadge(count) {
        const badge = document.getElementById('chatWidgetUnreadBadge');
        if (!badge) return;
        const c = Math.max(0, parseInt(String(count || 0), 10) || 0);
        if (c <= 0) {
            badge.style.display = 'none';
            badge.textContent = '';
            badge.setAttribute('aria-hidden', 'true');
            return;
        }
        badge.style.display = 'flex';
        badge.textContent = c > 99 ? '99+' : String(c);
        badge.setAttribute('aria-hidden', 'false');
        badge.setAttribute('aria-label', `${c} unread message${c === 1 ? '' : 's'}`);
    }
    
    function isWidgetOpen() {
        const w = document.getElementById('chatWidget');
        return !!(w && !w.classList.contains('hidden'));
    }
    
    function isViewingMessages() {
        if (!isWidgetOpen()) return false;
        if (widgetState.currentScreen !== 'messages') return false;
        const mc = document.getElementById('messagesContainer');
        return !!(mc && mc.style.display !== 'none' && !mc.classList.contains('hidden'));
    }
    
    let audioCtx = null;
    function playNotificationSound() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') {
                // Will only resume after a user gesture in most browsers.
                audioCtx.resume().catch(function() {});
            }
            const now = audioCtx.currentTime;
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(880, now);
            o.frequency.exponentialRampToValueAtTime(660, now + 0.08);
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
            o.connect(g);
            g.connect(audioCtx.destination);
            o.start(now);
            o.stop(now + 0.16);
        } catch (e) {}
    }
    
    let widgetAutoOpenTimerId = null;
    
    // State management - cache messages and form state
    let widgetState = {
        messages: null,
        conversationNumber: null,
        formRequired: null,
        widgetSettings: null,
        currentScreen: null,
        messagesLoaded: false,
        attachments: {}, // Store uploaded attachments: { fileId: path }
        assignedAgent: null,
        assignedAgentPresence: null,
        selectedMessageId: null,
        pendingInReplyOf: null,
        editingMessageNumber: null
    };
    
    // Reset state on page load (for fresh load)
    function resetWidgetState() {
        widgetState = {
            messages: null,
            conversationNumber: null,
            formRequired: null,
            widgetSettings: null,
            currentScreen: null,
            messagesLoaded: false,
            attachments: {},
            assignedAgent: null,
            assignedAgentPresence: null,
            selectedMessageId: null,
            pendingInReplyOf: null,
            editingMessageNumber: null
        };
    }
    
    // Initialize state reset on page load
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', resetWidgetState);
    }
    
    // Generate UUID v4
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    // Get or generate visitor ID
    function getVisitorId() {
        const storageKey = getStorageKey(STORAGE_VISITOR_ID_KEY);
        let visitorId = localStorage.getItem(storageKey);
        if (!visitorId) {
            visitorId = generateUUID();
            localStorage.setItem(storageKey, visitorId);
        }
        return visitorId;
    }
    
    // Get session token from storage
    function getSessionToken() {
        const storageKey = getStorageKey(STORAGE_SESSION_TOKEN_KEY);
        return localStorage.getItem(storageKey);
    }
    
    // Save session token to storage
    function saveSessionToken(token) {
        const storageKey = getStorageKey(STORAGE_SESSION_TOKEN_KEY);
        localStorage.setItem(storageKey, token);
    }
    
    // Get session key from storage
    function getSessionKey() {
        const storageKey = getStorageKey(STORAGE_SESSION_KEY);
        return localStorage.getItem(storageKey);
    }
    
    // Save session key to storage
    function saveSessionKey(sessionKey) {
        const storageKey = getStorageKey(STORAGE_SESSION_KEY);
        localStorage.setItem(storageKey, sessionKey);
    }
    
    /** Private WebSocket subscription (Sanctum token + server-side channel auth). Config comes from API (`broadcasting` on init / widget-settings), not embed. */
    const STORAGE_LC_PRESENCE_TABS_KEY = 'lc_presence_tabs';

    let livechatPresenceTabId = null;

    function ensureLivechatPresenceTabId() {
        if (!livechatPresenceTabId) {
            livechatPresenceTabId = 't' + String(Date.now()) + '_' + Math.random().toString(36).slice(2, 10);
        }
        return livechatPresenceTabId;
    }

    function touchLivechatPresenceTabRegistry() {
        if (getApiConfig().disableVisitorTracking === true) return;
        var tabId = ensureLivechatPresenceTabId();
        try {
            var key = getStorageKey(STORAGE_LC_PRESENCE_TABS_KEY);
            var raw = localStorage.getItem(key);
            var map = raw ? JSON.parse(raw) : {};
            if (!map || typeof map !== 'object') map = {};
            var now = Date.now();
            Object.keys(map).forEach(function(k) {
                if (now - map[k] > 30000) delete map[k];
            });
            map[tabId] = now;
            localStorage.setItem(key, JSON.stringify(map));
        } catch (e) {}
    }

    function removeLivechatPresenceTabRegistryEntry() {
        if (!livechatPresenceTabId) return;
        try {
            var key = getStorageKey(STORAGE_LC_PRESENCE_TABS_KEY);
            var raw = localStorage.getItem(key);
            var map = raw ? JSON.parse(raw) : {};
            if (!map || typeof map !== 'object') map = {};
            delete map[livechatPresenceTabId];
            if (Object.keys(map).length === 0) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, JSON.stringify(map));
            }
        } catch (e) {}
    }

    function pruneStaleLivechatPresenceTabRegistry() {
        try {
            var key = getStorageKey(STORAGE_LC_PRESENCE_TABS_KEY);
            var raw = localStorage.getItem(key);
            var map = raw ? JSON.parse(raw) : {};
            if (!map || typeof map !== 'object') return;
            var now = Date.now();
            var changed = false;
            Object.keys(map).forEach(function(k) {
                if (now - map[k] > 30000) {
                    delete map[k];
                    changed = true;
                }
            });
            if (changed) {
                if (Object.keys(map).length === 0) {
                    localStorage.removeItem(key);
                } else {
                    localStorage.setItem(key, JSON.stringify(map));
                }
            }
        } catch (e) {}
    }

    function countFreshLivechatPresenceTabs() {
        try {
            var key = getStorageKey(STORAGE_LC_PRESENCE_TABS_KEY);
            var raw = localStorage.getItem(key);
            var map = raw ? JSON.parse(raw) : {};
            if (!map || typeof map !== 'object') return 0;
            var now = Date.now();
            var n = 0;
            Object.keys(map).forEach(function(k) {
                if (now - map[k] <= 25000) n++;
            });
            return n;
        } catch (e) {
            return 0;
        }
    }

    /**
     * When the tab goes away, unregister from the cross-tab map and only POST offline when no other
     * tab is still heartbeating the same widget session (avoids one tab's blur closing killing presence for all).
     */
    function runLivechatClosingPresenceCleanup() {
        var cfg = getApiConfig();
        if (cfg.disableVisitorTracking === true) {
            flushVisitorOfflineKeepalive();
            return;
        }
        removeLivechatPresenceTabRegistryEntry();
        pruneStaleLivechatPresenceTabRegistry();
        if (getSessionToken() && countFreshLivechatPresenceTabs() === 0) {
            flushVisitorOfflineKeepalive();
        }
    }

    let broadcastingConfigCache = null;
    let realtimePusher = null;
    let realtimePusherKey = null;
    let realtimeSubscribedConv = null;
    let pusherScriptPromise = null;
    let realtimeWatchdogId = null;
    let realtimeVisibilityBound = false;
    let visitorTrackingListenersBound = false;
    let visitorTrackingHeartbeatId = null;
    let visitorTrackingHrefPollId = null;
    let visitorTrackingLastHref = '';

    function isRealtimeConnectionHealthy() {
        if (!realtimePusher || !realtimePusher.connection) return false;
        var s = realtimePusher.connection.state;
        return s === 'connected' || s === 'connecting' || s === 'initialized';
    }
    
    function applyBroadcastingFromPayload(data) {
        if (data && data.broadcasting && typeof data.broadcasting === 'object' && data.broadcasting.driver) {
            broadcastingConfigCache = data.broadcasting;
        }
    }
    
    async function ensureBroadcastingConfig() {
        if (broadcastingConfigCache && broadcastingConfigCache.driver) {
            return;
        }
        try {
            var channelApiUrl = getChannelApiUrl();
            var url = channelApiUrl + '/widget-settings';
            var response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) {
                return;
            }
            var data = await response.json();
            applyBroadcastingFromPayload(data);
        } catch (e) {
            cwWarn('ChatWidget: could not load broadcasting config', e);
        }
    }
    
    function loadPusherScript() {
        if (typeof window.Pusher !== 'undefined') {
            return Promise.resolve();
        }
        if (pusherScriptPromise) {
            return pusherScriptPromise;
        }
        pusherScriptPromise = new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/pusher-js@8.4.0/dist/web/pusher.min.js';
            s.async = true;
            s.onload = function() { resolve(); };
            s.onerror = function() { reject(new Error('Failed to load Pusher')); };
            document.head.appendChild(s);
        });
        return pusherScriptPromise;
    }
    
    function buildPusherConstructorOptions(token) {
        var bc = broadcastingConfigCache;
        var cfg = getApiConfig();
        var apiDomain = String(cfg.apiDomain || '').replace(/\/$/, '');
        var authEndpoint = apiDomain + '/api/broadcasting/auth';
        var base = {
            authEndpoint: authEndpoint,
            auth: {
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Accept': 'application/json'
                }
            },
            disableStats: true
        };
        if (!bc || !bc.driver || !bc.key) {
            return null;
        }
        if (bc.driver === 'pusher' && bc.cluster) {
            return {
                key: bc.key,
                opts: Object.assign({}, base, {
                    cluster: bc.cluster,
                    forceTLS: true
                })
            };
        }
        if (bc.driver === 'reverb') {
            var useTls = (bc.scheme || 'http') === 'https';
            var port = parseInt(bc.ws_port || '8080', 10);
            return {
                key: bc.key,
                opts: Object.assign({}, base, {
                    wsHost: bc.ws_host || '127.0.0.1',
                    wsPort: port,
                    wssPort: port,
                    forceTLS: useTls,
                    enabledTransports: ['ws', 'wss'],
                    cluster: 'mt1'
                })
            };
        }
        return null;
    }
    
    function disconnectLiveChatRealtime() {
        stopAgentMetaPolling();
        if (realtimePusher && realtimeSubscribedConv) {
            try {
                realtimePusher.unsubscribe('private-conversation.' + realtimeSubscribedConv);
            } catch (e) {}
        }
        realtimeSubscribedConv = null;
    }
    
    /**
     * Subscribe to private-conversation.{number} after visitor has a valid Sanctum token.
     * Server authorizes only this visitor or an agent assigned to the channel.
     */
    async function syncLiveChatRealtimeSubscription() {
        var conv = widgetState.conversationNumber;
        if (!conv) {
            disconnectLiveChatRealtime();
            return;
        }
        try {
            var session = await initializeChatSession(false);
            if (!session || !session.token) {
                return;
            }
            if (realtimeSubscribedConv === conv && realtimePusher && isRealtimeConnectionHealthy()) {
                return;
            }
            await ensureBroadcastingConfig();
            disconnectLiveChatRealtime();
            await loadPusherScript();
            if (typeof window.Pusher === 'undefined') {
                return;
            }
            var built = buildPusherConstructorOptions(session.token);
            if (!built || !built.key) {
                return;
            }
            if (!realtimePusher || realtimePusherKey !== built.key || !isRealtimeConnectionHealthy()) {
                if (realtimePusher) {
                    try { realtimePusher.disconnect(); } catch (e2) {}
                }
                realtimePusher = new window.Pusher(built.key, built.opts);
                realtimePusherKey = built.key;
                if (realtimePusher.connection && typeof realtimePusher.connection.bind === 'function') {
                    realtimePusher.connection.bind('state_change', function(states) {
                        if (!states) return;
                        if (states.current === 'disconnected' || states.current === 'failed' || states.current === 'unavailable') {
                            realtimeSubscribedConv = null;
                        }
                    });
                    realtimePusher.connection.bind('connected', function() {
                        if (widgetState.conversationNumber) {
                            void syncLiveChatRealtimeSubscription();
                        }
                    });
                }
            } else if (realtimePusher.config && realtimePusher.config.auth && realtimePusher.config.auth.headers) {
                realtimePusher.config.auth.headers.Authorization = 'Bearer ' + session.token;
            }
            var channelName = 'private-conversation.' + conv;
            var ch = realtimePusher.subscribe(channelName);
            realtimeSubscribedConv = conv;
            ch.unbind('message-received');
            ch.unbind('message-status-updated');
            ch.unbind('message-read-status-updated');
            ch.unbind('conversation-typing');
            ch.unbind('conversation-assignment-updated');
            ch.bind('message-received', function(data) {
                if (!data || String(data.conversation_number) !== String(conv)) {
                    return;
                }
                fetchMessages().then(function(messagesData) {
                    applyRealtimeMessageListUpdate(messagesData, conv);
                }).catch(function() {});
            });
            ch.bind('message-status-updated', function(data) {
                if (!data || String(data.conversation_number) !== String(conv)) {
                    return;
                }
                applyMessageStatusFromRealtime(data);
            });
            ch.bind('message-read-status-updated', function(data) {
                if (!data || String(data.conversation_number) !== String(conv)) {
                    return;
                }
                applyMessageStatusFromRealtime(data);
            });
            ch.bind('conversation-typing', function(data) {
                applyConversationTypingFromRealtime(data);
            });
            ch.bind('conversation-assignment-updated', function(data) {
                if (!data || String(data.conversation_number) !== String(conv)) {
                    return;
                }
                void fetchAgentMetaOnce();
                fetchMessages().then(function(messagesData) {
                    applyRealtimeMessageListUpdate(messagesData, conv);
                }).catch(function() {});
            });
            startRealtimeWatchdog();
            bindRealtimeVisibilityHandler();
        } catch (err) {
            cwError('Live chat realtime:', err);
        }
    }

    function startRealtimeWatchdog() {
        if (realtimeWatchdogId) return;
        realtimeWatchdogId = setInterval(function() {
            if (!widgetState.conversationNumber) return;
            if (realtimeSubscribedConv === widgetState.conversationNumber && isRealtimeConnectionHealthy()) {
                return;
            }
            void syncLiveChatRealtimeSubscription();
        }, 30000);
    }

    function bindRealtimeVisibilityHandler() {
        if (realtimeVisibilityBound) return;
        realtimeVisibilityBound = true;
        var onWake = function() {
            if (document.visibilityState && document.visibilityState !== 'visible') return;
            void syncLiveChatRealtimeSubscription();
            void pollUnreadOnce();
        };
        document.addEventListener('visibilitychange', onWake);
        window.addEventListener('focus', onWake);
        window.addEventListener('online', onWake);
    }

    function getPageContextForVisitorTracking() {
        try {
            return {
                page_url: String(window.location.href || '').slice(0, 2048),
                page_title: String(document.title || '').slice(0, 512)
            };
        } catch (e) {
            return { page_url: '', page_title: '' };
        }
    }

    async function postVisitorPresence(presence) {
        const cfg = getApiConfig();
        if (cfg.disableVisitorTracking === true) return;

        var token = getSessionToken();
        if (!token) return;

        var ctx = getPageContextForVisitorTracking();
        var online = presence === 'online';
        var body = {
            presence: online ? 'online' : 'offline',
            page_url: ctx.page_url,
            page_title: ctx.page_title
        };

        try {
            await fetch(getVisitorPresenceApiUrl(), {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(body),
                keepalive: !online
            });
        } catch (e) {}
    }

    function flushVisitorOfflineKeepalive() {
        const cfg = getApiConfig();
        if (cfg.disableVisitorTracking === true) return;

        var token = getSessionToken();
        if (!token) return;

        var ctx = getPageContextForVisitorTracking();
        var body = JSON.stringify({
            presence: 'offline',
            page_url: ctx.page_url,
            page_title: ctx.page_title
        });

        try {
            fetch(getVisitorPresenceApiUrl(), {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: body,
                keepalive: true
            });
        } catch (e) {}
    }

    function startVisitorPageAndPresenceTracking() {
        const cfg = getApiConfig();
        if (cfg.disableVisitorTracking === true) return;
        if (!getSessionToken()) return;

        function onVisibilityChange() {
            if (document.visibilityState === 'visible') {
                touchLivechatPresenceTabRegistry();
                void postVisitorPresence('online');
            }
            // Do not POST offline on blur: other tabs may still hold the same session; mobile OS also
            // background tabs without a true "leave". Last-tab offlines use pagehide/beforeunload.
        }

        function pingIfVisible() {
            if (document.visibilityState === 'visible') {
                touchLivechatPresenceTabRegistry();
                void postVisitorPresence('online');
            }
        }

        if (!visitorTrackingListenersBound) {
            visitorTrackingListenersBound = true;

            visitorTrackingHeartbeatId = setInterval(pingIfVisible, 30000);
            visitorTrackingLastHref = window.location.href;
            visitorTrackingHrefPollId = setInterval(function() {
                if (document.visibilityState !== 'visible') return;
                try {
                    if (window.location.href !== visitorTrackingLastHref) {
                        visitorTrackingLastHref = window.location.href;
                        touchLivechatPresenceTabRegistry();
                        void postVisitorPresence('online');
                    }
                } catch (e) {}
            }, 5000);

            document.addEventListener('visibilitychange', onVisibilityChange);
            window.addEventListener('pageshow', function(ev) {
                if (ev.persisted) {
                    touchLivechatPresenceTabRegistry();
                    void postVisitorPresence('online');
                }
            });
            window.addEventListener('hashchange', pingIfVisible);
            window.addEventListener('popstate', pingIfVisible);
            window.addEventListener('pagehide', function (ev) {
                runLivechatClosingPresenceCleanup();
                // Close this tab's Pusher session when the tab actually goes away (not bfcache restore).
                if (!ev || !ev.persisted) {
                    disconnectLiveChatRealtime();
                }
            });
            window.addEventListener('beforeunload', function () {
                runLivechatClosingPresenceCleanup();
                disconnectLiveChatRealtime();
            });

            // One-time presence sync for this tab (heartbeat + visibility handlers cover updates).
            onVisibilityChange();
        }
    }
    
    // Initialize chat session: uses cached token from localStorage when present.
    // Only calls GET .../init when there is no token (or when forceInit is true, e.g. after 401).
    async function initializeChatSession(forceInit = false) {
        const visitorId = getVisitorId();
        const existingToken = getSessionToken();

        function hasSecureIdentityReady() {
            // If this returns non-empty, we have {external_id/email + user_hash} ready to send.
            return getSecureUserQueryString() !== '';
        }

        function getSecureUpgradeDoneKey() {
            return getStorageKey('secure_upgrade_done');
        }

        function isSecureUpgradeDone() {
            try {
                return localStorage.getItem(getSecureUpgradeDoneKey()) === 'yes';
            } catch (e) {
                return false;
            }
        }

        function markSecureUpgradeDone() {
            try {
                localStorage.setItem(getSecureUpgradeDoneKey(), 'yes');
            } catch (e) {}
        }


        function clearSecureUpgradeDone() {
            try {
                localStorage.removeItem(getSecureUpgradeDoneKey());
            } catch (e) {}
        }
        
        // If token exists and we're not forcing init, return existing token (no API call).
        // Backend handles token expiration on API calls; upload retry uses forceInit to refresh.
        // Secure Mode upgrade:
        // If we already have a guest token but secure identity becomes available later (config loaded async),
        // force a one-time init to upgrade the session and load authorized history.
        if (existingToken && !forceInit) {
            if (hasSecureIdentityReady() && !isSecureUpgradeDone()) {
                return await initializeChatSession(true);
            }
            return {
                token: existingToken,
                visitor_id: visitorId
            };
        }
        
        // Call init endpoint to get/refresh token
        try {
            const channelApiUrl = getChannelApiUrl();

            const initUrlWithIdentity = `${channelApiUrl}/init?visitor_id=${visitorId}${getSecureUserQueryString()}`;
            const initUrlGuestOnly = `${channelApiUrl}/init?visitor_id=${visitorId}`;

            let response = await fetch(initUrlWithIdentity, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            // Secure-mode fallback:
            // If the host provided identity but the hash is missing/invalid, backend returns 403.
            // In that case, re-init as guest (visitor_id only).
            if (response.status === 403) {
                try {
                    response = await fetch(initUrlGuestOnly, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (e) {}
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Save token and session_key to localStorage
            if (data.token) {
                saveSessionToken(data.token);
            }
            if (data.session_key) {
                saveSessionKey(data.session_key);
            }
            applyBroadcastingFromPayload(data);
            syncAssignedAgentFromPayload(data);

            // Mark secure upgrade as done only when backend actually verified identity.
            // If init fell back to guest (e.g. temporary hash mismatch / stale config), keep retrying.
            if (hasSecureIdentityReady()) {
                if (data && data.secure_verified === true) {
                    markSecureUpgradeDone();
                } else {
                    clearSecureUpgradeDone();
                }
            }

            return {
                token: data.token,
                visitor_id: data.visitor_id || visitorId,
                session_key: data.session_key,
                expires_at: data.expires_at,
                new_token: data.new_token,
                has_existing_conversation: data.has_existing_conversation,
                conversation_number: data.conversation_number,
                contact_id: data.contact_id,
                is_new_visitor: data.is_new_visitor,
                secure_verified: data.secure_verified === true,
                verified_email: data.verified_email || null,
                verified_external_id: data.verified_external_id || null,
                assigned_agent: data.assigned_agent || null,
                assigned_agent_presence: data.assigned_agent_presence || null
            };
        } catch (error) {
            cwError('Error initializing chat session:', error);
            // Return existing token if available, otherwise return null
            if (existingToken) {
                return {
                    token: existingToken,
                    visitor_id: visitorId
                };
            }
            return null;
        }
    }
    
    // Check if Tailwind is loaded, if not, load it
    function loadTailwindAndInit() {
        if (typeof tailwind !== 'undefined') {
            if (tailwind.config) {
                tailwind.config = {
                    theme: {
                        extend: {
                            colors: {
                                'primary': '#f44d1b',
                                'secondary': '#d61212',
                                'background': '#e55023',
                                'text': '#1a1a1a',
                                'border': '#f0f0f0',
                                'input-bg': '#f8f8f8',
                            }
                        }
                    }
                };
            }
            waitForChatWidgetConfigThenInit();
        } else {
            const tailwindScript = document.createElement('script');
            tailwindScript.src = 'https://cdn.tailwindcss.com';
            document.head.appendChild(tailwindScript);
            tailwindScript.onload = function() {
                // Wait a bit for tailwind to be fully initialized
                setTimeout(function() {
                    if (typeof tailwind !== 'undefined' && tailwind.config) {
                        tailwind.config = {
                            theme: {
                                extend: {
                                    colors: {
                                        'primary': '#f44d1b',
                                        'secondary': '#d61212',
                                        'background': '#e55023',
                                        'text': '#1a1a1a',
                                        'border': '#f0f0f0',
                                        'input-bg': '#f8f8f8',
                                    }
                                }
                            }
                        };
                    }
                    waitForChatWidgetConfigThenInit();
                }, 100);
            };
        }
    }

    function waitForChatWidgetConfigThenInit() {
        // In some embeds, the config script can be delayed (network/async attributes).
        // If we init before config arrives, we cache a guest token and never send secure identity.
        var start = Date.now();
        var maxWaitMs = 2000;

        (function tick() {
            var cfg = window.ChatWidgetConfig || null;
            // If config exists (even without userHash), proceed.
            if (cfg) {
                initWidget();
                return;
            }
            if (Date.now() - start >= maxWaitMs) {
                // Proceed anyway (guest mode) if config never arrives.
                initWidget();
                return;
            }
            setTimeout(tick, 25);
        })();
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadTailwindAndInit);
    } else {
        loadTailwindAndInit();
    }

    function initWidget() {
        injectStyles();
        createWidget();
        initializeWidget();
        void loadWidgetSettingsOnBoot();
        // Ensure unread badge updates even if the widget is never opened.
        // This fixes "messages only appear after refresh" when the widget stays closed.
        void initializeChatSession(false)
            .then(function (session) {
                if (session && session.token) {
                    queueMicrotask(function () {
                        startVisitorPageAndPresenceTracking();
                    });
                }
            })
            .catch(function () {});
        startUnreadPolling(5000);
        // Bring the WebSocket up at boot so inbound messages push in real time
        // regardless of whether the widget is opened in this session, and re-bind
        // it whenever the tab regains focus / network comes back online.
        bindRealtimeVisibilityHandler();
        void syncLiveChatRealtimeSubscription();
    }
    
    function injectStyles() {
        const styleId = 'chat-widget-styles';
        if (document.getElementById(styleId)) return;
        
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            :root {
                --primary-color: #f44d1b;
                --secondary-color: #d61212;
                --background-color: #e55023;
                --text-color: #1a1a1a;
                --border-color: #f0f0f0;
                --input-bg: #f8f8f8;
                --secondary-color-20: color-mix(in srgb, var(--secondary-color) 10%, transparent);
                /* Preline-style neutrals (bubbles / chrome; brand vars still used for home gradient etc.) */
                --cw-navy: #0f172a;
                --cw-slate-600: #475569;
                --cw-slate-500: #64748b;
                --cw-slate-200: #e2e8f0;
                --cw-thread-bg: #f9fafb;
                --cw-bubble: #f3f4f6;
                --cw-bubble-text: #0f172a;
            }
            
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes spin {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(360deg);
                }
            }

            @keyframes lcTypingDot {
                0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
                40% { opacity: 1; transform: translateY(-2px); }
            }

            .lc-typing-dots {
                display: inline-flex;
                gap: 3px;
                margin-left: 6px;
                vertical-align: middle;
            }
            .lc-typing-dots b {
                display: inline-block;
                width: 4px;
                height: 4px;
                border-radius: 9999px;
                background: var(--text-color);
                animation: lcTypingDot 1.15s ease-in-out infinite;
            }
            .lc-typing-dots b:nth-child(2) { animation-delay: 0.18s; }
            .lc-typing-dots b:nth-child(3) { animation-delay: 0.36s; }
            
            .animate-spin {
                animation: spin 1s linear infinite;
            }
            
            .animate-slide-up {
                animation: slideUp 0.3s ease;
            }
            
            .animate-fade-in {
                animation: fadeIn 0.3s ease;
            }
            
            .chat-widget-messages::-webkit-scrollbar {
                width: 6px;
            }
            
            .chat-widget-messages::-webkit-scrollbar-track {
                background: transparent;
            }
            
            .chat-widget-messages::-webkit-scrollbar-thumb {
                background: var(--border-color);
                border-radius: 3px;
            }
            
            .chat-widget-container[data-background="yes"] .chat-widget-window {
                background: linear-gradient(to top, var(--secondary-color-20) 0%, transparent 100%);
            }
            
            .chat-widget-container[data-background="no"] .chat-widget-window {
                background: white;
            }

            #chatWidget.cw-preline {
                border-radius: 1rem;
                box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.18);
                border: 1px solid var(--cw-slate-200);
            }

            #assignedAgentBar {
                display: none !important;
            }

            .cw-msg-header {
                padding: 0.75rem 0.75rem;
                background: #fff;
                border-bottom: 1px solid var(--cw-slate-200);
                flex-shrink: 0;
                min-height: 3rem;
            }
            /* Messages header: row layout + icon color (do not rely on Tailwind alone). */
            #mainHeader:not(.hide-on-home) {
                display: flex !important;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
            }
            #mainHeader:not(.hide-on-home) > div:first-child {
                display: flex !important;
                flex-direction: row;
                align-items: center;
                gap: 0.5rem;
                flex: 1 1 auto;
                min-width: 0;
            }
            #mainHeader:not(.hide-on-home) button {
                color: #475569;
                flex-shrink: 0;
            }
            #mainHeader:not(.hide-on-home) button svg {
                display: block;
                flex-shrink: 0;
            }
            #mainHeader:not(.hide-on-home) button svg path {
                stroke: #475569 !important;
                fill: none !important;
                stroke-width: 2px;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            .cw-msg-header .cw-header-avatar-wrap {
                position: relative;
                flex-shrink: 0;
                width: 2.25rem;
                height: 2.25rem;
            }
            .cw-msg-header .cw-header-avatar-wrap img {
                width: 2.25rem;
                height: 2.25rem;
                border-radius: 9999px;
                object-fit: cover;
                border: 2px solid #fff;
                box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.06);
            }
            .cw-online-dot {
                position: absolute;
                right: 0;
                bottom: 0;
                width: 0.55rem;
                height: 0.55rem;
                border-radius: 9999px;
                background: #22c55e;
                border: 2px solid #fff;
            }
            .cw-online-dot.cw-away {
                background: #94a3b8;
            }
            .cw-header-avatar-placeholder {
                position: absolute;
                inset: 0;
                border-radius: 9999px;
                background: #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid #fff;
                box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.06);
            }
            .cw-header-avatar-placeholder svg {
                width: 1.1rem;
                height: 1.1rem;
                opacity: 0.45;
            }
            /* Selection: highlight the bubble only (not the full row / avatar). */
            .cw-msg-wrap.cw-msg-selected {
                box-shadow: none;
            }
            .cw-msg-wrap.cw-msg-selected .cw-bubble-in,
            .cw-msg-wrap.cw-msg-selected .cw-bubble-out {
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.42);
            }

            /* Messages column when active (visibility/display enforced on #cwScreenStage > .chat-widget-screen) */
            #chatWidget .cw-screen-stage > #messagesScreen.chat-widget-screen.active {
                min-height: 0;
            }
            .cw-msg-thread-wrap {
                flex: 1;
                min-height: 0;
                display: flex;
                flex-direction: column;
                background: var(--cw-thread-bg);
                overflow: hidden;
            }
            .chat-widget-messages.cw-msg-thread {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                gap: 0.75rem;
                padding: 0.75rem 0.75rem 1rem;
            }

            .cw-input-footer {
                background: #fff;
                border-top: 1px solid var(--cw-slate-200);
                padding: 0.65rem 0.75rem 0.75rem;
            }
            .cw-input-footer .chat-widget-input-wrapper {
                border-radius: 0.875rem;
                border-color: var(--cw-slate-200) !important;
                background: #fff;
            }
            .cw-input-footer .chat-widget-input-wrapper.focused {
                border-color: rgba(15, 23, 42, 0.22) !important;
                box-shadow: none;
            }
            #chatWidget #chatInput:focus,
            #chatWidget #chatInput:focus-visible {
                outline: none !important;
                box-shadow: none !important;
            }

            /* Composer toolbar: flex row + icon strokes without Tailwind. */
            #chatWidget #inputWrapper {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }
            #chatWidget #inputWrapper > div:last-child {
                display: flex !important;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                gap: 0.5rem;
                flex-wrap: nowrap;
            }
            #chatWidget #inputWrapper > div:last-child > div {
                display: flex !important;
                flex-direction: row;
                align-items: center;
                gap: 0.5rem;
            }
            #chatWidget #cwComposerAttachBtn,
            #chatWidget #cwComposerEmojiBtn {
                color: #475569 !important;
                opacity: 1 !important;
            }
            #chatWidget #cwComposerAttachBtn:hover,
            #chatWidget #cwComposerEmojiBtn:hover {
                background: rgba(148, 163, 184, 0.22);
                border-radius: 0.5rem;
            }
            #chatWidget #cwComposerAttachBtn svg path {
                stroke: #475569 !important;
                fill: none;
                stroke-width: 1.5px;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            #chatWidget #cwComposerEmojiBtn svg path {
                stroke: #475569 !important;
                fill: none;
                stroke-width: 1.5px;
                stroke-linecap: round;
            }
            #chatWidget #cwComposerEmojiBtn svg > circle:first-of-type {
                stroke: #475569 !important;
                fill: none !important;
                stroke-width: 1.5px;
            }
            #chatWidget .cw-mic-btn svg path {
                stroke: #64748b;
                fill: none;
                stroke-width: 1.75px;
                stroke-linecap: round;
                stroke-linejoin: round;
            }

            .cw-mic-btn {
                width: 2rem;
                height: 2rem;
                border-radius: 9999px;
                border: none;
                background: #f1f5f9;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: default;
                color: var(--cw-slate-600);
                flex-shrink: 0;
            }

            .chat-widget-send-button.enabled {
                background: var(--cw-navy) !important;
                background-image: none !important;
            }
            .chat-widget-send-button.enabled:hover {
                opacity: 0.92;
            }
            #chatWidget #sendButton svg path {
                stroke: #ffffff !important;
                fill: none;
            }

            #chatWidgetButton.cw-fab {
                background: var(--cw-navy) !important;
                background-image: none !important;
                box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.35);
            }

            .cw-msg-link {
                color: #2563eb;
                text-decoration: underline;
                text-underline-offset: 2px;
                word-break: break-all;
            }
            .cw-link-card {
                margin-top: 0.5rem;
                display: flex;
                overflow: hidden;
                border-radius: 0.75rem;
                background: #fff;
                border: 1px solid var(--cw-slate-200);
                text-align: left;
                text-decoration: none;
                color: inherit;
            }
            .cw-link-card-accent {
                width: 4px;
                flex-shrink: 0;
                background: var(--cw-navy);
            }
            .cw-link-card-body {
                padding: 0.6rem 0.75rem;
                min-width: 0;
                flex: 1;
            }
            .cw-link-card-title {
                font-weight: 700;
                font-size: 0.8125rem;
                color: var(--cw-bubble-text);
                line-height: 1.3;
            }
            .cw-link-card-sub {
                font-size: 0.75rem;
                font-weight: 600;
                color: var(--cw-slate-600);
                margin-top: 0.125rem;
            }
            .cw-link-card-desc {
                font-size: 0.6875rem;
                color: var(--cw-slate-500);
                margin-top: 0.25rem;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .cw-quote-block {
                margin-bottom: 0.5rem;
                padding: 0.5rem 0.65rem;
                border-radius: 0.5rem;
                background: #f1f5f9;
                border: 1px solid rgba(226, 232, 240, 0.9);
                border-left: 4px solid #64748b;
            }
            .cw-quote-author {
                font-weight: 700;
                font-size: 0.8125rem;
                color: #2563eb;
            }
            .cw-quote-text {
                font-size: 0.8125rem;
                color: #334155;
                margin-top: 0.25rem;
                line-height: 1.4;
            }

            .cw-out-name {
                font-size: 0.6875rem;
                font-weight: 600;
                color: var(--cw-slate-500);
                width: 100%;
                text-align: right;
            }
            .cw-in-name-row {
                font-size: 0.6875rem;
                font-weight: 600;
                color: var(--cw-slate-500);
                display: flex;
                align-items: center;
                gap: 0.35rem;
                width: 100%;
            }
            .cw-time-outside {
                font-size: 0.6875rem;
                color: var(--cw-slate-500);
                font-style: italic;
                margin-top: 0.125rem;
            }
            .cw-time-outside.cw-out {
                text-align: left;
                align-self: flex-start;
                margin-left: 0;
                max-width: calc(82% - 2.25rem);
            }

            .cw-msg-wrap.cw-msg-temp .cw-message-menu-trigger {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            .cw-msg-avatar.cw-out {
                margin-top: 0;
            }
            
            .chat-widget-button .icon-chat {
                display: block;
            }
            .chat-widget-button .icon-chevron {
                display: none;
            }
            .chat-widget-button.open .icon-chat {
                display: none;
            }
            .chat-widget-button.open .icon-chevron {
                display: block;
            }
            .chat-widget-button .icon-close {
                display: none !important;
            }
            
            .chat-widget-input-wrapper.focused {
                border-color: rgba(15, 23, 42, 0.22);
                box-shadow: none;
            }
            
            .chat-widget-send-button.enabled svg {
                stroke: white;
            }

            .cw-status-sending {
                width: 14px;
                height: 14px;
                border-radius: 9999px;
                border: 2px solid rgba(90,90,90,0.28);
                border-top-color: rgba(90,90,90,0.65);
                display: inline-block;
                animation: spin 1s linear infinite;
            }

            .cw-date-pill {
                position: sticky;
                top: 8px;
                z-index: 8;
                align-self: center;
                margin: 6px 0 10px 0;
                padding: 2px 10px;
                border-radius: 9999px;
                font-size: 11px;
                font-weight: 600;
                color: var(--cw-slate-500);
                background: rgba(241, 245, 249, 0.95);
                border: 1px solid rgba(226, 232, 240, 0.9);
                backdrop-filter: blur(4px);
            }

            .cw-system-pill {
                align-self: center;
                margin: 4px 12px 8px 12px;
                padding: 4px 12px;
                border-radius: 9999px;
                font-size: 11px;
                font-weight: 600;
                line-height: 1.35;
                text-align: center;
                color: var(--cw-slate-600);
                background: rgba(241, 245, 249, 0.92);
                border: 1px solid rgba(226, 232, 240, 0.95);
                max-width: 92%;
            }

            .cw-msg-system {
                display: flex;
                justify-content: center;
            }

            .cw-message-menu-trigger {
                width: 28px;
                height: 28px;
                border-radius: 9999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border: 1px solid transparent;
                cursor: pointer;
                opacity: 0;
                pointer-events: none;
                transition: opacity 140ms ease, background 140ms ease, border-color 140ms ease;
            }
            .cw-msg-wrap:hover .cw-message-menu-trigger,
            .cw-msg-wrap:focus-within .cw-message-menu-trigger,
            .cw-msg-wrap:has(.cw-message-menu:not(.hidden)) .cw-message-menu-trigger {
                opacity: 1;
                pointer-events: auto;
            }
            .cw-message-menu-trigger:hover {
                opacity: 1 !important;
                background: rgba(0,0,0,0.04);
                border-color: rgba(0,0,0,0.06);
            }
            .cw-message-menu {
                position: absolute;
                bottom: calc(100% + 6px);
                right: 0;
                min-width: 140px;
                background: #fff;
                border: 1px solid rgba(15, 23, 42, 0.10);
                border-radius: 12px;
                box-shadow: 0 18px 36px rgba(15, 23, 42, 0.12);
                padding: 6px;
                z-index: 20;
            }
            .cw-msg-row.cw-outbound .cw-message-menu {
                right: auto;
                left: 0;
            }
            .cw-message-menu-left { right: 0; left: auto; }
            .cw-message-menu-right { right: 0; left: auto; }
            .cw-message-menu.hidden { display: none; }
            .cw-message-menu-item {
                width: 100%;
                text-align: left;
                padding: 7px 10px;
                border-radius: 10px;
                border: none;
                background: transparent;
                cursor: pointer;
                font-size: 12px;
                color: rgba(15, 23, 42, 0.88);
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .cw-message-menu-item:hover {
                background: rgba(0,0,0,0.045);
            }
            .cw-message-menu-item.cw-danger {
                color: #b91c1c;
            }

            .cw-msg-row {
                display: flex;
                width: 100%;
                max-width: 100%;
                gap: 10px;
            }
            .cw-msg-row.cw-inbound { justify-content: flex-start; align-items: flex-end; }
            .cw-msg-row.cw-outbound { justify-content: flex-end; align-items: flex-end; }

            .cw-msg-avatar {
                width: 28px;
                height: 28px;
                border-radius: 9999px;
                flex-shrink: 0;
                background: #e5e7eb;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                margin-top: 0;
            }
            .cw-msg-avatar-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .cw-msg-avatar-svg {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
            }

            .cw-msg-actions {
                position: relative;
                flex-shrink: 0;
                align-self: flex-end;
                padding-bottom: 2px;
            }

            .cw-msg-col {
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 6px;
                max-width: min(82%, 100%);
            }
            .cw-msg-col.cw-outbound { align-items: flex-end; }
            .cw-msg-meta {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 11px;
                color: var(--cw-slate-500);
            }
            .cw-msg-meta .cw-dot { opacity: 0.6; }
            .cw-msg-meta .cw-name {
                font-weight: 700;
                color: var(--cw-slate-600);
            }

            .cw-bubble-in {
                background: #ffffff;
                color: var(--cw-bubble-text);
                border-radius: 1rem;
                border-top-left-radius: 0.35rem;
                padding: 0.65rem 0.85rem;
                font-size: 0.875rem;
                line-height: 1.45;
                word-break: break-word;
                border: 1px solid rgba(226, 232, 240, 0.95);
            }
            .cw-bubble-out {
                background: var(--cw-navy);
                color: #ffffff;
                border-radius: 1rem;
                border-top-right-radius: 0.35rem;
                padding: 0.65rem 0.85rem;
                font-size: 0.875rem;
                line-height: 1.45;
                word-break: break-word;
                border: 1px solid rgba(15, 23, 42, 0.4);
            }
            .cw-bubble-footer {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 0.35rem;
                margin-top: 0.45rem;
                font-size: 0.6875rem;
                color: var(--cw-slate-500);
                font-style: italic;
            }
            .cw-bubble-out .cw-bubble-footer {
                color: rgba(255, 255, 255, 0.72);
            }
            .cw-bubble-out .cw-msg-link {
                color: #93c5fd;
            }
            .cw-bubble-out .cw-quote-block {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-left-color: #93c5fd;
            }
            .cw-bubble-out .cw-quote-author {
                color: #93c5fd;
            }
            .cw-bubble-out .cw-quote-text {
                color: rgba(226, 232, 240, 0.95);
            }
            .cw-bubble-footer-in {
                justify-content: flex-end;
                flex-wrap: wrap;
                gap: 0.35rem;
            }
            .cw-bubble-footer [data-outbound-ticks="1"] {
                font-style: normal;
            }

            /* Quick replies: pills below bot bubble (Preline-style) */
            .cw-quick-replies {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
                margin-top: 2px;
                padding-left: 2px;
                max-width: 100%;
            }
            .cw-quick-replies:empty {
                display: none;
            }
            .cw-quick-reply-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 8px 16px;
                border-radius: 9999px;
                border: 1px solid #0f172a;
                background: #fff;
                color: #0f172a;
                font-size: 13px;
                font-weight: 600;
                line-height: 1.25;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
                text-align: left;
                max-width: 100%;
                word-break: break-word;
            }
            .cw-quick-reply-btn:hover {
                background: #f8fafc;
            }
            .cw-quick-reply-btn:active {
                background: #f1f5f9;
            }
            .cw-bubble-in.cw-bubble-in--interactive {
                background: #fff;
            }

            /* Pre-chat form: hero + card body (reference layout) */
            .cw-prechat-outer {
                flex: 1 1 auto;
                min-height: 0;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 8px 12px 12px;
                -webkit-overflow-scrolling: touch;
            }
            .cw-prechat-card {
                margin-left: auto;
                margin-right: auto;
                width: 100%;
                max-width: 370px;
                border-radius: 20px;
                overflow: hidden;
                background: #fff;
                border: 1px solid rgba(148, 163, 184, 0.35);
                box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
            }
            .cw-prechat-hero {
                position: relative;
                margin: 0;
            }
            .cw-prechat-hero figure {
                margin: 0;
                line-height: 0;
                display: block;
            }
            .cw-prechat-hero svg {
                display: block;
                width: 100%;
                height: auto;
            }
            .cw-prechat-close {
                position: absolute;
                top: 10px;
                right: 10px;
                z-index: 2;
                width: 32px;
                height: 32px;
                border: none;
                border-radius: 9999px;
                background: rgba(255, 255, 255, 0.9);
                color: #64748b;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
            }
            .cw-prechat-close:hover {
                background: #fff;
                color: #0f172a;
            }
            .cw-prechat-logo-wrap {
                position: absolute;
                left: 20px;
                bottom: -22px;
                z-index: 2;
            }
            .cw-prechat-logo-circle {
                width: 56px;
                height: 56px;
                border-radius: 9999px;
                background: #fff;
                border: 3px solid #fff;
                box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .cw-prechat-body {
                position: relative;
                padding: 32px 20px 20px;
                background: #fff;
            }
            .cw-prechat-textarea-wrap textarea {
                min-height: 112px;
                padding-right: 56px;
                padding-bottom: 40px;
                resize: vertical;
            }
            .cw-prechat-textarea-actions {
                position: absolute;
                right: 10px;
                bottom: 10px;
                display: flex;
                align-items: center;
                gap: 2px;
            }
            .cw-prechat-textarea-actions button {
                width: 32px;
                height: 32px;
                border: none;
                background: transparent;
                color: #94a3b8;
                cursor: pointer;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                opacity: 0.85;
            }
            .cw-prechat-textarea-actions button:hover {
                opacity: 1;
                background: #f1f5f9;
                color: #64748b;
            }

            .cw-bottom-nav {
                border-top: 1px solid var(--cw-slate-200);
                background: #fff;
                padding: 10px 10px 12px 10px;
                display: flex;
                align-items: stretch;
                justify-content: stretch;
                gap: 10px;
            }
            .cw-bottom-nav button {
                border: none;
                background: transparent;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                flex: 1 1 0;
                min-width: 0;
                padding: 8px 10px;
                border-radius: 14px;
                color: rgba(30,30,30,0.55);
                transition: background 140ms ease, color 140ms ease;
            }
            .cw-bottom-nav button.cw-nav-active {
                background: #e8eef5;
                color: #0f172a;
            }
            .cw-bottom-nav button:not(.cw-nav-active) {
                color: #94a3b8;
            }
            .cw-bottom-nav button.cw-nav-active .cw-nav-icon {
                opacity: 1;
                color: inherit;
            }
            .cw-bottom-nav button:hover:not(.cw-nav-active) {
                background: rgba(0,0,0,0.04);
                color: #64748b;
            }
            .cw-bottom-nav button:hover.cw-nav-active {
                background: #dfe8f2;
                color: #0f172a;
            }
            .cw-bottom-nav .cw-nav-label {
                font-size: 12px;
                font-weight: 700;
            }
            .cw-bottom-nav .cw-nav-icon {
                width: 20px;
                height: 20px;
                opacity: 0.9;
            }
            .cw-bottom-nav button:not(.cw-nav-active) .cw-nav-icon {
                opacity: 0.85;
            }
            /* Home: Preline-style welcome screen */
            .cw-home-hero {
                position: relative;
                height: 120px;
                overflow: hidden;
                border-radius: 1rem 1rem 0 0;
            }
            .cw-home-hero figure,
            .cw-home-hero svg {
                display: block;
                width: 100%;
                height: 120px;
            }
            .cw-home-close {
                position: absolute;
                top: 10px;
                right: 12px;
                width: 32px;
                height: 32px;
                border: none;
                background: transparent;
                color: rgba(15, 23, 42, 0.75);
                border-radius: 999px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .cw-home-close:hover {
                background: rgba(255, 255, 255, 0.55);
            }
            .cw-home-logo {
                margin-top: -28px;
                margin-left: 10px;
                width: 56px;
                height: 56px;
                border-radius: 999px;
                background: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 10px 25px -10px rgba(15, 23, 42, 0.25);
            }
            .cw-home-primary-btn:focus-visible,
            .cw-home-topic:focus-visible {
                outline: 2px solid rgba(15, 23, 42, 0.35);
                outline-offset: 2px;
            }
            .cw-home-channel-row:focus-visible {
                outline: 2px solid rgba(15, 23, 42, 0.35);
                outline-offset: 2px;
            }
            /* Unread badge on floating launcher */
            #chatWidgetButton .chat-widget-unread-badge {
                position: absolute;
                top: -4px;
                right: -4px;
                min-width: 20px;
                height: 20px;
                padding: 0 6px;
                border-radius: 999px;
                background: #ef4444; /* red-500 */
                color: #fff;
                font-size: 11px;
                font-weight: 700;
                line-height: 1;
                display: none;
                align-items: center;
                justify-content: center;
                box-shadow: 0 6px 18px rgba(0,0,0,0.25);
                border: 2px solid rgba(255,255,255,0.9);
                pointer-events: none;
                z-index: 5;
            }
            
            .hide-on-home {
                display: none !important;
            }
            
            #mainHeader {
                display: none;
            }
            
            /* File Upload Popup Styles */
            .chat-widget-file-upload-popup {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(4px);
            }
            
            .chat-widget-file-upload-popup.hidden {
                display: none;
            }
            
            .chat-widget-file-upload-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
            }
            
            .chat-widget-file-upload-content {
                position: relative;
                background: white;
                border-radius: 16px;
                width: 90%;
                max-width: 400px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
                z-index: 1001;
            }
            
            .chat-widget-file-upload-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 20px 24px;
                border-bottom: 1px solid var(--border-color);
            }
            .chat-widget-file-upload-header button {
                color: #475569;
            }
            .chat-widget-file-upload-header button svg path {
                stroke: #475569 !important;
                fill: none;
            }
            
            .chat-widget-file-upload-body {
                padding: 32px 24px;
                min-height: 300px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                position: relative;
            }
            
            .file-upload-placeholder {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                width: 100%;
            }
            
            .file-upload-placeholder.hidden {
                display: none;
            }
            
            .file-upload-preview {
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            
            .file-upload-preview.hidden {
                display: none;
            }
            
            .file-preview-container {
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 12px;
                background: transparent;
            }
            
            .file-preview-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                border: 1px solid var(--border-color);
                border-radius: 8px;
                background: transparent;
            }
            
            .file-preview-icon {
                width: 48px;
                height: 48px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border-radius: 8px;
                color: white;
            }
            
            .file-preview-info {
                flex: 1;
                min-width: 0;
            }
            
            .file-preview-name {
                font-size: 14px;
                font-weight: 500;
                color: var(--text-color);
                margin: 0 0 4px 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .file-preview-size {
                font-size: 12px;
                color: var(--text-color);
                opacity: 0.6;
                margin: 0;
            }
            
            .file-preview-image {
                width: 100%;
                max-height: 200px;
                object-fit: contain;
                border-radius: 8px;
                border: 1px solid var(--border-color);
            }
            
            .file-upload-actions {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }
            
            .file-upload-progress {
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            
            .file-upload-progress.hidden {
                display: none;
            }
            
            .progress-bar-container {
                width: 100%;
                height: 6px;
                background: #e5e5e5;
                border-radius: 3px;
                overflow: hidden;
            }
            
            .progress-bar {
                height: 100%;
                background: linear-gradient(to right, var(--primary-color), var(--secondary-color));
                width: 0%;
                transition: width 0.3s ease;
            }
            
            #fileUploadDropZone.drag-over {
                background: rgba(var(--primary-color-rgb, 244, 77, 27), 0.05);
                border: 2px dashed var(--primary-color);
            }
            
            .chat-widget-screen {
                display: none;
            }
            
            .chat-widget-screen.active {
                display: flex;
            }
            /* Home fills the column between gradient header and bottom nav; opaque so nothing bleeds through. */
            #homeScreen.chat-widget-screen.active {
                flex-direction: column;
                flex: 1 1 auto;
                min-height: 0;
                height: 100%;
                overflow: hidden;
                background: #fff;
            }
            #homeScreen.chat-widget-screen.active > .cw-home-outer {
                display: flex;
                flex-direction: column;
                flex: 1 1 auto;
                min-height: 0;
                overflow-y: auto;
                overflow-x: hidden;
                -webkit-overflow-scrolling: touch;
            }
            #homeScreen.chat-widget-screen.active .cw-home-white-fill {
                flex: 1 1 auto;
                min-height: 0;
                display: flex;
                flex-direction: column;
                background: #fff;
            }
            /* Help screen empty-state */
            #helpScreen.chat-widget-screen.active {
                flex-direction: column;
                flex: 1 1 auto;
                min-height: 0;
                height: 100%;
                overflow: hidden;
                background: #fff;
            }
            .cw-help-empty {
                flex: 1 1 auto;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 24px;
                text-align: center;
                gap: 4px;
            }
            .cw-help-empty-illustration {
                position: relative;
                width: 120px;
                height: 96px;
                margin-bottom: 18px;
            }
            .cw-help-empty-card {
                position: absolute;
                left: 50%;
                width: 110px;
                padding: 12px 14px;
                background: #fff;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .cw-help-empty-card-back {
                top: 2px;
                transform: translateX(-50%) rotate(-6deg);
                opacity: 0.85;
            }
            .cw-help-empty-card-front {
                top: 24px;
                transform: translateX(-50%) rotate(4deg);
            }
            .cw-help-empty-bar {
                display: block;
                height: 8px;
                border-radius: 4px;
            }
            .cw-help-empty-bar-short {
                width: 36px;
                background: #cbd5e1;
            }
            .cw-help-empty-bar-long {
                width: 72px;
                background: transparent;
                border: 1px solid #cbd5e1;
            }
            .cw-help-empty-title {
                margin: 0;
                font-size: 17px;
                font-weight: 700;
                color: #0f172a;
            }
            .cw-help-empty-subtitle {
                margin: 4px 0 0 0;
                font-size: 13px;
                color: #94a3b8;
                font-weight: 500;
            }
            
            .chat-widget-form-container.hidden {
                display: none;
            }
            
            @media (max-width: 768px) {
                .chat-widget-container {
                    bottom: 0 !important;
                    right: 0 !important;
                    left: 0 !important;
                    top: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                }
                
                .chat-widget-container .chat-widget-window {
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: 100vw !important;
                    max-height: 100vh !important;
                    border-radius: 0 !important;
                    bottom: 0 !important;
                    right: 0 !important;
                    left: 0 !important;
                    top: 0 !important;
                    position: fixed !important;
                    margin: 0 !important;
                }
                
                .chat-widget-container.bottom-right .chat-widget-window,
                .chat-widget-container.bottom-left .chat-widget-window,
                .chat-widget-container.top-right .chat-widget-window,
                .chat-widget-container.top-left .chat-widget-window {
                    bottom: 0 !important;
                    right: 0 !important;
                    left: 0 !important;
                    top: 0 !important;
                }
                
                .chat-widget-button {
                    bottom: 20px !important;
                    right: 20px !important;
                    position: fixed !important;
                    z-index: 2147483001 !important;
                }
                
                .chat-widget-form-container,
                .cw-prechat-outer {
                    padding: 12px 5vw 16px;
                    max-width: 100vw;
                    margin: 0 auto;
                    border-radius: 0;
                    box-shadow: none;
                }
                .cw-prechat-card {
                    border-radius: 16px;
                }
                
                body.chat-widget-open {
                    overflow: hidden !important;
                    position: fixed !important;
                    width: 100% !important;
                    height: 100% !important;
                }
            }
            
            .chat-widget-container.bottom-right .chat-widget-window {
                bottom: 80px;
                right: 0;
            }
            
            .chat-widget-container.bottom-left .chat-widget-window {
                bottom: 80px;
                left: 0;
            }
            
            .chat-widget-container.top-right .chat-widget-window {
                top: 80px;
                right: 0;
            }
            
            .chat-widget-container.top-left .chat-widget-window {
                top: 80px;
                left: 0;
            }
            
            /* Desktop / large screens: stay inside the visible viewport when zoomed or on short windows */
            @media (min-width: 769px) {
                .chat-widget-container .chat-widget-window {
                    width: min(400px, calc(100vw - 40px)) !important;
                    max-width: min(400px, calc(100vw - 40px)) !important;
                    min-height: 0 !important;
                    box-sizing: border-box;
                    /* ~100px above launcher + margins; keeps top clear of browser chrome when zoomed */
                    height: min(700px, calc(100vh - 120px)) !important;
                    max-height: min(700px, calc(100vh - 120px)) !important;
                }
            }
            @supports (height: 100dvh) {
                @media (min-width: 769px) {
                    .chat-widget-container .chat-widget-window {
                        height: min(700px, calc(100dvh - 120px)) !important;
                        max-height: min(700px, calc(100dvh - 120px)) !important;
                    }
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    function createWidget() {
        if (document.getElementById('chatWidgetContainer')) return;
        
        const container = document.createElement('div');
        container.id = 'chatWidgetContainer';
        container.className = 'fixed z-[10000] font-sans bottom-5 right-5 chat-widget-container bottom-right';
        container.setAttribute('data-background', 'no');
        
        container.innerHTML = `
            <div id="chatWidget" class="cw-preline w-[400px] h-[700px] flex flex-col overflow-hidden absolute animate-slide-up chat-widget-window bottom-20 right-0 hidden bg-white">
                <div class="cw-msg-header hide-on-home" id="mainHeader">
                    <div class="flex items-center justify-between gap-2 border-b border-slate-200 px-2 py-2 w-full">
                        <button type="button" class="flex shrink-0 justify-center items-center size-8 text-slate-600 hover:bg-slate-100 rounded-full focus:outline-none" onclick="chatWidget.showScreen('home')" title="Back" aria-label="Back">
                            <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                        </button>

                        <div class="w-full min-w-0">
                            <div class="truncate flex items-center gap-x-2">
                                <span id="cwHeaderAvatarWrap" class="relative shrink-0 cw-header-avatar-wrap hidden" aria-hidden="true">
                                    <span id="cwHeaderAvatarPlaceholder" class="cw-header-avatar-placeholder hidden" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="#64748b" stroke-width="2"/></svg>
                                    </span>
                                    <img id="cwHeaderAvatarImg" class="shrink-0 size-8 rounded-full hidden" alt="" width="32" height="32" />
                                    <span id="cwHeaderPresenceDot" class="absolute bottom-0 right-0 block size-2 rounded-full ring-2 ring-white bg-green-500 cw-online-dot cw-away" aria-hidden="true"></span>
                                </span>

                                <span class="grow truncate">
                                    <span id="widgetHeaderTitle" class="truncate block font-semibold text-sm leading-4 text-slate-900">Chat</span>
                                    <span id="widgetHeaderSubtitle" class="truncate block text-xs leading-4 text-blue-600">Online</span>
                                </span>
                            </div>
                        </div>

                        <button type="button" class="flex shrink-0 justify-center items-center size-8 text-slate-600 hover:bg-slate-100 rounded-full focus:outline-none" onclick="chatWidget.toggleChat()" title="Close" aria-label="Close">
                            <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="chat-widget-screen flex-1 min-h-0 flex-col active" id="homeScreen">
                    <div class="flex flex-col flex-1 overflow-hidden cw-home-outer">
                        <div class="cw-home-hero">
                            <button type="button" class="cw-home-close" onclick="chatWidget.toggleChat()" aria-label="Close">
                                <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 stroke-currentColor stroke-2 stroke-linecap-round" aria-hidden="true">
                                    <path d="M18 6L6 18M6 6l12 12"/>
                                </svg>
                            </button>
                            <figure aria-hidden="true">
                                <svg preserveAspectRatio="none" viewBox="0 0 576 120" xmlns="http://www.w3.org/2000/svg">
                                    <g clip-path="url(#cwHomeClip)">
                                        <rect width="576" height="120" fill="#B2E7FE"/>
                                        <rect x="289.678" y="-90.3" width="102.634" height="391.586" transform="rotate(59.5798 289.678 -90.3)" fill="#FF8F5D"/>
                                        <rect x="41.3926" y="-0.996094" width="102.634" height="209.864" transform="rotate(-31.6412 41.3926 -0.996094)" fill="#3ECEED"/>
                                        <rect x="66.9512" y="40.4817" width="102.634" height="104.844" transform="rotate(-31.6412 66.9512 40.4817)" fill="#4C48FF"/>
                                    </g>
                                    <defs>
                                        <clipPath id="cwHomeClip">
                                            <rect width="576" height="120" fill="#fff"/>
                                        </clipPath>
                                    </defs>
                                </svg>
                            </figure>
                        </div>

                        <div class="bg-white px-5 pb-5 pt-0 flex-1 rounded-t-[24px] -mt-[22px] relative flex flex-col min-h-0">
                            <div class="cw-home-logo" aria-hidden="true">
                                <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none">
                                    <path d="M12 3a7 7 0 0 0-7 7v9" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/>
                                    <path d="M12 7a3 3 0 0 0-3 3v9" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/>
                                    <circle cx="12" cy="12" r="2.5" fill="#0f172a"/>
                                </svg>
                            </div>

                            <div class="mt-4">
                                <p class="m-0 text-[22px] font-semibold text-slate-900" id="cwHomeGreeting">
                                    Hi, <span id="cwHomeVisitorName">James</span> <span aria-hidden="true">👋</span>
                                </p>
                                <p class="m-0 mt-1 text-[13px] text-slate-500" id="cwHomeGreetingSub">
                                    Preline support team is here to help.
                                </p>
                            </div>

                            <div class="my-3">
                                <button type="button" class="cw-home-primary-btn w-full rounded-lg bg-slate-900 px-4 py-3 text-[14px] font-semibold text-white hover:bg-slate-800 focus:outline-none" onclick="chatWidget.showScreen('messages')" aria-label="Send us a message">
                                    Send us a message
                                </button>
                            </div>

                            <!-- Dynamic channels (same logic as previous design; visibility controlled by settings) -->
                            <div class="mb-3 grid grid-cols-4 gap-3" aria-label="Contact options">
                                <button type="button" id="widgetDirectMessageRow" class="cw-home-channel-row rounded-xl bg-white p-3 text-left focus:outline-none flex items-center gap-3" onclick="chatWidget.showScreen('messages')" aria-label="Direct message">
                                    <span class="flex h-11 w-11 items-center justify-center rounded-full flex-shrink-0" style="background:#4285F4" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6" aria-hidden="true">
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                        </svg>
                                    </span>
                                </button>

                                <button type="button" id="widgetWhatsAppRow" class="cw-home-channel-row rounded-xl bg-white p-3 text-left focus:outline-none flex items-center gap-3" onclick="chatWidget.openWhatsApp()" aria-label="WhatsApp">
                                    <span class="flex h-11 w-11 items-center justify-center rounded-full flex-shrink-0" style="background:#25D366" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6" aria-hidden="true">
                                            <path d="M21 11.5a8.5 8.5 0 1 1-16.2 3.6L3 21l5.9-1.7A8.38 8.38 0 0 0 12 20a8.5 8.5 0 0 0 9-8.5z"/>
                                            <path d="M8.5 8.5c.5 3 4 6.5 6.5 7l1.5-1.5 2 1-1 2.5c-4 .5-10-5.5-10.5-10.5L9.5 6l2 1-1.5 1.5z"/>
                                        </svg>
                                    </span>
                                </button>

                                <button type="button" id="widgetTelegramRow" class="cw-home-channel-row rounded-xl bg-white p-3 text-left focus:outline-none flex items-center gap-3" onclick="chatWidget.openTelegram()" aria-label="Telegram">
                                    <span class="flex h-11 w-11 items-center justify-center rounded-full flex-shrink-0" style="background:#229ED9" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6" aria-hidden="true">
                                            <path d="M21 3L3 11l7 2 2 7 9-17z"/>
                                            <path d="M10 13l11-10"/>
                                        </svg>
                                    </span>
                                </button>

                                <button type="button" id="widgetEmailRow" class="cw-home-channel-row rounded-xl bg-white p-3 text-left focus:outline-none flex items-center gap-3" onclick="chatWidget.openEmail()" aria-label="Email">
                                    <span class="flex h-11 w-11 items-center justify-center rounded-full flex-shrink-0" style="background:#F59E0B" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6" aria-hidden="true">
                                            <path d="M4 4h16v16H4z"/>
                                            <path d="M22 6l-10 7L2 6"/>
                                        </svg>
                                    </span>
                                </button>
                            </div>

                            <h5 class="mb-2 text-[12px] text-slate-500" id="cwHomeTopicsTitle">Popular topics</h5>
                            <ul class="-space-y-px overflow-hidden rounded-lg border border-slate-200">
                                <li>
                                    <button type="button" class="cw-home-topic w-full text-left px-4 py-3 bg-white hover:bg-slate-50 focus:outline-none flex items-center gap-3" onclick="chatWidget.showScreen('help')" aria-label="General">
                                        <span class="min-w-0 flex-1">
                                            <span class="block text-[14px] font-medium text-slate-900">General</span>
                                            <span class="block text-[12px] text-slate-500">Accounts, Invoices, Refunds, and Updates</span>
                                        </span>
                                        <svg class="w-4 h-4 text-slate-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="m10 8 4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                </li>
                                <li class="border-t border-slate-200">
                                    <button type="button" class="cw-home-topic w-full text-left px-4 py-3 bg-white hover:bg-slate-50 focus:outline-none flex items-center gap-3" onclick="chatWidget.showScreen('help')" aria-label="Licenses">
                                        <span class="min-w-0 flex-1">
                                            <span class="block text-[14px] font-medium text-slate-900">Licenses</span>
                                            <span class="block text-[12px] text-slate-500">Team License, and Client Projects more</span>
                                        </span>
                                        <svg class="w-4 h-4 text-slate-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="m10 8 4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                </li>
                                <li class="border-t border-slate-200">
                                    <button type="button" class="cw-home-topic w-full text-left px-4 py-3 bg-white hover:bg-slate-50 focus:outline-none flex items-center gap-3" onclick="chatWidget.showScreen('help')" aria-label="Support">
                                        <span class="min-w-0 flex-1">
                                            <span class="block text-[14px] font-medium text-slate-900">Support</span>
                                            <span class="block text-[12px] text-slate-500">How to contact or Technical Support</span>
                                        </span>
                                        <svg class="w-4 h-4 text-slate-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path d="m10 8 4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="chat-widget-screen cw-ms-screen flex flex-1 min-h-0 flex-col overflow-hidden" id="messagesScreen">
                    <div class="flex items-center justify-center flex-1 min-h-0" id="loaderContainer" style="display: none;">
                        <div class="flex flex-col items-center gap-3">
                            <div class="w-10 h-10 border-4 border-slate-300 border-t-slate-700 rounded-full animate-spin"></div>
                            <p class="text-sm text-slate-500 m-0">Loading...</p>
                        </div>
                    </div>
                    <div class="cw-prechat-outer chat-widget-form-container hidden" id="formContainer" style="display:none;">
                        <div class="cw-prechat-card">
                            <div class="cw-prechat-hero">
                                <button type="button" class="cw-prechat-close" onclick="chatWidget.showScreen('home')" title="Back" aria-label="Close form">
                                    <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 text-current" aria-hidden="true">
                                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                    </svg>
                                </button>
                                <figure aria-hidden="true">
                                    <svg preserveAspectRatio="none" viewBox="0 0 576 140" xmlns="http://www.w3.org/2000/svg">
                                        <g clip-path="url(#cwFormClip)">
                                            <rect width="576" height="140" fill="#FF8F5D"/>
                                            <rect x="-40" y="20" width="180" height="280" transform="rotate(-28 50 160)" fill="#B2E7FE"/>
                                            <rect x="280" y="-60" width="120" height="320" transform="rotate(52 340 80)" fill="#4C48FF"/>
                                            <rect x="120" y="40" width="200" height="120" transform="rotate(-12 220 100)" fill="#3ECEED"/>
                                        </g>
                                        <defs>
                                            <clipPath id="cwFormClip">
                                                <rect width="576" height="140" fill="#fff"/>
                                            </clipPath>
                                        </defs>
                                    </svg>
                                </figure>
                                <div class="cw-prechat-logo-wrap" aria-hidden="true">
                                    <div class="cw-prechat-logo-circle">
                                        <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none">
                                            <path d="M12 3a7 7 0 0 0-7 7v9" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/>
                                            <path d="M12 7a3 3 0 0 0-3 3v9" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/>
                                            <circle cx="12" cy="12" r="2.5" fill="#0f172a"/>
                                        </svg>
                                    </div>
                                </div>
                            </div>
                            <div class="cw-prechat-body">
                                <form id="contactForm" onsubmit="chatWidget.handleFormSubmit(event)" class="flex flex-col gap-0">
                                    <div class="flex flex-col gap-1.5 mb-3">
                                        <label class="text-[13px] font-semibold text-slate-800 ml-0.5" for="formName">Name</label>
                                        <input type="text" id="formName" class="w-full px-3.5 py-3 border border-slate-200 rounded-xl text-[15px] text-slate-900 bg-white outline-none m-0 shadow-none transition-[border-color,box-shadow] duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400" placeholder="John Doe" required>
                                    </div>
                                    <div class="flex flex-col gap-1.5 mb-3">
                                        <label class="text-[13px] font-semibold text-slate-800 ml-0.5" for="formEmail">Email</label>
                                        <input type="email" id="formEmail" class="w-full px-3.5 py-3 border border-slate-200 rounded-xl text-[15px] text-slate-900 bg-white outline-none m-0 shadow-none transition-[border-color,box-shadow] duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400" placeholder="john@site.co" required>
                                    </div>
                                    <div class="flex flex-col gap-1.5 mb-3">
                                        <label class="text-[13px] font-semibold text-slate-800 ml-0.5" for="formSubject">Subject</label>
                                        <input type="text" id="formSubject" class="w-full px-3.5 py-3 border border-slate-200 rounded-xl text-[15px] text-slate-900 bg-white outline-none m-0 shadow-none transition-[border-color,box-shadow] duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400" placeholder="Preline Pro">
                                    </div>
                                    <div class="flex flex-col gap-1.5 mb-3" id="formPhoneRow" style="display:none;">
                                        <label class="text-[13px] font-semibold text-slate-800 ml-0.5" for="formPhone">Phone</label>
                                        <input type="tel" id="formPhone" class="w-full px-3.5 py-3 border border-slate-200 rounded-xl text-[15px] text-slate-900 bg-white outline-none m-0 shadow-none transition-[border-color,box-shadow] duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400" placeholder="Your phone number">
                                    </div>
                                    <div class="flex flex-col gap-1.5 mb-4">
                                        <label class="text-[13px] font-semibold text-slate-800 ml-0.5" for="formMessage">How can we help?</label>
                                        <div class="cw-prechat-textarea-wrap relative">
                                            <textarea id="formMessage" class="w-full px-3.5 py-3 border border-slate-200 rounded-xl text-[15px] text-slate-900 bg-white outline-none m-0 shadow-none transition-[border-color,box-shadow] duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400" placeholder="Message..." rows="4" required></textarea>
                                            <div class="cw-prechat-textarea-actions">
                                                <button type="button" title="Attach file" aria-label="Attach file" onclick="chatWidget.showFileUploadPopup()">
                                                    <svg viewBox="0 0 24 24" fill="none" class="w-[18px] h-[18px] stroke-currentColor stroke-[1.5]" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                                </button>
                                                <button type="button" id="cwFormEmojiBtn" title="Emoji" aria-label="Emoji" onclick="chatWidget.toggleEmojiPicker()">
                                                    <svg viewBox="0 0 24 24" fill="none" class="w-[18px] h-[18px] stroke-currentColor stroke-[1.5]" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-width="1.5"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><path d="M8 14c1 1.5 3 2.5 4 2.5s3-1 4-2.5" stroke-width="1.5" stroke-linecap="round"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <button type="submit" class="w-full py-3.5 border-none rounded-xl text-[15px] font-semibold text-white bg-slate-900 cursor-pointer transition-[opacity,transform] duration-150 mt-1 shadow-sm hover:bg-slate-800 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed" id="formSubmitButton">Send us a message</button>
                                </form>
                            </div>
                        </div>
                    </div>
                    <div id="assignedAgentBar" class="hidden flex-shrink-0 items-center gap-2.5 px-3.5 py-2.5 mx-3.5 mt-2 mb-0 rounded-xl border border-[var(--border-color)] bg-[#fafafb]" style="display:none;" role="status" aria-live="polite">
                        <img id="assignedAgentAvatar" class="w-9 h-9 rounded-full object-cover flex-shrink-0 hidden" alt="" width="36" height="36" />
                        <div class="min-w-0 flex-1">
                            <div class="text-[13px] font-semibold text-[var(--text-color)] truncate leading-tight" id="assignedAgentName"></div>
                            <div class="text-[11px] leading-tight mt-0.5" id="assignedAgentStatus"></div>
                        </div>
                    </div>
                    <div id="livechatTypingIndicator" class="hidden flex flex-wrap items-center px-3 py-2 text-[12px] text-slate-600 mx-3 mt-1 not-italic border-b border-transparent" style="display:none;" aria-live="polite"></div>
                    <div class="cw-msg-thread-wrap">
                    <div class="flex-1 overflow-y-auto min-h-0 flex-col chat-widget-messages cw-msg-thread px-0 py-0 flex flex-col gap-3 hidden" id="messagesContainer" style="display:none;">
                    </div>
                    </div>
                    <div class="cw-input-footer px-3 py-2 flex-shrink-0 hidden" id="inputContainer" style="display:none;position:relative">
                        <div id="cwReplyBar" class="hidden mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left">
                            <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0 flex-1">
                                    <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Replying to</div>
                                    <div class="mt-1 rounded-lg bg-slate-100 border border-slate-200 border-l-4 border-l-slate-500 px-2.5 py-2">
                                        <div id="cwReplyBarPreview" class="text-[13px] text-slate-700 truncate"></div>
                                    </div>
                                </div>
                                <button type="button" class="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg border-none bg-transparent text-slate-500 hover:bg-slate-100 cursor-pointer" onclick="chatWidget.clearPendingReply()" title="Cancel reply" aria-label="Cancel reply">×</button>
                            </div>
                        </div>
                        <div id="cwSelectionFooter" class="hidden mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                            <div class="flex items-center justify-between gap-2 mb-2">
                                <button type="button" class="text-xs font-semibold text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 border-none bg-transparent cursor-pointer" onclick="chatWidget.clearMessageSelection()">Cancel</button>
                                <div id="cwSelectionPreview" class="text-[11px] text-slate-500 truncate flex-1 text-right"></div>
                            </div>
                            <div class="flex flex-wrap gap-2 justify-center">
                                <button type="button" class="text-xs font-semibold text-slate-800 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer" onclick="chatWidget.footerActionReply()">Reply</button>
                                <button type="button" id="cwFooterEditBtn" class="text-xs font-semibold text-slate-800 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer hidden" onclick="chatWidget.footerActionEdit()">Edit</button>
                            </div>
                        </div>
                        <div class="flex flex-col bg-white border border-slate-200 rounded-xl px-3 py-2 gap-2 transition-colors duration-200 chat-widget-input-wrapper" id="inputWrapper">
                                <textarea class="w-full border-none bg-transparent outline-none text-sm text-slate-800 px-1 py-1.5 resize-none min-h-[40px] placeholder:text-slate-400" placeholder="Message…" id="chatInput" rows="1" onkeypress="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();chatWidget.sendMsg()}" onfocus="document.getElementById('inputWrapper').classList.add('focused')" onblur="document.getElementById('inputWrapper').classList.remove('focused')"></textarea>
                                <div class="flex items-center gap-2 justify-between w-full">
                                <div class="flex items-center gap-2">
                                    <button type="button" id="cwComposerAttachBtn" class="w-8 h-8 flex items-center justify-center cursor-pointer border-none bg-transparent p-0 opacity-60 transition-opacity duration-200 flex-shrink-0 hover:opacity-100 text-slate-600" title="Attach file" onclick="chatWidget.showFileUploadPopup()">
                                        <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 stroke-currentColor stroke-[1.5] fill-none stroke-linecap-round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    </button>
                                    <button type="button" id="cwComposerEmojiBtn" class="w-8 h-8 flex items-center justify-center cursor-pointer border-none bg-transparent p-0 opacity-60 transition-opacity duration-200 flex-shrink-0 hover:opacity-100 text-slate-600" title="Emoji" onclick="chatWidget.toggleEmojiPicker()">
                                        <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 stroke-currentColor stroke-[1.5]" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-width="1.5"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><path d="M8 14c1 1.5 3 2.5 4 2.5s3-1 4-2.5" stroke-width="1.5" stroke-linecap="round"/></svg>
                                    </button>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button type="button" class="cw-mic-btn" title="Voice message" aria-hidden="true" tabindex="-1">
                                        <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 stroke-currentColor stroke-[1.75]" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8"/></svg>
                                    </button>
                                <button type="button" class="w-9 h-9 rounded-full bg-slate-900 border-none cursor-not-allowed flex items-center justify-center transition-all duration-200 flex-shrink-0 opacity-40 chat-widget-send-button enabled:opacity-100 enabled:cursor-pointer enabled:hover:opacity-90" id="sendButton" onclick="chatWidget.sendMsg()" title="Send" aria-label="Send">
                                    <svg viewBox="0 0 24 24" class="w-4 h-4 stroke-white stroke-2 fill-none" aria-hidden="true"><path d="M12 19V5M12 5l-6 6M12 5l6 6"/></svg>
                                </button>
                                </div>
                            </div>
                        </div>
                        <div id="emojiPickerContainer" style="position:fixed;left:0;bottom:0;display:none;z-index:10002;pointer-events:auto"></div>
                    </div>
                </div>
                <div class="chat-widget-screen cw-help-screen flex-1 min-h-0 flex-col" id="helpScreen">
                    <div class="cw-help-empty">
                        <div class="cw-help-empty-illustration" aria-hidden="true">
                            <div class="cw-help-empty-card cw-help-empty-card-back">
                                <span class="cw-help-empty-bar cw-help-empty-bar-short"></span>
                                <span class="cw-help-empty-bar cw-help-empty-bar-long"></span>
                            </div>
                            <div class="cw-help-empty-card cw-help-empty-card-front">
                                <span class="cw-help-empty-bar cw-help-empty-bar-short"></span>
                                <span class="cw-help-empty-bar cw-help-empty-bar-long"></span>
                            </div>
                        </div>
                        <h3 class="cw-help-empty-title">No help topics</h3>
                        <p class="cw-help-empty-subtitle">Only help topics appear here</p>
                    </div>
                </div>
                <div class="cw-bottom-nav" id="widgetBottomNav" aria-label="Chat navigation">
                    <button type="button" data-cw-nav="home" class="cw-nav-active" onclick="chatWidget.showScreen('home')" aria-label="Home" aria-current="page">
                        <svg class="cw-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M3 10.5 12 3l9 7.5V21a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 21V10.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M9 22v-7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                        <span class="cw-nav-label">Home</span>
                    </button>
                    <button type="button" data-cw-nav="messages" onclick="chatWidget.showScreen('messages')" aria-label="Messages">
                        <svg class="cw-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                        <span class="cw-nav-label">Messages</span>
                    </button>
                    <button type="button" data-cw-nav="help" onclick="chatWidget.showScreen('help')" aria-label="Help">
                        <svg class="cw-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <circle cx="12" cy="17.5" r="1" fill="currentColor"/>
                        </svg>
                        <span class="cw-nav-label">Help</span>
                    </button>
                </div>
                <!-- File Upload Popup (Inside Widget) -->
                <div class="chat-widget-file-upload-popup hidden" id="fileUploadPopup">
                    <div class="chat-widget-file-upload-overlay" onclick="chatWidget.hideFileUploadPopup()"></div>
                    <div class="chat-widget-file-upload-content">
                        <div class="chat-widget-file-upload-header">
                            <h3 class="text-[18px] font-semibold text-[var(--text-color)] m-0">Upload File</h3>
                            <button class="w-6 h-6 flex items-center justify-center cursor-pointer border-none bg-transparent p-0 opacity-60 hover:opacity-100 transition-opacity" onclick="chatWidget.hideFileUploadPopup()" title="Close">
                                <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5 stroke-[var(--text-color)] stroke-[2]">
                                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                </svg>
                            </button>
                        </div>
                        <div class="chat-widget-file-upload-body" id="fileUploadDropZone">
                            <input type="file" id="fileUploadInput" class="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onchange="chatWidget.handleFileSelect(event)">
                            <div class="file-upload-placeholder" id="fileUploadPlaceholder">
                                <svg viewBox="0 0 24 24" fill="none" class="w-16 h-16 stroke-[var(--text-color)] stroke-[1.5] opacity-40 mb-4">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <p class="text-[15px] text-[var(--text-color)] opacity-70 m-0 mb-2 font-medium">Drag and drop your file here</p>
                                <p class="text-[13px] text-[var(--text-color)] opacity-50 m-0 mb-4">or</p>
                                <button class="px-6 py-2.5 bg-[var(--primary-color)] text-white rounded-lg border-none cursor-pointer text-[14px] font-medium hover:opacity-90 transition-opacity" onclick="document.getElementById('fileUploadInput').click()">Browse Files</button>
                                <p class="text-[11px] text-[var(--text-color)] opacity-40 m-0 mt-4">Max size: 5MB • Images, PDF, Documents, Text</p>
                            </div>
                            <div class="file-upload-progress hidden" id="fileUploadProgress">
                                <div class="progress-bar-container">
                                    <div class="progress-bar" id="fileUploadProgressBar"></div>
                                </div>
                                <p class="text-[13px] text-[var(--text-color)] opacity-70 m-0 mt-2 text-center">Uploading...</p>
                            </div>
                            <div class="file-upload-preview hidden" id="fileUploadPreview">
                                <div class="file-preview-container" id="filePreviewContainer"></div>
                                <div class="file-upload-actions">
                                    <button class="px-4 py-2 text-[13px] text-[var(--text-color)] opacity-70 bg-transparent border border-[var(--border-color)] rounded-lg cursor-pointer hover:opacity-100 transition-opacity" onclick="chatWidget.clearFileSelection()">Remove</button>
                                    <button class="px-6 py-2 bg-gradient-to-br from-[var(--primary-color)] to-[var(--secondary-color)] text-white rounded-lg border-none cursor-pointer text-[14px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed" id="fileUploadSendButton" onclick="chatWidget.sendFileMessage()">Send</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <button type="button" class="cw-fab w-[60px] h-[60px] rounded-full border-none cursor-pointer flex items-center justify-center transition-[transform,box-shadow] duration-300 relative hover:scale-105 chat-widget-button" onclick="chatWidget.toggleChat()" id="chatWidgetButton" aria-label="Open chat">
                <svg class="icon-chat w-7 h-7 fill-white" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
                <svg class="icon-chevron w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span id="chatWidgetUnreadBadge" class="chat-widget-unread-badge chat-widget-unread-badge" aria-hidden="true"></span>
            </button>
        `;
        
        document.body.appendChild(container);
        installMessagesContainerClickDelegation();
        updateUnreadBadge(getUnreadCount());
    }
    
    function formatMessageClock(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function buildOutboundTicksHtml(status) {
        var s = (status || '').toLowerCase();
        if (s === 'sending' || s === 'queued' || s === 'pending') {
            return '<span class="cw-status-sending" title="Sending" aria-label="Sending"></span>';
        }
        if (s === 'failed') {
            return '<span class="text-[10px] font-medium text-red-500">Failed</span>';
        }
        var seen = s === 'seen';
        var dbl = seen || s === 'delivered' || s === 'sent';
        var col = seen ? '#64748b' : 'rgba(100,116,139,0.75)';
        var w = 13;
        var h = 10;
        var path = '<path d="M2 6l4 4 8-8" stroke="' + col + '" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
        var single = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 16 12" aria-hidden="true" style="vertical-align:middle">' + path + '</svg>';
        if (!dbl) {
            return single;
        }
        var secondCol = seen ? '#64748b' : 'rgba(100,116,139,0.75)';
        var path2 = '<path d="M2 6l4 4 8-8" stroke="' + secondCol + '" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
        return '<span style="display:inline-flex;align-items:center;gap:0">' + single + '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 16 12" aria-hidden="true" style="margin-left:-7px;vertical-align:middle">' + path2 + '</svg></span>';
    }

    function resolveAgentLabelForMessage(message) {
        try {
            if (message && message.from_name && String(message.from_name).trim()) return String(message.from_name).trim();
            var ag = widgetState && widgetState.assignedAgent;
            if (ag && ag.name && String(ag.name).trim()) return String(ag.name).trim();
        } catch (e) {}
        return 'Agent';
    }

    function getVisitorDisplayName() {
        try {
            var el = document.getElementById('formName');
            if (el && el.value && String(el.value).trim()) return String(el.value).trim();
            var n = sessionStorage.getItem('chatWidgetUserName');
            if (n && String(n).trim()) return String(n).trim();
        } catch (e) {}
        return 'You';
    }

    function linkifyEscapedHtml(escaped) {
        if (!escaped) return '';
        return escaped.replace(/(https?:\/\/[^\s<&]+[^.,)\]<\s]*)/gi, function (m) {
            var safe = m.replace(/"/g, '&quot;');
            return '<a class="cw-msg-link" href="' + safe + '" target="_blank" rel="noopener noreferrer">' + m + '</a>';
        });
    }

    function formatMessageBodyForWidget(raw) {
        var base = escapeHtml(String(raw || '')).replace(/\n/g, '<br>');
        return linkifyEscapedHtml(base);
    }

    function extractFirstHttpUrl(text) {
        if (!text || typeof text !== 'string') return null;
        var m = text.match(/https?:\/\/[^\s]+/i);
        return m ? m[0] : null;
    }

    function buildLinkPreviewCardHtml(url) {
        if (!url) return '';
        var u;
        try {
            u = new URL(url);
        } catch (e) {
            return '';
        }
        var host = escapeHtml(u.hostname || 'Link');
        var safeUrl = escapeHtml(url);
        return (
            '<a class="cw-link-card" href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' +
            '<span class="cw-link-card-accent" aria-hidden="true"></span>' +
            '<span class="cw-link-card-body">' +
            '<span class="cw-link-card-title">' + host + '</span>' +
            '<span class="cw-link-card-sub">Web page</span>' +
            '<span class="cw-link-card-desc">' + safeUrl + '</span>' +
            '</span></a>'
        );
    }

    function resolveQuotedFromReply(message) {
        var pid = message && (message.in_reply_of != null ? message.in_reply_of : message.in_reply_to);
        if (pid == null || pid === '') return null;
        var list = widgetState && Array.isArray(widgetState.messages) ? widgetState.messages : [];
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (!m || m.id == null) continue;
            if (String(m.id) === String(pid)) {
                var author = (m.from_name && String(m.from_name).trim()) ? String(m.from_name).trim() : (function () {
                    var dd = m.direction ? String(m.direction).toLowerCase() : '';
                    var inbound = dd === 'inbound' || dd === 'incoming';
                    return inbound ? resolveAgentLabelForMessage(m) : getVisitorDisplayName();
                })();
                var txt = String(m.message || '').trim();
                if (txt.length > 220) txt = txt.slice(0, 220) + '…';
                return { author: author, text: txt };
            }
        }
        return { author: 'Message', text: 'Original message' };
    }

    function buildReplyQuoteHtml(message) {
        var pid = message && (message.in_reply_of != null ? message.in_reply_of : message.in_reply_to);
        if (pid == null || pid === '') return '';
        var q = resolveQuotedFromReply(message);
        if (!q) return '';
        return (
            '<div class="cw-quote-block">' +
            '<div class="cw-quote-author">' + escapeHtml(q.author) + '</div>' +
            '<div class="cw-quote-text">' + escapeHtml(q.text).replace(/\n/g, '<br>') + '</div>' +
            '</div>'
        );
    }

    function closeAllMessageMenus() {
        try {
            var openMenus = document.querySelectorAll('.cw-message-menu:not(.hidden)');
            for (var i = 0; i < openMenus.length; i++) {
                openMenus[i].classList.add('hidden');
            }
        } catch (e) {}
    }

    function ensureMessageMenuCloseHandlerInstalled() {
        if (widgetState && widgetState._menuCloseInstalled) return;
        if (!widgetState) widgetState = {};
        widgetState._menuCloseInstalled = true;
        document.addEventListener('click', function (e) {
            var t = e && e.target;
            if (!t) return closeAllMessageMenus();
            var insideMenu = t.closest && (t.closest('.cw-message-menu') || t.closest('[data-cw-menu-trigger="1"]'));
            if (insideMenu) return;
            closeAllMessageMenus();
        }, true);
        document.addEventListener('keydown', function (e) {
            if (e && e.key === 'Escape') closeAllMessageMenus();
        }, true);
    }

    function isWidgetBusinessOnline() {
        try {
            if (widgetState.widgetSettings && widgetState.widgetSettings.status === false) {
                return false;
            }
        } catch (e) {}
        return true;
    }

    function getMessageFromStateByWidgetId(wid) {
        var list = widgetState && Array.isArray(widgetState.messages) ? widgetState.messages : [];
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m && m.id != null && String(m.id) === String(wid)) return m;
        }
        return null;
    }

    function isInboundMessageObj(msg) {
        var d = msg && msg.direction ? String(msg.direction).toLowerCase() : '';
        return d === 'inbound' || d === 'incoming';
    }

    function updateMessageRowsSelectedClass() {
        var mc = document.getElementById('messagesContainer');
        if (!mc) return;
        var sel = widgetState.selectedMessageId;
        var rows = mc.querySelectorAll('.cw-msg-wrap');
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var id = r.getAttribute('data-message-id');
            if (sel && id === sel) r.classList.add('cw-msg-selected');
            else r.classList.remove('cw-msg-selected');
        }
    }

    function updateMessageSelectionUi() {
        var iw = document.getElementById('inputWrapper');
        var sf = document.getElementById('cwSelectionFooter');
        var rb = document.getElementById('cwReplyBar');
        var sel = widgetState.selectedMessageId;
        var hasReply = widgetState.pendingInReplyOf != null && String(widgetState.pendingInReplyOf) !== '';
        if (!iw || !sf) return;
        if (sel) {
            if (rb) rb.classList.add('hidden');
            iw.classList.add('hidden');
            sf.classList.remove('hidden');
            var msg = getMessageFromStateByWidgetId(sel);
            var pv = document.getElementById('cwSelectionPreview');
            if (pv) {
                var snippet = msg && msg.message ? String(msg.message) : '';
                if (snippet.length > 72) snippet = snippet.slice(0, 72) + '…';
                pv.textContent = snippet;
            }
            var inbound = msg && isInboundMessageObj(msg);
            var editBtn = document.getElementById('cwFooterEditBtn');
            var delBtn = document.getElementById('cwFooterDeleteBtn');
            if (editBtn) editBtn.classList.toggle('hidden', !!inbound);
            if (delBtn) delBtn.classList.toggle('hidden', !!inbound);
        } else {
            sf.classList.add('hidden');
            iw.classList.remove('hidden');
            if (rb) rb.classList.toggle('hidden', !hasReply);
        }
    }

    function selectMessageByWidgetId(id, toggle) {
        if (!id) return;
        if (toggle && widgetState.selectedMessageId === id) {
            widgetState.selectedMessageId = null;
        } else {
            widgetState.selectedMessageId = id;
        }
        closeAllMessageMenus();
        updateMessageSelectionUi();
        updateMessageRowsSelectedClass();
    }

    function applyReplyToMessage(msg) {
        if (!msg || msg.id == null) return;
        widgetState.pendingInReplyOf = String(msg.id);
        var rb = document.getElementById('cwReplyBar');
        var rbp = document.getElementById('cwReplyBarPreview');
        var snippet = msg.message ? String(msg.message) : '';
        if (snippet.length > 100) snippet = snippet.slice(0, 100) + '…';
        if (rbp) {
            var dd = msg.direction ? String(msg.direction).toLowerCase() : '';
            var inbound = dd === 'inbound' || dd === 'incoming';
            var author = (msg.from_name && String(msg.from_name).trim())
                ? String(msg.from_name).trim()
                : (inbound ? resolveAgentLabelForMessage(msg) : getVisitorDisplayName());
            rbp.innerHTML =
                '<div style="font-weight:700;color:#2563eb;font-size:13px;line-height:1.2;">' + escapeHtml(author) + '</div>' +
                '<div style="margin-top:2px;font-size:13px;color:#334155;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(snippet) + '</div>';
        }
        if (rb) rb.classList.remove('hidden');
    }

    function installMessagesContainerClickDelegation() {
        var mc = document.getElementById('messagesContainer');
        if (!mc || mc._cwRowSelectBound) return;
        mc._cwRowSelectBound = true;
        mc.addEventListener('click', function(ev) {
            if (!ev || !ev.target) return;
            var t = ev.target;
            if (t.closest && t.closest('a[href], .cw-link-card, button, .cw-message-menu, .cw-message-menu-trigger, textarea, input')) {
                return;
            }
            var wrap = t.closest && t.closest('.cw-msg-wrap');
            if (!wrap) return;
            if (wrap.classList.contains('cw-msg-interactive')) return;
            var mid = wrap.getAttribute('data-message-id');
            if (!mid || String(mid).indexOf('temp_') === 0) return;
            selectMessageByWidgetId(String(mid), true);
        });
    }

    var agentTypingHideTimer = null;
    function clearAgentTypingUi() {
        if (agentTypingHideTimer) {
            clearTimeout(agentTypingHideTimer);
            agentTypingHideTimer = null;
        }
        var el = document.getElementById('livechatTypingIndicator');
        if (el) {
            el.classList.add('hidden');
            el.style.display = 'none';
            el.textContent = '';
            el.innerHTML = '';
        }
    }

    function escapeTypingLabel(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function applyConversationTypingFromRealtime(data) {
        if (!data || String(data.conversation_number) !== String(widgetState.conversationNumber)) return;
        var el = document.getElementById('livechatTypingIndicator');
        if (!el) return;
        if (data.actor === 'agent' && data.typing) {
            var who = (data.label && String(data.label).trim()) ? String(data.label).trim() : 'Agent';
            el.innerHTML = '<span class="lc-typing-label">' + escapeTypingLabel(who) + ' is typing</span>' +
                '<span class="lc-typing-dots" aria-hidden="true"><b></b><b></b><b></b></span>';
            el.classList.remove('hidden');
            el.style.display = 'flex';
            if (agentTypingHideTimer) clearTimeout(agentTypingHideTimer);
            agentTypingHideTimer = setTimeout(function() {
                clearAgentTypingUi();
            }, 5000);
        } else {
            clearAgentTypingUi();
        }
    }

    function updateOutboundTicksInRow(row, status) {
        if (!row || !row.querySelector) return;
        var host = row.querySelector('[data-outbound-ticks="1"]');
        if (host) {
            host.innerHTML = buildOutboundTicksHtml(status);
        }
    }

    function syncSingleMessageStatusInState(messageNumberStr, status, readAt) {
        var list = widgetState.messages;
        if (!Array.isArray(list)) return false;
        var found = false;
        var next = list.map(function(m) {
            if (!m || String(m.id) !== String(messageNumberStr)) return m;
            found = true;
            var o = Object.assign({}, m, { status: status });
            if (readAt) o.read_at = readAt;
            return o;
        });
        if (!found) return false;
        widgetState.messages = next;
        var mc = document.getElementById('messagesContainer');
        if (mc && mc.style.display !== 'none' && !mc.classList.contains('hidden')) {
            var row = mc.querySelector('[data-message-id="' + messageNumberStr + '"]');
            if (row && !row.querySelector('.cw-msg-row.cw-inbound')) {
                updateOutboundTicksInRow(row, status);
            }
        }
        return true;
    }

    function applyMessageStatusFromRealtime(data) {
        if (!data) return;
        var num = data.message_number != null ? String(data.message_number) : '';
        num = num.trim();
        var status = data.status ? String(data.status) : '';
        var readAt = data.read_at || null;
        if (!num || !status) return;
        syncSingleMessageStatusInState(num, status, readAt);
    }

    function buildInboundAvatarHtml() {
        var ag = widgetState && widgetState.assignedAgent;
        if (ag && ag.avatar_url) {
            return '<img class="cw-msg-avatar-img" src="' + escapeHtml(String(ag.avatar_url)) + '" alt="" width="28" height="28" loading="lazy" decoding="async"/>';
        }
        return '<svg viewBox="0 0 24 24" class="cw-msg-avatar-svg" aria-hidden="true"><path d="M12 12c2.8 0 5-2.2 5-5s-2.2-5-5-5-5 2.2-5 5 2.2 5 5 5zm0 2c-4.4 0-8 2.4-8 5.3V22h16v-2.7c0-2.9-3.6-5.3-8-5.3z" fill="rgba(0,0,0,0.35)"/></svg>';
    }
    
    function renderMessage(message) {
        var dir0 = message && message.direction ? String(message.direction).toLowerCase() : '';
        var isTimeline =
            dir0 === 'system' ||
            (message && message.assignment_tags) ||
            (message && message.status_log_tags);
        if (isTimeline) {
            var sysWrap = document.createElement('div');
            sysWrap.className = 'cw-msg-wrap cw-msg-system cw-msg-interactive w-full max-w-full animate-fade-in';
            if (message && message.id != null) {
                sysWrap.setAttribute('data-message-id', String(message.id));
            }
            var sysPill = document.createElement('div');
            sysPill.className = 'cw-system-pill';
            sysPill.setAttribute('role', 'status');
            sysPill.textContent = String((message && message.message) || '').trim();
            sysWrap.appendChild(sysPill);
            return sysWrap;
        }

        const isInbound = (function () {
            var d = message && message.direction ? String(message.direction).toLowerCase() : '';
            return d === 'inbound' || d === 'incoming';
        })();
        const messageDiv = document.createElement('div');
        messageDiv.className = 'cw-msg-wrap w-full max-w-full animate-fade-in';
        if (message && message.id != null) {
            messageDiv.setAttribute('data-message-id', String(message.id));
        }
        
        // Check if message is a file URL or has attachments
        const isFileUrl = message.message && (message.message.startsWith('http://') || message.message.startsWith('https://'));
        
        // Handle attachments - can be array or object
        let attachments = [];
        if (message.attachments) {
            if (Array.isArray(message.attachments)) {
                // Attachments is an array of URLs
                attachments = message.attachments;
            } else if (typeof message.attachments === 'string') {
                // Single attachment as string
                attachments = [message.attachments];
            } else if (typeof message.attachments === 'object') {
                // Attachments is an object with file IDs as keys
                attachments = Object.values(message.attachments);
            }
        }
        
        // If message itself is a URL and no attachments, treat it as attachment
        if (isFileUrl && attachments.length === 0) {
            attachments = [message.message];
        }
        
        let messageContent = '';
        let attachmentContent = '';

        // Parse interactive quick-reply markup from agent messages:
        // Supports:
        // - <strong>Title</strong>
        // - <small>Helper</small>
        // - <button type="quick_reply" ...> / quick_reply_send ...> — both prefill and send (visitor widget)
        function parseInteractiveMarkup(raw) {
            if (!raw || typeof raw !== 'string') return null;
            if (raw.indexOf('<button') === -1 && raw.indexOf('<strong>') === -1 && raw.indexOf('<small>') === -1) return null;
            const segments = [];
            const buttons = [];
            const re = /<(strong|small)>([\s\S]*?)<\/\1>|<button\s+type="([^"]+)"(?:\s+value="([^"]*)")?\s*>([\s\S]*?)<\/button>/gi;
            let lastIdx = 0;
            let match;
            while ((match = re.exec(raw)) !== null) {
                if (match.index > lastIdx) {
                    const t = raw.slice(lastIdx, match.index);
                    if (t) segments.push({ kind: 'text', content: t });
                }
                if (match[1]) {
                    segments.push({ kind: match[1].toLowerCase(), content: match[2] });
                } else if (match[3]) {
                    buttons.push({
                        type: String(match[3] || 'quick_reply'),
                        value: (match[4] != null ? String(match[4]) : ''),
                        label: String(match[5] || '')
                    });
                }
                lastIdx = re.lastIndex;
            }
            if (lastIdx < raw.length) {
                const t = raw.slice(lastIdx);
                if (t) segments.push({ kind: 'text', content: t });
            }
            return { segments, buttons };
        }

        const interactive = isInbound && message.message ? parseInteractiveMarkup(message.message) : null;
        
        // Helper function to format file size
        function formatFileSizeHelper(bytes) {
            if (!bytes || bytes === 0) return '';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }
        
        // Helper function to render a single attachment
        function renderAttachment(fileUrl) {
            // Check if it's an image type (png, jpg, jpeg, svg, webp)
            const imageExtensions = ['png', 'jpg', 'jpeg', 'svg', 'webp'];
            const urlLower = fileUrl.toLowerCase();
            const isImageType = imageExtensions.some(ext => urlLower.endsWith('.' + ext));
            
            if (isImageType) {
                // Image attachments - show image preview with transparent background
                return `<div class="mb-2"><img src="${escapeHtml(fileUrl)}" alt="Attachment" class="max-w-full h-auto rounded-lg cursor-pointer" onclick="window.open('${escapeHtml(fileUrl)}', '_blank')" style="max-height: 200px; object-fit: contain; background: transparent;"></div>`;
            } else {
                // Non-image attachments - use document design from chat-widget.html
                const fileName = fileUrl.split('/').pop() || 'Attachment';
                
                return `<div class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors duration-200 max-w-[250px] mb-2" style="background-color: #e5e7eb;" onclick="window.open('${escapeHtml(fileUrl)}', '_blank')">
                    <div class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md" style="background-color: #d1d5db;">
                        <svg viewBox="0 0 24 24" fill="none" class="w-[18px] h-[18px] stroke-[#666] stroke-[2] fill-none">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/>
                            <path d="M14 2v6h6"/>
                            <path d="M16 13H8"/>
                            <path d="M16 17H8"/>
                            <path d="M10 9H8"/>
                        </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-[13px] font-medium text-[var(--text-color)] m-0 mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap">${escapeHtml(fileName)}</div>
                    </div>
                </div>`;
            }
        }
        
        // Process all attachments
        if (attachments.length > 0) {
            // Render all attachments
            attachmentContent = attachments.map(url => renderAttachment(url)).join('');
            
            // Add message text if it exists and is not a file URL
            if (message.message && !isFileUrl) {
                messageContent = formatMessageBodyForWidget(message.message);
            }
        } else {
            // No attachments, just message text
            if (interactive) {
                messageContent = '';
            } else {
                messageContent = formatMessageBodyForWidget(message.message || '');
            }
        }

        var replyQuoteHtml = buildReplyQuoteHtml(message);
        var linkCardHtml = '';
        if (!interactive && message.message && !isFileUrl) {
            var firstUrl = extractFirstHttpUrl(message.message);
            if (firstUrl) {
                linkCardHtml = buildLinkPreviewCardHtml(firstUrl);
            }
        }
            if (isInbound) {
            var inboundClock = formatMessageClock(message.created_at);
            var inboundTitle = escapeHtml(String(message.created_at || ''));
            var agentLabel = resolveAgentLabelForMessage(message);
            var menuId = 'cw_menu_' + (message && message.id != null ? String(message.id) : ('tmp_' + Math.random().toString(16).slice(2)));
            var midStr = (message && message.id != null) ? String(message.id) : '';
                var inboundFooterHtml = '<div class="cw-bubble-footer cw-bubble-footer-in">' +
                    '<span class="cw-time" title="' + inboundTitle + '">' + escapeHtml(inboundClock) + '</span>' +
                    '</div>';
            var interactiveInbound = !!interactive;
            var hasStaticBubble = !!(replyQuoteHtml || attachmentContent || messageContent || linkCardHtml);
            var bubbleInner = '';
            if (interactiveInbound) {
                bubbleInner = '<div class="cw-bubble-in cw-bubble-in--interactive" data-cw-interactive="1"></div><div class="cw-quick-replies" aria-label="Quick replies"></div>';
            } else if (hasStaticBubble) {
                bubbleInner = '<div class="cw-bubble-in">' + replyQuoteHtml + attachmentContent + (messageContent || '') + linkCardHtml + inboundFooterHtml + '</div>';
            }
            var inboundActionsHtml = '';
            if (!interactiveInbound) {
                inboundActionsHtml = `
                    <div class="cw-msg-actions">
                        <div class="relative">
                            <button type="button" data-cw-menu-trigger="1" class="cw-message-menu-trigger" aria-label="Message actions" onclick="chatWidget.toggleMessageMenu(event, '${menuId}')">
                                <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                            </button>
                            <div id="${menuId}" class="cw-message-menu cw-message-menu-left hidden" role="menu" aria-label="Message actions">
                                <button type="button" class="cw-message-menu-item" role="menuitem" onclick="event.stopPropagation();chatWidget.messageAction('reply','${midStr}')">
                                    <svg class="shrink-0 size-3.5" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m10 7-3 3 3 3"/><path d="M17 13v-1a2 2 0 0 0-2-2H7"/></svg>
                                    Reply
                                </button>
                            </div>
                        </div>
                    </div>`;
            }
            messageDiv.innerHTML = `
                <div class="cw-msg-row cw-inbound">
                    <div class="cw-msg-avatar" aria-hidden="true">${buildInboundAvatarHtml()}</div>
                    <div class="cw-msg-col">
                        <p class="mb-1.5 ps-2.5 text-xs text-slate-500 font-semibold">${escapeHtml(agentLabel)}</p>
                        ${bubbleInner}
                    </div>
                    ${inboundActionsHtml}
                </div>
            `;

            if (interactiveInbound) {
                messageDiv.classList.add('cw-msg-interactive');
                const bubble = messageDiv.querySelector('.cw-bubble-in[data-cw-interactive="1"]');
                if (bubble) {
                    bubble.removeAttribute('data-cw-interactive');
                    if (replyQuoteHtml) bubble.insertAdjacentHTML('beforeend', replyQuoteHtml);
                    if (attachmentContent) bubble.insertAdjacentHTML('beforeend', attachmentContent);
                }
                const frag = document.createElement('div');
                const segments = (interactive && interactive.segments) ? interactive.segments : [];
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    if (!seg || !seg.content) continue;
                    if (seg.kind === 'strong') {
                        const st = document.createElement('div');
                        st.style.fontWeight = '700';
                        st.innerHTML = escapeHtml(seg.content).replace(/\n/g, '<br>');
                        frag.appendChild(st);
                        continue;
                    }
                    if (seg.kind === 'small') {
                        const sm = document.createElement('div');
                        sm.style.opacity = '0.75';
                        sm.style.fontSize = '12px';
                        sm.style.marginTop = '6px';
                        sm.innerHTML = escapeHtml(seg.content).replace(/\n/g, '<br>');
                        frag.appendChild(sm);
                        continue;
                    }
                    const span = document.createElement('span');
                    span.innerHTML = escapeHtml(seg.content).replace(/\n/g, '<br>');
                    frag.appendChild(span);
                }
                if (bubble) {
                    bubble.appendChild(frag);
                }

                if (interactive.buttons && interactive.buttons.length) {
                    const quickWrap = messageDiv.querySelector('.cw-quick-replies');
                    if (quickWrap) {
                        for (let j = 0; j < interactive.buttons.length; j++) {
                            const bdef = interactive.buttons[j];
                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'cw-quick-reply-btn';
                            btn.textContent = (bdef && bdef.label) ? String(bdef.label) : 'Reply';
                            btn.onclick = function() {
                                const input = document.getElementById('chatInput');
                                if (input) {
                                    input.value = (bdef && bdef.value) ? String(bdef.value) : btn.textContent;
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    if (window.chatWidget && typeof window.chatWidget.toggleSendButton === 'function') {
                                        window.chatWidget.toggleSendButton();
                                    }
                                    input.focus();
                                }
                                var btnType = bdef ? String(bdef.type).toLowerCase() : '';
                                if (btnType === 'quick_reply_send' || btnType === 'quick_reply') {
                                    if (window.chatWidget && typeof window.chatWidget.sendMsg === 'function') {
                                        window.chatWidget.sendMsg();
                                    }
                                }
                            };
                            quickWrap.appendChild(btn);
                        }
                    }
                }
                if (bubble) bubble.insertAdjacentHTML('beforeend', inboundFooterHtml);
            }
        } else {
            var outStatus = message.status ? String(message.status).toLowerCase() : '';
            if (outStatus === 'received') {
                outStatus = 'delivered';
            }
            var tickHtml = buildOutboundTicksHtml(outStatus);
            var outClock = formatMessageClock(message.created_at);
            var outTitle = escapeHtml(String(message.created_at || ''));
            var outMenuId = 'cw_menu_' + (message && message.id != null ? String(message.id) : ('tmp_' + Math.random().toString(16).slice(2)));
            var midStrOut = (message && message.id != null) ? String(message.id) : '';
            var visName = escapeHtml(getVisitorDisplayName());
            var outBubbleInner = (replyQuoteHtml || messageContent || linkCardHtml || attachmentContent)
                ? ('<div class="cw-bubble-out">' + (replyQuoteHtml || '') + attachmentContent + (messageContent || '') + linkCardHtml +
                    '<div class="cw-bubble-footer">' +
                    '<span class="cw-time" title="' + outTitle + '">' + escapeHtml(outClock) + '</span>' +
                    '<span data-outbound-ticks="1">' + tickHtml + '</span></div></div>')
                : '';
            messageDiv.innerHTML = `
                <div class="cw-msg-row cw-outbound">
                    <div class="cw-msg-actions">
                        <div class="relative">
                            <button type="button" data-cw-menu-trigger="1" class="cw-message-menu-trigger" aria-label="Message actions" onclick="chatWidget.toggleMessageMenu(event, '${outMenuId}')">
                                <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                            </button>
                            <div id="${outMenuId}" class="cw-message-menu cw-message-menu-right hidden" role="menu" aria-label="Message actions">
                                <button type="button" class="cw-message-menu-item" role="menuitem" onclick="event.stopPropagation();chatWidget.messageAction('edit','${midStrOut}')">
                                    <svg class="shrink-0 size-3.5" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                                    Edit
                                </button>
                                <button type="button" class="cw-message-menu-item" role="menuitem" onclick="event.stopPropagation();chatWidget.messageAction('reply','${midStrOut}')">
                                    <svg class="shrink-0 size-3.5" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m10 7-3 3 3 3"/><path d="M17 13v-1a2 2 0 0 0-2-2H7"/></svg>
                                    Reply
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="cw-msg-col cw-outbound">
                        <p class="mb-1.5 pe-2.5 text-xs text-slate-500 font-semibold text-right">${visName}</p>
                        ${outBubbleInner}
                    </div>
                    <div class="cw-msg-avatar cw-out" aria-hidden="true">
                        <svg viewBox="0 0 24 24" class="cw-msg-avatar-svg" aria-hidden="true">
                            <path d="M12 12c2.8 0 5-2.2 5-5s-2.2-5-5-5-5 2.2-5 5 2.2 5 5 5zm0 2c-4.4 0-8 2.4-8 5.3V22h16v-2.7c0-2.9-3.6-5.3-8-5.3z" fill="rgba(0,0,0,0.35)"/>
                        </svg>
                    </div>
                </div>
            `;
        }
        
        return messageDiv;
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function syncAssignedAgentFromPayload(data) {
        if (!data || typeof data !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(data, 'assigned_agent')) {
            widgetState.assignedAgent = data.assigned_agent || null;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'assigned_agent_presence')) {
            widgetState.assignedAgentPresence = data.assigned_agent_presence || null;
        }
        updateAssignedAgentBarUi();
    }

    /** Messages header: agent avatar + name (Preline-style). */
    function syncWidgetMessagesHeaderForAssignee() {
        var sub = document.getElementById('widgetHeaderSubtitle');
        var title = document.getElementById('widgetHeaderTitle');
        if (!sub || !title) return;
        var messagesScreen = document.getElementById('messagesScreen');
        if (!messagesScreen || !messagesScreen.classList.contains('active')) {
            return;
        }

        var ag = widgetState.assignedAgent;
        var pr = widgetState.assignedAgentPresence;
        if (!ag || !ag.name) {
            var bn = (widgetState.widgetSettings && widgetState.widgetSettings.brand_name) ? String(widgetState.widgetSettings.brand_name) : 'Chat';
            title.textContent = bn;
            sub.textContent = isWidgetBusinessOnline() ? 'Online' : 'Away';
            return;
        }
        var online = pr && String(pr.state).toLowerCase() === 'online';
        title.textContent = String(ag.name);
        sub.textContent = online ? 'Online' : 'Away';
    }

    function updateAssignedAgentBarUi() {
        syncWidgetMessagesHeaderForAssignee();
        syncChatInputPlaceholder();

        var wrap = document.getElementById('cwHeaderAvatarWrap');
        var img = document.getElementById('cwHeaderAvatarImg');
        var dot = document.getElementById('cwHeaderPresenceDot');

        var bar = document.getElementById('assignedAgentBar');
        var nameEl = document.getElementById('assignedAgentName');
        var statusEl = document.getElementById('assignedAgentStatus');
        var av = document.getElementById('assignedAgentAvatar');
        if (!bar || !nameEl || !statusEl) return;

        var ag = widgetState.assignedAgent;
        var pr = widgetState.assignedAgentPresence;
        if (!ag || !ag.name) {
            bar.classList.add('hidden');
            bar.style.display = 'none';
            if (av) {
                av.classList.add('hidden');
                av.style.display = 'none';
                av.removeAttribute('src');
            }
            var ph = document.getElementById('cwHeaderAvatarPlaceholder');
            var mc0 = document.getElementById('messagesContainer');
            var onMessages = mc0 && mc0.style.display !== 'none' && !mc0.classList.contains('hidden');
            if (wrap && img && dot) {
                var onlineBiz = isWidgetBusinessOnline();
                if (onMessages) {
                    wrap.classList.remove('hidden');
                    img.classList.add('hidden');
                    img.removeAttribute('src');
                    if (ph) ph.classList.remove('hidden');
                    dot.classList.toggle('cw-away', !onlineBiz);
                } else {
                    wrap.classList.add('hidden');
                    if (ph) ph.classList.add('hidden');
                }
            }
            return;
        }

        nameEl.textContent = String(ag.name);
        var online = pr && String(pr.state).toLowerCase() === 'online';
        statusEl.textContent = online ? 'Online' : 'Offline';
        statusEl.className = 'text-[11px] leading-tight mt-0.5 ' + (online ? 'text-emerald-600 font-medium' : 'text-[var(--text-color)] opacity-65');

        var mc = document.getElementById('messagesContainer');
        if (!mc || mc.style.display === 'none' || mc.classList.contains('hidden')) {
            bar.classList.add('hidden');
            bar.style.display = 'none';
            if (wrap) wrap.classList.add('hidden');
            return;
        }

        if (av) {
            if (ag.avatar_url) {
                av.src = String(ag.avatar_url);
                av.alt = '';
                av.classList.remove('hidden');
                av.style.display = '';
            } else {
                av.removeAttribute('src');
                av.classList.add('hidden');
                av.style.display = 'none';
            }
        }

        if (wrap && img && dot) {
            var ph = document.getElementById('cwHeaderAvatarPlaceholder');
            wrap.classList.remove('hidden');
            if (ag.avatar_url) {
                if (ph) ph.classList.add('hidden');
                img.src = String(ag.avatar_url);
                img.alt = '';
                img.classList.remove('hidden');
            } else {
                img.removeAttribute('src');
                img.classList.add('hidden');
                if (ph) ph.classList.remove('hidden');
            }
            dot.classList.toggle('cw-away', !online);
        }

        bar.classList.remove('hidden');
        bar.style.display = 'none';
    }

    function syncChatInputPlaceholder() {
        var input = document.getElementById('chatInput');
        if (!input) return;
        var ag = widgetState && widgetState.assignedAgent;
        if (ag && ag.name) {
            input.placeholder = 'Message ' + String(ag.name).split(' ')[0];
        } else {
            input.placeholder = 'Message…';
        }
    }
    
    function applyMessagesApiPayload(data) {
        if (data.token) {
            saveSessionToken(data.token);
        }
        var prevConv = widgetState.conversationNumber != null ? String(widgetState.conversationNumber) : '';
        if (Object.prototype.hasOwnProperty.call(data, 'conversation_number')) {
            widgetState.conversationNumber = data.conversation_number;
        }
        syncAssignedAgentFromPayload(data);
        var nextConv = widgetState.conversationNumber != null ? String(widgetState.conversationNumber) : '';
        var convChanged = prevConv !== nextConv;
        if (convChanged || !realtimeSubscribedConv) {
            void syncLiveChatRealtimeSubscription();
        } else if (realtimePusher && realtimePusher.config && realtimePusher.config.auth && realtimePusher.config.auth.headers) {
            var tok = getSessionToken();
            if (tok) {
                realtimePusher.config.auth.headers.Authorization = 'Bearer ' + tok;
            }
        }
        return {
            messages: data.messages || [],
            conversation_number: data.conversation_number || null
        };
    }
    
    async function fetchMessages() {
        try {
            const session = await initializeChatSession();
            if (!session || !session.token) {
                throw new Error('No session token available');
            }
            
            const visitorId = session.visitor_id || getVisitorId();
            // Messages API endpoint (no channel ID in path)
            const response = await fetch(getMessagesApiUrl(visitorId), {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${session.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                // If unauthorized, try to reinitialize session
                if (response.status === 401) {
                    const storageKey = getStorageKey(STORAGE_SESSION_TOKEN_KEY);
                    localStorage.removeItem(storageKey);
                    const newSession = await initializeChatSession();
                    if (newSession && newSession.token) {
                        // Retry with new token
                        const retryResponse = await fetch(getMessagesApiUrl(newSession.visitor_id), {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${newSession.token}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        if (retryResponse.ok) {
                            const retryData = await retryResponse.json();
                            return applyMessagesApiPayload(retryData);
                        }
                    }
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return applyMessagesApiPayload(data);
        } catch (error) {
            cwError('Error fetching messages:', error);
            return {
                messages: [],
                conversation_number: null
            };
        }
    }

    async function fetchAgentMetaOnce() {
        try {
            if (!widgetState.conversationNumber) return;
            if (widgetState.currentScreen !== 'messages') return;
            var session = await initializeChatSession(false);
            if (!session || !session.token) return;
            var visitorId = session.visitor_id || getVisitorId();
            var url = getMessagesApiUrl(visitorId, { agentMetaOnly: true });
            var response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + session.token,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) return;
            var data = await response.json();
            syncAssignedAgentFromPayload(data);
        } catch (e) {}
    }

    async function postVisitorTypingToApi(typing) {
        try {
            if (!widgetState.conversationNumber) return;
            var session = await initializeChatSession(false);
            if (!session || !session.token) return;
            await fetch(getVisitorTypingApiUrl(), {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + session.token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ typing: !!typing })
            }).catch(function() {});
        } catch (e) {}
    }

    // Polling fallback for environments where realtime is not configured/working.
    // Keeps the widget responsive to agent replies and ensures "refresh" isn't required.
    let messagePollTimerId = null;
    let agentMetaPollTimerId = null;
    let messagePollInFlight = false;

    // Background unread polling (needed for guest sessions where realtime is disabled).
    // Runs even when widget is CLOSED so the launcher badge can update.
    let unreadPollTimerId = null;
    let unreadPollInFlight = false;
    const STORAGE_LAST_SEEN_MESSAGE_ID_KEY = 'last_seen_message_id';

    function getLastSeenMessageId() {
        try {
            return localStorage.getItem(getStorageKey(STORAGE_LAST_SEEN_MESSAGE_ID_KEY));
        } catch (e) {
            return null;
        }
    }

    function setLastSeenMessageId(id) {
        if (id == null) return;
        try {
            localStorage.setItem(getStorageKey(STORAGE_LAST_SEEN_MESSAGE_ID_KEY), String(id));
        } catch (e) {}
    }

    function isInboundDirectionForUnread(msg) {
        var d = msg && msg.direction ? String(msg.direction).toLowerCase() : '';
        return d === 'inbound' || d === 'incoming';
    }

    function computeUnreadCountFromMessages(messages, lastSeen) {
        if (!Array.isArray(messages) || messages.length === 0) return 0;
        if (lastSeen == null || String(lastSeen) === '') return 0;
        var lastSeenNum = Number(lastSeen);
        var hasNumeric = Number.isFinite(lastSeenNum);
        var unread = 0;
        for (var i = 0; i < messages.length; i++) {
            var m = messages[i];
            if (!m || m.id == null) continue;
            if (!isInboundDirectionForUnread(m)) continue;
            if (hasNumeric) {
                var idNum = Number(m.id);
                if (Number.isFinite(idNum) && idNum > lastSeenNum) unread++;
            } else {
                // Fallback: if ids are not numeric, treat any mismatch as "1 unread".
                if (String(m.id) !== String(lastSeen)) unread = 1;
            }
        }
        return unread;
    }

    function getLatestInboundId(messages) {
        if (!Array.isArray(messages) || messages.length === 0) return null;
        for (var i = messages.length - 1; i >= 0; i--) {
            var m = messages[i];
            if (m && m.id != null && isInboundDirectionForUnread(m)) {
                return m.id;
            }
        }
        return null;
    }

    async function markSeenUpTo(lastSeenInboundId) {
        try {
            if (!lastSeenInboundId) return;
            var session = await initializeChatSession(false);
            if (!session || !session.token) return;

            var url = getApiBaseUrl() + '/message/read';
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + session.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ last_seen_message_id: lastSeenInboundId })
            }).catch(function() {});
        } catch (e) {
            // ignore
        }
    }

    function stopUnreadPolling() {
        if (unreadPollTimerId) {
            clearInterval(unreadPollTimerId);
            unreadPollTimerId = null;
        }
    }

    async function pollUnreadOnce() {
        if (unreadPollInFlight) return;
        // Only when NOT actively viewing the thread.
        if (isViewingMessages()) return;

        unreadPollInFlight = true;
        try {
            const data = await fetchMessages();
            const fresh = (data && Array.isArray(data.messages)) ? data.messages : [];
            if (!fresh.length) return;

            // Keep widget cache fresh even while closed/minimized.
            // IMPORTANT: Do not update DOM here and do not advance last_seen_message_id.
            widgetState.messages = fresh;
            widgetState.conversationNumber = data.conversation_number || widgetState.conversationNumber || null;
            widgetState.messagesLoaded = true;

            const lastSeen = getLastSeenMessageId();
            const latestInboundId = getLatestInboundId(fresh);

            // First run: just establish baseline (avoid false unread spike).
            if (!lastSeen) {
                if (latestInboundId != null) setLastSeenMessageId(latestInboundId);
                setUnreadCount(0);
                return;
            }

            var unreadNow = computeUnreadCountFromMessages(fresh, lastSeen);
            var prevUnread = getUnreadCount();
            setUnreadCount(unreadNow);

            if (unreadNow > prevUnread) {
                // Only play sound when widget is closed OR not on messages screen
                if (!isWidgetOpen() || widgetState.currentScreen !== 'messages') {
                    playNotificationSound();
                }
            }

            // IMPORTANT: do NOT advance last_seen_message_id while widget is closed.
            // last_seen_message_id represents what the visitor has actually viewed.
        } catch (e) {
            // Ignore unread polling errors.
        } finally {
            unreadPollInFlight = false;
        }
    }

    function startUnreadPolling(intervalMs) {
        const ms = Math.max(2000, parseInt(String(intervalMs || 5000), 10) || 5000);
        if (unreadPollTimerId) return;
        unreadPollTimerId = setInterval(function () {
            void pollUnreadOnce();
        }, ms);
        void pollUnreadOnce();
    }

    function stopMessagePolling() {
        if (messagePollTimerId) {
            clearInterval(messagePollTimerId);
            messagePollTimerId = null;
        }
        stopAgentMetaPolling();
    }

    function stopAgentMetaPolling() {
        if (agentMetaPollTimerId) {
            clearInterval(agentMetaPollTimerId);
            agentMetaPollTimerId = null;
        }
    }

    function startAgentMetaPolling() {
        if (agentMetaPollTimerId) return;
        agentMetaPollTimerId = setInterval(function() {
            void fetchAgentMetaOnce();
        }, 25000);
        void fetchAgentMetaOnce();
    }

    async function pollMessagesOnce() {
        if (messagePollInFlight) return;
        if (!isWidgetOpen()) return;
        if (widgetState.currentScreen !== 'messages') return;

        messagePollInFlight = true;
        try {
            const data = await fetchMessages();
            const fresh = (data && Array.isArray(data.messages)) ? data.messages : [];

            const prev = Array.isArray(widgetState.messages) ? widgetState.messages : [];
            const prevLastId = prev.length ? prev[prev.length - 1]?.id : null;
            const nextLastId = fresh.length ? fresh[fresh.length - 1]?.id : null;

            // Only update DOM if something actually changed.
            if (String(prevLastId ?? '') !== String(nextLastId ?? '') || prev.length !== fresh.length) {
                widgetState.messages = fresh;
                widgetState.conversationNumber = data.conversation_number || widgetState.conversationNumber || null;
                widgetState.messagesLoaded = true;

                const mc = document.getElementById('messagesContainer');
                if (mc && mc.style.display !== 'none' && !mc.classList.contains('hidden')) {
                    displayMessages(fresh);
                }
            }

            // The widget is open and the visitor is on the messages screen, so
            // anything we just rendered is "seen". Advance the watermark so
            // the unread badge doesn't reappear the moment they close the
            // widget. (Without this, a poll-delivered message would inflate
            // the badge because last_seen still points at the previous reply.)
            if (isViewingMessages()) {
                const latestInboundIdSeen = getLatestInboundId(fresh);
                if (latestInboundIdSeen != null) {
                    const prevSeen = getLastSeenMessageId();
                    if (String(prevSeen ?? '') !== String(latestInboundIdSeen)) {
                        setLastSeenMessageId(latestInboundIdSeen);
                        void markSeenUpTo(latestInboundIdSeen);
                    }
                }
                clearUnreadCount();
            }
        } catch (e) {
            // Swallow polling errors; widget still works for sending.
        } finally {
            messagePollInFlight = false;
        }
    }

    function startMessagePolling(intervalMs) {
        const ms = Math.max(2000, parseInt(String(intervalMs || 5000), 10) || 5000);
        if (messagePollTimerId) return;
        messagePollTimerId = setInterval(function () {
            void pollMessagesOnce();
        }, ms);
        startAgentMetaPolling();
        // Kick once immediately so replies show up fast.
        void pollMessagesOnce();
    }
    
    function isLocalDevHost(host) {
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '';
    }
    
    function isDomainAllowed(settings) {
        if (!settings) return true;
        if (getApiConfig().skipAllowedDomainsCheck) return true;
        var list = settings.allowed_domains;
        if (!list || !Array.isArray(list) || list.length === 0) return true;
        var host = String(window.location.hostname || '').toLowerCase();
        // allowed_domains is for production; local / file / IPv6 loopback always show widget while developing
        if (isLocalDevHost(host)) return true;
        var ok = list.some(function(d) {
            var h = String(d || '').toLowerCase().trim();
            if (!h) return false;
            return host === h || host.endsWith('.' + h);
        });
        if (!ok) {
            cwWarn('ChatWidget: current host "' + host + '" is not in allowed_domains. Widget hidden. Add this host in the dashboard, test on localhost, or set ChatWidgetConfig.skipAllowedDomainsCheck = true');
        }
        return ok;
    }
    
    /** Public GET (no auth). Falls back to Bearer if server returns 401. */
    async function fetchWidgetSettingsFromApi() {
        const channelApiUrl = getChannelApiUrl();
        const url = `${channelApiUrl}/widget-settings`;
        try {
            var response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            if (response.status === 401) {
                var session = await initializeChatSession(false);
                if (session && session.token) {
                    response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': 'Bearer ' + session.token
                        }
                    });
                }
            }
            if (!response.ok) {
                cwWarn('ChatWidget: widget-settings HTTP', response.status);
                return null;
            }
            var data = await response.json();
            if (data.token) saveSessionToken(data.token);
            applyBroadcastingFromPayload(data);
            var out = data.widget_setting != null ? data.widget_setting : data;
            return out && typeof out === 'object' ? out : null;
        } catch (e) {
            cwError('ChatWidget: widget-settings', e);
            return null;
        }
    }
    
    function scheduleWidgetAutoOpen(settings) {
        if (widgetAutoOpenTimerId) {
            clearTimeout(widgetAutoOpenTimerId);
            widgetAutoOpenTimerId = null;
        }
        if (!settings || !settings.auto_open) return;
        var delaySec = 0;
        if (settings.delay && settings.delay.no_delay === true) {
            delaySec = 0;
        } else if (settings.delay && settings.delay.delay_seconds != null) {
            delaySec = parseInt(settings.delay.delay_seconds, 10) || 0;
        }
        var ms = delaySec * 1000;
        widgetAutoOpenTimerId = setTimeout(function() {
            widgetAutoOpenTimerId = null;
            var w = document.getElementById('chatWidget');
            if (w && w.classList.contains('hidden') && window.chatWidget) {
                window.chatWidget.toggleChat();
            }
        }, ms);
    }
    
    function applyWidgetSettings(settings) {
        if (!settings) return;
        var container = document.getElementById('chatWidgetContainer');
        if (!container) return;
        
        var colors = settings.colors;
        if (colors) {
            if (colors.primary) container.style.setProperty('--primary-color', colors.primary);
            if (colors.secondary) container.style.setProperty('--secondary-color', colors.secondary);
            if (colors.background) container.style.setProperty('--background-color', colors.background);
            if (colors.text) {
                container.style.setProperty('--text-color', colors.text);
                container.style.setProperty('--border-color', colors.text + '20');
            }
        }
        
        // Position (launcher + panel corners)
        var pos = settings.position || 'bottom-right';
        var posMap = {
            'bottom-right': ['fixed', 'z-[10000]', 'font-sans', 'bottom-5', 'right-5', 'chat-widget-container', 'bottom-right'],
            'bottom-left': ['fixed', 'z-[10000]', 'font-sans', 'bottom-5', 'left-5', 'chat-widget-container', 'bottom-left'],
            'top-right': ['fixed', 'z-[10000]', 'font-sans', 'top-5', 'right-5', 'chat-widget-container', 'top-right'],
            'top-left': ['fixed', 'z-[10000]', 'font-sans', 'top-5', 'left-5', 'chat-widget-container', 'top-left']
        };
        var cls = posMap[pos] || posMap['bottom-right'];
        container.className = cls.join(' ');
        container.setAttribute('data-background', 'no');
        
        if (settings.brand_name) {
            var ht = document.getElementById('widgetHeaderTitle');
            if (ht) ht.textContent = settings.brand_name;
        }
        syncChatInputPlaceholder();
        var titles = settings.titles;
        if (titles) {
            if (titles.heading) {
                var h = document.getElementById('widgetHomeHeading');
                if (h) h.textContent = titles.heading;
            }
            if (titles.sub_heading) {
                var sub = document.getElementById('widgetHomeSubheading');
                if (sub) {
                    sub.textContent = titles.sub_heading;
                    sub.classList.remove('hidden');
                }
                var extra = document.getElementById('widgetHomeExtraLine');
                if (extra) extra.style.display = 'none';
            } else {
                var subHide = document.getElementById('widgetHomeSubheading');
                if (subHide) {
                    subHide.textContent = '';
                    subHide.classList.add('hidden');
                }
                var extraEl = document.getElementById('widgetHomeExtraLine');
                if (extraEl) extraEl.style.display = '';
            }
        }
        
        var logoWrap = document.getElementById('widgetHomeLogoWrap');
        var logo = document.getElementById('widgetHomeLogo');
        if (settings.icon && logo && logoWrap) {
            logo.src = settings.icon;
            logo.alt = '';
            logoWrap.classList.remove('hidden');
        } else if (logoWrap) {
            logoWrap.classList.add('hidden');
            if (logo) logo.removeAttribute('src');
        }
        
        var kb = document.getElementById('widgetKnowledgeBaseRow');
        if (kb) kb.style.display = settings.knowledgebase === false ? 'none' : '';

        // Social options on home (no "Social" group row; show each enabled option directly).
        var social = settings.social || null;
        var waOn = !!(social && social.whatsapp && social.whatsapp.enabled);
        var tgOn = !!(social && social.telegram && social.telegram.enabled);
        var emOn = !!(social && social.email && social.email.enabled);
        var dmRow = document.getElementById('widgetDirectMessageRow');
        var waRow = document.getElementById('widgetWhatsAppRow');
        var tgRow = document.getElementById('widgetTelegramRow');
        var emRow = document.getElementById('widgetEmailRow');
        if (dmRow) dmRow.style.removeProperty('display');
        if (waRow) waRow.style.display = waOn ? '' : 'none';
        if (tgRow) tgRow.style.display = tgOn ? '' : 'none';
        if (emRow) emRow.style.display = emOn ? '' : 'none';

        var badge = document.getElementById('widgetStatusBadge');
        if (badge) {
            if (settings.status === false) {
                badge.textContent = 'Offline';
                badge.classList.remove('bg-black/25', 'text-white');
                badge.classList.add('bg-black/40', 'text-white/95');
            } else {
                badge.textContent = 'Online';
                badge.classList.add('bg-black/25', 'text-white');
                badge.classList.remove('bg-black/40', 'text-white/95');
            }
        }
        
        var offlineBanner = document.getElementById('widgetOfflineBanner');
        if (offlineBanner) {
            offlineBanner.style.display = settings.offline_business_hours === true ? 'block' : 'none';
        }
        
        updateFormFieldsVisibility(settings);
        widgetState.widgetSettings = settings;
        updateAssignedAgentBarUi();
    }

    function openExternalAndClose(url) {
        if (!url) return;
        try {
            window.open(url, '_blank', 'noopener');
        } catch (e) {}
        // Close widget after launching external channel to avoid leaving user on empty home.
        try {
            if (window.chatWidget && typeof window.chatWidget.toggleChat === 'function') {
                window.chatWidget.toggleChat();
            }
        } catch (e2) {}
    }

    function computeActiveHomeEntries(settings) {
        const social = settings && settings.social ? settings.social : null;
        const waOn = !!(social && social.whatsapp && social.whatsapp.enabled);
        const tgOn = !!(social && social.telegram && social.telegram.enabled);
        const emOn = !!(social && social.email && social.email.enabled);
        const kbOn = !!(settings && settings.knowledgebase);
        return { waOn, tgOn, emOn, kbOn };
    }

    async function maybeAutoOpenSingleEntry(settings) {
        if (!settings) return;
        // Only auto-open from the home selection screen.
        if (widgetState.currentScreen && widgetState.currentScreen !== 'home') return;

        const a = computeActiveHomeEntries(settings);
        const kbUrl = getKnowledgeBaseUrl();

        const active = [];
        if (a.waOn) active.push('whatsapp');
        if (a.tgOn) active.push('telegram');
        if (a.emOn) active.push('email');
        // Only count KB as actionable if we have a URL to open.
        if (a.kbOn && kbUrl) active.push('knowledgebase');

        if (active.length !== 1) return;

        const only = active[0];
        if (only === 'whatsapp') {
            await window.chatWidget.openWhatsApp();
            return;
        }
        if (only === 'telegram') {
            await window.chatWidget.openTelegram();
            return;
        }
        if (only === 'email') {
            await window.chatWidget.openEmail();
            return;
        }
        if (only === 'knowledgebase' && kbUrl) {
            openExternalAndClose(kbUrl);
        }
    }
    
    function applyWidgetSettingsAndGate(settings) {
        if (!settings) return true;
        var container = document.getElementById('chatWidgetContainer');
        if (!container) return false;
        if (!isDomainAllowed(settings)) {
            container.style.display = 'none';
            return false;
        }
        container.style.removeProperty('display');
        applyWidgetSettings(settings);
        return true;
    }
    
    async function loadWidgetSettingsOnBoot() {
        var key = getStorageKey(STORAGE_WIDGET_SETTINGS_KEY);
        var cached = null;
        try {
            var raw = localStorage.getItem(key);
            if (raw) cached = JSON.parse(raw);
        } catch (e) {}
        
        if (cached && typeof cached === 'object') {
            widgetState.widgetSettings = cached;
            if (applyWidgetSettingsAndGate(cached)) {
                scheduleWidgetAutoOpen(cached);
            }
        }
        
        var fresh = await fetchWidgetSettingsFromApi();
        if (fresh) {
            try {
                localStorage.setItem(key, JSON.stringify(fresh));
            } catch (e) {}
            widgetState.widgetSettings = fresh;
            if (applyWidgetSettingsAndGate(fresh)) {
                scheduleWidgetAutoOpen(fresh);
            }
        }
    }
    
    async function fetchWidgetSettings() {
        if (widgetState.widgetSettings) {
            return widgetState.widgetSettings;
        }
        var s = await fetchWidgetSettingsFromApi();
        if (s) widgetState.widgetSettings = s;
        return s;
    }
    
    function isFormRequired(settings) {
        if (!settings) {
            return false;
        }
        
        // Check if pre_chat_form exists
        const preChatForm = settings.pre_chat_form;
        if (!preChatForm) {
            return false;
        }
        
        // Check if any of email, phone, or name is enabled
        return preChatForm.email === true || preChatForm.phone === true || preChatForm.name === true;
    }
    
    function updateFormFieldsVisibility(settings) {
        if (!settings) return;
        
        const preChatForm = settings.pre_chat_form;
        if (!preChatForm) return;
        
        const nameField = document.getElementById('formName');
        const emailField = document.getElementById('formEmail');
        const phoneField = document.getElementById('formPhone');
        const messageField = document.getElementById('formMessage');
        
        // Message field is always visible when form is shown
        if (messageField) {
            const messageContainer = messageField.closest('.flex.flex-col');
            if (messageContainer) {
                messageContainer.style.display = 'flex';
            }
        }
        
        // Show/hide name field
        if (nameField) {
            const nameContainer = nameField.closest('.flex.flex-col');
            if (nameContainer) {
                if (preChatForm.name === true) {
                    nameContainer.style.display = 'flex';
                    nameField.required = preChatForm.name_required === true;
                } else {
                    nameContainer.style.display = 'none';
                    nameField.required = false;
                }
            }
        }
        
        // Show/hide email field
        if (emailField) {
            const emailContainer = emailField.closest('.flex.flex-col');
            if (emailContainer) {
                if (preChatForm.email === true) {
                    emailContainer.style.display = 'flex';
                    emailField.required = preChatForm.email_required === true;
                } else {
                    emailContainer.style.display = 'none';
                    emailField.required = false;
                }
            }
        }
        
        // Show/hide phone field
        if (phoneField) {
            const phoneContainer = document.getElementById('formPhoneRow') || phoneField.closest('.flex.flex-col');
            if (phoneContainer) {
                if (preChatForm.phone === true) {
                    phoneContainer.style.display = 'flex';
                    phoneField.required = preChatForm.phone_required === true;
                } else {
                    phoneContainer.style.display = 'none';
                    phoneField.required = false;
                }
            }
        }
    }
    
    async function editVisitorMessageApi(messageNo, text) {
        const session = await initializeChatSession();
        if (!session || !session.token) {
            throw new Error('No session token available');
        }
        const visitorId = session.visitor_id || getVisitorId();
        const url = getLivechatVisitorApiUrl('message/edit', visitorId);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + session.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message_no: String(messageNo), message: text })
        });
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const err = new Error((errorBody && errorBody.message) ? String(errorBody.message) : 'Edit failed');
            err.status = response.status;
            err.body = errorBody;
            throw err;
        }
        return response.json();
    }

    async function deleteVisitorMessageApi(messageNo) {
        const session = await initializeChatSession();
        if (!session || !session.token) {
            throw new Error('No session token available');
        }
        const visitorId = session.visitor_id || getVisitorId();
        const url = getLivechatVisitorApiUrl('message/delete', visitorId);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + session.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message_no: String(messageNo) })
        });
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const err = new Error((errorBody && errorBody.message) ? String(errorBody.message) : 'Delete failed');
            err.status = response.status;
            err.body = errorBody;
            throw err;
        }
        return response.json();
    }

    async function sendMessageToAPI(messageText, formData = {}, attachments = {}, opts = {}) {
        try {
            const session = await initializeChatSession();
            if (!session || !session.token) {
                throw new Error('No session token available');
            }
            
            const visitorId = session.visitor_id || getVisitorId();
            
            // Build request body with message and optional form fields
            const requestBody = {
                message: messageText || ''
            };
            
            // Add form fields if provided
            if (formData.name) requestBody.name = formData.name;
            if (formData.email) requestBody.email = formData.email;
            if (formData.phone) requestBody.phone = formData.phone;
            
            // Add attachments if provided
            if (attachments && Object.keys(attachments).length > 0) {
                requestBody.attachments = attachments;
            }

            if (opts && opts.in_reply_of != null && String(opts.in_reply_of) !== '') {
                requestBody.in_reply_of = String(opts.in_reply_of);
            }
            
            // Send message using POST to message endpoint (same as fetch but POST)
            const response = await fetch(getMessagesApiUrl(visitorId), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                // If unauthorized, try to reinitialize session
                if (response.status === 401) {
                    const storageKey = getStorageKey(STORAGE_SESSION_TOKEN_KEY);
                    localStorage.removeItem(storageKey);
                    const newSession = await initializeChatSession();
                    if (newSession && newSession.token) {
                        // Retry with new token
                        const retryResponse = await fetch(getMessagesApiUrl(newSession.visitor_id), {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${newSession.token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(requestBody)
                        });
                        if (retryResponse.ok) {
                            const retryData = await retryResponse.json();
                            // Update token if returned
                            if (retryData.token) {
                                saveSessionToken(retryData.token);
                            }
                            return retryData;
                        }
                    }
                }
                const err = new Error((errorBody && errorBody.message) ? String(errorBody.message) : `HTTP error! status: ${response.status}`);
                err.status = response.status;
                err.body = errorBody;
                throw err;
            }
            
            const data = await response.json();
            
            // Update token if returned in response
            if (data.token) {
                saveSessionToken(data.token);
            }

            void postVisitorPresence('online');
            
            return data;
        } catch (error) {
            cwError('Error sending message:', error);
            throw error;
        }
    }
    
    /**
     * After a realtime message event: update state and only append new inbound bubble(s) when possible
     * so we do not clear/rebuild the whole thread (avoids flash when the visitor's own send triggers a broadcast).
     */
    function applyRealtimeMessageListUpdate(messagesData, conv) {
        syncAssignedAgentFromPayload(messagesData || {});
        var messages = messagesData.messages || [];
        var prevList = widgetState.messages || [];
        var prevIdSet = new Set();
        for (var i = 0; i < prevList.length; i++) {
            var m = prevList[i];
            if (m && m.id != null && String(m.id).indexOf('temp_') !== 0) {
                prevIdSet.add(String(m.id));
            }
        }
        var newItems = messages.filter(function(msg) {
            return msg && msg.id != null && !prevIdSet.has(String(msg.id));
        });

        function isInboundDirection(msg) {
            var d = msg && msg.direction ? String(msg.direction).toLowerCase() : '';
            return d === 'inbound' || d === 'incoming';
        }

        // Unread counter + notification sound: only for new inbound items when visitor isn't actively viewing messages.
        if (newItems.length > 0) {
            var inboundCount = 0;
            for (var ni = 0; ni < newItems.length; ni++) {
                if (isInboundDirection(newItems[ni])) inboundCount++;
            }
            if (inboundCount > 0) {
                if (!isViewingMessages()) {
                    var lastSeen = getLastSeenMessageId();
                    var prevUnread = getUnreadCount();
                    var unreadNow = computeUnreadCountFromMessages(messages, lastSeen);
                    setUnreadCount(unreadNow);
                    // Only play sound when widget is not open OR not on messages screen
                    if (unreadNow > prevUnread && (!isWidgetOpen() || widgetState.currentScreen !== 'messages')) {
                        playNotificationSound();
                    }
                } else {
                    clearUnreadCount();
                    var lastInbound = getLatestInboundId(messages);
                    if (lastInbound != null) {
                        setLastSeenMessageId(lastInbound);
                        void markSeenUpTo(lastInbound);
                    }
                }
            }
        }
        widgetState.messages = messages;
        widgetState.conversationNumber = messagesData.conversation_number || conv;
        widgetState.messagesLoaded = true;
        var mc = document.getElementById('messagesContainer');
        if (!mc || mc.style.display === 'none' || mc.classList.contains('hidden')) {
            return;
        }
        // When polling won the race and already merged the new message into
        // widgetState.messages, `newItems` will be empty. Re-derive the diff
        // from what is actually rendered in the DOM so we still append the
        // missing bubbles.
        if (newItems.length === 0) {
            var renderedIds = new Set();
            for (var rIdx = 0; rIdx < mc.children.length; rIdx++) {
                var rid = mc.children[rIdx].getAttribute('data-message-id');
                if (rid && rid.indexOf('temp_') !== 0) {
                    renderedIds.add(String(rid));
                }
            }
            newItems = messages.filter(function(msg) {
                return msg && msg.id != null && !renderedIds.has(String(msg.id));
            });
            if (newItems.length === 0) {
                return;
            }
        }
        var allInbound = newItems.every(function(msg) {
            return isInboundDirection(msg);
        });
        if (allInbound) {
            for (var j = 0; j < newItems.length; j++) {
                mc.appendChild(renderMessage(newItems[j]));
            }
            setTimeout(function() {
                mc.scrollTop = mc.scrollHeight;
            }, 50);
            return;
        }
        displayMessages(messages);
    }

    function updateBottomNavActive(tab) {
        var nav = document.getElementById('widgetBottomNav');
        if (!nav) return;
        var t;
        if (tab === 'messages') t = 'messages';
        else if (tab === 'help') t = 'help';
        else t = 'home';
        var buttons = nav.querySelectorAll('button[data-cw-nav]');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var isAct = btn.getAttribute('data-cw-nav') === t;
            btn.classList.toggle('cw-nav-active', isAct);
            if (isAct) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        }
    }
    
    function displayMessages(messages) {
        updateAssignedAgentBarUi();
        widgetState.selectedMessageId = null;
        updateMessageSelectionUi();
        updateMessageRowsSelectedClass();
        const messagesContainer = document.getElementById('messagesContainer');
        if (!messagesContainer) return;
        
        // Clear existing messages
        messagesContainer.innerHTML = '';
        
        if (!messages || messages.length === 0) {
            // Show empty white screen - just leave it empty
            syncChatInputPlaceholder();
            return;
        }

        function startOfDay(d) {
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
        function isSameDay(a, b) {
            return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        }
        function dayLabel(d) {
            var now = new Date();
            var today = startOfDay(now);
            var dd = startOfDay(d);
            var y = new Date(today);
            y.setDate(y.getDate() - 1);
            if (isSameDay(dd, today)) return 'Today';
            if (isSameDay(dd, y)) return 'Yesterday';
            try {
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
            } catch (e) {
                return d.toLocaleDateString();
            }
        }
        function insertDayPill(label) {
            var pill = document.createElement('div');
            pill.className = 'cw-date-pill';
            pill.textContent = label;
            messagesContainer.appendChild(pill);
        }
        
        // Render each message with day separators (Preline style)
        var lastDay = null;
        for (var i = 0; i < messages.length; i++) {
            var msg = messages[i];
            var d = msg && msg.created_at ? new Date(msg.created_at) : null;
            if (d && !isNaN(d.getTime())) {
                var dayKey = startOfDay(d).getTime();
                if (lastDay == null || lastDay !== dayKey) {
                    insertDayPill(dayLabel(d));
                    lastDay = dayKey;
                }
            }
            const messageElement = renderMessage(msg);
            messagesContainer.appendChild(messageElement);
        }
        
        syncChatInputPlaceholder();
        // Scroll to bottom
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    }
    
    /** Lazy-load emoji-picker-element (single ESM, includes data; no extra JSON fetch). */
    let emojiPickerImportPromise = null;
    function ensureEmojiPickerElement() {
        if (typeof customElements !== 'undefined' && customElements.get('emoji-picker')) {
            return Promise.resolve();
        }
        if (!emojiPickerImportPromise) {
            emojiPickerImportPromise = import(
                'https://cdn.jsdelivr.net/npm/emoji-picker-element@1.21.3/index.js'
            ).catch(function(err) {
                emojiPickerImportPromise = null;
                throw err;
            });
        }
        return emojiPickerImportPromise;
    }
    
    // Widget API
    window.chatWidget = {
        /**
         * Call when the host user logs out of your app (clear secure identity).
         * Clears ChatWidgetConfig.user / userHash, resets the secure-upgrade flag, and re-runs /init as a guest
         * so the inbox shows an anonymous visitor + offline until the tab pings online again.
         */
        resetHostUserIdentity: function () {
            try {
                removeLivechatPresenceTabRegistryEntry();
            } catch (eTab) {}
            livechatPresenceTabId = null;
            try {
                if (window.ChatWidgetConfig) {
                    window.ChatWidgetConfig.user = null;
                    window.ChatWidgetConfig.userHash = null;
                }
            } catch (eCfg) {}
            try {
                localStorage.removeItem(getStorageKey('secure_upgrade_done'));
                localStorage.removeItem(getStorageKey(STORAGE_SESSION_TOKEN_KEY));
            } catch (eLs) {}
            return initializeChatSession(true).then(function (session) {
                if (session && session.token) {
                    queueMicrotask(function () {
                        startVisitorPageAndPresenceTracking();
                    });
                }
                return session;
            });
        },
        toggleChat: function() {
            if (widgetAutoOpenTimerId) {
                clearTimeout(widgetAutoOpenTimerId);
                widgetAutoOpenTimerId = null;
            }
            const w = document.getElementById('chatWidget');
            const b = document.getElementById('chatWidgetButton');
            const isMobile = window.innerWidth <= 768;
            if (w.classList.contains('hidden')) {
                w.classList.remove('hidden');
                b.classList.add('open');
                if (isMobile) {
                    document.body.classList.add('chat-widget-open');
                }
                // If opening directly into messages screen, clear unread badge,
                // re-render from the cached state (which polling/WebSocket kept
                // up-to-date while closed), and resume live message polling.
                // Without this, the DOM keeps showing whatever was last rendered
                // because the realtime diff has nothing to append when polling
                // already merged the new message into `widgetState.messages`.
                if (widgetState.currentScreen === 'messages') {
                    clearUnreadCount();
                    // Visitor is viewing the thread; mark latest as seen to prevent badge bounce.
                    if (Array.isArray(widgetState.messages) && widgetState.messages.length) {
                        var lastInbound = getLatestInboundId(widgetState.messages);
                        if (lastInbound != null) {
                            setLastSeenMessageId(lastInbound);
                            void markSeenUpTo(lastInbound);
                        }
                    }
                    // Immediately repaint with whatever we already have…
                    if (Array.isArray(widgetState.messages)) {
                        displayMessages(widgetState.messages);
                    }
                    // …then pull a hot copy from the API and re-render if
                    // anything is newer than the cache (covers the race where
                    // polling raced the WS event and produced an empty diff).
                    void (async function() {
                        try {
                            var data = await fetchMessages();
                            var fresh = (data && Array.isArray(data.messages)) ? data.messages : [];
                            widgetState.messages = fresh;
                            widgetState.conversationNumber = data && data.conversation_number || widgetState.conversationNumber || null;
                            widgetState.messagesLoaded = true;
                            displayMessages(fresh);
                            var lastInboundFresh = getLatestInboundId(fresh);
                            if (lastInboundFresh != null) {
                                setLastSeenMessageId(lastInboundFresh);
                                void markSeenUpTo(lastInboundFresh);
                            }
                        } catch (e) {}
                    })();
                    // Keep the thread live while the widget is open.
                    startMessagePolling(5000);
                }
                stopUnreadPolling();
                // Session: use token from localStorage when present; only call /init when none exists
                void initializeChatSession(false).catch(function(err) {
                    cwError('ChatWidget: session init failed', err);
                });

                // If only one entry is enabled, auto-open it (skip home picker).
                void fetchWidgetSettings().then(function(s) {
                    return maybeAutoOpenSingleEntry(s);
                }).catch(function() {});
            } else {
                w.classList.add('hidden');
                b.classList.remove('open');
                stopMessagePolling();
                // Keep unread badge updated even when closed (guest sessions use polling).
                startUnreadPolling(5000);
                // Re-validate the realtime subscription on close so the WebSocket
                // keeps pushing inbound messages while the widget panel is hidden.
                void syncLiveChatRealtimeSubscription();
                if (isMobile) {
                    document.body.classList.remove('chat-widget-open');
                }
            }
        },
        
        sendMsg: async function() {
            const i = document.getElementById('chatInput');
            const b = document.getElementById('sendButton');
            if (!i || !b) {
                return;
            }
            this.toggleSendButton();
            const m = i.value.trim();
            if (!m) {
                return;
            }

            if (widgetState.editingMessageNumber) {
                const editNo = String(widgetState.editingMessageNumber);
                i.disabled = true;
                b.disabled = true;
                try {
                    const resp = await editVisitorMessageApi(editNo, m);
                    widgetState.editingMessageNumber = null;
                    i.value = '';
                    i.style.height = 'auto';
                    if (resp && resp.message && Array.isArray(widgetState.messages)) {
                        const sme = resp.message;
                        widgetState.messages = widgetState.messages.map(function(mm) {
                            if (mm && String(mm.id) === String(sme.id)) {
                                return Object.assign({}, mm, {
                                    message: sme.message,
                                    status: sme.status || mm.status,
                                    read_at: sme.read_at != null ? sme.read_at : mm.read_at,
                                    in_reply_of: sme.in_reply_of != null ? sme.in_reply_of : mm.in_reply_of
                                });
                            }
                            return mm;
                        });
                        displayMessages(widgetState.messages);
                    }
                } catch (e) {
                    notifyUser('Could not update message.');
                } finally {
                    i.disabled = false;
                    b.disabled = false;
                    this.toggleSendButton();
                    i.focus();
                }
                return;
            }

            clearUnreadCount();
            const c = document.querySelector('.chat-widget-messages');
                
                // Disable input and button while sending
                i.disabled = true;
                b.disabled = true;
                b.classList.remove('enabled');
                
                // Show message instantly (optimistic update)
                // User's sent messages go on the right side with orange/red background - show loader instead of time
                const messageText = m;
                const messageId = 'temp_msg_' + Date.now();
                const d = document.createElement('div');
                d.className = 'cw-msg-wrap cw-msg-temp w-full max-w-full animate-fade-in';
                d.setAttribute('data-message-id', messageId);
                d.innerHTML = `
                    <div class="cw-msg-row cw-outbound">
                        <div class="cw-msg-actions">
                            <div class="relative">
                                <button type="button" class="cw-message-menu-trigger" aria-hidden="true" tabindex="-1" disabled>
                                    <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" aria-hidden="true"><circle cx="12" cy="5" r="1.6" fill="rgba(60,60,60,0.45)"/><circle cx="12" cy="12" r="1.6" fill="rgba(60,60,60,0.45)"/><circle cx="12" cy="19" r="1.6" fill="rgba(60,60,60,0.45)"/></svg>
                                </button>
                            </div>
                        </div>
                        <div class="cw-msg-col cw-outbound">
                            <div class="cw-out-name">${escapeHtml(getVisitorDisplayName())}</div>
                            <div class="cw-bubble-out">${escapeHtml(messageText).replace(/\n/g, '<br>')}
                                <div class="cw-bubble-footer">
                                    <span id="timeContainer_${messageId}" title="Sending"><span class="cw-status-sending" aria-label="Sending"></span></span>
                                    <span data-outbound-ticks="1"></span>
                                </div>
                            </div>
                        </div>
                        <div class="cw-msg-avatar cw-out" aria-hidden="true">
                            <svg viewBox="0 0 24 24" class="cw-msg-avatar-svg" aria-hidden="true"><path d="M12 12c2.8 0 5-2.2 5-5s-2.2-5-5-5-5 2.2-5 5 2.2 5 5 5zm0 2c-4.4 0-8 2.4-8 5.3V22h16v-2.7c0-2.9-3.6-5.3-8-5.3z" fill="rgba(0,0,0,0.35)"/></svg>
                        </div>
                    </div>
                `;
                c.appendChild(d);
                
                // Clear input
                i.value = '';
                i.style.height = 'auto';
                
                // Update send button state
                this.toggleSendButton();
                
                // Scroll to bottom
                c.scrollTop = c.scrollHeight;
                
                // Send to API (never block the user; retry with backoff on throttling/network).
                const timeContainer = document.getElementById(`timeContainer_${messageId}`);
                const trySend = async (attempt) => {
                    try {
                        const sendOpts = {};
                        if (widgetState.pendingInReplyOf != null && String(widgetState.pendingInReplyOf) !== '') {
                            sendOpts.in_reply_of = String(widgetState.pendingInReplyOf);
                        }
                        const response = await sendMessageToAPI(messageText, {}, {}, sendOpts);
                        if (sendOpts.in_reply_of) {
                            widgetState.pendingInReplyOf = null;
                            var rbp2 = document.getElementById('cwReplyBarPreview');
                            if (rbp2) rbp2.textContent = '';
                            var rb2 = document.getElementById('cwReplyBar');
                            if (rb2) rb2.classList.add('hidden');
                            updateMessageSelectionUi();
                        }
                        if (response && response.token) {
                            saveSessionToken(response.token);
                        }
                        if (response && Object.prototype.hasOwnProperty.call(response, 'conversation_number')) {
                            widgetState.conversationNumber = response.conversation_number;
                        }
                        syncAssignedAgentFromPayload(response || {});
                        clearAgentTypingUi();
                        void postVisitorTypingToApi(false);

                        // Merge server message into cache so WebSocket broadcast does not treat it as "new"
                        if (response && response.message) {
                            var sm = response.message;
                            widgetState.messages = widgetState.messages || [];
                            var real = {
                                id: sm.id,
                                message: sm.message,
                                direction: sm.direction || 'outgoing',
                                created_at: sm.created_at,
                                status: sm.status || 'Received',
                                read_at: sm.read_at || null,
                                in_reply_of: sm.in_reply_of != null ? sm.in_reply_of : null
                            };
                            widgetState.messages.push(real);
                            setLastSeenMessageId(sm.id);
                            await syncLiveChatRealtimeSubscription();
                            displayMessages(widgetState.messages);
                        } else {
                            if (timeContainer) {
                                timeContainer.innerHTML = '<span>Just now</span>';
                            }
                            if (widgetState.messages) {
                                widgetState.messages.push({
                                    id: messageId,
                                    message: messageText,
                                    direction: 'outgoing',
                                    created_at: new Date().toISOString()
                                });
                            }
                        }

                        return;
                    } catch (error) {
                        const status = error && typeof error === 'object' ? error.status : null;
                        const body = error && typeof error === 'object' ? error.body : null;
                        const msg = error && typeof error === 'object' && error.message ? String(error.message) : '';
                        const isThrottle =
                            status === 429 ||
                            msg.toLowerCase().includes('too many') ||
                            (body && typeof body === 'object' && String(body.error || body.message || '').toLowerCase().includes('too many'));

                        // Do not show an error to the visitor; keep retrying quietly.
                        if (timeContainer) {
                            timeContainer.innerHTML = '<span class="cw-status-sending" title="Sending" aria-label="Sending"></span>';
                        }
                        if (attempt >= 2) {
                            try {
                                var retryCfg = getApiConfig();
                                if (retryCfg.onNotify) {
                                    retryCfg.onNotify('Message is still sending. Check that the chat API is reachable.');
                                }
                            } catch (e) {}
                        }

                        const nextAttempt = (attempt || 0) + 1;
                        const base = isThrottle ? 1200 : 800;
                        const delay = Math.min(30000, base * Math.pow(2, Math.min(nextAttempt, 5)));
                        setTimeout(function() {
                            void trySend(nextAttempt);
                        }, delay);
                    }
                };

                void trySend(0);

                // Re-enable input and button immediately (sending continues in background if throttled).
                i.disabled = false;
                b.disabled = false;
                this.toggleSendButton();
                i.focus();
        },
        
        toggleSendButton: function() {
            const i = document.getElementById('chatInput');
            const b = document.getElementById('sendButton');
            if (i && b) {
                if (i.value.trim().length > 0) {
                    b.classList.add('enabled');
                } else {
                    b.classList.remove('enabled');
                }
            }
        },

        toggleMessageMenu: function (event, menuId) {
            try {
                ensureMessageMenuCloseHandlerInstalled();
                if (event && event.stopPropagation) event.stopPropagation();
                if (event && event.preventDefault) event.preventDefault();
                closeAllMessageMenus();
                var el = document.getElementById(String(menuId || ''));
                if (!el) return;
                el.classList.toggle('hidden');
            } catch (e) {}
        },

        closeMessageMenus: function () {
            closeAllMessageMenus();
        },

        clearMessageSelection: function () {
            widgetState.selectedMessageId = null;
            widgetState.editingMessageNumber = null;
            updateMessageSelectionUi();
            updateMessageRowsSelectedClass();
        },

        clearPendingReply: function () {
            widgetState.pendingInReplyOf = null;
            var rbp = document.getElementById('cwReplyBarPreview');
            if (rbp) rbp.innerHTML = '';
            var rb = document.getElementById('cwReplyBar');
            if (rb) rb.classList.add('hidden');
            updateMessageSelectionUi();
        },

        footerActionReply: function () {
            var sel = widgetState.selectedMessageId;
            if (!sel) return;
            var msg = getMessageFromStateByWidgetId(sel);
            applyReplyToMessage(msg);
            widgetState.selectedMessageId = null;
            closeAllMessageMenus();
            updateMessageSelectionUi();
            updateMessageRowsSelectedClass();
            var inp = document.getElementById('chatInput');
            if (inp) inp.focus();
        },

        footerActionEdit: function () {
            var sel = widgetState.selectedMessageId;
            if (!sel) return;
            var msg = getMessageFromStateByWidgetId(sel);
            if (!msg || isInboundMessageObj(msg)) return;
            widgetState.editingMessageNumber = String(sel);
            var inp = document.getElementById('chatInput');
            if (inp) {
                inp.value = msg.message ? String(msg.message) : '';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                if (window.chatWidget && typeof window.chatWidget.toggleSendButton === 'function') {
                    window.chatWidget.toggleSendButton();
                }
            }
            widgetState.selectedMessageId = null;
            widgetState.pendingInReplyOf = null;
            var rbp = document.getElementById('cwReplyBarPreview');
            if (rbp) rbp.innerHTML = '';
            var rb = document.getElementById('cwReplyBar');
            if (rb) rb.classList.add('hidden');
            updateMessageSelectionUi();
            updateMessageRowsSelectedClass();
            if (inp) inp.focus();
        },

        footerActionDelete: async function () {
            var sel = widgetState.selectedMessageId;
            if (!sel) return;
            var msg = getMessageFromStateByWidgetId(sel);
            if (!msg || isInboundMessageObj(msg)) return;
            if (!window.confirm('Delete this message?')) return;
            try {
                await deleteVisitorMessageApi(String(sel));
                widgetState.selectedMessageId = null;
                if (widgetState.messages && Array.isArray(widgetState.messages)) {
                    widgetState.messages = widgetState.messages.filter(function (m) {
                        return !m || String(m.id) !== String(sel);
                    });
                }
                var mc = document.getElementById('messagesContainer');
                if (mc) {
                    var row = mc.querySelector('[data-message-id="' + String(sel) + '"]');
                    if (row) row.remove();
                }
                updateMessageSelectionUi();
                updateMessageRowsSelectedClass();
            } catch (e) {
                notifyUser('Could not delete message.');
            }
        },

        messageAction: function (type, idStr) {
            closeAllMessageMenus();
            if (!type || idStr == null || idStr === '') return;
            var s = String(idStr);
            if (type === 'reply') {
                widgetState.selectedMessageId = s;
                this.footerActionReply();
                return;
            }
            if (type === 'edit') {
                widgetState.selectedMessageId = s;
                this.footerActionEdit();
                return;
            }
            if (type === 'delete') {
                widgetState.selectedMessageId = s;
                void this.footerActionDelete();
            }
        },
        
        showScreen: async function(screen) {
            const home = document.getElementById('homeScreen');
            const messages = document.getElementById('messagesScreen');
            const help = document.getElementById('helpScreen');
            const input = document.getElementById('inputContainer');
            const header = document.getElementById('mainHeader');
            const bottomNav = document.getElementById('widgetBottomNav');
            const formContainer = document.getElementById('formContainer');
            const messagesContainer = document.getElementById('messagesContainer');
            const loaderContainer = document.getElementById('loaderContainer');
            
            if (home && messages && input && header && formContainer && messagesContainer) {
                [home, messages, help].forEach(s => { if (s) s.classList.remove('active'); });
                
                if (screen === 'home') {
                    home.classList.add('active');
                    input.style.display = 'none';
                    if (bottomNav) bottomNav.style.display = 'flex';
                    // Hide header on home screen
                    header.classList.add('hide-on-home');
                    header.style.display = 'none';
                    var headerSub = document.getElementById('widgetHeaderSubtitle');
                    if (headerSub) headerSub.textContent = '';
                    clearAgentTypingUi();
                    widgetState.currentScreen = 'home';
                    stopMessagePolling();
                    widgetState.selectedMessageId = null;
                    widgetState.editingMessageNumber = null;
                    widgetState.pendingInReplyOf = null;
                    updateMessageSelectionUi();
                    updateMessageRowsSelectedClass();
                    updateBottomNavActive('home');
                } else if (screen === 'help') {
                    if (help) help.classList.add('active');
                    input.style.display = 'none';
                    input.classList.add('hidden');
                    if (bottomNav) bottomNav.style.display = 'flex';
                    header.classList.add('hide-on-home');
                    header.style.display = 'none';
                    var headerSubHelp = document.getElementById('widgetHeaderSubtitle');
                    if (headerSubHelp) headerSubHelp.textContent = '';
                    clearAgentTypingUi();
                    stopMessagePolling();
                    widgetState.currentScreen = 'help';
                    widgetState.selectedMessageId = null;
                    widgetState.editingMessageNumber = null;
                    widgetState.pendingInReplyOf = null;
                    updateMessageSelectionUi();
                    updateMessageRowsSelectedClass();
                    updateBottomNavActive('help');
                } else if (screen === 'messages') {
                    messages.classList.add('active');
                    installMessagesContainerClickDelegation();
                    // Visitor is now viewing the conversation; clear unread counter.
                    clearUnreadCount();
                    // Hide the bottom nav in conversation view (matches new design)
                    if (bottomNav) bottomNav.style.display = 'none';
                    // Show header only on messages screen
                    header.classList.remove('hide-on-home');
                    header.style.display = 'flex';
                    
                    // Check if we already have messages loaded (cached state)
                    if (widgetState.messagesLoaded && widgetState.messages !== null) {
                        // Use cached state - no need to fetch again
                        const hasConversationNumber = widgetState.conversationNumber !== null && 
                                                      widgetState.conversationNumber !== undefined && 
                                                      widgetState.conversationNumber !== '';
                        
                        // Hide loader
                        if (loaderContainer) {
                            loaderContainer.style.display = 'none';
                        }
                        
                        if (hasConversationNumber || sessionStorage.getItem('chatWidgetFormSubmitted') === 'true') {
                            // Show messages from cache
                            formContainer.classList.add('hidden');
                            formContainer.style.display = 'none';
                            messagesContainer.style.display = 'flex';
                            messagesContainer.classList.remove('hidden');
                            input.style.display = 'block';
                            input.classList.remove('hidden');
                            displayMessages(widgetState.messages);
                            var lastInboundCached = getLatestInboundId(widgetState.messages);
                            if (lastInboundCached != null) {
                                setLastSeenMessageId(lastInboundCached);
                                void markSeenUpTo(lastInboundCached);
                            }
                        } else if (widgetState.formRequired) {
                            // Show form from cache
                            formContainer.classList.remove('hidden');
                            formContainer.style.display = 'block';
                            formContainer.style.visibility = 'visible';
                            formContainer.style.opacity = '1';
                            
                            messagesContainer.style.display = 'none';
                            messagesContainer.classList.add('hidden');
                            input.style.display = 'none';
                            input.classList.add('hidden');
                            
                            if (widgetState.widgetSettings) {
                                updateFormFieldsVisibility(widgetState.widgetSettings);
                            }
                        } else {
                            // Show messages (empty)
                            formContainer.classList.add('hidden');
                            formContainer.style.display = 'none';
                            messagesContainer.style.display = 'flex';
                            messagesContainer.classList.remove('hidden');
                            input.style.display = 'block';
                            input.classList.remove('hidden');
                            displayMessages(widgetState.messages || []);
                        }
                        
                        widgetState.currentScreen = 'messages';
                        // Keep messages fresh while the widget is open.
                        startMessagePolling(5000);
                        updateBottomNavActive('messages');
                        return; // Exit early, no need to fetch
                    }
                    
                    // First time loading - show loader and fetch data
                    if (loaderContainer) {
                        loaderContainer.style.display = 'flex';
                    }
                    formContainer.classList.add('hidden');
                    formContainer.style.display = 'none';
                    messagesContainer.style.display = 'none';
                    messagesContainer.classList.add('hidden');
                    input.style.display = 'none';
                    input.classList.add('hidden');
                    
                    // Check if form was already submitted in this session
                    const formSubmitted = sessionStorage.getItem('chatWidgetFormSubmitted') === 'true';
                    
                    try {
                        if (formSubmitted) {
                            // Form already submitted, skip form and show messages
                            const messagesData = await fetchMessages();
                            
                            // Cache the state
                            widgetState.messages = messagesData.messages;
                            widgetState.conversationNumber = messagesData.conversation_number;
                            widgetState.messagesLoaded = true;
                            
                            // Hide loader
                            if (loaderContainer) {
                                loaderContainer.style.display = 'none';
                            }
                            
                            formContainer.classList.add('hidden');
                            formContainer.style.display = 'none';
                            messagesContainer.style.display = 'flex';
                            messagesContainer.classList.remove('hidden');
                            input.style.display = 'block';
                            input.classList.remove('hidden');
                            displayMessages(messagesData.messages);
                            var lastInboundFetched = getLatestInboundId(messagesData.messages);
                            if (lastInboundFetched != null) {
                                setLastSeenMessageId(lastInboundFetched);
                                void markSeenUpTo(lastInboundFetched);
                            }
                        } else {
                            // First check messages to see if conversation exists
                            const messagesData = await fetchMessages();
                            const hasConversationNumber = messagesData.conversation_number !== null && 
                                                          messagesData.conversation_number !== undefined && 
                                                          messagesData.conversation_number !== '';
                            
                            // Cache messages data
                            widgetState.messages = messagesData.messages;
                            widgetState.conversationNumber = messagesData.conversation_number;
                            
                            // Hide loader
                            if (loaderContainer) {
                                loaderContainer.style.display = 'none';
                            }
                            
                            if (!hasConversationNumber) {
                                // No conversation exists, check widget settings for pre_chat_form
                                const settings = await fetchWidgetSettings();
                                const formRequired = isFormRequired(settings);
                                
                                // Cache widget settings and form state
                                widgetState.widgetSettings = settings;
                                widgetState.formRequired = formRequired;
                                widgetState.messagesLoaded = true;
                                
                                if (formRequired) {
                                    // Show form with fields based on pre_chat_form settings
                                    formContainer.classList.remove('hidden');
                                    formContainer.style.display = 'block';
                                    formContainer.style.visibility = 'visible';
                                    formContainer.style.opacity = '1';
                                    
                                    // Hide messages and input
                                    messagesContainer.style.display = 'none';
                                    messagesContainer.classList.add('hidden');
                                    input.style.display = 'none';
                                    input.classList.add('hidden');
                                    
                                    // Update form fields visibility based on pre_chat_form
                                    updateFormFieldsVisibility(settings);
                                } else {
                                    // Form not required, show messages (empty)
                                    formContainer.classList.add('hidden');
                                    formContainer.style.display = 'none';
                                    messagesContainer.style.display = 'flex';
                                    messagesContainer.classList.remove('hidden');
                                    input.style.display = 'block';
                                    input.classList.remove('hidden');
                                    displayMessages(messagesData.messages);
                                    var lastInboundFetched2 = getLatestInboundId(messagesData.messages);
                                    if (lastInboundFetched2 != null) {
                                        setLastSeenMessageId(lastInboundFetched2);
                                        void markSeenUpTo(lastInboundFetched2);
                                    }
                                }
                            } else {
                                // Conversation exists, show messages directly
                                widgetState.messagesLoaded = true;
                                formContainer.classList.add('hidden');
                                formContainer.style.display = 'none';
                                messagesContainer.style.display = 'flex';
                                messagesContainer.classList.remove('hidden');
                                input.style.display = 'block';
                                input.classList.remove('hidden');
                                displayMessages(messagesData.messages);
                            }
                        }
                        
                        widgetState.currentScreen = 'messages';
                        // Keep messages fresh while the widget is open.
                        startMessagePolling(5000);
                        updateBottomNavActive('messages');
                    } catch (error) {
                        cwError('Error loading messages:', error);
                        // Hide loader on error
                        if (loaderContainer) {
                            loaderContainer.style.display = 'none';
                        }
                        // Show error state or fallback
                        formContainer.classList.add('hidden');
                        formContainer.style.display = 'none';
                        messagesContainer.style.display = 'flex';
                        messagesContainer.classList.remove('hidden');
                        displayMessages([]);
                        startMessagePolling(5000);
                        widgetState.currentScreen = 'messages';
                        updateBottomNavActive('messages');
                    }
                }
            }
        },

        openWhatsApp: async function() {
            try {
                const settings = await fetchWidgetSettings();
                const s = settings && settings.social && settings.social.whatsapp ? settings.social.whatsapp : null;
                const url = (s && s.url) ? String(s.url).trim() : '';
                const phone = (s && s.phone) ? String(s.phone).trim() : '';
                const target = url || (phone ? `https://wa.me/${encodeURIComponent(phone.replace(/[^\d+]/g, ''))}` : '');
                if (target) window.open(target, '_blank', 'noopener');
            } catch (e) {
                cwError('ChatWidget: openWhatsApp failed', e);
            }
        },

        openTelegram: async function() {
            try {
                const settings = await fetchWidgetSettings();
                const s = settings && settings.social && settings.social.telegram ? settings.social.telegram : null;
                const url = (s && s.url) ? String(s.url).trim() : '';
                const username = (s && s.username) ? String(s.username).trim() : '';
                const target = url || (username ? `https://t.me/${encodeURIComponent(username.replace(/^@/, ''))}` : '');
                if (target) window.open(target, '_blank', 'noopener');
            } catch (e) {
                cwError('ChatWidget: openTelegram failed', e);
            }
        },

        openEmail: async function() {
            try {
                const settings = await fetchWidgetSettings();
                const s = settings && settings.social && settings.social.email ? settings.social.email : null;
                const address = (s && s.address) ? String(s.address).trim() : '';
                if (address) window.location.href = `mailto:${encodeURIComponent(address)}`;
            } catch (e) {
                cwError('ChatWidget: openEmail failed', e);
            }
        },

        openKnowledgeBase: async function() {
            const url = getKnowledgeBaseUrl();
            if (url) {
                openExternalAndClose(url);
                return;
            }
            notifyUser('Knowledge base link is not configured.');
        },
        
        handleFormSubmit: async function(e) {
            e.preventDefault();
            const nameField = document.getElementById('formName');
            const emailField = document.getElementById('formEmail');
            const subjectField = document.getElementById('formSubject');
            const phoneField = document.getElementById('formPhone');
            const messageField = document.getElementById('formMessage');
            
            const name = nameField ? nameField.value.trim() : '';
            const email = emailField ? emailField.value.trim() : '';
            const subject = subjectField ? subjectField.value.trim() : '';
            const phone = phoneField ? phoneField.value.trim() : '';
            let message = messageField ? messageField.value.trim() : '';
            if (subject && message) {
                message = 'Subject: ' + subject + '\n\n' + message;
            } else if (subject && !message) {
                message = 'Subject: ' + subject;
            }
            
            // Check if required fields are filled (only check fields that are visible/required)
            let isValid = true;
            // Message is required
            if (!message) isValid = false;
            if (nameField && nameField.required && !name) isValid = false;
            if (emailField && emailField.required && !email) isValid = false;
            if (phoneField && phoneField.required && !phone) isValid = false;
            
            if (isValid && message) {
                // Store in sessionStorage for this session only
                sessionStorage.setItem('chatWidgetFormSubmitted', 'true');
                if (name) sessionStorage.setItem('chatWidgetUserName', name);
                if (email) sessionStorage.setItem('chatWidgetUserEmail', email);
                if (phone) sessionStorage.setItem('chatWidgetUserPhone', phone);
                
                const formContainer = document.getElementById('formContainer');
                const messagesContainer = document.getElementById('messagesContainer');
                const input = document.getElementById('inputContainer');
                
                if (formContainer && messagesContainer && input) {
                    // Disable submit button while sending
                    const submitButton = document.getElementById('formSubmitButton');
                    if (submitButton) {
                        submitButton.disabled = true;
                        submitButton.textContent = 'Sending...';
                    }
                    
                    // Send message with form data (message is required)
                    try {
                        // Do not block the user flow with errors; send and retry silently if throttled/network.
                        const trySend = async (attempt) => {
                            try {
                                await sendMessageToAPI(message, {
                                    name: name || undefined,
                                    email: email || undefined,
                                    phone: phone || undefined
                                });
                                return;
                            } catch (error) {
                                const status = error && typeof error === 'object' ? error.status : null;
                                const body = error && typeof error === 'object' ? error.body : null;
                                const msg = error && typeof error === 'object' && error.message ? String(error.message) : '';
                                const isThrottle =
                                    status === 429 ||
                                    msg.toLowerCase().includes('too many') ||
                                    (body && typeof body === 'object' && String(body.error || body.message || '').toLowerCase().includes('too many'));
                                const nextAttempt = (attempt || 0) + 1;
                                const base = isThrottle ? 1200 : 800;
                                const delay = Math.min(30000, base * Math.pow(2, Math.min(nextAttempt, 5)));
                                setTimeout(function() { void trySend(nextAttempt); }, delay);
                            }
                        };
                        void trySend(0);
                        
                        // On successful send, hide form and show messages
                        formContainer.classList.remove('active');
                        formContainer.classList.add('hidden');
                        formContainer.style.display = 'none';
                        messagesContainer.style.display = 'flex';
                        messagesContainer.classList.remove('hidden');
                        input.style.display = 'block';
                        input.classList.remove('hidden');
                        
                        // Fetch and display messages from API
                        const messagesData = await fetchMessages();
                        
                        // Update cached state
                        widgetState.messages = messagesData.messages;
                        widgetState.conversationNumber = messagesData.conversation_number;
                        widgetState.messagesLoaded = true;
                        
                        displayMessages(messagesData.messages);
                    } catch (error) {
                        cwError('Error sending form message:', error);
                        // Re-enable submit button on error
                        if (submitButton) {
                            submitButton.disabled = false;
                            submitButton.textContent = 'Send us a message';
                        }
                        // Do not show a blocking error to the visitor; keep UI responsive.
                        return;
                    }
                    
                    // Re-enable submit button
                    if (submitButton) {
                        submitButton.disabled = false;
                        submitButton.textContent = 'Send us a message';
                    }
                }
            }
        },
        
        showFileUploadPopup: function() {
            const popup = document.getElementById('fileUploadPopup');
            if (popup) {
                popup.classList.remove('hidden');
                // Initialize drag and drop
                this.initializeFileUpload();
            }
        },
        
        hideFileUploadPopup: function() {
            const popup = document.getElementById('fileUploadPopup');
            if (popup) {
                popup.classList.add('hidden');
            }
            // Clear file selection when closing
            this.clearFileSelection();
        },
        
        initializeFileUpload: function() {
            const dropZone = document.getElementById('fileUploadDropZone');
            if (!dropZone) return;
            
            // Remove existing listeners if any (by cloning)
            if (dropZone.hasAttribute('data-initialized')) {
                return; // Already initialized
            }
            
            // Mark as initialized
            dropZone.setAttribute('data-initialized', 'true');
            
            // Drag and drop handlers
            const preventDefaults = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, preventDefaults, false);
            });
            
            ['dragenter', 'dragover'].forEach(eventName => {
                dropZone.addEventListener(eventName, () => {
                    dropZone.classList.add('drag-over');
                }, false);
            });
            
            ['dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, () => {
                    dropZone.classList.remove('drag-over');
                }, false);
            });
            
            dropZone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                const files = dt.files;
                if (files.length > 0) {
                    const file = files[0];
                    // Validate file
                    const maxSize = 5 * 1024 * 1024;
                    if (file.size > maxSize) {
                        notifyUser('File size exceeds 5MB limit. Please choose a smaller file.');
                        return;
                    }
                    // Create a FileList-like object
                    const fileList = {
                        0: file,
                        length: 1,
                        item: function(index) { return index === 0 ? file : null; }
                    };
                    this.handleFileSelect({ target: { files: fileList } });
                }
            }, false);
        },
        
        
        handleFileSelect: function(event) {
            let file = null;
            if (event.target && event.target.files && event.target.files.length > 0) {
                file = event.target.files[0];
            } else if (event.target && event.target.files && Array.isArray(event.target.files) && event.target.files.length > 0) {
                file = event.target.files[0];
            }
            if (!file) return;
            
            // Validate file size (5MB = 5242880 bytes)
            const maxSize = 5 * 1024 * 1024;
            if (file.size > maxSize) {
                notifyUser('File size exceeds 5MB limit. Please choose a smaller file.');
                return;
            }
            
            // Validate file type - check by extension first, then MIME type
            const allowedExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|pdf|doc|docx|xls|xlsx|txt)$/i;
            const allowedMimeTypes = [
                'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
                'application/pdf',
                'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/plain'
            ];
            
            // Check by extension first (more reliable for some browsers)
            const hasValidExtension = allowedExtensions.test(file.name);
            // Check by MIME type (some files may have empty or incorrect MIME types)
            const hasValidMimeType = file.type && allowedMimeTypes.includes(file.type);
            
            // Allow if either extension or MIME type is valid
            if (!hasValidExtension && !hasValidMimeType) {
                notifyUser('File type not supported. Please upload images, PDF, documents, or text files.');
                return;
            }
            
            // Store selected file
            this.selectedFile = file;
            
            // Auto-upload file immediately
            this.uploadFile(file);
        },
        
        showFilePreview: function(file) {
            const placeholder = document.getElementById('fileUploadPlaceholder');
            const preview = document.getElementById('fileUploadPreview');
            const container = document.getElementById('filePreviewContainer');
            
            if (!placeholder || !preview || !container) return;
            
            placeholder.classList.add('hidden');
            preview.classList.remove('hidden');
            
            // Clear previous preview
            container.innerHTML = '';
            
            const isImage = file.type.startsWith('image/');
            
            if (isImage) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = 'file-preview-image';
                    img.alt = file.name;
                    container.appendChild(img);
                };
                reader.readAsDataURL(file);
            } else {
                // Show file icon and info
                const fileItem = document.createElement('div');
                fileItem.className = 'file-preview-item';
                
                const icon = document.createElement('div');
                icon.className = 'file-preview-icon';
                
                // Get file extension for icon
                const ext = file.name.split('.').pop().toLowerCase();
                let iconSvg = '';
                if (ext === 'pdf') {
                    iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>';
                } else if (['doc', 'docx'].includes(ext)) {
                    iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>';
                } else if (['xls', 'xlsx'].includes(ext)) {
                    iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>';
                } else {
                    iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>';
                }
                icon.innerHTML = iconSvg;
                
                const info = document.createElement('div');
                info.className = 'file-preview-info';
                
                const name = document.createElement('p');
                name.className = 'file-preview-name';
                name.textContent = file.name;
                
                const size = document.createElement('p');
                size.className = 'file-preview-size';
                size.textContent = this.formatFileSize(file.size);
                
                info.appendChild(name);
                info.appendChild(size);
                fileItem.appendChild(icon);
                fileItem.appendChild(info);
                container.appendChild(fileItem);
            }
        },
        
        formatFileSize: function(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        },
        
        clearFileSelection: function() {
            this.selectedFile = null;
            const placeholder = document.getElementById('fileUploadPlaceholder');
            const preview = document.getElementById('fileUploadPreview');
            const input = document.getElementById('fileUploadInput');
            
            if (placeholder) placeholder.classList.remove('hidden');
            if (preview) preview.classList.add('hidden');
            if (input) input.value = '';
        },
        
        uploadFile: async function(file) {
            if (!file) return;
            
            const placeholder = document.getElementById('fileUploadPlaceholder');
            const progress = document.getElementById('fileUploadProgress');
            const progressBar = document.getElementById('fileUploadProgressBar');
            
            if (!progress || !progressBar) return;
            
            // Show progress, hide placeholder
            if (placeholder) placeholder.classList.add('hidden');
            progress.classList.remove('hidden');
            progressBar.style.width = '0%';
            
            try {
                // Get session info
                const session = await initializeChatSession();
                if (!session || !session.token) {
                    throw new Error('Session not initialized');
                }
                
                // Create form data
                const formData = new FormData();
                formData.append('file', file);
                
                // Get upload URL
                const uploadUrl = getUploadApiUrl(session.visitor_id);
                
                // Upload file
                const xhr = new XMLHttpRequest();
                
                // Track upload progress
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = (e.loaded / e.total) * 100;
                        progressBar.style.width = percentComplete + '%';
                    }
                });
                
                // Handle response
                const uploadPromise = new Promise((resolve, reject) => {
                    xhr.onload = function() {
                        if (xhr.status === 200 || xhr.status === 201) {
                            try {
                                const response = JSON.parse(xhr.responseText);
                                // Check for success and path/url
                                if (response.success && (response.path || response.url)) {
                                    resolve(response);
                                } else {
                                    cwError('Upload response error:', response);
                                    reject(new Error('Upload failed: ' + (response.message || 'Unknown error')));
                                }
                            } catch (e) {
                                cwError('Failed to parse upload response:', e, xhr.responseText);
                                reject(new Error('Failed to parse response'));
                            }
                        } else if (xhr.status === 401) {
                            reject(new Error('UNAUTHORIZED'));
                        } else {
                            reject(new Error('Upload failed with status: ' + xhr.status));
                        }
                    };
                    
                    xhr.onerror = function() {
                        reject(new Error('Network error during upload'));
                    };
                    
                    xhr.open('POST', uploadUrl);
                    if (session.token) {
                        xhr.setRequestHeader('Authorization', 'Bearer ' + session.token);
                    } else if (session.session_key) {
                        xhr.setRequestHeader('X-Session-Key', session.session_key);
                    }
                    xhr.send(formData);
                });
                
                let uploadResponse;
                try {
                    uploadResponse = await uploadPromise;
                } catch (error) {
                    if (error.message === 'UNAUTHORIZED') {
                        const newSession = await initializeChatSession(true);
                        if (!newSession || !newSession.token) {
                            throw new Error('Failed to reinitialize session');
                        }
                        
                        const retryFormData = new FormData();
                        retryFormData.append('file', file);
                        
                        const retryXhr = new XMLHttpRequest();
                        retryXhr.upload.addEventListener('progress', (e) => {
                            if (e.lengthComputable) {
                                const percentComplete = (e.loaded / e.total) * 100;
                                progressBar.style.width = percentComplete + '%';
                            }
                        });
                        
                        const retryPromise = new Promise((resolve, reject) => {
                            retryXhr.onload = function() {
                                if (retryXhr.status === 200 || retryXhr.status === 201) {
                                    try {
                                        const response = JSON.parse(retryXhr.responseText);
                                        // Check for success and path/url
                                        if (response.success && (response.path || response.url)) {
                                            resolve(response);
                                        } else {
                                            cwError('Retry upload response error:', response);
                                            reject(new Error('Upload failed'));
                                        }
                                    } catch (e) {
                                        cwError('Failed to parse retry upload response:', e, retryXhr.responseText);
                                        reject(new Error('Failed to parse response'));
                                    }
                                } else {
                                    reject(new Error('Upload failed'));
                                }
                            };
                            retryXhr.onerror = function() {
                                reject(new Error('Network error'));
                            };
                            
                            retryXhr.open('POST', uploadUrl);
                            if (newSession.token) {
                                retryXhr.setRequestHeader('Authorization', 'Bearer ' + newSession.token);
                            } else if (newSession.session_key) {
                                retryXhr.setRequestHeader('X-Session-Key', newSession.session_key);
                            }
                            retryXhr.send(retryFormData);
                        });
                        
                        uploadResponse = await retryPromise;
                    } else {
                        throw error;
                    }
                }
                
                // File uploaded successfully
                progressBar.style.width = '100%';
                
                // Store uploaded file info temporarily
                this.uploadedFile = {
                    file: file,
                    response: uploadResponse
                };
                
                // Verify response has URL for images
                if (file.type.startsWith('image/') && !uploadResponse.url) {
                    cwWarn('Upload response missing URL field for image:', uploadResponse);
                }
                
                // Hide progress, show preview
                progress.classList.add('hidden');
                this.showFilePreviewInPopup(file, uploadResponse);
                
            } catch (error) {
                cwError('Error uploading file:', error);
                
                // Reset UI completely
                progress.classList.add('hidden');
                const preview = document.getElementById('fileUploadPreview');
                if (preview) {
                    preview.classList.add('hidden');
                }
                if (placeholder) {
                    placeholder.classList.remove('hidden');
                }
                
                // Clear uploaded file
                this.uploadedFile = null;
                this.selectedFile = null;
                
                // Reset file input
                const input = document.getElementById('fileUploadInput');
                if (input) {
                    input.value = '';
                }
                
                notifyUser('Failed to upload file. Please try again.');
            }
        },
        
        showFilePreviewInPopup: function(file, uploadResponse) {
            const preview = document.getElementById('fileUploadPreview');
            const container = document.getElementById('filePreviewContainer');
            const placeholder = document.getElementById('fileUploadPlaceholder');
            
            if (!preview || !container) {
                cwError('Preview elements not found');
                return;
            }
            
            // Verify upload response
            if (!uploadResponse || (!uploadResponse.path && !uploadResponse.url)) {
                cwError('Invalid upload response:', uploadResponse);
                // Show error state but don't hide preview - let user see what happened
                container.innerHTML = '<p class="text-sm text-red-500 text-center">Invalid upload response</p>';
                return;
            }
            
            // Hide placeholder, show preview
            if (placeholder) placeholder.classList.add('hidden');
            preview.classList.remove('hidden');
            container.innerHTML = '';
            
            const isImage = file.type.startsWith('image/');
            
            // Ensure we have the URL from the response
            const imageUrl = uploadResponse && uploadResponse.url ? uploadResponse.url : null;
            
            if (isImage && imageUrl) {
                // Show image preview using URL from response - no background
                const imgWrapper = document.createElement('div');
                imgWrapper.style.display = 'flex';
                imgWrapper.style.justifyContent = 'center';
                imgWrapper.style.alignItems = 'center';
                imgWrapper.style.width = '100%';
                imgWrapper.style.padding = '16px 0';
                imgWrapper.style.backgroundColor = 'transparent';
                
                const img = document.createElement('img');
                // Use the URL from the API response, not a local file URL
                img.src = imageUrl;
                img.alt = file.name;
                img.style.maxWidth = '100%';
                img.style.maxHeight = '250px';
                img.style.objectFit = 'contain';
                img.style.display = 'block';
                img.style.margin = '0 auto';
                img.style.background = 'transparent';
                
                // Handle image load error
                const self = this;
                img.onerror = function() {
                    cwError('Failed to load image preview from URL:', imageUrl);
                    // Fallback to file icon if image fails to load
                    imgWrapper.innerHTML = '';
                    const fallbackItem = self.createFilePreviewItem(file);
                    imgWrapper.appendChild(fallbackItem);
                };
                
                imgWrapper.appendChild(img);
                container.appendChild(imgWrapper);
            } else {
                // Show file preview using the design from chat-widget.html
                const fileItem = this.createFilePreviewItem(file);
                container.appendChild(fileItem);
            }
        },
        
        createFilePreviewItem: function(file) {
            const fileItem = document.createElement('div');
            fileItem.className = 'flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors duration-200 max-w-[250px]';
            fileItem.style.backgroundColor = '#e5e7eb';
            
            const iconWrapper = document.createElement('div');
            iconWrapper.className = 'w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md';
            iconWrapper.style.backgroundColor = '#d1d5db';
            
            const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            iconSvg.setAttribute('viewBox', '0 0 24 24');
            iconSvg.setAttribute('fill', 'none');
            iconSvg.className = 'w-[18px] h-[18px] stroke-[#666] stroke-[2] fill-none';
            
            const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path1.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z');
            
            const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path2.setAttribute('d', 'M14 2v6h6');
            
            const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path3.setAttribute('d', 'M16 13H8');
            
            const path4 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path4.setAttribute('d', 'M16 17H8');
            
            const path5 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path5.setAttribute('d', 'M10 9H8');
            
            iconSvg.appendChild(path1);
            iconSvg.appendChild(path2);
            iconSvg.appendChild(path3);
            iconSvg.appendChild(path4);
            iconSvg.appendChild(path5);
            iconWrapper.appendChild(iconSvg);
            
            const info = document.createElement('div');
            info.className = 'flex-1 min-w-0';
            
            const name = document.createElement('div');
            name.className = 'text-[13px] font-medium text-[var(--text-color)] m-0 mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap';
            name.textContent = file.name;
            
            const size = document.createElement('div');
            size.className = 'text-[11px] text-[#999] m-0';
            size.textContent = this.formatFileSize(file.size);
            
            info.appendChild(name);
            info.appendChild(size);
            fileItem.appendChild(iconWrapper);
            fileItem.appendChild(info);
            
            return fileItem;
        },
        
        sendFileMessage: async function() {
            if (!this.uploadedFile || !this.uploadedFile.response || !this.uploadedFile.response.path) {
                notifyUser('No file uploaded. Please upload a file first.');
                return;
            }
            
            const sendButton = document.getElementById('fileUploadSendButton');
            if (sendButton) {
                sendButton.disabled = true;
                sendButton.textContent = 'Sending...';
            }
            
            try {
                // Generate file ID
                const fileId = 'file_' + Date.now();
                
                // Prepare attachments payload with path
                const attachments = {};
                attachments[fileId] = this.uploadedFile.response.path;
                
                // Send message with attachment (empty message text) — never block; retry silently on throttling/network.
                const trySend = async (attempt) => {
                    try {
                        await sendMessageToAPI('', {}, attachments);
                        return;
                    } catch (error) {
                        const status = error && typeof error === 'object' ? error.status : null;
                        const body = error && typeof error === 'object' ? error.body : null;
                        const msg = error && typeof error === 'object' && error.message ? String(error.message) : '';
                        const isThrottle =
                            status === 429 ||
                            msg.toLowerCase().includes('too many') ||
                            (body && typeof body === 'object' && String(body.error || body.message || '').toLowerCase().includes('too many'));
                        const nextAttempt = (attempt || 0) + 1;
                        const base = isThrottle ? 1200 : 800;
                        const delay = Math.min(30000, base * Math.pow(2, Math.min(nextAttempt, 5)));
                        setTimeout(function() { void trySend(nextAttempt); }, delay);
                    }
                };
                void trySend(0);
                
                // Close popup
                this.hideFileUploadPopup();
                
                // Refresh messages
                const messagesData = await fetchMessages();
                widgetState.messages = messagesData.messages;
                widgetState.conversationNumber = messagesData.conversation_number;
                displayMessages(messagesData.messages);
                
            } catch (error) {
                cwError('Error sending file message:', error);
                // Do not show a blocking error to the visitor; keep UI responsive.
                if (sendButton) {
                    sendButton.disabled = false;
                    sendButton.textContent = 'Send';
                }
            }
        },
        
        clearFileSelection: function() {
            this.selectedFile = null;
            this.uploadedFile = null;
            const placeholder = document.getElementById('fileUploadPlaceholder');
            const preview = document.getElementById('fileUploadPreview');
            const progress = document.getElementById('fileUploadProgress');
            const input = document.getElementById('fileUploadInput');
            
            if (placeholder) placeholder.classList.remove('hidden');
            if (preview) preview.classList.add('hidden');
            if (progress) progress.classList.add('hidden');
            if (input) input.value = '';
        },
        
        toggleEmojiPicker: async function() {
            const container = document.getElementById('emojiPickerContainer');
            if (!container) return;
            
            if (container.style.display !== 'none') {
                this.hideEmojiPicker();
                return;
            }
            
            try {
                await ensureEmojiPickerElement();
            } catch (err) {
                cwError('ChatWidget: failed to load emoji picker', err);
                return;
            }
            
            this.showEmojiPicker();
        },
        
        showEmojiPicker: function() {
            const container = document.getElementById('emojiPickerContainer');
            if (!container) return;
            if (!customElements.get('emoji-picker')) {
                cwError('ChatWidget: emoji-picker custom element not registered');
                return;
            }
            
            const self = this;
            this.hideEmojiPicker();
            
            var formEmojiBtn = document.getElementById('cwFormEmojiBtn');
            var composerEmojiBtn = document.getElementById('cwComposerEmojiBtn');
            var fc = document.getElementById('formContainer');
            var formOpen = fc && !fc.classList.contains('hidden') && fc.style.display !== 'none';
            var emojiBtn = (formOpen && formEmojiBtn) ? formEmojiBtn : composerEmojiBtn;
            if (!emojiBtn) {
                cwError('ChatWidget: emoji button not found');
                return;
            }
            
            const rect = emojiBtn.getBoundingClientRect();
            const pickerW = 320;
            const pickerH = Math.min(380, Math.floor(window.innerHeight * 0.45));
            const spaceAbove = rect.top;
            const spaceBelow = window.innerHeight - rect.bottom;
            
            container.innerHTML = '';
            container.style.display = 'block';
            container.style.position = 'fixed';
            container.style.width = 'min(100%, ' + pickerW + 'px)';
            container.style.maxWidth = pickerW + 'px';
            container.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pickerW - 8)) + 'px';
            container.style.right = 'auto';
            if (spaceAbove >= pickerH + 12 || spaceAbove >= spaceBelow) {
                container.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
                container.style.top = 'auto';
            } else {
                container.style.top = (rect.bottom + 8) + 'px';
                container.style.bottom = 'auto';
            }
            container.style.zIndex = '10002';
            container.style.boxShadow = '0 8px 32px rgba(0,0,0,0.18)';
            container.style.borderRadius = '12px';
            container.style.overflow = 'hidden';
            
            const picker = document.createElement('emoji-picker');
            picker.style.width = '100%';
            picker.style.height = pickerH + 'px';
            picker.setAttribute('locale', 'en');
            picker.setAttribute('skin-tone-emoji', '👍');
            
            picker.addEventListener('emoji-click', function(event) {
                const d = event.detail;
                const unicode = d && (d.unicode || (d.emoji && d.emoji.unicode));
                if (unicode) {
                    self.insertEmoji(unicode);
                }
                self.hideEmojiPicker();
            });
            
            container.appendChild(picker);
            
            const closeOnOutsideClick = function(e) {
                var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
                var inside = path.length ? path.indexOf(container) !== -1 : container.contains(e.target);
                if (inside) return;
                if (e.target.closest && (e.target.closest('#cwComposerEmojiBtn') || e.target.closest('#cwFormEmojiBtn'))) return;
                self.hideEmojiPicker();
            };
            this._emojiPickerDocClick = closeOnOutsideClick;
            this._emojiPickerResizeHandler = function() {
                self.hideEmojiPicker();
            };
            window.addEventListener('resize', this._emojiPickerResizeHandler);
            
            setTimeout(function() {
                document.addEventListener('click', closeOnOutsideClick);
            }, 100);
        },
        
        hideEmojiPicker: function() {
            if (this._emojiPickerDocClick) {
                document.removeEventListener('click', this._emojiPickerDocClick);
                this._emojiPickerDocClick = null;
            }
            if (this._emojiPickerResizeHandler) {
                window.removeEventListener('resize', this._emojiPickerResizeHandler);
                this._emojiPickerResizeHandler = null;
            }
            const container = document.getElementById('emojiPickerContainer');
            if (container) {
                container.style.display = 'none';
                container.innerHTML = '';
            }
        },
        
        insertEmoji: function(emoji) {
            var fc = document.getElementById('formContainer');
            var formMsg = document.getElementById('formMessage');
            var formOpen = fc && !fc.classList.contains('hidden') && fc.style.display !== 'none';
            var textarea = (formOpen && formMsg) ? formMsg : document.getElementById('chatInput');
            if (!textarea) return;
            
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            
            // Insert emoji at cursor position
            textarea.value = text.substring(0, start) + emoji + text.substring(end);
            
            // Set cursor position after inserted emoji
            const newPosition = start + emoji.length;
            textarea.setSelectionRange(newPosition, newPosition);
            
            // Focus textarea
            textarea.focus();
            
            // Trigger input event to update send button state
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    };
    
    function initializeWidget() {
        // Wait a bit to ensure DOM is fully updated
        setTimeout(function() {
            // Ensure header is hidden on home screen (initial state)
            const header = document.getElementById('mainHeader');
            const homeScreen = document.getElementById('homeScreen');
            if (header && homeScreen && homeScreen.classList.contains('active')) {
                header.classList.add('hide-on-home');
            }

            // Home greeting name (uses pre-chat form name / session storage)
            try {
                var nameEl = document.getElementById('cwHomeVisitorName');
                if (nameEl) {
                    var n = getVisitorDisplayName();
                    // Avoid showing the default label "You" in the greeting.
                    if (n && n !== 'You') nameEl.textContent = n;
                    else nameEl.textContent = 'there';
                }
            } catch (e) {}
            
            // Initialize textarea auto-resize and send button
            const chatInput = document.getElementById('chatInput');
            if (chatInput) {
                var typingPulseTimer = null;
                var typingStopTimer = null;
                chatInput.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = this.scrollHeight + 'px';
                    if (window.chatWidget) {
                        window.chatWidget.toggleSendButton();
                    }
                    if (widgetState.conversationNumber) {
                        if (typingPulseTimer) clearTimeout(typingPulseTimer);
                        typingPulseTimer = setTimeout(function() {
                            void postVisitorTypingToApi(true);
                        }, 450);
                        if (typingStopTimer) clearTimeout(typingStopTimer);
                        typingStopTimer = setTimeout(function() {
                            void postVisitorTypingToApi(false);
                        }, 2200);
                    }
                });
                if (window.chatWidget) {
                    window.chatWidget.toggleSendButton();
                }
            }
        }, 100);
    }
    
})();
