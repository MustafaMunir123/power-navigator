// AI Navigator - UI + custom Places autocomplete (programmatic, so we control errors)
(function () {
  console.log('[AI Navigator] script loaded — Nova is called on the server (check terminal for [POST /api/detect-stops] and [Nova API])');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  const fromDropdown = document.getElementById('from-dropdown');
  const toDropdown = document.getElementById('to-dropdown');
  const fromError = document.getElementById('from-error');
  const toError = document.getElementById('to-error');
  const routeDisplay = document.getElementById('route-display');
  const routeMapEl = document.getElementById('route-map');
  const routePlaceholder = document.getElementById('route-placeholder');

  function stripHtml(html) {
    var el = document.createElement('div');
    el.innerHTML = html;
    return (el.textContent || el.innerText || '').trim();
  }

  function appendMessage(text, role) {
    const div = document.createElement('div');
    div.className = 'message message-' + role;
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  var routeMap = null;
  var directionsRenderer = null;
  var directionsService = null;

  function showRoute() {
    var from = fromInput.value.trim();
    var to = toInput.value.trim();
    if (!from || !to) {
      routePlaceholder.textContent = 'Enter both From and To, then click Send.';
      routePlaceholder.style.color = 'var(--text-muted)';
      return;
    }
    if (typeof google === 'undefined' || !google.maps) {
      routePlaceholder.textContent = 'Map is still loading. Try again in a moment.';
      routePlaceholder.style.color = 'var(--text-muted)';
      return;
    }
    routePlaceholder.textContent = 'Loading route…';
    routePlaceholder.style.color = 'var(--text-muted)';
    if (!directionsService) directionsService = new google.maps.DirectionsService();
    directionsService.route(
      { origin: from, destination: to, travelMode: google.maps.TravelMode.DRIVING },
      function (result, status) {
        console.log('[Maps Directions] status:', status);
        if (status !== google.maps.DirectionsStatus.OK) {
          routePlaceholder.textContent = 'Could not find route: ' + (status || 'Unknown error');
          routePlaceholder.style.color = '#f85149';
          return;
        }
        console.log('[Directions] OK - callback running, will call extract-locations');
        routeMapEl.setAttribute('aria-hidden', 'false');
        routeDisplay.classList.add('has-route');
        if (!routeMap) {
          routeMap = new google.maps.Map(routeMapEl, {
            zoom: 12,
            center: { lat: 24.8607, lng: 67.0011 },
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            scaleControl: true,
            fullscreenControl: true,
          });
          directionsRenderer = new google.maps.DirectionsRenderer({
            map: routeMap,
            suppressMarkers: false,
          });
        }
        directionsRenderer.setDirections(result);
        var firstRoute = result.routes && result.routes[0];
        if (!firstRoute) {
          console.warn('[Directions] no result.routes[0], result:', result);
        }
        var bounds = firstRoute && firstRoute.bounds;
        if (bounds) routeMap.fitBounds(bounds);
        // Directions API (client-side): result.routes[0].legs[].steps[].html_instructions
        var instructions = [];
        try {
          if (firstRoute && firstRoute.legs && firstRoute.legs.length) {
            for (var l = 0; l < firstRoute.legs.length; l++) {
              var steps = firstRoute.legs[l].steps || [];
              for (var s = 0; s < steps.length; s++) {
                var raw = steps[s].html_instructions || steps[s].instructions || '';
                if (raw) instructions.push(stripHtml(raw));
              }
            }
          }
        } catch (e) {
          console.error('[Directions] error reading steps:', e);
        }
        if (firstRoute) {
          console.log('[Directions] firstRoute keys:', Object.keys(firstRoute));
          if (firstRoute.legs && firstRoute.legs[0]) console.log('[Directions] first leg keys:', Object.keys(firstRoute.legs[0]), 'first step:', firstRoute.legs[0].steps && firstRoute.legs[0].steps[0] ? Object.keys(firstRoute.legs[0].steps[0]) : 'no steps');
        }
        console.log('[Directions] instructions count:', instructions.length, instructions);
        appendMessage('Extracting route locations…', 'assistant');
        chatMessages.scrollTop = chatMessages.scrollHeight;
        console.log('[Directions] calling /api/extract-locations with', instructions.length, 'instructions');
        fetch('/api/extract-locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: instructions }),
        })
          .then(function (r) {
            if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || r.statusText); });
            return r.json();
          })
          .then(function (data) {
            var locs = data.locations || [];
            var last = chatMessages.querySelector('.message-assistant:last-of-type');
            if (last && last.textContent === 'Extracting route locations…') last.remove();
            console.log('[extract-locations] response:', data);
            if (locs.length) {
              var multiWord = locs.filter(function (loc) {
                return (loc || '').trim().split(/\s+/).length > 1;
              });
              appendMessage('Route locations: ' + (multiWord.length ? multiWord.join(', ') : '(none with more than one word)'), 'assistant');
            } else if (instructions.length === 0) {
              appendMessage('Route locations: No step instructions in directions (check console for route/legs/steps).', 'assistant');
            } else {
              appendMessage('Route locations: (none extracted). Raw: ' + JSON.stringify(data), 'assistant');
            }
            chatMessages.scrollTop = chatMessages.scrollHeight;
          })
          .catch(function (err) {
            console.error('[extract-locations] error:', err.message);
            var last = chatMessages.querySelector('.message-assistant:last-of-type');
            if (last && last.textContent === 'Extracting route locations…') last.remove();
            appendMessage('Route locations error: ' + err.message, 'assistant');
            chatMessages.scrollTop = chatMessages.scrollHeight;
          });
      }
    );
  }

  function sendMessage() {
    var text = chatInput.value.trim();
    console.log('[Send] clicked, chat text:', text ? text.substring(0, 50) : '(empty)');
    showRoute();
    if (!text) return;
    appendMessage(text, 'user');
    chatInput.value = '';
    var source = fromInput.value.trim();
    var destination = toInput.value.trim();
    if (!source || !destination) {
      appendMessage('Enter both From and To to detect stops.', 'assistant');
      return;
    }
    var pendingEl = document.createElement('div');
    pendingEl.className = 'message message-assistant';
    pendingEl.setAttribute('data-pending', 'stops');
    pendingEl.textContent = 'Checking for stops…';
    chatMessages.appendChild(pendingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    console.log('[detect-stops] sending request', { source: source.substring(0, 40), destination: destination.substring(0, 40), userQuery: text });
    fetch('/api/detect-stops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, destination, userQuery: text }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || r.statusText); });
        return r.json();
      })
      .then(function (data) {
        var stops = data.stops || [];
        var pending = chatMessages.querySelector('[data-pending="stops"]');
        if (pending) pending.remove();
        if (stops.length) {
          appendMessage('Detected stops: ' + stops.join(', '), 'assistant');
        } else {
          appendMessage('No stops detected in your message.', 'assistant');
        }
        console.log('[detect-stops] response', data);
      })
      .catch(function (err) {
        console.error('[detect-stops] fetch error:', err);
        var pending = chatMessages.querySelector('[data-pending="stops"]');
        if (pending) pending.remove();
        appendMessage('Error: ' + (err.message || 'Could not detect stops.'), 'assistant');
      });
  }

  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendMessage();
  });

  var autocompleteService = null;
  var fromDebounce = null;
  var toDebounce = null;
  var PLACES_DEBOUNCE_MS = 600;
  var PLACES_MIN_CHARS = 10;
  // var PLACES_ERROR_MSG = 'Places error. Enable "Places API" (and billing) in Google Cloud Console for this key.';

  function bindAutocomplete(input, dropdown, errorEl) {
    if (!autocompleteService) return;
    errorEl.textContent = '';

    function showPredictions(predictions) {
      dropdown.innerHTML = '';
      dropdown.setAttribute('aria-hidden', 'false');
      if (!predictions || predictions.length === 0) {
        dropdown.setAttribute('aria-hidden', 'true');
        return;
      }
      predictions.forEach(function (p) {
        var item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = p.description;
        item.tabIndex = 0;
        item.addEventListener('click', function () {
          input.value = p.description;
          dropdown.innerHTML = '';
          dropdown.setAttribute('aria-hidden', 'true');
          input.focus();
        });
        item.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') item.click();
        });
        dropdown.appendChild(item);
      });
    }

    var requestTimeout = null;
    function onInput() {
      var value = input.value.trim();
      if (value.length < PLACES_MIN_CHARS) {
        dropdown.innerHTML = '';
        dropdown.setAttribute('aria-hidden', 'true');
        errorEl.textContent = '';
        if (requestTimeout) clearTimeout(requestTimeout);
        return;
      }
      if (requestTimeout) clearTimeout(requestTimeout);
      errorEl.textContent = 'Searching…';
      errorEl.style.color = 'var(--text-muted)';
      console.log('Places request:', value);
      requestTimeout = setTimeout(function () {
        requestTimeout = null;
        if (errorEl.textContent === 'Searching…') {
          errorEl.textContent = 'Request timed out. Check browser Network tab for blocked requests (e.g. ad blocker). In GCP, check both "Maps JavaScript API" and "Places API" usage.';
          errorEl.style.color = '';
        }
      }, 10000);
      try {
        autocompleteService.getPlacePredictions(
          { input: value },
          function (predictions, status) {
          if (requestTimeout) {
            clearTimeout(requestTimeout);
            requestTimeout = null;
          }
          errorEl.style.color = '';
          console.log('Places response:', status, predictions ? predictions.length : 0);
          if (status !== google.maps.places.PlacesServiceStatus.OK && status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            console.warn('Places Autocomplete status:', status);
          }
          if (status === google.maps.places.PlacesServiceStatus.OK) {
            errorEl.textContent = '';
            showPredictions(predictions);
          } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            errorEl.textContent = '';
            showPredictions([]);
          } else {
            dropdown.innerHTML = '';
            dropdown.setAttribute('aria-hidden', 'true');
            var statusStr = String(status || 'UNKNOWN');
            if (statusStr === 'REQUEST_DENIED') {
              errorEl.textContent = 'Places API denied. In API key restrictions, add "Places API" to the allowed APIs list (with Maps JavaScript API). Enable billing if needed.';
            } else if (statusStr === 'OVER_QUERY_LIMIT') {
              errorEl.textContent = 'Over query limit. Check billing and quotas in Google Cloud.';
            } else {
              errorEl.textContent = 'Places error: ' + statusStr + '. Enable Places API and billing for this key.';
            }
          }
        }
        );
      } catch (err) {
        if (requestTimeout) clearTimeout(requestTimeout);
        requestTimeout = null;
        errorEl.textContent = 'Places error: ' + (err && err.message ? err.message : 'Check console');
        errorEl.style.color = '';
        console.error('Places getPlacePredictions error:', err);
      }
    }

    input.addEventListener('input', function () {
      clearTimeout(input === fromInput ? fromDebounce : toDebounce);
      var t = setTimeout(onInput, PLACES_DEBOUNCE_MS);
      if (input === fromInput) fromDebounce = t; else toDebounce = t;
    });
    input.addEventListener('focus', function () {
      if (input.value.trim().length >= PLACES_MIN_CHARS) onInput();
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        dropdown.innerHTML = '';
        dropdown.setAttribute('aria-hidden', 'true');
      }, 150);
    });
  }

  function initAutocomplete() {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
      fromError.textContent = 'Maps not loaded. Set MAPS_API_KEY in .env and run with npm start.';
      toError.textContent = fromError.textContent;
      return;
    }
    autocompleteService = new google.maps.places.AutocompleteService();
    bindAutocomplete(fromInput, fromDropdown, fromError);
    bindAutocomplete(toInput, toDropdown, toError);
  }

  var rawKey = typeof window.MAPS_API_KEY !== 'undefined' ? String(window.MAPS_API_KEY).trim() : '';
  var key = rawKey && rawKey !== 'YOUR_GOOGLE_MAPS_API_KEY' && rawKey.indexOf('__MAPS_API_KEY__') === -1
    ? rawKey
    : null;

  function showKeyError(msg) {
    fromError.textContent = msg;
    toError.textContent = msg;
  }

  if (!key) {
    if (rawKey && rawKey.indexOf('__MAPS_API_KEY__') !== -1) {
      showKeyError('Key not injected. Run the app with: npm start — then open http://localhost:3000 (do not open the HTML file directly).');
    } else {
      showKeyError('Set MAPS_API_KEY in .env and run with npm start for autocomplete.');
    }
  } else {
    var loadTimeout = setTimeout(function () {
      if (autocompleteService === null) {
        showKeyError('Maps script did not load. In API key restrictions, allow both "Maps JavaScript API" and "Places API" for this key.');
      }
    }, 8000);
    window.__aiNavigatorMapsReady = function () {
      clearTimeout(loadTimeout);
      window.__aiNavigatorMapsReady = null;
      initAutocomplete();
    };
    var script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&libraries=places&callback=__aiNavigatorMapsReady';
    script.async = true;
    script.defer = true;
    script.onerror = function () {
      clearTimeout(loadTimeout);
      showKeyError('Failed to load Maps script. In API key restrictions, allow "Maps JavaScript API" and "Places API" for this key.');
    };
    document.head.appendChild(script);
  }
})();
