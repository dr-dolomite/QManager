// ICCID comparison shared by the registry rows and the active-profile hero.

/** Compare-time ICCID form, mirroring `iccid_canonicalize` (`sim_db.sh`):
 *  drop whitespace, uppercase, strip every trailing BCD pad nibble (F or FF). */
export function canonicalIccid(iccid: string): string {
  return iccid.replace(/\s+/g, "").toUpperCase().replace(/F+$/, "");
}

/** Bound to a SIM other than the live one. An empty binding is SIM-agnostic;
 *  an unknown live ICCID is "don't know", never a mismatch. */
export function iccidMismatch(
  profileIccid: string,
  currentIccid: string | null,
): boolean {
  if (!profileIccid || !currentIccid) return false;
  return canonicalIccid(profileIccid) !== canonicalIccid(currentIccid);
}
