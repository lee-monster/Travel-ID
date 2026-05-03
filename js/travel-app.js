// Travel-ID - travel-id.kr Main Application
// Requires: sites/travel/lang.js (translations)

(function() {
  'use strict';

  // === Resolve initial language from URL > localStorage > default ===
  // Travel-ID covers Indonesia + Malaysia and serves both international visitors
  // and local residents, so id (Bahasa Indonesia) and ms (Bahasa Melayu) are
  // first-class peer languages — not just translation targets.
  var SUPPORTED_LANGS = ['en', 'id', 'ms', 'ko', 'zh', 'ja', 'ar'];
  var RTL_LANGS = ['ar'];
  function isRtl(lang) { return RTL_LANGS.indexOf(lang) !== -1; }

  function resolveInitialLang() {
    var urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang && SUPPORTED_LANGS.indexOf(urlLang) !== -1) return urlLang;
    var stored = localStorage.getItem('travelid_lang');
    if (stored && SUPPORTED_LANGS.indexOf(stored) !== -1) return stored;
    // Auto-detect from browser language. Collapse zh-* / zh-Hans / zh-CN / zh-TW → 'zh',
    // and ar-* (ar-SA, ar-AE, ar-EG, ...) → 'ar'.
    var nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    var primary = nav.split('-')[0];
    if (primary === 'zh') return 'zh';
    if (primary === 'ar') return 'ar';
    if (SUPPORTED_LANGS.indexOf(primary) !== -1) return primary;
    // Indonesian browsers may report 'in' (legacy ISO 639-1 alias).
    if (primary === 'in') return 'id';
    // Timezone heuristic: pick id for Indonesia, ms for Malaysia.
    try {
      var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
      if (tz.indexOf('asia/jakarta') !== -1 || tz.indexOf('asia/makassar') !== -1 ||
          tz.indexOf('asia/jayapura') !== -1 || tz.indexOf('asia/pontianak') !== -1) return 'id';
      if (tz.indexOf('asia/kuala_lumpur') !== -1 || tz.indexOf('asia/kuching') !== -1) return 'ms';
    } catch (e) {}
    return 'en';
  }

  // === State ===
  var state = {
    lang: resolveInitialLang(),
    category: 'all',
    region: '',
    search: '',
    spots: [],
    hasMore: false,
    nextCursor: null,
    loading: false,
    selectedSpot: null,
    map: null,
    markers: [],
    infoWindows: [],
    mapLoaded: false,
    mapProvider: 'google',
    mapConfig: null,
    // Auth
    authUser: null,
    authToken: null,
    // Bookmarks: [{spotId, type}]
    bookmarks: [],
    activeTab: 'explore',
    // Travel preferences (persisted in localStorage)
    travelPrefs: JSON.parse(localStorage.getItem('travelid_prefs') || '{"muslim":false,"vegan":false,"visitType":null}'),
    // Cache all loaded spots by id for bookmark lookup across filters
    spotCache: {}
  };

  var CAT_ICONS = {
    beach: '🏖️', temple: '🛕', cultural: '🎭', volcano: '🌋',
    nature: '🌿', diving: '🤿', food: '🍜', cafe: '☕',
    shopping: '🛍️', nightlife: '🌙', museum: '🏛️',
    adventure: '🧗', wellness: '🧘',
    mosque: '🕌', halal: '🥘', vegetarian: '🥗'
  };

  var CAT_COLORS = {
    beach: '#06B6D4', temple: '#A855F7', cultural: '#6B7280',
    volcano: '#DC2626', nature: '#22C55E', diving: '#0EA5E9',
    food: '#F59E0B', cafe: '#F97316', shopping: '#8B5CF6',
    nightlife: '#EC4899', museum: '#64748B',
    adventure: '#EF4444', wellness: '#10B981',
    mosque: '#14B8A6', halal: '#2563EB', vegetarian: '#65A30D'
  };

  // === Map Provider (Google Maps only — Naver Maps does not cover Indonesia) ===
  var MapProviders = {
    google: {
      loadSDK: function(config, lang, cb) {
        var existing = document.getElementById('map-sdk-script');
        if (existing) existing.remove();
        state.map = null;
        window._taMap = null;
        var script = document.createElement('script');
        script.id = 'map-sdk-script';
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + config.googleKey + '&language=' + lang;
        script.onload = function() { cb(); };
        script.onerror = function() { cb(new Error('Failed to load Google Maps SDK')); };
        document.head.appendChild(script);
      },
      createMap: function(elementId) {
        // Zoom + scale controls hidden to keep the bottom-right FAB clear
        // for "Share a Spot". Pinch/scroll zoom and the map-type toggle still work.
        // Default center: Bali (the most-searched Indonesia destination).
        // Indonesia spans 5,000km — fitBounds() will reframe once spots load.
        return new google.maps.Map(document.getElementById(elementId), {
          center: { lat: -8.4095, lng: 115.1889 },
          zoom: 6,
          mapTypeControl: false,
          zoomControl: false,
          streetViewControl: false,
          fullscreenControl: false
        });
      },
      _svgIcon: function(color, icon, bookmarkType) {
        if (bookmarkType) {
          var bg = bookmarkType === 'want_to_visit' ? '#2563EB' : '#EF4444';
          var ch = bookmarkType === 'want_to_visit' ? 'V' : '♥';
          var fontWeight = bookmarkType === 'want_to_visit' ? 800 : 400;
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">' +
            '<circle cx="18" cy="26" r="14" fill="' + color + '" stroke="white" stroke-width="3"/>' +
            '<text x="18" y="31" text-anchor="middle" font-size="15">' + icon + '</text>' +
            '<circle cx="33" cy="11" r="9" fill="' + bg + '" stroke="white" stroke-width="2"/>' +
            '<text x="33" y="15" text-anchor="middle" font-size="11" font-weight="' + fontWeight + '" fill="white">' + ch + '</text>' +
            '</svg>';
          return {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
            scaledSize: new google.maps.Size(44, 44),
            anchor: new google.maps.Point(18, 26)
          };
        }
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">' +
          '<circle cx="15" cy="15" r="12" fill="' + color + '" stroke="white" stroke-width="3"/>' +
          '<text x="15" y="19" text-anchor="middle" font-size="13">' + icon + '</text>' +
          '</svg>';
        return {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(30, 30),
          anchor: new google.maps.Point(15, 15)
        };
      },
      addMarker: function(map, lat, lng, color, icon, bookmarkType) {
        return new google.maps.Marker({
          position: { lat: lat, lng: lng },
          map: map,
          icon: this._svgIcon(color, icon, bookmarkType),
          zIndex: bookmarkType ? 100 : undefined
        });
      },
      createInfoWindow: function(html) {
        return new google.maps.InfoWindow({ content: html });
      },
      openInfoWindow: function(iw, map, marker) { iw.open(map, marker); },
      closeInfoWindow: function(iw) { iw.close(); },
      removeMarker: function(m) { m.setMap(null); },
      onMarkerClick: function(marker, cb) { marker.addListener('click', cb); },
      panTo: function(map, lat, lng) { map.panTo({ lat: lat, lng: lng }); },
      getCenter: function(map) { var c = map.getCenter(); return { lat: c.lat(), lng: c.lng() }; },
      setCenter: function(map, lat, lng) { map.setCenter({ lat: lat, lng: lng }); },
      getZoom: function(map) { return map.getZoom(); },
      setZoom: function(map, z) { map.setZoom(z); },
      triggerResize: function(map) { google.maps.event.trigger(map, 'resize'); },
      fitBounds: function(map, spots) {
        var bounds = new google.maps.LatLngBounds();
        spots.forEach(function(s) { if (s.lat && s.lng) bounds.extend({ lat: s.lat, lng: s.lng }); });
        map.fitBounds(bounds, 50);
      },
      addControlElement: function(map, el) {
        map.controls[google.maps.ControlPosition.TOP_LEFT].push(el);
      },
      geocode: function(query, cb) {
        if (typeof google === 'undefined' || !google.maps) { cb(null); return; }
        var geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: query }, function(results, status) {
          if (status === 'OK' && results.length) {
            var loc = results[0].geometry.location;
            cb({ lat: loc.lat(), lng: loc.lng() });
          } else { cb(null); }
        });
      },
      getExternalMapUrl: function(spot) {
        // Prefer lat/lng deep-link when available (more accurate than name search).
        if (spot.lat && spot.lng) {
          return 'https://www.google.com/maps/search/?api=1&query=' + spot.lat + ',' + spot.lng;
        }
        var q = encodeURIComponent(spot.name);
        return 'https://www.google.com/maps/search/?api=1&query=' + q;
      }
    }
  };

  function mp() {
    return MapProviders.google;
  }

  // === i18n ===
  function t(key) {
    var lang = state.lang;
    if (translations && translations[lang] && translations[lang][key]) {
      return translations[lang][key];
    }
    if (translations && translations.en && translations.en[key]) {
      return translations.en[key];
    }
    return key;
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-ph');
      el.placeholder = t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-title');
      el.title = t(key);
    });
  }

  // === Language ===
  window.taSetLanguage = function(lang) {
    state.lang = lang;
    localStorage.setItem('travelid_lang', lang);
    document.getElementById('ta-lang-select').value = lang;
    var authLangSel = document.getElementById('ta-auth-lang-select');
    if (authLangSel) authLangSel.value = lang;
    updateUrlLang(lang);
    updateSeoMeta(lang);
    applyTranslations();
    // Re-fetch spots in the new language from API
    fetchSpots(false);
    renderMySpots();
    if (state.map && state.mapLoaded) {
      var p = mp();
      var center = p.getCenter(state.map);
      var zoom = p.getZoom(state.map);
      loadAndCreateMap(center, zoom);
    }
  };

  // Update URL ?lang= parameter without page reload
  function updateUrlLang(lang) {
    var url = new URL(window.location.href);
    url.searchParams.set('lang', lang);
    window.history.replaceState(null, '', url.toString());
  }

  // Update SEO meta tags, hreflang, canonical, html lang
  function updateSeoMeta(lang) {
    var t = (typeof translations !== 'undefined') ? translations : {};
    var langData = t[lang] || t['en'] || {};
    // siteUrl is delivered by /api/map-config; fall back to current origin while config is in flight.
    var baseUrl = (state.mapConfig && state.mapConfig.siteUrl) || (window.location.origin || 'https://travel-id.vercel.app');

    // html lang attribute
    document.documentElement.lang = lang;

    // title
    var title = langData['seo.title'] || 'Travel-ID - Discover Korea';
    document.title = title;

    // meta description
    var descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.content = langData['seo.description'] || '';

    // og tags
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.content = title;
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.content = langData['seo.description'] || '';

    // og:locale
    var localeMap = { en: 'en_US', id: 'id_ID', ms: 'ms_MY', ko: 'ko_KR', zh: 'zh_CN', ja: 'ja_JP', ar: 'ar_SA' };

    // RTL toggle for Arabic. Body class lets CSS apply directional overrides.
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
    document.body.classList.toggle('rtl', isRtl(lang));
    var ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.content = localeMap[lang] || 'en_US';

    // og:url
    var currentUrl = baseUrl + '/?lang=' + lang;
    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = currentUrl;

    // canonical
    var canonical = document.getElementById('seo-canonical');
    if (canonical) canonical.href = currentUrl;

    // keywords
    var kwMeta = document.querySelector('meta[name="keywords"]');
    if (kwMeta && langData['seo.keywords']) kwMeta.content = langData['seo.keywords'];

    // twitter tags
    var twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.content = title;
    var twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.content = langData['seo.description'] || '';

    // hreflang: remove old, create new
    var oldLinks = document.querySelectorAll('link[rel="alternate"][hreflang]');
    for (var i = 0; i < oldLinks.length; i++) oldLinks[i].remove();

    var head = document.head;
    var params = new URLSearchParams(window.location.search);
    // Build base path preserving non-lang params
    params.delete('lang');
    var extraParams = params.toString();

    SUPPORTED_LANGS.forEach(function(l) {
      var link = document.createElement('link');
      link.rel = 'alternate';
      link.hreflang = l;
      link.href = baseUrl + '/?lang=' + l + (extraParams ? '&' + extraParams : '');
      head.appendChild(link);
    });
    // x-default points to English
    var xdef = document.createElement('link');
    xdef.rel = 'alternate';
    xdef.hreflang = 'x-default';
    xdef.href = baseUrl + '/' + (extraParams ? '?' + extraParams : '');
    head.appendChild(xdef);
  }

  function initLanguage() {
    var select = document.getElementById('ta-lang-select');
    select.value = state.lang;
    var authLangSel = document.getElementById('ta-auth-lang-select');
    if (authLangSel) authLangSel.value = state.lang;
    localStorage.setItem('travelid_lang', state.lang);
    updateUrlLang(state.lang);
    updateSeoMeta(state.lang);
  }

  // === Client config (cached promise; shared by initAuth + initMap) ===
  var _configPromise = null;
  function fetchClientConfig() {
    if (!_configPromise) {
      _configPromise = fetch('/api/map-config').then(function(r) { return r.json(); });
    }
    return _configPromise;
  }

  // === Auth (Travel-ID JWT exchange via /api/auth/google) ===
  function initAuth() {
    // Restore existing session
    var storedToken = localStorage.getItem('travelid_token');
    var storedUser = localStorage.getItem('travelid_user');
    if (storedToken && storedUser) {
      try {
        state.authToken = storedToken;
        state.authUser = JSON.parse(storedUser);
        updateAuthUI();
        fetchBookmarks();
      } catch (e) {
        localStorage.removeItem('travelid_token');
        localStorage.removeItem('travelid_user');
      }
    }

    // Init Google Identity Services when ready (rendered as the login button)
    fetchClientConfig().then(function() {
      initGoogleSignIn();
    });

    // Avatar click toggle menu
    var profile = document.getElementById('ta-auth-profile');
    if (profile) {
      profile.addEventListener('click', function(e) {
        // Don't toggle menu when interacting with the language select
        if (e.target.closest('.ta-auth-menu-lang')) return;
        e.stopPropagation();
        profile.classList.toggle('open');
      });
      document.addEventListener('click', function(e) {
        if (e.target.closest('.ta-auth-menu-lang')) return;
        profile.classList.remove('open');
      });
    }
  }

  function initGoogleSignIn() {
    if (typeof google === 'undefined' || !google.accounts || !window._taGoogleClientId) {
      // GIS or Client ID not ready yet, retry
      setTimeout(initGoogleSignIn, 500);
      return;
    }
    google.accounts.id.initialize({
      client_id: window._taGoogleClientId,
      callback: handleGoogleCredential,
      auto_select: false
    });
  }

  window.taGoogleSignIn = function() {
    if (typeof google !== 'undefined' && google.accounts && window._taGoogleClientId) {
      google.accounts.id.prompt(function(notification) {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // Fallback: use popup
          google.accounts.id.renderButton(
            document.createElement('div'), { type: 'standard' }
          );
          // Try One Tap again or show popup
          google.accounts.oauth2.initCodeClient({
            client_id: window._taGoogleClientId,
            scope: 'openid email profile',
            callback: function() {}
          });
          // Use the simpler approach: render and auto-click
          var tmpDiv = document.createElement('div');
          tmpDiv.style.position = 'fixed';
          tmpDiv.style.top = '50%';
          tmpDiv.style.left = '50%';
          tmpDiv.style.transform = 'translate(-50%, -50%)';
          tmpDiv.style.zIndex = '9999';
          tmpDiv.style.background = 'white';
          tmpDiv.style.padding = '40px';
          tmpDiv.style.borderRadius = '12px';
          tmpDiv.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)';
          tmpDiv.id = 'ta-google-popup';

          var closeBtn = document.createElement('button');
          closeBtn.textContent = '✕';
          closeBtn.style.cssText = 'position:absolute;top:10px;right:14px;border:none;background:none;font-size:1.2rem;cursor:pointer;color:#666;';
          closeBtn.onclick = function() { tmpDiv.remove(); };
          tmpDiv.appendChild(closeBtn);

          var btnContainer = document.createElement('div');
          tmpDiv.appendChild(btnContainer);
          document.body.appendChild(tmpDiv);

          google.accounts.id.renderButton(btnContainer, {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width: 280
          });
        }
      });
    } else {
      showToast(t('auth.signIn') + ' - Google not available');
    }
  };

  function applySession(token, user) {
    state.authToken = token;
    state.authUser = {
      id: user.id,
      name: user.name || (user.email || '').split('@')[0],
      email: user.email || '',
      avatar: user.picture || '',
    };
    localStorage.setItem('travelid_token', token);
    localStorage.setItem('travelid_user', JSON.stringify(state.authUser));
    if (user.bookmarks) {
      var bm = [];
      (user.bookmarks.want_to_visit || []).forEach(function(id) { bm.push({ spotId: id, type: 'want_to_visit' }); });
      (user.bookmarks.interested    || []).forEach(function(id) { bm.push({ spotId: id, type: 'interested' }); });
      state.bookmarks = bm;
    }
    updateAuthUI();
  }

  function handleGoogleCredential(response) {
    var popup = document.getElementById('ta-google-popup');
    if (popup) popup.remove();

    if (!response || !response.credential) {
      console.error('No credential in Google response:', response);
      showToast('Sign in failed. Please try again.');
      return;
    }

    fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    })
      .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
      .then(function(res) {
        if (!res.ok) {
          console.error('auth/google error:', res.body);
          showToast('Sign in failed: ' + (res.body.error || 'unknown'));
          return;
        }
        applySession(res.body.token, res.body.user);
        renderMySpots();
        renderSpotList();
        showToast(t('auth.welcome') + ', ' + state.authUser.name + '!');
      })
      .catch(function(err) {
        console.error('Auth error:', err);
        showToast('Sign in failed. Please try again.');
      });
  }

  window.taSignOut = function() {
    localStorage.removeItem('travelid_token');
    localStorage.removeItem('travelid_user');
    clearAuthData();
  };

  function clearAuthData() {
    state.authToken = null;
    state.authUser = null;
    state.bookmarks = [];
    updateAuthUI();
    renderMySpots();
    if (state.selectedSpot) renderDetail(state.selectedSpot);
    renderSpotList();
  }

  function updateAuthUI() {
    var loginBtn = document.getElementById('ta-auth-login');
    var profileEl = document.getElementById('ta-auth-profile');
    var avatarEl = document.getElementById('ta-auth-avatar');
    var nameEl = document.getElementById('ta-auth-name');
    var headerLangSel = document.getElementById('ta-lang-select');

    if (state.authUser) {
      loginBtn.style.display = 'none';
      profileEl.style.display = '';
      avatarEl.src = state.authUser.avatar || '';
      avatarEl.alt = state.authUser.name;
      nameEl.textContent = state.authUser.name;
      // Hide header lang select, show in account menu
      headerLangSel.style.display = 'none';
      var authLangSel = document.getElementById('ta-auth-lang-select');
      if (authLangSel) authLangSel.value = state.lang;
    } else {
      loginBtn.style.display = '';
      profileEl.style.display = 'none';
      // Show header lang select
      headerLangSel.style.display = '';
    }
  }

  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (state.authToken) h['Authorization'] = 'Bearer ' + state.authToken;
    return h;
  }

  // === Bookmarks ===
  function fetchBookmarks() {
    if (!state.authToken) return;
    fetch('/api/user/bookmarks', { headers: authHeaders() })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        state.bookmarks = data.bookmarks || [];
        renderMySpots();
        renderSpotList();
        if (state.spots && state.spots.length) renderMapMarkers(filterBySearch(state.spots), { skipFitBounds: true });
        if (state.selectedSpot) renderDetail(state.selectedSpot);
      })
      .catch(function() {});
  }

  function toggleBookmark(spotId, type) {
    if (!state.authUser) {
      showToast(t('bookmark.loginRequired'));
      return;
    }

    var existing = state.bookmarks.find(function(b) { return b.spotId === spotId && b.type === type; });
    var action = existing ? 'remove' : 'add';

    // Optimistic update — allow same spot to have both want_to_visit and interested
    if (action === 'add') {
      if (!state.bookmarks.some(function(b) { return b.spotId === spotId && b.type === type; })) {
        state.bookmarks.push({ spotId: spotId, type: type });
      }
    } else {
      state.bookmarks = state.bookmarks.filter(function(b) { return !(b.spotId === spotId && b.type === type); });
    }

    renderMySpots();
    renderSpotList();
    if (state.spots && state.spots.length) renderMapMarkers(filterBySearch(state.spots), { skipFitBounds: true });
    if (state.selectedSpot) renderDetail(state.selectedSpot);
    showToast(action === 'add' ? t('bookmark.saved') : t('bookmark.removed'));

    // Server sync
    fetch('/api/user/bookmarks', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ spotId: spotId, type: type, action: action })
    }).catch(function() {});
  }

  // Returns highest-priority bookmark type for a spot.
  // want_to_visit takes precedence over interested when both exist.
  function getBookmarkType(spotId) {
    var hasVisit = false, hasInterested = false;
    for (var i = 0; i < state.bookmarks.length; i++) {
      var b = state.bookmarks[i];
      if (b.spotId !== spotId) continue;
      if (b.type === 'want_to_visit') hasVisit = true;
      else if (b.type === 'interested') hasInterested = true;
    }
    if (hasVisit) return 'want_to_visit';
    if (hasInterested) return 'interested';
    return null;
  }

  function hasBookmarkType(spotId, type) {
    return state.bookmarks.some(function(b) { return b.spotId === spotId && b.type === type; });
  }

  // === Tabs ===
  window.taSwitchTab = function(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.ta-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.ta-tab-content').forEach(function(c) {
      c.classList.remove('active');
      c.style.display = '';
    });
    var contentId = tab === 'explore' ? 'ta-tab-explore' : 'ta-tab-myspots';
    document.getElementById(contentId).classList.add('active');

    if (tab === 'myspots') {
      renderMySpots();
    }
  };

  window.taShowMySpots = function() {
    document.getElementById('ta-auth-profile').classList.remove('open');
    if (state.selectedSpot) taBackToList();
    taSwitchTab('myspots');
  };

  // === Render My Spots ===
  function renderMySpots() {
    var visitEl = document.getElementById('ta-myspots-visit');
    var interestedEl = document.getElementById('ta-myspots-interested');
    var plannerCta = document.getElementById('ta-planner-cta');
    if (!visitEl) return;

    if (!state.authUser) {
      visitEl.innerHTML = '<div class="ta-myspots-empty">' + t('bookmark.loginRequired') + '</div>';
      interestedEl.innerHTML = '';
      if (plannerCta) plannerCta.style.display = 'none';
      return;
    }

    var visitSpots = [];
    var interestedSpots = [];

    state.bookmarks.forEach(function(bm) {
      var spot = state.spots.find(function(s) { return s.id === bm.spotId; }) || state.spotCache[bm.spotId];
      if (!spot) return;
      if (bm.type === 'want_to_visit') visitSpots.push(spot);
      else if (bm.type === 'interested') interestedSpots.push(spot);
    });

    visitEl.innerHTML = visitSpots.length === 0
      ? '<div class="ta-myspots-empty">' + t('bookmark.wantToVisitEmpty') + '</div>'
      : visitSpots.map(function(s) { return renderMySpotItem(s, 'want_to_visit'); }).join('');

    interestedEl.innerHTML = interestedSpots.length === 0
      ? '<div class="ta-myspots-empty">' + t('bookmark.interestedEmpty') + '</div>'
      : interestedSpots.map(function(s) { return renderMySpotItem(s, 'interested'); }).join('');

    // Show planner CTA + targetNote if there are want_to_visit spots
    if (plannerCta) {
      plannerCta.style.display = visitSpots.length > 0 ? 'flex' : 'none';
    }
    var targetNote = document.getElementById('ta-myspots-target-note');
    if (targetNote) {
      targetNote.style.display = visitSpots.length > 0 ? 'block' : 'none';
    }

    // Bind events
    visitEl.querySelectorAll('.ta-myspot-item').forEach(bindMySpotEvents);
    interestedEl.querySelectorAll('.ta-myspot-item').forEach(bindMySpotEvents);
  }

  function renderMySpotItem(spot, type) {
    var icon = CAT_ICONS[spot.category] || '📍';
    return '<div class="ta-myspot-item" data-id="' + spot.id + '" data-type="' + type + '">' +
      '<span class="ta-myspot-icon">' + icon + '</span>' +
      '<span class="ta-myspot-name">' + escapeHtml(spot.name) + '</span>' +
      '<button class="ta-myspot-remove" data-id="' + spot.id + '" data-type="' + type + '" title="' + t('bookmark.remove') + '">✕</button>' +
    '</div>';
  }

  function bindMySpotEvents(item) {
    item.addEventListener('click', function(e) {
      if (e.target.closest('.ta-myspot-remove')) {
        var id = e.target.closest('.ta-myspot-remove').dataset.id;
        var type = e.target.closest('.ta-myspot-remove').dataset.type;
        toggleBookmark(id, type);
        return;
      }
      var spotId = item.dataset.id;
      var spot = state.spots.find(function(s) { return s.id === spotId; });
      if (spot) showDetail(spot);
    });
  }

  // === API ===
  function fetchSpots(append) {
    if (state.loading) return;
    state.loading = true;

    var loadingEl = document.getElementById('ta-loading');
    if (!append) {
      loadingEl.textContent = t('app.loading');
      loadingEl.style.display = '';
    }

    var params = new URLSearchParams();
    params.set('lang', state.lang);
    params.set('limit', '100');
    // Build category list from prefs + selected category
    var prefCats = [];
    if (state.travelPrefs.muslim) { prefCats.push('halal', 'mosque'); }
    if (state.travelPrefs.vegan) { prefCats.push('vegetarian'); }

    // Exclude halal/mosque/vegetarian unless their toggle is on
    var excludeCats = [];
    if (!state.travelPrefs.muslim) { excludeCats.push('halal', 'mosque'); }
    if (!state.travelPrefs.vegan) { excludeCats.push('vegetarian'); }

    if (state.category !== 'all' && prefCats.length > 0) {
      params.set('category', [state.category].concat(prefCats).join(','));
      excludeCats = []; // showing specific categories, no need to exclude
    } else if (state.category !== 'all') {
      params.set('category', state.category);
      excludeCats = []; // showing a specific category, no need to exclude
    } else if (prefCats.length > 0) {
      // "All" + dietary prefs: show everything including pref spots
      excludeCats = excludeCats.filter(function(c) { return prefCats.indexOf(c) === -1; });
    }
    if (excludeCats.length > 0) params.set('exclude', excludeCats.join(','));
    if (state.region) params.set('region', state.region);
    if (append && state.nextCursor) params.set('cursor', state.nextCursor);

    fetch('/api/travel-spots?' + params.toString())
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (append) {
          state.spots = state.spots.concat(data.items || []);
        } else {
          state.spots = data.items || [];
        }
        // Cache all spots for bookmark lookup across filters
        state.spots.forEach(function(s) { state.spotCache[s.id] = s; });
        state.hasMore = data.hasMore || false;
        state.nextCursor = data.nextCursor || null;
        state.loading = false;

        var filtered = filterBySearch(state.spots);
        renderSpotList(filtered);
        renderMapMarkers(filtered);
        renderMySpots();

        // Deep-link: open spot from ?spot= parameter
        if (!append && state._pendingSpotId) {
          var deepSpot = state.spots.find(function(s) { return s.id === state._pendingSpotId; });
          if (deepSpot) showDetail(deepSpot);
          state._pendingSpotId = null;
        }
      })
      .catch(function() {
        state.loading = false;
        loadingEl.textContent = t('app.noResults');
        loadingEl.style.display = '';
      });
  }

  function filterBySearch(spots) {
    if (!state.search) return spots;
    var q = state.search.toLowerCase();
    return spots.filter(function(s) {
      return (s.name && s.name.toLowerCase().includes(q)) ||
             (s.description && s.description.toLowerCase().includes(q)) ||
             (s.address && s.address.toLowerCase().includes(q)) ||
             (s.tags && s.tags.join(' ').toLowerCase().includes(q));
    });
  }

  // === Render Spot List ===
  function renderSpotList(spots) {
    spots = spots || filterBySearch(state.spots);
    var listEl = document.getElementById('ta-list');
    var loadingEl = document.getElementById('ta-loading');

    if (spots.length === 0) {
      loadingEl.textContent = t('app.noResults');
      loadingEl.style.display = '';
      listEl.querySelectorAll('.ta-spot-card, .ta-load-more').forEach(function(el) { el.remove(); });
      return;
    }

    loadingEl.style.display = 'none';

    var html = spots.map(function(spot) {
      var catClass = 'cat-' + (spot.category || 'attraction');
      var thumb = spot.coverImage
        ? '<div class="ta-spot-thumb"><img src="' + escapeAttr(spot.coverImage) + '" alt="' + escapeAttr(spot.name) + '" loading="lazy"></div>'
        : '<div class="ta-spot-thumb"><span class="ta-spot-thumb-empty">' + (CAT_ICONS[spot.category] || '📍') + '</span></div>';

      var meta = '';
      if (spot.featured) meta += '<span class="ta-spot-featured">' + t('app.featured') + '</span>';
      if (spot.rating) meta += '<span class="ta-spot-rating">★ ' + spot.rating.toFixed(1) + '</span>';
      if (spot.region) meta += '<span>' + spot.region + '</span>';

      // Bookmark badge
      var bmType = getBookmarkType(spot.id);
      var badge = '';
      if (bmType === 'want_to_visit') badge = '<span class="ta-spot-bookmark-badge visit" title="' + t('bookmark.wantToVisit') + '"></span>';
      else if (bmType === 'interested') badge = '<span class="ta-spot-bookmark-badge interested" title="' + t('bookmark.interested') + '"></span>';

      return '<div class="ta-spot-card" data-id="' + spot.id + '">' +
        thumb +
        '<div class="ta-spot-info">' +
          '<span class="ta-spot-cat ' + catClass + '">' + getCatLabel(spot.category) + '</span>' +
          '<div class="ta-spot-name">' + escapeHtml(spot.name) + badge + '</div>' +
          '<div class="ta-spot-meta">' + meta + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    if (state.hasMore) {
      html += '<button class="ta-load-more" id="ta-load-more">' + t('app.loadMore') + '</button>';
    }

    listEl.querySelectorAll('.ta-spot-card, .ta-load-more').forEach(function(el) { el.remove(); });
    listEl.insertAdjacentHTML('beforeend', html);

    listEl.querySelectorAll('.ta-spot-card').forEach(function(card) {
      card.addEventListener('click', function() {
        var id = card.getAttribute('data-id');
        var spot = state.spots.find(function(s) { return s.id === id; });
        if (spot) showDetail(spot);
      });
    });

    var loadMoreBtn = document.getElementById('ta-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function() { fetchSpots(true); });
    }
  }

  function getCatLabel(cat) {
    var key = 'app.cat' + cat.charAt(0).toUpperCase() + cat.slice(1);
    return t(key);
  }

  // === Detail Panel ===
  function showDetail(spot) {
    state.selectedSpot = spot;

    // Hide tabs content, show detail
    document.getElementById('ta-tab-explore').style.display = 'none';
    document.getElementById('ta-tab-myspots').style.display = 'none';
    document.getElementById('ta-tabs').style.display = 'none';
    document.querySelector('.ta-search-wrap').style.display = 'none';
    var detail = document.getElementById('ta-detail');
    detail.classList.add('active');

    // Show/hide My Spots + Plan-with-this-spot buttons based on auth state
    var mySpotsBtn = document.getElementById('ta-detail-myspots-btn');
    if (mySpotsBtn) mySpotsBtn.style.display = state.authUser ? '' : 'none';
    var planBtn = document.getElementById('ta-detail-plan-btn');
    if (planBtn) planBtn.style.display = state.authUser ? '' : 'none';

    renderDetail(spot);
    highlightMarker(spot);

    document.querySelectorAll('.ta-spot-card').forEach(function(c) { c.classList.remove('active'); });
    var card = document.querySelector('.ta-spot-card[data-id="' + spot.id + '"]');
    if (card) card.classList.add('active');

    // Auto-expand bottom sheet on mobile
    if (bottomSheet && isMobileView() && bottomSheet.currentSnap !== 'full') {
      setSnap('full');
    }
  }

  function renderDetail(spot) {
    // Images
    var imagesEl = document.getElementById('ta-detail-images');
    var allImages = [];
    if (spot.coverImage) allImages.push(spot.coverImage);
    if (spot.photos) allImages = allImages.concat(spot.photos);
    allImages = allImages.filter(function(v, i, a) { return a.indexOf(v) === i; });

    if (allImages.length > 0) {
      imagesEl.innerHTML = allImages.map(function(url) {
        return '<img src="' + escapeAttr(url) + '" alt="' + escapeAttr(spot.name) + '">';
      }).join('');
      imagesEl.style.display = '';
    } else {
      imagesEl.innerHTML = '<div class="ta-detail-photos-loading"></div>';
      imagesEl.style.display = '';
    }

    // Fetch Google Places photos if few/no images
    if (allImages.length < 3 && spot.lat && spot.lng) {
      fetchPlacePhotos(spot, imagesEl, allImages);
    }

    // Category badge
    var catEl = document.getElementById('ta-detail-cat');
    catEl.textContent = getCatLabel(spot.category);
    catEl.className = 'ta-spot-cat cat-' + (spot.category || 'attraction');

    // Name
    document.getElementById('ta-detail-name').textContent = spot.name;

    // Bookmark buttons — independent active state for each type
    var bmEl = document.getElementById('ta-detail-bookmarks');
    var bmHasVisit = hasBookmarkType(spot.id, 'want_to_visit');
    var bmHasInterested = hasBookmarkType(spot.id, 'interested');
    bmEl.innerHTML =
      '<button class="ta-bookmark-btn' + (bmHasVisit ? ' active-visit' : '') + '" onclick="taToggleBookmark(\'' + spot.id + '\', \'want_to_visit\')">' +
        '<svg viewBox="0 0 24 24" fill="' + (bmHasVisit ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/></svg>' +
        t('bookmark.wantToVisit') +
      '</button>' +
      '<button class="ta-bookmark-btn' + (bmHasInterested ? ' active-interested' : '') + '" onclick="taToggleBookmark(\'' + spot.id + '\', \'interested\')">' +
        '<svg viewBox="0 0 24 24" fill="' + (bmHasInterested ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>' +
        t('bookmark.interested') +
      '</button>';

    // Meta
    var metaHtml = '';
    if (spot.rating) metaHtml += '<span class="ta-detail-stars">★ ' + spot.rating.toFixed(1) + '</span>';
    if (spot.featured) metaHtml += '<span style="color:var(--t-primary);font-weight:600;">' + t('app.featured') + '</span>';
    if (spot.region) metaHtml += '<span>' + escapeHtml(spot.region) + '</span>';
    if (spot.submittedBy) metaHtml += '<span>by ' + escapeHtml(spot.submittedBy) + '</span>';
    document.getElementById('ta-detail-meta').innerHTML = metaHtml;

    // Tags
    var tagsHtml = '';
    if (spot.instagram) {
      var igTags = spot.instagram.split(/[\s,]+/).filter(Boolean);
      igTags.forEach(function(tag) {
        var clean = tag.replace(/^[@#]/, '');
        if (tag.startsWith('@')) {
          tagsHtml += '<a href="https://instagram.com/' + encodeURIComponent(clean) + '" target="_blank" rel="noopener" class="ta-detail-tag ta-detail-tag-ig">@' + escapeHtml(clean) + '</a>';
        } else {
          tagsHtml += '<a href="https://instagram.com/explore/tags/' + encodeURIComponent(clean) + '" target="_blank" rel="noopener" class="ta-detail-tag ta-detail-tag-ig">#' + escapeHtml(clean) + '</a>';
        }
      });
    }
    if (spot.tags && spot.tags.length > 0) {
      spot.tags.forEach(function(tag) {
        tagsHtml += '<span class="ta-detail-tag ta-detail-tag-tag">' + escapeHtml(tag) + '</span>';
      });
    }
    document.getElementById('ta-detail-tags').innerHTML = tagsHtml;

    // Description
    document.getElementById('ta-detail-desc').textContent = spot.description || '';

    // Address
    var addrEl = document.getElementById('ta-detail-address');
    if (spot.address) {
      addrEl.innerHTML = escapeHtml(spot.address);
      addrEl.style.display = '';
    } else {
      addrEl.style.display = 'none';
    }

    // Info section (website, opening hours, busy times)
    renderPlaceInfo(spot);

    // Actions
    var actionsEl = document.getElementById('ta-detail-actions');
    var actionsHtml = '';
    if (spot.lat && spot.lng) {
      var p = mp();
      var mapUrl = p.getExternalMapUrl(spot);
      actionsHtml += '<a href="' + escapeAttr(mapUrl) + '" target="_blank" rel="noopener" class="ta-detail-google">' + t('app.openGoogle') + '</a>';
    } else if (spot.googleMapLink) {
      actionsHtml += '<a href="' + escapeAttr(spot.googleMapLink) + '" target="_blank" rel="noopener" class="ta-detail-google">' + t('app.openGoogle') + '</a>';
    }
    // Share buttons
    var siteOrigin = (state.mapConfig && state.mapConfig.siteUrl) || window.location.origin;
    var shareUrl = siteOrigin + '/spot/' + spot.id + '?lang=' + state.lang;
    var shareText = spot.name + ' — Travel-ID';
    actionsHtml += '<div class="ta-spot-share">' +
      '<button class="ta-share-spot-btn ta-share-spot-copy" onclick="taShareSpot(\'copy\')" title="Copy Link">🔗</button>' +
      '<button class="ta-share-spot-btn ta-share-spot-whatsapp" onclick="taShareSpot(\'whatsapp\')" title="WhatsApp">WhatsApp</button>' +
      '<button class="ta-share-spot-btn ta-share-spot-facebook" onclick="taShareSpot(\'facebook\')" title="Facebook">Facebook</button>' +
      '<button class="ta-share-spot-btn ta-share-spot-zalo" onclick="taShareSpot(\'zalo\')" title="Zalo">Zalo</button>' +
    '</div>';
    actionsEl.innerHTML = actionsHtml;
    actionsEl.dataset.shareUrl = shareUrl;
    actionsEl.dataset.shareText = shareText;

    // Submitted by
    var byEl = document.getElementById('ta-detail-by');
    if (spot.submittedBy) {
      byEl.textContent = 'Submitted by ' + spot.submittedBy;
      byEl.style.display = '';
    } else {
      byEl.style.display = 'none';
    }
  }

  window.taShareSpot = function(platform) {
    var el = document.getElementById('ta-detail-actions');
    var url = encodeURIComponent(el.dataset.shareUrl || '');
    var text = encodeURIComponent(el.dataset.shareText || '');
    var link = '';
    switch (platform) {
      case 'whatsapp': link = 'https://wa.me/?text=' + text + '%20' + url; break;
      case 'facebook': link = 'https://www.facebook.com/sharer/sharer.php?u=' + url; break;
      case 'zalo': link = 'https://zalo.me/share?url=' + url; break;
      case 'copy':
        navigator.clipboard.writeText(decodeURIComponent(url)).then(function() {
          showToast('Link copied!');
        });
        return;
    }
    if (link) window.open(link, '_blank', 'width=600,height=400');
  };

  window.taToggleBookmark = function(spotId, type) {
    toggleBookmark(spotId, type);
  };

  window.taBackToList = function() {
    state.selectedSpot = null;
    document.getElementById('ta-detail').classList.remove('active');
    document.getElementById('ta-tabs').style.display = '';
    document.querySelector('.ta-search-wrap').style.display = '';

    // Restore active tab content
    var activeTab = state.activeTab;
    if (activeTab === 'explore') {
      document.getElementById('ta-tab-explore').style.display = '';
    } else {
      document.getElementById('ta-tab-myspots').style.display = '';
    }

    document.querySelectorAll('.ta-spot-card').forEach(function(c) { c.classList.remove('active'); });

    // Restore bottom sheet snap on mobile
    if (bottomSheet && isMobileView()) {
      setSnap(bottomSheet.prevSnap === 'full' ? 'half' : (bottomSheet.prevSnap || 'half'));
    }
  };

  // === Map ===
  function getMapLang() {
    // Google Maps supports all our 5 lang codes (en, id, ko, zh, ja).
    return state.lang;
  }

  function initMap() {
    fetchClientConfig()
      .then(function(data) {
        state.mapConfig = data;
        // Re-apply SEO meta now that we know the canonical site URL.
        if (data.siteUrl) updateSeoMeta(state.lang);

        // Store Google Client ID for auth
        if (data.googleClientId) {
          window._taGoogleClientId = data.googleClientId;
        }

        if (!data.googleKey) {
          showMapFallback(t('app.mapError'));
          return;
        }

        loadAndCreateMap();
      })
      .catch(function() {
        showMapFallback(t('app.mapError'));
      });
  }

  function loadAndCreateMap(restoreCenter, restoreZoom) {
    var p = mp();
    state.mapLoaded = false;
    state.markers = [];
    state.infoWindows = [];

    p.loadSDK(state.mapConfig, getMapLang(), function(err) {
      if (err) {
        showMapFallback(t('app.mapError'));
        return;
      }
      createMap(restoreCenter, restoreZoom);
    });
  }

  function showMapFallback(msg) {
    var mapEl = document.getElementById('ta-map');
    mapEl.innerHTML = '<div class="ta-map-fallback"><p>' + escapeHtml(msg) + '</p></div>';
  }

  function createMap(restoreCenter, restoreZoom) {
    var p = mp();
    window._taMap = state.map = p.createMap('ta-map');
    state.mapLoaded = true;

    if (restoreCenter) {
      p.setCenter(state.map, restoreCenter.lat, restoreCenter.lng);
    }
    if (restoreZoom) {
      p.setZoom(state.map, restoreZoom);
    }

    addMapTypeToggle();

    if (state.spots.length > 0) {
      renderMapMarkers(filterBySearch(state.spots));
    }
  }

  // === Map Type Toggle (Map / Satellite) ===
  function addMapTypeToggle() {
    var existing = document.querySelector('.ta-map-type');
    if (existing) existing.remove();

    var currentType = state.map.getMapTypeId && state.map.getMapTypeId() === 'satellite' ? 'satellite' : 'normal';

    var html = '<div class="ta-map-type">' +
      '<button class="ta-map-type-btn' + (currentType === 'normal' ? ' active' : '') + '" data-type="normal">Map</button>' +
      '<button class="ta-map-type-btn' + (currentType === 'satellite' ? ' active' : '') + '" data-type="satellite">Satellite</button>' +
    '</div>';

    var el = document.createElement('div');
    el.innerHTML = html;
    var control = el.firstChild;

    control.addEventListener('click', function(e) {
      var btn = e.target.closest('.ta-map-type-btn');
      if (!btn) return;
      var type = btn.dataset.type;

      control.querySelectorAll('.ta-map-type-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.map.setMapTypeId(type === 'satellite' ? 'satellite' : 'roadmap');
    });

    document.querySelector('.ta-map-wrap').appendChild(control);
  }

  function renderMapMarkers(spots, options) {
    if (!state.map || !state.mapLoaded) return;
    options = options || {};
    var p = mp();

    state.markers.forEach(function(m) { p.removeMarker(m); });
    state.markers = [];
    state.infoWindows.forEach(function(iw) { p.closeInfoWindow(iw); });
    state.infoWindows = [];

    var hasValidCoords = false;

    spots.forEach(function(spot) {
      if (!spot.lat || !spot.lng) return;
      hasValidCoords = true;

      var color = CAT_COLORS[spot.category] || '#666';
      var icon = CAT_ICONS[spot.category] || '📍';
      var bookmarkType = getBookmarkType(spot.id);
      var marker = p.addMarker(state.map, spot.lat, spot.lng, color, icon, bookmarkType);

      var thumbHtml = spot.coverImage
        ? '<img src="' + escapeAttr(spot.coverImage) + '" style="width:100%;height:100px;object-fit:cover;border-radius:8px 8px 0 0;">'
        : '';

      var infoWindow = p.createInfoWindow(
        '<div style="width:220px;background:white;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.15);cursor:pointer;" class="ta-info-window" data-id="' + spot.id + '">' +
          thumbHtml +
          '<div style="padding:10px 12px;">' +
            '<div style="font-weight:600;font-size:0.9rem;color:#1F2937;">' + escapeHtml(spot.name) + '</div>' +
            '<div style="font-size:0.78rem;color:#9CA3AF;margin-top:4px;">' + escapeHtml(spot.region || '') + '</div>' +
          '</div>' +
        '</div>'
      );

      p.onMarkerClick(marker, function() {
        state.infoWindows.forEach(function(iw) { p.closeInfoWindow(iw); });
        p.openInfoWindow(infoWindow, state.map, marker);
        showDetail(spot);
      });

      marker._spotId = spot.id;
      state.markers.push(marker);
      state.infoWindows.push(infoWindow);
    });

    if (hasValidCoords && spots.length > 1 && !options.skipFitBounds) {
      p.fitBounds(state.map, spots);
    }
  }

  function highlightMarker(spot) {
    if (!state.map || !spot.lat || !spot.lng) return;
    var p = mp();

    state.infoWindows.forEach(function(iw) { p.closeInfoWindow(iw); });

    p.panTo(state.map, spot.lat, spot.lng);
    if (p.getZoom(state.map) < 13) {
      p.setZoom(state.map, 14);
    }

    for (var i = 0; i < state.markers.length; i++) {
      if (state.markers[i]._spotId === spot.id) {
        p.openInfoWindow(state.infoWindows[i], state.map, state.markers[i]);
        break;
      }
    }
  }

  // === Submit ===
  window.taShowSubmit = function() {
    document.getElementById('ta-submit-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.taCloseSubmit = function() {
    document.getElementById('ta-submit-overlay').classList.remove('active');
    document.body.style.overflow = '';
  };

  window.taSubmitSpot = function(event) {
    event.preventDefault();

    var name = document.getElementById('ta-sub-name').value.trim();
    var category = document.getElementById('ta-sub-category').value;
    var desc = document.getElementById('ta-sub-desc').value.trim();
    var address = document.getElementById('ta-sub-address').value.trim();
    var instagram = document.getElementById('ta-sub-instagram').value.trim();
    var author = document.getElementById('ta-sub-author').value.trim();

    if (!name || !desc || !author) return;

    var body = {
      name: name,
      category: category,
      description: desc,
      address: address,
      instagram: instagram,
      submittedBy: author,
      lang: state.lang
    };

    if (address) {
      mp().geocode(address, function(result) {
        if (result) {
          body.lat = result.lat;
          body.lng = result.lng;
        }
        submitToApi(body);
      });
    } else {
      submitToApi(body);
    }
  };

  function submitToApi(body) {
    fetch('/api/travel-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        alert(t('app.submitted'));
        taCloseSubmit();
        document.getElementById('ta-submit-form').reset();
      } else {
        alert(t('app.submitError'));
      }
    })
    .catch(function() {
      alert(t('app.submitError'));
    });
  }

  // === Planner ===
  // Open the planner with the currently-viewed spot ensured in the want_to_visit
  // candidate list. If the user hasn't bookmarked it yet we add the bookmark
  // first; otherwise we just open the planner.
  window.taPlanWithCurrentSpot = function() {
    if (!state.authUser) { showToast(t('bookmark.loginRequired')); return; }
    var spot = state.selectedSpot;
    if (!spot) { taShowPlanner(); return; }
    var already = state.bookmarks.some(function(b) { return b.spotId === spot.id && b.type === 'want_to_visit'; });
    if (already) { taShowPlanner(); return; }
    // Add to want_to_visit then open planner once the bookmark settles
    fetch('/api/user/bookmarks', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ spotId: spot.id, type: 'want_to_visit', action: 'add' }),
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data && data.bookmarks) state.bookmarks = data.bookmarks;
      else state.bookmarks.push({ spotId: spot.id, type: 'want_to_visit' });
      taShowPlanner();
    }).catch(function() { taShowPlanner(); });
  };

  window.taShowPlanner = function() {
    document.getElementById('ta-auth-profile').classList.remove('open');

    if (!state.authUser) {
      showToast(t('bookmark.loginRequired'));
      return;
    }

    var visitSpots = state.bookmarks
      .filter(function(b) { return b.type === 'want_to_visit'; })
      .map(function(b) { return state.spots.find(function(s) { return s.id === b.spotId; }); })
      .filter(Boolean);

    if (visitSpots.length === 0) {
      showToast(t('planner.noSpots'));
      return;
    }

    // Populate spots checklist
    var spotsEl = document.getElementById('ta-planner-spots');
    spotsEl.innerHTML = visitSpots.map(function(spot) {
      var icon = CAT_ICONS[spot.category] || '📍';
      return '<div class="ta-planner-spot-item">' +
        '<input type="checkbox" id="plan-spot-' + spot.id + '" value="' + spot.id + '" checked>' +
        '<label for="plan-spot-' + spot.id + '">' + icon + ' ' + escapeHtml(spot.name) + '</label>' +
      '</div>';
    }).join('');

    // Show form, hide result
    document.getElementById('ta-planner-form-view').style.display = '';
    document.getElementById('ta-planner-result-view').style.display = 'none';
    document.getElementById('ta-planner-loading-view').style.display = 'none';

    document.getElementById('ta-planner-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.taClosePlanner = function() {
    document.getElementById('ta-planner-overlay').classList.remove('active');
    document.body.style.overflow = '';
  };

  window.taPlannerBackToForm = function() {
    document.getElementById('ta-planner-form-view').style.display = '';
    document.getElementById('ta-planner-result-view').style.display = 'none';
    document.getElementById('ta-planner-loading-view').style.display = 'none';
  };

  window.taGeneratePlan = function() {
    // Gather selected spots
    var checkboxes = document.querySelectorAll('#ta-planner-spots input[type="checkbox"]:checked');
    var selectedIds = [];
    checkboxes.forEach(function(cb) { selectedIds.push(cb.value); });

    if (selectedIds.length === 0) {
      showToast(t('planner.noSpots'));
      return;
    }

    var selectedSpots = selectedIds.map(function(id) {
      return state.spots.find(function(s) { return s.id === id; });
    }).filter(Boolean);

    var days = parseInt(document.getElementById('ta-planner-days').value);
    var budgetBtn = document.querySelector('#ta-planner-budget .ta-option-btn.active');
    var styleBtn = document.querySelector('#ta-planner-style .ta-option-btn.active');

    var budget = budgetBtn ? budgetBtn.dataset.val : 'moderate';
    var style = styleBtn ? styleBtn.dataset.val : 'balanced';

    // Capture plan metadata for save feature
    _lastPlanData = {
      days: days,
      budget: budget,
      style: style,
      spotNames: selectedSpots.map(function(s) { return s.name; }),
      lang: state.lang
    };

    // Show loading
    document.getElementById('ta-planner-form-view').style.display = 'none';
    document.getElementById('ta-planner-result-view').style.display = 'none';
    document.getElementById('ta-planner-loading-view').style.display = '';

    // Call API
    fetch('/api/travel-planner', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        spots: selectedSpots.map(function(s) {
          return {
            name: s.name,
            category: s.category,
            region: s.region,
            address: s.address,
            description: s.description ? s.description.substring(0, 200) : ''
          };
        }),
        days: days,
        budget: budget,
        style: style,
        lang: state.lang,
        visitType: state.travelPrefs.visitType
      })
    })
    .then(function(res) {
      if (!res.ok) {
        return res.text().then(function(text) {
          try { return JSON.parse(text); } catch(e) {
            return { error: 'Server error (' + res.status + ')' };
          }
        });
      }
      return res.json();
    })
    .then(function(data) {
      if (data.success && data.plan) {
        document.getElementById('ta-planner-result').innerHTML = renderMarkdown(data.plan);
        document.getElementById('ta-planner-loading-view').style.display = 'none';
        document.getElementById('ta-planner-result-view').style.display = '';
        if (typeof data.remaining === 'number') {
          showToast(t('planner.remaining').replace('{n}', data.remaining));
        }
      } else if (data.error === 'rate_limit') {
        showToast(t('planner.rateLimit').replace('{limit}', data.limit));
        taPlannerBackToForm();
      } else {
        var errMsg = data.detail || data.error || t('planner.error');
        console.error('Planner error:', errMsg);
        showToast(t('planner.error') + ' - ' + errMsg);
        taPlannerBackToForm();
      }
    })
    .catch(function(err) {
      console.error('Planner fetch error:', err);
      showToast(t('planner.error'));
      taPlannerBackToForm();
    });
  };

  // Markdown renderer for planner output (supports tables)
  function renderMarkdown(text) {
    // Escape HTML
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Parse tables first (before line-level transforms)
    text = text.replace(/((?:^\|.+\|[ \t]*\n)+)/gm, function(block) {
      var rows = block.trim().split('\n');
      if (rows.length < 2) return block;

      // Check if second row is separator (|---|---|)
      var isSep = /^\|[\s\-:]+(\|[\s\-:]+)+\|?$/.test(rows[1]);
      var html = '<div class="ta-table-wrap"><table class="ta-plan-table">';

      rows.forEach(function(row, i) {
        if (isSep && i === 1) return; // skip separator row
        var cells = row.split('|').filter(function(c, ci, arr) {
          return ci > 0 && ci < arr.length - 1;
        });
        var tag = (isSep && i === 0) ? 'th' : 'td';
        var rowTag = (isSep && i === 0) ? 'thead' : '';
        html += (i === 0 && isSep ? '<thead>' : (i === 2 && isSep ? '<tbody>' : ''));
        html += '<tr>';
        cells.forEach(function(cell) {
          html += '<' + tag + '>' + cell.trim() + '</' + tag + '>';
        });
        html += '</tr>';
        html += (i === 0 && isSep ? '</thead>' : '');
      });

      if (isSep && rows.length > 2) html += '</tbody>';
      html += '</table></div>';
      return html;
    });

    return text
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="ta-md-ol">$1. $2</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/((?:<li[^>]*>.*<\/li>\s*)+)/g, function(m) {
        var tag = m.indexOf('ta-md-ol') >= 0 ? 'ol' : 'ul';
        return '<' + tag + '>' + m + '</' + tag + '>';
      })
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  // === Google Places Photos & Info ===
  var _photoCache = {}; // cache by spot id
  var _placeInfoCache = {}; // cache opening hours & website by spot id

  function fetchPlacePhotos(spot, imagesEl, existingImages) {
    if (_photoCache[spot.id]) {
      renderPlacePhotos(imagesEl, existingImages, _photoCache[spot.id], spot.name);
      // Re-render info section if place info arrived
      if (_placeInfoCache[spot.id]) renderPlaceInfo(spot);
      return;
    }

    fetch('/api/place-photos?name=' + encodeURIComponent(spot.name) +
      '&lat=' + spot.lat + '&lng=' + spot.lng)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      // Cache place info (opening hours, website)
      if (data.openingHours || data.websiteUri) {
        _placeInfoCache[spot.id] = {
          openingHours: data.openingHours || null,
          websiteUri: data.websiteUri || null
        };
        renderPlaceInfo(spot);
      }

      if (data.photos && data.photos.length > 0) {
        _photoCache[spot.id] = data.photos;
        renderPlacePhotos(imagesEl, existingImages, data.photos, spot.name);
      } else if (existingImages.length === 0) {
        imagesEl.style.display = 'none';
        imagesEl.innerHTML = '';
      }
    })
    .catch(function() {
      if (existingImages.length === 0) {
        imagesEl.style.display = 'none';
        imagesEl.innerHTML = '';
      }
    });
  }

  function renderPlaceInfo(spot) {
    var infoEl = document.getElementById('ta-detail-info');
    if (!infoEl || state.selectedSpot !== spot) return;
    var cachedPlace = _placeInfoCache[spot.id];
    var websiteUrl = spot.website || null;
    var infoHtml = '';

    if (websiteUrl) {
      infoHtml += '<div class="ta-detail-info-row"><span class="ta-info-icon">🌐</span><a href="' + escapeAttr(websiteUrl) + '" target="_blank" rel="noopener" class="ta-info-link">' + t('app.website') + '</a></div>';
    } else if (cachedPlace && cachedPlace.websiteUri) {
      infoHtml += '<div class="ta-detail-info-row"><span class="ta-info-icon">🌐</span><a href="' + escapeAttr(cachedPlace.websiteUri) + '" target="_blank" rel="noopener" class="ta-info-link">' + t('app.website') + '</a></div>';
    }
    if (cachedPlace && cachedPlace.openingHours) {
      infoHtml += '<div class="ta-detail-info-row"><span class="ta-info-icon">🕐</span><details class="ta-hours-details"><summary>' + t('app.openingHours') + '</summary><ul class="ta-hours-list">' +
        cachedPlace.openingHours.map(function(h) { return '<li>' + escapeHtml(h) + '</li>'; }).join('') +
        '</ul></details></div>';
    }
    if (spot.lat && spot.lng) {
      var busyUrl = 'https://www.google.com/maps/search/?api=1&query=' + spot.lat + ',' + spot.lng;
      infoHtml += '<div class="ta-detail-info-row"><span class="ta-info-icon">📊</span><a href="' + escapeAttr(busyUrl) + '" target="_blank" rel="noopener" class="ta-info-link ta-info-busy">' + t('app.checkBusy') + '</a></div>';
    }
    infoEl.innerHTML = infoHtml;
    infoEl.style.display = infoHtml ? '' : 'none';
  }

  function renderPlacePhotos(imagesEl, existingImages, googlePhotos, spotName) {
    // Existing images first, then Google photos (deduplicated)
    var existingHtml = existingImages.map(function(url) {
      return '<img src="' + escapeAttr(url) + '" alt="' + escapeAttr(spotName) + '">';
    }).join('');

    var googleHtml = googlePhotos.map(function(p) {
      return '<img src="' + escapeAttr(p.url) + '" alt="' + escapeAttr(spotName) + '" loading="lazy">';
    }).join('');

    imagesEl.innerHTML = existingHtml + googleHtml +
      '<div class="ta-detail-photos-attr">Photos by Google</div>';
    imagesEl.style.display = '';
  }

  // === Plan Save & Compare ===
  var _lastPlanData = null; // stores data from last generated plan

  // _lastPlanData is set inside taGeneratePlan before API call

  window.taSaveCurrentPlan = function() {
    var resultEl = document.getElementById('ta-planner-result');
    if (!resultEl || !resultEl.innerHTML || !_lastPlanData) {
      showToast('No plan to save');
      return;
    }

    // Ask user for a plan name
    var defaultName = t('planner.planTitle').replace('{days}', _lastPlanData.days);
    if (_lastPlanData.spotNames && _lastPlanData.spotNames.length > 0) {
      // Add first spot region hint
      defaultName += ' — ' + _lastPlanData.spotNames.slice(0, 2).join(', ');
    }
    var planName = prompt(t('planner.namePrompt'), defaultName);
    if (planName === null) return; // cancelled
    planName = planName.trim() || defaultName;

    var plan = {
      id: 'plan_' + Date.now(),
      createdAt: new Date().toISOString(),
      title: planName,
      days: _lastPlanData.days,
      budget: _lastPlanData.budget,
      style: _lastPlanData.style,
      spotNames: _lastPlanData.spotNames,
      planHtml: resultEl.innerHTML,
      lang: _lastPlanData.lang
    };

    var plans = getSavedPlans();
    plans.unshift(plan);
    if (plans.length > 30) plans = plans.slice(0, 30);
    localStorage.setItem('travelid_saved_plans', JSON.stringify(plans));

    showToast(t('planner.saved'));
    syncPlansToNotion(plans);
  };

  function getSavedPlans() {
    try {
      return JSON.parse(localStorage.getItem('travelid_saved_plans') || '[]');
    } catch(e) { return []; }
  }

  function syncPlansToNotion(plans) {
    if (!state.authUser) return;
    var meta = plans.map(function(p) {
      return { id: p.id, title: p.title, days: p.days, createdAt: p.createdAt.substring(0, 10) };
    });
    var metaStr = JSON.stringify(meta);
    if (metaStr.length > 1900) {
      meta = meta.slice(0, 10);
      metaStr = JSON.stringify(meta);
    }
    fetch('/api/user/bookmarks', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'sync_plans', plans: metaStr })
    }).catch(function() {});
  }

  window.taShowMyPlans = function() {
    document.getElementById('ta-auth-profile').classList.remove('open');
    var plans = getSavedPlans();
    var listEl = document.getElementById('ta-myplans-list');

    if (plans.length === 0) {
      listEl.innerHTML = '<div class="ta-myplans-empty">' + t('planner.noSavedPlans') + '</div>';
      document.getElementById('ta-compare-btn').style.display = 'none';
    } else {
      listEl.innerHTML = plans.map(function(plan) {
        var date = plan.createdAt ? plan.createdAt.substring(0, 10) : '';
        var spots = plan.spotNames ? plan.spotNames.slice(0, 3).join(', ') : '';
        if (plan.spotNames && plan.spotNames.length > 3) spots += '...';
        return '<div class="ta-myplans-card" data-plan-id="' + plan.id + '">' +
          '<input type="checkbox" class="ta-myplans-card-check" data-plan-id="' + plan.id + '" onclick="event.stopPropagation(); taUpdateCompareBtn()">' +
          '<div class="ta-myplans-card-info" onclick="taViewPlan(\'' + plan.id + '\')">' +
            '<div class="ta-myplans-card-title">' + escapeHtml(plan.title) + '</div>' +
            '<div class="ta-myplans-card-meta">' + date + ' · ' + (plan.budget || '') + ' · ' + spots + '</div>' +
          '</div>' +
          '<div class="ta-myplans-card-actions">' +
            '<button class="ta-btn-delete" onclick="event.stopPropagation(); taDeletePlan(\'' + plan.id + '\')">' + t('planner.deletePlan') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
      document.getElementById('ta-compare-btn').style.display = 'none';
    }

    document.getElementById('ta-myplans-list-view').style.display = '';
    document.getElementById('ta-myplans-detail-view').style.display = 'none';
    document.getElementById('ta-myplans-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.taCloseMyPlans = function() {
    document.getElementById('ta-myplans-overlay').classList.remove('active');
    document.body.style.overflow = '';
  };

  window.taViewPlan = function(planId) {
    var plans = getSavedPlans();
    var plan = plans.find(function(p) { return p.id === planId; });
    if (!plan) return;
    _currentViewPlanId = planId;
    document.getElementById('ta-share-panel-myplan').style.display = 'none';

    document.getElementById('ta-myplans-detail-title').textContent = plan.title;
    document.getElementById('ta-myplans-detail-meta').textContent =
      (plan.createdAt ? plan.createdAt.substring(0, 10) : '') + ' · ' +
      (plan.budget || '') + ' · ' + (plan.style || '') + ' · ' +
      t('planner.spots_count').replace('{n}', (plan.spotNames || []).length);
    document.getElementById('ta-myplans-detail-content').innerHTML = plan.planHtml || '';

    document.getElementById('ta-myplans-list-view').style.display = 'none';
    document.getElementById('ta-myplans-detail-view').style.display = '';
  };

  window.taMyPlansBack = function() {
    document.getElementById('ta-myplans-list-view').style.display = '';
    document.getElementById('ta-myplans-detail-view').style.display = 'none';
  };

  window.taDeletePlan = function(planId) {
    var plans = getSavedPlans().filter(function(p) { return p.id !== planId; });
    localStorage.setItem('travelid_saved_plans', JSON.stringify(plans));
    taShowMyPlans();
  };

  window.taUpdateCompareBtn = function() {
    var checked = document.querySelectorAll('.ta-myplans-card-check:checked');
    var btn = document.getElementById('ta-compare-btn');
    btn.style.display = checked.length >= 2 ? '' : 'none';
    btn.textContent = t('planner.compare') + ' (' + checked.length + ')';
  };

  window.taComparePlans = function() {
    var checked = document.querySelectorAll('.ta-myplans-card-check:checked');
    var plans = getSavedPlans();
    var selectedPlans = [];
    checked.forEach(function(cb) {
      var p = plans.find(function(plan) { return plan.id === cb.dataset.planId; });
      if (p) selectedPlans.push(p);
    });
    if (selectedPlans.length < 2) return;
    if (selectedPlans.length > 3) selectedPlans = selectedPlans.slice(0, 3);

    var contentEl = document.getElementById('ta-compare-content');
    // Mobile tabs
    var tabsHtml = '<div class="ta-compare-tabs">' +
      selectedPlans.map(function(p, i) {
        return '<button class="ta-compare-tab' + (i === 0 ? ' active' : '') + '" onclick="taCompareTab(' + i + ')">' + escapeHtml(p.title) + '</button>';
      }).join('') + '</div>';

    var colsHtml = selectedPlans.map(function(plan, i) {
      var date = plan.createdAt ? plan.createdAt.substring(0, 10) : '';
      return '<div class="ta-compare-col' + (i === 0 ? ' active' : '') + '" data-col="' + i + '">' +
        '<div class="ta-compare-col-header">' +
          '<h3>' + escapeHtml(plan.title) + '</h3>' +
          '<div class="meta">' + date + ' · ' + (plan.budget || '') + ' · ' + (plan.style || '') + '</div>' +
        '</div>' +
        '<div class="ta-compare-col-body">' + (plan.planHtml || '') + '</div>' +
      '</div>';
    }).join('');

    contentEl.innerHTML = tabsHtml + colsHtml;

    taCloseMyPlans();
    document.getElementById('ta-compare-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.taCompareTab = function(idx) {
    document.querySelectorAll('.ta-compare-tab').forEach(function(t, i) {
      t.classList.toggle('active', i === idx);
    });
    document.querySelectorAll('.ta-compare-col').forEach(function(c, i) {
      c.classList.toggle('active', i === idx);
    });
  };

  window.taCloseCompare = function() {
    document.getElementById('ta-compare-overlay').classList.remove('active');
    document.body.style.overflow = '';
  };

  // === Plan Sharing ===
  var _currentViewPlanId = null; // track which saved plan is being viewed

  function sharePlanData(planObj, panelId) {
    var panel = document.getElementById(panelId);
    panel.innerHTML = '<div class="ta-share-loading">' + t('planner.sharing') + '</div>';
    panel.style.display = '';

    fetch('/api/share-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: planObj.title || t('planner.planTitle').replace('{days}', planObj.days),
        days: planObj.days,
        budget: planObj.budget,
        style: planObj.style,
        spotNames: planObj.spotNames,
        planHtml: planObj.planHtml,
        lang: planObj.lang || state.lang
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success && data.shareUrl) {
        renderShareButtons(panel, data.shareUrl, planObj.title || 'My Korea Travel Plan');
      } else {
        panel.innerHTML = '<p class="ta-share-error">' + (data.error || 'Failed to create share link') + '</p>';
      }
    })
    .catch(function(err) {
      panel.innerHTML = '<p class="ta-share-error">Failed to create share link</p>';
    });
  }

  function renderShareButtons(panel, shareUrl, planTitle) {
    var text = encodeURIComponent(planTitle + ' — Travel-ID');
    var url = encodeURIComponent(shareUrl);

    panel.innerHTML =
      '<div class="ta-share-header">' + t('planner.shareTitle') + '</div>' +
      '<div class="ta-share-url-row">' +
        '<input type="text" class="ta-share-url" value="' + escapeAttr(shareUrl) + '" readonly onclick="this.select()">' +
        '<button class="ta-share-copy" onclick="taCopyShareUrl(this)">' + t('planner.copyLink') + '</button>' +
      '</div>' +
      '<div class="ta-share-buttons">' +
        '<a href="https://wa.me/?text=' + text + '%20' + url + '" target="_blank" rel="noopener" class="ta-share-btn ta-share-whatsapp" title="WhatsApp">WhatsApp</a>' +
        '<a href="https://www.facebook.com/sharer/sharer.php?u=' + url + '" target="_blank" rel="noopener" class="ta-share-btn ta-share-facebook" title="Facebook">Facebook</a>' +
        '<a href="https://zalo.me/share?url=' + url + '" target="_blank" rel="noopener" class="ta-share-btn ta-share-zalo" title="Zalo">Zalo</a>' +
      '</div>';
  }

  window.taCopyShareUrl = function(btn) {
    var input = btn.parentElement.querySelector('.ta-share-url');
    navigator.clipboard.writeText(input.value).then(function() {
      btn.textContent = '✓';
      setTimeout(function() { btn.textContent = t('planner.copyLink'); }, 2000);
    }).catch(function() {
      input.select();
      document.execCommand('copy');
      btn.textContent = '✓';
      setTimeout(function() { btn.textContent = t('planner.copyLink'); }, 2000);
    });
  };


  window.taSharePlan = function() {
    var resultEl = document.getElementById('ta-planner-result');
    if (!resultEl || !resultEl.innerHTML || !_lastPlanData) return;

    sharePlanData({
      title: _lastPlanData.spotNames ? t('planner.planTitle').replace('{days}', _lastPlanData.days) + ' — ' + _lastPlanData.spotNames.slice(0, 2).join(', ') : '',
      days: _lastPlanData.days,
      budget: _lastPlanData.budget,
      style: _lastPlanData.style,
      spotNames: _lastPlanData.spotNames,
      planHtml: resultEl.innerHTML,
      lang: _lastPlanData.lang
    }, 'ta-share-panel');
  };

  window.taShareSavedPlan = function() {
    if (!_currentViewPlanId) return;
    var plans = getSavedPlans();
    var plan = plans.find(function(p) { return p.id === _currentViewPlanId; });
    if (!plan) return;
    sharePlanData(plan, 'ta-share-panel-myplan');
  };

  // === Travel Tips (Indonesia) ===
  // Useful Indonesia tourism resources for the Tips modal
  var INDO_LINKS = {
    visit:   'https://www.indonesia.travel/',
    visa:    'https://molina.imigrasi.go.id/',
    weather: 'https://www.bmkg.go.id/',
    pelni:   'https://www.pelni.co.id/',
    kai:     'https://booking.kai.id/'
  };

  // === About ===
  window.taShowAbout = function() {
    document.getElementById('ta-auth-profile').classList.remove('open');
    var content = document.getElementById('ta-about-content');
    content.innerHTML =
      '<div class="ta-about-logo"><img src="images/main.png" alt="Travel-ID"></div>' +
      '<div class="ta-about-version">Travel-ID v1.0.0</div>' +
      '<div class="ta-about-tagline">Discover Indonesia, Beyond Bali — for tourists and locals alike</div>' +
      '<div class="ta-about-links">' +
        '<a href="/privacy" target="_blank">' + t('about.privacy') + '</a>' +
        '<a href="/terms" target="_blank">' + t('about.terms') + '</a>' +
      '</div>';

    document.getElementById('ta-about-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.taCloseAbout = function() {
    document.getElementById('ta-about-overlay').classList.remove('active');
    document.body.style.overflow = '';
  };

  // === App Guide (How to Use) ===
  window.taShowGuide = function() {
    var steps = [
      { icon: '🔍', title: t('guide.step1Title'), desc: t('guide.step1Desc') },
      { icon: '⚙️', title: t('guide.step2Title'), desc: t('guide.step2Desc') },
      { icon: '📍', title: t('guide.step3Title'), desc: t('guide.step3Desc') },
      { icon: '🗺️', title: t('guide.step4Title'), desc: t('guide.step4Desc') },
      { icon: '❤️', title: t('guide.step5Title'), desc: t('guide.step5Desc') },
      { icon: '✈️', title: t('guide.step6Title'), desc: t('guide.step6Desc') }
    ];

    var content = document.getElementById('ta-guide-content');
    content.innerHTML = steps.map(function(step, i) {
      return '<div class="ta-guide-step">' +
        '<div class="ta-guide-num">' + (i + 1) + '</div>' +
        '<div class="ta-guide-step-body">' +
          '<h4>' + step.icon + ' ' + escapeHtml(step.title) + '</h4>' +
          '<p>' + escapeHtml(step.desc) + '</p>' +
        '</div>' +
      '</div>';
    }).join('');

    document.getElementById('ta-guide-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.taCloseGuide = function() {
    document.getElementById('ta-guide-overlay').classList.remove('active');
    document.getElementById('ta-guide-dismiss').style.display = 'none';
    document.body.style.overflow = '';
  };

  // Guide auto-popup dismiss
  window.taGuideDismiss = function(mode) {
    if (mode === 'forever') {
      localStorage.setItem('travelid_guide_dismissed', 'forever');
    } else if (mode === 'today') {
      localStorage.setItem('travelid_guide_dismissed', new Date().toDateString());
    }
    taCloseGuide();
  };

  function shouldShowGuidePopup() {
    var val = localStorage.getItem('travelid_guide_dismissed');
    if (!val) return true;
    if (val === 'forever') return false;
    // Check if dismissed today
    return val !== new Date().toDateString();
  }

  // === Travel Tips ===
  window.taShowTips = function() {
    var content = document.getElementById('ta-tips-content');
    var prefs = state.travelPrefs || {};
    var isLocal = prefs.visitType === 'local';
    var isMuslim = !!prefs.muslim;

    // Section 1: Visa & Entry — only for international visitors
    var visaSection = isLocal ? '' :
      '<div class="ta-tips-section">' +
        '<h3>🛂 ' + t('tips.visa') + '</h3>' +
        '<p class="ta-tips-desc">' + t('tips.visaDesc') + '</p>' +
        '<div class="ta-tips-links">' +
          '<a href="' + INDO_LINKS.visa + '" target="_blank" rel="noopener" class="ta-tips-link">📋 molina.imigrasi.go.id (e-VOA)</a>' +
        '</div>' +
      '</div>';

    // Section 2: Transport — show local sub-tip for everyone, currency only for international
    var currencyTip = isLocal
      ? ('<li>💳 ' + t('tips.tipping') + '</li>')
      : ('<li>💱 ' + t('tips.currencyDesc') + '</li>' +
         '<li>💳 ' + t('tips.tipping') + '</li>');

    // SIM card tip is for international visitors only
    var simTip = isLocal ? '' : ('<li>📱 ' + t('tips.simcard') + '</li>');

    // Korean-language localized embassy line for KO; mirrored if a corresponding key exists in JA / ZH
    var embassyLine = '';
    if (!isLocal && t('tips.korean') !== 'tips.korean') {
      embassyLine = '<li>🏛️ ' + t('tips.korean') + '</li>';
    }

    content.innerHTML =
      visaSection +
      '<div class="ta-tips-section">' +
        '<h3>🚆 ' + t('tips.transport') + '</h3>' +
        '<ul class="ta-tips-list">' +
          '<li>✈️ ' + t('tips.transportInterIsland') + '</li>' +
          '<li>🛺 ' + t('tips.transportLocal') + '</li>' +
          '<li>🛵 ' + t('tips.transportBali') + '</li>' +
        '</ul>' +
        '<div class="ta-tips-links">' +
          '<a href="' + INDO_LINKS.kai + '" target="_blank" rel="noopener" class="ta-tips-link">🚆 KAI (Java train booking)</a>' +
          '<a href="' + INDO_LINKS.pelni + '" target="_blank" rel="noopener" class="ta-tips-link">⛴️ Pelni (inter-island ferry)</a>' +
        '</div>' +
      '</div>' +
      '<div class="ta-tips-section">' +
        '<h3>🍜 ' + t('tips.meals') + '</h3>' +
        '<table class="ta-tips-table">' +
          '<tr><td>' + t('tips.budget') + '</td><td>' + t('tips.budgetDesc') + '</td></tr>' +
          '<tr><td>' + t('tips.moderate') + '</td><td>' + t('tips.moderateDesc') + '</td></tr>' +
          '<tr><td>' + t('tips.luxury') + '</td><td>' + t('tips.luxuryDesc') + '</td></tr>' +
        '</table>' +
      '</div>' +
      (isMuslim
        ? '<div class="ta-tips-section">' +
            '<h3>🕌 ' + t('tips.muslim') + '</h3>' +
            '<p class="ta-tips-desc">' + t('tips.muslimDesc') + '</p>' +
          '</div>'
        : ''
      ) +
      '<div class="ta-tips-section">' +
        '<h3>🌤️ ' + t('tips.weather') + '</h3>' +
        '<p class="ta-tips-desc">' + t('tips.weatherDesc') + '</p>' +
        '<div class="ta-tips-links">' +
          '<a href="' + INDO_LINKS.weather + '" target="_blank" rel="noopener" class="ta-tips-link">🌦️ BMKG (official forecast)</a>' +
        '</div>' +
      '</div>' +
      '<div class="ta-tips-section">' +
        '<h3>💡 ' + t('tips.useful') + '</h3>' +
        '<ul class="ta-tips-list">' +
          '<li>🤝 ' + t('tips.bargain') + '</li>' +
          '<li>💧 ' + t('tips.water') + '</li>' +
          '<li>🧣 ' + t('tips.modesty') + '</li>' +
          currencyTip +
          simTip +
          '<li>🚨 ' + t('tips.emergency') + '</li>' +
          '<li>👮 ' + t('tips.tourist') + '</li>' +
          embassyLine +
        '</ul>' +
        '<div class="ta-tips-links">' +
          '<a href="' + INDO_LINKS.visit + '" target="_blank" rel="noopener" class="ta-tips-link ta-tips-link-primary">🇮🇩 indonesia.travel — Official Tourism</a>' +
        '</div>' +
      '</div>';

    document.getElementById('ta-tips-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.taCloseTips = function() {
    document.getElementById('ta-tips-overlay').classList.remove('active');
    document.body.style.overflow = '';
  };

  // === Travel Settings ===
  window.taTogglePrefs = function() {
    var wrap = document.getElementById('ta-prefs-wrap');
    var isOpen = wrap.classList.contains('open');
    // Close other open menus
    document.getElementById('ta-auth-profile').classList.remove('open');
    if (isOpen) {
      wrap.classList.remove('open');
    } else {
      // Sync UI with current state
      document.getElementById('ta-pref-muslim').checked = state.travelPrefs.muslim;
      document.getElementById('ta-pref-vegan').checked = state.travelPrefs.vegan;
      var visitType = state.travelPrefs.visitType;
      document.getElementById('ta-pref-first').checked = visitType === 'first';
      document.getElementById('ta-pref-return').checked = visitType === 'return';
      var businessEl = document.getElementById('ta-pref-business');
      var groupEl = document.getElementById('ta-pref-group');
      var localEl = document.getElementById('ta-pref-local');
      if (businessEl) businessEl.checked = visitType === 'business';
      if (groupEl) groupEl.checked = visitType === 'group';
      if (localEl) localEl.checked = visitType === 'local';
      wrap.classList.add('open');
    }
  };

  window.taApplyPrefs = function() {
    var muslim = document.getElementById('ta-pref-muslim').checked;
    var vegan = document.getElementById('ta-pref-vegan').checked;
    var firstVisit = document.getElementById('ta-pref-first').checked;
    var returnVisit = document.getElementById('ta-pref-return').checked;
    var businessEl = document.getElementById('ta-pref-business');
    var groupEl = document.getElementById('ta-pref-group');
    var localEl = document.getElementById('ta-pref-local');
    var business = businessEl && businessEl.checked;
    var group = groupEl && groupEl.checked;
    var localResident = localEl && localEl.checked;
    var visitType = localResident ? 'local'
      : firstVisit ? 'first'
      : returnVisit ? 'return'
      : business ? 'business'
      : group ? 'group'
      : null;

    state.travelPrefs = { muslim: muslim, vegan: vegan, visitType: visitType };
    localStorage.setItem('travelid_prefs', JSON.stringify(state.travelPrefs));

    // Update badge indicator
    var badge = document.getElementById('ta-prefs-badge');
    var hasPrefs = muslim || vegan || visitType;
    badge.style.display = hasPrefs ? '' : 'none';

    // Close dropdown
    document.getElementById('ta-prefs-wrap').classList.remove('open');

    // Re-fetch spots
    state.nextCursor = null;
    fetchSpots(false);
  };

  // === Filters ===
  function initFilters() {
    document.querySelectorAll('.ta-cat-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.ta-cat-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.category = btn.dataset.cat;
        state.nextCursor = null;
        fetchSpots(false);
      });
    });

    document.getElementById('ta-region-select').addEventListener('change', function() {
      state.region = this.value;
      state.nextCursor = null;
      fetchSpots(false);
    });

    var searchInput = document.getElementById('ta-search');
    var searchTimer = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var val = this.value.trim();
      searchTimer = setTimeout(function() {
        state.search = val;
        var filtered = filterBySearch(state.spots);
        renderSpotList(filtered);
        renderMapMarkers(filtered);
      }, 300);
    });

    // Planner option buttons
    document.querySelectorAll('.ta-planner-options').forEach(function(group) {
      group.addEventListener('click', function(e) {
        var btn = e.target.closest('.ta-option-btn');
        if (!btn) return;
        group.querySelectorAll('.ta-option-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    // Days slider
    var daysSlider = document.getElementById('ta-planner-days');
    var daysVal = document.getElementById('ta-planner-days-val');
    if (daysSlider && daysVal) {
      daysSlider.addEventListener('input', function() {
        daysVal.textContent = this.value;
      });
    }
  }

  // === Submit modal overlay close ===
  function initModalClose() {
    document.getElementById('ta-submit-overlay').addEventListener('click', function(e) {
      if (e.target === e.currentTarget) taCloseSubmit();
    });

    document.getElementById('ta-planner-overlay').addEventListener('click', function(e) {
      if (e.target === e.currentTarget) taClosePlanner();
    });

    document.getElementById('ta-guide-overlay').addEventListener('click', function(e) {
      if (e.target === e.currentTarget) taCloseGuide();
    });

    document.getElementById('ta-about-overlay').addEventListener('click', function(e) {
      if (e.target === e.currentTarget) taCloseAbout();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        taCloseSubmit();
        taClosePlanner();
        taCloseGuide();
        taCloseAbout();
        if (state.selectedSpot) taBackToList();
      }
    });
  }

  // === Toast ===
  function showToast(msg) {
    var existing = document.querySelector('.ta-toast');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.className = 'ta-toast';
    el.textContent = msg;
    document.body.appendChild(el);

    requestAnimationFrame(function() {
      el.classList.add('show');
    });

    setTimeout(function() {
      el.classList.remove('show');
      setTimeout(function() { el.remove(); }, 300);
    }, 2000);
  }

  // === Utility ===
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  window._taTriggerResize = function() {
    if (state.map && state.mapLoaded) {
      mp().triggerResize(state.map);
    }
  };

  // === Mobile Bottom Sheet ===
  var bottomSheet = {
    isMobile: false,
    currentSnap: 'half',
    prevSnap: 'half',
    startY: 0,
    startHeight: 0,
    isDragging: false
  };

  function isMobileView() {
    return window.innerWidth <= 768;
  }

  function initBottomSheet() {
    var sidebar = document.getElementById('ta-sidebar');
    var handle = document.getElementById('ta-drag-handle');
    if (!handle || !sidebar) return;

    // Touch events on drag handle
    handle.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    // Mouse events for testing
    handle.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // Set initial state
    if (isMobileView()) {
      bottomSheet.isMobile = true;
      setSnap('half');
    }

    // Handle resize
    window.addEventListener('resize', function() {
      var wasMobile = bottomSheet.isMobile;
      bottomSheet.isMobile = isMobileView();
      if (bottomSheet.isMobile && !wasMobile) {
        setSnap('half');
      } else if (!bottomSheet.isMobile && wasMobile) {
        sidebar.style.height = '';
        sidebar.className = sidebar.className.replace(/\bsnap-\w+/g, '').trim();
      }
    });
  }

  function onDragStart(e) {
    if (!isMobileView()) return;
    var sidebar = document.getElementById('ta-sidebar');
    bottomSheet.isDragging = true;
    bottomSheet.startY = e.touches ? e.touches[0].clientY : e.clientY;
    bottomSheet.startHeight = sidebar.offsetHeight;
    sidebar.classList.add('dragging');
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!bottomSheet.isDragging) return;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var deltaY = bottomSheet.startY - clientY;
    var newHeight = bottomSheet.startHeight + deltaY;
    var vh = window.innerHeight;
    newHeight = Math.max(vh * 0.1, Math.min(vh * 0.9, newHeight));
    var sidebar = document.getElementById('ta-sidebar');
    sidebar.style.height = newHeight + 'px';
    updateFabPosition(newHeight);
    e.preventDefault();
  }

  function onDragEnd() {
    if (!bottomSheet.isDragging) return;
    bottomSheet.isDragging = false;
    var sidebar = document.getElementById('ta-sidebar');
    sidebar.classList.remove('dragging');
    sidebar.style.height = '';

    var currentHeight = sidebar.offsetHeight || (window.innerHeight * 0.5);
    var vh = window.innerHeight;
    var ratio = currentHeight / vh;

    // Snap to closest point
    if (ratio < 0.3) {
      setSnap('peek');
    } else if (ratio < 0.65) {
      setSnap('half');
    } else {
      setSnap('full');
    }
  }

  function setSnap(snap) {
    var sidebar = document.getElementById('ta-sidebar');
    sidebar.classList.remove('snap-peek', 'snap-half', 'snap-full');
    sidebar.classList.add('snap-' + snap);
    sidebar.style.height = '';
    bottomSheet.prevSnap = bottomSheet.currentSnap;
    bottomSheet.currentSnap = snap;
    updateFabForSnap(snap);
    updateViewToggle(snap);

    // Trigger map resize after transition completes
    setTimeout(function() {
      if (window._taTriggerResize) window._taTriggerResize();
    }, 400);
  }

  function updateFabPosition(height) {
    var fab = document.getElementById('ta-fab');
    if (fab && isMobileView()) {
      fab.style.bottom = (height + 12) + 'px';
    }
  }

  function updateFabForSnap(snap) {
    var fab = document.getElementById('ta-fab');
    if (!fab || !isMobileView()) return;
    fab.style.bottom = '';
    var map = { peek: 'calc(15vh + 12px)', half: 'calc(50vh + 12px)', full: 'calc(85vh + 12px)' };
    fab.style.bottom = map[snap] || 'calc(50vh + 12px)';
  }

  // === View Toggle (Map/List) ===
  window.taToggleView = function() {
    if (!isMobileView()) return;
    if (bottomSheet.currentSnap === 'peek') {
      setSnap('half');
    } else {
      setSnap('peek');
    }
  };

  function updateViewToggle(snap) {
    var btn = document.getElementById('ta-view-toggle');
    var textEl = document.getElementById('ta-view-toggle-text');
    var iconEl = document.getElementById('ta-view-toggle-icon');
    if (!btn || !isMobileView()) return;

    if (snap === 'peek') {
      // Showing map, offer to show list
      textEl.textContent = t('app.viewList') || 'List';
      iconEl.innerHTML = '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>';
      btn.style.bottom = 'calc(15vh + 12px)';
    } else {
      // Showing list, offer to show map
      textEl.textContent = t('app.viewMap') || 'Map';
      iconEl.innerHTML = '<path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>';
      var map = { half: 'calc(50vh + 12px)', full: 'calc(85vh + 12px)' };
      btn.style.bottom = map[snap] || 'calc(50vh + 12px)';
    }
  }

  // Detail/back hooks are added in showDetail/taBackToList directly

  // === Search: auto-expand on focus ===
  function initSearchAutoExpand() {
    var searchInput = document.getElementById('ta-search');
    if (!searchInput) return;
    searchInput.addEventListener('focus', function() {
      if (isMobileView() && bottomSheet.currentSnap !== 'full') {
        setSnap('full');
      }
    });
  }

  // === Category scroll fade hint ===
  function initCatScrollHint() {
    var catRow = document.getElementById('ta-cat-row');
    var catWrap = document.getElementById('ta-cat-row-wrap');
    if (!catRow || !catWrap) return;

    function checkScroll() {
      var atEnd = catRow.scrollLeft + catRow.offsetWidth >= catRow.scrollWidth - 8;
      if (atEnd) {
        catWrap.classList.add('scrolled-end');
      } else {
        catWrap.classList.remove('scrolled-end');
      }
    }
    catRow.addEventListener('scroll', checkScroll);
    // Check initially after spots load
    setTimeout(checkScroll, 500);
  }

  // === Modal swipe-to-close ===
  function initModalSwipeClose() {
    var overlays = document.querySelectorAll('.ta-modal-overlay');
    overlays.forEach(function(overlay) {
      var modal = overlay.querySelector('.ta-modal');
      if (!modal) return;

      var startY = 0, startScrollTop = 0, swiping = false;

      modal.addEventListener('touchstart', function(e) {
        startY = e.touches[0].clientY;
        startScrollTop = modal.scrollTop;
      }, { passive: true });

      modal.addEventListener('touchmove', function(e) {
        if (modal.scrollTop > 0) return; // Only swipe when at top
        var deltaY = e.touches[0].clientY - startY;
        if (deltaY > 10 && startScrollTop <= 0) {
          swiping = true;
          modal.style.transform = 'translateY(' + Math.min(deltaY, 300) + 'px)';
          modal.style.transition = 'none';
        }
      }, { passive: true });

      modal.addEventListener('touchend', function() {
        if (!swiping) return;
        var currentTransform = modal.style.transform;
        var match = currentTransform.match(/translateY\((\d+)/);
        var distance = match ? parseInt(match[1]) : 0;
        modal.style.transition = '';
        modal.style.transform = '';
        swiping = false;
        if (distance > 100) {
          // Find and call the close function
          var closeBtn = modal.querySelector('.ta-modal-close');
          if (closeBtn) closeBtn.click();
        }
      });
    });

    // Close My Plans and Compare overlays on background click
    var myplansOverlay = document.getElementById('ta-myplans-overlay');
    if (myplansOverlay) {
      myplansOverlay.addEventListener('click', function(e) {
        if (e.target === e.currentTarget) taCloseMyPlans();
      });
    }
    var compareOverlay = document.getElementById('ta-compare-overlay');
    if (compareOverlay) {
      compareOverlay.addEventListener('click', function(e) {
        if (e.target === e.currentTarget) taCloseCompare();
      });
    }
    var tipsOverlay = document.getElementById('ta-tips-overlay');
    if (tipsOverlay) {
      tipsOverlay.addEventListener('click', function(e) {
        if (e.target === e.currentTarget) taCloseTips();
      });
    }
  }

  // === Init ===
  function initPrefs() {
    // Show badge if any prefs are active
    var p = state.travelPrefs;
    var badge = document.getElementById('ta-prefs-badge');
    if (badge) badge.style.display = (p.muslim || p.vegan || p.visitType) ? '' : 'none';

    // Close prefs dropdown when clicking outside
    document.addEventListener('click', function(e) {
      var wrap = document.getElementById('ta-prefs-wrap');
      if (wrap && !wrap.contains(e.target)) {
        wrap.classList.remove('open');
      }
    });
  }

  function init() {
    // Splash first — must run before anything else can fail
    initSplash();

    // Check for deep-link spot parameter
    var spotParam = new URLSearchParams(window.location.search).get('spot');
    if (spotParam) state._pendingSpotId = spotParam;

    initLanguage();
    applyTranslations();
    initFilters();
    initModalClose();
    initAuth();
    initPrefs();
    initMap();
    fetchSpots(false);
    initBottomSheet();
    initSearchAutoExpand();
    initCatScrollHint();
    initModalSwipeClose();
  }

  function initSplash() {
    // CSS handles splash display (only in standalone mode) and auto-fade via animation.
    // JS just cleans up the DOM after animation and shows guide popup.
    var splash = document.getElementById('ta-splash');
    if (!splash) return;

    var isApp = window.matchMedia('(display-mode: standalone)').matches ||
                window.navigator.standalone === true;

    function afterSplash() {
      try { splash.remove(); } catch(e) { splash.style.display = 'none'; }
      if (shouldShowGuidePopup()) {
        var dismiss = document.getElementById('ta-guide-dismiss');
        if (dismiss) dismiss.style.display = '';
        taShowGuide();
      }
    }

    if (!isApp) {
      // Web: no splash, just remove element and show guide if needed
      splash.remove();
      if (shouldShowGuidePopup()) {
        var dismiss = document.getElementById('ta-guide-dismiss');
        if (dismiss) dismiss.style.display = '';
        taShowGuide();
      }
      return;
    }

    // App: CSS animation handles fade-out at 1s. Clean up DOM at 1.5s.
    setTimeout(afterSplash, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
