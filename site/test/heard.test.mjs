import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stem, tokens, match, joinNote, NOTE_MAX, concernCards, concernsHeard, sketchFigures, caseFigures, unitFigures, edgeFigures, retentionFigures } from "../heard.js";

const card = (key, q, listen = "", why = "", probe = "") => ({ key, label: "Disaster recovery", q: { q, listen, why, probe } });
const DR = [
  card("dr#0", "What would one day without your main site cost, and has anyone put a number on it?", "A figure per hour or per day turns recovery time into a budget line.", "Turns recovery objectives into a business decision.", "Which service would the business restore first, and has it agreed that order?"),
  card("dr#1", "When was the last full recovery test, and what went wrong in it?", "No full test in the last year means every recovery time is a guess.", "Tests always find something; no test means it is still hidden.", "What did the test leave out because it was too risky or too hard?"),
  card("dr#2", "Which sites and branches have no copy of their workloads anywhere?", "Branches with no copy are where one fire or one attack becomes permanent loss.", "Unprotected sites are the first gap to close.", "What would be lost for good if the smallest site burned down tonight?"),
  card("dr#3", "Where is the second site, how far away, and what is the network round-trip time between them?", "Under about five milliseconds allows zero-loss copies; beyond that, plan near-continuous or scheduled copies.", "Distance and latency decide whether copies can be synchronous.", "Is there a third place, a cloud or a partner site, that could hold a copy?"),
  card("dr#4", "Has every workload been given a recovery point and a recovery time, agreed with the business?", "Targets set by IT alone are wrong in both directions; agreed with the business they become a design input.", "Without objectives, nothing can be checked or prioritised.", "Which system has the strictest target, and who set it?"),
  card("dr#5", "Which workloads can lose no data at all, which can lose minutes, and which can lose hours?", "Zero loss needs synchronous copies over short distances; minutes or hours cost far less.", "Zero, minutes and hours need different replication, distances and costs.", "How many systems truly need zero data loss, if each had to justify the cost?"),
  card("dr#6", "Could an administrator account delete your backups today?", "If one account can delete the copies, so can ransomware: copies nobody can change, and a second approver, close it.", "If yes, ransomware can too.", "Is there a copy that no administrator can change before it expires?"),
  card("dr#7", "Does the recovery plan include the network: addresses, DNS, firewall rules?", "Failovers fail on addresses, name resolution and firewall rules more often than on data.", "Most failed recoveries fail on the network, not on the data.", "Will machines keep their addresses at the recovery site, or be given new ones?"),
];
const top = (said) => (match(DR, said)[0] || {}).card?.key;

test("words are compared without their endings and folded into the words that mean the same here", () => {
  assert.equal(stem("Copies"), stem("backups"));
  assert.equal(stem("wiped"), stem("delete"));
  assert.equal(stem("restored"), stem("failover"));
  assert.equal(stem("branches"), stem("warehouses"));
  assert.equal(stem("tested"), "test");
  assert.deepEqual(tokens("The data center is 40 km away, 2ms round trip"), [stem("site"), "away", "latency", "latency"]);
  assert.deepEqual(tokens("a recovery point objective"), [stem("target")]);
  assert.deepEqual(tokens("and the of 123"), []);
});

test("what was heard finds the question it answers, even in other words", () => {
  assert.equal(top("Any domain admin can wipe the backup repository"), "dr#6");
  assert.equal(top("Second data centre is 40 km away, about 2 ms"), "dr#3");
  assert.equal(top("The last failover drill was three years ago"), "dr#1");
  assert.equal(top("Nobody ever put a figure on a day of downtime, maybe a million in lost revenue"), "dr#0");
  assert.equal(top("The warehouses have nothing protected at all"), "dr#2");
  assert.equal(top("DNS and the firewall rules were never part of the plan"), "dr#7");
  assert.equal(top("RPO and RTO exist on paper, IT wrote them"), "dr#4");
});

test("at most three, best first, and none when nothing carries meaning", () => {
  const hits = match(DR, "copies of the backups at the second site");
  assert.ok(hits.length <= 3 && hits.length > 0);
  assert.ok(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score));
  assert.deepEqual(match(DR, "yes, and it is what it is"), []);
  assert.deepEqual(match([], "backups"), []);
});

test("a note gains what was heard, without repeating it and within the length of a note", () => {
  assert.equal(joinNote("", "Never tested"), "Never tested");
  assert.equal(joinNote("Only file restores", "Never tested"), "Only file restores; Never tested");
  assert.equal(joinNote("Never tested end to end", "never tested"), "Never tested end to end");
  assert.equal(joinNote("x".repeat(NOTE_MAX), "more").length, NOTE_MAX);
});

