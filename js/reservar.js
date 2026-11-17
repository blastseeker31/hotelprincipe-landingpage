/* Hotel Príncipe — lógica del formulario de reserva
   Anti-spam: honeypot + time trap + CSRF de un solo uso (ver server.py).
   Fechas: parseo LOCAL de YYYY-MM-DD para evitar el desfase UTC ( Honduras UTC-6 ). */
(function () {
  "use strict";

  var form = document.getElementById("reservaForm");
  if (!form) return;

  var alertBox = document.getElementById("formAlert");
  var submitBtn = document.getElementById("submitBtn");
  var submitText = document.getElementById("submitText");
  var summary = document.getElementById("staySummary");
  var msg = document.getElementById("mensaje");
  var msgCount = document.getElementById("msgCount");

  var nombre = document.getElementById("nombre");
  var telefono = document.getElementById("telefono");
  var email = document.getElementById("email");
  var llegada = document.getElementById("fecha_llegada");
  var salida = document.getElementById("fecha_salida");
  var habitaciones = document.getElementById("habitaciones");
  var huespedes = document.getElementById("huespedes");

  /* ---------- utilidades de fecha (local, no UTC) ---------- */

  function parseLocal(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  function isoLocal(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function fmtLargo(s) {
    var d = parseLocal(s);
    if (!d) return "—";
    return d.toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function nochesEntre(a, b) {
    var da = parseLocal(a), db = parseLocal(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }

  var hoy = new Date();
  llegada.min = isoLocal(hoy);
  var manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  salida.min = isoLocal(manana);

  /* ---------- time trap + CSRF ---------- */

  document.getElementById("_load_time").value = String(Date.now() / 1000);

  fetch("/api/csrf")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.token) document.getElementById("csrf_token").value = d.token;
    })
    .catch(function () { /* el servidor rechazará silenciosamente si falta token */ });

  /* ---------- teléfono: solo dígitos, guion automático ---------- */

  telefono.addEventListener("input", function () {
    var raw = this.value.replace(/[^\d]/g, "").slice(0, 8);
    this.value = raw.length > 4 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw;
  });

  /* ---------- fechas + resumen en vivo ---------- */

  function actualizarResumen() {
    var n = nochesEntre(llegada.value, salida.value);
    if (n > 0) {
      var hab = parseInt(habitaciones.value, 10);
      var hue = parseInt(huespedes.value, 10);
      summary.innerHTML =
        '<span class="summary-line">' + n + (n === 1 ? " noche" : " noches") + " · " +
        hab + (hab === 1 ? " habitación" : " habitaciones") + " · " +
        hue + (hue === 1 ? " huésped" : " huéspedes") + "</span>" +
        '<span class="summary-deposit">Depósito del 50% para confirmar · saldo al llegar</span>';
      summary.classList.add("visible");
    } else {
      summary.classList.remove("visible");
    }
  }

  llegada.addEventListener("change", function () {
    var d = parseLocal(llegada.value);
    if (d) {
      var min = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      salida.min = isoLocal(min);
      if (salida.value && nochesEntre(llegada.value, salida.value) <= 0) salida.value = "";
    }
    actualizarResumen();
  });
  salida.addEventListener("change", actualizarResumen);
  habitaciones.addEventListener("change", actualizarResumen);
  huespedes.addEventListener("change", actualizarResumen);

  msg.addEventListener("input", function () {
    msgCount.textContent = String(this.value.length);
  });

  /* ---------- validación en cliente ---------- */

  var NOMBRE_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\. ]{3,100}$/;
  var TEL_RE = /^\d{4}-\d{4}$/;
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

  function setError(input, msg) {
    var err = document.getElementById("err-" + input.id);
    if (msg) {
      input.setAttribute("aria-invalid", "true");
      if (err) err.textContent = msg;
    } else {
      input.removeAttribute("aria-invalid");
      if (err) err.textContent = "";
    }
  }

  function validar() {
    var ok = true;
    var v = nombre.value.trim().replace(/\s{2,}/g, " ");
    if (!NOMBRE_RE.test(v)) { setError(nombre, "Ingrese su nombre completo (solo letras, entre 3 y 100 caracteres)."); ok = false; }
    else setError(nombre, "");

    if (!TEL_RE.test(telefono.value)) { setError(telefono, "Formato: 0000-0000."); ok = false; }
    else setError(telefono, "");

    if (email.value.trim() && !EMAIL_RE.test(email.value.trim())) { setError(email, "Correo no válido."); ok = false; }
    else setError(email, "");

    if (!llegada.value) { setError(llegada, "Seleccione su fecha de llegada."); ok = false; }
    else if (llegada.value < isoLocal(hoy)) { setError(llegada, "La llegada no puede ser anterior a hoy."); ok = false; }
    else setError(llegada, "");

    if (!salida.value) { setError(salida, "Seleccione su fecha de salida."); ok = false; }
    else if (nochesEntre(llegada.value, salida.value) <= 0) { setError(salida, "Debe ser posterior a la llegada."); ok = false; }
    else if (nochesEntre(llegada.value, salida.value) > 30) { setError(salida, "Máximo 30 noches. Para estadías más largas, contáctenos."); ok = false; }
    else setError(salida, "");

    return ok;
  }

  [nombre, telefono, email, llegada, salida].forEach(function (el) {
    el.addEventListener("blur", function () {
      if (el.value) validar();
    });
  });

  function showAlert(text) {
    alertBox.textContent = text;
    alertBox.classList.add("visible");
    alertBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function hideAlert() { alertBox.classList.remove("visible"); }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitText.textContent = on ? "Enviando…" : "Enviar solicitud";
    var sp = submitBtn.querySelector(".spinner");
    if (on && !sp) {
      sp = document.createElement("span");
      sp.className = "spinner";
      sp.setAttribute("aria-hidden", "true");
      submitBtn.appendChild(sp);
    } else if (!on && sp) {
      sp.remove();
    }
  }

  /* ---------- envío ---------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideAlert();
    if (!validar()) return;

    var payload = {
      nombre: nombre.value.trim().replace(/\s{2,}/g, " "),
      telefono: telefono.value,
      email: email.value.trim(),
      fecha_llegada: llegada.value,
      fecha_salida: salida.value,
      habitaciones: parseInt(habitaciones.value, 10),
      huespedes: parseInt(huespedes.value, 10),
      mensaje: msg.value.trim(),
      website: document.getElementById("website").value,
      _load_time: document.getElementById("_load_time").value,
      csrf_token: document.getElementById("csrf_token").value
    };

    setLoading(true);
    fetch("/api/reservas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        setLoading(false);
        var d = res.data || {};
        if (d.ok && d.codigo) {
          mostrarExito(d);
        } else if (d.ok) {
          // Respuesta genérica (anti-spam): no hay código que mostrar.
          showAlert("Solicitud recibida. El hotel le contactará para confirmar.");
          form.reset();
          document.getElementById("_load_time").value = String(Date.now() / 1000);
          summary.classList.remove("visible");
        } else {
          showAlert(d.error || "No se pudo enviar la solicitud. Intente de nuevo o llámenos al +504 2443-0516.");
        }
      })
      .catch(function () {
        setLoading(false);
        showAlert("No se pudo conectar con el servidor. Verifique su conexión e intente de nuevo, o llámenos al +504 2443-0516.");
      });
  });

  /* ---------- panel de éxito ---------- */

  function mostrarExito(d) {
    form.style.display = "none";
    var panel = document.getElementById("successPanel");
    document.getElementById("successCode").textContent = d.codigo;
    document.getElementById("okNombre").textContent = d.nombre;
    document.getElementById("okLlegada").textContent = fmtLargo(d.fecha_llegada);
    document.getElementById("okSalida").textContent = fmtLargo(d.fecha_salida);
    document.getElementById("okNoches").textContent = d.noches + (d.noches === 1 ? " noche" : " noches");
    document.getElementById("okHabitaciones").textContent = String(d.habitaciones);
    document.getElementById("okHuespedes").textContent = String(d.huespedes);

    var texto = "Hola, envié una solicitud de reserva en la página web del Hotel Príncipe.\n" +
      "Código: " + d.codigo + "\n" +
      "Nombre: " + d.nombre + "\n" +
      "Llegada: " + d.fecha_llegada + " · Salida: " + d.fecha_salida + " (" + d.noches + " noches)\n" +
      "Habitaciones: " + d.habitaciones + " · Huéspedes: " + d.huespedes + "\n" +
      "Quedo atento a la confirmación y al detalle del depósito del 50%. Gracias.";
    document.getElementById("successWa").href = "https://wa.me/50494519992?text=" + encodeURIComponent(texto);

    panel.classList.add("visible");
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.getElementById("nuevaBtn").addEventListener("click", function () {
    window.location.reload();
  });
})();
