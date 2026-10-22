import { Icon } from '../components/Icon'

export function TodayPage() {
  const today = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())
  return (
    <section className="page today-page" aria-labelledby="today-title">
      <div className="page-intro">
        <div>
          <p className="eyebrow page-kicker">
            {today.toLocaleUpperCase('it-IT')}
          </p>
          <h1 id="today-title">Oggi</h1>
          <p className="page-subtitle">Il punto di partenza per la tua casa.</p>
        </div>
        <div className="sun-badge">
          <Icon name="sun" size={24} />
        </div>
      </div>

      <div className="empty-card">
        <div className="empty-illustration" aria-hidden="true">
          <div className="illustration-sun">
            <Icon name="spark" size={25} />
          </div>
          <div className="illustration-house">
            <Icon name="home" size={48} />
          </div>
          <span className="illustration-leaf leaf-one" />
          <span className="illustration-leaf leaf-two" />
        </div>
        <div className="empty-copy">
          <span className="soft-label">UN INIZIO LEGGERO</span>
          <h2>Una casa alla volta.</h2>
          <p>
            Non serve inserire tutto quello che possiedi. Casetta prenderà forma
            insieme ai tuoi prossimi acquisti.
          </p>
          <p className="empty-note">
            Questa area è pronta per accogliere la tua casa. Le scorte e la
            spesa arriveranno nei prossimi passi.
          </p>
        </div>
      </div>

      <div className="lower-grid">
        <article className="quiet-card">
          <span className="card-icon">
            <Icon name="boxes" />
          </span>
          <div>
            <h3>Si parte con calma</h3>
            <p>
              Nessun inventario da compilare, nessun conteggio da indovinare.
            </p>
          </div>
        </article>
        <article className="quiet-card">
          <span className="card-icon warm">
            <Icon name="home" />
          </span>
          <div>
            <h3>La casa resta tua</h3>
            <p>
              Persone e abitazioni saranno gestite separatamente, con permessi
              espliciti.
            </p>
          </div>
        </article>
      </div>
      <p className="readiness-line">
        <span className="status-dot" /> Nessun dato collegato in questa fase
        iniziale
      </p>
    </section>
  )
}