test("a figure in what was said: the money, and what it is counted per", async () => {
  const { figureIn } = await import("../heard.js");
  const day = { q: "What would one day without your main site cost, and has anyone put a number on it?" };
  const hour = { q: "What does an hour of downtime cost on your most important application?" };
  const open = { q: "What is at stake if nothing changes?" };
  assert.deepEqual(figureIn("about 2 million euros, finance agreed", day), { amount: 2000000, per: "day" });
  assert.deepEqual(figureIn("€40,000 per hour", day), { amount: 40000, per: "hour" });
  assert.deepEqual(figureIn("roughly 83k", hour), { amount: 83000, per: "hour" });
  assert.deepEqual(figureIn("1.5m a month in lost orders", open), { amount: 1500000, per: "month" });
  assert.deepEqual(figureIn("2.000.000 each outage", open), { amount: 2000000, per: "incident" });
  assert.deepEqual(figureIn("250000 a year", open), { amount: 250000, per: "year" });
  assert.equal(figureIn("the last test was three years ago, 2 ms apart", day), null);
  assert.equal(figureIn("40 km away and 300 vms", day), null);
  assert.equal(figureIn("about 2 million", open), null);           // nothing says per what
  assert.equal(figureIn("", day), null);
  assert.equal(figureIn("on the old platform since 2019, daily", day), null);   // a year, not money
});

test("what was heard about the deal finds its qualification question", async () => {
  const { DEAL } = await import("../qualify.js");
  const deal = DEAL.map((x) => ({ key: `deal#${x.id}`, label: "Qualify the deal", q: x }));
  const all = [...DR, ...deal];
  const first = (said) => (match(all, said)[0] || {}).card?.key;
  assert.equal(first("The CIO signs off anything above 500k"), "deal#decider");
  assert.equal(first("Our hosting contract expires in March, so it has to be chosen before then"), "deal#why_now");
  assert.equal(first("They are also talking to another supplier, or might build it themselves"), "deal#alternatives");
  assert.equal(first("The infrastructure lead will carry it to the board; she wants it badly"), "deal#champion");
  assert.equal(first("Any domain admin can wipe the backup repository"), "dr#6");      // the technical ones still find theirs
});

test("on the real questions of four lines, what was heard has its question among the three offered", () => {
  const cards = [];
  for (const p of ["hci", "dbaas", "dr-backup", "hybrid-cloud"]) {
    const file = new URL(`../../src/beyond90/data/profiles/${p}/discovery.json`, import.meta.url);
    JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${p}#${i}`, q }));
  }
  const cases = [
    ["Developers open a ticket and wait two weeks for a clone of prod", "dbaas#0"],
    ["Nobody really owns half of the instances", "dbaas#2"],
    ["Restoring last Tuesday's state of the orders DB took us two days", "dbaas#1"],
    ["Patching takes a weekend per database, so we skip most of them", "dbaas#11"],
    ["The cloud bill doubled and nobody looks at it", "hybrid-cloud#7"],
    ["Egress fees are eating us alive", "hybrid-cloud#13"],
    ["Customer data has to stay in the EU because of GDPR", "hybrid-cloud#1"],
    ["We have never tested failing over to the cloud", "hybrid-cloud#4"],
    ["The two data centres are linked by a 1 Gb line, the network team pays for it", "hybrid-cloud#14"],
  ];
  let first = 0;
  for (const [said, want] of cases) {
    const got = match(cards, said).map((h) => h.card.key);
    assert.ok(got.includes(want), `${said}: ${got.join(" ")}`);
    if (got[0] === want) first += 1;
  }
  assert.ok(first >= 6, `first ${first} of ${cases.length}`);
});

test("on Kubernetes and virtual desktops too, what was heard finds its question first", () => {
  const cards = [];
  for (const p of ["kubernetes-platform", "euc", "hci", "dr-backup"]) {
    const file = new URL(`../../src/beyond90/data/profiles/${p}/discovery.json`, import.meta.url);
    JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${p}#${i}`, q }));
  }
  const cases = [
    ["Every team spun up its own clusters, we have no idea how many", "kubernetes-platform#2"],
    ["Devs wait three weeks for a namespace", "kubernetes-platform#0"],
    ["Anyone can deploy a privileged container", "kubernetes-platform#4"],
    ["Persistent volumes are not backed up at all", "kubernetes-platform#3"],
    ["Everything is kubectl by hand, no GitOps", "kubernetes-platform#5"],
    ["We are three minor versions behind on the clusters", "kubernetes-platform#1"],
    ["On-call finds out from users when pods crash at night", "kubernetes-platform#7"],
    ["Logons take five minutes every Monday", "euc#4"],
    ["We have 14 golden images and some are two years old", "euc#3"],
    ["The antivirus inside the desktops eats half the CPU", "euc#12"],
    ["Contractors work from their own laptops", "euc#1"],
    ["Profiles are 20 GB per user and live on a file share", "euc#11"],
  ];
  for (const [said, want] of cases) assert.equal((match(cards, said)[0] || {}).card?.key, want, said);
});

