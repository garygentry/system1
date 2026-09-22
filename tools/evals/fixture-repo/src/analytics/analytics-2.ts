export function parseAnalytics2(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
