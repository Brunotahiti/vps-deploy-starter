// ManaResto — site vitrine : liens vers l'application, apparition au défilement, année du pied de page.
(function () {
  var app = document.body.getAttribute("data-app") || "https://app.manaresto.com";
  document.querySelectorAll("[data-signup]").forEach(function (a) { a.href = app + "/signup"; });
  document.querySelectorAll("[data-login]").forEach(function (a) { a.href = app + "/login"; });
  document.querySelectorAll("[data-install]").forEach(function (a) { a.href = app + "/login?install=1"; });
  var year = document.getElementById("year"); if (year) year.textContent = String(new Date().getFullYear());
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) { entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); }); }
})();