test("on object and file storage, edge sites and microsegmentation, what was heard has its question among the three, most first", () => {
  const cards = [];
  for (const p of ["object-storage", "file-storage", "edge-sites", "microsegmentation"]) {
    const file = new URL(`../../src/beyond90/data/profiles/${p}/discovery.json`, import.meta.url);
    JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${p}#${i}`, q }));
  }
  const cases = [
    ["We pay about 20 euros a terabyte plus egress", "object-storage#1"],
    ["Nobody knows how many access keys are out there", "object-storage#3"],
    ["The backup bucket has no object lock", "object-storage#4"],
    ["Old data never moves to a cheaper tier, it just piles up", "object-storage#10"],
    ["We had ransomware two years ago and restored from tape", "file-storage#1"],
    ["Users call the helpdesk to get yesterday's file back", "file-storage#4"],
    ["Half the shares are open to Everyone and nobody checks", "file-storage#6"],
    ["Most of the files have not been touched in years", "file-storage#8"],
    ["An engineer drives to a store every week to swap a disk", "edge-sites#1"],
    ["The shops are on a 20 Mb line that drops twice a week", "edge-sites#3"],
    ["Opening a new store takes three weeks before the tills work", "edge-sites#12"],
    ["Some branch servers are out of support since last year", "edge-sites#4"],
    ["One compromised server could reach the whole data centre", "microsegmentation#0"],
    ["Test and prod sit on the same flat network", "microsegmentation#4"],
    ["We have no idea which servers talk to which", "microsegmentation#2"],
    ["The auditors want proof that the payment environment is separated", "microsegmentation#1"],
  ];
  let first = 0;
  for (const [said, want] of cases) {
    const got = match(cards, said).map((h) => h.card.key);
    assert.ok(got.includes(want), `${said}: ${got.join(" ")}`);
    if (got[0] === want) first += 1;
  }
  assert.ok(first >= 15, `first ${first} of ${cases.length}`);
});

test("on platform migration, identity, logs and private AI, what was heard has its question among the three, most first", () => {
  const cards = [];
  for (const p of ["platform-migration", "identity", "siem", "private-ai"]) {
    const file = new URL(`../../src/beyond90/data/profiles/${p}/discovery.json`, import.meta.url);
    JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${p}#${i}`, q }));
  }
  const cases = [
    ["Our hypervisor licence renewal is in March and the price tripled", "platform-migration#0"],
    ["We tried moving a few VMs in the lab and the drivers broke", "platform-migration#4"],
    ["Nobody has a rollback plan if the cutover goes wrong at night", "platform-migration#5"],
    ["The ops team has never run anything but the old platform, they need training", "platform-migration#19"],
    ["About 40 machines still run an operating system out of support", "platform-migration#18"],
    ["Leavers keep their accounts for weeks", "identity#1"],
    ["Some admins still log in without MFA", "identity#4"],
    ["Service account passwords have not changed in ten years", "identity#6"],
    ["The last access review was signed off two years ago", "identity#5"],
    ["The OT network sends no logs at all", "siem#2"],
    ["We only keep logs for 30 days", "siem#6"],
    ["Most alerts get closed without anyone looking", "siem#7"],
    ["The GPU servers sit idle most of the time", "private-ai#2"],
    ["Customer data must stay in the country, so no public AI service", "private-ai#1"],
    ["Nobody knows what the chatbot can read", "private-ai#4"],
    ["Each team runs its own model and nobody tracks the spend", "private-ai#7"],
  ];
  let first = 0;
  for (const [said, want] of cases) {
    const got = match(cards, said).map((h) => h.card.key);
    assert.ok(got.includes(want), `${said}: ${got.join(" ")}`);
    if (got[0] === want) first += 1;
  }
  assert.ok(first >= 13, `first ${first} of ${cases.length}`);
});

test("on AI, cloud operations, endpoints, SaaS, service provider clouds and the platform, what was heard has its question among the three, most first", () => {
  const cards = [];
  for (const p of ["ai", "cloud-operations", "endpoint", "saas", "service-provider-cloud", "hci"]) {
    const file = new URL(`../../src/beyond90/data/profiles/${p}/discovery.json`, import.meta.url);
    JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${p}#${i}`, q }));
  }
  const cases = [
    ["People paste customer data into public chatbots", "ai#4"],
    ["Nobody has tried to jailbreak our assistant", "ai#6"],
    ["The API keys for the model provider were never rotated", "ai#5"],
    ["A new VM takes two weeks and three tickets", "cloud-operations#1"],
    ["Half the VMs are oversized and some nobody remembers", "cloud-operations#5"],
    ["The main cluster runs out of memory by spring", "cloud-operations#3"],
    ["Every change needs the CAB, which meets once a month", "cloud-operations#13"],
    ["Contractor laptops have no agent at all", "endpoint#2"],
    ["Some servers are still in detect-only mode", "endpoint#4"],
    ["Anyone in IT can add an exclusion", "endpoint#5"],
    ["Marketing bought their own tenant with a credit card", "saas#1"],
    ["Plenty of files are shared with anyone who has the link", "saas#4"],
    ["Some third-party apps can read everybody's mail", "saas#2"],
    ["Onboarding a new tenant takes a month from contract to first machine", "service-provider-cloud#7"],
    ["We cannot bill tenants for what they actually use", "service-provider-cloud#4"],
    ["Our hosted services depend on a platform licence whose price just changed", "service-provider-cloud#0"],
    ["The storage is 85 percent full and we keep nothing in reserve", "hci#9"],
    ["Upgrades are always postponed, we are two years behind", "hci#6"],
    ["The servers are seven years old and out of support next spring", "hci#12"],
    ["Plenty of powered-off VMs still sit on expensive disks", "hci#14"],
  ];
  let first = 0;
  for (const [said, want] of cases) {
    const got = match(cards, said).map((h) => h.card.key);
    assert.ok(got.includes(want), `${said}: ${got.join(" ")}`);
    if (got[0] === want) first += 1;
  }
  assert.ok(first >= 18, `first ${first} of ${cases.length}`);
});

