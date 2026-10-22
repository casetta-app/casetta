import { Icon } from '../components/Icon'

export function ComingSoonPage({ area }: { area: string }) {
  return (
    <section className="page simple-page" aria-labelledby="section-title">
      <p className="eyebrow page-kicker">CASETTA · FONDAMENTA</p>
      <h1 id="section-title">{area}</h1>
      <div className="preparation-card">
        <span className="preparation-icon">
          <Icon name="spark" size={24} />
        </span>
        <div>
          <h2>Questa sezione è in preparazione</h2>
          <p>
            Qui non ci sono ancora dati collegati. Le funzioni saranno attivate
            passo dopo passo.
          </p>
        </div>
      </div>
      <p className="page-footnote">
        Casetta non mostra scorte, acquisti o case di esempio.
      </p>
    </section>
  )
}
