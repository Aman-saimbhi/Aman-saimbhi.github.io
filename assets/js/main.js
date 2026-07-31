import { mountCube } from './cube.js';

document.documentElement.classList.remove('no-js');

function openSide(id) {
  const d = document.getElementById(id);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  history.replaceState(null, '', '#' + id);
}

const cube = mountCube(document.getElementById('cube'), openSide);

/* turning the solid to whichever side the visitor opened keeps the two in sync */
document.querySelectorAll('.sides details').forEach((d) => {
  d.addEventListener('toggle', () => {
    if (!d.open) return;
    history.replaceState(null, '', '#' + d.id);
    cube?.show(d.id);
  });
});

const target = location.hash && document.querySelector(location.hash);
if (target && target.tagName === 'DETAILS') {
  target.open = true;
  target.scrollIntoView({ block: 'center' });
}

/* The header carries only the mark until the hero name has scrolled away. */
const wordmark = document.querySelector('.topbar__name[data-reveal]');
const heroName = document.getElementById('h-name');
const topbar = document.querySelector('.topbar');
if (wordmark && heroName) {
  /* scroll position rather than IntersectionObserver, whose callbacks can be
     withheld from backgrounded or occluded tabs */
  let threshold = 0;
  const measure = () => { threshold = heroName.getBoundingClientRect().bottom + window.scrollY; };
  const sync = () => {
    const past = window.scrollY > threshold;
    wordmark.classList.toggle('is-shown', past);
    topbar?.classList.toggle('is-stuck', past);
  };
  /* measured once, so the scroll handler does no layout reads */
  addEventListener('scroll', sync, { passive: true });
  addEventListener('resize', () => { measure(); sync(); }, { passive: true });
  measure();
  sync();
}

const yr = document.getElementById('yr');
if (yr) yr.textContent = new Date().getFullYear();
