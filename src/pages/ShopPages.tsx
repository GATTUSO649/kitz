import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Filter, Heart, MapPin, Maximize2, MessageCircle, Search, ShoppingCart, Smartphone, Star, X } from 'lucide-react'
import { GoogleMapView } from '../components/GoogleMapView'
import { KenyanPhoneInput } from '../components/KenyanPhoneInput'
import { KitRating } from '../components/KitRating'
import { matchesNationalTeam, NATIONAL_TEAM_NAMES } from '../nationalTeams'

export type ShopVariant = { id: number; size: string; stock: number; price?: string | null }
export type ShopPurchaseSelection = { variant: ShopVariant; quantity: number }
export type BuyNowCheckoutDetails = {
  idempotencyKey: string
  deliveryZoneId: number
  paymentMethod: 'pay_on_delivery' | 'mpesa'
  email: string
  payerPhone: string
  recipientName: string
  phone: string
  address?: string
  county?: string
  town?: string
  estate?: string
  landmark?: string
  latitude?: number
  longitude?: number
  accuracy?: number
}
type ShopImage = { id: number; imageUrl: string; altText: string; sortOrder: number; isPrimary: boolean }
type ShopVideo = { id: number; videoUrl: string; title: string; sortOrder: number }
type ProductReview = { id: number; reviewerName: string; rating: number; body: string; createdAt: string }
export type ShopProduct = {
  id: number
  name: string
  slug: string
  description: string
  price: string
  salePrice?: string | null
  trending?: boolean
  imageUrl: string | null
  images?: ShopImage[]
  videos?: ShopVideo[]
  ratingAverage?: number
  reviewCount?: number
  reviews?: ProductReview[]
  featured: boolean
  category: { id?: number; name: string; slug?: string } | null
  team?: { id: number; name: string; slug: string } | null
  league?: { id: number; name: string; slug: string; country: string } | null
  jerseyCategory?: { id: number; name: string; slug: string } | null
  variants: ShopVariant[]
}
type ShopCategory = { id: number; name: string; slug: string }
type MarketplaceTeam = { id: number; leagueId: number; name: string; slug: string; sortOrder: number; productCount: number }
type MarketplaceLeague = { id: number; name: string; slug: string; country: string; countryCode: string; season: string; sortOrder: number; teams: MarketplaceTeam[] }
type MarketplaceDirectory = { leagues: MarketplaceLeague[]; jerseyCategories: { id: number; name: string; slug: string; sortOrder: number }[] }

const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })
const noProducts: ShopProduct[] = []

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

function videoEmbedUrl(videoUrl: string) {
  try {
    const url = new URL(videoUrl)
    if (url.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(url.pathname.slice(1))}`
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      const videoId = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]
      return videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` : null
    }
    if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname)) {
      const videoId = url.pathname.match(/^\/(\d+)/)?.[1]
      return videoId ? `https://player.vimeo.com/video/${videoId}` : null
    }
  } catch {
    return null
  }
  return null
}

async function readData<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const result = await response.json() as { data?: T; error?: { message?: string } }
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message ?? 'Could not load this page.')
  return result.data
}

async function readAllProducts(path: string): Promise<ShopProduct[]> {
  const products: ShopProduct[] = []
  let page = 1
  while (true) {
    const response = await fetch(`${path}${path.includes('?') ? '&' : '?'}limit=60&page=${page}`)
    const result = await response.json() as { data?: ShopProduct[]; pagination?: { hasMore: boolean }; error?: { message?: string } }
    if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Could not load this collection.')
    products.push(...result.data)
    if (!result.pagination?.hasMore) return products
    page += 1
  }
}

