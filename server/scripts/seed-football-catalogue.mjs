import 'dotenv/config'
import pg from 'pg'
import { createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

const season = '2026/27'
const leagues = [
  {
    name: 'Premier League', slug: 'premier-league', country: 'England', countryCode: 'GB', sortOrder: 1,
    teams: [
      'Arsenal', 'Aston Villa', 'AFC Bournemouth', 'Brentford', 'Brighton & Hove Albion', 'Chelsea',
      'Coventry City', 'Crystal Palace', 'Everton', 'Fulham', 'Hull City', 'Ipswich Town', 'Leeds United',
      'Liverpool', 'Manchester City', 'Manchester United', 'Newcastle United', 'Nottingham Forest',
      'Sunderland', 'Tottenham Hotspur',
    ],
  },
  {
    name: 'Ligue 1', slug: 'ligue-1', country: 'France', countryCode: 'FR', sortOrder: 2,
    teams: [
      'AJ Auxerre', 'Angers', 'Brest', 'Le Havre', 'Le Mans', 'Lens', 'Lille', 'Lorient', 'Lyon',
      'Marseille', 'Monaco', 'Nice', 'Paris FC', 'Paris Saint-Germain', 'Rennes', 'Strasbourg',
      'Toulouse', 'Troyes',
    ],
  },
  {
    name: 'Bundesliga', slug: 'bundesliga', country: 'Germany', countryCode: 'DE', sortOrder: 3,
    teams: [
      'Augsburg', 'Bayer Leverkusen', 'Bayern Munich', 'Borussia Dortmund', 'Borussia Monchengladbach',
      'Eintracht Frankfurt', 'FC Cologne', 'FC Schalke 04', 'Freiburg', 'Hamburger SV', 'Mainz 05',
      'RB Leipzig', 'SC Paderborn 07', 'SV Elversberg', 'Stuttgart', 'TSG Hoffenheim',
      'Union Berlin', 'Werder Bremen',
    ],
  },
  {
    name: 'La Liga', slug: 'la-liga', country: 'Spain', countryCode: 'ES', sortOrder: 4,
    teams: [
      'Alaves', 'Athletic Club', 'Atletico Madrid', 'Barcelona', 'Celta Vigo', 'Deportivo La Coruna',
      'Elche', 'Espanyol', 'Getafe', 'Levante', 'Malaga', 'Osasuna', 'Racing Santander',
      'Rayo Vallecano', 'Real Betis', 'Real Madrid', 'Real Sociedad', 'Sevilla', 'Valencia', 'Villarreal',
    ],
  },
  {
    name: 'Serie A', slug: 'serie-a', country: 'Italy', countryCode: 'IT', sortOrder: 5,
    teams: [
      'Atalanta', 'Bologna', 'Cagliari', 'Como', 'Fiorentina', 'Frosinone', 'Genoa', 'Inter', 'Juventus',
      'Lazio', 'Lecce', 'Milan', 'Monza', 'Napoli', 'Parma', 'Roma', 'Sassuolo', 'Torino', 'Udinese',
      'Venezia',
    ],
  },
]

const databaseUrl = process.env.DATABASE_URL?.trim()
let client

try {
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured.')
  const connectionUrl = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL.')
  }
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) connectionUrl.searchParams.delete(key)

  const ssl = createPostgresSslOptions({
    caFile: process.env.SUPABASE_CA_CERT_FILE,
    caContents: process.env.SUPABASE_CA_CERT,
  }, { requireCa: process.env.NODE_ENV === 'production' })

  client = new pg.Client({
    connectionString: connectionUrl.toString(),
    ssl,
    connectionTimeoutMillis: 10_000,
    application_name: 'kitculture-football-catalogue-seed',
  })
  await client.connect()
  await client.query('BEGIN')

  let insertedLeagues = 0
  let insertedTeams = 0
  let verifiedTeams = 0
  for (const league of leagues) {
    const result = await client.query(
      `INSERT INTO leagues (name, slug, country, country_code, season, sort_order, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (slug) DO NOTHING`,
      [league.name, league.slug, league.country, league.countryCode, season, league.sortOrder],
    )
    insertedLeagues += result.rowCount ?? 0

    for (const [index, name] of league.teams.entries()) {
      const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const teamResult = await client.query(
        `INSERT INTO teams (league_id, name, slug, sort_order, active)
         SELECT id, $2, $3, $4, true FROM leagues WHERE slug = $1
         ON CONFLICT (league_id, slug) DO NOTHING`,
        [league.slug, name, slug, index + 1],
      )
      insertedTeams += teamResult.rowCount ?? 0
    }

    const verification = await client.query(
      `SELECT COUNT(teams.id)::integer AS total
       FROM leagues
       LEFT JOIN teams ON teams.league_id = leagues.id
       WHERE leagues.slug = $1`,
      [league.slug],
    )
    const total = verification.rows[0]?.total
    if (total !== league.teams.length) throw new Error('League team count verification failed.')
    verifiedTeams += total
  }

  await client.query('COMMIT')
  console.log(`Football catalogue verified: ${leagues.length} leagues and ${verifiedTeams} teams. Newly added: ${insertedLeagues} leagues and ${insertedTeams} teams; existing records preserved.`)
} catch (error) {
  await client?.query('ROLLBACK').catch(() => {})
  const code = typeof error?.code === 'string' ? error.code : 'SAFE_CONFIGURATION_OR_DATABASE_ERROR'
  console.error(`Football catalogue seed failed; error code: ${code}. Sensitive details were suppressed.`)
  process.exitCode = 1
} finally {
  if (client) await client.end().catch(() => {})
}