/**
 * Runtime bootstrap injected into every sketch-layer iframe before the
 * model-authored HTML. Exposes a small global API the sketch can use to
 * declare knobs and read/write shared state, all routed through the same
 * `screenplay:*` postMessage protocol the dev-server iframe-layer uses.
 *
 * The bootstrap is plain ES5-friendly JS (no transpile step at runtime) and
 * communicates with the parent canvas via `window.parent.postMessage`. It
 * doesn't depend on the `@screenplay.space/knobs` or `@screenplay.space/state`
 * npm packages — those are React-hook flavoured and meant for dev-server
 * iframe-layer projects; sketches are plain HTML+JS, so we ship an
 * imperative twin here.
 *
 * Public surface (on `window.screenplay`):
 *   - `knob(def) → currentValue`   — declare a knob, returns its current value.
 *   - `onKnob(id, fn)`              — subscribe to value changes.
 *   - `getKnob(id)`                 — current value without subscribing.
 *   - `state.get(key)`              — current shared-state value (or undefined).
 *   - `state.set(key, value)`       — publish a change.
 *   - `state.subscribe(key, fn)`    — react to remote/local changes.
 *
 * Knob declarations are coalesced into a single `screenplay:knobs-declared`
 * message per microtask so a sketch declaring a dozen knobs only causes one
 * round-trip to the parent.
 */
export const SKETCH_RUNTIME_BOOTSTRAP = `<script>
(function () {
  if (window.screenplay) return;
  var parent = window.parent;
  function post(msg) { try { parent.postMessage(msg, "*"); } catch (e) {} }

  // --- Knobs ---------------------------------------------------------------
  var knobDefs = Object.create(null);          // id -> declaration
  var knobValues = Object.create(null);        // id -> current value
  var knobOrder = [];                          // declaration order
  var knobSubs = Object.create(null);          // id -> Set<fn>
  var publishScheduled = false;

  function publishDeclarations() {
    publishScheduled = false;
    var out = [];
    for (var i = 0; i < knobOrder.length; i++) {
      var id = knobOrder[i];
      if (knobDefs[id]) out.push(knobDefs[id]);
    }
    post({ type: "screenplay:knobs-declared", knobs: out });
  }

  function scheduleDeclarations() {
    if (publishScheduled) return;
    publishScheduled = true;
    Promise.resolve().then(publishDeclarations);
  }

  function declareKnob(def) {
    if (!def || typeof def.id !== "string") {
      throw new Error("screenplay.knob requires { id, type, ... }");
    }
    var existing = knobDefs[def.id];
    knobDefs[def.id] = def;
    if (!existing) {
      knobOrder.push(def.id);
      // Seed the local value with the declaration's default so the first
      // read after declaring returns something sensible even before the
      // parent sends back a stored value.
      if (!(def.id in knobValues) && "default" in def) {
        knobValues[def.id] = def["default"];
      }
    }
    scheduleDeclarations();
    return knobValues[def.id];
  }

  function applyKnobValues(values) {
    if (!values || typeof values !== "object") return;
    for (var id in values) {
      if (!Object.prototype.hasOwnProperty.call(values, id)) continue;
      knobValues[id] = values[id];
      var subs = knobSubs[id];
      if (subs) subs.forEach(function (fn) { try { fn(values[id]); } catch (e) {} });
    }
  }

  function onKnob(id, fn) {
    if (!knobSubs[id]) knobSubs[id] = new Set();
    knobSubs[id].add(fn);
    return function () { knobSubs[id] && knobSubs[id].delete(fn); };
  }

  // --- Shared state --------------------------------------------------------
  var sharedState = Object.create(null);
  var sharedSubs = Object.create(null);        // key -> Set<fn>
  var publishSharedScheduled = false;
  // Suppress the next outgoing publish for a key when its update came from
  // a parent broadcast (otherwise we'd echo our own remote update back).
  var suppressNextPublish = Object.create(null);

  function schedulePublishShared() {
    if (publishSharedScheduled) return;
    publishSharedScheduled = true;
    Promise.resolve().then(function () {
      publishSharedScheduled = false;
      var snapshot = {};
      for (var k in sharedState) {
        if (Object.prototype.hasOwnProperty.call(sharedState, k)) {
          snapshot[k] = sharedState[k];
        }
      }
      post({ type: "screenplay:shared-state", state: snapshot });
    });
  }

  function setShared(key, value) {
    if (typeof key !== "string") throw new Error("screenplay.state.set: key must be a string");
    var prev = sharedState[key];
    var same;
    try { same = JSON.stringify(prev) === JSON.stringify(value); } catch (e) { same = false; }
    if (same) return;
    sharedState[key] = value;
    var subs = sharedSubs[key];
    if (subs) subs.forEach(function (fn) { try { fn(value); } catch (e) {} });
    if (suppressNextPublish[key]) { suppressNextPublish[key] = false; return; }
    schedulePublishShared();
  }

  function applySharedState(next) {
    if (!next || typeof next !== "object") return;
    var keys = {};
    for (var k in next) if (Object.prototype.hasOwnProperty.call(next, k)) keys[k] = true;
    for (var existing in sharedState) keys[existing] = true;
    for (var key in keys) {
      var nv = next[key];
      var pv = sharedState[key];
      var same;
      try { same = JSON.stringify(pv) === JSON.stringify(nv); } catch (e) { same = false; }
      if (same) continue;
      suppressNextPublish[key] = true;
      if (nv === undefined) delete sharedState[key];
      else sharedState[key] = nv;
      var subs = sharedSubs[key];
      if (subs) subs.forEach(function (fn) { try { fn(nv); } catch (e) {} });
    }
  }

  function subscribeShared(key, fn) {
    if (!sharedSubs[key]) sharedSubs[key] = new Set();
    sharedSubs[key].add(fn);
    return function () { sharedSubs[key] && sharedSubs[key].delete(fn); };
  }

  // --- Wire up -------------------------------------------------------------
  window.addEventListener("message", function (e) {
    var data = e && e.data;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "screenplay:knob-values") applyKnobValues(data.values);
    else if (data.type === "screenplay:shared-state-apply") applySharedState(data.state);
  });

  window.screenplay = {
    knob: declareKnob,
    onKnob: onKnob,
    getKnob: function (id) { return knobValues[id]; },
    state: {
      get: function (key) { return sharedState[key]; },
      set: setShared,
      subscribe: subscribeShared,
    },
  };

  // Tell the parent we're ready so it sends down the initial knob values
  // and shared state.
  post({ type: "screenplay:ready", version: "sketch-runtime-1" });
})();
</script>
`
