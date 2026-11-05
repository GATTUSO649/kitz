import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ImagePlus, LoaderCircle, Trash2, Upload } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

type Subcategory = { id: string; name: string; slug: string }
type Category = { id: string; name: string; slug: string; subcategories: Subcategory[] }
type County = { code: string; name: string }
type Submission = { reference: string; slug: string; statusToken: string; publicationFeeKes: number; status: string }
type SellerFormValues = {
  title: string; description: string; categoryId: string; subcategoryId: string; condition: string; priceKes: string; negotiable: boolean
  name: string; phone: string; whatsapp: string; email: string; countyCode: string; subcounty: string; town: string; area: string
}

const initialValues: SellerFormValues = {
  title: '', description: '', categoryId: '', subcategoryId: '', condition: 'good', priceKes: '', negotiable: true,
  name: '', phone: '', whatsapp: '', email: '', countyCode: '016', subcounty: '', town: '', area: '',
}
const formatKes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`

export function SellListingPage() {
  const [values, setValues] = useState(initialValues)
  const [categories, setCategories] = useState<Category[]>([])
  const [counties, setCounties] = useState<County[]>([])
  const [step, setStep] = useState(1)
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [pageError, setPageError] = useState('')
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [imageError, setImageError] = useState('')
  const [paymentPhone, setPaymentPhone] = useState('')
  const [paying, setPaying] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [published, setPublished] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoadingData(true)
    Promise.all([
      fetch('/api/v1/marketplace/categories', { signal: controller.signal }).then(async (response) => {
        const result = await response.json() as { data?: Category[]; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Categories are unavailable.')
        setCategories(result.data)
      }),
      fetch('/api/v1/marketplace/locations/counties', { signal: controller.signal }).then(async (response) => {
        const result = await response.json() as { data?: County[]; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Locations are unavailable.')
        setCounties(result.data)
      }),
    ]).catch((error: unknown) => { if (!controller.signal.aborted) setPageError(error instanceof Error ? error.message : 'Marketplace data is unavailable.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingData(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  const selectedCategory = categories.find((category) => category.id === values.categoryId)
  const update = <K extends keyof SellerFormValues>(key: K, value: SellerFormValues[K]) => setValues((current) => ({ ...current, [key]: value }))
  const changeFiles = (selected: FileList | null) => {
    if (!selected) return
    const additions = Array.from(selected)
    if (files.length + additions.length > 5) {
      setImageError('A listing can include up to five images.')
      return
    }
    if (additions.some((file) => file.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setImageError('Use JPEG, PNG or WebP images no larger than 8 MB each.')
      return
    }
    setImageError('')
    setFiles((current) => [...current, ...additions])
  }
  const moveFile = (index: number, direction: -1 | 1) => {
    setFiles((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  async function uploadPendingImages(newSubmission: Submission, fromIndex = 0) {
    setUploading(true)
    setImageError('')
    try {
      for (let index = fromIndex; index < files.length; index += 1) {
        const file = files[index]!
        const response = await fetch(`/api/v1/marketplace/submissions/${newSubmission.reference}/images`, {
          method: 'POST',
          headers: { 'Content-Type': file.type, 'X-Submission-Token': newSubmission.statusToken, 'X-Primary-Image': index === 0 ? 'true' : 'false' },
          body: await file.arrayBuffer(),
        })
        const result = await response.json() as { error?: { message?: string } }
        if (!response.ok) throw new Error(result.error?.message ?? 'Image upload failed.')
        setUploadedCount(index + 1)
      }
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Image upload failed.')
      throw error
    } finally {
      setUploading(false)
    }
  }

  async function createSubmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPageError('')
    if (step === 1) {
      setStep(2)
      return
    }
    if (step === 2) {
      if (!files.length) {
        setImageError('Add at least one product image.')
        return
      }
      setStep(3)
      return
    }
    if (step !== 3) return
    setLoadingData(true)
    try {
      const response = await fetch('/api/v1/marketplace/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title,
          description: values.description,
          categoryId: values.categoryId,
          subcategoryId: values.subcategoryId || undefined,
          condition: values.condition,
          priceKes: Number(values.priceKes),
          negotiable: values.negotiable,
          seller: { name: values.name, phone: values.phone, whatsapp: values.whatsapp || undefined, email: values.email, countyCode: values.countyCode, subcounty: values.subcounty, town: values.town, area: values.area || undefined },
        }),
      })
      const result = await response.json() as { data?: Submission; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'The listing could not be submitted.')
      setSubmission(result.data)
      sessionStorage.setItem(`mh_submission_${result.data.reference}`, result.data.statusToken)
      setPaymentPhone(values.phone)
      setStep(4)
      await uploadPendingImages(result.data)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'The listing could not be submitted.')
    } finally {
      setLoadingData(false)
    }
  }

  async function startPublicationPayment() {
    if (!submission || uploading || uploadedCount !== files.length) return
    setPaying(true)
    setPaymentMessage('')
    try {
      const response = await fetch('/api/v1/marketplace/payments/publication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: submission.reference, phone: paymentPhone, submissionToken: submission.statusToken }),
      })
      const result = await response.json() as { data?: { paymentReference: string; status: string; amountKes: number }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Payment could not be started.')
      setPaymentMessage(result.data.status === 'ambiguous' ? 'Payment status is unclear. Use the status check before trying again.' : 'Approve the M-Pesa prompt on your phone. The listing stays unpublished until payment is verified.')
      for (let attempt = 0; attempt < 36; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500))
        const statusResponse = await fetch(`/api/v1/marketplace/payments/${result.data.paymentReference}/status`, { headers: { 'X-Payment-Token': submission.statusToken } })
        const statusResult = await statusResponse.json() as { data?: { status: string; listingStatus: string | null }; error?: { message?: string } }
        if (!statusResponse.ok || !statusResult.data) throw new Error(statusResult.error?.message ?? 'Payment status could not be checked.')
        if (statusResult.data.status === 'succeeded' && statusResult.data.listingStatus === 'published') {
          setPublished(true)
          setPaymentMessage('Payment verified. Your listing is now published.')
          return
        }
        if (['failed', 'cancelled', 'expired', 'reversed', 'refunded'].includes(statusResult.data.status)) {
          setPaymentMessage('Payment was not completed. Your listing remains unpublished.')
          return
        }
      }
      setPaymentMessage('Payment is still being verified. Your listing remains unpublished until confirmation.')
    } catch (error) {
      setPaymentMessage(error instanceof Error ? error.message : 'Payment could not be completed.')
    } finally {
      setPaying(false)
    }
  }

  const stepTitles = ['Product information', 'Product images', 'Seller information', 'Publication payment']
  return <div className="sell-page">
    <header><Link className="market-brand" to="/marketplace"><span className="market-logo"><ImagePlus size={25} /></span><span><strong>Market<span>hub</span></strong><small>Buy. Sell. Save More.</small></span></Link><Link to="/">Platform home</Link></header>
    <main className="sell-main">
      <Link to="/marketplace" className="back-link"><ArrowLeft size={15} /> Marketplace</Link>
      <div className="sell-heading"><div><span>MARKETPLACE LISTING</span><h1>{published ? 'Your listing is live' : 'Sell an item'}</h1></div><p>Machakos County · Kenya</p></div>
      {!published && <ol className="sell-stepper">{stepTitles.map((title, index) => <li className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''} key={title}><b>{step > index + 1 ? <Check size={15} /> : index + 1}</b><span>{title}</span></li>)}</ol>}
      {pageError && <p className="sell-error" role="alert">{pageError}</p>}
      {loadingData && step === 1 ? <div className="sell-loading"><LoaderCircle /> Loading marketplace data…</div> : published ? <section className="sell-success"><Check /><h2>Published</h2><p>{submission?.reference} is now searchable on the marketplace.</p><Link to={`/marketplace/products/${submission?.slug}`}>View listing <ArrowRight size={15} /></Link></section> : <form className="sell-form" onSubmit={createSubmission}>
  {step === 1 && <section><h2>What are you selling?</h2><label>Product title<input required minLength={5} maxLength={160} value={values.title} onChange={(event) => update('title', event.target.value)} placeholder="e.g. HP Pavilion laptop" /></label><div className="sell-two-col"><label>Category<select required value={values.categoryId} onChange={(event) => { update('categoryId', event.target.value); update('subcategoryId', '') }}><option value="">Select a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Subcategory<select value={values.subcategoryId} onChange={(event) => update('subcategoryId', event.target.value)} disabled={!selectedCategory?.subcategories.length}><option value="">Choose if available</option>{selectedCategory?.subcategories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><label>Description<textarea required minLength={30} maxLength={5000} rows={5} value={values.description} onChange={(event) => update('description', event.target.value)} /></label><div className="sell-three-col"><label>Condition<select value={values.condition} onChange={(event) => update('condition', event.target.value)}><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option><option value="used">Used</option></select></label><label>Price (KSh)<input required type="number" min="1" max="100000000" step="1" value={values.priceKes} onChange={(event) => update('priceKes', event.target.value)} /></label><label className="sell-check"><input type="checkbox" checked={values.negotiable} onChange={(event) => update('negotiable', event.target.checked)} /> Negotiable</label></div></section>}
  {step === 2 && <section><h2>Product images</h2><label className="upload-zone"><Upload /><strong>Choose up to five product photos</strong><small>JPEG, PNG or WebP · maximum 8 MB per image</small><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => changeFiles(event.target.files)} /></label>{imageError && <p className="sell-error" role="alert">{imageError}</p>}<div className="upload-previews">{previews.map((url, index) => <article key={`${url}-${index}`}><img src={url} alt={`Listing image ${index + 1}`} /><div><button type="button" title="Move image up" aria-label="Move image up" onClick={() => moveFile(index, -1)} disabled={index === 0}><ArrowUp size={15} /></button><button type="button" title="Move image down" aria-label="Move image down" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1}><ArrowDown size={15} /></button><button type="button" title="Remove image" aria-label="Remove image" onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}><Trash2 size={15} /></button></div>{index === 0 && <b>Primary</b>}</article>)}</div></section>}
  {step === 3 && <section><h2>How can buyers find you?</h2><label>Your name<input required minLength={2} maxLength={120} value={values.name} onChange={(event) => update('name', event.target.value)} /></label><div className="sell-two-col"><label>Phone number<input required inputMode="tel" autoComplete="tel" value={values.phone} onChange={(event) => update('phone', event.target.value)} placeholder="0712 345 678" /></label><label>WhatsApp number (optional)<input inputMode="tel" value={values.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} /></label></div><label>Email (optional)<input type="email" autoComplete="email" value={values.email} onChange={(event) => update('email', event.target.value)} /></label><div className="sell-two-col"><label>County<select required value={values.countyCode} onChange={(event) => update('countyCode', event.target.value)}>{counties.map((county) => <option value={county.code} key={county.code}>{county.name}</option>)}</select></label><label>Subcounty<input required maxLength={100} value={values.subcounty} onChange={(event) => update('subcounty', event.target.value)} /></label></div><div className="sell-two-col"><label>Town<input required maxLength={100} value={values.town} onChange={(event) => update('town', event.target.value)} /></label><label>Area or neighbourhood (optional)<input maxLength={120} value={values.area} onChange={(event) => update('area', event.target.value)} /></label></div><p className="privacy-note">Your contact details are not shown publicly. Buyers can access them only after a verified contact-unlock payment.</p></section>}
  {step === 4 && submission && <section><h2>Publication payment</h2><div className="payment-summary"><div><span>Advertised price</span><strong>{formatKes(Number(values.priceKes))}</strong></div><div><span>Publication fee</span><strong>{formatKes(submission.publicationFeeKes)}</strong></div><div className="payment-total"><span>Pay now</span><strong>{formatKes(submission.publicationFeeKes)}</strong></div></div>{uploading ? <p className="upload-status"><LoaderCircle /> Uploading image {uploadedCount + 1} of {files.length}…</p> : imageError ? <><p className="sell-error" role="alert">{imageError}</p><button className="sell-secondary" type="button" onClick={() => void uploadPendingImages(submission, uploadedCount)}>Retry image upload</button></> : <p className="upload-status"><Check /> {files.length} images stored</p>}<label>M-Pesa phone number<input required inputMode="tel" value={paymentPhone} onChange={(event) => setPaymentPhone(event.target.value)} placeholder="0712 345 678" /></label><button className="pay-button" type="button" onClick={() => void startPublicationPayment()} disabled={paying || uploading || uploadedCount !== files.length}>{paying ? <><LoaderCircle /> Checking payment…</> : <>Pay publication fee <ArrowRight size={16} /></>}</button>{paymentMessage && <p className="payment-message" role="status">{paymentMessage}</p>}<p className="submission-reference">Listing reference: <strong>{submission.reference}</strong> · <Link to={`/marketplace/status?reference=${submission.reference}`}>Check status</Link></p></section>}
  {!published && <div className="sell-form-actions">{step > 1 && step < 4 && <button className="sell-secondary" type="button" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={15} /> Back</button>}{step < 3 && <button className="sell-primary" type="submit">Continue <ArrowRight size={15} /></button>}{step === 3 && <button className="sell-primary" type="submit" disabled={loadingData}>{loadingData ? <><LoaderCircle /> Creating listing…</> : <>Create listing <ArrowRight size={15} /></>}</button>}</div>}
  </form>}
    </main>
  </div>
}

export function SubmissionStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [reference, setReference] = useState(searchParams.get('reference') ?? '')
  const [checkedReference, setCheckedReference] = useState(searchParams.get('reference') ?? '')
  const [retry, setRetry] = useState(0)
  const [status, setStatus] = useState<{ status: string; updatedAt: string; slug: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!checkedReference) return
    const token = sessionStorage.getItem(`mh_submission_${checkedReference}`)
    if (!token) {
      setError('This browser does not have the secure status token for that listing.')
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(`/api/v1/marketplace/submissions/${encodeURIComponent(checkedReference)}/status`, { headers: { 'X-Submission-Token': token }, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: { status: string; updatedAt: string; slug: string }; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Submission status could not be loaded.')
        setStatus(result.data)
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Submission status could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [checkedReference, retry])
  function checkStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = reference.trim().toUpperCase()
    setReference(normalized)
    setCheckedReference(normalized)
    setSearchParams(normalized ? { reference: normalized } : {})
  }
  return <div className="sell-page">
    <header><Link className="market-brand" to="/marketplace"><span className="market-logo"><ImagePlus size={25} /></span><span><strong>Market<span>hub</span></strong><small>Buy. Sell. Save More.</small></span></Link><Link to="/">Platform home</Link></header>
    <main className="sell-main"><Link to="/marketplace" className="back-link"><ArrowLeft size={15} /> Marketplace</Link><div className="sell-heading"><div><span>PRIVATE LISTING STATUS</span><h1>Check your listing</h1></div></div>
      <form className="sell-form status-lookup" onSubmit={checkStatus}><label>Listing reference<input required value={reference} onChange={(event) => setReference(event.target.value)} placeholder="MH-0123456789ABCDEF" /></label><button className="sell-primary" type="submit" disabled={loading}>{loading ? <LoaderCircle /> : <>Check status <ArrowRight size={15} /></>}</button>{error && <p className="sell-error" role="alert">{error}</p>}{status && <div className="payment-summary"><div><span>Status</span><strong>{status.status.replaceAll('_', ' ')}</strong></div><div><span>Last updated</span><strong>{new Date(status.updatedAt).toLocaleString('en-KE')}</strong></div>{status.status === 'published' && <Link to={`/marketplace/products/${status.slug}`}>View published listing <ArrowRight size={15} /></Link>}<button type="button" className="sell-secondary" onClick={() => setRetry((value) => value + 1)}>Refresh status</button></div>}</form>
    </main>
  </div>
}
