import { getForecast } from "./api.js";
import { formatTemp } from "./format.js";
const [city = "London"] = process.argv.slice(2);
const f = await getForecast(city);
console.log(city, formatTemp(f.tempC));
