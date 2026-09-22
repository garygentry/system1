/** Turn a title into a URL slug: lowercase, ASCII, hyphen-separated. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
}