test("on the security lines' newest questions, what was heard finds its question first", () => {
  const cards = [];
  for (const [name, dir] of [["cnapp", ""], ["siem", "profiles/siem/"], ["identity", "profiles/identity/"], ["endpoint", "profiles/endpoint/"], ["saas", "profiles/saas/"], ["ai", "profiles/ai/"]]) {
    const file = new URL(`../../src/beyond90/data/${dir}discovery.json`, import.meta.url);
    JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${name}#${i}`, q }));
  }
  const cases = [
    ["We only check the cloud configuration, we have no idea what runs inside the containers", "cnapp#8"],
    ["Terraform templates go straight to production without any check", "cnapp#9"],
    ["Critical findings stay open for months", "cnapp#10"],
    ["This year we must answer an audit questionnaire on the cloud", "cnapp#11"],
    ["Nobody watches the alerts at night or at weekends", "siem#8"],
    ["A log format changed and a detection silently stopped firing", "siem#9"],
    ["We pay for a threat intelligence feed but nobody reads it", "siem#10"],
    ["After an incident we must report to the regulator within 72 hours", "siem#11"],
    ["Three admins share the same domain admin password", "identity#8"],
    ["Contractors and suppliers keep their accounts after the contract ends", "identity#9"],
    ["We cannot see what an administrator did in a privileged session", "identity#10"],
    ["The auditor asked who had access to the payroll system last quarter and it took weeks", "identity#11"],
    ["A critical patch takes a month to reach every laptop", "endpoint#8"],
    ["Local admins can switch off the antivirus agent", "endpoint#9"],
    ["Personal phones read company mail with no control", "endpoint#10"],
    ["The last ransomware cost us two weeks of rebuilding machines", "endpoint#11"],
    ["We would not notice if someone took over an Office 365 account", "saas#8"],
    ["When people leave, their shared links keep working", "saas#9"],
    ["Nothing in the SaaS tenants is backed up, we trust the provider", "saas#10"],
    ["Any user can connect a third-party integration to the tenant", "saas#11"],
    ["Data science builds its own RAG pipelines and agents", "ai#8"],
    ["People edit the prompts directly in production", "ai#9"],
    ["We indexed the whole shared drive into the assistant without asking anyone", "ai#10"],
    ["When the chatbot gives a wrong answer nobody hears about it", "ai#11"],
  ];
  let first = 0;
  for (const [said, want] of cases) {
    const got = match(cards, said).map((h) => h.card.key);
    assert.ok(got.includes(want), `${said}: ${got.join(" ")}`);
    if (got[0] === want) first += 1;
  }
  assert.ok(first >= 22, `first ${first} of ${cases.length}`);
});

test("on the infrastructure lines' newest questions, what was heard finds its question first", () => {
  const cards = [];
  for (const p of ["object-storage", "file-storage", "edge-sites", "microsegmentation", "kubernetes-platform", "euc", "service-provider-cloud"]) {
    const file = new URL(`../../src/beyond90/data/profiles/${p}/discovery.json`, import.meta.url);
    JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${p}#${i}`, q }));
  }
  const cases = [
    ["Our cyber insurer asked how we would stop a breach spreading", "microsegmentation#11"],
    ["The containers and the bare metal are not covered by any policy", "microsegmentation#12"],
    ["Nobody is alerted when a machine tries a forbidden connection", "microsegmentation#13"],
    ["When a site loses its network link, the applications stop working", "edge-sites#13"],
    ["A desktop costs us about 90 euros per user per month with licences and support", "euc#13"],
    ["We would not know if a bucket became public", "object-storage#13"],
    ["Our operations team has admin access to every tenant environment and nothing is recorded", "service-provider-cloud#13"],
  ];
  for (const [said, want] of cases) assert.equal(match(cards, said)[0].card.key, want, said);
});

