import { useState, useEffect } from 'react'
import HomeScreen from './components/HomeScreen'
import PlanScreen from './components/PlanScreen'
import WeekScreen from './components/WeekScreen'
import SyncStatus from './components/SyncStatus'
import { useGoogleSheets } from './hooks/useGoogleSheets'
import { useLocalStorage } from './hooks/useLocalStorage'
import { getDateStr, getWeekDates } from './data/weekPlan'
import './App.css'

const TABS = [
  { id: 'home', label: 'Dabar', emoji: '🏠' },
  { id: 'plan', label: 'Planas', emoji: '📋' },
  { id: 'week', label: 'Savaitė', emoji: '📊' },
]

function getDefaultDay() {
  return {
    date: getDateStr(),
    wakeUp: false,
    training: '',
    checks: Array(8).fill(false),
    completedMeals: 0,
    water: 0,
    energy: 0,
    weight: '',
  }
}

export default function App() {
  const [tab, setTab] = useState('home')
  const [allData, setAllData] = useLocalStorage('mantas-daily-data', {})
  const { isSignedIn, signIn, signOut, syncToSheet, syncStatus } = useGoogleSheets()

  const todayStr = getDateStr()
  const todayData = allData[todayStr] || getDefaultDay()

  const updateToday = (partial) => {
    setAllData(prev => {
      const current = prev[todayStr] || getDefaultDay()
      const next = { ...current, ...partial, date: todayStr }
      return { ...prev, [todayStr]: next }
    })
  }

  useEffect(() => {
    if (isSignedIn && todayData.date) {
      syncToSheet(todayData)
    }
  }, [allData, isSignedIn])

  const weekDates = getWeekDates()
  const weekData = {}
  weekDates.forEach(d => { weekData[d.date] = allData[d.date] || {} })

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">Mantas Daily</h1>
        <SyncStatus
          status={syncStatus}
          isSignedIn={isSignedIn}
          onSignIn={signIn}
          onSignOut={signOut}
        />
      </header>

      <main className="main">
        {tab === 'home' && <HomeScreen data={todayData} update={updateToday} />}
        {tab === 'plan' && <PlanScreen data={todayData} update={updateToday} />}
        {tab === 'week' && <WeekScreen weekData={weekData} />}
      </main>

      <nav className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-emoji">{t.emoji}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
