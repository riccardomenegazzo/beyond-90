// Heard something: what the customer said, written as it was said, matched to the question it answers.
//
// During a meeting nobody has time to find the right question in a list of eighty. The words are matched against
// every question in scope, its text counting twice and what to listen for, why it matters and the follow-up once each,
// with rare words weighing more than common ones and a few groups of words that mean the same thing in these
// conversations (a backup and a copy, a restore and a failover). The best few are offered; the person files it.
// Notes are often written in the customer's language: a note written in Italian is read through a glossary of the
// words these meetings use, so it finds the same questions. No DOM, so Node can test it. Nothing leaves the browser.

import { EDGE_DEFAULTS } from "./edgesketch.js";

export const NOTE_MAX = 300;      // as long as a note on an answer can be

const SHORT = new Set(["ms", "ip", "dc", "db", "vm", "os", "mb"]);     // short words that still carry meaning here
const STOP = new Set(("a an the and or but nor of to in on at for with by from into onto about over under after before than then " +
  "is are was were be been being am do does did done has have had having it its it's this that these those there here " +
  "we our ours us they their them you your yours i my me he she his her who whom whose what which when where why how " +
  "can could would should will shall may might must just also very really quite so too if as all any some each every " +
  "more most less least only not no yes one two three new old other same such own still today now ever never always " +
  "get got make made say said tell told know think thing things way lot lots off out above below anything something everything").split(" "));

// a word without its common endings: copies and copy, tested and test, branches and branch
const bare = (word) => {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 3 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
};

// words that mean the same thing in these conversations: each folds into the first of its group
const SAME = [
  ["copy", "backup", "snapshot", "replica", "vault", "clone"],
  ["recover", "recovery", "restore", "failover", "failback"],
  ["admin", "administrator", "privileged", "superuser", "root"],
  ["delete", "wipe", "erase", "purge"],
  ["site", "datacentre", "datacenter", "dc"],
  ["latency", "millisecond", "ms", "roundtrip", "rtt"],
  ["cost", "money", "revenue", "euro", "dollar", "budget", "spend", "fee", "price"],
  ["bill", "invoice", "billing"],
  ["traffic", "egress", "outbound"],
  ["database", "db", "instance", "schema"],
  ["production", "prod"],
  ["take", "took", "taken", "takes"],
  ["audit", "auditor", "auditors", "auditing"],
  ["jurisdiction", "sovereignty", "sovereign", "gdpr", "residency", "country"],
  ["test", "drill", "exercise", "rehearsal", "lab", "pilot", "poc"],
  ["branch", "office", "warehouse", "store", "shop", "depot", "plant"],
  ["network", "dns", "ip", "address", "firewall", "vlan", "subnet"],
  ["target", "rpo", "rto", "objective", "sla"],
  ["encrypt", "encryption", "encrypted"],
  ["upgrade", "patch", "update", "version"],
  ["ransomware", "malware", "cryptolocker"],
  ["attack", "attacker", "breach", "compromise", "intruder"],
  ["machine", "server", "host", "vm"],
  ["request", "ticket"],
  ["storage", "disk"],
  ["travel", "drive", "trip", "visit"],
  ["replace", "swap"],
  ["bandwidth", "mbps", "mb", "gbps", "link"],
  ["old", "age", "aging", "ageing", "stale"],
  ["tier", "tiering", "archive", "cold"],
  // the words of a deal: who signs, who else is in it, the date that forces a choice
  ["sign", "approve", "approval", "signoff", "authorise", "authorize"],
  ["decide", "decision", "decider", "choice", "choose", "cio", "cfo", "ceo", "cto", "coo"],
  ["supplier", "vendor", "competitor", "competition", "incumbent", "alternative"],
  ["champion", "advocate", "carry"],
  ["renewal", "renew", "expire", "expiry", "deadline", "contract"],
  ["platform", "hypervisor", "virtualisation", "virtualization"],
  ["licence", "license", "licensing", "licensed"],
  ["wrong", "broke", "broken"],
  ["leave", "leaver", "offboard", "offboarding"],
  ["mfa", "multifactor", "2fa"],
  ["signin", "login", "logon"],
  ["keep", "kept", "retain", "retention"],
  ["procurement", "purchasing", "legal", "tender"],
];
const CANON = new Map(SAME.flatMap((group) => group.map((w) => [bare(w), bare(group[0])])));

// Italian, as a note taken in a meeting in Italy is written. Words that carry nothing are dropped; the words these
// meetings use become the English word the questions use, then are compared as any other. Only words that are not
// also English words are read this way ("data" stays data), so an English note is compared exactly as before.
const STOP_IT = new Set(("il lo la gli le una uno del dello della dei degli delle dal dallo dalla dai dagli dalle nel nello " +
  "nella nei negli nelle sul sullo sulla sui sugli sulle con per tra fra al allo alla ai agli alle che chi cui come dove " +
  "quando perche quanto quanti quanta quante quale quali questo questa questi queste quello quella quelli quelle nostro " +
  "nostra nostri nostre vostro vostra loro suo sua suoi sue mio mia noi voi lui lei essi esse anche ancora sempre mai piu " +
  "meno molto molti molte molta poco pochi poche tutto tutti tutte tutta solo sono siamo sei era erano essere stato stata " +
  "stati state abbiamo hanno avete avere aveva avevano fanno fare viene vengono puo possono potrebbe potremmo deve devono " +
  "dobbiamo bisogna stanno stiamo cosa cose nessun nessuna altro altra altri altre circa oggi adesso qui ogni " +
  "sappiamo sanno sapere detto dice dicono pero quindi oppure mentre dopo prima sopra sotto non proprio tanto tanti cioe " +
  "ovvero invece fino verso durante almeno nuovo nuova nuovi nuove due quattro cinque sette otto nove dieci").split(" "));