function ProductsGrid({ products, onSave, onAdd, portalMode = false }: { products: ShopProduct[]; onSave: (productId: number) => void; onAdd?: (product: ShopProduct) => void; portalMode?: boolean }) {
  const productPath = (slug: string) => portalMode ? `/account/marketplace/products/${slug}` : `/products/${slug}`
  if (!products.length) return <div className="catalogue-state"><strong>No jerseys match these filters.</strong><span>Try another team, collection or price range.</span></div>
  return <div className="product-grid">{products.map((product) => {
    const stock = product.variants.reduce((total, variant) => total + variant.stock, 0)
    return <article className="product-card" key={product.id}>
      <div className="product-media"><Link className="shop-product-link" to={productPath(product.slug)} aria-label={`View ${product.name}`}>{product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <div className="product-image-empty"><span>KC</span><small>IMAGE NOT PROVIDED</small></div>}</Link>
        {(product.salePrice || product.featured || product.trending) && <span className={`product-tag${product.salePrice ? ' product-tag-sale' : ''}`}>{product.salePrice ? 'SALE' : product.trending ? 'TRENDING' : 'FEATURED'}</span>}
        <button className="product-favourite" type="button" aria-label={`Save ${product.name} to your wishlist`} onClick={() => onSave(product.id)}><Heart size={14} /></button>
      </div>
      <div className="product-info"><div><ProductCategoryLine team={product.team?.name} league={product.league?.name} jerseyCategory={product.jerseyCategory?.name} category={product.category?.name} fallback="Football kit" /><h3><Link to={productPath(product.slug)}>{product.name}</Link></h3></div><span className="product-price">{product.salePrice ? <><del>{money.format(Number(product.price))}</del><strong className="sale-price">{money.format(Number(product.salePrice))}</strong></> : money.format(Number(product.price))}</span></div>
      {!portalMode && <KitRating productId={product.id} productName={product.name} rating={product.ratingAverage} count={product.reviewCount} />}
      <div className="product-meta"><div className="product-sizes">{product.variants.length ? product.variants.map((variant) => <span className={!variant.stock ? 'is-sold-out' : ''} key={variant.id}>{variant.size}</span>) : <span>Sizes unavailable</span>}</div><span className={stock > 0 ? 'stock-label' : 'stock-label sold-out'}>{stock > 0 ? 'In stock' : 'Out of stock'}</span></div>
      {portalMode ? <Link className="quick-add quick-add-preview" to={productPath(product.slug)} state={{ openBuyFlow: true }}><ShoppingCart size={13} />Buy</Link>
        : <div className="product-card-actions public-product-card-actions"><button className="quick-add" type="button" disabled={!stock || !onAdd} onClick={() => onAdd?.(product)}><ShoppingCart size={13} />Add to Cart</button><Link className="product-card-buy public-product-card-shop" to={productPath(product.slug)} state={{ openBuyFlow: true }}>Shop <ArrowRight size={14} /></Link></div>}
    </article>
  })}</div>
}
export function MarketplacePage({ onSave, onAdd, portalMode = false }: { onSave: (productId: number) => void; onAdd?: (product: ShopProduct) => void; portalMode?: boolean }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const teamRoutePrefix = portalMode ? '/account/marketplace/teams/' : '/marketplace/teams/'
  const routeSegments = pathname.startsWith(teamRoutePrefix) ? pathname.slice(teamRoutePrefix.length).split('/') : []
  const routeLeagueSlug = routeSegments.length === 2 ? routeSegments[0] : undefined
  const routeTeamSlug = routeSegments.length === 2 ? routeSegments[1] : undefined
  const leagueSlug = routeLeagueSlug ?? searchParams.get('league') ?? ''
  const teamSlug = routeTeamSlug ?? searchParams.get('team') ?? ''
  const jerseyCategorySlug = searchParams.get('type') ?? ''
  const collectionSlug = searchParams.get('category') ?? ''
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const marketplaceRoot = portalMode ? '/account/marketplace' : '/marketplace'
  const isTeamPage = Boolean(routeLeagueSlug && routeTeamSlug)
  const hasFilters = Boolean(leagueSlug || teamSlug || jerseyCategorySlug || collectionSlug || searchQuery)
  useEffect(() => setSearch(searchParams.get('q') ?? ''), [searchParams])
  const directoryQuery = useQuery({
    queryKey: ['marketplace-directory'],
    queryFn: () => readData<MarketplaceDirectory>('/api/v1/marketplace'),
  })
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => readData<ShopCategory[]>('/api/v1/categories'),
  })
  const categories = categoriesQuery.data ?? []
  const selectedCollection = categories.find((category) => category.slug === collectionSlug)
  const productUrl = new URLSearchParams({ limit: '60' })
  if (searchQuery) productUrl.set('q', searchQuery)
  if (leagueSlug) productUrl.set('league', leagueSlug)
  if (teamSlug) productUrl.set('team', teamSlug)
  if (jerseyCategorySlug) productUrl.set('jerseyCategory', jerseyCategorySlug)
  if (collectionSlug) productUrl.set('category', collectionSlug)
  const productsQuery = useQuery({
    queryKey: ['marketplace-products', searchQuery, leagueSlug, teamSlug, jerseyCategorySlug, collectionSlug],
    queryFn: () => readData<ShopProduct[]>(`/api/v1/products?${productUrl.toString()}`),
  })
  const featuredQuery = useQuery({
    queryKey: ['marketplace-featured'],
    queryFn: () => readData<ShopProduct[]>('/api/v1/products/featured?limit=4'),
    enabled: !hasFilters,
  })
  const trendingQuery = useQuery({
    queryKey: ['marketplace-trending'],
    queryFn: () => readData<ShopProduct[]>('/api/v1/products/trending?limit=4'),
    enabled: !hasFilters,
  })
  const directory = directoryQuery.data
  const leagues = directory?.leagues ?? []
  const jerseyCategories = directory?.jerseyCategories ?? []
  const selectedLeague = leagues.find((league) => league.slug === leagueSlug)
    ?? (teamSlug ? leagues.find((league) => league.teams.some((team) => team.slug === teamSlug)) : undefined)
  const selectedTeam = selectedLeague?.teams.find((team) => team.slug === teamSlug)
  const selectedCategory = jerseyCategories.find((category) => category.slug === jerseyCategorySlug)

  function updateFilters(updates: Partial<Record<'league' | 'team' | 'type' | 'category' | 'q', string>>) {
    const params = new URLSearchParams(searchParams)
    if (isTeamPage) {
      if (routeLeagueSlug && !params.has('league')) params.set('league', routeLeagueSlug)
      if (routeTeamSlug && !params.has('team')) params.set('team', routeTeamSlug)
    }
    if ('league' in updates) params.delete('team')
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const query = params.toString()
    if (isTeamPage) navigate(`${marketplaceRoot}${query ? `?${query}` : ''}`)
    else setSearchParams(params)
  }

  return <section className={`shop-section page-width marketplace-page${portalMode ? ' portal-marketplace-page' : ''}`}>
    <div className="eyebrow"><span className="eyebrow-line" /> The world of football</div>
    <div className="shop-page-title"><h1>{selectedTeam?.name ?? 'Find your kit'}</h1><p>{selectedTeam ? `Browse ${selectedTeam.name} kits, choose a jersey style, and find your size.` : 'Choose a league, club, jersey style or collection to find the kit you want.'}</p></div>
    {directoryQuery.isPending || categoriesQuery.isPending ? <div className="catalogue-state"><strong>Loading leagues, teams, and kit collections…</strong></div>
      : directoryQuery.isError || categoriesQuery.isError ? <div className="catalogue-state error-state"><strong>Marketplace unavailable</strong><span>{directoryQuery.error?.message ?? categoriesQuery.error?.message}</span></div>
        : <>
          <section className="marketplace-filter-panel" aria-label="Filter football kits">
            <div className="marketplace-filter-heading"><span><Filter size={16} /> Refine your search</span>{hasFilters && <button type="button" className="marketplace-reset" onClick={() => { setSearch(''); navigate(marketplaceRoot) }}>Clear filters</button>}</div>
            <form className="marketplace-filter-grid" onSubmit={(event) => { event.preventDefault(); updateFilters({ q: search.trim() }) }}>
              <label className="marketplace-search"><span>Search kits</span><span className="marketplace-search-input"><Search size={16} /><input aria-label="Search kits, teams, leagues, or jersey styles" placeholder="Team, league, or jersey…" value={search} onChange={(event) => setSearch(event.target.value)} /></span></label>
              <label><span>League</span><select value={leagueSlug} onChange={(event) => updateFilters({ league: event.target.value, team: '' })}><option value="">All leagues</option>{leagues.map((league) => <option key={league.id} value={league.slug}>{league.name}</option>)}</select></label>
              <label><span>Club</span><select value={teamSlug} disabled={!selectedLeague} onChange={(event) => updateFilters({ team: event.target.value })}><option value="">All clubs</option>{selectedLeague?.teams.map((team) => <option key={team.id} value={team.slug}>{team.name}</option>)}</select></label>
              <label><span>Jersey style</span><select value={jerseyCategorySlug} onChange={(event) => updateFilters({ type: event.target.value })}><option value="">All styles</option>{jerseyCategories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}</select></label>
              <label><span>Collection</span><select value={collectionSlug} onChange={(event) => updateFilters({ category: event.target.value })}><option value="">All collections</option>{categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}</select></label>
              <button className="button button-green marketplace-filter-submit" type="submit"><Search size={15} /> Find kits</button>
            </form>
          </section>
          <section className="marketplace-collections" aria-label="Browse collections">
            <div className="marketplace-collections-heading"><div><span className="eyebrow">Curated for matchday</span><h2>Shop by collection</h2></div></div>
            <div className="marketplace-collection-options"><button type="button" className={!collectionSlug ? 'is-selected' : ''} aria-pressed={!collectionSlug} onClick={() => updateFilters({ category: '' })}>All kits</button>{categories.map((category) => <button type="button" className={collectionSlug === category.slug ? 'is-selected' : ''} aria-pressed={collectionSlug === category.slug} key={category.id} onClick={() => updateFilters({ category: category.slug })}>{category.name}<ArrowRight size={13} /></button>)}</div>
          </section>
          {!hasFilters && <div className="marketplace-discovery">
            <section className="marketplace-discovery-section"><div className="marketplace-results-heading"><div><span className="eyebrow">Picked for you</span><h2>Featured kits</h2></div></div>{featuredQuery.isPending ? <div className="catalogue-state"><strong>Loading featured kits…</strong></div> : featuredQuery.isError ? <div className="catalogue-state error-state"><strong>Featured kits are unavailable</strong><span>{featuredQuery.error.message}</span></div> : <ProductsGrid products={featuredQuery.data ?? []} onSave={onSave} onAdd={onAdd} portalMode={portalMode} />}</section>
            <section className="marketplace-discovery-section"><div className="marketplace-results-heading"><div><span className="eyebrow">Popular right now</span><h2>Trending kits</h2></div></div>{trendingQuery.isPending ? <div className="catalogue-state"><strong>Loading trending kits…</strong></div> : trendingQuery.isError ? <div className="catalogue-state error-state"><strong>Trending kits are unavailable</strong><span>{trendingQuery.error.message}</span></div> : <ProductsGrid products={trendingQuery.data ?? []} onSave={onSave} onAdd={onAdd} portalMode={portalMode} />}</section>
          </div>}
          <div className="marketplace-results">
            <div className="marketplace-results-heading"><div><span className="eyebrow">{hasFilters ? 'Your results' : 'The full lineup'}</span><h2>{selectedTeam?.name ?? selectedLeague?.name ?? (hasFilters ? 'Filtered kits' : 'All kits')}{selectedCategory ? ` · ${selectedCategory.name}` : ''}{selectedCollection ? ` · ${selectedCollection.name}` : ''}</h2><p>{selectedLeague ? `${selectedLeague.country} · ${selectedLeague.season}` : hasFilters ? 'Matching kits from across the catalogue.' : 'Browse every available club and national team jersey.'}</p></div></div>
            {productsQuery.isPending ? <div className="catalogue-state"><strong>Finding your colours…</strong></div>
              : productsQuery.isError ? <div className="catalogue-state error-state"><strong>Jerseys could not be loaded</strong><span>{productsQuery.error.message}</span></div>
                : <><p className="catalogue-results">{productsQuery.data.length} {productsQuery.data.length === 1 ? 'jersey' : 'jerseys'} shown</p><ProductsGrid products={productsQuery.data} onSave={onSave} onAdd={onAdd} portalMode={portalMode} /></>}
          </div>
        </>}
  </section>
}

