// Goddard's real PiDog head: silver box, two round sensor eyes, camera nose, LED bar mouth.
export function GoddardHead({ size = 40, barking = false }: { size?: number; barking?: boolean }) {
  return (
    <svg className={barking ? 'head barking' : 'head'} width={size} height={size * 0.82} viewBox="0 0 100 82" aria-label="Goddard" role="img">
      <defs>
        <linearGradient id="silver" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ECEEF1" />
          <stop offset="1" stopColor="#A3A9B1" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="97" height="79" rx="18" fill="url(#silver)" stroke="#5F656D" strokeWidth="3" />
      {[25.5, 74.5].map(cx => (
        <g key={cx}>
          <circle cx={cx} cy="27.5" r="13.5" fill="#16191E" stroke="#7D8996" strokeWidth="3" />
          <circle className="glint" cx={cx + 4.5} cy="23" r="3" fill="#E8F1F7" />
        </g>
      ))}
      <circle cx="50" cy="51" r="6.5" fill="#070707" stroke="#3A3F46" strokeWidth="2" />
      <circle cx="50" cy="51" r="2.8" fill="#3B6E8F" />
      <rect x="20" y="63" width="60" height="10" rx="4" fill="#16191E" />
      {[0, 1, 2, 3, 4].map(i => (
        <rect key={i} className="led" x={22 + i * 11.3} y="65" width="9.5" height="6" rx="1" fill={i < 4 ? '#BD8430' : '#5A4220'} />
      ))}
    </svg>
  )
}
