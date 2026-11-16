// Pre-paint: apply the saved Vin's Atelier logo form (see logo.css).
(function () {
  try { var logo = localStorage.getItem("logo-form"); if (logo === "short" || logo === "middle" || logo === "long") document.documentElement.setAttribute("data-logo", logo); } catch { /* storage blocked: default form */ }
})();
