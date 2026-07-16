(function() {
    'use strict';
    
    // API Configuration - Centralized endpoint management
    function getApiConfig() {
        // Check for global config object
        const config = window.ChatWidgetConfig || {};

        return {
            apiDomain: config.apiDomain || 'https://staging-back.nilaq.com/',
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
        } else if (widgetState.visitorChatPolicy !== 'multiple') {
            // Single-session: allow identity history. Multiple: latest/active thread only.
            u.searchParams.set('all', '1');
        }
        // Always scope to the open thread when known. Multiple-chat policy previously only
        // used selectedConversationNumber, so agent replies on conversationNumber never
        // appeared (API could resolve a different contact history thread).
        var convNum = opts.conversationNumber
            || widgetState.selectedConversationNumber
            || widgetState.conversationNumber
            || null;
        if (convNum) {
            u.searchParams.set('conversation_number', String(convNum));
        }
        return u.toString();
    }

    function getConversationsApiUrl(visitorId) {
        const config = getApiConfig();
        const channelId = config.channelId || getChannelId();
        const u = new URL(`${config.apiDomain}${config.apiBasePath}/${channelId}/conversations`);
        if (visitorId) u.searchParams.set('visitor_id', String(visitorId));
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
        selectedConversationNumber: null,
        formRequired: null,
        widgetSettings: null,
        visitorChatPolicy: 'single',
        currentScreen: null,
        messagesPane: null,
        conversations: [],
        messagesLoaded: false,
        attachments: {}, // Store uploaded attachments: { fileId: path }
        assignedAgent: null,
        assignedAgentPresence: null,
        selectedMessageId: null,
        highlightedReplyTargetId: null,
        pendingInReplyOf: null,
        editingMessageNumber: null,
        conversationStatus: null,
        canReply: true,
        canStartNewChat: false
    };
    
    // Reset state on page load (for fresh load)
    function resetWidgetState() {
        widgetState = {
            messages: null,
            conversationNumber: null,
            selectedConversationNumber: null,
            formRequired: null,
            widgetSettings: null,
            visitorChatPolicy: 'single',
            currentScreen: null,
            messagesPane: null,
            conversations: [],
            messagesLoaded: false,
            attachments: {},
            assignedAgent: null,
            assignedAgentPresence: null,
            selectedMessageId: null,
            highlightedReplyTargetId: null,
            pendingInReplyOf: null,
            editingMessageNumber: null,
            conversationStatus: null,
            canReply: true,
            canStartNewChat: false
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
            // If the widget is served over HTTPS, browsers will block ws:// as mixed content.
            // Prefer the current page protocol when deciding TLS.
            var useTls = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') || (bc.scheme || 'http') === 'https';
            var port = parseInt(bc.ws_port || '8080', 10);
            var host = bc.ws_host || '';
            // If backend returns localhost/127.0.0.1, prefer the API domain hostname first.
            // Using the current page hostname breaks embeds where the widget host != backend host.
            try {
                var pageHost = window.location && window.location.hostname ? String(window.location.hostname) : '';
                var apiHost = '';
                try {
                    if (apiDomain) apiHost = new URL(apiDomain).hostname || '';
                } catch (e2) {}
                if (!host || host === '127.0.0.1' || host === 'localhost' || host === '[::1]') {
                    if (apiHost) host = apiHost;
                    else if (pageHost) host = pageHost;
                }
            } catch (e) {}
            if (!host) host = '127.0.0.1';
            return {
                key: bc.key,
                opts: Object.assign({}, base, {
                    wsHost: host,
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
            ch.unbind('webrtc-signal');
            ch.unbind('conversation-status-updated');
            ch.bind('message-received', function(data) {
                if (!data || String(data.conversation_number) !== String(conv)) {
                    return;
                }
                if (data.is_private) {
                    return;
                }
                // Show agent text immediately from the websocket payload so the visitor
                // does not wait on the follow-up REST fetch (or a failed auth poll).
                try {
                    appendOptimisticAgentMessageFromRealtime(data);
                } catch (optErr) {
                    cwWarn('ChatWidget: optimistic agent message failed', optErr);
                }
                fetchMessages(conv).then(function(messagesData) {
                    try {
                        applyRealtimeMessageListUpdate(messagesData, conv);
                    } catch (applyErr) {
                        cwError('ChatWidget: realtime message apply failed', applyErr);
                        // Fallback: full redraw so agent replies still appear.
                        var list = (messagesData && messagesData.messages) || [];
                        widgetState.messages = list;
                        if (list.length) displayMessages(list);
                    }
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
                fetchMessages(conv).then(function(messagesData) {
                    applyRealtimeMessageListUpdate(messagesData, conv);
                }).catch(function() {});
            });
            ch.bind('conversation-status-updated', function(data) {
                if (!data || String(data.conversation_number) !== String(conv)) return;
                widgetState.conversationStatus = data.status || null;
                if (data.status === 'closed') {
                    widgetState.canReply = false;
                    appendConversationStatusSystemMessage(data);
                    showChatClosedConfirmation();
                } else if (data.status === 'open' || data.status === 'pending') {
                    widgetState.canReply = true;
                    if (widgetState.messagesPane === 'closed') {
                        widgetState.messagesPane = 'conversation';
                        applyMessagesPaneView('conversation');
                        if (Array.isArray(widgetState.messages)) {
                            displayMessages(widgetState.messages);
                        }
                    }
                }
                if (typeof updateAssignedAgentBarUi === 'function') updateAssignedAgentBarUi();
                if (typeof syncComposerFeatureButtons === 'function') syncComposerFeatureButtons();
            });
            ch.bind('webrtc-signal', function(data) {
                void handleVisitorWebRtcSignal(data);
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

            if (data.visitor_chat_policy) {
                widgetState.visitorChatPolicy = data.visitor_chat_policy;
            }
            if (Object.prototype.hasOwnProperty.call(data, 'can_start_new_chat')) {
                widgetState.canStartNewChat = data.can_start_new_chat === true;
            }
            if (Object.prototype.hasOwnProperty.call(data, 'conversation_number')) {
                widgetState.conversationNumber = data.conversation_number || null;
                if (!data.conversation_number) {
                    widgetState.messages = [];
                    widgetState.messagesLoaded = true;
                }
            }

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
                visitor_chat_policy: data.visitor_chat_policy || widgetState.visitorChatPolicy || 'single',
                has_active_conversation: data.has_active_conversation === true,
                can_start_new_chat: data.can_start_new_chat === true,
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

    var webrtcPeerConnection = null;
    var webrtcLocalStream = null;
    var webrtcRemoteAudioEl = null;
    var webrtcActiveCallId = null;
    var webrtcPendingOffer = null;
    var webrtcPendingIceCandidates = null;
    var webrtcIceServersCache = null;
    var webrtcInitPromise = null;
    var webrtcCallTimerId = null;
    var webrtcConnectedAt = null;
    var webrtcHangupSent = false;

    function isVoiceCallsEnabled() {
        var cfg = null;
        try { cfg = getApiConfig(); } catch (e) {}
        if (cfg && cfg.voiceCallEnabled === true) return true;
        var settings = widgetState && widgetState.widgetSettings;
        return !!(settings && settings.voice_call_enabled === true);
    }

    function isMediaUploadEnabled() {
        var settings = widgetState && widgetState.widgetSettings;
        if (!settings) return true;
        return settings.media_upload_enabled !== false;
    }

    function isVoiceMessageEnabled() {
        var settings = widgetState && widgetState.widgetSettings;
        if (!settings) return true;
        return settings.voice_message_enabled !== false;
    }

    function isShowAgentDetailEnabled() {
        var settings = widgetState && widgetState.widgetSettings;
        if (!settings) return true;
        return settings.show_agent_detail !== false;
    }

    function getBrandLogoUrl() {
        var settings = widgetState && widgetState.widgetSettings;
        if (!settings || !settings.icon) return '';
        var url = String(settings.icon).trim();
        return url || '';
    }

    function isShowTypingIndicatorEnabled() {
        var settings = widgetState && widgetState.widgetSettings;
        if (!settings) return false;
        return settings.show_typing_indicator === true;
    }

    function isShowCallIconEnabled() {
        var settings = widgetState && widgetState.widgetSettings;
        if (!settings) return true;
        return settings.show_call_icon !== false;
    }

    function isConversationReplyAllowed() {
        if (String(widgetState.conversationStatus || '').toLowerCase() === 'closed') {
            return false;
        }
        if (widgetState.canReply === false) return false;
        return true;
    }

    function syncComposerClosedState() {
        var input = document.getElementById('chatInput');
        var sendBtn = document.getElementById('sendButton');
        var allowed = isConversationReplyAllowed();
        if (input) {
            input.disabled = !allowed;
            if (!allowed) input.placeholder = 'This conversation is closed';
            else if (typeof syncChatInputPlaceholder === 'function') syncChatInputPlaceholder();
        }
        if (sendBtn) sendBtn.disabled = !allowed;
        var attachBtn = document.getElementById('cwComposerAttachBtn');
        var voiceBtn = document.getElementById('cwComposerVoiceBtn');
        var callBtn = document.getElementById('cwComposerCallBtn');
        if (attachBtn) attachBtn.disabled = !allowed || !isMediaUploadEnabled();
        if (voiceBtn) voiceBtn.disabled = !allowed || !isVoiceMessageEnabled();
        if (!allowed) {
            if (callBtn) callBtn.disabled = true;
        } else if (typeof syncComposerVoiceCallButton === 'function') {
            syncComposerVoiceCallButton();
        }
    }

    function appendConversationStatusSystemMessage(data) {
        if (!data) return;
        var text = data.message != null ? String(data.message).trim() : '';
        if (!text) {
            var status = String(data.status || '').toLowerCase();
            var actor = data.actor_name != null ? String(data.actor_name).trim() : '';
            if (status === 'closed') {
                text = actor ? ('Conversation closed by ' + actor) : 'Conversation closed';
            } else if (status === 'open') {
                text = actor ? ('Conversation opened by ' + actor) : 'Conversation opened';
            } else if (status === 'pending') {
                text = actor ? ('Conversation marked as pending by ' + actor) : 'Conversation marked as pending';
            } else {
                return;
            }
        }
        widgetState.messages = widgetState.messages || [];
        // Avoid duplicate if a matching status log already exists at the end.
        for (var i = widgetState.messages.length - 1; i >= 0 && i >= widgetState.messages.length - 3; i--) {
            var existing = widgetState.messages[i];
            if (existing && existing.status_log_tags && String(existing.message || '') === text) {
                return;
            }
        }
        var msg = {
            id: 'status-rt-' + Date.now(),
            message: text,
            direction: 'system',
            status_log_tags: true,
            status_log_data: {
                to_status: data.status || null,
                created_at: new Date().toISOString()
            },
            created_at: new Date().toISOString()
        };
        widgetState.messages.push(msg);
        var c = document.getElementById('messagesContainer');
        if (c && widgetState.messagesPane === 'conversation' && widgetState.currentScreen === 'messages') {
            var el = typeof renderMessage === 'function' ? renderMessage(msg) : null;
            if (el) {
                c.appendChild(el);
                if (typeof scrollMessagesToBottom === 'function') scrollMessagesToBottom();
            }
        }
    }

    function showChatClosedConfirmation() {
        widgetState.canReply = false;
        widgetState.conversationStatus = 'closed';
        widgetState.messagesPane = 'closed';
        applyMessagesPaneView('closed');
        if (typeof updateAssignedAgentBarUi === 'function') updateAssignedAgentBarUi();
        if (typeof syncComposerFeatureButtons === 'function') syncComposerFeatureButtons();
    }

    function syncComposerFeatureButtons() {
        var attachBtn = document.getElementById('cwComposerAttachBtn');
        var voiceBtn = document.getElementById('cwComposerVoiceBtn');
        var formAttach = document.querySelector('#preChatForm button[onclick*="showFileUploadPopup"]');
        if (attachBtn) attachBtn.style.display = isMediaUploadEnabled() ? '' : 'none';
        if (formAttach) formAttach.style.display = isMediaUploadEnabled() ? '' : 'none';
        if (voiceBtn) voiceBtn.style.display = isVoiceMessageEnabled() ? '' : 'none';
        syncComposerVoiceCallButton();
        syncComposerClosedState();
    }

    function formatVisitorCallDuration(totalSeconds) {
        var secs = Math.max(0, Math.floor(totalSeconds || 0));
        var mins = Math.floor(secs / 60);
        var rem = secs % 60;
        return String(mins).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
    }

    function updateVisitorCallBannerTimer() {
        var subEl = document.getElementById('cwVoiceCallBannerSub');
        if (!subEl || !webrtcConnectedAt) return;
        var elapsed = Math.floor((Date.now() - webrtcConnectedAt) / 1000);
        subEl.textContent = 'Connected · ' + formatVisitorCallDuration(elapsed);
    }

    function visitorCallDurationSeconds() {
        if (!webrtcConnectedAt) return 0;
        return Math.max(0, Math.floor((Date.now() - webrtcConnectedAt) / 1000));
    }

    function stopVisitorCallTimer() {
        if (webrtcCallTimerId) {
            clearInterval(webrtcCallTimerId);
            webrtcCallTimerId = null;
        }
        webrtcConnectedAt = null;
    }

    function startVisitorCallTimer() {
        if (webrtcCallTimerId) {
            clearInterval(webrtcCallTimerId);
            webrtcCallTimerId = null;
        }
        if (!webrtcConnectedAt) {
            webrtcConnectedAt = Date.now();
        }
        updateVisitorCallBannerTimer();
        webrtcCallTimerId = setInterval(updateVisitorCallBannerTimer, 1000);
    }

    function markVisitorCallConnected() {
        startVisitorCallTimer();
        showVisitorIncomingCallUi('connected');
    }

    function generateWebRtcCallId() {
        return 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function normalizeWebRtcSdpString(sdp) {
        var text = String(sdp || '').trim();
        if (!text) return '';

        if (text.indexOf('\\n') !== -1 || text.indexOf('\\r') !== -1) {
            text = text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');
        }

        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        if (text.indexOf('\n') === -1 && /\s(m=|a=|c=|b=)/.test(text)) {
            text = text
                .replace(/\s(?=m=)/g, '\n')
                .replace(/\s(?=a=)/g, '\n')
                .replace(/\s(?=c=)/g, '\n')
                .replace(/\s(?=b=)/g, '\n');
        }

        var lines = text.split('\n').map(function (line) { return line.replace(/\s+$/, ''); }).filter(function (line) {
            return line.length > 0 && line.indexOf('a=ssrc:') !== 0 && line.indexOf('a=ssrc-group:') !== 0;
        });

        return lines.join('\r\n') + '\r\n';
    }

    function normalizeWebRtcSessionDescription(input, fallbackType) {
        if (!input) return null;

        if (typeof input === 'string') {
            var sdpOnly = normalizeWebRtcSdpString(input);
            return sdpOnly ? { type: fallbackType, sdp: sdpOnly } : null;
        }

        if (typeof input !== 'object') return null;

        var nested = input.sdp;
        if (nested && typeof nested === 'object' && nested.sdp) {
            return normalizeWebRtcSessionDescription(nested, input.type || fallbackType);
        }

        var sdpText = '';
        if (typeof input.sdp === 'string') {
            sdpText = normalizeWebRtcSdpString(input.sdp);
        } else if (typeof nested === 'string') {
            sdpText = normalizeWebRtcSdpString(nested);
        }

        if (!sdpText) return null;
        return { type: input.type || fallbackType, sdp: sdpText };
    }

    function serializeWebRtcSessionDescription(desc) {
        if (!desc) return null;
        return normalizeWebRtcSessionDescription(desc, desc.type || 'offer');
    }

    function toWebRtcSessionDescription(input, fallbackType) {
        var normalized = normalizeWebRtcSessionDescription(input, fallbackType);
        if (!normalized) {
            throw new Error('Invalid remote session description');
        }
        return new RTCSessionDescription(normalized);
    }

    function buildVisitorAuthHeaders(session) {
        if (!session) return null;
        var headers = { 'Accept': 'application/json' };
        if (session.token) {
            headers.Authorization = 'Bearer ' + session.token;
        } else if (session.session_key) {
            headers['X-Session-Key'] = session.session_key;
        } else {
            return null;
        }
        return headers;
    }

    async function fetchWebRtcIceServers() {
        if (webrtcIceServersCache) return webrtcIceServersCache;
        var url = getChannelApiUrl() + '/webrtc/ice-servers';
        var session = await initializeChatSession(false);
        var headers = buildVisitorAuthHeaders(session);
        if (!headers) return null;
        var response = await fetch(url, { method: 'GET', headers: headers });
        if (response.status === 401) {
            session = await initializeChatSession(true);
            headers = buildVisitorAuthHeaders(session);
            if (!headers) return null;
            response = await fetch(url, { method: 'GET', headers: headers });
        }
        if (!response.ok) return null;
        var data = await response.json();
        webrtcIceServersCache = data.ice_servers || null;
        return webrtcIceServersCache;
    }

    async function postWebRtcSignal(payload) {
        var url = getChannelApiUrl() + '/webrtc/signal';
        var session = await initializeChatSession(false);
        var headers = buildVisitorAuthHeaders(session);
        if (!headers) return false;
        headers['Content-Type'] = 'application/json';
        var response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (response.status === 401) {
            session = await initializeChatSession(true);
            headers = buildVisitorAuthHeaders(session);
            if (!headers) return false;
            headers['Content-Type'] = 'application/json';
            response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
        }
        return response.ok;
    }

    function ensureVisitorVoiceCallBanner() {
        var banner = document.getElementById('cwVoiceCallBanner');
        if (banner) return banner;
        banner = document.createElement('div');
        banner.id = 'cwVoiceCallBanner';
        banner.className = 'cw-voice-call-banner hidden';
        banner.innerHTML =
            '<div class="cw-voice-call-banner-inner">' +
                '<div class="cw-voice-call-banner-text">' +
                    '<span id="cwVoiceCallBannerTitle">Incoming voice call</span>' +
                    '<span class="cw-voice-call-banner-sub" id="cwVoiceCallBannerSub">Agent is calling you</span>' +
                '</div>' +
                '<div class="cw-voice-call-actions" id="cwVoiceCallRingingActions">' +
                    '<button type="button" class="cw-voice-call-accept" id="cwVoiceCallAcceptBtn" title="Answer call" aria-label="Answer call">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z"/></svg>' +
                    '</button>' +
                    '<button type="button" class="cw-voice-call-decline" id="cwVoiceCallDeclineBtn" title="Decline call" aria-label="Decline call">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
                    '</button>' +
                '</div>' +
                '<button type="button" class="cw-voice-call-end hidden" id="cwVoiceCallEndBtn">End call</button>' +
            '</div>';
        var widget = document.getElementById('chatWidget');
        if (widget) {
            widget.insertBefore(banner, widget.firstChild);
        }
        var acceptBtn = document.getElementById('cwVoiceCallAcceptBtn');
        if (acceptBtn) {
            acceptBtn.addEventListener('click', function () {
                void acceptVisitorWebRtcCall();
            });
        }
        var declineBtn = document.getElementById('cwVoiceCallDeclineBtn');
        if (declineBtn) {
            declineBtn.addEventListener('click', function () {
                void declineVisitorWebRtcCall();
            });
        }
        var endBtn = document.getElementById('cwVoiceCallEndBtn');
        if (endBtn) {
            endBtn.addEventListener('click', function () {
                void endVisitorWebRtcCall(true);
            });
        }
        return banner;
    }

    function setVisitorCallBannerMode(mode) {
        var banner = ensureVisitorVoiceCallBanner();
        var titleEl = document.getElementById('cwVoiceCallBannerTitle');
        var subEl = document.getElementById('cwVoiceCallBannerSub');
        var ringingActions = document.getElementById('cwVoiceCallRingingActions');
        var endBtn = document.getElementById('cwVoiceCallEndBtn');
        var acceptBtn = document.getElementById('cwVoiceCallAcceptBtn');
        var declineBtn = document.getElementById('cwVoiceCallDeclineBtn');

        if (mode === 'ringing') {
            if (titleEl) titleEl.textContent = 'Incoming voice call';
            if (subEl) subEl.textContent = 'Tap answer to join';
            if (ringingActions) ringingActions.classList.remove('hidden');
            if (endBtn) endBtn.classList.add('hidden');
            if (acceptBtn) acceptBtn.disabled = false;
            if (declineBtn) declineBtn.disabled = false;
        } else if (mode === 'connecting') {
            if (titleEl) titleEl.textContent = 'Connecting…';
            if (subEl) subEl.textContent = 'Setting up your microphone';
            if (ringingActions) ringingActions.classList.add('hidden');
            if (endBtn) endBtn.classList.remove('hidden');
        } else if (mode === 'outbound') {
            if (titleEl) titleEl.textContent = 'Calling agent…';
            if (subEl) subEl.textContent = 'Waiting for agent to answer';
            if (ringingActions) ringingActions.classList.add('hidden');
            if (endBtn) endBtn.classList.remove('hidden');
        } else if (mode === 'connected') {
            if (titleEl) titleEl.textContent = 'On a voice call';
            if (subEl && !webrtcConnectedAt) subEl.textContent = 'Connected';
            updateVisitorCallBannerTimer();
            if (ringingActions) ringingActions.classList.add('hidden');
            if (endBtn) endBtn.classList.remove('hidden');
        }

        if (banner) banner.classList.remove('hidden');
    }

    function showVisitorIncomingCallUi(mode) {
        setVisitorCallBannerMode(mode || 'ringing');
        try {
            if (typeof chatWidget !== 'undefined' && chatWidget && typeof chatWidget.showScreen === 'function') {
                chatWidget.showScreen('messages');
            }
        } catch (e) {}
        try {
            if (typeof chatWidget !== 'undefined' && chatWidget && typeof chatWidget.toggleChat === 'function') {
                var widget = document.getElementById('chatWidget');
                if (widget && widget.classList.contains('hidden')) {
                    chatWidget.toggleChat();
                }
            }
        } catch (e) {}
    }

    function hideVisitorIncomingCallUi() {
        var banner = document.getElementById('cwVoiceCallBanner');
        if (banner) banner.classList.add('hidden');
    }

    function detachVisitorPeerConnectionHandlers(pc) {
        if (!pc) return;
        try {
            pc.onconnectionstatechange = null;
            pc.oniceconnectionstatechange = null;
            pc.onicecandidate = null;
            pc.ontrack = null;
        } catch (e) {}
    }

    async function drainVisitorPendingIceCandidates(pc) {
        if (!pc || !webrtcPendingIceCandidates || !webrtcPendingIceCandidates.length) return;
        var queued = webrtcPendingIceCandidates.slice();
        webrtcPendingIceCandidates = null;
        for (var i = 0; i < queued.length; i++) {
            try { await pc.addIceCandidate(new RTCIceCandidate(queued[i])); } catch (e) {}
        }
    }

    function stopVisitorWebRtcMedia() {
        if (webrtcLocalStream) {
            try {
                webrtcLocalStream.getTracks().forEach(function (track) { track.stop(); });
            } catch (e) {}
            webrtcLocalStream = null;
        }
        if (webrtcRemoteAudioEl) {
            try {
                webrtcRemoteAudioEl.pause();
                webrtcRemoteAudioEl.srcObject = null;
                if (webrtcRemoteAudioEl.parentNode) {
                    webrtcRemoteAudioEl.parentNode.removeChild(webrtcRemoteAudioEl);
                }
            } catch (e) {}
            webrtcRemoteAudioEl = null;
        }
        if (webrtcPeerConnection) {
            var closingPc = webrtcPeerConnection;
            detachVisitorPeerConnectionHandlers(closingPc);
            try { closingPc.close(); } catch (e) {}
            webrtcPeerConnection = null;
        }
        webrtcActiveCallId = null;
    }

    function cleanupVisitorWebRtcMedia() {
        stopVisitorCallTimer();
        stopVisitorWebRtcMedia();
        webrtcPendingOffer = null;
        webrtcPendingIceCandidates = null;
        webrtcHangupSent = false;
        hideVisitorIncomingCallUi();
        syncComposerVoiceCallButton();
    }

    async function postVisitorHangup(callId) {
        if (!callId || !widgetState.conversationNumber || webrtcHangupSent) return;
        webrtcHangupSent = true;
        var duration = visitorCallDurationSeconds();
        await postWebRtcSignal({
            type: 'hangup',
            from: 'visitor',
            call_id: callId,
            conversation_number: String(widgetState.conversationNumber),
            media: 'voice',
            duration: duration
        });
    }

    async function createVisitorPeerConnection(callId) {
        var iceServers = await fetchWebRtcIceServers();
        if (!iceServers || !iceServers.length) {
            throw new Error('ICE servers unavailable');
        }
        stopVisitorWebRtcMedia();
        webrtcActiveCallId = callId;
        var pc = new RTCPeerConnection({ iceServers: iceServers });
        webrtcPeerConnection = pc;
        pc.ontrack = function (event) {
            if (webrtcPeerConnection !== pc) return;
            if (!event.streams || !event.streams[0]) return;
            if (!webrtcRemoteAudioEl) {
                webrtcRemoteAudioEl = document.createElement('audio');
                webrtcRemoteAudioEl.autoplay = true;
                webrtcRemoteAudioEl.playsInline = true;
                webrtcRemoteAudioEl.style.display = 'none';
                document.body.appendChild(webrtcRemoteAudioEl);
            }
            webrtcRemoteAudioEl.srcObject = event.streams[0];
            void webrtcRemoteAudioEl.play().catch(function () {});
            markVisitorCallConnected();
        };
        pc.onicecandidate = function (event) {
            if (webrtcPeerConnection !== pc) return;
            if (!event.candidate || !widgetState.conversationNumber || !webrtcActiveCallId) return;
            void postWebRtcSignal({
                type: 'ice-candidate',
                from: 'visitor',
                call_id: webrtcActiveCallId,
                conversation_number: String(widgetState.conversationNumber),
                candidate: event.candidate.toJSON()
            });
        };
        var disconnectTimer = null;
        function scheduleVisitorDisconnectHangup() {
            if (disconnectTimer) return;
            disconnectTimer = setTimeout(function () {
                disconnectTimer = null;
                if (webrtcPeerConnection !== pc) return;
                var ice = pc.iceConnectionState;
                var conn = pc.connectionState;
                if (ice === 'connected' || ice === 'completed' || conn === 'connected') return;
                void endVisitorWebRtcCall(true);
            }, 2000);
        }
        pc.onconnectionstatechange = function () {
            if (webrtcPeerConnection !== pc) return;
            if (pc.connectionState === 'connected') {
                if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
                markVisitorCallConnected();
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                void endVisitorWebRtcCall(true);
            } else if (pc.connectionState === 'disconnected') {
                scheduleVisitorDisconnectHangup();
            }
        };
        pc.oniceconnectionstatechange = function () {
            if (webrtcPeerConnection !== pc) return;
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
                markVisitorCallConnected();
            } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                void endVisitorWebRtcCall(true);
            } else if (pc.iceConnectionState === 'disconnected') {
                scheduleVisitorDisconnectHangup();
            }
        };
        webrtcLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        webrtcLocalStream.getTracks().forEach(function (track) {
            webrtcPeerConnection.addTrack(track, webrtcLocalStream);
        });
        webrtcHangupSent = false;
        return webrtcPeerConnection;
    }

    async function acceptVisitorWebRtcCall() {
        if (!webrtcPendingOffer || !widgetState.conversationNumber) return;
        var offer = webrtcPendingOffer;
        webrtcPendingOffer = null;
        var acceptBtn = document.getElementById('cwVoiceCallAcceptBtn');
        var declineBtn = document.getElementById('cwVoiceCallDeclineBtn');
        if (acceptBtn) acceptBtn.disabled = true;
        if (declineBtn) declineBtn.disabled = true;
        showVisitorIncomingCallUi('connecting');
        try {
            var pc = await createVisitorPeerConnection(offer.call_id);
            await pc.setRemoteDescription(toWebRtcSessionDescription(offer.sdp, 'offer'));
            await drainVisitorPendingIceCandidates(pc);
            var answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await postWebRtcSignal({
                type: 'call-answer',
                from: 'visitor',
                call_id: offer.call_id,
                conversation_number: String(widgetState.conversationNumber),
                media: 'voice',
                sdp: serializeWebRtcSessionDescription(pc.localDescription)
            });
            markVisitorCallConnected();
        } catch (e) {
            cwError('ChatWidget: accept WebRTC call failed', e);
            notifyUser('Could not join the voice call. Please allow microphone access and try again.');
            await endVisitorWebRtcCall(true);
        }
    }

    async function declineVisitorWebRtcCall() {
        var pendingId = webrtcPendingOffer ? webrtcPendingOffer.call_id : null;
        webrtcPendingOffer = null;
        stopVisitorWebRtcMedia();
        hideVisitorIncomingCallUi();
        syncComposerVoiceCallButton();
        if (pendingId) {
            await postVisitorHangup(pendingId);
        }
        webrtcHangupSent = false;
    }

    async function handleVisitorWebRtcSignal(data) {
        if (!data || data.from === 'visitor') return;
        if (!widgetState.conversationNumber || String(data.conversation_number) !== String(widgetState.conversationNumber)) return;
        if (!isVoiceCallsEnabled()) return;

        try {
            if (data.type === 'call-offer') {
                var incomingCallId = data.call_id != null ? String(data.call_id) : '';
                if (webrtcPeerConnection && webrtcActiveCallId) {
                    if (incomingCallId && incomingCallId === String(webrtcActiveCallId)) return;
                    await endVisitorWebRtcCall(false);
                }
                stopVisitorWebRtcMedia();
                webrtcPendingOffer = {
                    call_id: data.call_id,
                    sdp: normalizeWebRtcSessionDescription(data.sdp, 'offer')
                };
                webrtcPendingIceCandidates = [];
                showVisitorIncomingCallUi('ringing');
            } else if (
                data.type === 'call-answer' &&
                webrtcPeerConnection &&
                String(data.call_id) === String(webrtcActiveCallId) &&
                data.sdp
            ) {
                await webrtcPeerConnection.setRemoteDescription(toWebRtcSessionDescription(data.sdp, 'answer'));
                await drainVisitorPendingIceCandidates(webrtcPeerConnection);
                markVisitorCallConnected();
            } else if (data.type === 'ice-candidate' && data.call_id && data.candidate) {
                // ICE can arrive while we're still ringing (no peer yet) or before remoteDescription is set.
                if (webrtcPendingOffer && String(data.call_id) === String(webrtcPendingOffer.call_id)) {
                    if (!webrtcPendingIceCandidates) webrtcPendingIceCandidates = [];
                    webrtcPendingIceCandidates.push(data.candidate);
                    return;
                }
                if (webrtcPeerConnection && String(data.call_id) === String(webrtcActiveCallId)) {
                    if (!webrtcPeerConnection.remoteDescription) {
                        if (!webrtcPendingIceCandidates) webrtcPendingIceCandidates = [];
                        webrtcPendingIceCandidates.push(data.candidate);
                        return;
                    }
                    try {
                        await webrtcPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (iceErr) {
                        cwWarn('ChatWidget: ignored ICE candidate', iceErr);
                    }
                }
            } else if (data.type === 'hangup') {
                var hangupId = data.call_id != null ? String(data.call_id) : '';
                var matchesActive = hangupId !== '' && hangupId === String(webrtcActiveCallId || '');
                var matchesPending = hangupId !== '' && webrtcPendingOffer && hangupId === String(webrtcPendingOffer.call_id || '');
                // Ignore hangups for other call ids (e.g. agent leftover outbound) so the
                // active visitor call is not cancelled while the agent is still ringing.
                if (matchesActive || matchesPending) {
                    await endVisitorWebRtcCall(false);
                }
            }
        } catch (e) {
            cwError('ChatWidget: WebRTC signal handling failed', e);
            await endVisitorWebRtcCall(false);
        }
    }

    async function startVisitorOutboundCall() {
        if (!isVoiceCallsEnabled()) return;
        if (!widgetState.conversationNumber) {
            notifyUser('Send a message first, then you can call the agent.');
            return;
        }
        if (webrtcPeerConnection || webrtcPendingOffer || webrtcActiveCallId) return;

        showVisitorIncomingCallUi('outbound');
        syncComposerVoiceCallButton();
        try {
            await maybeInitVisitorWebRtc();
            var callId = generateWebRtcCallId();
            var pc = await createVisitorPeerConnection(callId);
            var offer = await pc.createOffer({ offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            await postWebRtcSignal({
                type: 'call-offer',
                from: 'visitor',
                call_id: callId,
                conversation_number: String(widgetState.conversationNumber),
                media: 'voice',
                sdp: serializeWebRtcSessionDescription(pc.localDescription)
            });
        } catch (e) {
            cwError('ChatWidget: outbound WebRTC call failed', e);
            notifyUser('Could not start the voice call. Please allow microphone access and try again.');
            await endVisitorWebRtcCall(true);
        }
    }

    function syncComposerVoiceCallButton() {
        var btn = document.getElementById('cwComposerCallBtn');
        if (!btn) return;
        var enabled = isVoiceCallsEnabled() && isShowCallIconEnabled();
        var inCall = Boolean(webrtcPeerConnection || webrtcPendingOffer || webrtcActiveCallId);
        var hasConversation = Boolean(widgetState.conversationNumber);
        var onMessages = widgetState.currentScreen === 'messages';
        if (enabled && hasConversation && onMessages) {
            btn.classList.remove('hidden');
            btn.disabled = inCall;
            btn.title = inCall ? 'Call in progress' : 'Call agent';
        } else {
            btn.classList.add('hidden');
            btn.disabled = false;
        }
    }

    async function endVisitorWebRtcCall(sendHangup) {
        var callId = webrtcActiveCallId || (webrtcPendingOffer ? webrtcPendingOffer.call_id : null);
        // Capture duration before cleanup clears webrtcConnectedAt.
        if (sendHangup && callId) {
            await postVisitorHangup(callId);
        }
        cleanupVisitorWebRtcMedia();
    }

    async function maybeInitVisitorWebRtc() {
        if (!isVoiceCallsEnabled()) return;
        if (webrtcInitPromise) return webrtcInitPromise;
        webrtcInitPromise = (async function () {
            try {
                await fetchWebRtcIceServers();
            } catch (e) {
                cwError('ChatWidget: WebRTC init failed', e);
                webrtcInitPromise = null;
            }
        })();
        return webrtcInitPromise;
    }

    function initWidget() {
        injectStyles();
        createWidget();
        initializeWidget();
        void Promise.all([
            loadWidgetSettingsOnBoot(),
            initializeChatSession(false).catch(function () { return null; })
        ]).then(function (results) {
            var session = results[1];
            if (session && session.token) {
                queueMicrotask(function () {
                    startVisitorPageAndPresenceTracking();
                    void maybeInitVisitorWebRtc();
                });
            }
            return prefetchMessagesEntryState();
        }).catch(function () {});
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

            #livechatTypingIndicator.cw-typing-under-messages {
                display: flex;
                align-items: center;
                gap: 6px;
                margin: 4px 8px 10px;
                padding: 6px 10px;
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.12);
                transition: opacity 0.2s ease, transform 0.2s ease;
            }
            #cwConversationClosedBanner {
                display: none;
            }
            #cwChatClosedPane {
                display: none;
                flex: 1;
                min-height: 0;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 28px 24px 32px;
                background: #fff;
                text-align: center;
            }
            #cwChatClosedPane.cw-closed-visible {
                display: flex;
            }
            .cw-closed-check {
                width: 64px;
                height: 64px;
                border-radius: 999px;
                background: #f1f5f9;
                color: #334155;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 18px;
            }
            .cw-closed-check svg {
                width: 28px;
                height: 28px;
            }
            .cw-closed-title {
                margin: 0 0 10px;
                font-size: 22px;
                font-weight: 700;
                color: #0f172a;
                letter-spacing: -0.02em;
            }
            .cw-closed-copy {
                margin: 0 0 22px;
                max-width: 280px;
                font-size: 14px;
                line-height: 1.5;
                color: #64748b;
            }
            .cw-closed-copy button {
                appearance: none;
                border: 0;
                background: none;
                padding: 0;
                margin: 0;
                font: inherit;
                font-weight: 600;
                color: #0f172a;
                cursor: pointer;
                text-decoration: underline;
                text-underline-offset: 2px;
            }
            .cw-closed-new-btn {
                appearance: none;
                border: 0;
                border-radius: 10px;
                background: #0f172a;
                color: #fff;
                font-size: 14px;
                font-weight: 600;
                padding: 12px 18px;
                min-width: 180px;
                cursor: pointer;
            }
            #cwConversationsListPane {
                display: none;
                flex: 1;
                min-height: 0;
                flex-direction: column;
                overflow: hidden;
                background: #fff;
            }
            #cwConversationsListPane.cw-list-visible {
                display: flex;
            }
            .cw-inbox-scroll {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 0;
            }
            .cw-inbox-list {
                list-style: none;
                margin: 0;
                padding: 0;
                background: #fff;
            }
            .cw-inbox-item {
                width: 100%;
                text-align: left;
                appearance: none;
                border: 0;
                border-bottom: 1px solid #eef2f7;
                background: #fff;
                padding: 14px 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .cw-inbox-item:hover {
                background: #f8fafc;
            }
            .cw-inbox-avatar {
                position: relative;
                width: 44px;
                height: 44px;
                border-radius: 999px;
                flex-shrink: 0;
                overflow: hidden;
                background: #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #fff;
                font-size: 15px;
                font-weight: 700;
            }
            .cw-inbox-avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .cw-inbox-avatar-dot {
                position: absolute;
                right: 1px;
                bottom: 1px;
                width: 10px;
                height: 10px;
                border-radius: 999px;
                background: #22c55e;
                border: 2px solid #fff;
            }
            .cw-inbox-item-body {
                min-width: 0;
                flex: 1;
            }
            .cw-inbox-item-top {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .cw-inbox-item-title {
                font-size: 14px;
                font-weight: 600;
                color: #0f172a;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .cw-inbox-item-meta {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 6px;
                flex-shrink: 0;
            }
            .cw-inbox-item-time {
                font-size: 11px;
                color: #94a3b8;
                white-space: nowrap;
            }
            .cw-inbox-item-preview {
                margin: 3px 0 0;
                font-size: 13px;
                color: #64748b;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .cw-inbox-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 18px;
                height: 18px;
                padding: 0 5px;
                border-radius: 999px;
                background: #0f172a;
                color: #fff;
                font-size: 10px;
                font-weight: 700;
            }
            .cw-inbox-status-badge {
                display: inline-flex;
                align-items: center;
                flex-shrink: 0;
                height: 18px;
                padding: 0 7px;
                border-radius: 999px;
                background: #fee2e2;
                color: #b91c1c;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.02em;
                text-transform: uppercase;
            }
            .cw-inbox-empty {
                padding: 40px 20px;
                text-align: center;
                color: #64748b;
                font-size: 14px;
            }
            .cw-inbox-footer {
                flex-shrink: 0;
                padding: 12px 16px 14px;
                border-top: 1px solid #eef2f7;
                background: #fff;
            }
            .cw-inbox-new-btn {
                width: 100%;
                appearance: none;
                border: 0;
                border-radius: 10px;
                background: #0f172a;
                color: #fff;
                font-size: 14px;
                font-weight: 600;
                padding: 12px 14px;
                cursor: pointer;
            }
            .cw-inbox-new-btn:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }
            
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
                padding: 0;
                background: #fff;
                border-bottom: 1px solid #e2e8f0;
                flex-shrink: 0;
            }
            .cw-msg-header-inner {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
                padding: 0.5rem 0.5rem;
                width: 100%;
                box-sizing: border-box;
            }
            /* Messages header: row layout + icon color (do not rely on Tailwind alone). */
            #mainHeader:not(.hide-on-home) {
                display: block !important;
            }
            #mainHeader:not(.hide-on-home) .cw-msg-header-inner {
                display: flex !important;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
            }
            #mainHeader:not(.hide-on-home) .cw-msg-header-center {
                display: flex !important;
                flex-direction: row;
                align-items: center;
                gap: 0.5rem;
                flex: 1 1 auto;
                min-width: 0;
            }
            #mainHeader:not(.hide-on-home) button {
                color: #64748b;
                flex-shrink: 0;
                width: 2rem;
                height: 2rem;
                border: none;
                background: transparent;
                border-radius: 9999px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            #mainHeader:not(.hide-on-home) button:hover {
                background: #f1f5f9;
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
            .cw-msg-wrap {
                width: 100%;
            }
            .cw-msg-wrap.cw-msg-selected {
                box-shadow: none;
            }
            .cw-msg-wrap.cw-msg-selected .cw-bubble-in,
            .cw-msg-wrap.cw-msg-selected .cw-bubble-out {
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.42);
            }
            .cw-msg-wrap.cw-msg-reply-target .cw-bubble-in,
            .cw-msg-wrap.cw-msg-reply-target .cw-bubble-out {
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.65);
            }

            /* Messages screen — Preline conversation layout */
            .cw-ms-screen {
                position: relative;
                display: flex;
                flex-direction: column;
                flex: 1;
                min-height: 0;
                overflow: hidden;
                background: #fff;
            }
            #chatWidget .cw-screen-stage > #messagesScreen.chat-widget-screen.active {
                min-height: 0;
            }
            .cw-ms-scroll {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                overflow-x: hidden;
                -webkit-overflow-scrolling: touch;
            }
            .cw-ms-scroll-inner {
                padding: 0.5rem 1rem 6.5rem;
            }
            .cw-msg-list {
                display: flex;
                flex-direction: column;
                gap: 1.25rem;
                width: 100%;
            }
            .cw-ms-footer {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                z-index: 10;
                background: #fff;
                border-radius: 0 0 1rem 1rem;
                overflow: hidden;
                max-width: 100%;
                box-sizing: border-box;
            }
            .cw-ms-composer {
                border-top: 1px solid #e2e8f0;
                overflow: hidden;
                max-width: 100%;
                box-sizing: border-box;
            }
            #inputWrapper {
                min-width: 0;
                max-width: 100%;
                box-sizing: border-box;
                overflow: hidden;
            }
            .cw-ms-footer .cw-ms-textarea {
                display: block;
                width: 100%;
                max-width: 100%;
                max-height: 9rem;
                padding: 1rem 0.5rem 0.5rem 0.5rem;
                margin: 0;
                border: none;
                background: transparent;
                outline: none;
                box-shadow: none;
                resize: none;
                font-size: 0.875rem;
                line-height: 1.25rem;
                color: #0f172a;
                box-sizing: border-box;
            }
            .cw-ms-footer .cw-ms-textarea:focus,
            .cw-ms-footer .cw-ms-textarea:focus-visible {
                outline: none !important;
                border: none !important;
                box-shadow: none !important;
            }
            .cw-ms-footer .cw-ms-textarea::placeholder {
                color: #94a3b8;
            }
            .cw-ms-footer .cw-ms-toolbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.25rem;
                padding: 0 0.5rem 0.5rem 0.5rem;
                max-width: 100%;
                box-sizing: border-box;
            }
            .cw-ms-footer .cw-ms-toolbar-group {
                display: flex;
                align-items: center;
                gap: 0.25rem;
            }
            .cw-reply-compose {
                padding: 0.5rem 0.5rem 0.375rem 0.625rem;
                background: #fff;
            }
            .cw-reply-compose-inner {
                display: flex;
                align-items: stretch;
                gap: 0.625rem;
                min-width: 0;
            }
            .cw-reply-compose-bar {
                width: 3px;
                flex-shrink: 0;
                border-radius: 9999px;
                background: var(--primary-color, #2563eb);
            }
            .cw-reply-compose-body {
                flex: 1;
                min-width: 0;
            }
            .cw-reply-compose-label {
                display: block;
                font-size: 0.6875rem;
                font-weight: 600;
                line-height: 1.2;
                color: var(--primary-color, #2563eb);
            }
            .cw-reply-compose-preview {
                display: block;
                margin-top: 0.125rem;
                font-size: 0.8125rem;
                line-height: 1.3;
                color: #64748b;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .cw-reply-compose-close {
                flex-shrink: 0;
                align-self: flex-start;
                width: 1.75rem;
                height: 1.75rem;
                margin-top: -0.125rem;
                margin-right: 0.125rem;
                border: none;
                background: transparent;
                color: #94a3b8;
                border-radius: 0.5rem;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 1.125rem;
                line-height: 1;
                padding: 0;
            }
            .cw-reply-compose-close:hover {
                background: #f1f5f9;
                color: #475569;
            }
            #inputContainer:has(#cwReplyBar:not(.hidden)) .cw-ms-textarea {
                padding-top: 0.375rem;
            }
            .cw-ms-icon-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 2rem;
                height: 2rem;
                border: none;
                background: transparent;
                border-radius: 9999px;
                color: #64748b;
                cursor: pointer;
                flex-shrink: 0;
                padding: 0;
            }
            .cw-ms-icon-btn:hover {
                background: #f1f5f9;
            }
            .cw-ms-icon-btn svg {
                width: 1rem;
                height: 1rem;
                flex-shrink: 0;
            }
            .cw-ms-send-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 2rem;
                height: 2rem;
                border: 1px solid rgba(37, 99, 235, 0.2);
                border-radius: 9999px;
                background: var(--primary-color, #2563eb);
                color: #fff;
                cursor: not-allowed;
                opacity: 0.5;
                flex-shrink: 0;
                padding: 0;
            }
            .cw-ms-send-btn.enabled {
                opacity: 1;
                cursor: pointer;
            }
            .cw-ms-send-btn.enabled:hover {
                filter: brightness(0.95);
            }
            .cw-ms-send-btn svg path {
                stroke: #fff !important;
                fill: none;
            }
            .cw-msg-thread-wrap {
                display: none;
            }

            #chatWidgetButton.cw-fab {
                background: var(--cw-navy) !important;
                background-image: none !important;
                box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.35);
            }

            .sr-only {
                position: absolute;
                width: 1px;
                height: 1px;
                padding: 0;
                margin: -1px;
                overflow: hidden;
                clip: rect(0, 0, 0, 0);
                white-space: nowrap;
                border: 0;
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
                flex-direction: row;
                overflow: hidden;
                border-radius: 0.75rem;
                background: #fff;
                border: 1px solid var(--cw-slate-200);
                text-align: left;
                text-decoration: none;
                color: inherit;
            }
            .cw-link-card--with-image {
                flex-direction: column;
            }
            .cw-link-card--with-image .cw-link-card-accent {
                display: none;
            }
            .cw-link-card-image-wrap {
                width: 100%;
                overflow: hidden;
                line-height: 0;
                background: #f1f5f9;
                border-bottom: 1px solid var(--cw-slate-200);
            }
            .cw-link-card-image {
                width: 100%;
                max-height: 10rem;
                object-fit: cover;
                display: block;
            }
            .cw-link-card--loading .cw-link-card-sub {
                opacity: 0.65;
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
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-word;
            }

            .cw-quote-block {
                display: flex;
                align-items: stretch;
                gap: 0.5rem;
                width: 100%;
                max-width: 100%;
                margin: 0 0 0.375rem;
                padding: 0;
                border: none;
                border-radius: 0;
                background: transparent;
            }
            .cw-quote-block--interactive {
                cursor: pointer;
                border-radius: 0.25rem;
            }
            .cw-quote-block--interactive:hover .cw-quote-text {
                color: #475569;
            }
            .cw-quote-block-bar {
                width: 3px;
                flex-shrink: 0;
                border-radius: 9999px;
                background: #64748b;
            }
            .cw-quote-text {
                flex: 1;
                min-width: 0;
                font-size: 0.8125rem;
                line-height: 1.35;
                color: #64748b;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-word;
            }

            .cw-msg-interactive-stack {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 0.5rem;
                max-width: 100%;
                min-width: 0;
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
                top: 0;
                z-index: 8;
                display: block;
                width: fit-content;
                max-width: 100%;
                margin: 0 auto 0.75rem;
                padding: 0.125rem 0.375rem;
                border-radius: 9999px;
                font-size: 0.75rem;
                font-weight: 500;
                color: #64748b;
                background: #f8fafc;
                border: none;
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

            .cw-message-menu-wrap {
                flex-shrink: 0;
                align-self: flex-end;
                padding-bottom: 2px;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.15s ease;
            }
            .cw-msg-bubble-group:hover .cw-message-menu-wrap,
            .cw-msg-bubble-group:focus-within .cw-message-menu-wrap,
            .cw-msg-bubble-group:has(.cw-message-menu:not(.hidden)) .cw-message-menu-wrap {
                opacity: 1;
                pointer-events: auto;
            }
            .cw-message-menu-dropdown {
                position: relative;
                display: inline-flex;
            }
            .cw-message-menu-trigger {
                width: 2rem;
                height: 2rem;
                border-radius: 9999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border: none;
                cursor: pointer;
                color: #64748b;
                opacity: 1;
                pointer-events: auto;
                transition: background 0.15s ease, color 0.15s ease;
            }
            .cw-message-menu-trigger-icon {
                width: 1rem;
                height: 1rem;
                flex-shrink: 0;
            }
            .cw-message-menu-trigger:hover,
            .cw-message-menu-trigger:focus-visible {
                background: #f1f5f9;
                color: #475569;
                outline: none;
            }
            .cw-message-menu {
                position: absolute;
                bottom: calc(100% + 4px);
                min-width: 8rem;
                background: #fff;
                border: 1px solid #e2e8f0;
                border-radius: 0.75rem;
                box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.06);
                z-index: 30;
            }
            .cw-msg-row.cw-outbound .cw-message-menu {
                right: auto;
                left: 0;
            }
            .cw-message-menu-left {
                right: 0;
                left: auto;
            }
            .cw-message-menu-right {
                right: 0;
                left: auto;
            }
            .cw-message-menu.hidden { display: none; }
            .cw-message-menu-inner {
                padding: 0.25rem;
            }
            .cw-message-menu-item {
                width: 100%;
                text-align: left;
                padding: 0.375rem 0.5rem;
                border-radius: 0.5rem;
                border: none;
                background: transparent;
                cursor: pointer;
                font-size: 0.75rem;
                line-height: 1.25rem;
                color: #0f172a;
                font-weight: 400;
                display: flex;
                align-items: center;
                gap: 0.75rem;
            }
            .cw-message-menu-item svg {
                width: 0.875rem;
                height: 0.875rem;
                flex-shrink: 0;
            }
            .cw-message-menu-item:hover,
            .cw-message-menu-item:focus-visible {
                background: #f8fafc;
                outline: none;
            }
            .cw-message-menu-item.cw-danger {
                color: #b91c1c;
            }
            .cw-message-menu-item.cw-danger:hover {
                background: #fef2f2;
            }

            .cw-msg-row {
                display: flex;
                width: 100%;
                max-width: 28rem;
                gap: 0.5rem;
            }
            .cw-msg-row.cw-inbound {
                justify-content: flex-start;
                align-items: flex-end;
                margin-right: auto;
            }
            .cw-msg-row.cw-outbound {
                justify-content: flex-end;
                align-items: flex-end;
                margin-left: auto;
            }

            .cw-msg-avatar {
                width: 2rem;
                height: 2rem;
                border-radius: 9999px;
                flex-shrink: 0;
                background: #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                margin-top: auto;
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
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            .cw-msg-col.cw-outbound {
                align-items: flex-end;
                text-align: right;
            }
            .cw-msg-sender-name {
                margin: 0 0 0.375rem;
                padding-left: 0.625rem;
                font-size: 0.75rem;
                line-height: 1rem;
                color: #64748b;
                font-weight: 400;
            }
            .cw-msg-sender-name.cw-out {
                padding-left: 0;
                padding-right: 0.625rem;
                text-align: right;
            }
            .cw-msg-stack {
                display: flex;
                flex-direction: column;
                gap: 0.25rem;
                width: 100%;
            }
            .cw-msg-bubble-group {
                display: flex;
                align-items: flex-start;
                gap: 0.5rem;
                width: 100%;
                word-break: break-word;
            }
            .cw-msg-bubble-group.cw-out-group {
                justify-content: flex-end;
            }
            .cw-msg-bubble-group.cw-in-group {
                justify-content: flex-start;
            }

            .cw-bubble-in {
                background: #f8fafc;
                color: #0f172a;
                border-radius: 0.75rem;
                padding: 0.5rem 0.625rem 0.375rem;
                font-size: 0.875rem;
                line-height: 1.45;
                word-break: break-word;
                border: none;
                display: inline-block;
                max-width: 100%;
                text-align: left;
            }
            .cw-bubble-out {
                background: #dbeafe;
                color: #0f172a;
                border-radius: 0.75rem;
                padding: 0.5rem 0.625rem 0.375rem;
                font-size: 0.875rem;
                line-height: 1.45;
                word-break: break-word;
                border: none;
                display: inline-block;
                max-width: 100%;
                text-align: left;
            }
            .cw-bubble-text {
                font-size: 0.875rem;
                color: #0f172a;
                line-height: 1.45;
            }
            .cw-bubble-meta {
                display: inline;
                white-space: nowrap;
                margin-left: 0.35rem;
            }
            .cw-bubble-footer {
                display: inline;
                margin-top: 0;
                font-size: 0.6875rem;
                color: #64748b;
                font-style: italic;
            }
            .cw-bubble-out .cw-bubble-footer,
            .cw-bubble-out .cw-time {
                color: #64748b;
            }
            .cw-bubble-out .cw-msg-link {
                color: #2563eb;
            }
            .cw-bubble-out .cw-quote-block-bar {
                background: var(--primary-color, #2563eb);
            }
            .cw-bubble-out .cw-quote-text {
                color: #475569;
            }
            .cw-bubble-in .cw-quote-block-bar {
                background: #64748b;
            }
            .cw-bubble-in .cw-quote-text {
                color: #64748b;
            }
            .cw-bubble-footer-in {
                display: inline;
            }
            .cw-bubble-footer [data-outbound-ticks="1"] {
                font-style: normal;
                display: inline;
                vertical-align: middle;
            }
            .cw-time {
                font-size: 0.6875rem;
                font-style: italic;
                color: #64748b;
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

            /* Pre-chat form — Preline welcome dropdown layout */
            #messagesScreen #formContainer {
                flex: 1 1 auto;
                min-height: 0;
                display: none;
                flex-direction: column;
                background: #fff;
                overflow: hidden;
            }
            #messagesScreen #formContainer.cw-prechat-visible {
                display: flex !important;
                position: absolute;
                inset: 0;
                z-index: 20;
            }
            .cw-prechat-shell {
                position: relative;
                display: flex;
                flex-direction: column;
                flex: 1;
                min-height: 0;
                height: 100%;
                background: #fff;
            }
            .cw-prechat-close-wrap {
                position: absolute;
                top: 0.5rem;
                right: 1rem;
                z-index: 12;
            }
            .cw-prechat-close {
                width: 2rem;
                height: 2rem;
                border: none;
                border-radius: 9999px;
                background: transparent;
                color: #64748b;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }
            .cw-prechat-close:hover {
                background: #f8fafc;
                color: #0f172a;
            }
            .cw-prechat-hero {
                flex-shrink: 0;
                margin: 0;
                overflow: hidden;
                border-radius: 0.75rem 0.75rem 0 0;
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
            .cw-prechat-logo-wrap {
                position: relative;
                z-index: 10;
                margin-top: -1.75rem;
                margin-left: 0.625rem;
                margin-bottom: 0;
                width: 3.5rem;
                height: 3.5rem;
                flex-shrink: 0;
            }
            .cw-prechat-logo-circle {
                width: 3.5rem;
                height: 3.5rem;
                border-radius: 9999px;
                background: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
            }
            .cw-prechat-logo-circle svg {
                width: 1.75rem;
                height: auto;
            }
            .cw-prechat-logo-circle svg path {
                fill: var(--primary-color, #2563eb);
            }
            .cw-prechat-logo-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                border-radius: 9999px;
            }
            .cw-prechat-body {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 1.25rem;
                -webkit-overflow-scrolling: touch;
            }
            .cw-prechat-intro-title {
                margin: 0;
                font-size: 1.25rem;
                line-height: 1.75rem;
                font-weight: 600;
                color: #0f172a;
            }
            .cw-prechat-intro-sub {
                margin: 0.25rem 0 0;
                font-size: 0.875rem;
                line-height: 1.25rem;
                color: #64748b;
            }
            .cw-prechat-form {
                margin-top: 1.25rem;
                display: flex;
                flex-direction: column;
                gap: 1.25rem;
            }
            .cw-prechat-field {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }
            .cw-prechat-label {
                display: block;
                margin: 0;
                font-size: 0.875rem;
                font-weight: 500;
                color: #0f172a;
            }
            .cw-prechat-input {
                display: block;
                width: 100%;
                box-sizing: border-box;
                padding: 0.5rem 0.75rem;
                border: 1px solid #e2e8f0;
                border-radius: 0.5rem;
                background: #fff;
                font-size: 0.875rem;
                line-height: 1.25rem;
                color: #0f172a;
                outline: none;
                margin: 0;
            }
            .cw-prechat-input::placeholder {
                color: #94a3b8;
            }
            .cw-prechat-input:focus {
                border-color: var(--primary-color, #2563eb);
                box-shadow: none;
            }
            .cw-prechat-message-box {
                display: flex;
                flex-direction: column;
                padding-bottom: 0.25rem;
                background: #fff;
                border: 1px solid #e2e8f0;
                border-radius: 0.5rem;
            }
            .cw-prechat-message-box:focus-within {
                border-color: var(--primary-color, #2563eb);
                box-shadow: none;
            }
            .cw-prechat-textarea {
                display: block;
                width: 100%;
                box-sizing: border-box;
                min-height: 4.5rem;
                padding: 0.625rem 0.75rem;
                border: none;
                background: transparent;
                resize: none;
                font-size: 0.875rem;
                line-height: 1.25rem;
                color: #0f172a;
                outline: none;
                margin: 0;
            }
            .cw-prechat-textarea::placeholder {
                color: #94a3b8;
            }
            .cw-prechat-textarea-toolbar {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 0.25rem;
                padding: 0.25rem 0.5rem;
            }
            .cw-prechat-textarea-toolbar button {
                width: 1.5rem;
                height: 1.5rem;
                border: none;
                background: transparent;
                color: #64748b;
                cursor: pointer;
                border-radius: 9999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }
            .cw-prechat-textarea-toolbar button:hover {
                background: #f1f5f9;
                color: #334155;
            }
            .cw-prechat-textarea-toolbar svg {
                width: 0.875rem;
                height: 0.875rem;
            }
            .cw-prechat-submit {
                width: 100%;
                padding: 0.625rem 0.75rem;
                border: 1px solid rgba(37, 99, 235, 0.2);
                border-radius: 0.5rem;
                background: var(--primary-color, #2563eb);
                color: #fff;
                font-size: 0.875rem;
                font-weight: 500;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.375rem;
            }
            .cw-prechat-submit:hover:not(:disabled) {
                filter: brightness(0.95);
            }
            .cw-prechat-submit:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .cw-bottom-nav {
                position: relative;
                padding: 1rem 1.25rem;
                background: #fff;
                border-top: 1px solid #e2e8f0;
                border-radius: 0 0 1rem 1rem;
            }
            .cw-bottom-nav__tabs {
                display: flex;
                width: 100%;
                align-items: stretch;
            }
            .cw-bottom-nav .cw-nav-tab {
                flex: 1 1 0;
                min-width: 0;
                border: none;
                background: transparent;
                cursor: pointer;
                display: inline-flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 1px;
                padding: 0;
                border-radius: 0.5rem;
                font-size: 0.875rem;
                line-height: 1.25rem;
                color: #0f172a;
                font-weight: 400;
                transition: color 0.15s ease;
            }
            .cw-bottom-nav .cw-nav-tab:hover {
                color: #1d4ed8;
            }
            .cw-bottom-nav .cw-nav-tab:focus {
                outline: none;
            }
            .cw-bottom-nav .cw-nav-tab:focus-visible {
                outline: 2px solid #2563eb;
                outline-offset: 2px;
            }
            .cw-bottom-nav .cw-nav-tab.cw-nav-active {
                color: #2563eb;
                font-weight: 500;
            }
            .cw-bottom-nav .cw-nav-icon-wrap {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0.5rem 1rem;
                border-radius: 9999px;
                transition: background 0.15s ease;
            }
            .cw-bottom-nav .cw-nav-tab.cw-nav-active .cw-nav-icon-wrap {
                background: #eff6ff;
            }
            .cw-bottom-nav .cw-nav-label {
                font-size: 0.875rem;
                font-weight: inherit;
                line-height: 1.25rem;
            }
            .cw-bottom-nav .cw-nav-icon {
                width: 1rem;
                height: 1rem;
                flex-shrink: 0;
                display: block;
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
                overflow: hidden;
            }
            .cw-home-logo-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                border-radius: 999px;
                display: block;
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
            .cw-home-social-row {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: center;
                gap: 14px;
            }
            .cw-home-social-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 44px;
                height: 44px;
                padding: 0;
                border: none;
                background: transparent;
                cursor: pointer;
                border-radius: 9999px;
                flex-shrink: 0;
                transition: transform 0.15s ease, opacity 0.15s ease;
            }
            .cw-home-social-btn:hover {
                transform: scale(1.06);
                opacity: 0.92;
            }
            .cw-home-social-btn:focus-visible {
                outline: 2px solid rgba(15, 23, 42, 0.35);
                outline-offset: 2px;
            }
            .cw-home-social-btn svg {
                display: block;
                flex-shrink: 0;
                width: 44px;
                height: 44px;
            }
            .cw-home-social-btn--email svg {
                width: 30px;
                height: 22px;
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
                
                .chat-widget-form-container {
                    max-width: 100vw;
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

            .cw-voice-call-banner {
                background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
                color: #fff;
                padding: 12px 14px;
                font-size: 13px;
                z-index: 5;
                box-shadow: 0 2px 8px rgba(15, 118, 110, 0.25);
            }
            .cw-voice-call-banner.hidden {
                display: none;
            }
            .cw-voice-call-banner-inner {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .cw-voice-call-banner-text {
                flex: 1;
                min-width: 0;
                font-weight: 600;
                line-height: 1.35;
            }
            .cw-voice-call-banner-sub {
                display: block;
                margin-top: 2px;
                font-size: 11px;
                font-weight: 400;
                opacity: 0.9;
            }
            .cw-voice-call-actions {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-shrink: 0;
            }
            .cw-voice-call-actions.hidden {
                display: none;
            }
            .cw-voice-call-accept,
            .cw-voice-call-decline,
            .cw-voice-call-end {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                border: none;
                border-radius: 9999px;
                cursor: pointer;
                transition: transform 0.15s ease, opacity 0.15s ease;
            }
            .cw-voice-call-accept:hover,
            .cw-voice-call-decline:hover,
            .cw-voice-call-end:hover {
                transform: scale(1.05);
            }
            .cw-voice-call-accept {
                background: #22c55e;
                color: #fff;
                box-shadow: 0 2px 8px rgba(34, 197, 94, 0.45);
            }
            .cw-voice-call-decline {
                background: #ef4444;
                color: #fff;
                box-shadow: 0 2px 8px rgba(239, 68, 68, 0.45);
            }
            .cw-voice-call-end {
                width: auto;
                min-width: 72px;
                padding: 0 12px;
                border-radius: 8px;
                background: rgba(255,255,255,0.18);
                border: 1px solid rgba(255,255,255,0.45);
                color: #fff;
                font-size: 12px;
                font-weight: 600;
            }
            .cw-voice-call-end.hidden {
                display: none;
            }
            .cw-voice-call-accept svg,
            .cw-voice-call-decline svg {
                width: 18px;
                height: 18px;
            }
            .cw-call-log-bubble {
                display: inline-flex;
                flex-direction: column;
                gap: 8px;
                min-width: 200px;
                max-width: 300px;
                border-radius: 12px;
                padding: 10px 12px;
                box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
            }
            .cw-call-log-bubble.cw-call-me {
                border-bottom-right-radius: 4px;
                background: #d8f3dc;
            }
            .cw-call-log-bubble.cw-call-them {
                border-bottom-left-radius: 4px;
                background: #f3f4f6;
            }
            .cw-call-log-row {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .cw-call-log-glyph {
                width: 36px;
                height: 36px;
                border-radius: 9999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                background: #d1fae5;
                color: #047857;
            }
            .cw-call-log-glyph.cw-call-missed {
                background: #fee2e2;
                color: #dc2626;
            }
            .cw-call-log-glyph svg {
                width: 18px;
                height: 18px;
            }
            .cw-call-log-title {
                margin: 0;
                font-size: 13px;
                font-weight: 600;
                color: var(--text-color, #111827);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .cw-call-log-sub {
                margin: 2px 0 0;
                font-size: 11px;
                color: #6b7280;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .cw-call-log-time {
                align-self: flex-end;
                font-size: 11px;
                color: #6b7280;
            }
            .cw-voice-msg {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 220px;
                max-width: 300px;
                padding: 6px 2px;
                user-select: none;
            }
            .cw-voice-play {
                width: 36px;
                height: 36px;
                border: none;
                border-radius: 9999px;
                background: transparent;
                color: var(--cw-voice-accent, #25D366);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                flex-shrink: 0;
                padding: 0;
            }
            .cw-voice-play svg {
                width: 22px;
                height: 22px;
            }
            .cw-voice-play .hidden {
                display: none;
            }
            .cw-voice-wave {
                position: relative;
                display: flex;
                align-items: center;
                gap: 2px;
                height: 32px;
                flex: 1;
                min-width: 0;
                cursor: pointer;
                touch-action: none;
            }
            .cw-voice-bar {
                flex: 1;
                min-width: 2px;
                border-radius: 9999px;
                background: rgba(0, 0, 0, 0.18);
                display: inline-block;
                align-self: center;
            }
            .cw-voice-bar.is-played {
                background: var(--cw-voice-accent, #25D366);
            }
            .cw-voice-knob {
                position: absolute;
                top: 50%;
                width: 12px;
                height: 12px;
                margin-top: -6px;
                margin-left: -6px;
                border-radius: 9999px;
                background: var(--cw-voice-accent, #25D366);
                box-shadow: 0 1px 2px rgba(0,0,0,0.2);
                pointer-events: none;
                left: 0%;
            }
            .cw-voice-dur {
                font-size: 11px;
                font-weight: 600;
                color: rgba(0, 0, 0, 0.5);
                min-width: 36px;
                text-align: right;
                font-variant-numeric: tabular-nums;
            }
            .cw-voice-mic {
                width: 36px;
                height: 36px;
                border-radius: 9999px;
                background: var(--cw-voice-accent, #25D366);
                color: #fff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .cw-voice-mic svg {
                width: 18px;
                height: 18px;
            }
            .cw-voice-msg.cw-voice-me {
                --cw-voice-accent: #128C7E;
            }
            .cw-voice-msg.cw-voice-them {
                --cw-voice-accent: #25D366;
            }
            .cw-video-msg {
                position: relative;
                max-width: 260px;
                border-radius: 12px;
                overflow: hidden;
                background: #111827;
            }
            .cw-video-el {
                display: block;
                width: 100%;
                max-height: 220px;
                object-fit: contain;
                background: #111827;
                cursor: pointer;
            }
            .cw-video-play-overlay {
                position: absolute;
                inset: 0;
                margin: auto;
                width: 52px;
                height: 52px;
                border: none;
                border-radius: 9999px;
                background: rgba(255,255,255,0.92);
                color: #111827;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 4px 14px rgba(0,0,0,0.25);
            }
            .cw-video-play-overlay svg {
                width: 22px;
                height: 22px;
                margin-left: 2px;
            }
            .cw-video-msg.is-playing .cw-video-play-overlay {
                display: none;
            }
            .cw-ms-icon-btn.cw-recording {
                color: #ef4444 !important;
                animation: cw-pulse-record 1s ease-in-out infinite;
            }
            @keyframes cw-pulse-record {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.08); opacity: 0.85; }
            }
            .cw-voice-record-banner {
                display: none;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 10px 12px;
                margin: 0 0 8px;
                border-radius: 10px;
                background: #fef2f2;
                color: #b91c1c;
                font-size: 12px;
                font-weight: 600;
            }
            .cw-voice-record-banner.is-active {
                display: flex;
            }
            .cw-voice-record-banner-dot {
                width: 8px;
                height: 8px;
                border-radius: 9999px;
                background: #ef4444;
                animation: cw-pulse-record 1s ease-in-out infinite;
            }
            .cw-voice-record-stop {
                border: none;
                border-radius: 8px;
                background: #ef4444;
                color: #fff;
                font-size: 12px;
                font-weight: 600;
                padding: 6px 10px;
                cursor: pointer;
            }
            .cw-ms-icon-btn.hidden {
                display: none;
            }
            .cw-ms-icon-btn:disabled {
                opacity: 0.45;
                cursor: not-allowed;
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
                    <div class="cw-msg-header-inner">
                        <button type="button" id="cwMessagesBackBtn" onclick="chatWidget.handleMessagesBack()" title="Back" aria-label="Back">
                            <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                        </button>

                        <div class="cw-msg-header-center min-w-0">
                            <div class="truncate flex items-center gap-x-2 w-full">
                                <span id="cwHeaderAvatarWrap" class="relative shrink-0 cw-header-avatar-wrap hidden" aria-hidden="true">
                                    <span id="cwHeaderAvatarPlaceholder" class="cw-header-avatar-placeholder hidden" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="#64748b" stroke-width="2"/></svg>
                                    </span>
                                    <img id="cwHeaderAvatarImg" class="shrink-0 size-8 rounded-full hidden" alt="" width="32" height="32" />
                                    <span id="cwHeaderPresenceDot" class="absolute bottom-0 right-0 block size-2 rounded-full ring-2 ring-white bg-green-500 cw-online-dot cw-away" aria-hidden="true"></span>
                                </span>

                                <span class="grow truncate min-w-0">
                                    <span id="widgetHeaderTitle" class="truncate block font-semibold text-sm leading-4 text-slate-900">Chat</span>
                                    <span id="widgetHeaderSubtitle" class="truncate block text-xs leading-4 text-blue-600">Online</span>
                                </span>
                            </div>
                        </div>

                        <button type="button" onclick="chatWidget.toggleChat()" title="Close" aria-label="Close">
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
                            <div class="cw-home-logo" id="widgetHomeLogoWrap" aria-hidden="true">
                                <img id="widgetHomeLogo" class="cw-home-logo-img hidden" alt="" width="56" height="56" />
                                <svg id="widgetHomeLogoFallback" class="w-7 h-7" viewBox="0 0 24 24" fill="none">
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

                            <div class="my-3" id="widgetDirectMessageBtnWrap" style="display:none">
                                <button type="button" id="widgetDirectMessageBtn" class="cw-home-primary-btn w-full rounded-lg bg-slate-900 px-4 py-3 text-[14px] font-semibold text-white hover:bg-slate-800 focus:outline-none" onclick="chatWidget.showScreen('messages')" aria-label="Send us a message">
                                    Send us a message
                                </button>
                            </div>

                            <!-- Social channels: heading + icon row -->
                            <div class="mb-3" id="widgetSocialChannelsSection" style="display:none">
                                <p class="mb-2 text-center text-[13px] font-medium text-slate-500" id="widgetSocialChannelsTitle">Connect with us</p>
                                <div class="cw-home-social-row" id="widgetSocialChannelsGrid" aria-label="Contact options">
                                    <button type="button" id="widgetWhatsAppRow" class="cw-home-social-btn" style="display:none" onclick="chatWidget.openWhatsApp()" aria-label="WhatsApp">
                                        <svg viewBox="0 0 667 667" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="h-11 w-11 shrink-0">
                                            <path d="M222.674 298.117L273.674 246.784L260.34 200.117H200.007C200.007 200.117 186.34 284.784 284.007 382.117C381.674 479.451 466.674 466.784 466.674 466.784V406.45L420.007 393.117L368.674 444.117" stroke="#94D4B3" stroke-width="66.6667" stroke-linecap="round" stroke-linejoin="round"></path>
                                            <path d="M629.34 382.117C621.658 428.784 603.051 472.974 575.038 511.081C547.024 549.187 510.398 580.131 468.147 601.386C425.897 622.641 379.22 633.606 331.925 633.385C284.63 633.165 238.057 621.765 196.007 600.117L33.3403 633.45L66.6736 470.783C44.9189 428.578 33.4928 381.812 33.3349 334.331C33.177 286.849 44.2918 240.008 65.7654 197.659C87.2389 155.31 118.458 118.663 156.855 90.7315C195.253 62.7998 239.731 44.3811 286.635 36.9899C333.538 29.5988 381.526 33.4463 426.652 48.2162C471.778 62.986 512.754 88.2563 546.211 121.949C579.667 155.642 604.648 196.795 619.1 242.024C633.552 287.253 637.061 335.267 629.34 382.117Z" stroke="#41916D" stroke-width="66.6667" stroke-linecap="round" stroke-linejoin="round"></path>
                                        </svg>
                                    </button>

                                    <button type="button" id="widgetTelegramRow" class="cw-home-social-btn" style="display:none" onclick="chatWidget.openTelegram()" aria-label="Telegram">
                                        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="h-11 w-11 shrink-0">
                                            <circle cx="16" cy="16" r="14" fill="url(#telegram-ico-widget)"></circle>
                                            <path d="M22.9866 10.2088C23.1112 9.40332 22.3454 8.76755 21.6292 9.082L7.36482 15.3448C6.85123 15.5703 6.8888 16.3483 7.42147 16.5179L10.3631 17.4547C10.9246 17.6335 11.5325 17.541 12.0228 17.2023L18.655 12.6203C18.855 12.4821 19.073 12.7665 18.9021 12.9426L14.1281 17.8646C13.665 18.3421 13.7569 19.1512 14.314 19.5005L19.659 22.8523C20.2585 23.2282 21.0297 22.8506 21.1418 22.1261L22.9866 10.2088Z" fill="white"></path>
                                            <defs>
                                                <linearGradient id="telegram-ico-widget" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
                                                    <stop stop-color="#37BBFE"></stop>
                                                    <stop offset="1" stop-color="#007DBB"></stop>
                                                </linearGradient>
                                            </defs>
                                        </svg>
                                    </button>

                                    <button type="button" id="widgetEmailRow" class="cw-home-social-btn cw-home-social-btn--email" style="display:none" onclick="chatWidget.openEmail()" aria-label="Email">
                                        <svg viewBox="0 0 750 550" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="shrink-0">
                                            <path d="M66 25L375 244.25L684 25C688.028 22.4155 692.714 21.0416 697.5 21.0416C702.286 21.0416 706.972 22.4155 711 25C693.464 9.72906 671.236 0.908476 648 0H102C79.0677 0.204435 56.8735 8.13096 39 22.5C43.2641 20.2754 48.0794 19.3281 52.8684 19.7715C57.6574 20.2149 62.2169 22.0303 66 25Z" fill="#95D5B2"></path>
                                            <path d="M714 25C715.822 26.3247 717.425 27.9276 718.75 29.75C722.571 35.1288 724.111 41.8001 723.034 48.3096C721.957 54.819 718.35 60.6387 713 64.5L389.5 295.25C385.266 298.265 380.198 299.885 375 299.885C369.802 299.885 364.734 298.265 360.5 295.25L37 64.25C31.65 60.3887 28.0433 54.569 26.9662 48.0596C25.8891 41.5501 27.4289 34.8788 31.25 29.5C32.5945 27.7664 34.1964 26.2489 36 25C24.8155 34.4912 15.8098 46.2831 9.59708 59.5714C3.38439 72.8596 0.110932 87.3316 0 102V448C0 475.052 10.7464 500.996 29.8751 520.125C49.0038 539.254 74.9479 550 102 550H648C675.052 550 700.996 539.254 720.125 520.125C739.254 500.996 750 475.052 750 448V102C749.889 87.3316 746.616 72.8596 740.403 59.5714C734.19 46.2831 725.184 34.4912 714 25ZM319.5 345.25L66 526.25C61.7797 529.306 56.7102 530.966 51.5 531C47.5337 530.982 43.6288 530.02 40.1077 528.194C36.5866 526.368 33.5504 523.731 31.25 520.5C27.4289 515.121 25.8891 508.45 26.9662 501.94C28.0433 495.431 31.65 489.611 37 485.75L290.5 304.75C295.882 301.562 302.264 300.508 308.386 301.796C314.508 303.084 319.924 306.62 323.566 311.706C327.208 316.792 328.811 323.059 328.058 329.269C327.305 335.479 324.252 341.181 319.5 345.25ZM719.5 520.25C717.2 523.481 714.163 526.118 710.642 527.944C707.121 529.77 703.216 530.732 699.25 530.75C694.04 530.716 688.97 529.056 684.75 526L430.5 345.25C427.518 343.484 424.936 341.117 422.918 338.3C420.899 335.483 419.489 332.277 418.775 328.886C418.062 325.495 418.061 321.992 418.774 318.6C419.486 315.209 420.896 312.003 422.913 309.185C424.931 306.367 427.512 304 430.494 302.233C433.475 300.466 436.791 299.338 440.231 298.921C443.672 298.504 447.161 298.807 450.478 299.81C453.795 300.814 456.868 302.496 459.5 304.75L713 485.75C718.35 489.611 721.957 495.431 723.034 501.94C724.111 508.45 722.571 515.121 718.75 520.5L719.5 520.25Z" fill="#40916C"></path>
                                        </svg>
                                    </button>
                                </div>
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
                    <div id="cwConversationsListPane" aria-label="Your conversations">
                        <div class="cw-inbox-scroll" id="cwConversationsListScroll">
                            <div class="cw-inbox-empty" id="cwConversationsListEmpty">No conversations yet.</div>
                            <div id="cwConversationsListSections"></div>
                        </div>
                        <div class="cw-inbox-footer" id="cwInboxFooter">
                            <button type="button" class="cw-inbox-new-btn" id="cwInboxNewChatBtn" onclick="chatWidget.startNewChat()">Start a new chat</button>
                        </div>
                    </div>
                    <div id="cwChatClosedPane" aria-live="polite">
                        <div class="cw-closed-check" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 6 9 17l-5-5"/>
                            </svg>
                        </div>
                        <h2 class="cw-closed-title">We're on it!</h2>
                        <p class="cw-closed-copy">
                            You'll receive an email reply within a few hours. You can view and update your message in
                            <button type="button" onclick="chatWidget.showConversationsList()">Previous Conversations</button>.
                        </p>
                        <button type="button" class="cw-closed-new-btn" onclick="chatWidget.startNewChat()">Start a new chat</button>
                    </div>
                    <div class="chat-widget-form-container hidden" id="formContainer" style="display:none;">
                        <div class="cw-prechat-shell">
                            <div class="cw-prechat-close-wrap">
                                <button type="button" class="cw-prechat-close" onclick="chatWidget.showScreen('home')" aria-label="Close">
                                    <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                    <span class="sr-only">Close</span>
                                </button>
                            </div>

                            <div class="cw-prechat-hero" aria-hidden="true">
                                <figure>
                                    <svg preserveAspectRatio="none" width="576" height="120" viewBox="0 0 576 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <g clip-path="url(#cwFormClip0)">
                                            <rect width="576" height="120" fill="#B2E7FE"/>
                                            <rect x="289.678" y="-90.3" width="102.634" height="391.586" transform="rotate(59.5798 289.678 -90.3)" fill="#FF8F5D"/>
                                            <rect x="41.3926" y="-0.996094" width="102.634" height="209.864" transform="rotate(-31.6412 41.3926 -0.996094)" fill="#3ECEED"/>
                                            <rect x="66.9512" y="40.4817" width="102.634" height="104.844" transform="rotate(-31.6412 66.9512 40.4817)" fill="#4C48FF"/>
                                        </g>
                                        <defs>
                                            <clipPath id="cwFormClip0">
                                                <rect width="576" height="120" fill="white"/>
                                            </clipPath>
                                        </defs>
                                    </svg>
                                </figure>
                            </div>

                            <div class="cw-prechat-logo-wrap" aria-hidden="true">
                                <div class="cw-prechat-logo-circle">
                                    <img id="widgetFormLogo" class="cw-prechat-logo-img hidden" alt="" />
                                    <span id="widgetFormLogoDefault" aria-hidden="true">
                                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path fill-rule="evenodd" clip-rule="evenodd" d="M18.0835 3.23358C9.88316 3.23358 3.23548 9.8771 3.23548 18.0723V35.5832H0.583496V18.0723C0.583496 8.41337 8.41851 0.583252 18.0835 0.583252C27.7485 0.583252 35.5835 8.41337 35.5835 18.0723C35.5835 27.7312 27.7485 35.5614 18.0835 35.5614H16.7357V32.911H18.0835C26.2838 32.911 32.9315 26.2675 32.9315 18.0723C32.9315 9.8771 26.2838 3.23358 18.0835 3.23358Z" fill="currentColor"/>
                                            <path fill-rule="evenodd" clip-rule="evenodd" d="M18.0833 8.62162C12.8852 8.62162 8.62666 12.9245 8.62666 18.2879V35.5833H5.97468V18.2879C5.97468 11.5105 11.3713 5.97129 18.0833 5.97129C24.7954 5.97129 30.192 11.5105 30.192 18.2879C30.192 25.0653 24.7954 30.6045 18.0833 30.6045H16.7355V27.9542H18.0833C23.2815 27.9542 27.54 23.6513 27.54 18.2879C27.54 12.9245 23.2815 8.62162 18.0833 8.62162Z" fill="currentColor"/>
                                            <path d="M24.8225 18.1012C24.8225 21.8208 21.8053 24.8361 18.0833 24.8361C14.3614 24.8361 11.3442 21.8208 11.3442 18.1012C11.3442 14.3815 14.3614 11.3662 18.0833 11.3662C21.8053 11.3662 24.8225 14.3815 24.8225 18.1012Z" fill="currentColor"/>
                                        </svg>
                                    </span>
                                </div>
                            </div>

                            <div class="cw-prechat-body">
                                <div>
                                    <p class="cw-prechat-intro-title" id="cwFormTitle">Send a message</p>
                                    <p class="cw-prechat-intro-sub" id="cwFormSubtitle">We'll get back to you in a few hours.</p>
                                </div>

                                <form id="contactForm" onsubmit="chatWidget.handleFormSubmit(event)" class="cw-prechat-form">
                                    <div class="cw-prechat-field" id="formNameRow">
                                        <label class="cw-prechat-label" for="formName">Name</label>
                                        <input type="text" id="formName" class="cw-prechat-input" placeholder="John Doe">
                                    </div>
                                    <div class="cw-prechat-field" id="formEmailRow">
                                        <label class="cw-prechat-label" for="formEmail">Email</label>
                                        <input type="email" id="formEmail" class="cw-prechat-input" placeholder="john@site.co">
                                    </div>
                                    <div class="cw-prechat-field" id="formPhoneRow" style="display:none;">
                                        <label class="cw-prechat-label" for="formPhone">Phone</label>
                                        <input type="tel" id="formPhone" class="cw-prechat-input" placeholder="Your phone number">
                                    </div>
                                    <div class="cw-prechat-field" id="formMessageRow">
                                        <label class="cw-prechat-label" for="formMessage">How can we help?</label>
                                        <div class="cw-prechat-message-box">
                                            <textarea id="formMessage" class="cw-prechat-textarea" placeholder="Message..." rows="3" required></textarea>
                                            <div class="cw-prechat-textarea-toolbar">
                                                <button type="button" title="Attach file" aria-label="Attach file" onclick="chatWidget.showFileUploadPopup()">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                                </button>
                                                <button type="button" id="cwFormEmojiBtn" title="Add emoji" aria-label="Add emoji" onclick="chatWidget.toggleEmojiPicker()">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/><path d="M16 5h6"/><path d="M19 2v6"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <button type="submit" class="cw-prechat-submit" id="formSubmitButton">Send us a message</button>
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
                    <div id="livechatTypingIndicator" class="hidden flex flex-wrap items-center px-4 py-2 text-[12px] text-slate-600 not-italic" style="display:none;" aria-live="polite"></div>
                    <div class="cw-ms-scroll flex-1 min-h-0 overflow-y-auto">
                        <div class="cw-ms-scroll-inner">
                            <div class="cw-msg-list hidden" id="messagesContainer" style="display:none;"></div>
                        </div>
                    </div>
                    <div id="cwConversationClosedBanner" style="display:none;" aria-hidden="true"></div>
                    <footer class="cw-ms-footer hidden" id="inputContainer" style="display:none;">
                        <div id="cwReplyBar" class="cw-reply-compose hidden" style="display:none;" aria-live="polite">
                            <div class="cw-reply-compose-inner">
                                <div class="cw-reply-compose-bar" aria-hidden="true"></div>
                                <div class="cw-reply-compose-body">
                                    <span class="cw-reply-compose-label">Replying to</span>
                                    <span id="cwReplyBarPreview" class="cw-reply-compose-preview"></span>
                                </div>
                                <button type="button" class="cw-reply-compose-close" onclick="chatWidget.clearPendingReply()" title="Cancel reply" aria-label="Cancel reply">×</button>
                            </div>
                        </div>
                        <div id="cwSelectionFooter" class="hidden px-3 pt-2" style="display:none;">
                            <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                                <div class="flex items-center justify-between gap-2 mb-2">
                                    <button type="button" class="text-xs font-semibold text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 border-none bg-transparent cursor-pointer" onclick="chatWidget.clearMessageSelection()">Cancel</button>
                                    <div id="cwSelectionPreview" class="text-[11px] text-slate-500 truncate flex-1 text-right"></div>
                                </div>
                                <div class="flex flex-wrap gap-2 justify-center">
                                    <button type="button" class="text-xs font-semibold text-slate-800 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer" onclick="chatWidget.footerActionReply()">Reply</button>
                                    <button type="button" id="cwFooterEditBtn" class="text-xs font-semibold text-slate-800 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer hidden" onclick="chatWidget.footerActionEdit()">Edit</button>
                                </div>
                            </div>
                        </div>
                        <div id="cwVoiceRecordBanner" class="cw-voice-record-banner" role="status">
                            <span class="inline-flex items-center gap-2">
                                <span class="cw-voice-record-banner-dot" aria-hidden="true"></span>
                                <span id="cwVoiceRecordBannerText">Recording voice message… 0:00</span>
                            </span>
                            <button type="button" class="cw-voice-record-stop" onclick="chatWidget.toggleVoiceRecording()">Stop &amp; send</button>
                        </div>
                        <div class="cw-ms-composer">
                        <label for="chatInput" class="sr-only">Message</label>
                        <div id="inputWrapper" class="pb-2 px-2">
                            <textarea class="cw-ms-textarea" placeholder="Message…" id="chatInput" rows="1" onkeypress="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();chatWidget.sendMsg()}"></textarea>
                            <div class="cw-ms-toolbar">
                                <div class="cw-ms-toolbar-group">
                                    <button type="button" id="cwComposerAttachBtn" class="cw-ms-icon-btn" title="Attach file" onclick="chatWidget.showFileUploadPopup()" aria-label="Attach file">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                    </button>
                                    <button type="button" id="cwComposerEmojiBtn" class="cw-ms-icon-btn" title="Add emoji" onclick="chatWidget.toggleEmojiPicker()" aria-label="Add emoji">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/><path d="M16 5h6"/><path d="M19 2v6"/></svg>
                                    </button>
                                </div>
                                <div class="cw-ms-toolbar-group">
                                    <button type="button" id="cwComposerCallBtn" class="cw-ms-icon-btn hidden" title="Call agent" onclick="chatWidget.startVoiceCall()" aria-label="Call agent">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z"/></svg>
                                    </button>
                                    <button type="button" id="cwComposerVoiceBtn" class="cw-ms-icon-btn" title="Record voice message" onclick="chatWidget.toggleVoiceRecording()" aria-label="Record voice message">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                                    </button>
                                    <button type="button" class="cw-ms-send-btn" id="sendButton" onclick="chatWidget.sendMsg()" title="Send" aria-label="Send">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        </div>
                        <div id="emojiPickerContainer" style="position:fixed;left:0;bottom:0;display:none;z-index:10002;pointer-events:auto"></div>
                    </footer>
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
                    <nav class="cw-bottom-nav__tabs" role="tablist" aria-orientation="horizontal">
                        <button type="button" data-cw-nav="home" class="cw-nav-tab cw-nav-active" onclick="chatWidget.showScreen('home')" aria-label="Home" role="tab" aria-selected="true" aria-current="page">
                            <span class="cw-nav-icon-wrap" aria-hidden="true">
                                <svg class="cw-nav-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                    <polyline points="9 22 9 12 15 12 15 22"/>
                                </svg>
                            </span>
                            <span class="cw-nav-label">Home</span>
                        </button>
                        <button type="button" id="widgetBottomNavMessages" data-cw-nav="messages" class="cw-nav-tab" style="display:none" onclick="chatWidget.showScreen('messages')" aria-label="Messages" role="tab" aria-selected="false">
                            <span class="cw-nav-icon-wrap" aria-hidden="true">
                                <svg class="cw-nav-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z"/>
                                    <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>
                                </svg>
                            </span>
                            <span class="cw-nav-label">Messages</span>
                        </button>
                        <button type="button" data-cw-nav="help" class="cw-nav-tab" onclick="chatWidget.showScreen('help')" aria-label="Help" role="tab" aria-selected="false">
                            <span class="cw-nav-icon-wrap" aria-hidden="true">
                                <svg class="cw-nav-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                    <path d="M12 17h.01"/>
                                </svg>
                            </span>
                            <span class="cw-nav-label">Help</span>
                        </button>
                    </nav>
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
                            <input type="file" id="fileUploadInput" class="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.mp3,.wav,.ogg,.webm,.m4a,.mp4,.mov,.3gp" onchange="chatWidget.handleFileSelect(event)">
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
        return '';
    }

    function resolveAgentLabelForMessage(message) {
        try {
            if (typeof isShowAgentDetailEnabled === 'function' && !isShowAgentDetailEnabled()) {
                var bn = widgetState && widgetState.widgetSettings && widgetState.widgetSettings.brand_name;
                return bn ? String(bn) : 'Support';
            }
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
        var m = text.match(/https?:\/\/[^\s<&]+[^.,)\]<\s]*/i);
        if (!m) return null;
        return m[0].replace(/[.,)\]>]+$/g, '');
    }

    var linkPreviewCache = {};

    function isLinkPreviewEnabled() {
        var cfg = window.ChatWidgetConfig;
        return !(cfg && cfg.disableLinkPreviews === true);
    }

    function isDirectImageUrl(url) {
        if (!url) return false;
        return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(String(url));
    }

    function isStandaloneHttpUrl(text) {
        if (!text || typeof text !== 'string') return false;
        var trimmed = text.trim();
        var first = extractFirstHttpUrl(trimmed);
        return !!first && first === trimmed;
    }

    function isDownloadableAttachmentUrl(url) {
        if (!url) return false;
        var base = String(url).split('?')[0].split('#')[0].toLowerCase();
        var exts = [
            'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico',
            'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
            'zip', 'rar', '7z', 'tar', 'gz',
            'mp3', 'mp4', 'm4a', 'wav', 'mov', 'avi', 'webm', 'mkv'
        ];
        for (var i = 0; i < exts.length; i++) {
            if (base.endsWith('.' + exts[i])) return true;
        }
        return false;
    }

    function getLinkPreviewFetchUrl(targetUrl) {
        var cfg = window.ChatWidgetConfig || {};
        if (cfg.linkPreviewProxyUrl) {
            var base = String(cfg.linkPreviewProxyUrl).trim();
            if (base.indexOf('{{url}}') !== -1) {
                return base.replace(/\{\{url\}\}/g, encodeURIComponent(targetUrl));
            }
            var sep = base.indexOf('?') >= 0 ? '&' : '?';
            return base + sep + 'url=' + encodeURIComponent(targetUrl);
        }
        return 'https://api.microlink.io/?url=' + encodeURIComponent(targetUrl);
    }

    function fetchLinkPreviewMeta(url) {
        if (!url) return Promise.resolve(null);
        var cached = linkPreviewCache[url];
        if (cached) {
            return Promise.resolve(cached.failed ? null : cached);
        }
        return fetch(getLinkPreviewFetchUrl(url), { method: 'GET', credentials: 'omit' })
            .then(function (res) {
                if (!res || !res.ok) {
                    linkPreviewCache[url] = { failed: true };
                    return null;
                }
                return res.json();
            })
            .then(function (json) {
                if (!json || json.status !== 'success' || !json.data) {
                    linkPreviewCache[url] = { failed: true };
                    return null;
                }
                var d = json.data;
                var meta = {
                    title: d.title ? String(d.title).trim() : '',
                    description: d.description ? String(d.description).trim() : '',
                    siteName: d.publisher ? String(d.publisher).trim() : '',
                    image: d.image && d.image.url ? String(d.image.url) : ''
                };
                linkPreviewCache[url] = meta;
                return meta;
            })
            .catch(function () {
                linkPreviewCache[url] = { failed: true };
                return null;
            });
    }

    function applyLinkPreviewMetaToCard(cardEl, meta) {
        if (!cardEl || !meta) return;
        cardEl.classList.remove('cw-link-card--loading');
        if (meta.image && !cardEl.querySelector('.cw-link-card-image')) {
            cardEl.classList.add('cw-link-card--with-image');
            var accent = cardEl.querySelector('.cw-link-card-accent');
            if (accent) accent.style.display = 'none';
            var wrap = document.createElement('span');
            wrap.className = 'cw-link-card-image-wrap';
            var img = document.createElement('img');
            img.className = 'cw-link-card-image';
            img.src = meta.image;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            wrap.appendChild(img);
            cardEl.insertBefore(wrap, cardEl.firstChild);
        }
        var titleEl = cardEl.querySelector('.cw-link-card-title');
        if (titleEl && meta.title) titleEl.textContent = meta.title;
        var subEl = cardEl.querySelector('.cw-link-card-sub');
        if (subEl) {
            if (meta.siteName) subEl.textContent = meta.siteName;
            else if (meta.image) subEl.textContent = 'Web page';
        }
        var descEl = cardEl.querySelector('.cw-link-card-desc');
        if (descEl && meta.description) descEl.textContent = meta.description;
    }

    function hydrateLinkPreviewCard(cardEl, url) {
        if (!cardEl || !url || cardEl.getAttribute('data-cw-link-preview-hydrated') === '1') return;
        var cached = linkPreviewCache[url];
        if (cached && cached.failed) {
            cardEl.classList.remove('cw-link-card--loading');
            cardEl.setAttribute('data-cw-link-preview-hydrated', '1');
            return;
        }
        if (cached && !cached.failed) {
            applyLinkPreviewMetaToCard(cardEl, cached);
            cardEl.setAttribute('data-cw-link-preview-hydrated', '1');
            return;
        }
        fetchLinkPreviewMeta(url).then(function (meta) {
            if (!meta || !document.body.contains(cardEl)) {
                if (cardEl && document.body.contains(cardEl)) {
                    cardEl.classList.remove('cw-link-card--loading');
                }
                return;
            }
            applyLinkPreviewMetaToCard(cardEl, meta);
            cardEl.setAttribute('data-cw-link-preview-hydrated', '1');
        });
    }

    function hydrateAllLinkPreviewCards(root) {
        if (!isLinkPreviewEnabled()) return;
        var scope = root || document.getElementById('messagesContainer');
        if (!scope) return;
        var cards = scope.querySelectorAll('a.cw-link-card[data-cw-link-preview-url]');
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            var u = c.getAttribute('data-cw-link-preview-url');
            if (u) hydrateLinkPreviewCard(c, u);
        }
    }

    function buildLinkPreviewCardHtml(url, meta) {
        if (!url) return '';
        var u;
        try {
            u = new URL(url);
        } catch (e) {
            return '';
        }
        var hasMeta = meta && typeof meta === 'object' && !meta.failed;
        var host = escapeHtml(u.hostname || 'Link');
        var safeUrl = escapeHtml(url);
        var title = hasMeta && meta.title ? escapeHtml(String(meta.title).trim()) : host;
        var sub = hasMeta && meta.siteName
            ? escapeHtml(String(meta.siteName).trim())
            : (hasMeta && meta.image ? 'Image' : 'Web page');
        var desc = hasMeta && meta.description
            ? escapeHtml(String(meta.description).trim())
            : safeUrl;
        var cardClasses = 'cw-link-card';
        if (hasMeta && meta.image) cardClasses += ' cw-link-card--with-image';
        else if (!hasMeta) cardClasses += ' cw-link-card--loading';
        var imageHtml = '';
        if (hasMeta && meta.image) {
            imageHtml =
                '<span class="cw-link-card-image-wrap">' +
                '<img class="cw-link-card-image" src="' + escapeHtml(meta.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' +
                '</span>';
        }
        return (
            '<a class="' + cardClasses + '" href="' + safeUrl + '" data-cw-link-preview-url="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' +
            imageHtml +
            '<span class="cw-link-card-accent" aria-hidden="true"></span>' +
            '<span class="cw-link-card-body">' +
            '<span class="cw-link-card-title">' + title + '</span>' +
            '<span class="cw-link-card-sub">' + sub + '</span>' +
            '<span class="cw-link-card-desc">' + desc + '</span>' +
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
                txt = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (txt.length > 220) txt = txt.slice(0, 220) + '…';
                return { author: author, text: txt };
            }
        }
        return { author: 'Message', text: 'Original message' };
    }

    function messageReplySnippet(msg, maxLen) {
        var raw = msg && msg.message != null ? String(msg.message) : '';
        raw = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!raw) raw = 'Message';
        var max = maxLen != null ? maxLen : 72;
        if (raw.length > max) raw = raw.slice(0, max) + '…';
        return raw;
    }

    function syncReplyBarVisibility(show) {
        var rb = document.getElementById('cwReplyBar');
        if (!rb) return;
        if (show) {
            rb.classList.remove('hidden');
            rb.style.display = '';
        } else {
            rb.classList.add('hidden');
            rb.style.display = 'none';
        }
    }

    function updateReplyBarPreview() {
        var rbp = document.getElementById('cwReplyBarPreview');
        if (!rbp) return;
        var pendingId = widgetState.pendingInReplyOf;
        if (pendingId == null || String(pendingId) === '') {
            rbp.textContent = '';
            return;
        }
        var msg = getMessageFromStateByWidgetId(String(pendingId));
        rbp.textContent = messageReplySnippet(msg, 72);
    }

    function buildReplyQuoteHtml(message) {
        var pid = message && (message.in_reply_of != null ? message.in_reply_of : message.in_reply_to);
        if (pid == null || pid === '') return '';
        var q = resolveQuotedFromReply(message);
        if (!q) return '';
        return (
            '<div class="cw-quote-block cw-quote-block--interactive" data-reply-to="' + escapeHtml(String(pid)) + '" role="button" tabindex="0" aria-label="View original message">' +
            '<span class="cw-quote-block-bar" aria-hidden="true"></span>' +
            '<span class="cw-quote-text">' + escapeHtml(q.text.replace(/\s+/g, ' ')) + '</span>' +
            '</div>'
        );
    }

    function closeAllMessageMenus() {
        try {
            var openMenus = document.querySelectorAll('.cw-message-menu:not(.hidden)');
            for (var i = 0; i < openMenus.length; i++) {
                openMenus[i].classList.add('hidden');
                var dropdown = openMenus[i].parentElement;
                var trigger = dropdown && dropdown.querySelector('[data-cw-menu-trigger="1"]');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
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

    function updateReplyTargetHighlightUi() {
        var mc = document.getElementById('messagesContainer');
        if (!mc) return;
        var hid = widgetState.highlightedReplyTargetId;
        var rows = mc.querySelectorAll('.cw-msg-wrap');
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var id = r.getAttribute('data-message-id');
            if (hid && id === String(hid)) r.classList.add('cw-msg-reply-target');
            else r.classList.remove('cw-msg-reply-target');
        }
    }

    function highlightReplyTargetMessage(id) {
        if (!id) return;
        var s = String(id);
        if (widgetState.highlightedReplyTargetId === s) {
            widgetState.highlightedReplyTargetId = null;
        } else {
            widgetState.highlightedReplyTargetId = s;
            widgetState.selectedMessageId = null;
        }
        updateMessageRowsSelectedClass();
        updateReplyTargetHighlightUi();
        if (!widgetState.highlightedReplyTargetId) return;
        var mc = document.getElementById('messagesContainer');
        if (!mc) return;
        var row = mc.querySelector('.cw-msg-wrap[data-message-id="' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
        if (row && row.scrollIntoView) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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
        var hasReply = widgetState.pendingInReplyOf != null && String(widgetState.pendingInReplyOf) !== '';
        if (!iw) return;

        iw.classList.remove('hidden');

        if (sf) {
            sf.classList.add('hidden');
            sf.style.display = 'none';
        }

        syncReplyBarVisibility(hasReply);
        if (hasReply) updateReplyBarPreview();
    }

    function selectMessageByWidgetId(id, toggle) {
        if (!id) return;
        widgetState.highlightedReplyTargetId = null;
        if (toggle && widgetState.selectedMessageId === id) {
            widgetState.selectedMessageId = null;
        } else {
            widgetState.selectedMessageId = id;
        }
        closeAllMessageMenus();
        updateMessageSelectionUi();
        updateMessageRowsSelectedClass();
        updateReplyTargetHighlightUi();
    }

    function applyReplyToMessage(msg) {
        if (!msg || msg.id == null) return;
        widgetState.pendingInReplyOf = String(msg.id);
        widgetState.selectedMessageId = null;
        updateReplyBarPreview();
        syncReplyBarVisibility(true);
        updateMessageSelectionUi();
        updateMessageRowsSelectedClass();
        var inp = document.getElementById('chatInput');
        if (inp) inp.focus();
    }

    function installMessagesContainerClickDelegation() {
        var mc = document.getElementById('messagesContainer');
        if (!mc || mc._cwRowSelectBound) return;
        mc._cwRowSelectBound = true;
        mc.addEventListener('click', function(ev) {
            if (!ev || !ev.target) return;
            var t = ev.target;
            var quote = t.closest && t.closest('.cw-quote-block[data-reply-to]');
            if (quote) {
                if (ev.preventDefault) ev.preventDefault();
                if (ev.stopPropagation) ev.stopPropagation();
                var targetId = quote.getAttribute('data-reply-to');
                if (targetId) highlightReplyTargetMessage(targetId);
                return;
            }
            if (t.closest && t.closest('a[href], .cw-link-card, button, .cw-message-menu, .cw-message-menu-trigger, textarea, input, .cw-quick-replies')) {
                return;
            }
            var wrap = t.closest && t.closest('.cw-msg-wrap');
            if (!wrap) return;
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

    function placeTypingIndicatorUnderLastMessage() {
        var el = document.getElementById('livechatTypingIndicator');
        var mc = document.getElementById('messagesContainer');
        if (!el || !mc) return;
        mc.appendChild(el);
        el.classList.add('cw-typing-under-messages');
        setTimeout(function() { scrollMessagesToBottom(); }, 30);
    }

    function applyConversationTypingFromRealtime(data) {
        if (!data || String(data.conversation_number) !== String(widgetState.conversationNumber)) return;
        // Visitor must never see their own typing echo — only real agent typing.
        if (!data.actor || String(data.actor) !== 'agent') {
            return;
        }
        if (!isShowTypingIndicatorEnabled()) {
            clearAgentTypingUi();
            return;
        }
        var el = document.getElementById('livechatTypingIndicator');
        if (!el) return;
        if (data.typing) {
            var who = (data.label && String(data.label).trim()) ? String(data.label).trim() : 'Agent';
            el.innerHTML = '<span class="lc-typing-label">' + escapeTypingLabel(who) + ' is typing</span>' +
                '<span class="lc-typing-dots" aria-hidden="true"><b></b><b></b><b></b></span>';
            el.classList.remove('hidden');
            el.style.display = 'flex';
            placeTypingIndicatorUnderLastMessage();
            // Keep visible until agent focus-out sends typing:false (no idle auto-hide).
            if (agentTypingHideTimer) {
                clearTimeout(agentTypingHideTimer);
                agentTypingHideTimer = null;
            }
        } else {
            clearAgentTypingUi();
        }
    }

    function updateOutboundTicksInRow(row, status) {
        if (!row || !row.querySelector) return;
        var s = (status || '').toLowerCase();
        var sending = s === 'sending' || s === 'queued' || s === 'pending';
        var host = row.querySelector('[data-outbound-ticks="1"]');
        if (host) {
            host.innerHTML = buildOutboundTicksHtml(status);
        }
        if (!sending) {
            var footer = row.querySelector('.cw-bubble-footer');
            if (footer && footer.querySelector('.cw-status-sending') && !footer.querySelector('.cw-time')) {
                footer.innerHTML = '';
            }
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
        var brandLogo = getBrandLogoUrl();
        // When agent details are hidden, still show the brand logo as the agent avatar.
        if (typeof isShowAgentDetailEnabled === 'function' && !isShowAgentDetailEnabled()) {
            if (brandLogo) {
                return '<img class="cw-msg-avatar-img" src="' + escapeHtml(brandLogo) + '" alt="" width="28" height="28" loading="lazy" decoding="async"/>';
            }
            return '<svg viewBox="0 0 24 24" class="cw-msg-avatar-svg" aria-hidden="true"><path d="M12 12c2.8 0 5-2.2 5-5s-2.2-5-5-5-5 2.2-5 5 2.2 5 5 5zm0 2c-4.4 0-8 2.4-8 5.3V22h16v-2.7c0-2.9-3.6-5.3-8-5.3z" fill="rgba(0,0,0,0.35)"/></svg>';
        }

        var ag = widgetState && widgetState.assignedAgent;
        if (ag && ag.avatar_url) {
            return '<img class="cw-msg-avatar-img" src="' + escapeHtml(String(ag.avatar_url)) + '" alt="" width="28" height="28" loading="lazy" decoding="async"/>';
        }
        if (brandLogo) {
            return '<img class="cw-msg-avatar-img" src="' + escapeHtml(brandLogo) + '" alt="" width="28" height="28" loading="lazy" decoding="async"/>';
        }
        return '<svg viewBox="0 0 24 24" class="cw-msg-avatar-svg" aria-hidden="true"><path d="M12 12c2.8 0 5-2.2 5-5s-2.2-5-5-5-5 2.2-5 5 2.2 5 5 5zm0 2c-4.4 0-8 2.4-8 5.3V22h16v-2.7c0-2.9-3.6-5.3-8-5.3z" fill="rgba(0,0,0,0.35)"/></svg>';
    }

    /** True when message has audio/video media — those only allow Reply (no Edit/Delete). */
    function messageHasAudioOrVideoMedia(message) {
        if (!message) return false;
        if (extractCallAttachment(message)) return true;
        var list = message.attachments;
        if (!Array.isArray(list) || !list.length) return false;
        for (var i = 0; i < list.length; i++) {
            var raw = list[i];
            var url = '';
            var type = '';
            var mime = '';
            if (typeof raw === 'string') {
                url = raw;
            } else if (raw && typeof raw === 'object') {
                if (String(raw.type || '') === 'call') return true;
                url = String(raw.url || raw.path || '');
                type = String(raw.type || '').toLowerCase();
                mime = String(raw.mime_type || raw.mimeType || '').toLowerCase();
            }
            if (!url && !type && !mime) continue;
            var urlLower = String(url).toLowerCase().split('?')[0];
            var isWebm = /\.webm(\?|$)/i.test(urlLower) || mime.indexOf('webm') >= 0;
            if (
                type === 'audio' ||
                type === 'video' ||
                mime.indexOf('audio/') === 0 ||
                mime.indexOf('video/') === 0 ||
                isWebm ||
                /\.(ogg|mp3|wav|m4a|aac|opus|mp4|mov|avi|mkv|wmv|flv|3gp|m4v)(\?|$)/i.test(urlLower)
            ) {
                return true;
            }
        }
        return false;
    }

    function buildMessageMenuHtml(menuId, messageId, options) {
        var mid = messageId != null ? String(messageId) : '';
        var o = options || {};
        var orderClass = o.order != null ? (' order-' + String(o.order)) : '';
        if (!o.reply) return '';
        return '<div class="cw-msg-actions' + orderClass + '"><div class="cw-message-menu-wrap cw-reply-action-wrap">' +
            '<button type="button" class="cw-message-menu-trigger cw-reply-direct-btn" aria-label="Reply" title="Reply" onclick="event.stopPropagation();chatWidget.messageAction(\'reply\',\'' + mid + '\')">' +
            '<svg class="cw-message-menu-trigger-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m10 7-3 3 3 3"/><path d="M17 13v-1a2 2 0 0 0-2-2H7"/></svg>' +
            '</button></div></div>';
    }

    function extractCallAttachment(message) {
        if (!message) return null;
        if (message.call && typeof message.call === 'object') return message.call;
        var list = message.attachments;
        if (!Array.isArray(list)) return null;
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (item && typeof item === 'object' && String(item.type || '') === 'call') {
                return item;
            }
        }
        return null;
    }

    function formatCallLogDuration(seconds) {
        var secs = Math.max(0, Math.floor(Number(seconds) || 0));
        if (!secs) return '';
        var mins = Math.floor(secs / 60);
        var rem = secs % 60;
        if (mins > 0) return mins + ' min ' + rem + ' sec';
        return rem + ' sec';
    }

    function renderCallLogMessage(message) {
        var call = extractCallAttachment(message);
        if (!call) return null;

        // API stores agent POV; visitor POV flips outgoing <-> incoming.
        var agentDirection = String(call.direction || '').toLowerCase() === 'outgoing' ? 'outgoing' : 'incoming';
        var visitorDirection = agentDirection === 'outgoing' ? 'incoming' : 'outgoing';
        var status = String(call.call_status || call.status || 'completed').toLowerCase();
        var media = String(call.media || 'voice').toLowerCase() === 'video' ? 'video call' : 'voice call';
        var missedStatuses = { 'no-answer': 1, busy: 1, failed: 1, canceled: 1 };
        var missed = visitorDirection === 'incoming' && !!missedStatuses[status];
        var title = missed
            ? ('Missed ' + media)
            : (visitorDirection === 'outgoing' ? ('Outgoing ' + media) : ('Incoming ' + media));
        var durationText = formatCallLogDuration(call.duration);
        var subtitle = missed
            ? 'You missed this call'
            : (durationText || (visitorDirection === 'outgoing' ? 'Call ended' : 'Call answered'));

        var isMe = visitorDirection === 'outgoing';
        var timeLabel = typeof formatMessageClock === 'function'
            ? formatMessageClock(message.created_at)
            : '';
        var timeTitle = escapeHtml(String(message.created_at || ''));

        var wrap = document.createElement('div');
        wrap.className = 'cw-msg-wrap w-full max-w-full animate-fade-in';
        if (message && message.id != null) {
            wrap.setAttribute('data-message-id', String(message.id));
        }

        var arrowPath = visitorDirection === 'outgoing'
            ? '<path d="M15 4h5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
            : '<path d="M20 4l-5 5m0-4v4h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';

        var bubbleHtml =
            '<div class="cw-call-log-bubble ' + (isMe ? 'cw-call-me' : 'cw-call-them') + '">' +
                '<div class="cw-call-log-row">' +
                    '<span class="cw-call-log-glyph' + (missed ? ' cw-call-missed' : '') + '" aria-hidden="true">' +
                        '<svg viewBox="0 0 24 24" fill="none">' +
                            '<path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.4 11.4 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .57 3.57 1 1 0 0 1-.24 1.02l-2.21 2.2Z" fill="currentColor"/>' +
                            arrowPath +
                        '</svg>' +
                    '</span>' +
                    '<div style="min-width:0;flex:1">' +
                        '<p class="cw-call-log-title">' + escapeHtml(title) + '</p>' +
                        '<p class="cw-call-log-sub">' + escapeHtml(subtitle) + '</p>' +
                    '</div>' +
                '</div>' +
                (timeLabel
                    ? ('<span class="cw-call-log-time" title="' + timeTitle + '">' + escapeHtml(timeLabel) + '</span>')
                    : '') +
            '</div>';

        if (isMe) {
            wrap.innerHTML =
                '<div class="cw-msg-row cw-outbound">' +
                    '<div class="cw-msg-col cw-outbound">' +
                        '<div class="cw-msg-stack">' +
                            '<div class="cw-msg-bubble-group cw-out-group group">' + bubbleHtml + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        } else {
            wrap.innerHTML =
                '<div class="cw-msg-row cw-inbound">' +
                    '<div class="cw-msg-avatar shrink-0 mt-auto" aria-hidden="true">' +
                        (typeof buildInboundAvatarHtml === 'function' ? buildInboundAvatarHtml() : '') +
                    '</div>' +
                    '<div class="cw-msg-col cw-inbound">' +
                        '<div class="cw-msg-stack">' +
                            '<div class="cw-msg-bubble-group cw-in-group group">' + bubbleHtml + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        }

        return wrap;
    }

    function renderSystemStatusLogMessage(message) {
        var text = message && message.message != null ? String(message.message).trim() : '';
        if (!text) return null;
        var wrap = document.createElement('div');
        wrap.className = 'cw-msg-wrap cw-msg-system w-full max-w-full animate-fade-in';
        if (message && message.id != null) {
            wrap.setAttribute('data-message-id', String(message.id));
        }
        wrap.innerHTML = '<div class="cw-system-pill">' + escapeHtml(text) + '</div>';
        return wrap;
    }

    function renderMessage(message) {
        var dir0 = message && message.direction ? String(message.direction).toLowerCase() : '';
        if (message && message.status_log_tags) {
            return renderSystemStatusLogMessage(message);
        }
        var isTimeline =
            dir0 === 'system' ||
            (message && message.assignment_tags);
        if (isTimeline) {
            // Assignment logs stay hidden in the visitor widget.
            return null;
        }

        if (extractCallAttachment(message)) {
            var callEl = renderCallLogMessage(message);
            if (callEl) return callEl;
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
        
        // Standalone http(s) URLs: file extensions → attachment UI; web pages → link preview
        const messageText = message.message ? String(message.message) : '';
        const standaloneUrl = isStandaloneHttpUrl(messageText) ? extractFirstHttpUrl(messageText.trim()) : null;
        const isStandaloneFileAttachment = !!(standaloneUrl && isDownloadableAttachmentUrl(standaloneUrl));
        const isStandaloneWebUrl = !!(standaloneUrl && !isDownloadableAttachmentUrl(standaloneUrl));
        
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
        
        // If message is only a file URL and no attachments, treat it as attachment
        if (isStandaloneFileAttachment && attachments.length === 0) {
            attachments = [standaloneUrl];
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
        
        function normalizeAttachmentDescriptor(raw) {
            if (!raw) return null;
            if (typeof raw === 'string') {
                return { url: raw, type: '', mime_type: '', filename: raw.split('/').pop() || 'Attachment' };
            }
            if (typeof raw === 'object') {
                var url = raw.url || raw.path || '';
                if (!url) return null;
                return {
                    url: String(url),
                    type: String(raw.type || ''),
                    mime_type: String(raw.mime_type || raw.mimeType || ''),
                    filename: String(raw.filename || raw.name || (String(url).split('/').pop() || 'Attachment')),
                    duration: raw.duration
                };
            }
            return null;
        }

        function classifyAttachment(desc) {
            var urlLower = String(desc.url || '').toLowerCase().split('?')[0];
            var type = String(desc.type || '').toLowerCase();
            var mime = String(desc.mime_type || '').toLowerCase();
            var isWebm = /\.webm(\?|$)/i.test(urlLower) || mime.indexOf('webm') >= 0;
            // Chat voice notes are almost always webm from MediaRecorder (often mislabeled video/webm).
            var isAudio =
                type === 'audio' ||
                mime.indexOf('audio/') === 0 ||
                isWebm ||
                /\.(ogg|mp3|wav|m4a|aac|opus)(\?|$)/i.test(urlLower);
            var isVideo = !isAudio && (
                type === 'video' ||
                mime.indexOf('video/') === 0 ||
                /\.(mp4|mov|avi|mkv|wmv|flv|3gp|m4v)(\?|$)/i.test(urlLower)
            );
            var isImage = type === 'image' || mime.indexOf('image/') === 0 ||
                /\.(png|jpe?g|gif|svg|webp|bmp)(\?|$)/i.test(urlLower);
            return { isVideo: isVideo, isAudio: isAudio, isImage: isImage };
        }

        function seedWaveform(seed, bars) {
            var count = bars || 28;
            var out = [];
            var h = 2166136261;
            var s = String(seed || 'voice');
            for (var i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            for (var b = 0; b < count; b++) {
                h ^= b + 1;
                h = Math.imul(h, 16777619);
                var n = ((h >>> 0) % 70) / 100;
                out.push(0.22 + n);
            }
            return out;
        }

        // Helper function to render a single attachment (WhatsApp/Nilaq-style voice/video/image/doc)
        function renderAttachment(raw, opts) {
            var desc = normalizeAttachmentDescriptor(raw);
            if (!desc) return '';
            var kind = classifyAttachment(desc);
            var fileUrl = desc.url;
            var safeUrl = escapeHtml(fileUrl);
            var fileName = escapeHtml(desc.filename || 'Attachment');
            var isMine = !!(opts && opts.isMe);

            if (kind.isAudio) {
                var bars = seedWaveform(fileUrl, 34).map(function (h, idx) {
                    return '<span class="cw-voice-bar" style="height:' + Math.round(h * 100) + '%" data-i="' + idx + '"></span>';
                }).join('');
                return (
                    '<div class="cw-voice-msg mb-2 ' + (isMine ? 'cw-voice-me' : 'cw-voice-them') + '" data-audio-url="' + safeUrl + '">' +
                        '<button type="button" class="cw-voice-play" aria-label="Play voice message" onclick="chatWidget.toggleVoiceMessage(this)">' +
                            '<svg class="cw-voice-play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z"/></svg>' +
                            '<svg class="cw-voice-pause-icon hidden" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>' +
                        '</button>' +
                        '<div class="cw-voice-wave" onpointerdown="chatWidget.seekVoiceMessage(event, this)">' +
                            bars +
                            '<span class="cw-voice-knob" aria-hidden="true"></span>' +
                        '</div>' +
                        '<span class="cw-voice-dur">0:00</span>' +
                        '<span class="cw-voice-mic" aria-hidden="true">' +
                            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
                        '</span>' +
                    '</div>'
                );
            }

            if (kind.isVideo) {
                return (
                    '<div class="cw-video-msg mb-2">' +
                        '<video class="cw-video-el" src="' + safeUrl + '" playsinline preload="metadata" ' +
                            'onclick="chatWidget.toggleVideoMessage(this)" ' +
                            'controlsList="nodownload"></video>' +
                        '<button type="button" class="cw-video-play-overlay" aria-label="Play video" onclick="chatWidget.toggleVideoMessage(this.previousElementSibling)">' +
                            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
                        '</button>' +
                    '</div>'
                );
            }

            if (kind.isImage) {
                return '<div class="mb-2"><img src="' + safeUrl + '" alt="Attachment" class="max-w-full h-auto rounded-lg cursor-pointer" onclick="window.open(\'' + safeUrl + '\', \'_blank\')" style="max-height: 200px; object-fit: contain; background: transparent;"></div>';
            }

            return '<div class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors duration-200 max-w-[250px] mb-2" style="background-color: #e5e7eb;" onclick="window.open(\'' + safeUrl + '\', \'_blank\')">' +
                '<div class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md" style="background-color: #d1d5db;">' +
                    '<svg viewBox="0 0 24 24" fill="none" class="w-[18px] h-[18px] stroke-[#666] stroke-[2] fill-none">' +
                        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/>' +
                        '<path d="M14 2v6h6"/>' +
                        '<path d="M16 13H8"/>' +
                        '<path d="M16 17H8"/>' +
                        '<path d="M10 9H8"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="flex-1 min-w-0">' +
                    '<div class="text-[13px] font-medium text-[var(--text-color)] m-0 mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap">' + fileName + '</div>' +
                '</div>' +
            '</div>';
        }
        
        // Process all attachments
        if (attachments.length > 0) {
            // Visitor "outbound" = theirs (me); agent "inbound" = them.
            var voiceIsMine = !isInbound;
            attachmentContent = attachments.map(function (item) {
                return renderAttachment(item, { isMe: voiceIsMine });
            }).join('');
            
            // Add message text if it exists and is not a standalone file URL
            if (message.message && !isStandaloneFileAttachment) {
                messageContent = formatMessageBodyForWidget(message.message);
            }
        } else {
            // No attachments, just message text
            if (interactive) {
                messageContent = '';
            } else if (isStandaloneWebUrl && isLinkPreviewEnabled()) {
                messageContent = '';
            } else {
                messageContent = formatMessageBodyForWidget(message.message || '');
            }
        }

        var replyQuoteHtml = buildReplyQuoteHtml(message);
        var linkCardHtml = '';
        if (!interactive && message.message && !isStandaloneFileAttachment && isLinkPreviewEnabled()) {
            var firstUrl = extractFirstHttpUrl(message.message);
            if (firstUrl) {
                if (isDirectImageUrl(firstUrl)) {
                    try {
                        var imgHost = new URL(firstUrl).hostname;
                        linkCardHtml = buildLinkPreviewCardHtml(firstUrl, {
                            title: imgHost,
                            siteName: 'Image',
                            description: firstUrl,
                            image: firstUrl
                        });
                    } catch (eImg) {
                        linkCardHtml = buildLinkPreviewCardHtml(firstUrl);
                    }
                } else {
                    linkCardHtml = buildLinkPreviewCardHtml(firstUrl);
                }
            }
        }
            if (isInbound) {
            var inboundClock = formatMessageClock(message.created_at);
            var inboundTitle = escapeHtml(String(message.created_at || ''));
            var agentLabel = resolveAgentLabelForMessage(message);
            var menuId = 'cw_menu_' + (message && message.id != null ? String(message.id) : ('tmp_' + Math.random().toString(16).slice(2)));
            var midStr = (message && message.id != null) ? String(message.id) : '';
                var inboundFooterHtml = '<span class="cw-bubble-meta"><span class="cw-time cw-bubble-footer" title="' + inboundTitle + '">' + escapeHtml(inboundClock) + '</span></span>';
            var interactiveInbound = !!interactive;
            var hasStaticBubble = !!(replyQuoteHtml || attachmentContent || messageContent || linkCardHtml);
            var bubbleInner = '';
            if (interactiveInbound) {
                bubbleInner = '<div class="cw-msg-interactive-stack"><div class="cw-bubble-in cw-bubble-in--interactive order-1" data-cw-interactive="1"><div class="cw-bubble-text"></div></div><div class="cw-quick-replies" aria-label="Quick replies"></div></div>';
            } else if (hasStaticBubble) {
                bubbleInner = '<div class="cw-bubble-in order-1"><div class="cw-bubble-text">' + replyQuoteHtml + attachmentContent + (messageContent || '') + linkCardHtml + inboundFooterHtml + '</div></div>';
            }
            var inboundActionsHtml = buildMessageMenuHtml(menuId, midStr, { reply: true, placement: 'left', order: 2 });
            messageDiv.innerHTML = `
                <div class="cw-msg-row cw-inbound">
                    <div class="cw-msg-avatar shrink-0 mt-auto" aria-hidden="true">${buildInboundAvatarHtml()}</div>
                    <div class="cw-msg-col cw-inbound">
                        <p class="cw-msg-sender-name">${escapeHtml(agentLabel)}</p>
                        <div class="cw-msg-stack">
                            <div class="cw-msg-bubble-group cw-in-group group">
                                ${bubbleInner}
                                ${inboundActionsHtml}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            if (interactiveInbound) {
                messageDiv.classList.add('cw-msg-interactive');
                const bubble = messageDiv.querySelector('.cw-bubble-in[data-cw-interactive="1"]');
                const bubbleText = bubble ? bubble.querySelector('.cw-bubble-text') : null;
                if (bubble) {
                    bubble.removeAttribute('data-cw-interactive');
                    if (replyQuoteHtml && bubbleText) bubbleText.insertAdjacentHTML('beforeend', replyQuoteHtml);
                    if (attachmentContent && bubbleText) bubbleText.insertAdjacentHTML('beforeend', attachmentContent);
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
                if (bubbleText) {
                    bubbleText.appendChild(frag);
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
                if (bubbleText) bubbleText.insertAdjacentHTML('beforeend', inboundFooterHtml);
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
                ? ('<div class="cw-bubble-out order-2"><div class="cw-bubble-text">' + (replyQuoteHtml || '') + attachmentContent + (messageContent || '') + linkCardHtml +
                    '<span class="cw-bubble-meta"><span class="cw-time cw-bubble-footer" title="' + outTitle + '">' + escapeHtml(outClock) + '</span>' +
                    '<span data-outbound-ticks="1">' + tickHtml + '</span></span></div></div>')
                : '';
            var outMenuHtml = buildMessageMenuHtml(outMenuId, midStrOut, {
                reply: true,
                placement: 'right',
                order: 1
            });
            messageDiv.innerHTML = `
                <div class="cw-msg-row cw-outbound">
                    <div class="cw-msg-col cw-outbound">
                        <p class="cw-msg-sender-name cw-out">${visName}</p>
                        <div class="cw-msg-stack">
                            <div class="cw-msg-bubble-group cw-out-group group">
                                ${outMenuHtml}
                                ${outBubbleInner}
                            </div>
                        </div>
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
        var isClosed = String(widgetState.conversationStatus || '').toLowerCase() === 'closed';
        if (typeof isShowAgentDetailEnabled === 'function' && !isShowAgentDetailEnabled()) {
            var titleEl0 = document.getElementById('widgetHeaderTitle');
            var subEl0 = document.getElementById('widgetHeaderSubtitle');
            if (titleEl0 && widgetState.widgetSettings) {
                titleEl0.textContent = widgetState.widgetSettings.brand_name || 'Chat';
            }
            if (subEl0) {
                subEl0.textContent = isClosed ? '' : (isWidgetBusinessOnline() ? 'Online' : 'Away');
                if (isClosed) subEl0.classList.add('hidden');
                else subEl0.classList.remove('hidden');
            }
            return;
        }

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
            sub.textContent = isClosed ? '' : (isWidgetBusinessOnline() ? 'Online' : 'Away');
            if (isClosed) sub.classList.add('hidden');
            else sub.classList.remove('hidden');
            return;
        }
        var online = pr && String(pr.state).toLowerCase() === 'online';
        title.textContent = String(ag.name);
        sub.textContent = isClosed ? '' : (online ? 'Online' : 'Away');
        if (isClosed) sub.classList.add('hidden');
        else sub.classList.remove('hidden');
    }

    function applyBrandLogoToHeaderAvatar(wrap, img, dot, online) {
        if (!wrap || !img) return;
        var brandLogo = getBrandLogoUrl();
        var ph = document.getElementById('cwHeaderAvatarPlaceholder');
        var isClosed = String(widgetState.conversationStatus || '').toLowerCase() === 'closed';
        wrap.classList.remove('hidden');
        if (brandLogo) {
            if (ph) ph.classList.add('hidden');
            img.src = brandLogo;
            img.alt = '';
            img.classList.remove('hidden');
        } else {
            img.removeAttribute('src');
            img.classList.add('hidden');
            if (ph) ph.classList.remove('hidden');
        }
        if (dot) {
            if (isClosed) {
                dot.classList.add('hidden');
            } else {
                dot.classList.remove('hidden');
                dot.classList.toggle('cw-away', !online);
            }
        }
    }

    function updateAssignedAgentBarUi() {
        syncWidgetMessagesHeaderForAssignee();
        syncChatInputPlaceholder();

        var wrap = document.getElementById('cwHeaderAvatarWrap');
        var img = document.getElementById('cwHeaderAvatarImg');
        var dot = document.getElementById('cwHeaderPresenceDot');
        var mc0 = document.getElementById('messagesContainer');
        var onMessages = mc0 && mc0.style.display !== 'none' && !mc0.classList.contains('hidden');
        var onList = widgetState.messagesPane === 'list';

        if (typeof isShowAgentDetailEnabled === 'function' && !isShowAgentDetailEnabled()) {
            var barHide = document.getElementById('assignedAgentBar');
            if (barHide) {
                barHide.classList.add('hidden');
                barHide.style.display = 'none';
            }
            if (wrap && img && (onMessages || onList)) {
                applyBrandLogoToHeaderAvatar(wrap, img, dot, isWidgetBusinessOnline());
            } else if (wrap) {
                wrap.classList.add('hidden');
            }
            return;
        }

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
            if (wrap && img && dot) {
                var onlineBiz = isWidgetBusinessOnline();
                if (onMessages || onList) {
                    applyBrandLogoToHeaderAvatar(wrap, img, dot, onlineBiz);
                } else {
                    wrap.classList.add('hidden');
                    if (ph) ph.classList.add('hidden');
                }
            }
            return;
        }

        nameEl.textContent = String(ag.name);
        var online = pr && String(pr.state).toLowerCase() === 'online';
        var isClosedConv = String(widgetState.conversationStatus || '').toLowerCase() === 'closed';
        statusEl.textContent = isClosedConv ? '' : (online ? 'Online' : 'Offline');
        statusEl.className = 'text-[11px] leading-tight mt-0.5 ' + (isClosedConv ? 'hidden' : (online ? 'text-emerald-600 font-medium' : 'text-[var(--text-color)] opacity-65'));

        var mc = document.getElementById('messagesContainer');
        if (!mc || mc.style.display === 'none' || mc.classList.contains('hidden')) {
            if (!onList) {
                bar.classList.add('hidden');
                bar.style.display = 'none';
                if (wrap) wrap.classList.add('hidden');
                return;
            }
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
            var ph2 = document.getElementById('cwHeaderAvatarPlaceholder');
            var brandLogo = getBrandLogoUrl();
            wrap.classList.remove('hidden');
            if (ag.avatar_url) {
                if (ph2) ph2.classList.add('hidden');
                img.src = String(ag.avatar_url);
                img.alt = '';
                img.classList.remove('hidden');
            } else if (brandLogo) {
                if (ph2) ph2.classList.add('hidden');
                img.src = brandLogo;
                img.alt = '';
                img.classList.remove('hidden');
            } else {
                img.removeAttribute('src');
                img.classList.add('hidden');
                if (ph2) ph2.classList.remove('hidden');
            }
            if (isClosedConv) {
                dot.classList.add('hidden');
            } else {
                dot.classList.remove('hidden');
                dot.classList.toggle('cw-away', !online);
            }
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
            if (data.conversation_number) {
                // Keep list/open scoping in sync so polls and realtime refetch the same thread.
                widgetState.selectedConversationNumber = String(data.conversation_number);
            } else if (widgetState.visitorChatPolicy === 'multiple') {
                widgetState.messages = [];
            }
        }
        if (Object.prototype.hasOwnProperty.call(data, 'conversation_status')) {
            widgetState.conversationStatus = data.conversation_status || null;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'can_reply')) {
            widgetState.canReply = data.can_reply !== false;
        }
        if (data.visitor_chat_policy) {
            widgetState.visitorChatPolicy = data.visitor_chat_policy;
        }
        syncAssignedAgentFromPayload(data);
        if (typeof syncComposerFeatureButtons === 'function') syncComposerFeatureButtons();
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
    
    async function fetchMessages(conversationNumber) {
        try {
            const session = await initializeChatSession();
            if (!session || !session.token) {
                throw new Error('No session token available');
            }
            
            const visitorId = session.visitor_id || getVisitorId();
            var fetchOpts = {};
            if (conversationNumber) {
                fetchOpts.conversationNumber = conversationNumber;
            }
            // Messages API endpoint (no channel ID in path)
            const response = await fetch(getMessagesApiUrl(visitorId, fetchOpts), {
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
                        const retryResponse = await fetch(getMessagesApiUrl(newSession.visitor_id, fetchOpts), {
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
            var draft = '';
            if (typing) {
                var inputEl = document.getElementById('chatInput');
                draft = inputEl && typeof inputEl.value === 'string' ? inputEl.value : '';
                if (draft.length > 500) draft = draft.slice(0, 500);
            }
            await fetch(getVisitorTypingApiUrl(), {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + session.token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    typing: !!typing,
                    conversation_number: widgetState.conversationNumber,
                    draft: typing ? draft : null
                })
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

    /** Widget POV: agent/system replies are inbound relative to the visitor. */
    function isInboundDirection(msg) {
        return isInboundDirectionForUnread(msg);
    }

    function isCountableUnreadMessage(m) {
        if (!m || m.id == null) return false;
        if (String(m.id).indexOf('temp_') === 0) return false;
        if (m.assignment_tags || m.status_log_tags) return false;
        var d = m.direction ? String(m.direction).toLowerCase() : '';
        if (d === 'system') return false;
        if (typeof extractCallAttachment === 'function' && extractCallAttachment(m)) return false;
        if (m.call && typeof m.call === 'object') return false;
        return isInboundDirectionForUnread(m);
    }

    /**
     * Message "numbers" are random public IDs, not chronological.
     * Unread must be based on list order (API returns chronological), with last_seen as a watermark id.
     */
    function computeUnreadCountFromMessages(messages, lastSeen) {
        if (!Array.isArray(messages) || messages.length === 0) return 0;
        if (lastSeen == null || String(lastSeen) === '') return 0;
        var unread = 0;
        var seenWatermark = false;
        var lastSeenStr = String(lastSeen);
        for (var i = 0; i < messages.length; i++) {
            var m = messages[i];
            if (!m || m.id == null) continue;
            if (String(m.id) === lastSeenStr) {
                seenWatermark = true;
                continue;
            }
            if (!seenWatermark) continue;
            if (isCountableUnreadMessage(m)) unread++;
        }
        // Watermark missing (pruned history / identity change) — don't invent a spike.
        if (!seenWatermark) return 0;
        return unread;
    }

    function getLatestInboundId(messages) {
        if (!Array.isArray(messages) || messages.length === 0) return null;
        for (var i = messages.length - 1; i >= 0; i--) {
            var m = messages[i];
            if (isCountableUnreadMessage(m)) {
                return m.id;
            }
        }
        return null;
    }

    /** When the visitor is viewing the thread, advance past everything currently loaded. */
    function getThreadReadWatermark(messages) {
        if (!Array.isArray(messages) || messages.length === 0) return null;
        for (var i = messages.length - 1; i >= 0; i--) {
            var m = messages[i];
            if (!m || m.id == null) continue;
            if (String(m.id).indexOf('temp_') === 0) continue;
            return m.id;
        }
        return null;
    }

    function markThreadAsSeen(messages) {
        var watermark = getThreadReadWatermark(messages);
        if (watermark == null) {
            clearUnreadCount();
            return;
        }
        setLastSeenMessageId(watermark);
        clearUnreadCount();
        void markSeenUpTo(watermark);
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

            // First run: establish baseline at the end of the loaded thread
            // (message numbers are random — never compare numerically).
            if (!lastSeen) {
                var baseline = getThreadReadWatermark(fresh);
                if (baseline != null) setLastSeenMessageId(baseline);
                setUnreadCount(0);
                return;
            }

            var unreadNow = computeUnreadCountFromMessages(fresh, lastSeen);
            // Stale watermark not in list: re-baseline instead of leaving a stuck badge.
            if (unreadNow === 0 && getUnreadCount() > 0) {
                var found = false;
                for (var wi = 0; wi < fresh.length; wi++) {
                    if (fresh[wi] && String(fresh[wi].id) === String(lastSeen)) { found = true; break; }
                }
                if (!found) {
                    var resetMark = getThreadReadWatermark(fresh);
                    if (resetMark != null) setLastSeenMessageId(resetMark);
                    setUnreadCount(0);
                    return;
                }
            }
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
                markThreadAsSeen(fresh);
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
        var logoFallback = document.getElementById('widgetHomeLogoFallback');
        if (logoWrap) {
            logoWrap.classList.remove('hidden');
            if (settings.icon && logo) {
                logo.src = settings.icon;
                logo.alt = '';
                logo.classList.remove('hidden');
                if (logoFallback) logoFallback.classList.add('hidden');
            } else {
                if (logo) {
                    logo.classList.add('hidden');
                    logo.removeAttribute('src');
                }
                if (logoFallback) logoFallback.classList.remove('hidden');
            }
        }
        
        var kb = document.getElementById('widgetKnowledgeBaseRow');
        if (kb) kb.style.display = settings.knowledgebase === false ? 'none' : '';

        // Social options on home (WhatsApp / Telegram / Email icons only).
        // Direct message uses the full-width "Send us a message" button + bottom nav tab.
        var social = settings.social || null;
        var dmOn = isDirectMessageEnabled(settings);
        var waOn = !!(social && social.whatsapp && social.whatsapp.enabled);
        var tgOn = !!(social && social.telegram && social.telegram.enabled);
        var emOn = !!(social && social.email && social.email.enabled);
        var dmBtnWrap = document.getElementById('widgetDirectMessageBtnWrap');
        var waRow = document.getElementById('widgetWhatsAppRow');
        var tgRow = document.getElementById('widgetTelegramRow');
        var emRow = document.getElementById('widgetEmailRow');
        var socialSection = document.getElementById('widgetSocialChannelsSection');
        var messagesNavBtn = document.getElementById('widgetBottomNavMessages');
        if (dmBtnWrap) dmBtnWrap.style.display = dmOn ? '' : 'none';
        if (messagesNavBtn) messagesNavBtn.style.display = dmOn ? '' : 'none';
        if (waRow) waRow.style.display = waOn ? 'inline-flex' : 'none';
        if (tgRow) tgRow.style.display = tgOn ? 'inline-flex' : 'none';
        if (emRow) emRow.style.display = emOn ? 'inline-flex' : 'none';
        var socialCount = (waOn ? 1 : 0) + (tgOn ? 1 : 0) + (emOn ? 1 : 0);
        if (socialSection) socialSection.style.display = socialCount > 0 ? '' : 'none';
        if (!dmOn && widgetState.currentScreen === 'messages') {
            setTimeout(function () {
                if (window.chatWidget && typeof window.chatWidget.showScreen === 'function') {
                    window.chatWidget.showScreen('home');
                }
            }, 0);
        }

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
        widgetState.formRequired = isFormRequired(settings);

        var formLogo = document.getElementById('widgetFormLogo');
        var formLogoDefault = document.getElementById('widgetFormLogoDefault');
        if (formLogo && formLogoDefault) {
            if (settings.icon) {
                formLogo.src = settings.icon;
                formLogo.alt = '';
                formLogo.classList.remove('hidden');
                formLogoDefault.classList.add('hidden');
            } else {
                formLogo.classList.add('hidden');
                formLogo.removeAttribute('src');
                formLogoDefault.classList.remove('hidden');
            }
        }
        var titles = settings.titles || null;
        var formTitle = document.getElementById('cwFormTitle');
        var formSubtitle = document.getElementById('cwFormSubtitle');
        if (formTitle) formTitle.textContent = (titles && titles.heading) ? titles.heading : 'Send a message';
        if (formSubtitle) formSubtitle.textContent = (titles && titles.sub_heading) ? titles.sub_heading : "We'll get back to you in a few hours.";

        widgetState.widgetSettings = settings;
        if (settings.visitor_chat_policy) {
            widgetState.visitorChatPolicy = settings.visitor_chat_policy;
        }
        updateAssignedAgentBarUi();
        if (typeof syncComposerFeatureButtons === 'function') syncComposerFeatureButtons();
        else syncComposerVoiceCallButton();
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

    function isDirectMessageEnabled(settings) {
        var social = settings && settings.social ? settings.social : null;
        return !!(social && social.direct_message && social.direct_message.enabled);
    }

    function applyWidgetSettingsAndGate(settings) {
        if (!settings) return true;
        var container = document.getElementById('chatWidgetContainer');
        if (!container) return false;
        if (settings.status === false) {
            container.style.display = 'none';
            container.setAttribute('data-cw-disabled', '1');
            return false;
        }
        container.removeAttribute('data-cw-disabled');
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
            if (isVoiceCallsEnabled()) {
                void maybeInitVisitorWebRtc();
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
    
    function isPrechatFormOpen() {
        var form = document.getElementById('formContainer');
        if (!form) return false;
        return !form.classList.contains('hidden') && form.style.display !== 'none';
    }

    function syncPrechatFormChrome() {
        var form = document.getElementById('formContainer');
        var header = document.getElementById('mainHeader');
        var scroll = document.querySelector('#messagesScreen .cw-ms-scroll');
        if (!form) return;
        var open = isPrechatFormOpen();
        if (open && widgetState.currentScreen === 'messages') {
            form.classList.add('cw-prechat-visible');
            if (header) {
                header.classList.add('hide-on-home');
                header.style.display = 'none';
            }
            if (scroll) scroll.style.display = 'none';
        } else {
            form.classList.remove('cw-prechat-visible');
            if (scroll) scroll.style.removeProperty('display');
            if (header && widgetState.currentScreen === 'messages' && isViewingMessages()) {
                header.classList.remove('hide-on-home');
                header.style.display = 'flex';
            }
        }
    }

    var messagesEntryPrefetchPromise = null;

    function hasConversationNumber() {
        var cn = widgetState.conversationNumber;
        return cn !== null && cn !== undefined && cn !== '';
    }

    function isMultipleChatPolicy() {
        return widgetState.visitorChatPolicy === 'multiple';
    }

    function formatInboxRelativeTime(iso) {
        if (!iso) return '';
        try {
            var then = new Date(iso).getTime();
            if (!then) return '';
            var diff = Math.max(0, Date.now() - then);
            var mins = Math.floor(diff / 60000);
            if (mins < 1) return 'Now';
            if (mins < 60) return mins + 'm';
            var hours = Math.floor(mins / 60);
            if (hours < 24) return hours + 'h';
            var days = Math.floor(hours / 24);
            if (days < 7) return days + 'd';
            return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        } catch (e) {
            return '';
        }
    }

    function conversationListTitle(conv, index) {
        if (typeof isShowAgentDetailEnabled === 'function' && !isShowAgentDetailEnabled()) {
            var bn = widgetState && widgetState.widgetSettings && widgetState.widgetSettings.brand_name;
            if (bn && String(bn).trim()) return String(bn).trim();
            return 'Support';
        }
        var name = conv && conv.agent_name ? String(conv.agent_name).trim() : '';
        if (name) return name;
        return 'Support team';
    }

    function conversationListInitials(name) {
        var parts = String(name || 'S').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'S';
        var letters = parts.slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); });
        return letters.join('') || 'S';
    }

    function conversationAvatarHue(seed) {
        var s = String(seed || 'chat');
        var hash = 0;
        for (var i = 0; i < s.length; i++) hash = ((hash << 5) - hash) + s.charCodeAt(i);
        var hues = [210, 280, 340, 160, 20, 190];
        return hues[Math.abs(hash) % hues.length];
    }

    async function fetchVisitorConversations() {
        try {
            var session = await initializeChatSession(false);
            if (!session || !session.token) return [];
            var visitorId = session.visitor_id || getVisitorId();
            var response = await fetch(getConversationsApiUrl(visitorId), {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + session.token,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) return [];
            var data = await response.json();
            var list = Array.isArray(data.conversations) ? data.conversations : [];
            widgetState.conversations = list;
            var hasActive = list.some(function (c) {
                var s = String((c && c.status) || '').toLowerCase();
                return s === 'open' || s === 'pending' || c.is_active === true;
            });
            widgetState.canStartNewChat = isMultipleChatPolicy() && !hasActive;
            return list;
        } catch (e) {
            cwError('ChatWidget: fetch conversations failed', e);
            return [];
        }
    }

    function renderConversationsList(list) {
        var sectionsEl = document.getElementById('cwConversationsListSections');
        var emptyEl = document.getElementById('cwConversationsListEmpty');
        var newBtn = document.getElementById('cwInboxNewChatBtn');
        var footer = document.getElementById('cwInboxFooter');
        if (!sectionsEl) return;

        var conversations = Array.isArray(list) ? list : (widgetState.conversations || []);
        var items = [];
        var activeCount = 0;
        for (var i = 0; i < conversations.length; i++) {
            var c = conversations[i];
            if (!c || !c.number) continue;
            var status = String(c.status || '').toLowerCase();
            var isActive = status === 'open' || status === 'pending' || c.is_active === true;
            if (isActive) activeCount++;
            items.push(c);
        }

        widgetState.canStartNewChat = isMultipleChatPolicy() && activeCount === 0;
        if (footer) footer.style.display = (isMultipleChatPolicy() && activeCount === 0) ? '' : 'none';
        if (newBtn) {
            newBtn.style.display = '';
            newBtn.disabled = false;
            newBtn.textContent = 'Start a new chat';
        }

        if (items.length === 0) {
            sectionsEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            if (footer) footer.style.display = isMultipleChatPolicy() ? '' : 'none';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        var rows = items.map(function (conv, idx) {
            var status = String(conv.status || '').toLowerCase();
            var isClosed = !(status === 'open' || status === 'pending' || conv.is_active === true);
            var titleRaw = conversationListTitle(conv, idx);
            var title = escapeHtml(titleRaw);
            var preview = escapeHtml(String(conv.preview || (isClosed ? 'Conversation closed' : 'No messages yet')));
            var time = escapeHtml(formatInboxRelativeTime(conv.last_message_at));
            var unread = Math.max(0, parseInt(conv.unread, 10) || 0);
            var unreadBadge = unread > 0
                ? ('<span class="cw-inbox-badge">' + (unread > 99 ? '99+' : unread) + '</span>')
                : '';
            var closedBadge = isClosed ? '<span class="cw-inbox-status-badge">Closed</span>' : '';
            var avatarHtml;
            var brandLogo = getBrandLogoUrl();
            var showAgentDetail = typeof isShowAgentDetailEnabled !== 'function' || isShowAgentDetailEnabled();
            if (!showAgentDetail && brandLogo) {
                avatarHtml = '<span class="cw-inbox-avatar"><img src="' + escapeHtml(brandLogo) + '" alt="" /></span>';
            } else if (showAgentDetail && conv.agent_avatar_url) {
                avatarHtml = '<span class="cw-inbox-avatar"><img src="' + escapeHtml(String(conv.agent_avatar_url)) + '" alt="" /></span>';
            } else if (brandLogo) {
                avatarHtml = '<span class="cw-inbox-avatar"><img src="' + escapeHtml(brandLogo) + '" alt="" /></span>';
            } else {
                var hue = conversationAvatarHue(conv.number || titleRaw);
                avatarHtml = '<span class="cw-inbox-avatar" style="background:hsl(' + hue + ' 70% 48%)">' +
                    escapeHtml(conversationListInitials(titleRaw)) +
                    '</span>';
            }
            return (
                '<li>' +
                    '<button type="button" class="cw-inbox-item" data-cw-open-conversation="' + escapeHtml(String(conv.number)) + '">' +
                        avatarHtml +
                        '<span class="cw-inbox-item-body">' +
                            '<span class="cw-inbox-item-top">' +
                                '<span class="cw-inbox-item-title">' + title + '</span>' +
                                closedBadge +
                            '</span>' +
                            '<p class="cw-inbox-item-preview">' + preview + '</p>' +
                        '</span>' +
                        '<span class="cw-inbox-item-meta">' +
                            (time ? ('<span class="cw-inbox-item-time">' + time + '</span>') : '') +
                            unreadBadge +
                        '</span>' +
                    '</button>' +
                '</li>'
            );
        }).join('');

        sectionsEl.innerHTML = '<ul class="cw-inbox-list">' + rows + '</ul>';

        var buttons = sectionsEl.querySelectorAll('[data-cw-open-conversation]');
        for (var b = 0; b < buttons.length; b++) {
            buttons[b].addEventListener('click', function () {
                var num = this.getAttribute('data-cw-open-conversation');
                if (num) void chatWidget.openConversation(num);
            });
        }
    }

    async function showConversationsListPane() {
        widgetState.messagesPane = 'list';
        applyMessagesPaneView('list');
        var title = document.getElementById('widgetHeaderTitle');
        var sub = document.getElementById('widgetHeaderSubtitle');
        var avatarWrap = document.getElementById('cwHeaderAvatarWrap');
        if (title) title.textContent = 'Messages';
        if (sub) sub.textContent = '';
        if (avatarWrap) avatarWrap.classList.add('hidden');
        var bottomNav = document.getElementById('widgetBottomNav');
        if (bottomNav) bottomNav.style.display = 'flex';
        stopMessagePolling();
        var list = await fetchVisitorConversations();
        renderConversationsList(list);
        updateBottomNavActive('messages');
    }

    function resolveMessagesEntryViewFromState() {
        if (isMultipleChatPolicy()) {
            if (widgetState.messagesPane === 'conversation' && hasConversationNumber()) return 'conversation';
            if (widgetState.messagesPane === 'form') return 'form';
            if (widgetState.messagesPane === 'list') return 'list';
            // Default Messages tab destination for multiple chat.
            return 'list';
        }
        if (sessionStorage.getItem('chatWidgetFormSubmitted') === 'true') return 'conversation';
        if (hasConversationNumber()) return 'conversation';
        if (widgetState.formRequired === false) return 'conversation';
        if (widgetState.messagesLoaded && widgetState.messages !== null) {
            if (widgetState.formRequired === true) return 'form';
        }
        return null;
    }

    function applyMessagesPaneView(view) {
        var formContainer = document.getElementById('formContainer');
        var messagesContainer = document.getElementById('messagesContainer');
        var input = document.getElementById('inputContainer');
        var header = document.getElementById('mainHeader');
        var loaderContainer = document.getElementById('loaderContainer');
        var scroll = document.querySelector('#messagesScreen .cw-ms-scroll');
        var listPane = document.getElementById('cwConversationsListPane');
        var closedPane = document.getElementById('cwChatClosedPane');
        var assignedBar = document.getElementById('assignedAgentBar');
        var typingEl = document.getElementById('livechatTypingIndicator');

        function hideList() {
            if (listPane) listPane.classList.remove('cw-list-visible');
        }
        function showList() {
            if (listPane) listPane.classList.add('cw-list-visible');
        }
        function hideClosed() {
            if (closedPane) closedPane.classList.remove('cw-closed-visible');
        }
        function showClosed() {
            if (closedPane) closedPane.classList.add('cw-closed-visible');
        }

        if (view === 'loading') {
            if (loaderContainer) loaderContainer.style.display = 'flex';
            hideList();
            hideClosed();
            if (formContainer) {
                formContainer.classList.add('hidden');
                formContainer.classList.remove('cw-prechat-visible');
                formContainer.style.display = 'none';
            }
            if (messagesContainer) {
                messagesContainer.style.display = 'none';
                messagesContainer.classList.add('hidden');
            }
            if (input) {
                input.style.display = 'none';
                input.classList.add('hidden');
            }
            if (assignedBar) assignedBar.style.display = 'none';
            if (typingEl) {
                typingEl.classList.add('hidden');
                typingEl.style.display = 'none';
            }
            if (header) {
                header.classList.add('hide-on-home');
                header.style.display = 'none';
            }
            if (scroll) scroll.style.display = 'none';
            return;
        }

        if (loaderContainer) loaderContainer.style.display = 'none';

        if (view === 'list') {
            hideClosed();
            if (formContainer) {
                formContainer.classList.add('hidden');
                formContainer.classList.remove('cw-prechat-visible');
                formContainer.style.display = 'none';
            }
            if (messagesContainer) {
                messagesContainer.style.display = 'none';
                messagesContainer.classList.add('hidden');
            }
            if (input) {
                input.style.display = 'none';
                input.classList.add('hidden');
            }
            if (assignedBar) assignedBar.style.display = 'none';
            if (typingEl) {
                typingEl.classList.add('hidden');
                typingEl.style.display = 'none';
            }
            if (scroll) scroll.style.display = 'none';
            showList();
            if (header && widgetState.currentScreen === 'messages') {
                header.classList.remove('hide-on-home');
                header.style.display = 'flex';
            }
            return;
        }

        if (view === 'closed') {
            hideList();
            if (formContainer) {
                formContainer.classList.add('hidden');
                formContainer.classList.remove('cw-prechat-visible');
                formContainer.style.display = 'none';
            }
            if (messagesContainer) {
                messagesContainer.style.display = 'none';
                messagesContainer.classList.add('hidden');
            }
            if (input) {
                input.style.display = 'none';
                input.classList.add('hidden');
            }
            if (assignedBar) assignedBar.style.display = 'none';
            if (typingEl) {
                typingEl.classList.add('hidden');
                typingEl.style.display = 'none';
            }
            if (scroll) scroll.style.display = 'none';
            showClosed();
            if (header && widgetState.currentScreen === 'messages') {
                header.classList.remove('hide-on-home');
                header.style.display = 'flex';
            }
            return;
        }

        hideList();
        hideClosed();

        if (view === 'form') {
            if (formContainer) {
                formContainer.classList.remove('hidden');
                formContainer.classList.add('cw-prechat-visible');
                formContainer.style.display = 'flex';
                formContainer.style.visibility = 'visible';
                formContainer.style.opacity = '1';
            }
            if (messagesContainer) {
                messagesContainer.style.display = 'none';
                messagesContainer.classList.add('hidden');
            }
            if (input) {
                input.style.display = 'none';
                input.classList.add('hidden');
            }
            if (header) {
                header.classList.add('hide-on-home');
                header.style.display = 'none';
            }
            if (scroll) scroll.style.display = 'none';
            if (widgetState.widgetSettings) {
                updateFormFieldsVisibility(widgetState.widgetSettings);
            }
            return;
        }

        if (formContainer) {
            formContainer.classList.add('hidden');
            formContainer.classList.remove('cw-prechat-visible');
            formContainer.style.display = 'none';
        }
        if (messagesContainer) {
            messagesContainer.style.display = '';
            messagesContainer.classList.remove('hidden');
        }
        if (input) {
            input.style.display = 'block';
            input.classList.remove('hidden');
        }
        if (scroll) scroll.style.removeProperty('display');
        if (header && widgetState.currentScreen === 'messages') {
            header.classList.remove('hide-on-home');
            header.style.display = 'flex';
        }
    }

    function finalizeConversationPane(messages) {
        var list = messages != null ? messages : (widgetState.messages || []);
        var isClosed = String(widgetState.conversationStatus || '').toLowerCase() === 'closed';
        if (isClosed) {
            showChatClosedConfirmation();
            return;
        }
        displayMessages(list);
        markThreadAsSeen(list);
        updateAssignedAgentBarUi();
        if (typeof syncComposerFeatureButtons === 'function') syncComposerFeatureButtons();
        else syncComposerVoiceCallButton();
    }

    async function ensureMessagesEntryState() {
        var known = resolveMessagesEntryViewFromState();
        if (known) return known;

        try {
            var messagesData = await fetchMessages();
            widgetState.messages = messagesData.messages;
            widgetState.conversationNumber = messagesData.conversation_number;
            widgetState.messagesLoaded = true;

            if (hasConversationNumber() || sessionStorage.getItem('chatWidgetFormSubmitted') === 'true') {
                return 'conversation';
            }

            var settings = widgetState.widgetSettings || await fetchWidgetSettings();
            if (settings) widgetState.widgetSettings = settings;
            widgetState.formRequired = isFormRequired(settings);
            return widgetState.formRequired ? 'form' : 'conversation';
        } catch (e) {
            cwError('ChatWidget: ensureMessagesEntryState', e);
            return 'conversation';
        }
    }

    function prefetchMessagesEntryState() {
        if (messagesEntryPrefetchPromise) return messagesEntryPrefetchPromise;
        messagesEntryPrefetchPromise = ensureMessagesEntryState().catch(function (e) {
            messagesEntryPrefetchPromise = null;
            throw e;
        });
        return messagesEntryPrefetchPromise;
    }

    function updateFormFieldsVisibility(settings) {
        if (!settings) return;
        
        const preChatForm = settings.pre_chat_form;
        if (!preChatForm) return;
        
        const nameField = document.getElementById('formName');
        const emailField = document.getElementById('formEmail');
        const phoneField = document.getElementById('formPhone');
        const messageField = document.getElementById('formMessage');
        
        const messageRow = document.getElementById('formMessageRow');
        
        if (nameField) {
            const nameContainer = document.getElementById('formNameRow');
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
        
        if (emailField) {
            const emailContainer = document.getElementById('formEmailRow');
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
        
        if (phoneField) {
            const phoneContainer = document.getElementById('formPhoneRow');
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

        if (messageField && messageRow) {
            messageRow.style.display = 'flex';
            messageField.required = true;
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

    /**
     * Only retry sends that are safe to repeat without duplicating a saved message.
     * Never retry unbounded: a prior attempt may already have been stored server-side.
     */
    function isRetryableSendError(error) {
        var status = error && typeof error === 'object' ? error.status : null;
        if (status === 429 || status === 502 || status === 503 || status === 504) {
            return true;
        }
        // Network / abort / CORS: fetch rejects with no HTTP status.
        if (status == null && error instanceof TypeError) {
            return true;
        }
        var msg = error && typeof error === 'object' && error.message ? String(error.message) : '';
        var lower = msg.toLowerCase();
        if (status === 429 || lower.indexOf('too many') !== -1) {
            return true;
        }
        if (!status && (lower.indexOf('network') !== -1 || lower.indexOf('failed to fetch') !== -1)) {
            return true;
        }
        return false;
    }

    var SEND_MAX_ATTEMPTS = 4;

    function scheduleSendRetry(trySendFn, attempt, error, timeContainer) {
        var nextAttempt = (attempt || 0) + 1;
        if (nextAttempt >= SEND_MAX_ATTEMPTS || !isRetryableSendError(error)) {
            if (timeContainer) {
                try {
                    var failedClock = formatMessageClock(new Date().toISOString());
                    timeContainer.className = 'cw-time cw-bubble-footer';
                    timeContainer.title = 'Failed to send';
                    timeContainer.innerHTML = escapeHtml(failedClock);
                } catch (e) {}
            }
            try {
                var cfg = getApiConfig();
                if (cfg && cfg.onNotify) {
                    cfg.onNotify('Message could not be sent. Please try again.');
                }
            } catch (e2) {}
            return;
        }
        if (timeContainer) {
            timeContainer.innerHTML = '<span class="cw-status-sending" title="Sending" aria-label="Sending"></span>';
        }
        var status = error && typeof error === 'object' ? error.status : null;
        var isThrottle = status === 429;
        var base = isThrottle ? 1200 : 800;
        var delay = Math.min(30000, base * Math.pow(2, Math.min(nextAttempt, 5)));
        setTimeout(function () {
            void trySendFn(nextAttempt);
        }, delay);
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
    function appendOptimisticAgentMessageFromRealtime(data) {
        if (!data || data.is_private) return;
        var dir = data.direction != null ? String(data.direction).toLowerCase() : '';
        // Broadcast uses DB direction: agent replies are "outgoing".
        if (dir && dir !== 'outgoing' && dir !== 'inbound') return;
        var preview = data.preview != null ? String(data.preview) : '';
        if (!preview && data.message_id == null) return;

        var optId = data.message_id != null ? ('opt_agent_' + String(data.message_id)) : null;
        var list = widgetState.messages || [];
        if (optId) {
            for (var i = 0; i < list.length; i++) {
                var existing = list[i];
                if (!existing) continue;
                if (String(existing.id) === optId) return;
                if (existing._db_message_id != null && String(existing._db_message_id) === String(data.message_id)) return;
            }
        }

        var msg = {
            id: optId || ('opt_agent_' + Date.now()),
            _db_message_id: data.message_id != null ? data.message_id : null,
            message: preview,
            direction: 'inbound',
            from_name: data.agent_name || null,
            created_at: new Date().toISOString(),
            status: 'Delivered'
        };
        widgetState.messages = list.concat([msg]);

        var mc = document.getElementById('messagesContainer');
        if (!mc || mc.style.display === 'none' || mc.classList.contains('hidden')) return;
        // Avoid duplicate bubbles if poll already painted this text as last inbound.
        if (optId && mc.querySelector('[data-message-id="' + optId + '"]')) return;
        var rendered = renderMessage(msg);
        if (rendered) {
            mc.appendChild(rendered);
            setTimeout(function() { scrollMessagesToBottom(); }, 30);
        }
    }

    function applyRealtimeMessageListUpdate(messagesData, conv) {
        syncAssignedAgentFromPayload(messagesData || {});
        var messages = messagesData.messages || [];
        // Drop optimistic placeholders once the authoritative list arrives.
        var prevList = (widgetState.messages || []).filter(function(m) {
            return !(m && m.id != null && String(m.id).indexOf('opt_agent_') === 0);
        });
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

        // Unread counter + notification sound: only for new inbound chat items (not call logs).
        if (newItems.length > 0) {
            var inboundCount = 0;
            for (var ni = 0; ni < newItems.length; ni++) {
                if (isCountableUnreadMessage(newItems[ni])) inboundCount++;
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
                    markThreadAsSeen(messages);
                }
            }
        }
        widgetState.messages = messages;
        widgetState.conversationNumber = messagesData.conversation_number || conv;
        if (widgetState.conversationNumber) {
            widgetState.selectedConversationNumber = String(widgetState.conversationNumber);
        }
        widgetState.messagesLoaded = true;
        var mc = document.getElementById('messagesContainer');
        if (!mc || mc.style.display === 'none' || mc.classList.contains('hidden')) {
            return;
        }
        // Strip optimistic bubbles from the DOM before appending/rebuilding.
        var optNodes = mc.querySelectorAll('[data-message-id^="opt_agent_"]');
        for (var oi = 0; oi < optNodes.length; oi++) {
            if (optNodes[oi] && optNodes[oi].parentNode) {
                optNodes[oi].parentNode.removeChild(optNodes[oi]);
            }
        }
        // When polling won the race and already merged the new message into
        // widgetState.messages, `newItems` will be empty. Re-derive the diff
        // from what is actually rendered in the DOM so we still append the
        // missing bubbles.
        if (newItems.length === 0) {
            var renderedIds = new Set();
            for (var rIdx = 0; rIdx < mc.children.length; rIdx++) {
                var rid = mc.children[rIdx].getAttribute('data-message-id');
                if (rid && rid.indexOf('temp_') !== 0 && rid.indexOf('opt_agent_') !== 0) {
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
                var renderedRt = renderMessage(newItems[j]);
                if (renderedRt) mc.appendChild(renderedRt);
            }
            hydrateAllLinkPreviewCards(mc);
            setTimeout(function() {
                scrollMessagesToBottom();
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
            btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
            if (isAct) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        }
    }
    
    function getMessagesScrollContainer() {
        var mc = document.getElementById('messagesContainer');
        if (!mc) return null;
        var scroll = mc.closest('.cw-ms-scroll');
        return scroll || mc;
    }

    function scrollMessagesToBottom() {
        var el = getMessagesScrollContainer();
        if (el) el.scrollTop = el.scrollHeight;
    }

    function displayMessages(messages) {
        updateAssignedAgentBarUi();
        widgetState.selectedMessageId = null;
        widgetState.highlightedReplyTargetId = null;
        updateMessageSelectionUi();
        updateMessageRowsSelectedClass();
        updateReplyTargetHighlightUi();
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
            if (messageElement) messagesContainer.appendChild(messageElement);
        }
        var typingEl = document.getElementById('livechatTypingIndicator');
        if (typingEl && typingEl.style.display !== 'none' && !typingEl.classList.contains('hidden')) {
            messagesContainer.appendChild(typingEl);
        }
        hydrateAllLinkPreviewCards(messagesContainer);
        syncChatInputPlaceholder();
        if (typeof syncComposerFeatureButtons === 'function') syncComposerFeatureButtons();
        scrollMessagesToBottom();
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
                    if (Array.isArray(widgetState.messages) && widgetState.messages.length) {
                        markThreadAsSeen(widgetState.messages);
                    } else {
                        clearUnreadCount();
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
                            markThreadAsSeen(fresh);
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
            if (typeof isConversationReplyAllowed === 'function' && !isConversationReplyAllowed()) {
                notifyUser('This conversation is closed.');
                return;
            }

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
            const c = document.getElementById('messagesContainer');
            if (!c) {
                return;
            }
                
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
                        <div class="cw-msg-col cw-outbound">
                            <p class="cw-msg-sender-name cw-out">${escapeHtml(getVisitorDisplayName())}</p>
                            <div class="cw-msg-stack">
                                <div class="cw-msg-bubble-group cw-out-group group">
                                    <div class="cw-msg-actions order-1">
                                        <div class="relative">
                                            <button type="button" class="cw-message-menu-trigger" aria-hidden="true" tabindex="-1" disabled>
                                                <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" aria-hidden="true"><circle cx="12" cy="5" r="1.6" fill="rgba(60,60,60,0.45)"/><circle cx="12" cy="12" r="1.6" fill="rgba(60,60,60,0.45)"/><circle cx="12" cy="19" r="1.6" fill="rgba(60,60,60,0.45)"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="cw-bubble-out order-2">
                                        <div class="cw-bubble-text">${escapeHtml(messageText).replace(/\n/g, '<br>')}
                                            <span class="cw-bubble-meta">
                                                <span id="timeContainer_${messageId}" class="cw-bubble-footer" title="Sending"><span class="cw-status-sending" aria-label="Sending"></span></span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                try {
                c.appendChild(d);
                
                // Clear input
                i.value = '';
                i.style.height = 'auto';
                
                // Update send button state
                this.toggleSendButton();
                
                // Scroll to bottom
                scrollMessagesToBottom();
                
                // Send to API (never block the user; retry with backoff on throttling/network).
                const timeContainer = document.getElementById(`timeContainer_${messageId}`);
                const trySend = async (attempt) => {
                    try {
                        const sendOpts = {};
                        if (widgetState.pendingInReplyOf != null && String(widgetState.pendingInReplyOf) !== '') {
                            sendOpts.in_reply_of = String(widgetState.pendingInReplyOf);
                        }
                        const response = await sendMessageToAPI(messageText, {}, {}, sendOpts);
                        // Message is already stored server-side — never retry from here.
                        try {
                            if (sendOpts.in_reply_of) {
                                widgetState.pendingInReplyOf = null;
                                var rbp2 = document.getElementById('cwReplyBarPreview');
                                if (rbp2) rbp2.textContent = '';
                                syncReplyBarVisibility(false);
                                updateMessageSelectionUi();
                            }
                            if (response && response.token) {
                                saveSessionToken(response.token);
                            }
                            if (response && Object.prototype.hasOwnProperty.call(response, 'conversation_number')) {
                                widgetState.conversationNumber = response.conversation_number;
                                if (response.conversation_number) {
                                    widgetState.selectedConversationNumber = String(response.conversation_number);
                                }
                            }
                            if (response && response.is_new_conversation) {
                                widgetState.messages = [];
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
                                    var sentClock = formatMessageClock(new Date().toISOString());
                                    timeContainer.className = 'cw-time cw-bubble-footer';
                                    timeContainer.title = '';
                                    timeContainer.innerHTML = escapeHtml(sentClock);
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
                        } catch (afterSendErr) {
                            cwError('ChatWidget: post-send UI update failed', afterSendErr);
                        }
                        return;
                    } catch (error) {
                        scheduleSendRetry(trySend, attempt, error, timeContainer);
                    }
                };

                void trySend(0);
                } catch (sendUiErr) {
                    cwError('ChatWidget: sendMsg UI error', sendUiErr);
                }

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

        startVoiceCall: function () {
            void startVisitorOutboundCall();
        },

        _activeVoiceAudio: null,
        _voiceRecorder: null,
        _voiceChunks: null,
        _voiceStream: null,
        _voiceRecording: false,
        _voiceRecordTimerId: null,
        _voiceRecordStartedAt: null,

        _setVoiceRecordBanner: function (active, elapsedSec) {
            var banner = document.getElementById('cwVoiceRecordBanner');
            var textEl = document.getElementById('cwVoiceRecordBannerText');
            if (!banner) return;
            if (active) {
                banner.classList.add('is-active');
                var secs = Math.max(0, Math.floor(elapsedSec || 0));
                var mins = Math.floor(secs / 60);
                var rem = secs % 60;
                if (textEl) {
                    textEl.textContent = 'Recording voice message… ' + mins + ':' + String(rem).padStart(2, '0');
                }
            } else {
                banner.classList.remove('is-active');
                if (textEl) textEl.textContent = 'Recording voice message… 0:00';
            }
        },

        _updateVoiceProgressUi: function (wrap, audio) {
            if (!wrap || !audio) return;
            var durEl = wrap.querySelector('.cw-voice-dur');
            var knob = wrap.querySelector('.cw-voice-knob');
            var bars = wrap.querySelectorAll('.cw-voice-bar');
            var duration = audio.duration && isFinite(audio.duration) ? audio.duration : 0;
            var current = audio.currentTime || 0;
            var progress = duration > 0 ? Math.min(1, current / duration) : 0;
            var showTime = (!audio.paused || current > 0) ? current : duration;
            if (durEl) {
                var t = Math.floor(showTime || 0);
                durEl.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
            }
            if (knob) knob.style.left = (progress * 100) + '%';
            if (bars && bars.length) {
                for (var i = 0; i < bars.length; i++) {
                    if ((i / bars.length) <= progress) bars[i].classList.add('is-played');
                    else bars[i].classList.remove('is-played');
                }
            }
        },

        seekVoiceMessage: function (event, waveEl) {
            try {
                if (!waveEl) return;
                var wrap = waveEl.closest ? waveEl.closest('.cw-voice-msg') : null;
                if (!wrap) return;
                var audio = this._activeVoiceAudio;
                if (!audio || audio._wrap !== wrap) {
                    // Start this clip paused at the seek point, then play.
                    var playBtn = wrap.querySelector('.cw-voice-play');
                    if (playBtn) this.toggleVoiceMessage(playBtn);
                    audio = this._activeVoiceAudio;
                }
                if (!audio || !audio.duration || !isFinite(audio.duration)) return;
                var rect = waveEl.getBoundingClientRect();
                var ratio = Math.min(1, Math.max(0, ((event.clientX || 0) - rect.left) / Math.max(1, rect.width)));
                audio.currentTime = ratio * audio.duration;
                this._updateVoiceProgressUi(wrap, audio);
            } catch (e) {
                cwError('seekVoiceMessage failed', e);
            }
        },

        toggleVoiceMessage: function (btn) {
            try {
                var wrap = btn && btn.closest ? btn.closest('.cw-voice-msg') : null;
                if (!wrap) return;
                var url = wrap.getAttribute('data-audio-url');
                if (!url) return;
                var playIcon = btn.querySelector('.cw-voice-play-icon');
                var pauseIcon = btn.querySelector('.cw-voice-pause-icon');
                var self = this;

                if (this._activeVoiceAudio && this._activeVoiceAudio._wrap === wrap && !this._activeVoiceAudio.paused) {
                    this._activeVoiceAudio.pause();
                    wrap.classList.remove('is-playing');
                    if (playIcon) playIcon.classList.remove('hidden');
                    if (pauseIcon) pauseIcon.classList.add('hidden');
                    return;
                }

                if (this._activeVoiceAudio) {
                    try {
                        this._activeVoiceAudio.pause();
                        if (this._activeVoiceAudio._wrap) {
                            this._activeVoiceAudio._wrap.classList.remove('is-playing');
                            var prevBtn = this._activeVoiceAudio._wrap.querySelector('.cw-voice-play');
                            if (prevBtn) {
                                var pPlay = prevBtn.querySelector('.cw-voice-play-icon');
                                var pPause = prevBtn.querySelector('.cw-voice-pause-icon');
                                if (pPlay) pPlay.classList.remove('hidden');
                                if (pPause) pPause.classList.add('hidden');
                            }
                            self._updateVoiceProgressUi(this._activeVoiceAudio._wrap, this._activeVoiceAudio);
                        }
                    } catch (eStop) {}
                }

                var audio = new Audio(url);
                audio._wrap = wrap;
                this._activeVoiceAudio = audio;
                wrap.classList.add('is-playing');
                if (playIcon) playIcon.classList.add('hidden');
                if (pauseIcon) pauseIcon.classList.remove('hidden');

                audio.ontimeupdate = function () {
                    self._updateVoiceProgressUi(wrap, audio);
                };
                audio.onloadedmetadata = function () {
                    self._updateVoiceProgressUi(wrap, audio);
                };
                audio.onended = function () {
                    wrap.classList.remove('is-playing');
                    if (playIcon) playIcon.classList.remove('hidden');
                    if (pauseIcon) pauseIcon.classList.add('hidden');
                    audio.currentTime = 0;
                    self._updateVoiceProgressUi(wrap, audio);
                };
                void audio.play().catch(function () {
                    wrap.classList.remove('is-playing');
                    if (playIcon) playIcon.classList.remove('hidden');
                    if (pauseIcon) pauseIcon.classList.add('hidden');
                    notifyUser('Could not play this voice message.');
                });
            } catch (e) {
                cwError('toggleVoiceMessage failed', e);
            }
        },

        toggleVideoMessage: function (videoEl) {
            try {
                if (!videoEl || videoEl.tagName !== 'VIDEO') return;
                var wrap = videoEl.closest ? videoEl.closest('.cw-video-msg') : null;
                if (videoEl.paused) {
                    void videoEl.play().then(function () {
                        if (wrap) wrap.classList.add('is-playing');
                    }).catch(function () {
                        notifyUser('Could not play this video.');
                    });
                } else {
                    videoEl.pause();
                    if (wrap) wrap.classList.remove('is-playing');
                }
                videoEl.onended = function () {
                    if (wrap) wrap.classList.remove('is-playing');
                };
            } catch (e) {
                cwError('toggleVideoMessage failed', e);
            }
        },

        toggleVoiceRecording: async function () {
            if (typeof isVoiceMessageEnabled === 'function' && !isVoiceMessageEnabled()) {
                notifyUser('Voice messages are disabled.');
                return;
            }
            if (typeof isConversationReplyAllowed === 'function' && !isConversationReplyAllowed()) {
                notifyUser('This conversation is closed.');
                return;
            }

            var btn = document.getElementById('cwComposerVoiceBtn');
            var self = this;
            try {
                if (this._voiceRecording) {
                    if (this._voiceRecorder && this._voiceRecorder.state !== 'inactive') {
                        this._voiceRecorder.stop();
                    }
                    return;
                }

                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    notifyUser('Voice recording is not supported in this browser.');
                    return;
                }
                if (typeof MediaRecorder === 'undefined') {
                    notifyUser('Voice recording is not supported in this browser.');
                    return;
                }

                var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this._voiceStream = stream;
                this._voiceChunks = [];
                var mimeType = '';
                if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                    mimeType = 'audio/webm;codecs=opus';
                } else if (MediaRecorder.isTypeSupported('audio/webm')) {
                    mimeType = 'audio/webm';
                } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                    mimeType = 'audio/ogg';
                }
                var recorder = mimeType
                    ? new MediaRecorder(stream, { mimeType: mimeType })
                    : new MediaRecorder(stream);
                this._voiceRecorder = recorder;
                this._voiceRecording = true;
                this._voiceRecordStartedAt = Date.now();
                this._setVoiceRecordBanner(true, 0);
                if (this._voiceRecordTimerId) {
                    clearInterval(this._voiceRecordTimerId);
                }
                this._voiceRecordTimerId = setInterval(function () {
                    if (!self._voiceRecordStartedAt) return;
                    self._setVoiceRecordBanner(true, (Date.now() - self._voiceRecordStartedAt) / 1000);
                }, 250);
                if (btn) {
                    btn.classList.add('cw-recording');
                    btn.title = 'Stop & send voice message';
                }

                recorder.ondataavailable = function (ev) {
                    if (ev.data && ev.data.size > 0) {
                        self._voiceChunks.push(ev.data);
                    }
                };
                recorder.onstop = function () {
                    self._voiceRecording = false;
                    if (self._voiceRecordTimerId) {
                        clearInterval(self._voiceRecordTimerId);
                        self._voiceRecordTimerId = null;
                    }
                    self._voiceRecordStartedAt = null;
                    self._setVoiceRecordBanner(false, 0);
                    if (btn) {
                        btn.classList.remove('cw-recording');
                        btn.title = 'Record voice message';
                    }
                    try {
                        if (self._voiceStream) {
                            self._voiceStream.getTracks().forEach(function (t) { t.stop(); });
                        }
                    } catch (eTracks) {}
                    self._voiceStream = null;

                    // Always coerce to an audio MIME — some browsers emit video/webm for mic-only recordings.
                    var rawType = String(recorder.mimeType || mimeType || 'audio/webm').split(';')[0].toLowerCase();
                    var blobType = rawType.indexOf('ogg') >= 0 ? 'audio/ogg' : 'audio/webm';
                    var ext = blobType.indexOf('ogg') >= 0 ? 'ogg' : 'webm';
                    var blob = new Blob(self._voiceChunks || [], { type: blobType });
                    self._voiceChunks = null;
                    self._voiceRecorder = null;
                    if (!blob.size) {
                        notifyUser('Recording was empty. Please try again.');
                        return;
                    }
                    var file = new File([blob], 'voice-' + Date.now() + '.' + ext, { type: blobType });
                    void self.uploadAndSendVoiceNote(file);
                };
                recorder.start();
            } catch (e) {
                this._voiceRecording = false;
                if (this._voiceRecordTimerId) {
                    clearInterval(this._voiceRecordTimerId);
                    this._voiceRecordTimerId = null;
                }
                this._voiceRecordStartedAt = null;
                this._setVoiceRecordBanner(false, 0);
                if (btn) {
                    btn.classList.remove('cw-recording');
                    btn.title = 'Record voice message';
                }
                cwError('toggleVoiceRecording failed', e);
                notifyUser('Could not access microphone. Please allow mic permission and try again.');
            }
        },

        uploadAndSendVoiceNote: async function (file) {
            try {
                notifyUser('Sending voice message…');
                var session = await initializeChatSession(false);
                if (!session) throw new Error('No session');
                var formData = new FormData();
                formData.append('file', file);
                var uploadUrl = getUploadApiUrl(session.visitor_id);
                var response = await fetch(uploadUrl, {
                    method: 'POST',
                    headers: (function () {
                        var h = {};
                        if (session.token) h.Authorization = 'Bearer ' + session.token;
                        else if (session.session_key) h['X-Session-Key'] = session.session_key;
                        return h;
                    })(),
                    body: formData
                });
                if (response.status === 401) {
                    session = await initializeChatSession(true);
                    if (!session) throw new Error('No session');
                    response = await fetch(uploadUrl, {
                        method: 'POST',
                        headers: (function () {
                            var h = {};
                            if (session.token) h.Authorization = 'Bearer ' + session.token;
                            else if (session.session_key) h['X-Session-Key'] = session.session_key;
                            return h;
                        })(),
                        body: (function () {
                            var fd = new FormData();
                            fd.append('file', file);
                            return fd;
                        })()
                    });
                }
                if (!response.ok) throw new Error('Upload failed');
                var data = await response.json();
                if (!data || !data.success || !data.path) throw new Error('Upload failed');
                var fileId = 'voice_' + Date.now();
                var attachments = {};
                var forcedMime = (file && file.type && String(file.type).indexOf('audio/') === 0)
                    ? file.type
                    : 'audio/webm';
                attachments[fileId] = {
                    path: data.path,
                    type: 'audio',
                    mime_type: forcedMime,
                    filename: data.filename || file.name || ('voice-' + Date.now() + '.webm')
                };
                await sendMessageToAPI('', {}, attachments);
                var messagesData = await fetchMessages();
                if (messagesData && Array.isArray(messagesData.messages)) {
                    widgetState.messages = messagesData.messages;
                    widgetState.messagesLoaded = true;
                    displayMessages(messagesData.messages);
                }
            } catch (e) {
                cwError('uploadAndSendVoiceNote failed', e);
                notifyUser('Failed to send voice message. Please try again.');
            }
        },

        toggleMessageMenu: function (event, menuId) {
            try {
                ensureMessageMenuCloseHandlerInstalled();
                if (event && event.stopPropagation) event.stopPropagation();
                if (event && event.preventDefault) event.preventDefault();
                var el = document.getElementById(String(menuId || ''));
                var wasOpen = el && !el.classList.contains('hidden');
                closeAllMessageMenus();
                if (!el || wasOpen) return;
                el.classList.remove('hidden');
                var trigger = el.parentElement && el.parentElement.querySelector('[data-cw-menu-trigger="1"]');
                if (trigger) trigger.setAttribute('aria-expanded', 'true');
            } catch (e) {}
        },

        closeMessageMenus: function () {
            closeAllMessageMenus();
        },

        clearMessageSelection: function () {
            widgetState.selectedMessageId = null;
            widgetState.highlightedReplyTargetId = null;
            widgetState.editingMessageNumber = null;
            updateMessageSelectionUi();
            updateMessageRowsSelectedClass();
            updateReplyTargetHighlightUi();
        },

        clearPendingReply: function () {
            widgetState.pendingInReplyOf = null;
            var rbp = document.getElementById('cwReplyBarPreview');
            if (rbp) rbp.textContent = '';
            syncReplyBarVisibility(false);
            updateMessageSelectionUi();
        },

        footerActionReply: function () {
            var sel = widgetState.selectedMessageId;
            var msg = sel ? getMessageFromStateByWidgetId(sel) : null;
            if (!msg && widgetState.pendingInReplyOf) {
                msg = getMessageFromStateByWidgetId(widgetState.pendingInReplyOf);
            }
            if (!msg) return;
            applyReplyToMessage(msg);
            closeAllMessageMenus();
        },

        footerActionEdit: function () {
            var sel = widgetState.selectedMessageId;
            if (!sel) return;
            var msg = getMessageFromStateByWidgetId(sel);
            if (!msg || isInboundMessageObj(msg)) return;
            // Audio/video media: Reply only — never edit.
            if (messageHasAudioOrVideoMedia(msg)) return;
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
            if (rbp) rbp.textContent = '';
            syncReplyBarVisibility(false);
            updateMessageSelectionUi();
            updateMessageRowsSelectedClass();
            if (inp) inp.focus();
        },

        footerActionDelete: async function () {
            var sel = widgetState.selectedMessageId;
            if (!sel) return;
            var msg = getMessageFromStateByWidgetId(sel);
            if (!msg || isInboundMessageObj(msg)) return;
            // Audio/video media: Reply only — never delete.
            if (messageHasAudioOrVideoMedia(msg)) return;
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
            if (String(type) !== 'reply') return;
            if (idStr == null || idStr === '') return;
            var replyMsg = getMessageFromStateByWidgetId(String(idStr));
            if (replyMsg) applyReplyToMessage(replyMsg);
        },

        handleMessagesBack: function () {
            if (isMultipleChatPolicy() && (widgetState.messagesPane === 'conversation' || widgetState.messagesPane === 'closed' || widgetState.messagesPane === 'form')) {
                void this.showConversationsList();
                return;
            }
            void this.showScreen('home');
        },

        showConversationsList: async function () {
            if (!isMultipleChatPolicy()) {
                void this.showScreen('messages');
                return;
            }
            widgetState.currentScreen = 'messages';
            var messages = document.getElementById('messagesScreen');
            var home = document.getElementById('homeScreen');
            var help = document.getElementById('helpScreen');
            var bottomNav = document.getElementById('widgetBottomNav');
            [home, help].forEach(function (s) { if (s) s.classList.remove('active'); });
            if (messages) messages.classList.add('active');
            if (bottomNav) bottomNav.style.display = 'none';
            await showConversationsListPane();
            updateBottomNavActive('messages');
        },

        openConversation: async function (conversationNumber) {
            if (!conversationNumber) return;
            try {
                applyMessagesPaneView('loading');
                widgetState.selectedConversationNumber = String(conversationNumber);
                widgetState.conversationNumber = String(conversationNumber);
                widgetState.messagesPane = 'conversation';
                widgetState.currentScreen = 'messages';
                var bottomNav = document.getElementById('widgetBottomNav');
                if (bottomNav) bottomNav.style.display = 'none';
                var data = await fetchMessages();
                var list = (data && data.messages) || [];
                widgetState.messages = list;
                widgetState.messagesLoaded = true;
                widgetState.conversationNumber = (data && data.conversation_number) || String(conversationNumber);
                // Closed chats stay open as read-only history (composer disabled).
                applyMessagesPaneView('conversation');
                finalizeConversationPane(list);
                startMessagePolling(5000);
                void syncLiveChatRealtimeSubscription();
                syncComposerVoiceCallButton();
                if (typeof syncComposerFeatureButtons === 'function') syncComposerFeatureButtons();
            } catch (e) {
                cwError('ChatWidget: openConversation failed', e);
                notifyUser('Could not open that conversation.');
                await this.showConversationsList();
            }
        },

        startNewChat: async function () {
            if (!isMultipleChatPolicy()) {
                void this.showScreen('messages');
                return;
            }
            try {
                await initializeChatSession(false);
                var list = await fetchVisitorConversations();
                var hasActive = (list || []).some(function (c) {
                    var s = String((c && c.status) || '').toLowerCase();
                    return s === 'open' || s === 'pending' || c.is_active === true;
                });
                if (hasActive) {
                    notifyUser('Close your current chat before starting a new one.');
                    await this.showConversationsList();
                    return;
                }

                widgetState.selectedConversationNumber = null;
                widgetState.conversationNumber = null;
                widgetState.messages = [];
                widgetState.messagesLoaded = true;
                widgetState.conversationStatus = null;
                widgetState.canReply = true;
                widgetState.currentScreen = 'messages';

                var needsForm = widgetState.formRequired === true
                    && sessionStorage.getItem('chatWidgetFormSubmitted') !== 'true';
                if (needsForm) {
                    widgetState.messagesPane = 'form';
                    applyMessagesPaneView('form');
                } else {
                    widgetState.messagesPane = 'conversation';
                    applyMessagesPaneView('conversation');
                    finalizeConversationPane([]);
                    startMessagePolling(5000);
                }
                var bottomNav = document.getElementById('widgetBottomNav');
                if (bottomNav) bottomNav.style.display = 'none';
                updateBottomNavActive('messages');
            } catch (e) {
                cwError('ChatWidget: startNewChat failed', e);
                notifyUser('Could not start a new chat.');
            }
        },

        showScreen: async function(screen) {
            if (screen === 'messages' && !isDirectMessageEnabled(widgetState.widgetSettings)) {
                screen = 'home';
            }
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
                    try { bindSilentComposerMediaDrop(); } catch (eDropBind) {}
                    clearUnreadCount();
                    if (bottomNav) {
                        bottomNav.style.display = (isMultipleChatPolicy() && resolveMessagesEntryViewFromState() === 'list')
                            ? 'flex'
                            : 'none';
                    }
                    widgetState.currentScreen = 'messages';

                    var knownView = resolveMessagesEntryViewFromState();
                    if (knownView === 'list') {
                        await showConversationsListPane();
                        updateBottomNavActive('messages');
                    } else if (knownView) {
                        if (bottomNav) bottomNav.style.display = 'none';
                        applyMessagesPaneView(knownView);
                        if (knownView === 'conversation') {
                            finalizeConversationPane(widgetState.messages);
                        }
                        startMessagePolling(5000);
                        updateBottomNavActive('messages');
                        syncComposerVoiceCallButton();
                    } else {
                        applyMessagesPaneView('loading');
                        try {
                            if (messagesEntryPrefetchPromise) {
                                await messagesEntryPrefetchPromise;
                            } else {
                                await ensureMessagesEntryState();
                            }
                            var resolvedView = resolveMessagesEntryViewFromState() || (isMultipleChatPolicy() ? 'list' : 'conversation');
                            if (resolvedView === 'list') {
                                await showConversationsListPane();
                            } else {
                                if (bottomNav) bottomNav.style.display = 'none';
                                applyMessagesPaneView(resolvedView);
                                if (resolvedView === 'conversation') {
                                    finalizeConversationPane(widgetState.messages);
                                }
                                startMessagePolling(5000);
                            }
                            updateBottomNavActive('messages');
                            syncComposerVoiceCallButton();
                        } catch (error) {
                            cwError('Error loading messages:', error);
                            if (isMultipleChatPolicy()) {
                                await showConversationsListPane();
                            } else {
                                if (bottomNav) bottomNav.style.display = 'none';
                                applyMessagesPaneView('conversation');
                                finalizeConversationPane([]);
                                startMessagePolling(5000);
                            }
                            updateBottomNavActive('messages');
                        }
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
            const phoneField = document.getElementById('formPhone');
            const messageField = document.getElementById('formMessage');
            
            const name = nameField ? nameField.value.trim() : '';
            const email = emailField ? emailField.value.trim() : '';
            const phone = phoneField ? phoneField.value.trim() : '';
            const message = messageField ? messageField.value.trim() : '';
            
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
                                scheduleSendRetry(trySend, attempt, error, null);
                            }
                        };
                        void trySend(0);
                        
                        // On successful send, hide form and show messages
                        formContainer.classList.remove('active');
                        widgetState.messagesPane = 'conversation';
                        applyMessagesPaneView('conversation');
                        
                        // Fetch and display messages from API
                        const messagesData = await fetchMessages();
                        
                        // Update cached state
                        widgetState.messages = messagesData.messages;
                        widgetState.conversationNumber = messagesData.conversation_number;
                        widgetState.selectedConversationNumber = messagesData.conversation_number || null;
                        widgetState.messagesLoaded = true;
                        widgetState.formRequired = false;
                        
                        finalizeConversationPane(messagesData.messages);
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
            if (typeof isMediaUploadEnabled === 'function' && !isMediaUploadEnabled()) {
                notifyUser('Media upload is disabled.');
                return;
            }
            if (typeof isConversationReplyAllowed === 'function' && !isConversationReplyAllowed()) {
                notifyUser('This conversation is closed.');
                return;
            }
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
                    const maxSize = 25 * 1024 * 1024;
                    if (file.size > maxSize) {
                        notifyUser('File size exceeds 25MB limit. Please choose a smaller file.');
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
            if (typeof isMediaUploadEnabled === 'function' && !isMediaUploadEnabled()) {
                notifyUser('Media upload is disabled.');
                return;
            }
            let file = null;
            var fileList = event && event.target ? event.target.files : null;
            if ((!fileList || !fileList.length) && event && event.dataTransfer) {
                fileList = event.dataTransfer.files;
            }
            if (fileList && fileList.length > 0) {
                file = fileList[0] || (typeof fileList.item === 'function' ? fileList.item(0) : null);
            }
            if (!file) return;
            
            // Validate file size (25MB for audio/video)
            const maxSize = 25 * 1024 * 1024;
            if (file.size > maxSize) {
                notifyUser('File size exceeds 25MB limit. Please choose a smaller file.');
                return;
            }
            
            // Validate file type - check by extension first, then MIME type
            const allowedExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|pdf|doc|docx|xls|xlsx|txt|mp3|wav|ogg|webm|m4a|aac|mp4|mov|3gp|m4v)$/i;
            const allowedMimeTypes = [
                'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
                'application/pdf',
                'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/plain',
                'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/m4a', 'audio/aac',
                'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp'
            ];
            
            // Check by extension first (more reliable for some browsers)
            const hasValidExtension = allowedExtensions.test(file.name);
            // Check by MIME type (some files may have empty or incorrect MIME types)
            const hasValidMimeType = file.type && (
                allowedMimeTypes.includes(file.type) ||
                file.type.indexOf('audio/') === 0 ||
                file.type.indexOf('video/') === 0 ||
                file.type.indexOf('image/') === 0
            );
            
            // Allow if either extension or MIME type is valid
            if (!hasValidExtension && !hasValidMimeType) {
                notifyUser('File type not supported. Please upload images, audio, video, PDF, or documents.');
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
                
                // Prepare typed attachments so inbox/widget can render voice/video players
                const attachments = {};
                const uploadResp = this.uploadedFile.response;
                const uploadFile = this.uploadedFile.file;
                attachments[fileId] = {
                    path: uploadResp.path,
                    type: uploadResp.type || (uploadFile && uploadFile.type && uploadFile.type.indexOf('video/') === 0
                        ? 'video'
                        : (uploadFile && uploadFile.type && uploadFile.type.indexOf('audio/') === 0 ? 'audio' : undefined)),
                    mime_type: uploadResp.mime_type || (uploadFile ? uploadFile.type : null),
                    filename: uploadResp.filename || (uploadFile ? uploadFile.name : null)
                };
                
                // Send message with attachment (empty message text) — never block; retry silently on throttling/network.
                const trySend = async (attempt) => {
                    try {
                        await sendMessageToAPI('', {}, attachments);
                        return;
                    } catch (error) {
                        scheduleSendRetry(trySend, attempt, error, null);
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
    
    function bindSilentComposerMediaDrop() {
        var targets = [
            document.getElementById('messagesScreen'),
            document.getElementById('inputContainer'),
            document.getElementById('chatInput'),
            document.getElementById('chatWidget')
        ].filter(Boolean);

        function dropHasFiles(dt) {
            if (!dt) return false;
            if (dt.files && dt.files.length > 0) return true;
            var types = Array.prototype.slice.call(dt.types || []);
            return types.indexOf('Files') !== -1;
        }

        function isFileUploadPopupOpen() {
            var popup = document.getElementById('fileUploadPopup');
            return !!(popup && !popup.classList.contains('hidden'));
        }

        function isInsideFileUploadPopup(target) {
            if (!target || !target.closest) return false;
            return !!target.closest('#fileUploadPopup');
        }

        function openUploadModalForDrag() {
            if (!window.chatWidget || typeof window.chatWidget.showFileUploadPopup !== 'function') return;
            if (isFileUploadPopupOpen()) {
                // Ensure drop-zone listeners are ready while dragging.
                if (typeof window.chatWidget.initializeFileUpload === 'function') {
                    window.chatWidget.initializeFileUpload();
                }
                return;
            }
            window.chatWidget.showFileUploadPopup();
        }

        function onDragEnterOrOver(e) {
            if (typeof isMediaUploadEnabled === 'function' && !isMediaUploadEnabled()) return;
            if (typeof isConversationReplyAllowed === 'function' && !isConversationReplyAllowed()) return;
            if (!dropHasFiles(e.dataTransfer)) return;
            // Let the modal drop-zone handle its own highlight when already open.
            if (isInsideFileUploadPopup(e.target)) {
                e.preventDefault();
                try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            try { e.dataTransfer.dropEffect = 'copy'; } catch (err2) {}
            openUploadModalForDrag();
        }

        function onDrop(e) {
            if (typeof isMediaUploadEnabled === 'function' && !isMediaUploadEnabled()) return;
            if (typeof isConversationReplyAllowed === 'function' && !isConversationReplyAllowed()) return;
            var files = e.dataTransfer && e.dataTransfer.files;
            if (!files || !files.length) return;

            // If drop is already inside the upload modal zone, leave it to that handler.
            if (isInsideFileUploadPopup(e.target)) return;

            e.preventDefault();
            e.stopPropagation();
            openUploadModalForDrag();
            if (window.chatWidget && typeof window.chatWidget.handleFileSelect === 'function') {
                window.chatWidget.handleFileSelect({ target: { files: files } });
            }
        }

        targets.forEach(function(el) {
            if (el.getAttribute('data-cw-media-drag') === '1') return;
            el.setAttribute('data-cw-media-drag', '1');
            el.addEventListener('dragenter', onDragEnterOrOver, true);
            el.addEventListener('dragover', onDragEnterOrOver, true);
            el.addEventListener('drop', onDrop, true);
        });
    }

    function initializeWidget() {
        // Wait a bit to ensure DOM is fully updated
        setTimeout(function() {
            try { bindSilentComposerMediaDrop(); } catch (eDrop) {}
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
                var typingKeepAliveId = null;
                var typingActive = false;
                function stopTypingKeepAlive() {
                    if (typingKeepAliveId) {
                        clearInterval(typingKeepAliveId);
                        typingKeepAliveId = null;
                    }
                }
                function startTypingKeepAlive() {
                    stopTypingKeepAlive();
                    typingKeepAliveId = setInterval(function() {
                        if (!typingActive || document.activeElement !== chatInput) {
                            stopTypingKeepAlive();
                            return;
                        }
                        if (!widgetState.conversationNumber) return;
                        void postVisitorTypingToApi(true);
                    }, 2500);
                }
                chatInput.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = this.scrollHeight + 'px';
                    if (window.chatWidget) {
                        window.chatWidget.toggleSendButton();
                    }
                    if (widgetState.conversationNumber && typeof isConversationReplyAllowed === 'function' && isConversationReplyAllowed()) {
                        if (typingPulseTimer) clearTimeout(typingPulseTimer);
                        typingPulseTimer = setTimeout(function() {
                            typingActive = true;
                            void postVisitorTypingToApi(true);
                            startTypingKeepAlive();
                        }, 450);
                    }
                });
                chatInput.addEventListener('blur', function() {
                    if (typingPulseTimer) {
                        clearTimeout(typingPulseTimer);
                        typingPulseTimer = null;
                    }
                    stopTypingKeepAlive();
                    if (typingActive || widgetState.conversationNumber) {
                        typingActive = false;
                        void postVisitorTypingToApi(false);
                    }
                });
                if (window.chatWidget) {
                    window.chatWidget.toggleSendButton();
                }
            }
        }, 100);
    }
    
})();