test("a note written in Italian finds the same questions as one in English", () => {
  let first = 0, all = 0;
  for (const [lines, cases] of [
    [["hci", "dbaas", "dr-backup", "hybrid-cloud"], [
      ["Gli sviluppatori aprono un ticket e aspettano due settimane per una copia della produzione", "dbaas#0"],
      ["Nessuno è davvero responsabile di metà delle istanze", "dbaas#2"],
      ["Ripristinare lo stato di martedì scorso del database ordini ci ha richiesto due giorni", "dbaas#1"],
      ["Le patch richiedono un weekend per database, quindi ne saltiamo molte", "dbaas#11"],
      ["La bolletta del cloud è raddoppiata e nessuno la guarda", "hybrid-cloud#7"],
      ["I costi di egress ci stanno uccidendo", "hybrid-cloud#13"],
      ["I dati dei clienti devono restare nell'UE per il GDPR", "hybrid-cloud#1"],
      ["Non abbiamo mai provato il failover verso il cloud", "hybrid-cloud#4"],
      ["I due data center sono collegati da una linea da 1 Gb, la paga il team di rete", "hybrid-cloud#14"],
    ]],
    [["platform-migration", "identity", "siem", "private-ai"], [
      ["Il rinnovo della licenza dell'hypervisor è a marzo e il prezzo è triplicato", "platform-migration#0"],
      ["Abbiamo provato a migrare qualche VM in laboratorio e i driver si sono rotti", "platform-migration#4"],
      ["Nessuno ha un piano di rollback se il passaggio fallisce di notte", "platform-migration#5"],
      ["Il team operativo non ha mai gestito altro che la vecchia piattaforma, serve formazione", "platform-migration#19"],
      ["Circa 40 macchine hanno ancora un sistema operativo fuori supporto", "platform-migration#18"],
      ["Chi lascia l'azienda mantiene l'account per settimane", "identity#1"],
      ["Alcuni amministratori accedono ancora senza MFA", "identity#4"],
      ["Le password degli account di servizio non cambiano da dieci anni", "identity#6"],
      ["L'ultima revisione degli accessi è stata firmata due anni fa", "identity#5"],
      ["La rete OT non invia nessun log", "siem#2"],
      ["Teniamo i log solo per 30 giorni", "siem#6"],
      ["La maggior parte degli alert viene chiusa senza che nessuno la guardi", "siem#7"],
      ["I server GPU restano fermi quasi tutto il tempo", "private-ai#2"],
      ["I dati dei clienti devono restare in Italia, quindi niente servizi AI pubblici", "private-ai#1"],
      ["Nessuno sa cosa può leggere il chatbot", "private-ai#4"],
      ["Ogni team usa il suo modello e nessuno tiene traccia della spesa", "private-ai#7"],
    ]],
    [["siem", "identity", "endpoint", "saas", "ai"], [
      ["Nessuno guarda gli alert di notte o nel fine settimana", "siem#8"],
      ["Tre amministratori condividono la stessa password di domain admin", "identity#8"],
      ["Gli admin locali possono spegnere l'agente antivirus", "endpoint#9"],
      ["Quando le persone se ne vanno, i loro link condivisi continuano a funzionare", "saas#9"],
      ["Le persone modificano i prompt direttamente in produzione", "ai#9"],
      ["Una patch critica impiega un mese ad arrivare su tutti i portatili", "endpoint#8"],
    ]]
  ]) {
    const cards = [];
    for (const p of lines) {
      const file = new URL(`../../src/beyond90/data/profiles/${p}/discovery.json`, import.meta.url);
      JSON.parse(readFileSync(file, "utf8")).questions.forEach((q, i) => cards.push({ key: `${p}#${i}`, q }));
    }
    for (const [said, want] of cases) {
      const got = match(cards, said).map((h) => h.card.key);
      assert.ok(got.includes(want), `${said}: ${got.join(" ")}`);
      if (got[0] === want) first += 1;
      all += 1;
    }
  }
  assert.ok(first >= 25, `first ${first} of ${all}`);
});

test("in Italian too: the deal's questions, the concerns a line expects, and the money said", async () => {
  const { DEAL } = await import("../qualify.js");
  const { figureIn } = await import("../heard.js");
  const deal = DEAL.map((x) => ({ key: `deal#${x.id}`, label: "Qualify the deal", q: x }));
  const first = (said) => (match([...DR, ...deal], said)[0] || {}).card?.key;
  for (const [said, want] of [
    ["Qualsiasi amministratore di dominio può cancellare i backup", "dr#6"],
    ["Il secondo data center è a 40 km, circa 2 ms", "dr#3"],
    ["L'ultima prova di failover è stata tre anni fa", "dr#1"],
    ["Nessuno ha mai stimato quanto costa un giorno di fermo, forse un milione di fatturato perso", "dr#0"],
    ["I magazzini non hanno nulla di protetto", "dr#2"],
    ["Il DNS e le regole del firewall non sono mai stati nel piano", "dr#7"],
    ["RPO e RTO esistono sulla carta, li ha scritti l'IT", "dr#4"],
    ["Il CIO firma tutto sopra i 500 mila", "deal#decider"],
    ["Il contratto di hosting scade a marzo, quindi va scelto prima", "deal#why_now"],
    ["Stanno parlando anche con un altro fornitore, o potrebbero farlo in casa", "deal#alternatives"],
    ["Il capo infrastruttura lo porterà al consiglio e lo sosterrà, ci tiene molto", "deal#champion"],
  ]) assert.equal(first(said), want, said);

  const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
  const cards = concernCards(cat, Object.keys(cat.lines));
  for (const [want, said] of [
    ["dr-backup#0", "abbiamo già i backup, girano ogni notte"],
    ["dr-backup#1", "un secondo sito è troppo costoso per noi"],
    ["dr-backup#2", "provare il ripristino disturberebbe la produzione"],
    ["dr-backup#3", "il ransomware non cifrerebbe anche i backup?"],
    ["edge-sites#0", "le nostre sedi sono troppo piccole per questo"],
    ["edge-sites#1", "i collegamenti verso le sedi sono troppo scarsi, alcune vanno in 4G"],
    ["cloud-operations#0", "abbiamo già strumenti di monitoraggio, tre"],
    ["cloud-operations#3", "temo che l'automazione rompa la produzione"],
    ["hci#2", "abbiamo appena comprato nuovi storage array"],
    ["dbaas#2", "servirebbero nuove licenze?"],
  ]) assert.equal((concernsHeard(cards, said)[0] || {}).card?.key, `obj:${want}`, said);
  for (const said of ["Il CIO firma tutto sopra i 500 mila", "L'ultima prova di failover è stata tre anni fa"]) assert.deepEqual(concernsHeard(cards, said), [], said);

  const day = { q: "What would one day without your main site cost, and has anyone put a number on it?" };
  const open = { q: "What is at stake if nothing changes?" };
  assert.deepEqual(figureIn("circa 2 milioni di euro, la finanza è d'accordo", day), { amount: 2000000, per: "day" });
  assert.deepEqual(figureIn("40.000 euro all'ora", day), { amount: 40000, per: "hour" });
  assert.deepEqual(figureIn("1,5 milioni al mese di ordini persi", open), { amount: 1500000, per: "month" });
  assert.deepEqual(figureIn("2.000.000 per ogni fermo", open), { amount: 2000000, per: "incident" });
  assert.deepEqual(figureIn("250000 all'anno", open), { amount: 250000, per: "year" });
  assert.deepEqual(figureIn("300 mila al giorno", open), { amount: 300000, per: "day" });
  assert.equal(figureIn("l'ultima prova è di tre anni fa", day), null);
  assert.equal(figureIn("1500 utenti", day), null);
  assert.equal(figureIn("2 milioni, per ora", open), null);     // "per ora" is "for now", not per hour
});

