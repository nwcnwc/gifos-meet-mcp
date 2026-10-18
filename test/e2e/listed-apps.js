// Which speech apps a shared site is missing. A 200 with the right appId counts.
export async function missingApps(base, slugs) {
  const root = String(base || '').replace(/\/$/, '');
  const missing = [];
  for (const slug of slugs) {
    const listed = await fetch(root + '/apps/' + encodeURIComponent(slug) + '/app.json').then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!listed || listed.appId !== slug) missing.push(slug);
  }
  return missing;
}
