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
      setTimeout(function () { intro.classList.add("done"); document.body.classList.remove("intro-on"); }, 650);
      setTimeout(function () { intro.remove(); }, 1200);
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

  // Mesure d'audience anonyme, sans cookie : pages vues et clics envoyés à ManaResto (/api/t, relayé à l'application)
  function beacon(payload) {
    if (location.protocol === "file:") return;
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) navigator.sendBeacon("/api/t", new Blob([body], { type: "text/plain" }));
      else fetch("/api/t", { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } });
    } catch { /* sans importance */ }
  }
  var qs = new URLSearchParams(location.search);
  beacon({ type: "view", path: location.pathname, referrer: document.referrer, utmSource: qs.get("utm_source"), utmCampaign: qs.get("utm_campaign") });

  // Suivi d'événements (sans cookie) : poussés dans window.dataLayer si un outil est branché, et comptés dans la console ManaResto
  function track(name, data) { beacon({ type: "click", name: name, path: location.pathname }); try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: name }, data || {})); } catch { /* sans importance */ } }
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


  // Témoignages et vidéo réels uniquement (testimonials.js) : la section reste masquée sans contenu vérifié
  var T = window.MANARESTO_TESTIMONIALS || [], V = window.MANARESTO_VIDEO; var tSection = $("#temoignages");
  if (tSection) {
    if (!T.length && !(V && V.src)) { tSection.hidden = true; } else {
      tSection.hidden = false;
      if (V && V.src) {
        var fig = $(".video", tSection), vid = $("video", fig);
        vid.src = V.src; if (V.poster) vid.poster = V.poster;
        $("figcaption", fig).textContent = V.caption || ""; fig.hidden = false;
      }
      var box = $(".testimonials", tSection);
      T.forEach(function (t) {
        var art = document.createElement("article"); art.className = "testimonial";
        var q = document.createElement("blockquote"); q.textContent = "« " + t.quote + " »"; art.appendChild(q);
        var who = document.createElement("div"); who.className = "who";
        if (t.photo || t.logo) { var im = document.createElement("img"); im.src = t.photo || t.logo; im.alt = ""; im.loading = "lazy"; im.width = 42; im.height = 42; who.appendChild(im); }
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

  // Agrandissement des captures : clic (ou Entrée) sur une capture → plein écran avec sa légende.
  // Fermeture : bouton ✕, touche Échap, clic à côté de l'image ou glissé vers le bas ; ← → (ou glissé de côté) pour passer d'un écran à l'autre.
  var zooms = $$("[data-zoom]");
  if (zooms.length) {
    var lb = document.createElement("div");
    lb.className = "lb"; lb.hidden = true;
    lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Capture agrandie");
    lb.innerHTML = '<button class="lb-close" type="button" aria-label="Fermer"><i data-icon="x"></i></button>' +
      '<button class="lb-nav lb-prev" type="button" aria-label="Capture précédente"><i data-icon="chevron-left"></i></button>' +
      '<figure class="lb-fig"><img alt=""><figcaption><b></b><span></span><small class="lb-count"></small><small class="lb-rotate">Astuce : tournez le téléphone pour voir l\'écran en grand.</small></figcaption></figure>' +
      '<button class="lb-nav lb-next" type="button" aria-label="Capture suivante"><i data-icon="chevron-right"></i></button>';
    document.body.appendChild(lb);
    $$("[data-icon]", lb).forEach(function (el) { var d = I[el.getAttribute("data-icon")]; if (d) el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; });
    var lbImg = $("img", lb), lbTitle = $("figcaption b", lb), lbText = $("figcaption span", lb), lbCount = $(".lb-count", lb);
    var list = [], pos = 0, opener = null;
    var show = function (i) {
      pos = (i + list.length) % list.length;
      var z = list[pos], img = $("img", z);
      lbImg.src = z.getAttribute("data-full") || (img && img.currentSrc) || "";
      lbImg.alt = img ? img.alt : "";
      lbTitle.textContent = z.getAttribute("data-title") || "";
      lbText.textContent = z.getAttribute("data-text") || "";
      lbCount.textContent = list.length > 1 ? (pos + 1) + " / " + list.length : "";
      lb.classList.toggle("single", list.length < 2);
    };
    var close = function () {
      if (lb.hidden) return;
      lb.classList.remove("on"); document.body.style.overflow = "";
      setTimeout(function () { lb.hidden = true; lbImg.removeAttribute("src"); }, reduce ? 0 : 180);
      if (opener) opener.focus();
    };
    var open = function (z) {
      var group = z.getAttribute("data-zoom");
      list = zooms.filter(function (x) { return x.getAttribute("data-zoom") === group; });
      opener = z; show(list.indexOf(z));
      lb.hidden = false; document.body.style.overflow = "hidden";
      requestAnimationFrame(function () { lb.classList.add("on"); });
      $(".lb-close", lb).focus();
      track("screenshot_zoom", { label: z.getAttribute("data-title") || "" });
    };
    zooms.forEach(function (z) { z.addEventListener("click", function () { open(z); }); });
    $(".lb-close", lb).addEventListener("click", close);
    $(".lb-prev", lb).addEventListener("click", function () { show(pos - 1); });
    $(".lb-next", lb).addEventListener("click", function () { show(pos + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb || e.target.classList.contains("lb-fig")) close(); });
    window.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(pos - 1);
      else if (e.key === "ArrowRight") show(pos + 1);
      else if (e.key === "Tab") { // le focus reste dans la visionneuse
        var f = $$("button", lb).filter(function (b) { return b.offsetParent !== null; }), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // Gestes sur téléphone : glisser de côté pour changer d'écran, vers le bas pour fermer
    var sx = 0, sy = 0, touching = false;
    lb.addEventListener("touchstart", function (e) { if (e.touches.length !== 1) { touching = false; return; } touching = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      if (!touching) return; touching = false;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && list.length > 1) show(pos + (dx < 0 ? 1 : -1));
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
    }, { passive: true });
  }

  // Vidéo : lancée (sans le son) quand elle devient visible, mise en pause hors de l'écran ; rien d'automatique si l'utilisateur préfère moins d'animations
  $$("video[data-autoplay]").forEach(function (v) {
    if (reduce || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () { /* lecture automatique refusée : les contrôles restent */ }); } else { v.pause(); } }); }, { threshold: 0.35 }).observe(v);
    v.addEventListener("play", function () { if (!v.dataset.tracked) { v.dataset.tracked = "1"; track("video_play"); } });
  });

  // Formulaire de démonstration
  var form = $("#demo-form");
  if (form) {
    var started = 0, msg = $(".form-msg", form), btn = $("button[type=submit]", form);
    form.addEventListener("focusin", function () { if (!started) { started = Date.now(); track("demo_form_start"); } }, { once: true });
    // Obligatoires : nom du contact, établissement, et un moyen de contact (téléphone ou e-mail). Le reste est facultatif.
    var hasContact = function () { return !!(form.elements.phone.value.trim() || form.elements.email.value.trim()); };
    var rules = {
      contactName: function (v) { return v.trim().length >= 2 || "Indiquez votre nom."; },
      restaurantName: function (v) { return v.trim().length >= 2 || "Indiquez le nom de votre établissement."; },
      phone: function (v) { if (!v.trim()) return hasContact() || "Indiquez un téléphone ou un e-mail pour être recontacté."; return v.replace(/\D/g, "").length >= 6 || "Ce numéro de téléphone semble incomplet."; },
      email: function (v) { return !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || "Cette adresse e-mail semble incorrecte."; },
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
    var recheck = function (el) { var f = el.closest(".field"); if (f && f.classList.contains("error") && rules[el.name] && rules[el.name](el.value, el) === true) f.classList.remove("error"); };
    $$("input, select, textarea", form).forEach(function (el) { el.addEventListener("input", function () { recheck(el); if (el.name === "email") recheck(form.elements.phone); }); });
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