test("an English note is read exactly as before: Italian is read only in words that are not English", () => {
  assert.deepEqual(tokens("Il rinnovo della licenza scade a marzo"), [stem("renewal"), stem("licence"), stem("renewal"), "marzo"]);
  assert.deepEqual(tokens("l'accesso degli ex dipendenti"), [stem("access"), stem("leave")]);
  assert.deepEqual(tokens("the data will serve several teams"), ["data", "serv", "several", "team"]);
  assert.deepEqual(tokens("the admin's account can't be deleted"), [stem("admin"), "account", stem("delete")]);
});

test("a concern the line expects is recognised as the customer says it, and an ordinary sentence is not one", () => {
  const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
  const cards = concernCards(cat, Object.keys(cat.lines));
  assert.equal(cards.length, 22);
  for (const [want, said] of [
    ["hci#0", "Honestly this is fine for the small sites but not for our core applications"],
    ["hci#1", "the platform services eat resources that our workloads need"],
    ["hci#2", "we just bought new storage arrays last year"],
    ["hci#3", "what would our storage team do then, there'd be nothing left for them"],
    ["dr-backup#0", "we have backups already, Veeam runs every night"],
    ["dr-backup#1", "a second site is way too expensive for us"],
    ["dr-backup#2", "we can't test recovery, it would disrupt production"],
    ["dr-backup#3", "wouldn't ransomware just encrypt the backups as well?"],
    ["dbaas#0", "the DBAs will never give up control of their databases"],
    ["dbaas#1", "our databases are far too critical to move"],
    ["dbaas#2", "would we need new licences for that?"],
    ["object-storage#0", "why not just use a bucket in the public cloud"],
    ["object-storage#1", "on premises an admin can always delete it"],
    ["object-storage#2", "I'm not sure our backup software supports it"],
    ["edge-sites#0", "our sites are too small for this kind of thing"],
    ["edge-sites#1", "the links to the sites are poor, some are on 4G"],
    ["edge-sites#2", "we can't send people to install servers at every site"],
    ["edge-sites#3", "AI at the edge is not for us, not yet"],
    ["cloud-operations#0", "we already have monitoring tools, three of them"],
    ["cloud-operations#1", "self-service will just create sprawl"],
    ["cloud-operations#2", "chargeback would start a political fight between departments"],
    ["cloud-operations#3", "I'm worried automation will break production"],
  ]) {
    const got = concernsHeard(cards, said);
    assert.equal(got.length ? got[0].card.key : "", `obj:${want}`, said);
  }
  for (const said of ["The CIO signs off anything above 500k", "Plenty of powered-off VMs still sit on expensive disks",
    "The two data centres are linked by a 1 Gb line, the network team pays for it", "The last failover drill was three years ago", "", "ok"]) {
    assert.deepEqual(concernsHeard(cards, said), [], said);
  }
});

test("on every line that has them, each concern finds itself first, as it is written", () => {
  for (const p of readdirSync(new URL("../../src/beyond90/data/profiles/", import.meta.url))) {
    let story;
    try { story = JSON.parse(readFileSync(new URL(`../../src/beyond90/data/profiles/${p}/story.json`, import.meta.url), "utf-8")); } catch { continue; }
    const cards = concernCards({ lines: { [p]: { label: p, story } } }, [p]);
    for (const c of cards) assert.equal(concernsHeard(cards, c.o.says)[0].card.key, c.key, `${p}: ${c.o.says}`);
  }
});

