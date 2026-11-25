// Served by the lab (http or https): the brand and the first crumb go back to the lab. Opened from a file, they stay inert.
(function () {
  if (!/^https?:$/.test(window.location.protocol)) return;
  document.querySelectorAll('a[data-home]').forEach(function (a) { a.setAttribute('href', '/'); });
})();
