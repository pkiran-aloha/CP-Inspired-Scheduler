// View density: how much breathing room the screens get. The CSS side lives in
// styles.css under :root[data-density]; this module holds the parts JS needs.
// Normal is the original look; relaxed and tight only override it.

export const DENSITIES = ['relaxed', 'normal', 'tight']

export const DENSITY_LABEL = { relaxed: 'Relaxed', normal: 'Normal', tight: 'Tight' }

export const densityOf = (settings) => (DENSITIES.includes(settings?.density) ? settings.density : 'normal')

// Calendar hour height. The time grid stretches so a set number of hours fills
// the visible scroller, clamped so a 15-minute session stays readable.
const HOUR_FIT = {
  relaxed: { hours: 11, min: 60, max: 104 },
  normal: { hours: 13, min: 52, max: 88 },
  tight: { hours: 15, min: 44, max: 76 },
}

export function calendarHourPx(viewportH, density = 'normal') {
  const fit = HOUR_FIT[density] || HOUR_FIT.normal
  if (!viewportH) return fit.min + 4
  return Math.min(fit.max, Math.max(fit.min, Math.round((viewportH - 8) / fit.hours)))
}