export function ShopPage({ onSave, onAdd }: { onSave: (productId: number) => void; onAdd: (product: ShopProduct) => void }) {
  const { pathname } = useLocation()
  const routeCategory = pathname.match(/^\/categories\/([^/]+)\/?$/)?.[1]
  const isNationalTeamsPage = routeCategory === 'national-team-kits'
  const isNewArrivalsPage = pathname === '/new-arrivals'
  const [searchParams] = useSearchParams()
  const jerseyCategorySlug = searchParams.get('category')
  const [search, setSearch] = useState('')
  const [collection, setCollection] = useState('')
  const [nationalTeamName, setNationalTeamName] = useState('')
  const [sort, setSort] = useState('featured')
  const [maxPrice, setMaxPrice] = useState('')
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => readData<ShopCategory[]>('/api/v1/categories'),
  })
  const productsQuery = useQuery({
    queryKey: ['products', 'shop'],
    enabled: !isNationalTeamsPage && !isNewArrivalsPage,
    queryFn: () => readAllProducts('/api/v1/products'),
  })
  const nationalTeamProductsQuery = useQuery({
    queryKey: ['products', 'national-teams'],
    enabled: isNationalTeamsPage || Boolean(nationalTeamName),
    queryFn: () => readAllProducts('/api/v1/products?category=national-team-kits'),
  })
  const newArrivalsProductsQuery = useQuery({
    queryKey: ['products', 'new-arrivals-page'],
    enabled: isNewArrivalsPage,
    queryFn: () => readAllProducts('/api/v1/products/new-arrivals'),
  })
  const categories = categoriesQuery.data ?? []
  const filterCategories = isNationalTeamsPage
    ? categories.filter((category) => category.slug === 'national-team-kits')
    : categories
  const products = productsQuery.data ?? noProducts
  const nationalTeamProducts = nationalTeamProductsQuery.data ?? noProducts
  const newArrivalProducts = newArrivalsProductsQuery.data ?? noProducts
  const productsToFilter = isNewArrivalsPage
    ? newArrivalProducts
    : isNationalTeamsPage || nationalTeamName ? nationalTeamProducts : products
  const selectedCategory = categories.find((category) => category.slug === routeCategory)
  const selectedJerseyCategory = products.find((product) => product.jerseyCategory?.slug === jerseyCategorySlug)?.jerseyCategory
  const selectedNationalTeam = nationalTeamName
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = productsToFilter.filter((product) => {
      const searchable = `${product.name} ${product.description} ${product.category?.name ?? ''} ${product.league?.name ?? ''} ${product.team?.name ?? ''} ${product.jerseyCategory?.name ?? ''}`.toLowerCase()
      return (!needle || searchable.includes(needle))
        && (!selectedCategory || product.category?.slug === selectedCategory.slug)
        && (!jerseyCategorySlug || product.jerseyCategory?.slug === jerseyCategorySlug)
        && (!collection || product.category?.name === collection)
        && (!nationalTeamName || (product.category?.slug === 'national-team-kits' && matchesNationalTeam(nationalTeamName, product.team?.name)))
        && (!maxPrice || Number(product.salePrice ?? product.price) <= Number(maxPrice))
    })
    return filtered.sort((a, b) => sort === 'price-low' ? Number(a.salePrice ?? a.price) - Number(b.salePrice ?? b.price) : sort === 'price-high' ? Number(b.salePrice ?? b.price) - Number(a.salePrice ?? a.price) : sort === 'name' ? a.name.localeCompare(b.name) : Number(b.featured) - Number(a.featured))
  }, [productsToFilter, search, selectedCategory, jerseyCategorySlug, collection, nationalTeamName, maxPrice, sort])
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, { name: string; slug?: string; products: ShopProduct[] }>()
    for (const product of visible) {
      const key = product.category?.slug ?? product.category?.name ?? 'other-kits'
      const group = groups.get(key) ?? {
        name: product.category?.name ?? 'Other kits',
        slug: product.category?.slug,
        products: [],
      }
      group.products.push(product)
      groups.set(key, group)
    }
    const categoryOrder = new Map(categories.map((category, index) => [category.slug, index]))
    return [...groups.values()].sort((left, right) =>
      (categoryOrder.get(left.slug ?? '') ?? Number.MAX_SAFE_INTEGER)
      - (categoryOrder.get(right.slug ?? '') ?? Number.MAX_SAFE_INTEGER),
    )
  }, [visible, categories])
  const resultsPending = categoriesQuery.isPending
    || (isNewArrivalsPage ? newArrivalsProductsQuery.isPending : isNationalTeamsPage || nationalTeamName ? nationalTeamProductsQuery.isPending : productsQuery.isPending)
  const resultsError = categoriesQuery.error
    ?? (isNewArrivalsPage ? newArrivalsProductsQuery.error : isNationalTeamsPage || nationalTeamName ? nationalTeamProductsQuery.error : productsQuery.error)
  const pageTitle = isNewArrivalsPage ? 'New arrivals' : isNationalTeamsPage ? 'National team kits' : selectedNationalTeam || selectedCategory?.name || selectedJerseyCategory?.name || 'Shop all jerseys'
  const pageDescription = isNewArrivalsPage
    ? 'The latest kits added to the KitCulture collection.'
    : isNationalTeamsPage
      ? 'Browse national team jerseys only.'
      : 'Browse teams, compare prices, check sizes and read the product details before adding a shirt to your bag.'

  return <section className="shop-section page-width shop-page">
    <div className="eyebrow"><span className="eyebrow-line" /> KitCulture catalogue</div>
    <div className="shop-page-title"><h1>{pageTitle}</h1><p>{pageDescription}</p></div>
    <div className="catalogue-category-list" aria-label="Shop by collection">
      <Link className={!routeCategory ? 'catalogue-category active' : 'catalogue-category'} to="/shop">All kits</Link>
      {filterCategories.map((category) => <Link key={category.id} className={routeCategory === category.slug ? 'catalogue-category active' : 'catalogue-category'} to={`/categories/${category.slug}`}>{category.name}</Link>)}
    </div>
    <div className="catalogue-filters">
      <label className="catalogue-search"><span>Search kits</span><span className="catalogue-search-control"><Search size={17} /><input aria-label="Search teams and jerseys" placeholder="Search team or jersey" value={search} onChange={(event) => setSearch(event.target.value)} /></span></label>
      <label>Kit collection<select value={collection} onChange={(event) => setCollection(event.target.value)}><option value="">All collections</option>{filterCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
      {!isNationalTeamsPage && <label>National team<select value={nationalTeamName} onChange={(event) => setNationalTeamName(event.target.value)}><option value="">All national teams</option>{NATIONAL_TEAM_NAMES.map((team) => <option key={team} value={team}>{team}</option>)}</select></label>}
      <label>Maximum price (KES)<input type="number" min="0" inputMode="numeric" placeholder="Any price" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} /></label>
      <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name</option></select></label>
    </div>
    {resultsPending ? <div className="catalogue-state"><strong>Loading teams and kits…</strong></div> : resultsError ? <div className="catalogue-state error-state"><strong>Catalogue unavailable</strong><span>{resultsError.message}. Check the API and MySQL configuration.</span></div> : routeCategory && !selectedCategory ? <div className="catalogue-state"><strong>We could not find that team or collection.</strong><span>Browse all available teams instead.</span><Link to="/shop">View all teams <ArrowRight size={15} /></Link></div> : <><p className="catalogue-results">{visible.length} {visible.length === 1 ? 'jersey' : 'jerseys'}</p><div className="shop-category-groups">{categoryGroups.map((group) => <section className="shop-category-group" key={group.slug ?? group.name}><header><div><span>COLLECTION</span><h2>{group.name}</h2></div>{group.slug && !isNewArrivalsPage && <Link to={`/categories/${group.slug}`}>Shop collection <ArrowRight size={14} /></Link>}</header><ProductsGrid products={group.products} onSave={onSave} onAdd={onAdd} /></section>)}{categoryGroups.length === 0 && <ProductsGrid products={visible} onSave={onSave} onAdd={onAdd} />}</div></>}
  </section>
}

