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
  const routeEstimateEl = document.getElementById('route-estimate');
  const clearBtn = document.getElementById('clear-btn');
  const adjustStopsSwitch = document.getElementById('adjust-stops-switch');
  const personalizeSwitch = document.getElementById('personalize-switch');
  const personalizeActionsEl = document.getElementById('personalize-actions');
  const readjustOverlayEl = document.getElementById('route-readjust-overlay');
  const duplicatePopupEl = document.getElementById('duplicate-popup');
  const duplicatePopupMessageEl = document.getElementById('duplicate-popup-title');

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

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function normalizeAddress(s) {
    return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function isPlaceDestination(place, toValue) {
    if (!toValue || !place) return false;
    var toNorm = normalizeAddress(toValue);
    var name = (place.name || '').trim();
    var addr = (place.formatted_address || '').trim();
    if (!toNorm) return false;
    if (name && toNorm.indexOf(normalizeAddress(name)) >= 0) return true;
    if (addr && toNorm === normalizeAddress(addr)) return true;
    if (addr && toNorm.indexOf(normalizeAddress(addr)) >= 0) return true;
    if (addr && normalizeAddress(addr).indexOf(toNorm) >= 0) return true;
    return false;
  }

  function getRoutePlaces() {
    var from = (fromInput && fromInput.value || '').trim();
    var to = (toInput && toInput.value || '').trim();
    var list = [{ name: '', address: from }, { name: '', address: to }];
    (window.addedStops || []).forEach(function (s) {
      list.push({
        name: (s.name || '').trim(),
        address: (s.formatted_address || '').trim()
      });
    });
    return list.filter(function (p) { return p.address || p.name; });
  }

  function exactPlaceMatch(place, routePlaces) {
    var placeAddr = normalizeAddress(place.formatted_address);
    var placeName = normalizeAddress(place.name);
    if (!placeAddr) return false;
    for (var i = 0; i < routePlaces.length; i++) {
      var r = routePlaces[i];
      var rAddr = normalizeAddress(r.address);
      var rName = normalizeAddress(r.name);
      if (rAddr !== placeAddr) continue;
      if (!placeName || !rName) return true;
      if (placeName === rName) return true;
    }
    return false;
  }

  function showDuplicatePopup(message) {
    if (duplicatePopupMessageEl) duplicatePopupMessageEl.textContent = message || 'This is already in your route.';
    if (duplicatePopupEl) duplicatePopupEl.setAttribute('aria-hidden', 'false');
  }

  function hideDuplicatePopup() {
    if (duplicatePopupEl) duplicatePopupEl.setAttribute('aria-hidden', 'true');
  }

  function appendStopButton(place, stopType, notRecommended) {
    var toValue = (toInput && toInput.value || '').trim();
    var atDestination = isPlaceDestination(place, toValue);
    var wrap = document.createElement('div');
    wrap.className = 'message message-assistant stop-suggestion-wrap';
    var row = document.createElement('div');
    row.className = 'stop-suggestion-row';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stop-suggestion-btn';
    btn.setAttribute('data-place-id', place.place_id || '');
    var nameEl = document.createElement('span');
    nameEl.className = 'stop-suggestion-name';
    nameEl.textContent = place.name || 'Place';
    var meta = document.createElement('span');
    meta.className = 'stop-suggestion-meta' + (atDestination ? ' at-destination' : '');
    meta.textContent = atDestination ? 'At your destination' : (place.open_now ? 'Open now' : 'Closed');
    btn.appendChild(nameEl);
    btn.appendChild(meta);
    var addCircle = document.createElement('span');
    addCircle.className = 'stop-suggestion-add';
    addCircle.setAttribute('aria-label', 'Add stop to route');
    addCircle.textContent = '+';
    addCircle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      addStopToRoute(place);
    });
    btn.appendChild(addCircle);
    row.appendChild(btn);
    var expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'stop-suggestion-expand';
    expandBtn.setAttribute('aria-label', 'Show other options');
    expandBtn.textContent = '>';
    row.appendChild(expandBtn);
    var section = document.createElement('div');
    section.className = 'stop-suggestion-others';
    if (notRecommended && notRecommended.length > 0) {
      notRecommended.forEach(function (p) {
        var atDest = isPlaceDestination(p, toValue);
        var card = document.createElement('div');
        card.className = 'stop-other-card';
        var nameSpan = document.createElement('span');
        nameSpan.className = 'stop-other-name';
        nameSpan.textContent = p.name || 'Place';
        var metaSpan = document.createElement('span');
        metaSpan.className = 'stop-other-meta' + (atDest ? ' at-destination' : '');
        metaSpan.textContent = atDest ? 'At your destination' : (p.open_now ? 'Open now' : 'Closed');
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'stop-other-add';
        addBtn.setAttribute('aria-label', 'Add to route');
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          addStopToRoute(p);
        });
        card.appendChild(nameSpan);
        card.appendChild(metaSpan);
        card.appendChild(addBtn);
        section.appendChild(card);
      });
    } else {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'stop-other-empty';
      emptyMsg.textContent = 'No other options along this route.';
      section.appendChild(emptyMsg);
    }
    wrap.appendChild(row);
    wrap.appendChild(section);
    expandBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      section.classList.toggle('is-open');
      expandBtn.classList.toggle('open', section.classList.contains('is-open'));
    });
    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function tryFindStopsNearRoute() {
    var stops = window.lastDetectedStops;
    var map = window.routeLocationMap;
    var radius = window.routeSearchRadius || 1000;
    if (!stops || !stops.length || !map || !map.length) return;
    if (window.findPlacesRunning) return;
    var locationsWithCoords = map.filter(function (m) { return m.lat != null && m.lng != null; });
    var n = locationsWithCoords.length;
    if (n > 3) {
      var start = Math.floor((n - 3) / 2);
      locationsWithCoords = locationsWithCoords.slice(start, start + 3);
    } else if (n === 3) {
      locationsWithCoords = locationsWithCoords.slice(1, 3);
    }
    if (!locationsWithCoords.length) return;
    window.findPlacesRunning = true;
    var refLat = locationsWithCoords[0].lat;
    var refLng = locationsWithCoords[0].lng;
    var pendingMsg = document.createElement('div');
    pendingMsg.className = 'message message-assistant';
    pendingMsg.setAttribute('data-pending', 'find-places');
    pendingMsg.textContent = 'Finding stops near route…';
    chatMessages.appendChild(pendingMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    var resultsByStop = {};
    var total = stops.length * locationsWithCoords.length;
    var done = 0;
    function checkDone() {
      done++;
      if (done < total) return;
      var pending = chatMessages.querySelector('[data-pending="find-places"]');
      if (pending) pending.remove();
      window.findPlacesRunning = false;
      // Recommended stop = closest to destination (among along-route, prefer open).
      // REVERT: To prefer "middle of route" again (e.g. Hamza Book House): (1) sort by dist instead of distToDestination below; (2) in addPlace(), set alongRoute = false when distFromEnd < margin as well (exclude places near destination from being chosen).
      stops.forEach(function (stopType) {
        var raw = resultsByStop[stopType] || [];
        var seen = {};
        var places = raw.filter(function (p) {
          var id = p.place_id || p.name;
          if (seen[id]) return false;
          seen[id] = true;
          return true;
        });
        var alongRouteOnly = places.filter(function (p) { return p.alongRoute !== false; });
        var openPlaces = alongRouteOnly.filter(function (p) { return p.open_now === true; });
        var candidates = openPlaces.length ? openPlaces : alongRouteOnly;
        candidates.sort(function (a, b) {
          var da = a.distToDestination != null ? a.distToDestination : Infinity;
          var db = b.distToDestination != null ? b.distToDestination : Infinity;
          return da - db;
        });
        var chosen = candidates[0];
        if (chosen) {
          var notRecommended = places.filter(function (p) { return (p.place_id || p.name) !== (chosen.place_id || chosen.name); });
          appendStopButton(chosen, stopType, notRecommended);
        } else {
          appendMessage(stopType + ' near route: (none found)', 'assistant');
        }
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    function addPlace(place, stopType) {
      var locObj = place.geometry && place.geometry.location;
      var lat = locObj && (typeof locObj.lat === 'function' ? locObj.lat() : locObj.lat);
      var lng = locObj && (typeof locObj.lng === 'function' ? locObj.lng() : locObj.lng);
      var routeStart = window.routeStart;
      var routeEnd = window.routeEnd;
      var routeTotal = window.routeTotalMeters;
      var alongRoute = true;
      // Exclude from "recommended" only if too close to start (so we can suggest stops near destination, e.g. Razi).
      // REVERT (Hamza-style): also exclude near destination: add "|| distFromEnd < margin" and compute distFromEnd from routeEnd.
      if (lat != null && lng != null && routeStart && routeTotal && routeTotal > 0) {
        var distFromStart = haversineMeters(routeStart.lat, routeStart.lng, lat, lng);
        var margin = 0.2 * routeTotal;
        if (distFromStart < margin) {
          alongRoute = false;
          console.log('[find-place] (shown in others only, near start):', place.name, 'distFromStart:', Math.round(distFromStart), 'm, margin:', Math.round(margin), 'm');
        }
      }
      var dist = (lat != null && lng != null) ? haversineMeters(refLat, refLng, lat, lng) : null;
      var distToDestination = (lat != null && lng != null && routeEnd) ? haversineMeters(routeEnd.lat, routeEnd.lng, lat, lng) : null;
      var openNow = !!(place.opening_hours && place.opening_hours.open_now);
      resultsByStop[stopType].push({
        name: place.name || 'Place',
        formatted_address: place.formatted_address,
        place_id: place.place_id,
        lat: lat,
        lng: lng,
        open_now: openNow,
        dist: dist,
        distToDestination: distToDestination,
        alongRoute: alongRoute
      });
    }

    function doFind(stopType, loc, locName) {
      resultsByStop[stopType] = resultsByStop[stopType] || [];
      var q = 'input=' + encodeURIComponent(stopType) + '&lat=' + loc.lat + '&lng=' + loc.lng + '&radius=' + radius;
      fetch('/api/find-place?' + q)
        .then(function (r) { if (!r.ok) throw new Error(r.statusText); return r.json(); })
        .then(function (data) {
          var ids = (data.place_ids || []).slice(0, 5);
          if (!ids.length) {
            checkDone();
            return;
          }
          var pending = ids.length;
          function oneDone() {
            pending--;
            if (pending === 0) checkDone();
          }
          ids.forEach(function (placeId) {
            fetch('/api/place-details?place_id=' + encodeURIComponent(placeId))
              .then(function (r2) { if (!r2.ok) throw new Error(r2.statusText); return r2.json(); })
              .then(function (place) {
                addPlace(place, stopType);
              })
              .catch(function (err) {
                console.error('[place-details]', stopType, placeId, err);
              })
              .then(oneDone);
          });
        })
        .catch(function (err) {
          console.error('[find-place]', stopType, locName, err);
          checkDone();
        });
    }
    stops.forEach(function (stopType) {
      locationsWithCoords.forEach(function (loc) {
        doFind(stopType, loc, loc.name || 'route');
      });
    });
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
        window.lastRouteOrigin = from;
        window.lastRouteDestination = to;
        updateRouteEstimate(result);
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
        var firstRoute = result.routes && result.routes[0];
        if (!firstRoute) {
          console.warn('[Directions] no result.routes[0], result:', result);
        }
        if (window.addedStops && window.addedStops.length > 0) {
          routePlaceholder.textContent = '';
          routePlaceholder.style.color = '';
          updateRouteWithStops();
        } else {
          directionsRenderer.setDirections(result);
          var bounds = firstRoute && firstRoute.bounds;
          if (bounds) routeMap.fitBounds(bounds);
          routePlaceholder.textContent = '';
          routePlaceholder.style.color = '';
          updateRouteEstimate(result);
        }
        // Directions API (client-side): result.routes[0].legs[].steps[].html_instructions + end_location for lat/lng
        var instructions = [];
        var stepCoords = [];
        try {
          if (firstRoute && firstRoute.legs && firstRoute.legs.length) {
            for (var l = 0; l < firstRoute.legs.length; l++) {
              var steps = firstRoute.legs[l].steps || [];
              for (var s = 0; s < steps.length; s++) {
                var raw = steps[s].html_instructions || steps[s].instructions || '';
                if (raw) {
                  instructions.push(stripHtml(raw));
                  var loc = steps[s].end_location;
                  stepCoords.push({
                    lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
                    lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error('[Directions] error reading steps:', e);
        }
        var totalDistanceMeters = 0;
        if (firstRoute && firstRoute.legs) {
          for (var d = 0; d < firstRoute.legs.length; d++) {
            var legDist = firstRoute.legs[d].distance;
            if (legDist && (typeof legDist.value === 'number')) totalDistanceMeters += legDist.value;
          }
        }
        var radiusMeters = 1000;
        if (totalDistanceMeters > 0) {
          radiusMeters = Math.min(1000, Math.round(totalDistanceMeters * 0.1));
        }
        window.routeSearchRadius = radiusMeters;
        window.routeTotalMeters = totalDistanceMeters;
        if (firstRoute && firstRoute.legs && firstRoute.legs.length) {
          var firstStep = firstRoute.legs[0].steps && firstRoute.legs[0].steps[0];
          var lastLeg = firstRoute.legs[firstRoute.legs.length - 1];
          var lastStep = lastLeg.steps && lastLeg.steps[lastLeg.steps.length - 1];
          if (firstStep && firstStep.start_location) {
            window.routeStart = {
              lat: typeof firstStep.start_location.lat === 'function' ? firstStep.start_location.lat() : firstStep.start_location.lat,
              lng: typeof firstStep.start_location.lng === 'function' ? firstStep.start_location.lng() : firstStep.start_location.lng
            };
          } else if (stepCoords.length) {
            window.routeStart = { lat: stepCoords[0].lat, lng: stepCoords[0].lng };
          } else window.routeStart = null;
          if (lastStep && lastStep.end_location) {
            window.routeEnd = {
              lat: typeof lastStep.end_location.lat === 'function' ? lastStep.end_location.lat() : lastStep.end_location.lat,
              lng: typeof lastStep.end_location.lng === 'function' ? lastStep.end_location.lng() : lastStep.end_location.lng
            };
          } else if (stepCoords.length) {
            var lastCoord = stepCoords[stepCoords.length - 1];
            window.routeEnd = { lat: lastCoord.lat, lng: lastCoord.lng };
          } else window.routeEnd = null;
        } else {
          window.routeStart = null;
          window.routeEnd = null;
        }
        if (firstRoute) {
          console.log('[Directions] total distance (m):', totalDistanceMeters, 'search radius (m):', radiusMeters);
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
              var multiWord = [];
              var multiWordCoords = [];
              for (var i = 0; i < locs.length; i++) {
                if ((locs[i] || '').trim().split(/\s+/).length > 1) {
                  multiWord.push(locs[i]);
                  if (stepCoords[i]) multiWordCoords.push(stepCoords[i]);
                }
              }
              window.routeLocationMap = [];
              for (var j = 0; j < multiWord.length; j++) {
                window.routeLocationMap.push({
                  name: multiWord[j],
                  lat: multiWordCoords[j] ? multiWordCoords[j].lat : null,
                  lng: multiWordCoords[j] ? multiWordCoords[j].lng : null
                });
              }
              appendMessage('Route locations: ' + (multiWord.length ? multiWord.join(', ') : '(none with more than one word)'), 'assistant');
              tryFindStopsNearRoute();
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

  function addStopToRoute(place) {
    var toValue = (toInput && toInput.value || '').trim();
    if (isPlaceDestination(place, toValue)) {
      showDuplicatePopup('This is already part of your route (your destination).');
      return;
    }
    var routePlaces = getRoutePlaces();
    if (exactPlaceMatch(place, routePlaces)) {
      showDuplicatePopup('This is already in your route.');
      return;
    }
    fetch('/api/check-address-duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: (place.name || '').trim(),
        address: (place.formatted_address || '').trim(),
        routePlaces: routePlaces
      }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || r.statusText); });
        return r.json();
      })
      .then(function (data) {
        if (data.duplicate) {
          showDuplicatePopup('This is already in your route.');
          return;
        }
        if (!window.addedStops) window.addedStops = [];
        window.addedStops.push({
          place_id: place.place_id,
          name: place.name,
          formatted_address: place.formatted_address,
          lat: place.lat,
          lng: place.lng
        });
        if (adjustStopsSwitch && adjustStopsSwitch.checked && window.addedStops.length >= 2) {
          reorderStopsByTimeThenUpdate();
        } else {
          updateRouteWithStops();
        }
      })
      .catch(function (err) {
        console.error('[check-address-duplicate]', err);
        if (!window.addedStops) window.addedStops = [];
        window.addedStops.push({
          place_id: place.place_id,
          name: place.name,
          formatted_address: place.formatted_address,
          lat: place.lat,
          lng: place.lng
        });
        if (adjustStopsSwitch && adjustStopsSwitch.checked && window.addedStops.length >= 2) {
          reorderStopsByTimeThenUpdate();
        } else {
          updateRouteWithStops();
        }
      });
  }

  function stopToLocation(s) {
    if (s.lat != null && s.lng != null) return new google.maps.LatLng(s.lat, s.lng);
    return s.formatted_address || s.name || '';
  }

  function showReadjustingOverlay() {
    if (readjustOverlayEl) readjustOverlayEl.setAttribute('aria-hidden', 'false');
  }

  function hideReadjustingOverlay() {
    if (readjustOverlayEl) readjustOverlayEl.setAttribute('aria-hidden', 'true');
  }

  function reorderStopsByTimeThenUpdate() {
    var stops = window.addedStops;
    if (!stops || stops.length < 2) {
      updateRouteWithStops();
      return;
    }
    showReadjustingOverlay();
    updateRouteWithStops({ optimizeWaypoints: true });
  }

  function updateRouteWithStops(opts) {
    opts = opts || {};
    var from = fromInput.value.trim();
    var to = toInput.value.trim();
    if (!from || !to) return;
    if (typeof google === 'undefined' || !google.maps || !directionsService) return;
    if (!window.addedStops || !window.addedStops.length) return;
    var waypoints = window.addedStops.map(function (s) {
      var loc;
      if (s.lat != null && s.lng != null) {
        loc = new google.maps.LatLng(s.lat, s.lng);
      } else {
        loc = s.formatted_address || s.name || '';
      }
      return { location: loc, stopover: true };
    });
    var request = { origin: from, destination: to, waypoints: waypoints, travelMode: google.maps.TravelMode.DRIVING };
    if (opts.optimizeWaypoints && waypoints.length >= 2) request.optimizeWaypoints = true;
    routePlaceholder.textContent = opts.optimizeWaypoints ? 'Optimizing stop order…' : 'Updating route with ' + window.addedStops.length + ' stop(s)…';
    directionsService.route(request, function (result, status) {
      hideReadjustingOverlay();
      if (status !== google.maps.DirectionsStatus.OK) {
        routePlaceholder.textContent = 'Could not update route: ' + (status || 'Unknown error');
        routePlaceholder.style.color = '#f85149';
        return;
      }
      routePlaceholder.style.color = '';
      routePlaceholder.textContent = '';
      var firstRoute = result.routes && result.routes[0];
      if (firstRoute && firstRoute.waypoint_order && Array.isArray(firstRoute.waypoint_order) && firstRoute.waypoint_order.length === window.addedStops.length) {
        window.addedStops = firstRoute.waypoint_order.map(function (i) { return window.addedStops[i]; });
      }
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
        directionsRenderer = new google.maps.DirectionsRenderer({ map: routeMap, suppressMarkers: false });
      }
      directionsRenderer.setDirections(result);
      if (firstRoute && firstRoute.bounds) routeMap.fitBounds(firstRoute.bounds);
      if (firstRoute && firstRoute.legs && firstRoute.legs.length) {
        var firstLeg = firstRoute.legs[0];
        var lastLeg = firstRoute.legs[firstRoute.legs.length - 1];
        if (firstLeg.steps && firstLeg.steps[0]) {
          var sl = firstLeg.steps[0].start_location;
          window.routeStart = { lat: typeof sl.lat === 'function' ? sl.lat() : sl.lat, lng: typeof sl.lng === 'function' ? sl.lng() : sl.lng };
        }
        if (lastLeg.steps && lastLeg.steps.length) {
          var el = lastLeg.steps[lastLeg.steps.length - 1].end_location;
          window.routeEnd = { lat: typeof el.lat === 'function' ? el.lat() : el.lat, lng: typeof el.lng === 'function' ? el.lng() : el.lng };
        }
      }
      updateRouteEstimate(result);
    });
  }

  function updateRouteEstimate(result) {
    if (!routeEstimateEl) return;
    var firstRoute = result && result.routes && result.routes[0];
    if (!firstRoute || !firstRoute.legs || !firstRoute.legs.length) {
      routeEstimateEl.textContent = '';
      routeEstimateEl.setAttribute('aria-hidden', 'true');
      return;
    }
    var totalDurationSec = 0;
    var totalDistanceM = 0;
    for (var i = 0; i < firstRoute.legs.length; i++) {
      var leg = firstRoute.legs[i];
      if (leg.duration && typeof leg.duration.value === 'number') totalDurationSec += leg.duration.value;
      if (leg.distance && typeof leg.distance.value === 'number') totalDistanceM += leg.distance.value;
    }
    var durationText = firstRoute.legs[0].duration && firstRoute.legs[0].duration.text;
    if (firstRoute.legs.length > 1 && totalDurationSec > 0) {
      var mins = Math.round(totalDurationSec / 60);
      durationText = mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
    }
    var distanceText = firstRoute.legs[0].distance && firstRoute.legs[0].distance.text;
    if (firstRoute.legs.length > 1 && totalDistanceM > 0) {
      if (totalDistanceM >= 1000) distanceText = (totalDistanceM / 1000).toFixed(1) + ' km';
      else distanceText = Math.round(totalDistanceM) + ' m';
    }
    routeEstimateEl.textContent = (durationText ? 'Estimated time: ' + durationText : '') + (durationText && distanceText ? ' · ' : '') + (distanceText ? distanceText : '');
    routeEstimateEl.setAttribute('aria-hidden', 'false');
  }

  function refreshRouteWithoutStops() {
    var from = fromInput.value.trim();
    var to = toInput.value.trim();
    if (!from || !to) return;
    if (typeof google === 'undefined' || !google.maps || !directionsService) return;
    routePlaceholder.textContent = 'Updating route…';
    directionsService.route(
      { origin: from, destination: to, travelMode: google.maps.TravelMode.DRIVING },
      function (result, status) {
        if (status !== google.maps.DirectionsStatus.OK) {
          routePlaceholder.textContent = 'Could not update route: ' + (status || 'Unknown error');
          routePlaceholder.style.color = '#f85149';
          return;
        }
        routePlaceholder.style.color = '';
        routePlaceholder.textContent = '';
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
          directionsRenderer = new google.maps.DirectionsRenderer({ map: routeMap, suppressMarkers: false });
        }
        directionsRenderer.setDirections(result);
        var firstRoute = result.routes && result.routes[0];
        if (firstRoute && firstRoute.bounds) routeMap.fitBounds(firstRoute.bounds);
        updateRouteEstimate(result);
      }
    );
  }

  function sendMessage() {
    var text = chatInput.value.trim();
    var from = fromInput.value.trim();
    var to = toInput.value.trim();
    console.log('[Send] clicked, chat text:', text ? text.substring(0, 50) : '(empty)');

    if (!text) {
      if (!from || !to) return;
      if (from === window.lastRouteOrigin && to === window.lastRouteDestination) return;
      window.addedStops = [];
      showRoute();
      return;
    }

    window.findPlacesRunning = false;
    showRoute();
    appendMessage(text, 'user');
    chatInput.value = '';
    var source = from;
    var destination = to;
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
        window.lastDetectedStops = stops;
        var pending = chatMessages.querySelector('[data-pending="stops"]');
        if (pending) pending.remove();
        if (stops.length) {
          appendMessage('Detected stops: ' + stops.join(', '), 'assistant');
        } else {
          appendMessage('No stops detected in your message.', 'assistant');
        }
        console.log('[detect-stops] response', data);
        tryFindStopsNearRoute();
      })
      .catch(function (err) {
        console.error('[detect-stops] fetch error:', err);
        var pending = chatMessages.querySelector('[data-pending="stops"]');
        if (pending) pending.remove();
        appendMessage('Error: ' + (err.message || 'Could not detect stops.'), 'assistant');
      });
  }

  sendBtn.addEventListener('click', sendMessage);
  clearBtn.addEventListener('click', function () {
    if (!window.addedStops || !window.addedStops.length) return;
    window.addedStops = [];
    refreshRouteWithoutStops();
  });
  if (adjustStopsSwitch) {
    adjustStopsSwitch.addEventListener('change', function () {
      if (adjustStopsSwitch.checked && window.addedStops && window.addedStops.length >= 2) {
        reorderStopsByTimeThenUpdate();
      }
    });
  }
  if (personalizeSwitch && personalizeActionsEl) {
    function syncPersonalizeActions() {
      personalizeActionsEl.setAttribute('aria-hidden', personalizeSwitch.checked ? 'false' : 'true');
    }
    syncPersonalizeActions();
    personalizeSwitch.addEventListener('change', syncPersonalizeActions);
  }
  if (duplicatePopupEl) {
    var popupClose = duplicatePopupEl.querySelector('.duplicate-popup-close');
    var popupBackdrop = duplicatePopupEl.querySelector('.duplicate-popup-backdrop');
    if (popupClose) popupClose.addEventListener('click', hideDuplicatePopup);
    if (popupBackdrop) popupBackdrop.addEventListener('click', hideDuplicatePopup);
  }
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
