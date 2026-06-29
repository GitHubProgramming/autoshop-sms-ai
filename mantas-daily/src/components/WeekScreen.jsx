import { getWeekDates, getDateStr } from '../data/weekPlan'

export default function WeekScreen({ weekData }) {
  const week = getWeekDates()
  const todayStr = getDateStr()

  const fullDays = Object.values(weekData).filter(d => (d.completedMeals || 0) >= 8).length
  const totalMeals = Object.values(weekData).reduce((s, d) => s + (d.completedMeals || 0), 0)
  const energyDays = Object.values(weekData).filter(d => d.energy > 0)
  const avgEnergy = energyDays.length
    ? (energyDays.reduce((s, d) => s + d.energy, 0) / energyDays.length).toFixed(1)
    : '—'

  return (
    <div className="screen">
      <h2 className="screen-title">Savaitė</h2>

      <div className="week-grid">
        {week.map(d => {
          const dayData = weekData[d.date] || {}
          const done = dayData.completedMeals || 0
          const pct = Math.round((done / 8) * 100)
          return (
            <div key={d.day} className={`week-card ${d.date === todayStr ? 'week-card-today' : ''}`}>
              <div className="week-card-day">{d.full}</div>
              <div className="week-card-emoji">{d.emoji}</div>
              <div className="week-card-type">{d.type}</div>
              <div className="week-card-progress">
                <div className="mini-bar">
                  <div className="mini-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="mini-label">{done}/8</span>
              </div>
              <div className="week-card-dots">
                {dayData.energy ? '⭐'.repeat(dayData.energy) : ''}
              </div>
            </div>
          )
        })}
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-val">{fullDays}</div>
          <div className="stat-label">Pilnos dienos</div>
        </div>
        <div className="stat-card">
          <div className="stat-val">{totalMeals}</div>
          <div className="stat-label">Valgymų</div>
        </div>
        <div className="stat-card">
          <div className="stat-val">{avgEnergy}</div>
          <div className="stat-label">Energija avg</div>
        </div>
      </div>
    </div>
  )
}