export function ProductPage({ onAdd, onBuyNow, onSave, accountUser, portalMode = false }: { onAdd: (product: ShopProduct, selections: ShopPurchaseSelection[]) => void; onBuyNow: (product: ShopProduct, selections: ShopPurchaseSelection[], details: BuyNowCheckoutDetails) => Promise<string | void>; onSave: (productId: number) => void; accountUser: { fullName: string; email: string; phone: string | null } | null; portalMode?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const slug = pathname.match(/^\/(?:account\/marketplace\/)?products\/([^/]+)\/?$/)?.[1]
  const restoreScrollY = (location.state as { restoreScrollY?: number } | null)?.restoreScrollY
  const [activeSection, setActiveSection] = useState('product-section')
  const [selectedQuantities, setSelectedQuantities] = useState<Record<number, number>>({})
  const [imageId, setImageId] = useState<number | null>(null)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [buyFlowOpen, setBuyFlowOpen] = useState(false)
  const [buyFlowStep, setBuyFlowStep] = useState(0)
  const [buyFlowPaymentMethod, setBuyFlowPaymentMethod] = useState<'pay_on_delivery' | 'mpesa'>('pay_on_delivery')
  const [buyFlowError, setBuyFlowError] = useState('')
  const [buyFlowConfirmation, setBuyFlowConfirmation] = useState('')
  const [buyFlowBusy, setBuyFlowBusy] = useState(false)
  const [buyFlowIdempotencyKey, setBuyFlowIdempotencyKey] = useState(() => crypto.randomUUID())
  const [deliveryZoneId, setDeliveryZoneId] = useState('')
  const [deliveryPinStatus, setDeliveryPinStatus] = useState('')
  const [deliveryPin, setDeliveryPin] = useState<{ latitude: number; longitude: number; accuracy: number | null } | null>(null)
  const [deliveryPhone, setDeliveryPhone] = useState(accountUser?.phone ?? '')
  const [guestRecipientName, setGuestRecipientName] = useState(accountUser?.fullName ?? '')
  const [guestEmail, setGuestEmail] = useState(accountUser?.email ?? '')
  const [payerPhone, setPayerPhone] = useState(accountUser?.phone ?? '')
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewBody, setReviewBody] = useState('')
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [reviewNeedsLogin, setReviewNeedsLogin] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  useEffect(() => {
    if (!zoomOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoomOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [zoomOpen])
  const productQuery = useQuery({
    queryKey: ['product', slug],
    enabled: Boolean(slug),
    queryFn: () => readData<ShopProduct>(`/api/v1/products/${encodeURIComponent(slug ?? '')}`),
  })
  useEffect(() => {
    const navigationState = location.state as { openBuyFlow?: boolean } | null
    if (!navigationState?.openBuyFlow || !productQuery.data) return
    setBuyFlowStep(0)
    setBuyFlowError('')
    setBuyFlowConfirmation('')
    setBuyFlowIdempotencyKey(crypto.randomUUID())
    setBuyFlowPaymentMethod(!portalMode && !accountUser ? 'mpesa' : 'pay_on_delivery')
    setPayerPhone(accountUser?.phone ?? '')
    setDeliveryPhone(accountUser?.phone ?? '')
    setBuyFlowOpen(true)
  }, [location.state, productQuery.data, accountUser?.phone])
  const deliveryZonesQuery = useQuery({
    queryKey: ['delivery-zones'],
    enabled: buyFlowOpen,
    queryFn: async () => {
      const response = await fetch('/api/v1/delivery/zones')
      const result = await response.json() as { data?: { id: number; name: string; fee: string }[]; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Delivery areas are unavailable.')
      return result.data
    },
  })
  const paymentOptionsQuery = useQuery({
    queryKey: ['mpesa-payment-options'],
    enabled: buyFlowOpen,
    queryFn: async () => {
      const response = await fetch('/api/v1/store/payment-options')
      const result = await response.json() as { data?: { mpesaTillName: string; mpesaTillNumber: string; stkPushAvailable: boolean }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'M-Pesa details are unavailable.')
      return result.data
    },
  })
  useEffect(() => {
    if (!buyFlowOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !buyFlowBusy) setBuyFlowOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [buyFlowOpen, buyFlowBusy])
  useEffect(() => {
    if (typeof restoreScrollY !== 'number' || !productQuery.data) return
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, restoreScrollY))
    return () => window.cancelAnimationFrame(frame)
  }, [pathname, restoreScrollY, productQuery.data?.id])
  useEffect(() => {
    if (location.hash !== '#product-reviews' || !productQuery.data) return
    const frame = window.requestAnimationFrame(() => document.getElementById('product-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [location.hash, productQuery.data?.id])
  const recommendationsQuery = useQuery({
    queryKey: ['product-recommendations', productQuery.data?.id, productQuery.data?.team?.slug],
    enabled: Boolean(productQuery.data),
    queryFn: async () => {
      const currentProduct = productQuery.data
      if (!currentProduct) return []
      const params = new URLSearchParams({ limit: '12' })
      if (currentProduct.team?.slug) params.set('team', currentProduct.team.slug)
      const related = await readData<ShopProduct[]>(`/api/v1/products?${params.toString()}`)
      const recommendations = related.filter((item) => item.id !== currentProduct.id)
      if (recommendations.length >= 4) return recommendations.slice(0, 4)
      const trending = await readData<ShopProduct[]>('/api/v1/products/trending?limit=12')
      const included = new Set([currentProduct.id, ...recommendations.map((item) => item.id)])
      return [...recommendations, ...trending.filter((item) => !included.has(item.id))].slice(0, 4)
    },
  })
  useEffect(() => {
    if (!productQuery.data) return
    const sectionIds = ['product-section', 'product-reviews', 'product-description', 'product-recommend']
    const updateActiveSection = () => {
      const activationLine = portalMode ? 132 : 150
      const activeSection = sectionIds
        .map((id) => document.getElementById(id))
        .find((section) => section && section.getBoundingClientRect().bottom > activationLine)
      setActiveSection(activeSection?.id ?? sectionIds[sectionIds.length - 1])
    }
    updateActiveSection()
    window.addEventListener('scroll', updateActiveSection, { passive: true })
    window.addEventListener('resize', updateActiveSection)
    return () => {
      window.removeEventListener('scroll', updateActiveSection)
      window.removeEventListener('resize', updateActiveSection)
    }
  }, [productQuery.data?.id, portalMode])
  if (productQuery.isPending) return <section className="shop-section page-width"><div className="catalogue-state"><strong>Loading jersey…</strong></div></section>
  if (productQuery.isError || !productQuery.data) return <section className="shop-section page-width"><div className="catalogue-state error-state"><strong>Jersey unavailable</strong><span>{productQuery.error?.message ?? 'Could not find this jersey.'}</span><Link to={portalMode ? '/account/marketplace' : '/shop'}>{portalMode ? 'Back to Marketplace' : 'Back to shop'}</Link></div></section>
  const product = productQuery.data
  const selectedItems = product.variants.flatMap((variant) => {
    const quantity = selectedQuantities[variant.id] ?? 0
    return quantity > 0 ? [{ variant, quantity }] : []
  })
  const selectedQuantity = selectedItems.reduce((total, item) => total + item.quantity, 0)
  const selectedSubtotal = selectedItems.reduce((total, item) => total + Number(item.variant.price ?? product.salePrice ?? product.price) * item.quantity, 0)
  const fallbackPrice = Number(product.salePrice ?? product.price)
  const startingPrice = product.variants.length ? Math.min(...product.variants.map((variant) => Number(variant.price ?? fallbackPrice))) : fallbackPrice
  const galleryImages = product.images?.length ? product.images : product.imageUrl ? [{ id: -1, imageUrl: product.imageUrl, altText: product.name, sortOrder: 0, isPrimary: true }] : []
  const selectedImage = galleryImages.find((image) => image.id === imageId) ?? galleryImages.find((image) => image.isPrimary) ?? galleryImages[0]
  const selectedImageIndex = Math.max(0, galleryImages.findIndex((image) => image.id === selectedImage?.id))
  const imageUrl = selectedImage?.imageUrl ?? product.imageUrl
  const selectedZone = deliveryZonesQuery.data?.find((zone) => String(zone.id) === deliveryZoneId)
  const buyFlowTotal = selectedSubtotal + Number(selectedZone?.fee ?? 0)

  function changeSizeQuantity(variant: ShopVariant, quantity: number) {
    setSelectedQuantities((current) => {
      const otherQuantity = Object.entries(current).reduce((total, [id, count]) => Number(id) === variant.id ? total : total + count, 0)
      const cappedQuantity = Math.max(0, Math.min(quantity, variant.stock, 5 - otherQuantity))
      const next = { ...current }
      if (cappedQuantity) next[variant.id] = cappedQuantity
      else delete next[variant.id]
      return next
    })
  }

  function pinDeliveryLocation() {
    setDeliveryPin(null)
    setDeliveryPinStatus('Finding your delivery location…')
    if (!navigator.geolocation) {
      setDeliveryPinStatus('Location sharing is not available in this browser. You can continue without a pin.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeliveryPin({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy })
        setDeliveryPinStatus(`Location pinned with approximately ${Math.round(position.coords.accuracy)} m accuracy.`)
      },
      (error) => setDeliveryPinStatus(error.code === error.PERMISSION_DENIED
        ? 'Allow location access in your browser to pin the delivery location.'
        : 'Your location could not be found. You can continue without a pin.'),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    )
  }

  async function submitBuyFlow(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (event && !event.currentTarget.reportValidity()) return
    if (buyFlowStep === 1) {
      if (deliveryZonesQuery.isError || !deliveryZonesQuery.data?.length) {
        setBuyFlowError(deliveryZonesQuery.error?.message ?? 'Delivery areas are unavailable. Please try again later.')
        return
      }
      if (!selectedZone) {
        setBuyFlowError('Choose a delivery area before continuing.')
        return
      }
      setBuyFlowError('')
      setBuyFlowStep(2)
      return
    }
    if (buyFlowStep === 2) {
      if (!portalMode && !accountUser && buyFlowPaymentMethod !== 'mpesa') {
        setBuyFlowError('Guests can pay online only. Sign up or sign in to use Pay on Delivery.')
        return
      }
      if (buyFlowPaymentMethod === 'mpesa' && !paymentOptionsQuery.data?.stkPushAvailable) {
        setBuyFlowError('M-Pesa prompts are not available right now. Choose Pay on Delivery or try again later.')
        return
      }
      if (buyFlowPaymentMethod === 'mpesa' && !/^(?:0[17]\d{8}|\+?254[17]\d{8})$/.test(payerPhone.replace(/[\s()-]/g, ''))) {
        setBuyFlowError('Enter a valid Kenyan M-PESA phone number.')
        return
      }
      setBuyFlowError('')
      setBuyFlowStep(3)
      return
    }
    if (buyFlowStep !== 3 || !selectedItems.length) return
    if (!selectedZone) {
      setBuyFlowError('Choose a delivery area before continuing.')
      setBuyFlowStep(1)
      return
    }
    setBuyFlowBusy(true)
    setBuyFlowError('')
    try {
      const confirmation = await onBuyNow(product, selectedItems, {
        idempotencyKey: buyFlowIdempotencyKey,
        deliveryZoneId: selectedZone.id,
        paymentMethod: buyFlowPaymentMethod,
        email: accountUser?.email ?? guestEmail,
        payerPhone,
        recipientName: accountUser?.fullName ?? guestRecipientName,
        phone: deliveryPhone,
        ...(deliveryPin ? { latitude: deliveryPin.latitude, longitude: deliveryPin.longitude } : {}),
        ...(deliveryPin?.accuracy !== null && deliveryPin ? { accuracy: deliveryPin.accuracy } : {}),
      })
      if (!portalMode && !accountUser) {
        setBuyFlowConfirmation(confirmation ?? 'Your guest order was created. Check your phone for the M-PESA prompt.')
        setBuyFlowBusy(false)
      }
    } catch (issue) {
      setBuyFlowError(issue instanceof Error ? issue.message : 'We could not complete your order.')
      setBuyFlowBusy(false)
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setReviewBusy(true)
    setReviewMessage('')
    setReviewError('')
    setReviewNeedsLogin(false)
    try {
      const response = await fetch(`/api/v1/account/products/${product.id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: reviewRating, body: reviewBody }),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) {
        if (response.status === 401) setReviewNeedsLogin(true)
        throw new Error(result.error?.message ?? 'Your review could not be submitted.')
      }
      setReviewBody('')
      setReviewMessage('Thanks for sharing your review.')
      await productQuery.refetch()
    } catch (issue) {
      setReviewError(issue instanceof Error ? issue.message : 'Your review could not be submitted.')
    } finally {
      setReviewBusy(false)
    }
  }

  function jumpToSection(event: MouseEvent<HTMLAnchorElement>, sectionId: string) {
    event.preventDefault()
    setActiveSection(sectionId)
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  return <section className={`shop-section page-width product-page${portalMode ? ' portal-product-page' : ''}`}>
    <Link className="product-back" to={portalMode ? '/account/marketplace' : '/shop'}><ArrowLeft size={16} /> {portalMode ? 'Back to Marketplace' : 'Back to all teams'}</Link>
    <nav className="product-section-nav" aria-label="Product page sections">{[
      ['product-section', 'Product'],
      ['product-reviews', 'Reviews'],
      ['product-description', 'Description'],
      ['product-recommend', 'Recommend'],
    ].map(([id, label]) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} className={activeSection === id ? 'is-active' : ''} onClick={(event) => jumpToSection(event, id)}>{label}</a>)}</nav>
    <div className="product-detail" id="product-section">
      <div><div className="product-detail-image">{imageUrl ? <button type="button" className="product-image-zoom" onClick={() => setZoomOpen(true)} aria-label={`Enlarge ${selectedImage?.altText ?? product.name}`}><img src={imageUrl} alt={selectedImage?.altText ?? product.name} /><span><Maximize2 size={16} /> Enlarge</span></button> : <div className="product-image-empty"><span>KC</span><small>IMAGE NOT PROVIDED</small></div>}</div>
        {(product.images?.length ?? 0) > 1 && <div className="product-gallery-thumbnails" aria-label="Product images">{product.images?.map((image) => <button type="button" key={image.id} className={(selectedImage?.id ?? null) === image.id ? 'active' : ''} aria-label={`View ${image.altText}`} aria-pressed={(selectedImage?.id ?? null) === image.id} onClick={() => setImageId(image.id)}><img src={image.imageUrl} alt="" /></button>)}</div>}
        {!portalMode && <section className="product-size-card" aria-labelledby="product-size-title"><h2 id="product-size-title">Choose sizes</h2><div className="product-size-list">{product.variants.map((variant) => {
          const quantity = selectedQuantities[variant.id] ?? 0
          const maxForVariant = Math.min(variant.stock, 5 - selectedQuantity + quantity)
          return <article className={quantity ? 'product-size-option is-selected' : 'product-size-option'} key={variant.id}>
            <label className="product-size-choice"><input type="checkbox" checked={quantity > 0} disabled={!variant.stock} onChange={(event) => changeSizeQuantity(variant, event.target.checked ? 1 : 0)} /><span>{variant.size}</span><strong>{money.format(Number(variant.price ?? product.salePrice ?? product.price))}</strong><small>{variant.stock > 0 ? `${variant.stock} available` : 'Sold out'}</small></label>
            <div className="product-size-quantity"><button type="button" aria-label={`Decrease ${variant.size} quantity`} disabled={!quantity} onClick={() => changeSizeQuantity(variant, quantity - 1)}>−</button><input type="number" aria-label={`${variant.size} quantity`} min="1" max={maxForVariant} value={quantity || 1} disabled={!quantity} onChange={(event) => changeSizeQuantity(variant, Number(event.target.value) || 1)} /><button type="button" aria-label={`Increase ${variant.size} quantity`} disabled={!quantity || quantity >= maxForVariant} onClick={() => changeSizeQuantity(variant, quantity + 1)}>+</button></div>
          </article>
        })}</div><small className="product-size-limit">Choose multiple sizes if needed. Maximum 5 kits total, limited by available stock.</small></section>}
        {(product.videos?.length ?? 0) > 0 && <section className="product-video-gallery" aria-label="Product videos"><h2>Kit in motion</h2>{product.videos?.map((video) => {
          const embedUrl = videoEmbedUrl(video.videoUrl)
          return <article key={video.id}><h3>{video.title}</h3>{embedUrl ? <iframe src={embedUrl} title={video.title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <video src={video.videoUrl} controls playsInline preload="metadata">Your browser does not support video playback.</video>}</article>
        })}</section>}
      </div>
      <div className="product-detail-copy"><span className="product-category">{[product.league?.name, product.team?.name, product.jerseyCategory?.name, product.category?.name].filter(Boolean).join(' · ') || 'Football kit'}</span><h1>{product.name}</h1><strong className="product-detail-price">{selectedQuantity ? money.format(selectedSubtotal) : <>From {money.format(startingPrice)}{product.salePrice && <del>{money.format(Number(product.price))}</del>}</>}</strong>
        <p className="product-price-note">Select one or more sizes below the kit image. Choose up to 5 kits total, subject to stock.</p>
        {portalMode && <section className="product-size-card" aria-labelledby="product-size-title"><h2 id="product-size-title">Choose sizes</h2><div className="product-size-list">{product.variants.map((variant) => {
          const quantity = selectedQuantities[variant.id] ?? 0
          const maxForVariant = Math.min(variant.stock, 5 - selectedQuantity + quantity)
          return <article className={quantity ? 'product-size-option is-selected' : 'product-size-option'} key={variant.id}>
            <label className="product-size-choice"><input type="checkbox" checked={quantity > 0} disabled={!variant.stock} onChange={(event) => changeSizeQuantity(variant, event.target.checked ? 1 : 0)} /><span>{variant.size}</span><strong>{money.format(Number(variant.price ?? product.salePrice ?? product.price))}</strong><small>{variant.stock > 0 ? `${variant.stock} available` : 'Sold out'}</small></label>
            <div className="product-size-quantity"><button type="button" aria-label={`Decrease ${variant.size} quantity`} disabled={!quantity} onClick={() => changeSizeQuantity(variant, quantity - 1)}>−</button><input type="number" aria-label={`${variant.size} quantity`} min="1" max={maxForVariant} value={quantity || 1} disabled={!quantity} onChange={(event) => changeSizeQuantity(variant, Number(event.target.value) || 1)} /><button type="button" aria-label={`Increase ${variant.size} quantity`} disabled={!quantity || quantity >= maxForVariant} onClick={() => changeSizeQuantity(variant, quantity + 1)}>+</button></div>
          </article>
        })}</div><small className="product-size-limit">Choose multiple sizes if needed. Maximum 5 kits total, limited by available stock.</small></section>}
        <p className="product-purchase-total"><span>{selectedQuantity} {selectedQuantity === 1 ? 'kit' : 'kits'} selected</span><strong>{money.format(selectedSubtotal)}</strong></p>
        <button className="button button-outline product-add" type="button" disabled={!selectedItems.length} onClick={() => selectedItems.length && onAdd(product, selectedItems)}>Add to bag<ArrowRight size={16} /></button>
        <button className="button button-green product-buy-now" type="button" disabled={!product.variants.some((variant) => variant.stock > 0)} onClick={() => { setBuyFlowStep(0); setBuyFlowPaymentMethod(!portalMode && !accountUser ? 'mpesa' : 'pay_on_delivery'); setBuyFlowError(''); setBuyFlowConfirmation(''); setBuyFlowIdempotencyKey(crypto.randomUUID()); setPayerPhone(accountUser?.phone ?? ''); setBuyFlowOpen(true) }}>Buy now <ArrowRight size={16} /></button>
        <div className="product-secondary-actions"><button className="wishlist-add" type="button" onClick={() => onSave(product.id)}>Save to wishlist</button>
        {portalMode && <button className="product-chat-button" type="button" onClick={() => navigate('/account/chat', { state: {
          draft: `Hi KitCulture Admin, I’m interested in ${product.name}. The listed price is ${money.format(startingPrice)}. Is it available?`,
          product: { name: product.name, price: startingPrice, imageUrl: imageUrl ?? null, productUrl: pathname },
          returnTo: { pathname, scrollY: window.scrollY },
        } })}><MessageCircle size={16} /> Chat about this kit</button>}</div>
        <p className="product-price-note">Price and available stock are checked again by the server when an order is placed.</p>
      </div>
    </div>
    {buyFlowOpen && <div className="buy-flow-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !buyFlowBusy) setBuyFlowOpen(false) }}><section className="buy-flow-dialog" role="dialog" aria-modal="true" aria-labelledby="buy-flow-title">
      <header className="buy-flow-heading"><div><span className="eyebrow">{buyFlowConfirmation ? 'GUEST ORDER · PAYMENT STATUS' : `SECURE CHECKOUT · STEP ${buyFlowStep + 1} OF 4`}</span><h2 id="buy-flow-title">{buyFlowConfirmation ? 'Order submitted' : ['Your kit', 'Delivery location', 'Payment method', 'Review order'][buyFlowStep]}</h2></div><button className="icon-button" type="button" aria-label="Close checkout" disabled={buyFlowBusy} onClick={() => setBuyFlowOpen(false)}><X /></button></header>
      <div className="buy-flow-progress" aria-label={`Step ${buyFlowStep + 1} of 4`}><span style={{ width: `${(buyFlowStep + 1) * 25}%` }} /></div>
      {buyFlowConfirmation ? <div className="buy-flow-content" role="status"><p className="buy-flow-confirmation">{buyFlowConfirmation}</p><button className="button button-green" type="button" onClick={() => setBuyFlowOpen(false)}>Close checkout</button></div> : buyFlowStep === 0 ? <div className="buy-flow-content">
        <div className="buy-flow-product">{imageUrl ? <img src={imageUrl} alt={product.name} /> : <div className="cart-image-placeholder">KC</div>}<div><span className="product-category">{[product.team?.name, product.jerseyCategory?.name, product.category?.name].filter(Boolean).join(' · ') || 'Football kit'}</span><h3>{product.name}</h3><p>{product.description}</p></div></div>
        <div className="buy-flow-size-list"><h3>Choose size and quantity</h3>{product.variants.map((variant) => {
          const quantity = selectedQuantities[variant.id] ?? 0
          const maxForVariant = Math.min(variant.stock, 5 - selectedQuantity + quantity)
          return <div className="buy-flow-size" key={variant.id}><label><input type="checkbox" checked={quantity > 0} disabled={!variant.stock} onChange={(event) => changeSizeQuantity(variant, event.target.checked ? 1 : 0)} /><strong>{variant.size}</strong><span>{money.format(Number(variant.price ?? product.salePrice ?? product.price))}</span></label><div className="quantity-control"><button type="button" disabled={!quantity} aria-label={`Decrease ${variant.size} quantity`} onClick={() => changeSizeQuantity(variant, quantity - 1)}>−</button><span>{quantity}</span><button type="button" disabled={!quantity || quantity >= maxForVariant} aria-label={`Increase ${variant.size} quantity`} onClick={() => changeSizeQuantity(variant, quantity + 1)}>+</button></div></div>
        })}</div>
        <div className="buy-flow-total"><span>{selectedQuantity} {selectedQuantity === 1 ? 'kit' : 'kits'} · subtotal</span><strong>{money.format(selectedSubtotal)}</strong></div>
        <button className="button button-green" type="button" disabled={!selectedItems.length} onClick={() => { setBuyFlowStep(1); setBuyFlowError('') }}>Continue to delivery <ArrowRight size={16} /></button>
      </div> : <form className="buy-flow-content" onSubmit={(event) => void submitBuyFlow(event)} noValidate>
        {buyFlowStep === 1 && <>
          {deliveryZonesQuery.isPending ? <p>Loading delivery areas…</p> : deliveryZonesQuery.isError ? <p className="buy-flow-error">{deliveryZonesQuery.error.message}</p> : <label>Delivery area<select required value={deliveryZoneId} onChange={(event) => setDeliveryZoneId(event.target.value)}><option value="">Choose an area</option>{deliveryZonesQuery.data?.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {money.format(Number(zone.fee))}</option>)}</select></label>}
          {!portalMode && !accountUser && <label>Recipient full name<input autoComplete="name" required minLength={2} maxLength={160} value={guestRecipientName} onChange={(event) => setGuestRecipientName(event.target.value)} /></label>}
          {!portalMode && !accountUser && <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} /></label>}
          <label>Delivery recipient phone<input type="tel" inputMode="tel" autoComplete="tel" required minLength={7} maxLength={20} value={deliveryPhone} onChange={(event) => setDeliveryPhone(event.target.value)} /></label>
          <p className="buy-flow-hint">Choose a delivery area. Pinning your exact location is optional.</p>
          <button className="button button-outline checkout-location-button" type="button" onClick={pinDeliveryLocation}><MapPin size={15} /> Pin my delivery location</button>
          {deliveryPinStatus && <p className="checkout-location-status" role="status">{deliveryPinStatus}</p>}
          {deliveryPin && <GoogleMapView latitude={deliveryPin.latitude} longitude={deliveryPin.longitude} title="Pinned delivery location" />}
        </>}
        {buyFlowStep === 2 && <>
          <fieldset className="checkout-payment-options">
            <legend>Payment method</legend>
            <label className={`checkout-payment-option${!portalMode && !accountUser ? ' is-unavailable' : ''}`}><input type="radio" name="buyFlowPaymentMethod" value="pay_on_delivery" checked={buyFlowPaymentMethod === 'pay_on_delivery'} disabled={!portalMode && !accountUser} onChange={() => { setBuyFlowPaymentMethod('pay_on_delivery'); setBuyFlowError('') }} /><span><strong>Pay on Delivery</strong><small>{!portalMode && !accountUser ? 'Available after you sign up or sign in.' : 'Pay when your kit is delivered.'}</small></span></label>
            <label className="checkout-payment-option"><input type="radio" name="buyFlowPaymentMethod" value="mpesa" checked={buyFlowPaymentMethod === 'mpesa'} disabled={!paymentOptionsQuery.data?.stkPushAvailable} onChange={() => { setBuyFlowPaymentMethod('mpesa'); setBuyFlowError('') }} /><span><strong>M-PESA Express</strong><small>{paymentOptionsQuery.data?.stkPushAvailable ? 'Approve a payment prompt on your phone.' : 'Temporarily unavailable.'}</small></span></label>
          </fieldset>
          {!portalMode && !accountUser && <p className="buy-flow-hint">Guest checkout requires online payment. <Link to={`/login?returnTo=${encodeURIComponent(pathname)}`}>Sign up or sign in</Link> to use Pay on Delivery.</p>}
          {buyFlowPaymentMethod === 'mpesa' ? <>
            <div className="buy-flow-payment-merchant"><Smartphone size={20} /><div><strong>{paymentOptionsQuery.data?.mpesaTillName || 'KitCulture'}</strong><span>Secure M-Pesa prompt · Buy Goods Till</span></div></div>
            <KenyanPhoneInput label="Phone number to pay from" value={payerPhone} onChange={setPayerPhone} />
            <p className="buy-flow-hint">The payment prompt will be sent to this Kenyan number. Delivery contact details are entered separately.</p>
          </> : <p className="buy-flow-hint">Pay {money.format(buyFlowTotal)} when your order is delivered.</p>}
        </>}
        {buyFlowStep === 3 && <>
          <div className="buy-flow-review"><h3>Order summary</h3>{selectedItems.map(({ variant, quantity }) => <div key={variant.id}><span>{product.name} · size {variant.size} × {quantity}</span><strong>{money.format(Number(variant.price ?? product.salePrice ?? product.price) * quantity)}</strong></div>)}<div><span>Delivery · {selectedZone?.name}</span><strong>{money.format(Number(selectedZone?.fee ?? 0))}</strong></div><div className="buy-flow-grand-total"><span>{buyFlowPaymentMethod === 'mpesa' ? 'Amount to approve' : 'Total due on delivery'}</span><strong>{money.format(buyFlowTotal)}</strong></div></div>
          {buyFlowPaymentMethod === 'mpesa' ? <div className="buy-flow-review buy-flow-payee"><h3>Payment details</h3><div><span>Expected recipient</span><strong>{paymentOptionsQuery.data?.mpesaTillName || 'KitCulture'}</strong></div><div><span>Buy Goods Till</span><strong>{paymentOptionsQuery.data?.mpesaTillNumber || 'Not configured'}</strong></div><div><span>Prompt sent to</span><strong>{payerPhone}</strong></div><div><span>{portalMode ? 'Account name' : 'Customer'}</span><strong>{accountUser?.fullName || (portalMode ? 'Sign in required' : 'Guest checkout')}</strong></div></div> : <div className="buy-flow-review buy-flow-payee"><h3>Payment method</h3><div><span>Selected option</span><strong>Pay on Delivery</strong></div><div><span>Delivery area</span><strong>{selectedZone?.name}</strong></div></div>}
          <p className="buy-flow-hint">{buyFlowPaymentMethod === 'mpesa' ? 'Tap Proceed to send the payment request. Confirm the displayed merchant and amount on your phone before approving.' : 'Place your order now and pay when it arrives.'}</p>
          {!accountUser && <Link className="buy-flow-signin" to={`/login?returnTo=${encodeURIComponent(pathname)}`}>{portalMode ? 'Sign in to place this order' : 'Sign up or sign in for Pay on Delivery'} <ArrowRight size={14} /></Link>}
        </>}
        {buyFlowError && <p className="buy-flow-error" role="alert">{buyFlowError}</p>}
        <div className="buy-flow-actions"><button className="button button-outline" type="button" disabled={buyFlowBusy} onClick={() => { setBuyFlowError(''); setBuyFlowStep(buyFlowStep - 1) }}>Back</button>{buyFlowStep < 3 ? <button className="button button-green" type="submit" disabled={(buyFlowStep === 1 && deliveryZonesQuery.isPending) || (buyFlowStep === 2 && buyFlowPaymentMethod === 'mpesa' && (!payerPhone || !paymentOptionsQuery.data?.stkPushAvailable))}>Continue <ArrowRight size={16} /></button> : <button className="button button-green" type="button" disabled={buyFlowBusy || (buyFlowPaymentMethod === 'mpesa' && !paymentOptionsQuery.data?.stkPushAvailable)} onClick={() => void submitBuyFlow()}>{buyFlowBusy ? 'Placing order…' : buyFlowPaymentMethod === 'mpesa' ? 'Send M-Pesa prompt' : 'Place order'} <ArrowRight size={16} /></button>}</div>
      </form>}
    </section></div>}
    {zoomOpen && imageUrl && <div className="product-lightbox" role="dialog" aria-modal="true" aria-label={`${product.name} image preview`} onClick={(event) => { if (event.target === event.currentTarget) setZoomOpen(false) }}>
      <button type="button" className="product-lightbox-close" aria-label="Close image preview" onClick={() => setZoomOpen(false)}><X size={22} /></button>
      {galleryImages.length > 1 && <button type="button" className="product-lightbox-previous" aria-label="Previous product image" onClick={() => setImageId(galleryImages[(selectedImageIndex - 1 + galleryImages.length) % galleryImages.length]?.id ?? null)}><ChevronLeft size={28} /></button>}
      <img src={imageUrl} alt={selectedImage?.altText ?? product.name} />
      {galleryImages.length > 1 && <button type="button" className="product-lightbox-next" aria-label="Next product image" onClick={() => setImageId(galleryImages[(selectedImageIndex + 1) % galleryImages.length]?.id ?? null)}><ChevronRight size={28} /></button>}
      <span>{galleryImages.length > 1 ? `${selectedImageIndex + 1} / ${galleryImages.length} · ` : ''}{selectedImage?.altText ?? product.name}</span>
    </div>}
    <section className="product-reviews" id="product-reviews" aria-labelledby="product-reviews-title">
      <div className="product-reviews-heading"><div><span className="eyebrow">From the stands</span><h2 id="product-reviews-title">Customer reviews</h2></div><div className="product-review-summary"><span className="product-rating-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={17} fill={star <= Math.round(product.ratingAverage ?? 0) ? 'currentColor' : 'none'} />)}</span><strong>{(product.ratingAverage ?? 0).toFixed(1)}</strong><span>({product.reviewCount ?? 0})</span></div></div>
      <div className="product-review-list">{product.reviews?.length ? product.reviews.map((review) => <article key={review.id}><div className="product-review-author"><strong>{review.reviewerName}</strong><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time></div><span className="product-rating-stars" aria-label={`${review.rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={14} fill={star <= review.rating ? 'currentColor' : 'none'} />)}</span><p>{review.body}</p></article>) : <p className="product-review-empty">No reviews yet. Be the first to share your take on this jersey.</p>}</div>
      <form className="product-review-form" onSubmit={(event) => void submitReview(event)}><h3>Rate this jersey</h3><fieldset><legend>Your rating</legend><div className="product-rating-picker">{[1, 2, 3, 4, 5].map((rating) => <button type="button" key={rating} aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`} aria-pressed={reviewRating === rating} onClick={() => setReviewRating(rating)}><Star size={22} fill={rating <= reviewRating ? 'currentColor' : 'none'} /></button>)}</div></fieldset><label>Your review<textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} minLength={10} maxLength={2000} required rows={4} placeholder="What do you think of the fit, fabric, and finish?" /></label>{reviewError && <p className="product-review-error" role="alert">{reviewError}{reviewNeedsLogin && <> <Link to={`/login?returnTo=${encodeURIComponent(pathname)}`}>Sign in to continue</Link>.</>}</p>}{reviewMessage && <p className="product-review-success" role="status">{reviewMessage}</p>}<button className="button button-green" type="submit" disabled={reviewBusy}>{reviewBusy ? 'Submitting…' : 'Submit review'} <ArrowRight size={15} /></button><small>Sign in to submit. Your next review for this jersey will update your existing rating.</small></form>
    </section>
    <section className="product-description-section" id="product-description" aria-labelledby="product-description-title"><h2 id="product-description-title">About this kit</h2><div className="product-description-card"><div className="product-description-scroll" role="region" aria-label={`${product.name} description`} tabIndex={0}><p>{product.description}</p></div></div></section>
    <section className="product-recommend-section" id="product-recommend" aria-labelledby="product-recommend-title"><div className="product-recommend-heading"><div><span className="eyebrow">Keep exploring</span><h2 id="product-recommend-title">Recommended kits</h2></div><Link className="text-link" to={portalMode ? '/account/marketplace' : '/marketplace'}>Browse all kits <ArrowRight size={14} /></Link></div>{recommendationsQuery.isPending ? <div className="catalogue-state"><strong>Finding more kits…</strong></div> : recommendationsQuery.isError ? <div className="catalogue-state error-state"><strong>Recommendations unavailable</strong><span>{recommendationsQuery.error.message}</span></div> : recommendationsQuery.data?.length ? <ProductsGrid products={recommendationsQuery.data} onSave={onSave} onAdd={portalMode ? undefined : (recommended) => { const variant = recommended.variants.find((item) => item.stock > 0); if (variant) onAdd(recommended, [{ variant, quantity: 1 }]) }} portalMode={portalMode} /> : <div className="catalogue-state"><strong>No other kits to recommend yet.</strong><span>Check back as more kits are added.</span></div>}</section>
  </section>
}
