import { MapPin } from 'lucide-react'

export function GoogleMapView({
  latitude,
  longitude,
  destination,
  title,
}: {
  latitude: number
  longitude: number
  destination?: { latitude: number; longitude: number }
  title: string
}) {
  const point = `${latitude},${longitude}`
  const destinationPoint = destination ? `${destination.latitude},${destination.longitude}` : point
  const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(point)}&z=14&output=embed`
  const directionsUrl = destination
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(point)}&destination=${encodeURIComponent(destinationPoint)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point)}`
  return <div className="portal-map-card">
    <div className="portal-map-heading"><MapPin size={16} /><strong>{title}</strong></div>
    <iframe title={title} src={embedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
    <a href={directionsUrl} target="_blank" rel="noreferrer">{destination ? 'Open route in Google Maps' : 'Get directions in Google Maps'} <span aria-hidden="true">↗</span></a>
  </div>
}