test("the security lines' concerns are recognised as customers say them", () => {
  const lines = {};
  for (const p of ["siem", "identity", "endpoint", "saas", "ai"]) {
    lines[p] = { label: p, story: JSON.parse(readFileSync(new URL(`../../src/beyond90/data/profiles/${p}/story.json`, import.meta.url), "utf-8")) };
  }
  lines.cnapp = { label: "cnapp", story: JSON.parse(readFileSync(new URL("../../src/beyond90/data/story.json", import.meta.url), "utf-8")) };
  const cards = concernCards({ lines }, Object.keys(lines));
  for (const [want, said] of [
    ["siem#0", "we collect all our logs already"],
    ["siem#1", "the analysts are drowning in alerts"],
    ["identity#0", "everyone already has multi-factor"],
    ["endpoint#0", "every machine already has antivirus"],
    ["endpoint#1", "prevention mode would break our applications"],
    ["saas#0", "security in the cloud is the vendor's job"],
    ["ai#0", "we don't use AI in production yet"],
    ["ai#1", "our policy forbids pasting sensitive data into AI tools"],
    ["cnapp#0", "we already have a cloud security tool"],
    ["cnapp#1", "the developers just ignore the findings"],
    ["cnapp#2", "agents slow our workloads down"],
  ]) {
    const got = concernsHeard(cards, said);
    assert.equal(got.length ? got[0].card.key : "", `obj:${want}`, said);
  }
});

test("a figure a first sketch starts from is read from what was said, for the lines in scope only", () => {
  const all = ["euc", "dbaas", "kubernetes-platform", "file-storage"];
  const got = (said, scope = all, current) => sketchFigures(said, scope, current).map((x) => `${x.sketch}.${x.field}=${x.value}`);
  assert.deepEqual(got("We have about 1,200 users, 900 at the same time"), ["vdi.users=1200", "vdi.concurrency_pct=75"]);
  assert.deepEqual(got("circa 1.200 utenti, 800 in contemporanea"), ["vdi.users=1200", "vdi.concurrency_pct=67"]);
  assert.deepEqual(got("2k users on the old desktops"), ["vdi.users=2000"]);
  assert.deepEqual(got("We run 45 databases, licensed on 256 cores"), ["db.databases=45", "db.cores_today=256"]);
  assert.deepEqual(got("30 applications in containers"), ["k8s.apps=30"]);
  assert.deepEqual(got("300 TB of file shares"), ["files.data_tib=272.8"], "a terabyte is a little less than a tebibyte");
  assert.deepEqual(got("1.5 PB di file sulle condivisioni"), ["files.data_tib=1364.2"]);
  assert.deepEqual(got("600 connected at once", ["euc"], { vdi: { users: 1000 } }), ["vdi.concurrency_pct=60"]);
  // not a figure for a sketch: per site, about something else, or a line out of scope
  assert.deepEqual(got("The 3 sites have 40 users each"), []);
  assert.deepEqual(got("300 TB of backups"), []);
  assert.deepEqual(got("600 connected at once", ["euc"]), [], "a share needs the number of users");
  assert.deepEqual(got("1,200 users and 45 databases", ["hci"]), []);
  assert.equal(sketchFigures("1,200 users", ["euc"])[0].label, "users of the desktop sizing sketch");
  // backups and recovery: the protected data, and the round trip between the sites
  const dr = ["dr-backup", "object-storage"];
  assert.deepEqual(got("We keep 200 TB of backups", dr), ["obj.data_tib=181.9", "dr.data_tib=181.9"]);
  assert.deepEqual(got("About 80 TB to protect, the second site is 3 ms away", ["dr-backup"]), ["dr.data_tib=72.8", "dr.latency_ms=3"]);
  assert.deepEqual(got("La latenza tra i siti è di 1,5 ms", ["dr-backup"]), ["dr.latency_ms=1.5"]);
  assert.deepEqual(got("Logons take 300 ms on a good day", ["dr-backup"]), [], "a time that is not between the sites");
  // serving a model: its size, its precision, the context and the requests at once
  const ai = ["private-ai"];
  assert.deepEqual(got("A 70B model, quantised to 4-bit, with 32k tokens of context and 200 requests at once", ai),
    ["gpu.params_b=70", "gpu.bits=4", "gpu.context_k=32", "gpu.concurrent=200"]);
  assert.deepEqual(got("un modello da 8 miliardi di parametri, 50 utenti in contemporanea", ai), ["gpu.params_b=8", "gpu.concurrent=50"]);
  assert.deepEqual(got("We serve it in FP8 with a context of 128k", ai), ["gpu.bits=8", "gpu.context_k=128"]);
  assert.deepEqual(got("We bought 8 GPUs last year", ai), [], "a count of GPUs is not the model's size");
});

