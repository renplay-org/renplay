{ // Phone menu, and the nav's border once the page is scrolled.
  const nav = document.getElementById('nav'), menu = nav.querySelector('.menu')
  const set = (open) => { nav.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)) }
  menu.addEventListener('click', () => set(!nav.classList.contains('open')))
  nav.querySelectorAll('.links a').forEach((a) => a.addEventListener('click', () => set(false)))
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false) })
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true })
}
