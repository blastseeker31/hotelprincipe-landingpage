/* Hotel Príncipe — panel de administración de reservas
   API: GET /api/admin/reservas?key=...  → {ok, reservas[], conteo{}}
        POST /api/admin/reservas/estado  → {key, codigo, estado} */
(function () {
  "use strict";

  var gate = document.getElementById("gate");
  var shell = document.getElementById("shell");
  var gateForm = document.getElementById("gateForm");
  var gateAlert = document.getElementById("gateAlert");
  var keyInput = document.getElementById("adminKey");
  var chipsEl = document.getElementById("chips");
  var listEl = document.getElementById("list");
  var toastEl = document.getElementById("toast");

  var KEY_STORAGE = "hp_admin_key";
  var ESTADOS = ["pendiente", "confirmada", "cancelada"];
  var state = { key: sessionStorage.getItem(KEY_STORAGE) || "", filtro: "todas", reservas: [], conteo: {} };
  var toastTimer = null;

  /* ---------- utilidades ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function parseLocal(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null;
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function fmtFecha(s) {
    var d = parseLocal(s);
    return d ? d.toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric" }) : esc(s);
  }
  function fmtCreado(s) {
    if (!s) return "";
    var d = new Date(String(s).replace(" ", "T"));
    if (isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric" }) +
      ", " + d.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
  }
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!isError);
    toastEl.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("visible"); }, 3200);
  }
  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (d) { return { status: r.status, data: d }; });
    });
  }

  /* ---------- acceso ---------- */

  gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var k = keyInput.value.trim();
    if (!k) return;
    gateAlert.classList.remove("visible");
    api("/api/admin/reservas?key=" + encodeURIComponent(k))
      .then(function (res) {
        if (res.data && res.data.ok) {
          state.key = k;
          sessionStorage.setItem(KEY_STORAGE, k);
          state.reservas = res.data.reservas || [];
          state.conteo = res.data.conteo || {};
          entrar();
        } else {
          gateAlert.textContent = (res.data && res.data.error) || "No se pudo verificar la llave.";
          gateAlert.classList.add("visible");
        }
      })
      .catch(function () {
        gateAlert.textContent = "No se pudo conectar con el servidor.";
        gateAlert.classList.add("visible");
      });
  });

  function entrar() {
    gate.hidden = true;
    shell.hidden = false;
    render();
  }

  document.getElementById("logoutBtn").addEventListener("click", function () {
    sessionStorage.removeItem(KEY_STORAGE);
    state.key = "";
    keyInput.value = "";
    shell.hidden = true;
    gate.hidden = false;
  });

  document.getElementById("refreshBtn").addEventListener("click", function () { cargar(true); });

  /* ---------- datos ---------- */

  function cargar(manual) {
    if (!state.key) return;
    api("/api/admin/reservas?key=" + encodeURIComponent(state.key))
      .then(function (res) {
        if (res.data && res.data.ok) {
          state.reservas = res.data.reservas || [];
          state.conteo = res.data.conteo || {};
          render();
          if (manual) toast("Lista actualizada.");
        } else if (res.status === 401) {
          sessionStorage.removeItem(KEY_STORAGE);
          state.key = "";
          shell.hidden = true;
          gate.hidden = false;
          gateAlert.textContent = "La sesión expiró. Ingrese la llave de nuevo.";
          gateAlert.classList.add("visible");
        } else if (manual) {
          toast((res.data && res.data.error) || "Error al actualizar.", true);
        }
      })
      .catch(function () { if (manual) toast("Sin conexión con el servidor.", true); });
  }

  setInterval(function () {
    if (!shell.hidden && document.visibilityState === "visible") cargar(false);
  }, 60000);

  /* ---------- render ---------- */

  function render() {
    var total = ESTADOS.reduce(function (a, e) { return a + (state.conteo[e] || 0); }, 0);
    var defs = [
      { id: "todas", label: "Todas", n: total },
      { id: "pendiente", label: "Pendientes", n: state.conteo.pendiente || 0 },
      { id: "confirmada", label: "Confirmadas", n: state.conteo.confirmada || 0 },
      { id: "cancelada", label: "Canceladas", n: state.conteo.cancelada || 0 }
    ];
    chipsEl.innerHTML = defs.map(function (d) {
      return '<button class="chip' + (state.filtro === d.id ? " active" : "") + '" data-filtro="' + d.id + '" role="tab" aria-selected="' + (state.filtro === d.id) + '">' +
        d.label + '<span class="n">' + d.n + "</span></button>";
    }).join("");

    var items = state.reservas.filter(function (r) {
      return state.filtro === "todas" || r.estado === state.filtro;
    });

    if (!items.length) {
      listEl.innerHTML = '<div class="admin-empty">No hay reservas en esta vista.</div>';
      return;
    }
    listEl.innerHTML = items.map(cardHTML).join("");
  }

  function cardHTML(r) {
    var tel = String(r.telefono || "").replace(/[^\d]/g, "");
    var wa = "https://wa.me/504" + tel + "?text=" + encodeURIComponent(
      "Hola " + r.nombre + ", le contactamos del Hotel Príncipe sobre su solicitud de reserva " + r.codigo +
      " (llegada " + r.fecha_llegada + ", salida " + r.fecha_salida + ").");
    var acciones = "";
    if (r.estado === "pendiente") {
      acciones = btnEstado(r.codigo, "confirmada", "Confirmar", "btn-confirm") +
                 btnEstado(r.codigo, "cancelada", "Cancelar", "btn-cancel");
    } else if (r.estado === "confirmada") {
      acciones = btnEstado(r.codigo, "cancelada", "Cancelar", "btn-cancel") +
                 btnEstado(r.codigo, "pendiente", "Reabrir", "btn-cancel");
    } else {
      acciones = btnEstado(r.codigo, "pendiente", "Reabrir", "btn-confirm");
    }

    return '<article class="reserva-card estado-' + esc(r.estado) + '">' +
      '<div class="reserva-head">' +
        '<span class="reserva-codigo">' + esc(r.codigo) + "</span>" +
        '<span class="reserva-fecha">Recibida: ' + fmtCreado(r.created_at) + "</span>" +
      "</div>" +
      '<div class="reserva-nombre">' + esc(r.nombre) + "</div>" +
      '<div class="reserva-meta">' +
        "<span><strong>" + fmtFecha(r.fecha_llegada) + "</strong> → <strong>" + fmtFecha(r.fecha_salida) + "</strong> · " + r.noches + (r.noches === 1 ? " noche" : " noches") + "</span>" +
        "<span>" + r.habitaciones + (r.habitaciones === 1 ? " habitación" : " habitaciones") + " · " + r.huespedes + (r.huespedes === 1 ? " huésped" : " huéspedes") + "</span>" +
      "</div>" +
      '<div class="reserva-meta">' +
        '<span>Tel: <a href="tel:+504' + tel + '">+504 ' + esc(r.telefono) + "</a> · <a href=\"" + wa + "\" target=\"_blank\" rel=\"noopener noreferrer\">WhatsApp</a></span>" +
        (r.email ? "<span>" + esc(r.email) + "</span>" : "") +
      "</div>" +
      (r.mensaje ? '<p class="reserva-mensaje">“' + esc(r.mensaje) + '”</p>' : "") +
      '<div class="reserva-actions">' +
        '<span class="estado-tag ' + esc(r.estado) + '">' + esc(r.estado) + "</span>" +
        acciones +
      "</div>" +
    "</article>";
  }

  function btnEstado(codigo, estado, label, cls) {
    return '<button class="btn btn-small ' + cls + '" data-codigo="' + esc(codigo) + '" data-estado="' + estado + '">' + label + "</button>";
  }

  /* ---------- interacciones ---------- */

  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-filtro]");
    if (!b) return;
    state.filtro = b.getAttribute("data-filtro");
    render();
  });

  listEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-codigo]");
    if (!b) return;
    var codigo = b.getAttribute("data-codigo");
    var estado = b.getAttribute("data-estado");
    b.disabled = true;
    api("/api/admin/reservas/estado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: state.key, codigo: codigo, estado: estado })
    })
      .then(function (res) {
        if (res.data && res.data.ok) {
          toast(codigo + " → " + estado + ".");
          cargar(false);
        } else {
          b.disabled = false;
          toast((res.data && res.data.error) || "No se pudo cambiar el estado.", true);
        }
      })
      .catch(function () {
        b.disabled = false;
        toast("Sin conexión con el servidor.", true);
      });
  });

  /* ---------- sesión persistida ---------- */

  if (state.key) {
    api("/api/admin/reservas?key=" + encodeURIComponent(state.key))
      .then(function (res) {
        if (res.data && res.data.ok) {
          state.reservas = res.data.reservas || [];
          state.conteo = res.data.conteo || {};
          entrar();
        } else {
          sessionStorage.removeItem(KEY_STORAGE);
          state.key = "";
        }
      })
      .catch(function () { /* mostrar gate */ });
  }
})();
