import { useState, useCallback, useRef, useEffect } from 'react'

const CLIENT_ID = '483314750432-4h9hc5drbkffadkrichm5ndm5rokmm83.apps.googleusercontent.com'
const SHEET_ID = '1PwC-5Q7k-he65Jd9dTtRyv1f5TYCraYIoVbhlak8dYk'
const SHEET_NAME = 'Sheet1'
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets'
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4'

export function useGoogleSheets() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [syncStatus, setSyncStatus] = useState('idle')
  const [lastSync, setLastSync] = useState(null)
  const debounceRef = useRef(null)
  const tokenClientRef = useRef(null)
  const gapiReadyRef = useRef(false)

  useEffect(() => {
    const loadGapi = () => {
      const script = document.createElement('script')
      script.src = 'https://apis.google.com/js/api.js'
      script.onload = () => {
        window.gapi.load('client', async () => {
          await window.gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] })
          gapiReadyRef.current = true
          const token = localStorage.getItem('gapi_token')
          if (token) {
            try {
              const parsed = JSON.parse(token)
              window.gapi.client.setToken(parsed)
              setIsSignedIn(true)
            } catch { /* ignore */ }
          }
        })
      }
      document.body.appendChild(script)
    }

    const loadGis = () => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.onload = () => {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (resp) => {
            if (resp.error) return
            const token = window.gapi.client.getToken()
            localStorage.setItem('gapi_token', JSON.stringify(token))
            setIsSignedIn(true)
          },
        })
      }
      document.body.appendChild(script)
    }

    loadGapi()
    loadGis()
  }, [])

  const signIn = useCallback(() => {
    if (tokenClientRef.current) {
      tokenClientRef.current.requestAccessToken({ prompt: 'consent' })
    }
  }, [])

  const signOut = useCallback(() => {
    const token = window.gapi?.client?.getToken()
    if (token) {
      window.google.accounts.oauth2.revoke(token.access_token)
      window.gapi.client.setToken(null)
    }
    localStorage.removeItem('gapi_token')
    setIsSignedIn(false)
  }, [])

  const syncToSheet = useCallback((dayData) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      if (!gapiReadyRef.current || !isSignedIn) return
      setSyncStatus('syncing')

      try {
        const dateStr = dayData.date
        const row = [
          dateStr,
          dayData.wakeUp ? 'Taip' : 'Ne',
          dayData.training || 'Praleista',
          `${dayData.completedMeals}/8`,
          String(dayData.water),
          String(dayData.energy),
          dayData.weight ? String(dayData.weight) : '',
        ]

        const range = `${SHEET_NAME}!A:G`
        const getResp = await window.gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range,
        })

        const rows = getResp.result.values || []
        let existingRow = -1
        for (let i = 0; i < rows.length; i++) {
          if (rows[i][0] === dateStr) { existingRow = i; break }
        }

        if (existingRow >= 0) {
          await window.gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!A${existingRow + 1}:G${existingRow + 1}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [row] },
          })
        } else {
          await window.gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [row] },
          })
        }

        setSyncStatus('synced')
        setLastSync(new Date())
        setTimeout(() => setSyncStatus('idle'), 2000)
      } catch (err) {
        console.error('Sheets sync error:', err)
        if (err.status === 401) {
          localStorage.removeItem('gapi_token')
          setIsSignedIn(false)
        }
        setSyncStatus('error')
        setTimeout(() => setSyncStatus('idle'), 3000)
      }
    }, 1500)
  }, [isSignedIn])

  return { isSignedIn, signIn, signOut, syncToSheet, syncStatus, lastSync }
}
