import { useState } from 'react'
import { MEALS } from '../data/meals'

export default function PlanScreen({ data, update }) {
  const [expanded, setExpanded] = useState(null)
  const checks = data.checks || Array(8).fill(false)

  const toggle = (idx) => {
    const next = [...checks]
    next[idx] = !next[idx]
    update({ checks: next, completedMeals: next.filter(Boolean).length })
  }

  return (
    <div className="screen">
      <h2 className="screen-title">Dienos planas</h2>
      <div className="plan-list">
        {MEALS.map((meal, i) => (
          <div
            key={meal.id}
            className={`plan-item ${checks[i] ? 'plan-done' : ''}`}
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            <div className="plan-row">
              <button
                className={`plan-check ${checks[i] ? 'checked' : ''}`}
                onClick={e => { e.stopPropagation(); toggle(i) }}
              >
                {checks[i] ? '✅' : '⬜'}
              </button>
              <span className="plan-time">{meal.time}</span>
              <span className="plan-emoji">{meal.emoji}</span>
              <span className="plan-title">{meal.title}</span>
            </div>
            {expanded === i && (
              <div className="plan-detail">{meal.desc}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