test("the case for change is read from what was said: the renewal, when it comes, what staying and an hour down cost", () => {
  const got = (said) => caseFigures(said).map((x) => `${x.field}=${x.value}`);
  assert.deepEqual(got("The renewal would triple the cost; we pay 1.4 million a year for licences and support"), ["stay_uplift_pct=200", "stay_run=1400000"]);
  assert.deepEqual(got("Il rinnovo tra 10 mesi raddoppia il canone"), ["stay_uplift_pct=100", "renewal_in_months=10"]);
  assert.deepEqual(got("Renewal is in ten months, +40% on the price"), ["stay_uplift_pct=40", "renewal_in_months=10"]);
  assert.deepEqual(got("An hour down costs about 50k"), ["downtime_cost_hour=50000"]);
  assert.deepEqual(got("un'ora di fermo costa 40.000 euro all'ora"), ["downtime_cost_hour=40000"]);
  assert.deepEqual(got("Operations spend 120 hours a month on patching and upgrades"), ["ops_hours_now=120"]);
  assert.deepEqual(got("The contract expires in 18 months"), ["renewal_in_months=18"]);
  // not about the price, or no figure
  assert.deepEqual(got("The team doubled last year"), []);
  assert.deepEqual(got("We spend 30 hours a month in meetings"), []);
  assert.equal(caseFigures("The renewal triples the price")[0].label, "expected rise at the next renewal, in the case for change");
});

test("what one machine costs is read from what was said, when a line that counts it is in scope", () => {
  const sc = ["cloud-operations"];
  const got = (said, scope = sc) => unitFigures(said, scope).map((x) => `${x.field}=${x.value}`);
  assert.deepEqual(got("We run about 500 VMs, and 3 people run the platform"), ["machines=500", "people_fte=3"]);
  assert.deepEqual(got("A person costs us 70,000 a year"), ["fte_cost=70000"]);
  assert.deepEqual(got("Licences cost 240,000 a year"), ["licences_year=240000"]);
  assert.deepEqual(got("Power and cooling is 45k a year"), ["power_year=45000"]);
  assert.deepEqual(got("Around 20% of the VMs are idle or forgotten"), ["idle_pct=20"]);
  assert.deepEqual(got("The same VM costs 175 a month in the cloud"), ["cloud_month=175"]);
  assert.deepEqual(got("Gestiamo 800 macchine virtuali con 4 sistemisti che seguono la piattaforma", ["hybrid-cloud"]), ["machines=800", "people_fte=4"]);
  assert.deepEqual(got("We have 3 people in marketing"), []);
  assert.deepEqual(got("We run about 500 VMs", ["hci"]), [], "no line in scope counts it");
});

test("the edge design's figures: sites of a kind it knows by name, the trips to sites and what one costs", () => {
  const sc = ["edge-sites"];
  const cur = { edge: { kinds: [{ name: "Stores", sites: 120 }, { name: "Large sites", sites: 30 }, { name: "Plants", sites: 6 }, { name: "Other sites", sites: 0 }] } };
  const got = (said, current = cur) => edgeFigures(said, sc, current).map((x) => `${x.field}=${x.value}`);
  assert.deepEqual(got("We have 140 stores and 8 plants"), ["kinds.0.sites=140", "kinds.2.sites=8"]);
  assert.deepEqual(got("6 plants, 40 VMs each"), ["kinds.2.sites=6"]);
  assert.deepEqual(got("35 large sites"), ["kinds.1.sites=35"]);
  assert.deepEqual(got("6 plants", {}), ["kinds.2.sites=6"], "the default kinds when none were set");
  assert.deepEqual(got("We send someone to a site 300 times a year, and a trip costs about 400 euros"), ["visits_year=300", "visit_cost=400"]);
  assert.deepEqual(got("ogni trasferta costa 350 euro, facciamo 200 interventi l'anno"), ["visits_year=200", "visit_cost=350"]);
  assert.deepEqual(edgeFigures("We have 140 stores", ["hci"], cur), []);
  // a kind's count goes in its own row, the others stay as they were
  const f = edgeFigures("We have 140 stores", sc, cur)[0];
  const next = f.apply(cur.edge);
  assert.deepEqual(next.kinds.map((k) => k.sites), [140, 30, 6, 0]);
  assert.equal(f.has(next), true);
  assert.equal(f.has(cur.edge), false);
});

test("how long backups are kept, and how fast file data grows, read from what was said", () => {
  const sc = ["object-storage", "file-storage"];
  const got = (said, scope = sc) => retentionFigures(said, scope).map((x) => `${x.sketch}.${x.field}=${x.value}`);
  assert.deepEqual(got("We keep 30 days of daily backups, 12 weeklies and monthlies for 7 years"), ["obj.daily_days=30", "obj.weekly_weeks=12", "obj.monthly_months=84"]);
  assert.deepEqual(got("Daily for 60 days, weekly for 8 weeks, monthly for 24 months"), ["obj.daily_days=60", "obj.weekly_weeks=8", "obj.monthly_months=24"]);
  assert.deepEqual(got("Teniamo 14 giorni di copie e 12 mensili"), ["obj.daily_days=14", "obj.monthly_months=12"]);
  assert.deepEqual(got("The file shares grow about 25% a year"), ["files.growth_pct=25"]);
  assert.deepEqual(got("Revenue grew 10% last year"), [], "growth of something other than file data");
  assert.deepEqual(got("We restored a file 3 days ago"), []);
  assert.deepEqual(got("We keep 30 days of daily backups", ["hci"]), []);
});
