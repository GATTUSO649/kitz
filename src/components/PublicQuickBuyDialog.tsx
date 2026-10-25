import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, MapPin, Smartphone, X } from 'lucide-react'
import { GoogleMapView } from './GoogleMapView'
import type { BuyNowCheckoutDetails, BuyNowCheckoutResult, QuickBuyProduct, ShopPurchaseSelection } from '../pages/ShopPages'

type DeliveryZone = { id: number; name: string; fee: string }
type PaymentOptions = { mpesaTillName: string; mpesaTillNumber: string; stkPushAvailable: boolean }
type CustomerDetails = { fullName: string; phone: string | null } | null

const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })

export function PublicQuickBuyDialog({ product, accountUser, onClose, onBuyNow }: {
  product: QuickBuyProduct
  accountUser: CustomerDetails
  onClose: () => void
  onBuyNow: (product: QuickBuyProduct, selections: ShopPurchaseSelection[], details: BuyNowCheckoutDetails, stayOnPage: boolean) => Promise<BuyNowCheckoutResult>
}) {
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    const available = product.variants.find((variant) => variant.stock > 0)
    return available ? { [available.id]: 1 } : {}
  })
  const [recipientName, setRecipientName] = useState(accountUser?.fullName ?? '')
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [deliveryPhone, setDeliveryPhone] = useState(accountUser?.phone ?? '')
  const [payerPhone, setPayerPhone] = useState(accountUser?.phone ?? '')
  const [deliveryZoneId, setDeliveryZoneId] = useState('')
  const [address, setAddress] = useState('')
  const [county, setCounty] = useState('Machakos')
  const [town, setTown] = useState('Machakos')
  const [estate, setEstate] = useState('')
  const [landmark, setLandmark] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [locationMessage, setLocationMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<BuyNowCheckoutResult | null>(null)

  const zonesQuery = useQuery({
    queryKey: ['delivery-zones'],
    queryFn: async () => {
      const response = await fetch('/api/v1/delivery/zones')
      const result = await response.json() as { data?: DeliveryZone[]; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Delivery areas are unavailable.')
      return result.data
    },
  })
  const paymentOptionsQuery = useQuery({
    queryKey: ['mpesa-payment-options'],
    queryFn: async () => {
      const response = await fetch('/api/v1/store/payment-options')
      const result = await response.json() as { data?: PaymentOptions; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'M-PESA is unavailable.')
      return result.data
    },
  })

  const selections = product.variants.flatMap((variant) => {
    const quantity = quantities[variant.id] ?? 0
    return quantity > 0 ? [{ variant, quantity }] : []
  })
  const selectedTotal = selections.reduce((sum, selection) => sum + Number(selection.variant.price ?? product.salePrice ?? product.price) * selection.quantity, 0)
  const deliveryFee = Number(zonesQuery.data?.find((zone) => String(zone.id) === deliveryZoneId)?.fee ?? 0)
  const total = selectedTotal + deliveryFee

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [busy, onClose])

  function changeQuantity(variantId: number, quantity: number, stock: number) {
    setQuantities((current) => {
      const otherQuantity = Object.entries(current).reduce((sum, [id, count]) => Number(id) === variantId ? sum : sum + count, 0)
      const nextQuantity = Math.max(0, Math.min(quantity, stock, 5 - otherQuantity))
      const next = { ...current }
      if (nextQuantity) next[variantId] = nextQuantity
      else delete next[variantId]
      return next
    })
  }

  function pinLocation() {
    setLocationMessage('')
    if (!navigator.geolocation) {
      setLocationMessage('Location services are unavailable. Enter the coordinates manually.')
      return
    }
    navigator.geolocation.getCurrentPosition((position) => {
      setLatitude(String(position.coords.latitude))
      setLongitude(String(position.coords.longitude))
      setAccuracy(position.coords.accuracy)
      setLocationMessage(`Location pinned within about ${Math.round(position.coords.accuracy)} m.`)
    }, () => setLocationMessage('Could not get your location. Enter the coordinates manually.'), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!event.currentTarget.reportValidity()) return
    if (!selections.length) {
      setError('Choose at least one size and quantity.')
      return
    }
    if (!paymentOptionsQuery.data?.stkPushAvailable) {
      setError('M-PESA prompts are unavailable right now. Please try again later.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await onBuyNow(product, selections, {
        idempotencyKey,
        deliveryZoneId: Number(deliveryZoneId),
        paymentMethod: 'mpesa',
        payerPhone,
        recipientName,
        phone: deliveryPhone,
        address,
        county,
        town,
        estate,
        landmark,
        latitude: Number(latitude),
        longitude: Number(longitude),
        ...(accuracy !== null ? { accuracy } : {}),
      }, true)
      setConfirmation(result)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'The order could not be placed.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="buy-flow-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="buy-flow-dialog quick-buy-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-buy-title">
      <header className="buy-flow-heading"><div><span className="eyebrow">{confirmation ? 'ORDER RECEIVED' : 'QUICK CHECKOUT · M-PESA'}</span><h2 id="quick-buy-title">{confirmation ? 'Payment prompt requested' : 'Buy this kit'}</h2></div><button className="icon-button" type="button" aria-label="Close checkout" disabled={busy} onClick={onClose}><X /></button></header>
      <div className="buy-flow-progress"><span style={{ width: confirmation ? '100%' : '40%' }} /></div>
      {confirmation ? <div className="buy-flow-content"><div className="buy-flow-review"><h3>Order {confirmation.orderNumber}</h3><p className="buy-flow-hint">{confirmation.message}</p></div><button className="button button-green" type="button" onClick={onClose}>Continue shopping <ArrowRight size={16} /></button></div> : <form className="buy-flow-content" onSubmit={(event) => void submit(event)}>
        <div className="quick-buy-product">{product.imageUrl && <img src={product.imageUrl} alt="" />}<div><strong>{product.name}</strong><span>Select size and quantity. Up to 5 kits per order.</span></div></div>
        <section className="quick-buy-sizes" aria-label="Choose size and quantity">{product.variants.map((variant) => {
          const quantity = quantities[variant.id] ?? 0
          const maxQuantity = Math.min(variant.stock, 5 - selections.reduce((sum, selection) => sum + selection.quantity, 0) + quantity)
          return <div key={variant.id}><label><input type="checkbox" checked={quantity > 0} disabled={!variant.stock} onChange={(event) => changeQuantity(variant.id, event.target.checked ? 1 : 0, variant.stock)} /><strong>{variant.size}</strong><span>{money.format(Number(variant.price ?? product.salePrice ?? product.price))}</span></label><div className="quantity-control"><button type="button" aria-label={`Decrease ${variant.size} quantity`} disabled={!quantity} onClick={() => changeQuantity(variant.id, quantity - 1, variant.stock)}>−</button><span>{quantity}</span><button type="button" aria-label={`Increase ${variant.size} quantity`} disabled={!quantity || quantity >= maxQuantity} onClick={() => changeQuantity(variant.id, quantity + 1, variant.stock)}>+</button></div></div>
        })}</section>
        <label>Recipient full name<input required minLength={2} maxLength={160} autoComplete="name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></label>
        <label>Delivery phone<input type="tel" inputMode="tel" autoComplete="tel" required minLength={7} maxLength={20} value={deliveryPhone} onChange={(event) => setDeliveryPhone(event.target.value)} /></label>
        <label>Delivery area<select required value={deliveryZoneId} onChange={(event) => setDeliveryZoneId(event.target.value)}><option value="">{zonesQuery.isPending ? 'Loading areas…' : 'Choose an area'}</option>{zonesQuery.data?.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {money.format(Number(zone.fee))}</option>)}</select></label>
        {zonesQuery.isError && <p className="buy-flow-error">{zonesQuery.error.message}</p>}
        <label>Street address or building<input required minLength={3} maxLength={180} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <div className="checkout-fields"><label>County<input required maxLength={80} value={county} onChange={(event) => setCounty(event.target.value)} /></label><label>Town<input required maxLength={100} value={town} onChange={(event) => setTown(event.target.value)} /></label></div>
        <div className="checkout-fields"><label>Estate <span>(optional)</span><input maxLength={100} value={estate} onChange={(event) => setEstate(event.target.value)} /></label><label>Landmark <span>(optional)</span><input maxLength={180} value={landmark} onChange={(event) => setLandmark(event.target.value)} /></label></div>
        <button className="button button-outline checkout-location-button" type="button" onClick={pinLocation}><MapPin size={15} /> Pin my delivery location</button>
        {locationMessage && <p className="checkout-location-status" role="status">{locationMessage}</p>}
        <div className="checkout-fields"><label>Latitude<input type="number" step="any" min="-90" max="90" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>Longitude<input type="number" step="any" min="-180" max="180" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div>
        {latitude && longitude && <GoogleMapView latitude={Number(latitude)} longitude={Number(longitude)} title="Pinned delivery location" />}
        <section className="quick-buy-payment"><div><Smartphone size={18} /><span><strong>{paymentOptionsQuery.data?.mpesaTillName ?? 'M-PESA Express'}</strong><small>Secure prompt · Till {paymentOptionsQuery.data?.mpesaTillNumber ?? 'loading'}</small></span></div><label>M-PESA number<input type="tel" inputMode="tel" autoComplete="tel" required pattern="(?:0[17][0-9]{8}|\+?254[17][0-9]{8})" maxLength={13} placeholder="0712345678" value={payerPhone} onChange={(event) => setPayerPhone(event.target.value)} /></label><small>Guest checkout uses M-PESA only. Approve the prompt on your phone; never share your PIN.</small></section>
        {paymentOptionsQuery.isError && <p className="buy-flow-error">{paymentOptionsQuery.error.message}</p>}
        <div className="buy-flow-review"><h3>Order total</h3><div><span>Items subtotal</span><strong>{money.format(selectedTotal)}</strong></div><div><span>Delivery</span><strong>{money.format(deliveryFee)}</strong></div><div className="buy-flow-grand-total"><span>Amount to approve</span><strong>{money.format(total)}</strong></div></div>
        {error && <p className="buy-flow-error" role="alert">{error}</p>}
        <button className="button button-green quick-buy-submit" type="submit" disabled={busy || zonesQuery.isPending || paymentOptionsQuery.isPending || !paymentOptionsQuery.data?.stkPushAvailable}>{busy ? 'Requesting M-PESA prompt…' : `Send M-PESA prompt · ${money.format(total)}`} <ArrowRight size={16} /></button>
      </form>}
    </section>
  </div>
}