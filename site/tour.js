// The tour: the dashboard screenshot stays pinned while the section scrolls past, and each step
// zooms into the part of Luca it describes and lights it up. Without this script the page shows
// the screenshot with every step listed under it.
;(() => {
  const tour = document.querySelector('.tour')
  if (!tour) return
  const stage = tour.querySelector('.stage')
  const shot = tour.querySelector('.shot')
  const tabs = tour.querySelector('.tabs')
  const steps = [...tour.querySelectorAll('.step')]
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  const MAX_ZOOM = 2.6

  const views = steps.map((step) => {
    if (!step.dataset.rect) return null
    const [x, y, w, h] = step.dataset.rect.split(' ').map(Number)
    return { x, y, w, h }
  })

  // the screenshot's corners are the desktop behind the window: zoomed in, its left and right
  // edges stay just out of frame, which keeps the corners out too
  const EDGE = 0.006

  // Where each step looks: scale to fit its rect with a margin, centred, without showing past the
  // screenshot's edges. With reduced motion there is no zoom, only the light.
  const place = (v) => {
    const s = v && !still.matches ? Math.max(1, Math.min(0.92 / v.w, 0.92 / v.h, MAX_ZOOM)) : 1
    const inset = s > 1 ? EDGE * s : 0
    const clamp = (n, e) => Math.min(-e, Math.max(1 - s + e, n))
    const tx = v ? clamp(0.5 - (v.x + v.w / 2) * s, inset) : 0
    const ty = v ? clamp(0.5 - (v.y + v.h / 2) * s, 0) : 0
    shot.style.setProperty('--s', s)
    shot.style.setProperty('--tx', `${tx * 100}%`)
    shot.style.setProperty('--ty', `${ty * 100}%`)
    if (!v) return
    shot.style.setProperty('--x', `${v.x * 100}%`)
    shot.style.setProperty('--y', `${v.y * 100}%`)
    shot.style.setProperty('--w', `${v.w * 100}%`)
    shot.style.setProperty('--h', `${v.h * 100}%`)
  }

  const buttons = steps.map((step, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tab'
    b.textContent = step.dataset.label
    b.setAttribute('aria-label', step.dataset.label)
    b.addEventListener('click', () => go(i))
    tabs.append(b)
    return b
  })

  let current = -1
  const show = (i) => {
    current = i
    steps.forEach((step, j) => step.classList.toggle('is-active', j === i))
    buttons.forEach((b, j) =>
      j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')
    )
    tour.toggleAttribute('data-lit', !!views[i])
    place(views[i])
  }

  // The stage sticks centred in the window; the scroll it stays stuck for is split evenly across
  // the steps.
  let top = 0
  let padTop = 0
  let run = 1
  const measure = () => {
    top = Math.max(12, (innerHeight - stage.offsetHeight) / 2)
    stage.style.top = `${top}px`
    padTop = parseFloat(getComputedStyle(tour).paddingTop)
    run = Math.max(1, tour.offsetHeight - padTop - stage.offsetHeight)
  }

  const progress = () => (top - tour.getBoundingClientRect().top - padTop) / run

  const update = () => {
    const p = Math.min(Math.max(progress(), 0), 1)
    const i = Math.min(steps.length - 1, Math.floor(p * steps.length))
    if (i !== current) show(i)
  }

  // a tab scrolls to the middle of its step's stretch
  const go = (i) => {
    const stuckAt = scrollY + tour.getBoundingClientRect().top + padTop - top
    const at = stuckAt + run * ((i + 0.5) / steps.length)
    scrollTo({ top: at, behavior: still.matches ? 'auto' : 'smooth' })
  }

  tour.style.setProperty('--steps', steps.length)
  tabs.hidden = false
  measure()
  update()

  let queued = false
  const onScroll = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      update()
    })
  }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', () => {
    measure()
    update()
  })
  still.addEventListener('change', () => place(views[current]))
})()
