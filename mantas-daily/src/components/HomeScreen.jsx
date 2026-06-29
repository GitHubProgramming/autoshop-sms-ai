import { MEALS } from '../data/meals'
import { getTodayPlan, getWeekDates } from '../data/weekPlan'

export default function HomeScreen({ data, update }) {
  const today = getTodayPlan()
  const week = getWeekDates()
  const completed = MEALS.filter((_, i) => data.checks?.[i]).length
  const nextTask = MEALS.find((_, i) => !data.checks?.[i])

  const trainingColors = {
    'Freeletics / Jėga': '#2B4D3F',
    'Bėgimas': '#3B7A57',
    'Aktyvus poilsis': '#7BA88E',
    'Poilsis': '#A8C5B8',
  }

  return (
    <div className="screen">
      <div className="week-bar">
        {week.map(d => (
          <div key={d.day} className={`week-day ${d.isToday ? 'today' : ''}`}>
            <span className="week-label">{d.day}</span>
            <span className="week-emoji">{d.emoji}</span>
          </div>
        ))}
      </div>

      <div className="training-banner" style={{ background: trainingColors[today.type] || '#2B4D3F' }}>
        <span className="banner-emoji">{today.emoji}</span>
        <div>
          <div className="banner-title">{today.full}</div>
          <div className="banner-type">{today.type}</div>
        </div>
      </div>

      {nextTask && (
        <div className="next-card">
          <div className="next-label">Sekantis veiksmas</div>
          <div className="next-row">
            <span className="next-time">{nextTask.time}</span>
            <span className="next-title">{nextTask.emoji} {nextTask.title}</span>
            <button
              className="check-btn"
              onClick={() => {
                const checks = [...(data.checks || Array(8).fill(false))]
                checks[nextTask.id - 1] = true
                update({ checks, completedMeals: checks.filter(Boolean).length })
              }}
            >
              ✓ Padaryta
            </button>
          </div>
        </div>
      )}

      <div className="progress-section">
        <div className="progress-label">Progresas: {completed}/8</div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${(completed / 8) * 100}%` }} />
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-label">💧 Vanduo</div>
        <div className="water-row">
          <button className="water-btn" onClick={() => update({ water: Math.max(0, (data.water || 0) - 0.5) })}>−</button>
          <span className={`water-val ${(data.water || 0) >= 2.5 ? 'water-done' : ''}`}>
            {(data.water || 0).toFixed(1)} L
          </span>
          <button className="water-btn" onClick={() => update({ water: (data.water || 0) + 0.5 })}>+</button>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-label">⭐ Energija</div>
        <div className="stars-row">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              className={`star ${(data.energy || 0) >= n ? 'star-active' : ''}`}
              onClick={() => update({ energy: n })}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-label">⚖️ Svoris (kg)</div>
        <input
          type="number"
          className="weight-input"
          placeholder="0.0"
          step="0.1"
          value={data.weight || ''}
          onChange={e => update({ weight: e.target.value ? parseFloat(e.target.value) : '' })}
        />
      </div>
    </div>
  )
}
