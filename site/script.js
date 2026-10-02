/* ManaResto — site vitrine : liens vers l'application, menu mobile, configuration, témoignages, formulaire, suivi d'événements. */
(function () {
  // Entrée « wahou » : voile lagon avec le logo, une fois par session, puis cascade du héros. Rien si l'utilisateur préfère moins d'animations.
  var intro = document.getElementById("intro"), reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches, seen = false;
  try { seen = sessionStorage.getItem("mr-intro") === "1"; } catch { /* stockage indisponible */ }
  if (intro) {
    if (reduce || seen) { intro.remove(); document.body.classList.add("anim", "anim-fast"); }
    else {
      document.body.classList.add("anim", "intro-on");
      try { sessionStorage.setItem("mr-intro", "1"); } catch { /* stockage indisponible */ }
      setTimeout(function () { intro.classList.add("done"); document.body.classList.remove("intro-on"); }, 1250);
      setTimeout(function () { intro.remove(); }, 2100);
    }
  }
  var C = window.MANARESTO_CONFIG || {}; var B = C.business || {}; var app = C.app || "https://app.manaresto.com";
  var $ = function (s, r) { return (r || document).querySelector(s); }; var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Icônes vectorielles (icons.js)
  var I = window.MANARESTO_ICONS || {};
  $$("[data-icon]").forEach(function (el) { var d = I[el.getAttribute("data-icon")]; if (d) el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; });

  // Liens vers l'application
  $$("[data-signup]").forEach(function (a) { a.href = app + "/signup"; });
  $$("[data-login]").forEach(function (a) { a.href = app + "/login"; });
  // Visite du restaurant exemple : ouvre directement le compte de démonstration, sans inscription
  $$("[data-demo]").forEach(function (a) { a.href = app + "/demo"; });
  $$("[data-install]").forEach(function (a) { a.href = app + "/login?install=1"; });
  $$("[data-admin]").forEach(function (a) { a.href = app + "/platform"; });
  $$("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });

  // Suivi d'événements (sans cookie) : poussés dans window.dataLayer si un outil est branché
  function track(name, data) { try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: name }, data || {})); } catch { /* sans importance */ } }
  $$("[data-track]").forEach(function (el) { el.addEventListener("click", function () { track(el.getAttribute("data-track"), { label: (el.textContent || "").trim().slice(0, 60) }); }); });

  // Menu mobile
  var burger = $(".burger"), menu = $(".mobile-menu");
  if (burger && menu) {
    var setOpen = function (open) { menu.dataset.open = String(open); burger.setAttribute("aria-expanded", String(open)); document.body.style.overflow = open ? "hidden" : ""; };
    burger.addEventListener("click", function () { setOpen(menu.dataset.open !== "true"); });
    $$("a", menu).forEach(function (a) { a.addEventListener("click", function () { setOpen(false); }); });
    window.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
  }

  // WhatsApp : uniquement si un numéro est renseigné dans config.js
  var wa = $(".wa");
  if (wa) { if (B.whatsapp) { wa.href = "https://wa.me/" + String(B.whatsapp).replace(/\D/g, ""); wa.dataset.on = "true"; } else { wa.remove(); } }
  $$("[data-phone]").forEach(function (el) { if (B.phone) { el.textContent = B.phone; el.href = "tel:" + String(B.phone).replace(/[^+\d]/g, ""); } else { var row = el.closest("[data-phone-row]"); if (row) row.remove(); else el.remove(); } });
  $$("[data-email]").forEach(function (el) { el.textContent = B.email; el.href = "mailto:" + B.email; });

  // Pages légales : champs de config.js, lignes masquées si vides
  $$("[data-legal]").forEach(function (el) { var v = B[el.getAttribute("data-legal")]; if (v) { el.textContent = v; } else { var row = el.closest("[data-legal-row]"); if (row) row.remove(); else el.remove(); } });
  $$("[data-legal-group]").forEach(function (g) { if (!$("dd", g)) g.remove(); });


  // Témoignages réels uniquement (testimonials.js)
  var T = window.MANARESTO_TESTIMONIALS || []; var tSection = $("#temoignages");
  if (tSection) {
    if (!T.length) { tSection.hidden = true; } else {
      var box = $(".testimonials", tSection);
      T.forEach(function (t) {
        var art = document.createElement("article"); art.className = "testimonial";
        var q = document.createElement("blockquote"); q.textContent = "« " + t.quote + " »"; art.appendChild(q);
        var who = document.createElement("div"); who.className = "who";
        if (t.photo || t.logo) { var im = document.createElement("img"); im.src = t.photo || t.logo; im.alt = ""; im.loading = "lazy"; who.appendChild(im); }
        var d = document.createElement("div"); var b = document.createElement("b"); b.textContent = (t.firstName ? t.firstName + (t.role ? ", " + t.role : "") : t.establishment); d.appendChild(b);
        var s = document.createElement("span"); s.textContent = t.establishment + (t.commune ? " · " + t.commune : ""); d.appendChild(s); who.appendChild(d); art.appendChild(who); box.appendChild(art);
      });
    }
  }

  // Apparition au défilement
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.1 });
    $$(".reveal").forEach(function (el) { io.observe(el); });
  } else { $$(".reveal").forEach(function (el) { el.classList.add("in"); }); }

  // Formulaire de démonstration
  var form = $("#demo-form");
  if (form) {
    var started = 0, msg = $(".form-msg", form), btn = $("button[type=submit]", form);
    form.addEventListener("focusin", function () { if (!started) { started = Date.now(); track("demo_form_start"); } }, { once: true });
    var rules = {
      restaurantName: function (v) { return v.trim().length >= 2 || "Indiquez le nom de votre établissement."; },
      contactName: function (v) { return v.trim().length >= 2 || "Indiquez votre nom."; },
      phone: function (v) { return v.replace(/\D/g, "").length >= 6 || "Indiquez un numéro de téléphone valide."; },
      email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || "Indiquez une adresse e-mail valide."; },
      commune: function (v) { return v.trim().length >= 2 || "Indiquez votre commune."; },
      kind: function (v) { return !!v || "Choisissez le type d'établissement."; },
      consent: function (v, el) { return el.checked || "Votre accord est nécessaire pour être recontacté."; }
    };
    var validate = function () {
      var ok = true;
      Object.keys(rules).forEach(function (name) {
        var el = form.elements[name], field = el.closest(".field"), r = rules[name](el.value, el);
        var err = $(".err", field); if (r !== true) { ok = false; field.classList.add("error"); if (err) err.textContent = r; } else { field.classList.remove("error"); }
      });
      return ok;
    };
    $$("input, select, textarea", form).forEach(function (el) { el.addEventListener("input", function () { var f = el.closest(".field"); if (f && f.classList.contains("error") && rules[el.name] && rules[el.name](el.value, el) === true) f.classList.remove("error"); }); });
    form.addEventListener("submit", function (e) {
      e.preventDefault(); msg.className = "form-msg";
      if (!validate()) { var first = $(".field.error input, .field.error select", form); if (first) first.focus(); return; }
      var data = {}; $$("input, select, textarea", form).forEach(function (el) { if (el.name) data[el.name] = el.type === "checkbox" ? el.checked : el.value; });
      data.startedAt = started || Date.now();
      btn.disabled = true; btn.textContent = "Envoi…";
      fetch(form.getAttribute("action") || "/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) {
          // Réponse non JSON (page d'erreur du serveur) : message clair plutôt qu'une erreur technique du navigateur
          return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch { j = null; } return { ok: r.ok && !!j, j: j, status: r.status }; });
        })
        .then(function (res) {
          if (!res.ok) throw new Error((res.j && res.j.error && res.j.error.message) || "Le service est momentanément indisponible, réessayez dans quelques minutes (erreur " + res.status + ").");
          track("demo_form_submit", { kind: data.kind });
          form.reset(); msg.textContent = "Merci ! Votre demande est bien reçue : nous vous contactons rapidement pour convenir d'une démonstration."; msg.className = "form-msg ok";
        })
        .catch(function (err) { msg.textContent = (err && err.message && !/pattern|JSON|fetch/i.test(err.message) ? err.message : "Envoi impossible pour le moment, vérifiez votre connexion.") + " Vous pouvez aussi nous écrire à " + B.email + "."; msg.className = "form-msg ko"; })
        .then(function () { btn.disabled = false; btn.textContent = "Demander ma démonstration"; });
    });
  }
})();
