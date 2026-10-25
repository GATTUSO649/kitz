import type { ChangeEvent } from 'react'

function localDigits(value: string) {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('254')) digits = digits.slice(3)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits.slice(0, 9)
}

export function KenyanPhoneInput({ value, onChange, label, required = true }: { value: string; onChange: (phone: string) => void; label: string; required?: boolean }) {
  function updatePhone(event: ChangeEvent<HTMLInputElement>) {
    const digits = localDigits(event.target.value)
    onChange(digits ? `+254${digits}` : '')
  }

  return <label className="kenyan-phone-field">{label}<span className="kenyan-phone-input"><span aria-hidden="true">+254</span><input type="tel" inputMode="numeric" autoComplete="tel-national" required={required} pattern="[17][0-9]{8}" title="Enter 9 digits after +254, for example 712345678." maxLength={9} placeholder="712 345 678" value={localDigits(value)} onChange={updatePhone} /></span></label>
}