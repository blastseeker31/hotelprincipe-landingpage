/**
 * Hotel Príncipe — La Ceiba, Atlántida
 * Minimal JS: navbar, slider, form, toast.
 * ZERO scroll-triggered animations (anti-template).
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initTestimonials();
  initForm();
});

/* ── Navbar ── */
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.navbar-links');
  const links = navLinks.querySelectorAll('a');

  // Scroll: transparent → solid
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        navbar.classList.toggle('scrolled', window.scrollY > 60);
        ticking = false;
      });
      ticking = true;
    }
  });

  // Hamburger
  hamburger.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('active');
    hamburger.classList.toggle('active', isOpen);
    hamburger.setAttribute('aria-expanded', isOpen);
  });

  // Close on link click
  links.forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('active');
      hamburger.classList.remove('active');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  // Active nav link on scroll
  const sections = [];
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('#')) {
      const section = document.querySelector(href);
      if (section) sections.push({ link, section });
    }
  });

  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        const scrollPos = window.scrollY + 120;
        sections.forEach(({ link, section }) => {
          const top = section.offsetTop;
          const bottom = top + section.offsetHeight;
          link.classList.toggle('active', scrollPos >= top && scrollPos < bottom);
        });
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  });
}

/* ── Testimonials Slider ── */
function initTestimonials() {
  const track = document.querySelector('.testimonials-track');
  const slides = track.querySelectorAll('.testimonial');
  const dots = document.querySelectorAll('.testimonial-dot');
  if (!slides.length) return;

  let current = 0;
  let interval;
  const PAUSE = 5000;

  function goTo(index) {
    current = ((index % slides.length) + slides.length) % slides.length;
    track.style.transform = `translateX(-${current * 100}%)`;

    slides.forEach((s, i) => s.setAttribute('aria-hidden', i !== current));
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === current);
      d.setAttribute('aria-selected', i === current);
    });
  }

  function next() { goTo(current + 1); }

  function startAuto() {
    stopAuto();
    interval = setInterval(next, PAUSE);
  }

  function stopAuto() {
    if (interval) clearInterval(interval);
  }

  // Dot clicks
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      goTo(i);
      startAuto();
    });
  });

  // Pause on hover / focus
  track.addEventListener('mouseenter', stopAuto);
  track.addEventListener('mouseleave', startAuto);
  track.addEventListener('focusin', stopAuto);
  track.addEventListener('focusout', startAuto);

  // Touch swipe
  let touchStartX = 0;
  track.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    stopAuto();
  }, { passive: true });

  track.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      goTo(current + (diff > 0 ? 1 : -1));
    }
    startAuto();
  });

  startAuto();
}

/* ── Form (Validation + AJAX to Formspree) ── */
function initForm() {
  const form = document.getElementById('reserva-form');
  if (!form) return;

  const submitBtn = document.getElementById('form-submit-btn');
  const toast = document.getElementById('toast');
  let toastTimer;

  function showToast(message, type) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast toast-${type} show`;
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 4000);
  }

  // Date validation: checkout after checkin
  const llegada = document.getElementById('llegada');
  const salida = document.getElementById('salida');

  if (llegada && salida) {
    llegada.addEventListener('change', () => {
      salida.min = llegada.value;
      if (salida.value && salida.value <= llegada.value) {
        salida.value = '';
      }
    });
  }

  let submitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Rate limiting — prevent double submit
    if (submitting) return;
    submitting = true;

    // Basic validation
    const nombre = document.getElementById('nombre').value.trim();
    const email = document.getElementById('email').value.trim();
    const habitacion = document.getElementById('habitacion').value;
    const fechaLlegada = llegada ? llegada.value : '';
    const fechaSalida = salida ? salida.value : '';

    if (!nombre || !email || !habitacion || !fechaLlegada || !fechaSalida) {
      showToast('Por favor, complete todos los campos obligatorios.', 'error');
      submitting = false;
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast('Por favor, ingrese un correo electrónico válido.', 'error');
      submitting = false;
      return;
    }

    if (fechaSalida <= fechaLlegada) {
      showToast('La fecha de salida debe ser posterior a la fecha de llegada.', 'error');
      submitting = false;
      return;
    }

    // Sanitize: strip HTML tags from text fields
    const mensajeEl = document.getElementById('mensaje');
    const rawMensaje = mensajeEl ? mensajeEl.value : '';
    const safeMensaje = rawMensaje.replace(/[<>]/g, '');
    if (mensajeEl) mensajeEl.value = safeMensaje;

    // Loading state
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Enviando solicitud…';
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');

    try {
      const formData = new FormData(form);
      const response = await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data && data.ok === false) {
          throw new Error(data.error || 'Error al procesar la solicitud');
        }
        showToast('Su solicitud ha sido enviada. Nos comunicaremos con usted a la brevedad.', 'success');
        form.reset();
      } else {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Error del servidor');
      }
    } catch (err) {
      // Formspree returns 200 even on error sometimes — check for error field
      showToast('Lamentamos el inconveniente. No se pudo procesar su solicitud. Por favor, comuníquese al +504 2443-0516.', 'error');
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
    }
  });
}
