/* Hotel Príncipe — navegación y utilidades compartidas */
(function () {
  "use strict";

  document.documentElement.classList.add("js");

  var nav = document.getElementById("nav");
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");

  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("scrolled", window.scrollY > 24);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("active");
      toggle.classList.toggle("active", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
      document.body.style.overflow = open ? "hidden" : "";
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        links.classList.remove("active");
        toggle.classList.remove("active");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      }
    });
  }

  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- Revelado sutil al hacer scroll ---------- */
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealSel = ".section-head, .hotel-copy, .facts-card, .room-card, .service-card, .booking-step, .steps-actions, .contact-list, .location-actions, .map-col, .facade-figure, .faq-list, .cta-band > h2, .cta-band > p, .cta-band > .hero-actions, .page-head, .form-card, .aside-card";
  // Evita revelados anidados (p. ej. section-head dentro de hotel-copy):
  // filtrar ANTES de añadir la clase, para que ningún elemento quede oculto sin observador.
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(revealSel)).filter(function (el) {
    return !el.parentElement || !el.parentElement.closest(revealSel);
  });
  revealEls.forEach(function (el) { el.classList.add("reveal"); });

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("revealed"); });
  } else {
    // Escalonado suave entre hermanos del mismo contenedor
    revealEls.forEach(function (el) {
      if (!el.parentElement) return;
      var siblings = Array.prototype.slice.call(el.parentElement.children).filter(function (c) {
        return c.classList.contains("reveal");
      });
      var idx = siblings.indexOf(el);
      if (idx > 0) el.style.transitionDelay = Math.min(idx, 5) * 80 + "ms";
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Sección activa en la navegación ---------- */
  var spyLinks = {};
  if (links) {
    Array.prototype.forEach.call(links.querySelectorAll('a[href^="/#"]'), function (a) {
      spyLinks[a.getAttribute("href").slice(2)] = a;
    });
  }
  var spySections = Object.keys(spyLinks).map(function (id) {
    return document.getElementById(id);
  }).filter(Boolean);
  if (spySections.length && "IntersectionObserver" in window) {
    var current = null;
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          if (current) { current.classList.remove("active"); current.removeAttribute("aria-current"); }
          current = spyLinks[entry.target.id] || null;
          if (current) { current.classList.add("active"); current.setAttribute("aria-current", "true"); }
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    spySections.forEach(function (s) { spy.observe(s); });
  }
})();
