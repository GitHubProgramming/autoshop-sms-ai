export default function SyncStatus({ status, isSignedIn, onSignIn, onSignOut }) {
  const statusMap = {
    idle: '',
    syncing: '🔄 Sinchronizuoja...',
    synced: '✅ Išsaugota',
    error: '❌ Klaida',
  }

  return (
    <div className="sync-bar">
      {isSignedIn ? (
        <>
          <span className="sync-text">{statusMap[status]}</span>
          <button className="sync-logout" onClick={onSignOut}>Atsijungti</button>
        </>
      ) : (
        <button className="sync-login" onClick={onSignIn}>
          📊 Prisijungti prie Google Sheets
        </button>
      )}
    </div>
  )
}
