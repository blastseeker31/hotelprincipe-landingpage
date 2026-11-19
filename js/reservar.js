/* Reservar — flujo conserje premium. Contrato API intacto:
   POST /api/reservas {nombre, telefono, email, fecha_llegada, fecha_salida,
   habitaciones, huespedes, mensaje, website, _load_time, csrf_token}
   Anti-spam: honeypot + time-trap + CSRF fresco al enviar. Sin precios. */
(function () {
  "use strict";

  var form = document.getElementById("reservaForm");
  if (!form) return;

  /* ---------- fechas (medianoche LOCAL, Honduras UTC-6 fijo) ---------- */
  function parseLocal(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  function isoLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtLargo(s) {
    var d = parseLocal(s);
    if (!d) return "—";
    return new Intl.DateTimeFormat("es-HN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  }
  function fmtMedio(s) {
    var d = parseLocal(s);
    if (!d) return "—";
    return new Intl.DateTimeFormat("es-HN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
  }
  function nochesEntre(a, b) {
    var da = parseLocal(a), db = parseLocal(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }

  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var DOW = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
  var MAX_NOCHES = 30;

  /* ---------- estado ---------- */
  var state = {
    step: 1, maxStep: 1,
    llegada: "", salida: "",
    habitaciones: 1, huespedes: 1,
    tipo: "", hora: "", celebracion: ""
  };

  /* ---------- refs ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var nombre = $("nombre"), telefono = $("telefono"), email = $("email"), peticiones = $("peticiones");
  var llegadaIn = $("fecha_llegada"), salidaIn = $("fecha_salida");
  var habIn = $("habitaciones"), hueIn = $("huespedes");
  var alertBox = $("bkAlert");
  var submitBtn = $("submitBtn"), submitText = $("submitText");
  var flow = $("bkFlow"), progress = $("bkProgress"), confirm = $("bkConfirm");

  /* ---------- calendario ---------- */
  var viewY = hoy.getFullYear(), viewM = hoy.getMonth();
  var calTitle = $("bkCalTitle"), calGrid = $("bkCalGrid"), calPrev = $("bkCalPrev"), calNext = $("bkCalNext");
  var calHint = $("bkCalHint");

  function renderCal() {
    calTitle.textContent = MESES[viewM] + " " + viewY;
    var first = new Date(viewY, viewM, 1);
    var offset = (first.getDay() + 6) % 7; // lunes primero
    var days = new Date(viewY, viewM + 1, 0).getDate();
    var html = "";
    DOW.forEach(function (d) { html += '<span class="bk-cal-dow">' + d + "</span>"; });
    for (var i = 0; i < offset; i++) html += '<span class="bk-day empty"></span>';
    var dl = parseLocal(state.llegada), ds = parseLocal(state.salida);
    for (var day = 1; day <= days; day++) {
      var d = new Date(viewY, viewM, day);
      var iso = isoLocal(d);
      var cls = "bk-day";
      var dis = d < hoy;
      if (iso === isoLocal(hoy)) cls += " today";
      if (dl && iso === state.llegada) cls += " sel-start";
      if (ds && iso === state.salida) cls += " sel-end";
      if (dl && ds && d > dl && d < ds) cls += " in-range";
      html += '<button type="button" class="' + cls + '" data-iso="' + iso + '"' + (dis ? " disabled" : "") +
        ' aria-label="' + fmtLargo(iso) + '">' + day + "</button>";
    }
    calGrid.innerHTML = html;
    calPrev.disabled = (viewY === hoy.getFullYear() && viewM === hoy.getMonth());
    var maxView = new Date(hoy.getFullYear(), hoy.getMonth() + 18, 1);
    calNext.disabled = (new Date(viewY, viewM, 1) >= maxView);
  }

  calPrev.addEventListener("click", function () { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderCal(); });
  calNext.addEventListener("click", function () { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderCal(); });

  calGrid.addEventListener("click", function (e) {
    var btn = e.target.closest(".bk-day");
    if (!btn || btn.disabled || btn.classList.contains("empty")) return;
    var iso = btn.getAttribute("data-iso");
    var d = parseLocal(iso);
    calHint.textContent = ""; calHint.classList.remove("err");
    if (!state.llegada || (state.llegada && state.salida)) {
      state.llegada = iso; state.salida = "";
    } else if (d > parseLocal(state.llegada)) {
      if (nochesEntre(state.llegada, iso) > MAX_NOCHES) {
        calHint.textContent = "La estadía máxima es de 30 noches. Elija una salida más cercana o contáctenos.";
        calHint.classList.add("err");
        return;
      }
      state.salida = iso;
    } else {
      state.llegada = iso; state.salida = "";
    }
    syncDates(); renderCal(); updateRail();
  });

  function syncDates() {
    llegadaIn.value = state.llegada;
    salidaIn.value = state.salida;
    $("bkValLlegada").textContent = state.llegada ? fmtMedio(state.llegada) : "Por elegir";
    $("bkValSalida").textContent = state.salida ? fmtMedio(state.salida) : "Por elegir";
    $("bkBoxLlegada").classList.toggle("set", !!state.llegada);
    $("bkBoxSalida").classList.toggle("set", !!state.salida);
    var n = nochesEntre(state.llegada, state.salida);
    $("bkNights").textContent = n > 0 ? n + (n === 1 ? " noche" : " noches") : (state.llegada ? "Elija la salida" : "");
  }

  /* ---------- steppers ---------- */
  function setupCounter(key, min, max, unitS, unitP) {
    var wrap = document.querySelector('[data-counter="' + key + '"]');
    var valEl = wrap.querySelector(".bk-step-val");
    var minus = wrap.querySelector('[data-dir="-1"]'), plus = wrap.querySelector('[data-dir="1"]');
    function paint() {
      var v = state[key];
      valEl.innerHTML = v + "<small>" + (v === 1 ? unitS : unitP) + "</small>";
      minus.disabled = v <= min; plus.disabled = v >= max;
      (key === "habitaciones" ? habIn : hueIn).value = v;
    }
    minus.addEventListener("click", function () { if (state[key] > min) { state[key]--; paint(); updateRail(); } });
    plus.addEventListener("click", function () { if (state[key] < max) { state[key]++; paint(); updateRail(); } });
    paint();
  }
  setupCounter("habitaciones", 1, 4, "habitación", "habitaciones");
  setupCounter("huespedes", 1, 12, "huésped", "huéspedes");

  /* ---------- habitaciones (radio tipográfico) ---------- */
  var roomBtns = Array.prototype.slice.call(document.querySelectorAll(".bk-room"));
  function selectRoom(btn) {
    roomBtns.forEach(function (b) { b.setAttribute("aria-checked", b === btn ? "true" : "false"); });
    state.tipo = btn.getAttribute("data-room") || "";
    updateRail();
  }
  roomBtns.forEach(function (btn, idx) {
    btn.addEventListener("click", function () { selectRoom(btn); });
    btn.addEventListener("keydown", function (e) {
      var dir = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0;
      if (dir) {
        e.preventDefault();
        var next = roomBtns[(idx + dir + roomBtns.length) % roomBtns.length];
        next.focus(); selectRoom(next);
      }
    });
  });

  /* ---------- chips (hora / celebración) ---------- */
  document.querySelectorAll(".bk-chips").forEach(function (group) {
    var key = group.getAttribute("data-chips");
    group.querySelectorAll(".bk-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var on = chip.getAttribute("aria-pressed") === "true";
        group.querySelectorAll(".bk-chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
        if (!on) { chip.setAttribute("aria-pressed", "true"); state[key] = chip.getAttribute("data-value"); }
        else { state[key] = ""; }
        updateRail();
      });
    });
  });

  /* ---------- teléfono + contador ---------- */
  telefono.addEventListener("input", function () {
    var raw = this.value.replace(/[^\d]/g, "").slice(0, 8);
    this.value = raw.length > 4 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw;
  });
  peticiones.addEventListener("input", function () { $("petCount").textContent = String(this.value.length); });

  /* ---------- resumen en vivo (rail) ---------- */
  function updateRail() {
    var n = nochesEntre(state.llegada, state.salida);
    var nightsEl = $("bkSumNights");
    nightsEl.innerHTML = n > 0 ? n + "<small>" + (n === 1 ? "noche" : "noches") + "</small>" : "—<small>noches</small>";
    $("bkSumLlegada").textContent = state.llegada ? fmtMedio(state.llegada) : "—";
    $("bkSumSalida").textContent = state.salida ? fmtMedio(state.salida) : "—";
    $("bkSumHab").textContent = state.habitaciones + (state.habitaciones === 1 ? " habitación" : " habitaciones");
    $("bkSumHue").textContent = state.huespedes + (state.huespedes === 1 ? " huésped" : " huéspedes");
    $("bkSumTipo").textContent = state.tipo || "Sin preferencia";
  }

  /* ---------- validación ---------- */
  var NOMBRE_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\. ]{3,100}$/;
  var TEL_RE = /^\d{4}-\d{4}$/;
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

  function setError(input, msg) {
    var err = document.getElementById("err-" + input.id);
    if (msg) { input.setAttribute("aria-invalid", "true"); if (err) err.textContent = msg; }
    else { input.removeAttribute("aria-invalid"); if (err) err.textContent = ""; }
  }
  function validarDatos() {
    var ok = true;
    var v = nombre.value.trim().replace(/\s{2,}/g, " ");
    if (!NOMBRE_RE.test(v)) { setError(nombre, "Ingrese su nombre completo (solo letras, entre 3 y 100 caracteres)."); ok = false; }
    else setError(nombre, "");
    if (!TEL_RE.test(telefono.value)) { setError(telefono, "Formato: 0000-0000."); ok = false; }
    else setError(telefono, "");
    if (email.value.trim() && !EMAIL_RE.test(email.value.trim())) { setError(email, "Correo no válido."); ok = false; }
    else setError(email, "");
    return ok;
  }
  function validarFechas() {
    if (!state.llegada) { calHint.textContent = "Seleccione su fecha de llegada."; calHint.classList.add("err"); return false; }
    if (state.llegada < isoLocal(hoy)) { calHint.textContent = "La llegada no puede ser anterior a hoy."; calHint.classList.add("err"); return false; }
    if (!state.salida) { calHint.textContent = "Seleccione su fecha de salida."; calHint.classList.add("err"); return false; }
    var n = nochesEntre(state.llegada, state.salida);
    if (n <= 0) { calHint.textContent = "La salida debe ser posterior a la llegada."; calHint.classList.add("err"); return false; }
    if (n > MAX_NOCHES) { calHint.textContent = "Máximo 30 noches. Para estadías más largas, contáctenos."; calHint.classList.add("err"); return false; }
    calHint.textContent = ""; calHint.classList.remove("err");
    return true;
  }
  [nombre, telefono, email].forEach(function (el) {
    el.addEventListener("blur", function () { if (el.value) validarDatos(); });
  });

  /* ---------- pasos ---------- */
  var steps = Array.prototype.slice.call(document.querySelectorAll(".bk-step"));
  var progItems = Array.prototype.slice.call(progress.querySelectorAll("li"));
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  function showStep(n, scroll) {
    state.step = n;
    state.maxStep = Math.max(state.maxStep, n);
    steps.forEach(function (s) { s.classList.toggle("active", +s.getAttribute("data-step") === n); });
    progItems.forEach(function (li, i) {
      var sn = i + 1;
      li.classList.toggle("active", sn === n);
      li.classList.toggle("done", sn < n);
      li.querySelector(".bk-pnum").innerHTML = sn < n ? CHECK : String(sn).padStart(2, "0");
      var btn = li.querySelector(".bk-pbtn");
      btn.disabled = sn > state.maxStep;
      btn.setAttribute("aria-current", sn === n ? "step" : "false");
    });
    hideAlert();
    var head = steps[n - 1] && steps[n - 1].querySelector("h2");
    if (head) { head.setAttribute("tabindex", "-1"); head.focus({ preventScroll: true }); }
    if (scroll) flow.scrollIntoView({ behavior: "smooth", block: "start" });
    updateRail();
  }

  progItems.forEach(function (li, i) {
    li.querySelector(".bk-pbtn").addEventListener("click", function () {
      var sn = i + 1;
      if (sn <= state.maxStep && sn !== state.step) showStep(sn, true);
    });
  });
  document.querySelectorAll("[data-next]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var ok = state.step === 1 ? validarFechas() : true;
      if (ok) showStep(state.step + 1, true);
      else flow.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll("[data-prev]").forEach(function (btn) {
    btn.addEventListener("click", function () { showStep(state.step - 1, true); });
  });

  /* ---------- alerta / loading ---------- */
  function showAlert(text) { alertBox.textContent = text; alertBox.classList.add("visible"); alertBox.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function hideAlert() { alertBox.classList.remove("visible"); }
  function setLoading(on) {
    submitBtn.disabled = on;
    submitText.textContent = on ? "Enviando…" : "Enviar solicitud";
    var sp = submitBtn.querySelector(".spinner");
    if (on && !sp) { sp = document.createElement("span"); sp.className = "spinner"; sp.setAttribute("aria-hidden", "true"); submitBtn.appendChild(sp); }
    else if (!on && sp) sp.remove();
  }

  /* ---------- envío ---------- */
  function componerMensaje() {
    var parts = [];
    if (state.tipo) parts.push("Habitación preferida: " + state.tipo);
    if (state.hora) parts.push("Hora de llegada aprox.: " + state.hora);
    if (state.celebracion) parts.push("Celebración: " + state.celebracion);
    var pet = peticiones.value.trim();
    if (pet) parts.push("Peticiones: " + pet);
    return parts.join("\n").slice(0, 500);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideAlert();
    if (!validarFechas()) { showStep(1, true); return; }
    if (!validarDatos()) return;

    var payload = {
      nombre: nombre.value.trim().replace(/\s{2,}/g, " "),
      telefono: telefono.value,
      email: email.value.trim(),
      fecha_llegada: state.llegada,
      fecha_salida: state.salida,
      habitaciones: state.habitaciones,
      huespedes: state.huespedes,
      mensaje: componerMensaje(),
      website: $("website").value,
      _load_time: $("_load_time").value,
      csrf_token: ""
    };

    setLoading(true);
    // CSRF fresco: el flujo puede durar varios minutos y el token caduca a los 10.
    fetch("/api/csrf").then(function (r) { return r.json(); }).then(function (c) {
      payload.csrf_token = (c && c.token) || "";
      return fetch("/api/reservas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        setLoading(false);
        var d = res.data || {};
        if (d.ok && d.codigo) mostrarExito(d);
        else if (d.ok) { showAlert("Solicitud recibida. El hotel le contactará para confirmar."); resetFlow(); }
        else showAlert(d.error || "No se pudo enviar la solicitud. Intente de nuevo o llámenos al +504 2443-0516.");
      })
      .catch(function () {
        setLoading(false);
        showAlert("No se pudo conectar con el servidor. Verifique su conexión e intente de nuevo, o llámenos al +504 2443-0516.");
      });
  });

  function resetFlow() {
    form.reset();
    state.llegada = ""; state.salida = ""; state.tipo = ""; state.hora = ""; state.celebracion = "";
    state.habitaciones = 1; state.huespedes = 1; state.maxStep = 1;
    $("_load_time").value = String(Date.now() / 1000);
    roomBtns.forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-room") === "" ? "true" : "false"); });
    document.querySelectorAll(".bk-chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
    syncDates(); renderCal(); showStep(1, false);
  }

  /* ---------- confirmación ---------- */
  function mostrarExito(d) {
    form.style.display = "none";
    progress.style.display = "none";
    var rail = $("bkRail"); if (rail) rail.style.display = "none";
    var lay = document.querySelector(".bk-layout"); if (lay) lay.style.gridTemplateColumns = "1fr";
    var head = document.querySelector(".bk-head"); if (head) head.style.display = "none";
    $("bkConfirmCode").textContent = d.codigo;
    $("bkOkNombre").textContent = d.nombre;
    $("bkOkLlegada").textContent = fmtLargo(d.fecha_llegada);
    $("bkOkSalida").textContent = fmtLargo(d.fecha_salida);
    $("bkOkNoches").textContent = d.noches + (d.noches === 1 ? " noche" : " noches");
    $("bkOkHab").textContent = String(d.habitaciones);
    $("bkOkHue").textContent = String(d.huespedes);
    $("bkOkTipo").textContent = state.tipo || "Sin preferencia";
    $("bkConfirmLede").textContent = "¡Listo, " + d.nombre.split(" ")[0] + "! Su solicitud está en recepción. Le escribimos por WhatsApp o le llamamos para confirmar disponibilidad y el detalle de su estadía.";

    var texto = "Hola, envié una solicitud de reserva en la página web del Hotel Príncipe.\n" +
      "Código: " + d.codigo + "\nNombre: " + d.nombre + "\n" +
      "Llegada: " + d.fecha_llegada + " · Salida: " + d.fecha_salida + " (" + d.noches + " noches)\n" +
      "Habitaciones: " + d.habitaciones + " · Huéspedes: " + d.huespedes +
      (state.tipo ? "\nHabitación preferida: " + state.tipo : "") +
      "\nQuedo atento a la confirmación y al detalle del depósito del 50%. Gracias.";
    $("bkConfirmWa").href = "https://wa.me/50494519992?text=" + encodeURIComponent(texto);

    confirm.classList.add("visible");
    confirm.scrollIntoView({ behavior: "smooth", block: "start" });
    var ttl = $("bkConfirmTitle"); ttl.setAttribute("tabindex", "-1"); ttl.focus({ preventScroll: true });
  }

  $("bkNuevaBtn").addEventListener("click", function () { window.location.reload(); });

  /* ---------- init ---------- */
  $("_load_time").value = String(Date.now() / 1000);
  syncDates(); renderCal(); updateRail(); showStep(1, false);
})();