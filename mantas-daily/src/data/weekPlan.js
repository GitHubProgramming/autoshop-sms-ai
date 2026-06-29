export const WEEK_PLAN = [
  { day: 'Pr', full: 'Pirmadienis', emoji: '💪', type: 'Freeletics / Jėga', isTraining: true },
  { day: 'An', full: 'Antradienis', emoji: '💪', type: 'Freeletics / Jėga', isTraining: true },
  { day: 'Tr', full: 'Trečiadienis', emoji: '🚶', type: 'Aktyvus poilsis', isTraining: false },
  { day: 'Kt', full: 'Ketvirtadienis', emoji: '💪', type: 'Freeletics / Jėga', isTraining: true },
  { day: 'Pn', full: 'Penktadienis', emoji: '💪', type: 'Freeletics / Jėga', isTraining: true },
  { day: 'Št', full: 'Šeštadienis', emoji: '🏃', type: 'Bėgimas', isTraining: true },
  { day: 'Sk', full: 'Sekmadienis', emoji: '😴', type: 'Poilsis', isTraining: false },
]

export function getTodayPlan() {
  const jsDay = new Date().getDay()
  const idx = jsDay === 0 ? 6 : jsDay - 1
  return WEEK_PLAN[idx]
}

export function getDateStr(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function getWeekDates() {
  const now = new Date()
  const jsDay = now.getDay()
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)

  return WEEK_PLAN.map((plan, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return { ...plan, date: getDateStr(d), isToday: getDateStr(d) === getDateStr(now) }
  })
}
