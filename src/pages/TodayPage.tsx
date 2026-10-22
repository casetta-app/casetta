import { Icon } from '../components/Icon'
import { Link } from 'react-router-dom'

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
          <p className="page-subtitle">
            Un punto semplice per prenderti cura della casa, un giorno alla
            volta.
          </p>
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
          <h2>La tua casa è pronta.</h2>
          <p>
            Le scorte sono pronte: aggiungi quello che ti serve, quando ti
            serve. Puoi iniziare da un prodotto e aggiornare la disponibilità in
            pochi tocchi.
          </p>
          <Link className="primary-button today-stock-link" to="/scorte">
            Apri le scorte
          </Link>
        </div>
      </div>

      <div className="lower-grid">
        <article className="quiet-card">
          <span className="card-icon">
            <Icon name="boxes" />
          </span>
          <div>
            <h3>Un prodotto alla volta</h3>
            <p>
              Cerca nel catalogo o aggiungi un prodotto con la sola
              disponibilità che conosci.
            </p>
          </div>
        </article>
        <article className="quiet-card">
          <span className="card-icon warm">
            <Icon name="home" />
          </span>
          <div>
            <h3>Scorte chiare</h3>
            <p>
              Quantità, confezioni e posizioni restano organizzate per la casa
              selezionata.
            </p>
          </div>
        </article>
      </div>
    </section>
  )
}
