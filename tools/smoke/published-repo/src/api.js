export async function getForecast(city) {
  const res = await fetch(`https://api.example-weather.com/v1/forecast?q=${encodeURIComponent(city)}`);
  return res.json();
}
