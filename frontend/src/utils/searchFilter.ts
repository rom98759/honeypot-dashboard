// Client side of the search language (app/search_filter.py is the authority): split the text
// into terms for the chips, and catch obvious mistakes before a request is sent.

export type SearchField = "ip" | "country" | "asn" | "proto" | "user" | "pass" | "cmd" | "dur" | "login" | "file";

export interface SearchTerm {
  field: SearchField;
  op: ":" | ">" | "<" | ">=" | "<=";
  values: string[];
  negate: boolean;
}

export const SEARCH_FIELDS: SearchField[] = ["ip", "country", "asn", "proto", "user", "pass", "cmd", "dur", "login", "file"];

export const FIELD_LABELS: Record<SearchField, string> = {
  ip: "IP",
  country: "Pays",
  asn: "ASN",
  proto: "Protocole",
  user: "Utilisateur",
  pass: "Mot de passe",
  cmd: "Commande",
  dur: "Durée",
  login: "Login",
  file: "Fichier",
};

const ALIASES: Record<string, SearchField> = {
  protocol: "proto",
  username: "user",
  password: "pass",
  command: "cmd",
  duration: "dur",
  pays: "country",
};

const VALUE_LABELS: Partial<Record<SearchField, Record<string, string>>> = {
  login: { ok: "accepté", failed: "refusé", none: "absent" },
  file: { any: "présent", download: "téléchargé", upload: "déposé", redirect: "écrit", failed: "échec" },
};

export class SearchSyntaxError extends Error {}

const TERM_RE = /^(-?)([a-zA-Z]+)(>=|<=|>|<|:)([\s\S]*)$/;
const IP_LIKE_RE = /^[0-9a-fA-F:.*]+(\/\d{1,3})?$/;
const DURATION_RE = /^\d+(\.\d+)?[smh]?$/;
const HEX_RE = /^[0-9a-fA-F]{6,64}$/;

function splitTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) {
        current += text.slice(i, i + 2);
        i++;
        continue;
      }
      if (ch === '"') inQuotes = false;
      current += ch;
    } else if (ch === '"') {
      inQuotes = true;
      started = true;
      current += ch;
    } else if (/\s/.test(ch)) {
      if (current || started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
    }
  }
  if (inQuotes) throw new SearchSyntaxError("guillemet non fermé");
  if (current || started) tokens.push(current);
  return tokens;
}

function splitValues(raw: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === "\\" && i + 1 < raw.length) {
        current += raw[i + 1];
        i++;
      } else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      values.push(current);
      current = "";
    } else current += ch;
  }
  values.push(current);
  if (values.some((v) => v === "")) throw new SearchSyntaxError("valeur vide");
  return values;
}

function looksLikeIp(word: string): boolean {
  if (!IP_LIKE_RE.test(word) || !/[.:]/.test(word)) return false;
  return /^\d{1,3}(\.(\d{1,3}|\*))*\.?\*?(\/\d{1,2})?$/.test(word) || (word.includes(":") && /^[0-9a-fA-F:*]+(\/\d{1,3})?$/.test(word));
}

function checkValue(field: SearchField, op: SearchTerm["op"], value: string) {
  if (field === "dur") {
    if (!DURATION_RE.test(value)) throw new SearchSyntaxError("dur : nombre de secondes attendu (ex. dur>60, dur<5m)");
    return;
  }
  if (op !== ":") throw new SearchSyntaxError(`${field} : seul dur accepte > et <`);
  const lower = value.toLowerCase();
  if (field === "ip" && !IP_LIKE_RE.test(value)) {
    throw new SearchSyntaxError(`ip : « ${value} » n'est pas une IP, un préfixe 45.* ou une plage CIDR`);
  }
  if (field === "proto" && lower !== "ssh" && lower !== "telnet") throw new SearchSyntaxError("proto : ssh ou telnet");
  if (field === "login" && !["ok", "failed", "none"].includes(lower)) throw new SearchSyntaxError("login : ok, failed ou none");
  if (field === "file" && !["any", "download", "upload", "redirect", "failed"].includes(lower) && !HEX_RE.test(value)) {
    throw new SearchSyntaxError("file : any, download, upload, redirect, failed ou un début de SHA-256");
  }
}

export function parseSearch(text: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  for (const token of splitTokens(text)) {
    const m = TERM_RE.exec(token);
    const name = m?.[2].toLowerCase() ?? "";
    let term: SearchTerm;
    if (m && ((SEARCH_FIELDS as string[]).includes(name) || name in ALIASES)) {
      term = {
        field: ALIASES[name] ?? (name as SearchField),
        op: m[3] as SearchTerm["op"],
        values: splitValues(m[4]),
        negate: m[1] === "-",
      };
    } else if (m && !token.startsWith('"') && !m[4].startsWith("//")) {
      throw new SearchSyntaxError(`champ inconnu « ${m[2]} » (champs : ${SEARCH_FIELDS.join(", ")})`);
    } else {
      const negate = token.startsWith("-") && token.length > 1;
      const values = splitValues(negate ? token.slice(1) : token);
      const field: SearchField = values.length === 1 && looksLikeIp(values[0]) ? "ip" : "cmd";
      term = { field, op: ":", values, negate };
    }
    if (term.field === "dur" && (term.values.length > 1 || term.op === ":")) {
      throw new SearchSyntaxError("dur : une seule comparaison, ex. dur>60");
    }
    term.values.forEach((v) => checkValue(term.field, term.op, v));
    terms.push(term);
    if (terms.length > 20) throw new SearchSyntaxError("20 conditions au maximum");
  }
  return terms;
}

export function quoteValue(value: string): string {
  if (value && !/[\s,"\\]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatTerm(term: SearchTerm): string {
  return `${term.negate ? "-" : ""}${term.field}${term.op}${term.values.map(quoteValue).join(",")}`;
}

export function formatSearch(terms: SearchTerm[]): string {
  return terms.map(formatTerm).join(" ");
}

/** Chip text: field, verb, values ("Pays est CN ou RU", "Commande ne contient pas wget"). */
export function describeTerm(term: SearchTerm): { field: string; op: string; value: string } {
  const field = FIELD_LABELS[term.field];
  const value = term.values.map((v) => VALUE_LABELS[term.field]?.[v.toLowerCase()] ?? v).join(" ou ");
  if (term.field === "dur") {
    const unit = /[smh]$/.test(term.values[0]) ? "" : " s";
    return { field, op: term.negate ? `pas ${term.op}` : term.op, value: `${term.values[0]}${unit}` };
  }
  const contains = term.field === "cmd" || (term.field === "asn" && !/^(as)?\d+$/i.test(term.values[0]));
  const op = contains ? (term.negate ? "ne contient pas" : "contient") : term.negate ? "n'est pas" : "est";
  return { field, op, value };
}

export function safeParse(text: string): { terms: SearchTerm[]; error: string | null } {
  try {
    return { terms: parseSearch(text), error: null };
  } catch (e) {
    return { terms: [], error: e instanceof SearchSyntaxError ? e.message : String(e) };
  }
}