const IT = new Map(`copy: copia copie copiato copiati
restore: ripristino ripristini ripristinare ripristinato ripristinata ripristinati ripristinate recupero recuperare ripartenza
site: sito siti sede sedi
datacentre: datacenter
branch: filiale filiali negozio negozi magazzino magazzini stabilimento stabilimenti
machine: macchina macchine
network: rete reti
link: collegamento collegamenti connettivita collegato collegati collegata collegate linea linee
bandwidth: banda
cost: costo costi costa costano costerebbe costato costata costati spesa spese prezzo prezzi pagare paghiamo pagato paga pagano
bill: fattura fatture fatturazione fatturare bolletta bollette
licence: licenza licenze
renewal: rinnovo rinnovi rinnovare scadenza scadenze scade scadono contratto contratti
supplier: fornitore fornitori concorrente concorrenti alternativa alternative
decide: decisione decisioni decidere decidono sceglie scelgono scelta
sign: firma firmare firmato approva approvare approvazione
procurement: acquisti gara gare legale
upgrade: aggiornamento aggiornamenti aggiornare aggiornato aggiornati aggiornata aggiornate versione versioni
attack: attacco attacchi attaccante attaccanti violazione violazioni compromesso compromessa compromessi
encrypt: cifrerebbe cifra cifrare criptare cripta cifratura crittografia cifrato cifrati cifrata cifrate criptato criptati crittografato crittografati
admin: amministratore amministratori amministrativo privilegiato privilegiati privilegiata privilegiate
delete: cancellare cancella cancellato cancellati cancellata eliminare elimina eliminato eliminati
test: prova prove testato testata testati testare collaudo esercitazione esercitazioni pilota provato provata provati provate
connection: connessione connessioni
forbidden: vietata vietato vietate vietati proibita proibito
attempt: tenta tentano tentativo tentativi
take: correre corriamo
time: tempo
run: gestire gestisce gestiamo gestiscono
hard: difficile difficili
project: progetto progetti
past: superano supera superare
stay: restare restano rimanere rimangono restino
hate: odiano odia odiare
virtual: virtuale virtuali
mean: significa significano
downtime: fermo
path: percorso percorsi
collect: raccogliamo raccogliere raccoglie raccolti
target: obiettivo obiettivi
data: dati
storage: archiviazione disco dischi
old: vecchio vecchi vecchia vecchie obsoleto obsoleti obsoleta datato datati
user: utente utenti
access: accesso accessi accedere accede accedono
leave: dimissioni dimesso dimessi uscita lascia lasciano lasciato
contractor: consulente consulenti appaltatore appaltatori collaboratori
log: registro registri
alert: allarme allarmi avviso avvisi segnalazioni
night: notte notti notturno notturni notturna
regulator: regolatore autorita garante
regulation: normativa normative regolamento regolamenti conformita
auditor: revisore revisori ispettori
audit: verifica verifiche
evidence: evidenza evidenze
rebuilt: ricostruire ricostruito ricostruite ricostruiti ricostruzione
insurer: assicurazione assicuratore assicurazioni polizza
meeting: riunione riunioni incontro
day: giorno giorni giornata
week: settimana settimane
month: mese mesi
year: anno anni
hour: ore
minute: minuto minuti
board: consiglio cda
team: squadra reparto
operations: operazioni operativo
security: sicurezza
application: applicazione applicazioni applicativo applicativi gestionale
nobody: nessuno
monitor: monitoraggio monitorare monitorato monitorati
see: vede vedere vediamo visibilita
inventory: inventario
label: etichetta etichette
policy: politica politiche
rule: regola regole
isolate: isolare isolamento isolato
production: produzione
development: sviluppo
migration: migrazione migrazioni
move: spostare spostato spostati spostamento
platform: piattaforma piattaforme virtualizzazione
training: formazione addestramento addestrare
skill: competenze competenza
risk: rischio rischi
plan: piano piani
maintenance: manutenzione
capacity: capacita
memory: memoria
full: pieno pieni piena piene
performance: prestazioni
laptop: portatile portatili
desktop: postazione postazioni
phone: telefono telefoni cellulare cellulari smartphone
mail: posta
agent: agente agenti
exclusion: esclusione esclusioni
assistant: assistente
model: modello
country: paese nazione territorio italia europa ue
customer: cliente clienti
outage: interruzione interruzioni disservizio disservizi
stop: ferma fermano bloccato bloccata bloccati
lost: perdita perdite perso persi perdiamo
order: ordini
till: cassa casse
region: regione regioni
container: contenitori
key: chiave chiavi
rotate: rotazione ruotare ruotate ruotato
share: condiviso condivisi condivisa condivise condividere condivisione
public: pubblico pubblica pubblici pubbliche
internal: interno interni interna
review: revisione revisioni riesame
session: sessione sessioni
record: registrata registrate registrare registrato registrati
integration: integrazione integrazioni
index: indice indicizzato indicizzati indicizzare
answer: risposta risposte
wrong: sbagliata sbagliate sbagliato sbagliati errata errate errato
report: segnalare segnalazione segnala avvisare avvisa notificare notifica notifiche comunicare
vulnerability: vulnerabilita
critical: critico critica critici critiche
open: aperto aperti aperta aperte
close: chiuso chiusi chiusa chiuse chiudere
owner: proprietario proprietari responsabile responsabili
configuration: configurazione configurazioni
certification: certificazione certificazioni
margin: margine margini
already: gia
without: senza
poweredoff: spento spenti spenta spente spegnere spegne
detect: rilevare rilevamento rilevazione
slow: lento lenta lenti lente lentezza rallentamento rallentamenti
second: secondo seconda
expensive: costoso costosa costosi costose
disrupt: disturba disturberebbe disturbare interrompe interromperebbe
tool: strumento strumenti
automation: automazione
break: rompe rompera rompere rompa rompono
poor: scarso scarsa scarsi scarse scadenti
small: piccolo piccola piccoli piccole
fail: fallisce falliscono fallito fallita fallimento
cutover: passaggio
migrate: migrare migrato migrati migrata migrate
instance: istanza istanze
lab: laboratorio
broken: rotto rotti rotta rotte
change: cambia cambiano cambiato cambiare modifica modificano modificare modificato modifiche
send: invia inviano inviare
look: guarda guardano guardare guardi
read: legge leggono leggere letto
carry: porta portare portera
protect: protetto protetti protetta protette proteggere protezione
keep: conservare conserviamo teniamo tenere conservati mantiene mantengono
take: richiede richiesto richiedono impiega impiegato impiegano
last: scorso scorsa ultimo ultima ultimi ultime
local: locale locali
work: funziona funzionano funzionare
track: traccia tracciare tracciano tracciato
bought: comprato comprati comprata acquistato acquistati acquistata comprare
need: servono servirebbe servirebbero bisogno necessario necessari
advocate: sostiene sosterra sostenere sostenitore
idle: fermi ferme inattivo inattivi inattive inutilizzato inutilizzati inutilizzate`.split("\n").flatMap((line) => {
  const [en, words] = line.split(":");
  return words.trim().split(/\s+/).map((w) => [w, en.trim()]);
}));
// the few things said in more than one word, as one: a data centre, the end of support, two-factor
const PHRASES_IT = [
  [/centr[oi] (?:elaborazione )?dati/g, "datacentre"],
  [/(?:fuori|fine(?: del)?) supporto|fine vita|non (?:piu )?supportat[oiae]/g, "unsupported"],
  [/sistem[ai] operativ[oi]/g, "os"],
  [/macchin[ae] virtual[ei]/g, "vm"],
  [/(?:autenticazione )?a (?:due|piu) fattori|doppio fattore|multi ?fattore/g, "multifactor"],
  [/punt[oi] di ripristino/g, "rpo"],
  [/temp[oi] di ripristino/g, "rto"],
  [/fine settimana/g, "weekend"],
  [/punt[oi] vendita/g, "store"],
  [/ex dipendenti|se ne vanno|se ne va\b/g, "leaver"],
  [/\b(?:prend\w*|pres[oai]) (?:il )?controllo\b/g, "taken"],
  [/\bnon (?:possiamo|possono|posso|puo)\b/g, "cannot"],
  [/\b(?:per|a) tutti\b/g, "everyone"],
  [/consiglio di amministrazione/g, "board"],
];

