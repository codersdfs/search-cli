/** Shared payload reader: a 200 whose body is not JSON (captive portals, CDN error
 *  pages) is a failure, not an empty search. */
export async function readJson(res: Response, label: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new Error(`${label} search failed: unparseable response`);
  }
}
