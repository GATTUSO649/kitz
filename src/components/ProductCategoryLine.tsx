export function ProductCategoryLine({ team, league, jerseyCategory, category, fallback }: {
  team?: string | null
  league?: string | null
  jerseyCategory?: string | null
  category?: string | null
  fallback: string
}) {
  const details = [team, league, jerseyCategory, category].filter((value): value is string => Boolean(value))
  return <span className="product-category">{details.length ? details.map((detail, index) => <span key={`${index}-${detail}`}>
    {index === 0 && team ? <span className="product-team-name">{detail}</span> : detail}{index < details.length - 1 ? ' · ' : ''}
  </span>) : fallback}</span>
}