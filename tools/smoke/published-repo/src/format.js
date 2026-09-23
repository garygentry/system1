export function formatTemp(celsius, unit = "C") {
  return unit === "F" ? `${Math.round(celsius * 9 / 5 + 32)}°F` : `${Math.round(celsius)}°C`;
}
