// Credits sign-off logo: drag it sideways to resize (short </> / middle </in> / long </Atelier>), or pick a form with the radios.
// --logo-x drives the whole SVG (logo.css); logo-init.js applies the saved form before paint.
const X = { short: 540, middle: 734, long: 1491.4 };
const KEY = "logo-form";
const root = document.documentElement;
const narrow = matchMedia("(max-width: 29.99rem)");
const link = document.querySelector("[data-logo-link]");
const svg = link?.querySelector(".brand-logo");
const radios = document.querySelectorAll("[data-logo-form]");
function apply(form) {
  root.dataset.logo = form;
  radios.forEach((r) => r.checked = r.value === form);
  try {
    localStorage.setItem(KEY, form);
  } catch {
    /* storage unavailable: the choice lasts for this page view only */
  }
}
radios.forEach((r) => r.addEventListener("change", () => r.checked && apply(r.value)));
const saved = root.dataset.logo;
radios.forEach((r) => r.checked = r.value === (saved && saved in X ? saved : "middle"));
if (link && svg) {
  try {
    const n = +(localStorage.getItem("logo-hint") ?? 0);
    if (n < 3 && !localStorage.getItem(KEY)) {
      localStorage.setItem("logo-hint", String(n + 1));
      svg.setAttribute("data-hint", "");
    }
  } catch {
    /* no storage: no hint */
  }
  const P = [0, 12, 26, 66, 106];
  const XS = [X.short, X.short, X.middle, X.middle, X.long];
  const toX = (p) => {
    let i = 1;
    while (i < 4 && p > P[i]) i++;
    return XS[i - 1] + (XS[i] - XS[i - 1]) * (p - P[i - 1]) / (P[i] - P[i - 1]);
  };
  let id = -1;
  let startX = 0;
  let p0 = 0;
  let x = 0;
  let dragging = false;
  let suppress = false;
  const max = () => narrow.matches ? X.middle : X.long;
  link.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button) return;
    id = e.pointerId;
    startX = e.clientX;
    x = parseFloat(getComputedStyle(svg).getPropertyValue("--logo-x"));
    p0 = x < 637 ? 6 : x < 1112 ? 46 : 106;
    dragging = false;
  });
  link.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) <= 6) return;
      dragging = true;
      link.setPointerCapture(id);
      svg.setAttribute("data-drag", "");
    }
    x = Math.min(max(), toX(Math.min(106, Math.max(0, p0 + dx))));
    svg.style.setProperty("--logo-x", String(x));
  });
  const end = () => {
    if (id < 0) return;
    id = -1;
    if (!dragging) return;
    dragging = false;
    suppress = true;
    setTimeout(() => suppress = false, 100);
    svg.removeAttribute("data-drag");
    svg.style.removeProperty("--logo-x");
    const forms = Object.keys(X).filter((f) => X[f] <= max());
    apply(forms.reduce((a, b) => Math.abs(X[b] - x) < Math.abs(X[a] - x) ? b : a));
  };
  link.addEventListener("pointerup", end);
  link.addEventListener("pointercancel", end);
  link.addEventListener(
    "click",
    (e) => {
      if (suppress) {
        e.preventDefault();
        suppress = false;
      }
    },
    true
  );
}