/** A word as it is compared: lower case, without its common endings, folded into its group. */
export function stem(word) {
  const w = bare(word);
  return CANON.get(w) || w;
}

/** The words that carry meaning, compared as `stem` makes them. */
export function tokens(text) {
  let t = String(text == null ? "" : text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b[a-z]{1,5}['\u2019](?=[aeiouh])/g, " ");     // l'accesso, dell'ambiente: the article goes, the word stays
  for (const [re, to] of PHRASES_IT) t = t.replace(re, to);
  t = t
    .replace(/data\s+cent(re|er)s?/g, "datacentre")
    .replace(/round[\s-]+trips?/g, "roundtrip")
    .replace(/(?:out|end)\s+of\s+(?:[a-z']+\s+){0,2}(?:support|life)|\beol\b|support\s+ends?/g, "unsupported")
    .replace(/multi[\s-]+factor|two[\s-]+factor/g, "multifactor")
    .replace(/(?:switch|power|turn)(?:s|ed|ing)?[\s-]+off/g, "poweredoff")
    .replace(/(?:sign|log)(?:s|ged|ging)?[\s-]+(?:in|on)\b/g, "signin")
    .replace(/operating\s+systems?/g, "os")
    .replace(/fail(?:s|ed|ing)?[\s-]+over/g, "failover")
    .replace(/fail(?:s|ed|ing)?[\s-]+back/g, "failback")
    .replace(/point[\s-]+in[\s-]+time/g, "pointintime")
    .replace(/recovery[\s-]+points?(\s+objectives?)?/g, "rpo")
    .replace(/recovery[\s-]+times?(\s+objectives?)?/g, "rto")
    .replace(/(\d)\s*ms\b/g, "$1 ms");
  const out = [];
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (STOP_IT.has(raw)) continue;
    const w = IT.get(raw) || raw;
    if (!w || /^\d+$/.test(w) || (w.length < 3 && !SHORT.has(w)) || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

// a question's words are worked out once, not at every key pressed while something is written
const KNOWN = new WeakMap();
const weights = (q) => {
  if (KNOWN.has(q)) return KNOWN.get(q);
  const m = new Map();
  const add = (text, wt) => { for (const t of new Set(tokens(text))) m.set(t, (m.get(t) || 0) + wt); };
  add(q.listen, 1); add(q.why, 1); add(q.probe, 1); add(q.q, 2);
  KNOWN.set(q, m);
  return m;
};

/**
 * The questions these words most likely answer, best first: at most `n`, each with its score; none when no
 * question shares a word that carries meaning.
 * @param {{key:string, q:{q:string, listen?:string, why?:string, probe?:string}}[]} cards
 * @param {string} said
 */
export function match(cards, said, n = 3) {
  const heard = [...new Set(tokens(said))];
  if (!heard.length || !cards.length) return [];
  const each = cards.map((card) => ({ card, w: weights(card.q) }));
  const df = new Map();
  for (const { w } of each) for (const t of w.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + cards.length / (df.get(t) || 1));
  const scored = each.map(({ card, w }, i) => ({ card, i, score: heard.reduce((s, t) => s + (w.get(t) || 0) * idf(t), 0) }));
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n).map(({ card, score }) => ({ card, score }));
}

/** A note with what was just heard added to it, kept within the length a note can have. */
export function joinNote(before, heard) {
  const add = String(heard || "").trim(), old = String(before || "").trim();
  if (!old) return add.slice(0, NOTE_MAX);
  if (!add || old.toLowerCase().includes(add.toLowerCase())) return old.slice(0, NOTE_MAX);
  return `${old}; ${add}`.slice(0, NOTE_MAX);
}

// a figure in what was said: "about 2 million a day", "€40,000 per hour", "500k each outage"
const MULT = { k: 1e3, thousand: 1e3, thousands: 1e3, m: 1e6, mn: 1e6, mio: 1e6, million: 1e6, millions: 1e6, bn: 1e9, billion: 1e9, billions: 1e9,
  mila: 1e3, milione: 1e6, milioni: 1e6, miliardo: 1e9, miliardi: 1e9 };
const AMOUNT = /([€$£])?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|thousands?|m|mn|mio|millions?|bn|billions?|mila|milion[ei]|miliard[oi])?(?![a-z0-9])(?!\s?(?:ms|milliseconds?|km|%|percent|years?|months?|weeks?|days?|hours?|minutes?|tb|gb|vms?|servers?|sites?|hosts?|people|users?|anni|mesi|settimane|giorni|ore|minuti|utenti|persone|sedi|siti|macchine|dipendenti|per ?cento)\b)/g;
const PERIODS = [
  ["hour", /\b(?:per|an|a|each|every)\s+hour\b|\bhourly\b|\/\s?(?:h|hr|hour)\b|\b(?:all['\u2019]|ogni )ora\b|\borari[oe]?\b/],
  ["day", /\b(?:per|a|each|every)\s+day\b|\bdaily\b|\/\s?day\b|\b(?:al|ogni|per|a) giorno\b|\bgiornalier[oia]\b/],
  ["week", /\b(?:per|a|each|every)\s+week\b|\bweekly\b|\b(?:alla|a|ogni|per) settimana\b|\bsettimanal[ei]\b/],
  ["month", /\b(?:per|a|each|every)\s+month\b|\bmonthly\b|\b(?:al|ogni|per|a) mese\b|\bmensil[ei]\b/],
  ["year", /\b(?:per|a|each|every)\s+year\b|\byearly\b|\bannual(?:ly)?\b|\bper annum\b|\b(?:all['\u2019]|l['\u2019]|ogni |per |a )anno\b|\bannu[oia]\b|\bannual[ei]\b/],
  ["incident", /\b(?:per|an|each|every)\s+(?:incident|outage|breach|attack|event)\b|\b(?:per|ogni|a) (?:ogni )?(?:incidente|fermo|interruzione|disservizio|attacco|evento)\b/],
];

/**
 * The money in what was said, and what it is counted per: the period said, else the one the question asks about.
 * A bare small number ("three years ago", "2 ms") is not a figure: it needs a currency, a "thousand" or "million",
 * or to be a thousand or more. Null when there is no figure, or nothing says what it is counted per.
 * @returns {{amount:number, per:string}|null}
 */
export function figureIn(said, question) {
  const t = ` ${String(said == null ? "" : said).toLowerCase()} `;
  let best = 0;
  for (const m of t.matchAll(AMOUNT)) {
    const [, cur, raw, mult] = m;
    const n = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(",", "."));
    const amount = n * (mult ? MULT[mult] : 1);
    if (!Number.isFinite(amount) || !(cur || mult || amount >= 1000)) continue;
    if (!cur && !mult && /^(19|20)\d\d$/.test(raw)) continue;        // a year, not money
    best = Math.max(best, amount);
  }
  if (!best || best > 1e13) return null;
  const q = String((question && question.q) || "").toLowerCase();
  const said_ = PERIODS.find(([, re]) => re.test(t));
  const asked = PERIODS.find(([p]) => new RegExp(`\\b${p}s?\\b`).test(q));
  const per = said_ ? said_[0] : asked ? asked[0] : null;
  return per ? { amount: Math.round(best), per } : null;
}

/**
 * The concerns the lines in scope expect (their stories' objections), as cards to hold what was said against. Only
 * what the customer would say counts: a concern is offered when what was heard says much the same.
 */
export function concernCards(catalog, scope) {
  const out = [];
  for (const p of scope) {
    const line = catalog.lines[p];
    const objs = (line && line.story && line.story.objections) || [];
    objs.forEach((o, i) => out.push({ key: `obj:${p}#${i}`, line: p, index: i, label: line.label, o }));
  }
  return out;
}

/**
 * The concern what was said voices, if any: the ones whose words it covers best, at least `min` of them and at least
 * two (one, for a concern of one word), or four of a longer one. At most `n`, best first.
 */
export function concernsHeard(cards, said, { min = 0.7, n = 1 } = {}) {
  const heard = new Set(tokens(said));
  if (!heard.size) return [];
  return cards.map((card, i) => {
    const own = [...new Set(tokens(card.o.says))];
    const hit = own.filter((t) => heard.has(t)).length;
    return { card, i, share: own.length ? hit / own.length : 0, hit, need: Math.min(2, own.length) };
  }).filter((x) => (x.share >= min && x.hit >= x.need) || x.hit >= 4).sort((a, b) => b.share - a.share || b.hit - a.hit || a.i - b.i)
    .slice(0, n).map(({ card, share }) => ({ card, share }));
}

// ------------------------------------------------------------------ a figure for a sketch
// "about 1,200 users", "45 databases", "300 TB of file shares", "30 applications": said in a meeting, they are the
// figures a first sketch starts from. Only for the lines in scope, in English or Italian; nothing is put in a sketch
// until the person says so.

const num = (raw, mult) => {
  const n = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n * (mult ? 1000 : 1) : NaN;
};
const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|mila|thousand)?`;
const SKETCH_FIGURES = [
  { sketch: "vdi", field: "users", line: "euc", what: "users", label: "users of the desktop sizing sketch",
    re: new RegExp(String.raw`\b${NUM}\s+(?:named\s+)?(?:users|utenti|employees|dipendenti|desktops|postazioni)\b(?![^.;]*\b(?:each|per (?:site|branch|store|office)|a site|ciascun[ao]|per sede|per filiale)\b)`) },
  { sketch: "db", field: "databases", line: "dbaas", what: "databases", label: "databases of the licence sketch",
    re: new RegExp(String.raw`\b${NUM}\s+(?:production\s+)?(?:databases|database|db|instances|istanze)\b`) },
  { sketch: "db", field: "cores_today", line: "dbaas", what: "cores licensed today", label: "cores licensed today, in the licence sketch",
    re: new RegExp(String.raw`\b${NUM}\s+(?:licensed\s+|physical\s+)?cores?\b(?=[^.;]*\blicen)|\blicen[a-z]*\s+(?:on\s+|for\s+|su\s+|per\s+)?${NUM}\s+(?:cores?|core)\b`) },
  { sketch: "k8s", field: "apps", line: "kubernetes-platform", what: "applications", label: "applications of the container platform sketch",
    re: new RegExp(String.raw`\b${NUM}\s+(?:containeri[sz]ed\s+)?(?:applications|apps|microservices|applicazioni|microservizi)\b`) },
  { sketch: "files", field: "data_tib", line: "file-storage", what: "TiB of file data", label: "file data of the file storage sketch",
    re: new RegExp(String.raw`\b${NUM}\s*(tb|tib|pb|pib)\b(?=[^.;]*\b(?:files?|shares?|nas|condivis[a-z]*|cartelle)\b)`), size: true },
  { sketch: "obj", field: "data_tib", line: "object-storage", what: "TiB of protected data", label: "protected data of the backup capacity sketch",
    re: new RegExp(String.raw`\b${NUM}\s*(tb|tib|pb|pib)\b(?=[^.;]*\b(?:backups?|backed up|protected|copie|da proteggere|protetti)\b)`), size: true },
  { sketch: "dr", field: "data_tib", line: "dr-backup", what: "TiB of protected data", label: "protected data of the recovery design",
    re: new RegExp(String.raw`\b${NUM}\s*(tb|tib|pb|pib)\b(?=[^.;]*\b(?:backups?|backed up|protect(?:ed)?|replicat(?:e|ed)|da proteggere|protetti|replica(?:re|ti)?)\b)`), size: true },
  { sketch: "dr", field: "latency_ms", line: "dr-backup", what: "ms round trip between the sites", label: "round trip between the sites, in the recovery design", decimal: true,
    re: /\b(\d+(?:[.,]\d+)?)()\s?(?:ms|milliseconds?|millisecondi)\b(?=[^.;]*\b(?:sites?|siti|sit[oi]|apart|away|round|latency|latenza|between|tra)\b)|\b(?:sites?|siti|apart|away|round[- ]trip|latency|latenza|between|tra)\b[^.;]*?\b(\d+(?:[.,]\d+)?)()\s?(?:ms|milliseconds?|millisecondi)\b/ },
  { sketch: "gpu", field: "params_b", line: "private-ai", what: "billion parameters", label: "size of the model in the GPU sketch", decimal: true,
    re: /\b(\d+(?:[.,]\d+)?)()\s?b\b(?=[^.;]*\b(?:models?|modell[oi]|llm|parameters|parametri)\b)|\b(\d+(?:[.,]\d+)?)()\s?(?:billion|bn|miliardi(?: di)?)\s+param/ },
  { sketch: "gpu", field: "bits", line: "private-ai", what: "bits per weight", label: "bits per weight in the GPU sketch",
    re: /\b(4|8|16)()[- ]?bits?\b|\b(?:fp|int)(4|8|16)()\b/ },
  { sketch: "gpu", field: "context_k", line: "private-ai", what: "thousand tokens of context", label: "context per request in the GPU sketch", decimal: true,
    re: /\b(\d+(?:[.,]\d+)?)()\s?k\s+(?:tokens?|context|token di contesto|di contesto)\b|\bcontext (?:of|window of|di)\s+(\d+(?:[.,]\d+)?)()\s?k\b/ },
  { sketch: "gpu", field: "concurrent", line: "private-ai", what: "requests at once", label: "requests at once in the GPU sketch",
    re: new RegExp(String.raw`\b${NUM}\s+(?:requests|users|richieste|utenti|sessions|sessioni)\s+(?:at once|at the same time|in flight|concurrent(?:ly)?|contemporane[ei]|in contemporanea|alla volta)\b`) },
];
const FMT = new Intl.NumberFormat("en");
const TIB = { tb: 1e12 / 2 ** 40, tib: 1, pb: 1e15 / 2 ** 40, pib: 1024 };
// the first number a pattern caught, with what it is multiplied by: patterns with two places for it hold two pairs
const pick = (m) => { for (let i = 1; i < m.length; i += 2) if (m[i] !== undefined) return [m[i], m[i + 1]]; return ["", ""]; };

/**
 * The figures in what was said that a first sketch on a line in scope starts from, each with the sketch and the
 * setting it goes in. "900 at the same time", beside a number of users (said, or already in the sketch), is the
 * share connected at once.
 * @returns {{sketch:string, field:string, value:number, what:string, label:string}[]}
 */
export function sketchFigures(said, scope, current = {}) {
  const t = ` ${String(said == null ? "" : said).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const out = [];
  for (const f of SKETCH_FIGURES) {
    if (!(scope || []).includes(f.line)) continue;
    const m = t.match(f.re);
    if (!m) continue;
    const [raw, mult] = pick(m);
    let value = num(raw, f.size ? "" : mult);
    if (f.size) value *= TIB[m[3]] || 1;
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ sketch: f.sketch, field: f.field, value: f.size || f.decimal ? Math.round(value * 10) / 10 : Math.round(value), what: f.what, label: f.label });
  }
  const users = (out.find((x) => x.field === "users") || {}).value || (current.vdi && current.vdi.users) || 0;
  const at = (scope || []).includes("euc") && t.match(new RegExp(String.raw`\b${NUM}\s+(?:of them\s+)?(?:concurrent|connected at once|at once|at the same time|contemporane[ia]|in contemporanea)\b`));
  if (at && users) {
    const n = num(at[1], at[2] || "");
    if (n > 0 && n <= users) out.push({ sketch: "vdi", field: "concurrency_pct", value: Math.round((n / users) * 100), what: `percent connected at once (${FMT.format(n)} of ${FMT.format(users)})`, label: "share connected at the busiest hour, in the desktop sizing sketch" });
  }
  return out;
}

// the case for change, in the customer's words: what the renewal does to the price, when it comes, what staying costs
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18,
  uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, diciotto: 18 };
const PRICE = /\b(?:renewal|renews?|price|cost|licen[cs]\w*|subscription|support|prezzo|costo|canone|rinnov\w*|licenz\w*|abbonament\w*)\b/;
const CASE_FIGURES = [
  { field: "stay_uplift_pct", what: "percent more at the next renewal", label: "expected rise at the next renewal, in the case for change",
    read: (t) => {
      if (!PRICE.test(t)) return null;
      if (/\b(?:tripl(?:e|es|ed|ing)|triplica(?:to|re)?|tre volte)\b/.test(t)) return 200;
      if (/\b(?:doubl(?:e|es|ed|ing)|raddoppia(?:to|re)?|il doppio)\b/.test(t)) return 100;
      const m = t.match(/\b(\d+(?:[.,]\d+)?)\s?(?:%|percent|per cento)(?=[^.;]*\b(?:renewal|rise|increase|more|aumento|rinnovo|in piu)\b)|\b(?:renewal|rise|increase|up|aumento|rinnovo)\b[^.;]*?\+?\b(\d+(?:[.,]\d+)?)\s?(?:%|percent|per cento)/);
      return m ? Number((m[1] || m[2]).replace(",", ".")) : null;
    } },
  { field: "renewal_in_months", what: "months to the next renewal", label: "months to the next renewal, in the case for change",
    read: (t) => {
      const m = t.match(/\b(?:renewal|renews|contract|expires?|ends|rinnovo|contratto|scade|scadenza)\b[^.;]*?\b(?:in|tra|fra)\s+(\d+|[a-z]+)\s+(?:months?|mesi|mese)\b/);
      if (!m) return null;
      const v = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1]];
      return v || null;
    } },
  { field: "stay_run", what: "a year for the current platform", label: "yearly cost of the current platform, in the case for change",
    read: (t) => {
      if (!/\b(?:licen[cs]\w*|subscriptions?|support|platform|hypervisor|licenz\w*|abbonament\w*|canone|piattaforma|supporto)\b/.test(t) || /\b(?:down|outage|fermo|disservizio)\b/.test(t)) return null;
      const f = figureIn(t, { q: "per year" });
      return f && f.per === "year" ? f.amount : null;
    } },
  { field: "downtime_cost_hour", what: "for an hour down", label: "cost of an hour down, in the case for change",
    read: (t) => {
      if (!/\b(?:down|downtime|outage|offline|fermo|disservizio|stop)\b/.test(t)) return null;
      const f = figureIn(t, { q: "per hour" });
      return f && f.per === "hour" ? f.amount : null;
    } },
  { field: "ops_hours_now", what: "hours a month on routine work", label: "hours a month on routine work today, in the case for change",
    read: (t) => {
      const m = t.match(/\b(\d+)\s+(?:hours?|ore)\s+(?:a|per|each|al|ogni)\s+(?:month|mese)\b/);
      return m && /\b(?:patch\w*|upgrad\w*|provision\w*|routine|maintenance|manutenzion\w*|aggiornament\w*)\b/.test(t) ? Number(m[1]) : null;
    } },
];

/**
 * The figures of the case for change in what was said: the rise at the renewal ("it triples", "+40%"), when it comes
 * ("in ten months"), what staying costs a year, an hour down, the hours of routine work. Any line: every deal has one.
 * @returns {{sketch:string, field:string, value:number, what:string, label:string}[]}
 */
export function caseFigures(said) {
  const t = ` ${String(said == null ? "" : said).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const out = [];
  for (const f of CASE_FIGURES) {
    const v = f.read(t);
    if (v != null && Number.isFinite(v) && v > 0) out.push({ sketch: "case", field: f.field, value: v, what: f.what, label: f.label });
  }
  return out;
}

// what one machine costs, in the customer's words: the machines, the people, and what a year of each part costs
const UNIT_SCOPE = ["cloud-operations", "service-provider-cloud", "hybrid-cloud"];
const perYear = (t, words) => {
  if (!words.test(t)) return null;
  const f = figureIn(t, { q: "per year" });
  return f && f.per === "year" ? f.amount : null;
};
const UNIT_FIGURES = [
  { field: "machines", what: "machines running", label: "machines running, in the cost per machine",
    read: (t) => { const m = t.match(new RegExp(String.raw`\b${NUM}\s+(?:running\s+)?(?:vms|virtual machines|machines|macchine(?: virtuali)?|virtual servers|server virtuali)\b`)); return m ? num(m[1], m[2]) : null; } },
  { field: "people_fte", what: "people running the estate", label: "people running the estate, in the cost per machine",
    read: (t) => {
      const m = t.match(/\b(\d+(?:[.,]\d+)?)\s+(?:people|persons|ftes?|engineers|admins|administrators|sysadmins|persone|sistemisti|tecnici)\b(?=[^.;]*\b(?:run|runs|manage|manages|look after|operate|gestiscono|seguono|operations|estate|platform|infrastructure|infrastruttura|piattaforma)\b)/);
      return m ? Number(m[1].replace(",", ".")) : null;
    } },
  { field: "fte_cost", what: "a year for one full-time person", label: "cost of one full-time person, in the cost per machine",
    read: (t) => perYear(t, /\b(?:a person|one person|an engineer|an admin|per person|fte|salary|una persona|un sistemista|stipendio|per persona)\b/) },
  { field: "licences_year", what: "a year in licences and subscriptions", label: "software licences and subscriptions, in the cost per machine",
    read: (t) => (/\b(?:down|outage|fermo)\b/.test(t) ? null : perYear(t, /\b(?:licen[cs]\w*|subscriptions?|licenz\w*|abbonament\w*)\b/)) },
  { field: "power_year", what: "a year in power and cooling", label: "power and cooling, in the cost per machine",
    read: (t) => perYear(t, /\b(?:power|cooling|electricity|energia|corrente|elettricita|raffreddamento)\b/) },
  { field: "idle_pct", what: "percent of the machines idle or forgotten", label: "share of machines idle, oversized or forgotten, in the cost per machine",
    read: (t) => {
      const m = t.match(/\b(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|per cento\b)(?=[^.;]*\b(?:idle|oversized|forgotten|zombie|unused|inattiv\w*|inutilizzat\w*|dimenticat\w*|sovradimensionat\w*)\b)/);
      return m ? Number(m[1].replace(",", ".")) : null;
    } },
  { field: "cloud_month", what: "a month for a comparable machine in a public cloud", label: "a comparable machine in a public cloud, in the cost per machine",
    read: (t) => {
      if (!/\b(?:cloud|aws|azure|gcp|hyperscaler)\b/.test(t)) return null;
      const m = t.match(/(?:[€$£]\s?)?\b(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(?:€|eur|euros?|dollars?|\$)?\s*(?:a|per|each|al|\/)\s?(?:month|mese)\b/);
      const v = m ? num(m[1], "") : NaN;
      return Number.isFinite(v) && v > 0 && v < 1e5 ? v : null;
    } },
];

/**
 * The figures of what one machine costs in what was said, when a line that counts it is in scope: the machines running,
 * the people and what one costs, licences and power a year, the share of idle machines, a machine in a public cloud.
 * @returns {{sketch:string, field:string, value:number, what:string, label:string}[]}
 */
export function unitFigures(said, scope) {
  if (!(scope || []).some((p) => UNIT_SCOPE.includes(p))) return [];
  const t = ` ${String(said == null ? "" : said).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const out = [];
  for (const f of UNIT_FIGURES) {
    const v = f.read(t);
    if (v != null && Number.isFinite(v) && v > 0) out.push({ sketch: "unit", field: f.field, value: v, what: f.what, label: f.label });
  }
  return out;
}

// shops, plants and branches: how many sites of a kind, the trips to sites a year and what one costs
const KIND_WORD = (name) => String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").trim();
const pluralRe = (w) => (w.endsWith("s") ? `${w}?` : `${w}s?`);

/**
 * The edge design's figures in what was said: sites of a kind it knows by name ("120 stores" when a kind is called
 * Stores, "6 plants"), the trips to sites a year, what one trip costs.
 * @returns {{sketch:string, field:string, value:number, what:string, label:string, apply?:Function, has?:Function}[]}
 */
export function edgeFigures(said, scope, current = {}) {
  if (!(scope || []).includes("edge-sites")) return [];
  const t = ` ${String(said == null ? "" : said).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const out = [];
  const kinds = (current.edge && Array.isArray(current.edge.kinds) && current.edge.kinds.length ? current.edge.kinds : EDGE_DEFAULTS.kinds);
  kinds.forEach((k, i) => {
    const words = KIND_WORD(k.name).split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const name = [...words.slice(0, -1), pluralRe(words[words.length - 1])].join("\\s+");
    const m = t.match(new RegExp(String.raw`\b${NUM}\s+${name}\b`));
    if (!m) return;
    const v = num(m[1], m[2]);
    if (!(v > 0)) return;
    out.push({ sketch: "edge", field: `kinds.${i}.sites`, value: Math.round(v), what: `sites of the kind ${k.name}`, label: `number of ${k.name.toLowerCase()} in the edge design`,
      apply: (b) => ({ ...b, kinds: (b.kinds && b.kinds.length ? b.kinds : EDGE_DEFAULTS.kinds).map((x, j) => (j === i ? { ...x, sites: Math.round(v) } : x)) }),
      has: (b) => !!(b && b.kinds && b.kinds[i] && b.kinds[i].sites === Math.round(v)) });
  });
  const siteTalk = /\b(?:sites?|stores?|shops?|branch\w*|plants?|sedi|negozi|filiali|stabiliment\w*)\b/.test(t);
  const trips = t.match(new RegExp(String.raw`\b${NUM}\s+(?:trips|visits|site visits|truck rolls|interventi|trasferte|uscite)\b[^.;]*\b(?:a year|per year|each year|every year|all'anno|l'anno|annui|ogni anno)\b`))
    || (siteTalk ? t.match(new RegExp(String.raw`\b${NUM}\s+(?:times|volte)\s+(?:a|per|all')\s?(?:year|anno)\b`)) : null);
  if (trips) {
    const [raw, mult] = pick(trips);
    const v = num(raw, mult);
    if (v > 0) out.push({ sketch: "edge", field: "visits_year", value: Math.round(v), what: "trips to sites a year", label: "trips to sites a year, in the edge design" });
  }
  const cost = t.match(/\b(?:a|one|each|every|ogni|una)\s+(?:trip|visit|truck roll|site visit|trasferta|uscita|intervento)\b[^.;]*?\b(?:costs?|costa|is|e)\b[^.;\d]*?[€$£]?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|mila|thousand)?/);
  if (cost) {
    const v = num(cost[1], cost[2]);
    if (v > 0) out.push({ sketch: "edge", field: "visit_cost", value: Math.round(v), what: "for one trip to a site", label: "cost of one trip, in the edge design" });
  }
  return out;
}

// how long backups are kept, and how fast file data grows: said in every backup and file conversation
const RETENTION = [
  { sketch: "obj", field: "daily_days", line: "object-storage", what: "daily restore points kept", label: "daily restore points kept, in the backup capacity sketch",
    re: [/\b(\d+)\s+(?:days?|giorni)\s+(?:of\s+|di\s+)?(?:daily\s+)?(?:backups?|restore points|copies|copie|retention|ritenzione)\b/, /\b(?:daily|dailies|giornalier\w*)\b[^.;]*?\b(?:for\s+|per\s+)?(\d+)\s+(?:days?|giorni)\b/, /\b(\d+)\s+(?:dailies|daily backups|giornalieri)\b/] },
  { sketch: "obj", field: "weekly_weeks", line: "object-storage", what: "weekly fulls kept", label: "weekly fulls kept, in the backup capacity sketch",
    re: [/\b(\d+)\s+(?:weeklies|weekly(?:\s+(?:fulls?|backups?|copies))?|settimanali)\b/, /\b(?:weekly|weeklies|settimanal\w*)\b[^.;]*?\b(?:for\s+|per\s+)?(\d+)\s+(?:weeks?|settimane)\b/] },
  { sketch: "obj", field: "monthly_months", line: "object-storage", what: "monthly fulls kept", label: "monthly fulls kept, in the backup capacity sketch",
    re: [/\b(\d+)\s+(?:monthlies|monthly(?:\s+(?:fulls?|backups?|copies))?|mensili)\b/, /\b(?:monthly|monthlies|mensil\w*)\b[^.;]*?\b(?:for\s+|per\s+)?(\d+)\s+(?:months?|mesi)\b/,
      { years: /\b(?:monthly|monthlies|mensil\w*)\b[^.;]*?\b(?:for\s+|per\s+)?(\d+)\s+(?:years?|anni)\b/ }] },
  { sketch: "files", field: "growth_pct", line: "file-storage", what: "percent growth a year", label: "growth a year, in the file storage sketch", context: /\b(?:files?|shares?|nas|condivis\w*|cartelle|file data)\b/,
    re: [/\b(?:grow\w*|growth|cresc\w*)\b[^.;]*?\b(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|per cento\b)/, /\b(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|per cento\b)[^.;]*\b(?:growth|grow\w*|cresc\w*)/] },
];

/**
 * How long backups are kept (daily, weekly and monthly copies, "monthlies for 7 years" as months) and how fast file
 * data grows, for the sketches of the lines in scope.
 * @returns {{sketch:string, field:string, value:number, what:string, label:string}[]}
 */
export function retentionFigures(said, scope) {
  const t = ` ${String(said == null ? "" : said).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const out = [];
  for (const f of RETENTION) {
    if (!(scope || []).includes(f.line) || (f.context && !f.context.test(t))) continue;
    let v = null;
    for (const r of f.re) {
      const years = r.years ? t.match(r.years) : null;
      const m = years ? null : r.years ? null : t.match(r);
      if (years) { v = Number(years[1]) * 12; break; }
      if (m) { v = Number(String(m[1]).replace(",", ".")); break; }
    }
    if (v != null && Number.isFinite(v) && v > 0) out.push({ sketch: f.sketch, field: f.field, value: v, what: f.what, label: f.label });
  }
  return out;
}

// the pace of a migration: machines a wave, days between waves, and the link the data is copied over ahead of each
const PACE_UNIT = { day: 1, days: 1, giorno: 1, giorni: 1, week: 7, weeks: 7, weekend: 7, weekends: 7, settimana: 7, settimane: 7, "fine settimana": 7,
  fortnight: 14, fortnights: 14, month: 30, months: 30, mese: 30, mesi: 30 };
const PACE_N = { ...WORD_NUM, other: 2, altro: 2, a: 1, one: 1 };
const LINK_WORDS = /\b(?:links?|circuits?|lines?|connections?|connectivity|bandwidth|wan|fibre|fiber|pipe|between|collegament\w*|banda|line[ae]|connession\w*|fibra|tra)\b/;
const SHOP_WORDS = /\b(?:stores?|shops?|branch\w*|plants?|negozi\w*|filial\w*|stabiliment\w*|punti vendita)\b/;

/**
 * The plan in waves' figures in what was said, once an inventory is read and a migration is in scope: the machines a
 * wave ("30 machines a weekend"), the days between waves ("a wave every two weeks"), the link the data is copied over
 * ("a 10 Gbit link between the data centres"). A link said about shops or branches is theirs, not the migration's.
 * @returns {{sketch:string, field:string, value:number, what:string, label:string}[]}
 */
export function wavesFigures(said, scope, current = {}) {
  if (!(scope || []).includes("platform-migration") || !current.inventory) return [];
  const t = ` ${String(said == null ? "" : said).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const out = [];
  const per = t.match(new RegExp(String.raw`\b${NUM}\s+(?:vms?|virtual machines|machines|servers|workloads|macchine(?: virtuali)?|server)\s+(?:per|a|an|each|every|at a|in a|in one|in each|ogni|alla|ad|in una|per ogni)\s+(?:wave|weekend|window|time|night|cutover|go|ondata|finestra|volta|fine settimana|notte)\b`));
  if (per) {
    const v = Math.round(num(per[1], per[2]));
    if (v >= 5 && v <= 1000) out.push({ sketch: "waves", field: "per_wave", value: v, what: "machines a wave at most", label: "machines a wave, in the plan in waves" });
  }
  const pace = /\b(?:waves?|ondat[ae]|migrat\w*|migrazion\w*|cutovers?|windows?|finestr[ae]|moves?|moving|spost\w*|migr\w*)\b/.test(t);
  const every = pace ? t.match(/\b(?:every|ogni)\s+(?:(\d+|[a-z]+)\s+)?(fine settimana|days?|weeks?|weekends?|fortnights?|months?|giorn[oi]|settiman[ae]|mes[ei])\b/)
    || t.match(/\b(?:(?:one|a|una|un')\s*(?:wave|ondata)|once)\s+(?:a|per|each|al|alla|ogni)\s+(week|fortnight|month|settimana|mese)\b/) : null;
  if (every) {
    const unit = PACE_UNIT[every[2] || every[1]];
    const n = every[2] === undefined ? 1 : every[1] === undefined ? 1 : /^\d+$/.test(every[1]) ? Number(every[1]) : PACE_N[every[1]];
    const v = n && unit ? n * unit : NaN;
    if (v >= 1 && v <= 60) out.push({ sketch: "waves", field: "every_days", value: v, what: "days between waves", label: "days between waves, in the plan in waves" });
  }
  const link = LINK_WORDS.test(t) && !SHOP_WORDS.test(t) ? t.match(/\b(\d+(?:[.,]\d+)?)\s?(gbit\/s|gbit|gbps|gb\/s|gigabit|gig|gb|mbit\/s|mbit|mbps|mb\/s|megabit)\b/) : null;
  if (link) {
    const v = Math.round(Number(link[1].replace(",", ".")) * (/^g/.test(link[2]) ? 1000 : 1));
    if (v >= 10 && v <= 400000) out.push({ sketch: "waves", field: "link_mbps", value: v, what: "Mbit/s for the copy ahead", label: "link for the copy ahead, in the plan in waves" });
  }
  return out;
}

// the sizing sketch's figures: growth, the vCPU per core, the servers that can be down, what one server holds, the copies
const NODE_WORD = String.raw`(?:servers?|nodes?|hosts?|nod[oi])`;
const PER_NODE = String.raw`(?:per|a|each|in each|on each|ogni|per ogni|for each)\s+${NODE_WORD}`;
const FILE_TALK = /\b(?:files?|shares?|nas|condivis\w*|cartelle)\b/;
const SMALL = { one: 1, two: 2, three: 3, four: 4, un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4 };
const small = (x) => (/^\d$/.test(x) ? Number(x) : SMALL[x]);

/**
 * The sizing sketch's figures in what was said, once an inventory is read and the servers are in scope: the growth to
 * plan for, the vCPU per physical core, the servers that can be down at once ("N+2", "two servers down"), the cores and
 * memory of one server, and two or three copies of the data. Growth said about file shares is the file sketch's.
 * @returns {{sketch:string, field:string, value:number, what:string, label:string, apply?:Function, has?:Function}[]}
 */
export function sizingFigures(said, scope, current = {}) {
  if (!(scope || []).includes("hci") || !current.inventory) return [];
  const t = ` ${String(said == null ? "" : said).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const out = [];
  const push = (field, value, what, label, extra = {}) => out.push({ sketch: "sizing", field, value, what, label: `${label}, in the sizing sketch`, ...extra });
  const grow = FILE_TALK.test(t) ? null : t.match(/\b(?:grow\w*|growth|cresc\w*)\b[^.;]*?\b(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|per cento\b)/)
    || t.match(/\b(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|per cento\b)\s+(?:of\s+|di\s+)?(?:growth|crescita|more machines|more vms|more workloads)\b/);
  if (grow) {
    const v = Number(grow[1].replace(",", "."));
    if (v > 0 && v <= 500) push("growth_pct", v, "percent growth over the platform's life", "growth over the platform's life");
  }
  const cpu = /\b(?:v?cpus?|cores?|processor\w*|processori)\b/.test(t);
  const ratio = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:vcpus?|virtual cpus?)\s+(?:per|a|for each|to a|to one|on each|ogni|per ogni|su ogni|per)\s+(?:physical\s+)?core\b/)
    || (cpu ? t.match(/\b(\d+(?:[.,]\d+)?)\s?(?::|to)\s?1\b(?=[^.;]*\b(?:overcommit\w*|ratio|consolidation|rapporto)\b)|\b(?:overcommit\w*|ratio|consolidation|rapporto)\b[^.;]*?\b(\d+(?:[.,]\d+)?)\s?(?::|to)\s?1\b/) : null);
  if (ratio) {
    const v = Number((ratio[1] || ratio[2]).replace(",", "."));
    if (v >= 1 && v <= 16) push("vcpu_per_core", v, "vCPU per physical core", "vCPU per physical core");
  }
  const spare = t.match(/\bn\s?\+\s?([0-4])\b/)
    || t.match(new RegExp(String.raw`\b(\d|one|two|three|four|un|uno|due|tre|quattro)\s+${NODE_WORD}\s+(?:down|failed|at once|lost|out|guast[oi]|fermi|gi[u])\b`))
    || t.match(new RegExp(String.raw`\b(?:lose|losing|survive|tolerate|perdere|reggere)\s+(\d|one|two|three|four|un|uno|due|tre|quattro)\s+${NODE_WORD}\b`));
  if (spare) {
    const v = small(spare[1]);
    if (v != null && v >= 0 && v <= 4) push("spare_nodes", v, `spare server${v === 1 ? "" : "s"} for failures`, "spare servers for failures");
  }
  // "2 x 16 cores", "two sockets of 16 cores": the cores of one server, socket by socket
  const sockets = t.match(/\b(\d|one|two|four|un|uno|due|quattro)\s*(?:x|sockets? of|processors? of|cpus? of|socket da|processori da)\s*(\d+)\s+(?:physical\s+)?(?:cores?|core)\b/);
  const cores = t.match(new RegExp(String.raw`\b(\d+)\s+(?:physical\s+)?(?:cores?|core fisici)\s+${PER_NODE}\b`))
    || t.match(new RegExp(String.raw`\b${NODE_WORD}(?:\s+[a-z]+)?\s+(?:with|of|da|con|have|hanno)\s+(\d+)\s+(?:physical\s+)?(?:cores?|core)\b`));
  const perServer = sockets ? small(sockets[1]) * Number(sockets[2]) : cores ? Number(cores[1]) : NaN;
  // said of the hosts running today, it is what a per-core licence counts now, not the new servers
  const today = /\b(?:today|currently|now|existing|current|old|oggi|attual\w*|esistent\w*|vecch\w*)\b/.test(t);
  if (perServer >= 4 && perServer <= 512) {
    if (today) push("today_cores_per_host", perServer, "cores in each host today", "cores in each host today");
    else push("node_cores", perServer, "cores per server", "cores per server");
  }
  const MEM = String.raw`(\d+(?:[.,]\d+)?)\s?(gb|gib|tb|tib)\s+(?:of\s+|di\s+)?(?:ram|memory|memoria)`;
  const mem = t.match(new RegExp(String.raw`\b${MEM}\s+${PER_NODE}\b`)) || t.match(new RegExp(String.raw`\b${NODE_WORD}\s+(?:with|of|da|con)\b[^.;]*?\b${MEM}\b`));
  if (mem) {
    const v = Math.round(Number(mem[1].replace(",", ".")) * (/^t/.test(mem[2]) ? 1024 : 1));
    if (v >= 32 && v <= 16384) push("node_mem_gib", v, "GiB of memory per server", "memory per server");
  }
  // the data reduction counted: said of the platform, not of backups or file shares, which have sketches of their own
  const reduce = /\b(?:backups?|back(?:ed)? up|backing up|copie di sicurezza|files?|shares?|nas)\b/.test(t) ? null
    : t.match(/\b(\d+(?:[.,]\d+)?)\s?(?::|to|x)\s?1\b(?=[^.;]*\b(?:compress\w*|dedup\w*|reduction|riduzione)\b)|\b(?:compress\w*|dedup\w*|reduction|riduzione)\b[^.;]*?\b(\d+(?:[.,]\d+)?)\s?(?::|to|x)\s?1\b/);
  if (reduce) {
    const v = Number((reduce[1] || reduce[2]).replace(",", "."));
    if (v >= 1 && v <= 5) push("reduction", v, "to 1 data reduction counted", "data reduction counted");
  }
  // erasure coding on the cold data: "4+2" or double parity is two parity strips, "4+1" or single parity one
  const ec = t.match(/\b(?:erasure cod\w*|codifica di cancellazione)\b|\bec\s?[2-8]\s?\+\s?[12]\b|\b[2-8]\s?\+\s?[12]\b(?=[^.;]*\b(?:parity|parita|erasure)\b)/);
  if (ec) {
    const n = t.match(/\b[2-8]\s?\+\s?([12])\b/);
    const parity = n ? Number(n[1]) : /\b(?:double|two|dual|doppia|due)\s+(?:parity|parita)\b/.test(t) ? 2 : 1;
    const key = `ec${parity}`;
    push("protection", parity, `parity strip${parity === 1 ? "" : "s"}: erasure coding on the cold data`, "protection by erasure coding",
      { apply: (b) => ({ ...b, protection: key }), has: (b) => !!(b && b.protection === key) });
  }
  const copies = ec ? null : t.match(/\b(two|three|2|3|due|tre)\s+(?:copies|copie|replicas|repliche)\b|\b(?:rf|replication factor(?: of)?|fattore di replica)\s?([23])\b/);
  if (copies) {
    const n = small(copies[1] || copies[2]);
    const key = `copies${n}`;
    if (n === 2 || n === 3) push("protection", n, "copies of the data", "copies of the data", { apply: (b) => ({ ...b, protection: key }), has: (b) => !!(b && b.protection === key) });
  }
  return out;
}
