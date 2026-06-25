// Theme früh anwenden (vor dem ersten Paint), damit kein Dunkel-Blitz beim
// hellen Theme entsteht. Liegt bewusst als externe Datei vor, damit die
// Content-Security-Policy ohne 'unsafe-inline' für Skripte auskommt.
try {
  var th = localStorage.getItem("encryo:theme");
  if (th === "light" || th === "dark") {
    document.documentElement.dataset.theme = th;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", th === "light" ? "#f6f7f9" : "#0a0b0d");
  }
} catch (e) {}
