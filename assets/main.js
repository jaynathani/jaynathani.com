(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Split the name into letters for the staggered entrance
  var delay = 0.15;
  document.querySelectorAll('.name .line').forEach(function (line) {
    var text = line.textContent;
    line.textContent = '';
    line.setAttribute('aria-hidden', 'true');
    text.split('').forEach(function (ch) {
      var s = document.createElement('span');
      s.className = 'ch';
      s.textContent = ch;
      s.style.animationDelay = (delay += 0.045) + 's';
      line.appendChild(s);
    });
    delay += 0.12;
  });

  // Reveal on scroll
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach(function (el, i) {
    if (reduce) { el.classList.add('in'); return; }
    // stagger siblings a little
    var sibs = el.parentElement ? [].indexOf.call(el.parentElement.children, el) : 0;
    el.style.transitionDelay = Math.min(sibs, 5) * 70 + 'ms';
    io.observe(el);
  });

  // Layer rail follows the journey
  var railItems = document.querySelectorAll('.rail li');
  var layerEls = document.querySelectorAll('[data-layer]');
  var railOn = null;
  function updateRail() {
    var n = '0', mid = innerHeight * 0.5;
    layerEls.forEach(function (el) { if (el.getBoundingClientRect().top < mid) n = el.dataset.layer; });
    if (n === railOn) return;
    railOn = n;
    railItems.forEach(function (li) { li.classList.toggle('on', li.dataset.rail === n); });
  }
  addEventListener('scroll', updateRail, { passive: true });
  updateRail();

  // Top bar: solid after the hero, highlight the current section
  var topbar = document.querySelector('.topbar');
  var links = document.querySelectorAll('.toplinks a');
  addEventListener('scroll', function () {
    topbar.classList.toggle('solid', scrollY > innerHeight * 0.6);
  }, { passive: true });
  var secIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); });
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('main section[id]').forEach(function (s) { secIO.observe(s); });

  // Cursor spotlight on panels
  var panels = document.querySelectorAll('.card, .tile, .cert, .contact-card');
  addEventListener('pointermove', function (e) {
    panels.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (e.clientY < r.top - 300 || e.clientY > r.bottom + 300) return;
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }, { passive: true });

  // Project viewer (games and videos open in a dialog)
  var dialog = document.querySelector('.viewer');
  var frame = dialog.querySelector('.viewer-frame');
  var title = dialog.querySelector('#viewer-title');
  document.querySelectorAll('[data-embed]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      title.textContent = btn.dataset.title;
      dialog.classList.toggle('is-game', btn.hasAttribute('data-game'));
      frame.innerHTML = '';
      var iframe = document.createElement('iframe');
      iframe.src = btn.dataset.embed;
      iframe.title = btn.dataset.title;
      iframe.allow = 'autoplay; encrypted-media; fullscreen';
      iframe.allowFullscreen = true;
      frame.appendChild(iframe);
      dialog.showModal();
    });
  });
  dialog.querySelector('.viewer-close').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', function () { frame.innerHTML = ''; });

  document.getElementById('year').textContent = new Date().getFullYear();
})();
