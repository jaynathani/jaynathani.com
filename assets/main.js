(function () {
  'use strict';

  // Hairline under the header once the page scrolls
  var header = document.querySelector('.site-header');
  var links = document.querySelectorAll('.nav a');
  var sections = document.querySelectorAll('main section[id]');

  function onScroll() {
    header.classList.toggle('scrolled', scrollY > 8);

    // Underline the nav item for the section being read
    var current = '', line = innerHeight * 0.35;
    sections.forEach(function (s) { if (s.getBoundingClientRect().top < line) current = '#' + s.id; });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = '#contact';
    links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === current); });
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  document.getElementById('year').textContent = new Date().getFullYear();
})();
